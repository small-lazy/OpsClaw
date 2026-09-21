import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from opsweaver import growth_actions as growth, store
from opsweaver.service import DomainError

HTTP_CLIENT = httpx.Client

@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'growth.sqlite3')
    monkeypatch.delenv('GROWTH_ADS_BASE_URL', raising=False)
    monkeypatch.delenv('GROWTH_ADS_TOKEN', raising=False)
    monkeypatch.delenv('GROWTH_MAX_BUDGET_MINOR', raising=False)
    monkeypatch.delenv('GROWTH_MAX_RECHARGE_MINOR', raising=False)
    with store.transaction() as connection:
        connection.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        growth.initialize(connection)
        store.set_meta(connection, 'settings', {'kill_switch': False})
        asset = growth.register_asset(connection, {'school': '学校 A', 'college': '学院 B', 'product': '资料', 'content_id': 'content-001'})
    return {'event': {'id': 'notice-001', 'school': '学校 A', 'college': '学院 B'},
            'parameters': {'asset_id': asset['id'], 'admissions_count': 100, 'conversion_rate': .1,
                           'average_order_value_minor': 10000, 'budget_cap_minor': 20000, 'target_roi': 2}}


def proposal(workspace, **parameters):
    with store.transaction() as connection:
        return growth.propose(connection, workspace['event'], {**workspace['parameters'], **parameters})


def approve(action):
    with store.transaction() as connection:
        return growth.decide(connection, action['id'], {'decision': 'approve', 'hash': action['hash']})


def bridge(monkeypatch, handler):
    monkeypatch.setenv('GROWTH_ADS_BASE_URL', 'https://bridge.example')
    monkeypatch.setenv('GROWTH_ADS_TOKEN', 'test-token')
    real_client = HTTP_CLIENT
    monkeypatch.setattr(growth.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))


def succeeded(request):
    body = json.loads(request.content)
    return httpx.Response(200, json={**body, 'status': 'succeeded', 'campaign_id': 'campaign-001'})


def mature_campaign(workspace, monkeypatch, auto=False):
    real_now = store.now
    started = datetime.now(timezone.utc) - timedelta(days=4)
    monkeypatch.setattr(store, 'now', lambda: started.isoformat())
    action = approve(proposal(workspace, lifecycle_policy={'auto_execute': auto}))
    bridge(monkeypatch, succeeded)
    result = growth.execute(action['id'])
    monkeypatch.setattr(store, 'now', real_now)
    return result


def metrics(campaign, day=1, **changes):
    start = datetime.fromisoformat(campaign['campaign_started_at'])
    return {'day': day, 'spend_minor': 1000, 'attributed_gmv_minor': 300,
            'window_start': start.isoformat(), 'window_end': (start + timedelta(days=day)).isoformat(),
            'attribution_complete': True, **changes}


def test_opportunity_requires_asset_and_version_bound_approval(workspace):
    action = proposal(workspace)
    assert action['opportunity']['expected_gmv_minor'] == 100000
    assert action['payload']['budget_minor'] == 20000
    with pytest.raises(DomainError, match='批准'):
        growth.execute(action['id'])
    with store.transaction() as connection:
        with pytest.raises(DomainError) as error:
            growth.decide(connection, action['id'], {'decision': 'approve', 'hash': 'wrong'})
        assert error.value.code == 'GROWTH_APPROVAL_STALE'
        growth.decide(connection, action['id'], {'decision': 'reject', 'hash': action['hash']})
    with pytest.raises(DomainError):
        growth.execute(action['id'])


def test_unconfigured_bridge_persists_blocked_then_can_execute_once(workspace, monkeypatch):
    action = approve(proposal(workspace))
    blocked = growth.execute(action['id'])
    assert blocked['status'] == 'blocked_configuration'
    assert blocked['last_error'] == 'ADS_NOT_CONFIGURED'
    calls = []
    def handler(request):
        calls.append(request)
        return succeeded(request)
    bridge(monkeypatch, handler)
    first = growth.execute(action['id'])
    second = growth.execute(action['id'])
    assert first == second and first['status'] == 'succeeded'
    assert len(calls) == 1


def test_timeout_reconciles_without_duplicate_recharge(workspace, monkeypatch):
    action = approve(proposal(workspace, kind='recharge', amount_minor=5000))
    calls = []
    def handler(request):
        calls.append(request.method)
        if request.method == 'POST':
            raise httpx.ReadTimeout('response lost after remote charge', request=request)
        return httpx.Response(200, json={key: action[key] for key in ('idempotency_key', 'kind', 'payload')} | {'status': 'succeeded'})
    bridge(monkeypatch, handler)
    assert growth.execute(action['id'])['status'] == 'unknown'
    with pytest.raises(DomainError) as error:
        growth.execute(action['id'])
    assert error.value.code == 'GROWTH_RECONCILE_REQUIRED'
    assert growth.reconcile(action['id'])['status'] == 'succeeded'
    assert calls == ['POST', 'GET']


def test_receipt_mismatch_stays_unknown_and_kill_switch_stops_new_send(workspace, monkeypatch):
    action = approve(proposal(workspace))
    bridge(monkeypatch, lambda request: httpx.Response(200, json={'status': 'succeeded', 'idempotency_key': 'someone-else'}))
    assert growth.execute(action['id'])['status'] == 'unknown'
    another = approve(proposal(workspace))
    with store.transaction() as connection:
        store.set_meta(connection, 'settings', {'kill_switch': True})
    with pytest.raises(DomainError) as error:
        growth.execute(another['id'])
    assert error.value.code == 'GROWTH_KILL_SWITCH'


