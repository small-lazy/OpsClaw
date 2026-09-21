"""Public API growth workflow, using temporary databases and an offline ad bridge."""
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from opsweaver import growth_actions, growth_monitor, growth_worker, store
from opsweaver.api import app

HTTP_CLIENT = httpx.Client


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'workspace.sqlite3')
    for name in ('GROWTH_ADS_BASE_URL', 'GROWTH_ADS_TOKEN', 'GROWTH_SIGNALS_URL', 'BRAVE_SEARCH_API_KEY'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(growth_monitor.socket, 'getaddrinfo', lambda *a, **k: [(2, 1, 6, '', ('8.8.8.8', 443))])
    async def idle_worker(stop):
        await stop.wait()
    monkeypatch.setattr(growth_worker, 'run_worker', idle_worker)
    with TestClient(app) as test_client:
        response = test_client.post('/api/v1/workspace/session')
        assert response.status_code == 200
        yield test_client


def post(client, path, payload=None):
    response = client.post('/api/v1/growth' + path, json=payload or {})
    assert response.status_code == 200, response.text
    return response.json()['data']


def create_proposal(client, kind='create_campaign', auto=False):
    event = post(client, '/events', {'school': '学校 A', 'college': '学院 B', 'title': '招生公告', 'url': 'https://university.example/news/1'})
    asset = post(client, '/assets', {'school': '学校 A', 'college': '学院 B', 'product': '面试资料', 'content_id': 'content-001'})
    parameters = {'asset_id': asset['id'], 'admissions_count': 100, 'conversion_rate': .1, 'average_order_value_minor': 10000,
                  'budget_cap_minor': 20000, 'target_roi': 2, 'kind': kind, 'amount_minor': 5000,
                  'lifecycle_policy': {'auto_execute': auto}}
    blocked = client.post('/api/v1/growth/proposals', json={'event_id': event['id'], 'parameters': parameters})
    assert blocked.status_code == 409 and blocked.json()['error']['code'] == 'EVENT_REVIEW_REQUIRED'
    post(client, f"/events/{event['id']}/review", {'decision': 'approve'})
    action = post(client, '/proposals', {'event_id': event['id'], 'parameters': parameters})
    denied = client.post(f"/api/v1/growth/actions/{action['id']}/execute")
    assert denied.status_code == 403
    return post(client, f"/actions/{action['id']}/review", {'decision': 'approve', 'hash': action['hash']})


def offline_bridge(monkeypatch, handler):
    monkeypatch.setenv('GROWTH_ADS_BASE_URL', 'https://ads.example')
    monkeypatch.setenv('GROWTH_ADS_TOKEN', 'offline-test-token')
    monkeypatch.setattr(growth_actions.httpx, 'Client', lambda **kw: HTTP_CLIENT(transport=httpx.MockTransport(handler), **kw))


def test_import_to_reviewed_campaign_and_mature_lifecycle(client, monkeypatch):
    csv = '订单号,实付金额,退款金额,支付时间,订单状态,学校,学院,商品名称\nO1,100,10,2026-09-20T10:00:00+08:00,已支付,学校 A,学院 B,面试资料\nO2,50,0,2025-09-20T10:00:00+08:00,已支付,学校 A,学院 B,面试资料\n'
    uploaded = client.post('/api/v1/imports', files=[('files', ('orders.csv', csv.encode('utf-8'), 'text/csv'))])
    assert uploaded.status_code == 200, uploaded.text
    dataset_id = uploaded.json()['data']['files'][0]['dataset_ids'][0]
    bound = post(client, '/orders/bind', {'dataset_id': dataset_id, 'coverage_start': '2025-09-20', 'coverage_end': '2026-09-20', 'start': '2026-09-20', 'end': '2026-09-20'})
    assert bound['imported'] == 2
    report = bound['report']
    assert report['summary']['current']['gmv_minor'] == 9000
    assert report['summary']['previous']['gmv_minor'] == 5000
    assert report['summary']['yoy']['gmv_minor'] == .8
    action = create_proposal(client)
    blocked = post(client, f"/actions/{action['id']}/execute")
    assert blocked['status'] == 'blocked_configuration'
    sent = []
    def handler(request):
        assert request.method == 'POST' and str(request.url) == 'https://ads.example/actions'
        body = json.loads(request.content)
        sent.append(body)
        return httpx.Response(200, json={**body, 'status': 'succeeded', 'campaign_id': 'remote-campaign'})
    offline_bridge(monkeypatch, handler)
    started = datetime.now(timezone.utc) - timedelta(days=4)
    original_now = store.now
    monkeypatch.setattr(store, 'now', lambda: started.isoformat())
    campaign = post(client, f"/actions/{action['id']}/execute")
    monkeypatch.setattr(store, 'now', original_now)
    assert campaign['status'] == 'succeeded'
    assert post(client, f"/actions/{action['id']}/execute")['status'] == 'succeeded'
    assert len(sent) == 1
    metrics = {'day': 1, 'spend_minor': 1000, 'attributed_gmv_minor': 200, 'window_start': started.isoformat(),
               'window_end': (started + timedelta(days=1)).isoformat(), 'attribution_complete': False}
    post(client, f"/actions/{action['id']}/performance", metrics)
    assert post(client, f"/actions/{action['id']}/lifecycle")['status'] == 'waiting_data'
    post(client, f"/actions/{action['id']}/performance", {**metrics, 'attribution_complete': True})
    decision = post(client, f"/actions/{action['id']}/lifecycle")
    assert decision['status'] == 'pending_approval'
    assert decision['action']['kind'] == 'update_budget'
    assert decision['action']['payload']['budget_minor'] == 10000
    overview = client.get('/api/v1/growth/overview')
    assert overview.status_code == 200, overview.text
    assert len(overview.json()['data']['actions']) == 2


def test_worker_reconciles_timeout_without_resubmitting_recharge(client, monkeypatch):
    action = create_proposal(client, kind='recharge')
    calls = []
    def handler(request):
        calls.append(request.method)
        if request.method == 'POST':
            raise httpx.ReadTimeout('remote accepted but response lost', request=request)
        return httpx.Response(200, json={key: action[key] for key in ('idempotency_key', 'kind', 'payload')} | {'status': 'succeeded'})
    offline_bridge(monkeypatch, handler)
    with store.transaction() as connection:
        growth_monitor.update_policy(connection, {'worker_enabled': True})
    growth_worker.tick()
    growth_worker.tick()
    growth_worker.tick()
    assert calls == ['POST', 'GET']
    with store.connect() as connection:
        assert growth_actions.get_action(connection, action['id'])['status'] == 'succeeded'


def test_worker_executes_preapproved_lifecycle_once_across_repeated_polls(client, monkeypatch):
    action = create_proposal(client, auto=True)
    started = datetime.now(timezone.utc) - timedelta(days=4)
    calls = []
    def handler(request):
        calls.append((request.method, str(request.url)))
        if request.method == 'POST':
            body = json.loads(request.content)
            return httpx.Response(200, json={**body, 'status': 'succeeded', 'campaign_id': 'remote-campaign'})
        assert str(request.url) == 'https://ads.example/campaigns/remote-campaign/performance'
        return httpx.Response(200, json={'day': 1, 'campaign_id': 'remote-campaign', 'spend_minor': 1000,
            'attributed_gmv_minor': 200, 'window_start': started.isoformat(),
            'window_end': (started + timedelta(days=1)).isoformat(), 'attribution_complete': True})
    offline_bridge(monkeypatch, handler)
    original_now = store.now
    monkeypatch.setattr(store, 'now', lambda: started.isoformat())
    post(client, f"/actions/{action['id']}/execute")
    monkeypatch.setattr(store, 'now', original_now)
    with store.transaction() as connection:
        growth_monitor.update_policy(connection, {'worker_enabled': True})
    for _ in range(3):
        with store.transaction() as connection:
            store.set_meta(connection, 'growth_performance_poll:' + action['id'], None)
        growth_worker.tick()
    assert sum(method == 'POST' for method, _ in calls) == 2
    with store.connect() as connection:
        actions = growth_actions.list_actions(connection)
        children = [a for a in actions if a.get('parent_id') == action['id']]
        assert len(children) == 1 and children[0]['status'] == 'succeeded'
        assert children[0]['kind'] == 'update_budget'