def test_recharge_bounds_and_tampering_are_rejected(workspace):
    with pytest.raises(DomainError):
        proposal(workspace, kind='recharge', amount_minor=20001)
    with pytest.raises(DomainError):
        proposal(workspace, target_roi=0)
    action = approve(proposal(workspace, kind='recharge', amount_minor=5000))
    with store.transaction() as connection:
        item = growth.get_action(connection, action['id'])
        item['payload']['amount_minor'] = 5001
        growth._put(connection, 'growth_actions', item)
    with pytest.raises(DomainError) as error:
        growth.execute(action['id'])
    assert error.value.code == 'GROWTH_APPROVAL_REQUIRED'


def test_immature_attribution_cannot_trigger_lifecycle(workspace, monkeypatch):
    campaign = mature_campaign(workspace, monkeypatch)
    with store.transaction() as connection:
        growth.ingest_performance(connection, campaign['id'], metrics(campaign, attribution_complete=False))
        assert growth.evaluate_lifecycle(connection, campaign['id'])['status'] == 'waiting_data'
        short = datetime.fromisoformat(campaign['campaign_started_at']) + timedelta(hours=12)
        growth.ingest_performance(connection, campaign['id'], metrics(campaign, day=2, window_end=short.isoformat()))
        assert growth.evaluate_lifecycle(connection, campaign['id'])['status'] == 'waiting_data'


def test_lifecycle_roi_reduction_requires_review_without_preapproval(workspace, monkeypatch):
    campaign = mature_campaign(workspace, monkeypatch)
    with store.transaction() as connection:
        growth.ingest_performance(connection, campaign['id'], metrics(campaign))
        result = growth.evaluate_lifecycle(connection, campaign['id'])
        assert result['action']['kind'] == 'update_budget'
        assert result['action']['payload']['budget_minor'] == 10000
        assert result['status'] == 'pending_approval'
        assert growth.evaluate_lifecycle(connection, campaign['id'])['action']['id'] == result['action']['id']
    with pytest.raises(DomainError):
        growth.execute(result['action']['id'])


def test_preapproved_lifecycle_stops_day_three_and_policy_override_cannot_escalate(workspace, monkeypatch):
    campaign = mature_campaign(workspace, monkeypatch, auto=True)
    with store.transaction() as connection:
        growth.ingest_performance(connection, campaign['id'], metrics(campaign, day=3))
        result = growth.evaluate_lifecycle(connection, campaign['id'])
        assert result['status'] == 'approved'
        assert result['action']['kind'] == 'pause_campaign'
    assert growth.execute(result['action']['id'])['status'] == 'succeeded'


def test_manual_policy_cannot_grant_automatic_authority(workspace, monkeypatch):
    campaign = mature_campaign(workspace, monkeypatch, auto=False)
    with store.transaction() as connection:
        growth.ingest_performance(connection, campaign['id'], metrics(campaign))
        result = growth.evaluate_lifecycle(connection, campaign['id'], {'auto_execute': True})
        assert result['status'] == 'pending_approval'
        adjusted = growth.propose_adjustment(connection, campaign['id'], {'kind': 'update_roi', 'target_roi': 3})
        assert adjusted['status'] == 'pending_approval'
        assert adjusted['payload'] == {'campaign_id': 'campaign-001', 'target_roi': 3}


def test_shared_growth_kill_switch_blocks_execution(workspace, monkeypatch):
    action = approve(proposal(workspace))
    bridge(monkeypatch, succeeded)
    with store.transaction() as connection:
        store.set_meta(connection, 'growth_policy', {'kill_switch': True})
    with pytest.raises(DomainError) as error:
        growth.execute(action['id'])
    assert error.value.code == 'GROWTH_KILL_SWITCH'


def test_fetch_performance_uses_confirmed_campaign_and_idempotent_sample(workspace, monkeypatch):
    campaign = mature_campaign(workspace, monkeypatch)
    sample = metrics(campaign)
    real_client = HTTP_CLIENT
    requests = []
    def handler(request):
        requests.append(str(request.url))
        return httpx.Response(200, json={**sample, 'campaign_id': 'campaign-001'})
    monkeypatch.setattr(growth.httpx, 'Client', lambda **kwargs: real_client(**{**kwargs, 'transport': httpx.MockTransport(handler)}))
    first = growth.fetch_performance(campaign['id'])
    second = growth.fetch_performance(campaign['id'])
    assert first == second
    assert requests == ['https://bridge.example/campaigns/campaign-001/performance'] * 2


def test_corrected_metrics_block_preapproved_old_action(workspace, monkeypatch):
    campaign = mature_campaign(workspace, monkeypatch, auto=True)
    with store.transaction() as connection:
        growth.ingest_performance(connection, campaign['id'], metrics(campaign))
        child = growth.evaluate_lifecycle(connection, campaign['id'])['action']
        growth.ingest_performance(connection, campaign['id'], metrics(campaign, attributed_gmv_minor=10000))
        assert growth.evaluate_lifecycle(connection, campaign['id'])['status'] == 'healthy'
    with pytest.raises(DomainError) as error:
        growth.execute(child['id'])
    assert error.value.code == 'STALE_LIFECYCLE_EVIDENCE'
