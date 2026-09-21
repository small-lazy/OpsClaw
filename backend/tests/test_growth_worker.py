import pytest

from opsweaver import growth_worker as worker, growth_actions as actions, growth_api, growth_collector, growth_monitor as monitor, store


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'worker.sqlite3')
    with store.transaction() as conn:
        conn.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        conn.execute('CREATE TABLE audit(id TEXT PRIMARY KEY,document TEXT NOT NULL)')
        growth_api.initialize(conn)
        store.set_meta(conn, 'growth_policy', {'worker_enabled': True})
    monkeypatch.setattr(growth_collector, 'poll', lambda: {'status': 'not_configured'})
    monkeypatch.setattr(monitor, 'monitor_one', lambda *a, **k: pytest.fail('unexpected notice network call'))
    monkeypatch.setattr(actions, 'execute', lambda *a: pytest.fail('unexpected remote write'))
    monkeypatch.setattr(actions, 'reconcile', lambda *a: pytest.fail('unexpected readback'))
    monkeypatch.setattr(actions, 'fetch_performance', lambda *a: pytest.fail('unexpected performance call'))


def save_action(identifier, status, kind='recharge'):
    with store.transaction() as conn:
        actions._put(conn, 'growth_actions', {'id': identifier, 'status': status, 'kind': kind})


def set_policy(**values):
    with store.transaction() as conn:
        store.set_meta(conn, 'growth_policy', {'worker_enabled': True, **values})


def test_disabled_worker_has_no_external_calls(workspace, monkeypatch):
    set_policy(worker_enabled=False)
    monkeypatch.setattr(growth_collector, 'poll', lambda: pytest.fail('disabled worker must not collect'))
    save_action('approved', 'approved')
    assert worker.tick() == {'status': 'disabled'}
    with store.connect() as conn:
        assert store.meta(conn, 'growth_worker_lease') is None
        assert actions.get_action(conn, 'approved')['status'] == 'approved'


def test_collector_failure_marks_partial_and_releases_lease(workspace, monkeypatch):
    monkeypatch.setattr(growth_collector, 'poll', lambda: {'status': 'error', 'error': {'code': 'COLLECTOR_NETWORK', 'message': 'unavailable'}})
    result = worker.tick()
    assert result['status'] == 'partial'
    assert result['errors'] == ['COLLECTOR_NETWORK']
    with store.connect() as conn:
        assert store.meta(conn, 'growth_worker_status') == result
        assert store.meta(conn, 'growth_worker_lease') == {}


def test_kill_switch_blocks_writes_but_allows_readback(workspace, monkeypatch):
    set_policy(kill_switch=True)
    for identifier, status, kind in [('new', 'approved', 'recharge'), ('unknown', 'unknown', 'recharge'), ('running', 'running', 'recharge'), ('campaign', 'succeeded', 'create_campaign')]:
        save_action(identifier, status, kind)
    reconciled, fetched, evaluated = [], [], []
    monkeypatch.setattr(actions, 'reconcile', lambda identifier: reconciled.append(identifier))
    monkeypatch.setattr(actions, 'fetch_performance', lambda identifier: fetched.append(identifier))
    def evaluate(conn, identifier):
        evaluated.append(identifier)
        return {'action': {'id': 'lifecycle-child', 'status': 'approved'}}
    monkeypatch.setattr(actions, 'evaluate_lifecycle', evaluate)
    assert worker.tick()['status'] == 'completed'
    assert set(reconciled) == {'unknown', 'running'}
    assert fetched == evaluated == ['campaign']
    with store.connect() as conn:
        assert actions.get_action(conn, 'new')['status'] == 'approved'


def test_approved_executes_once_unknown_only_reconciles(workspace, monkeypatch):
    save_action('approved', 'approved')
    save_action('uncertain', 'unknown')
    executed, reconciled = [], []
    def execute(identifier):
        executed.append(identifier)
        with store.transaction() as conn:
            action = actions.get_action(conn, identifier)
            action['status'] = 'succeeded'
            actions._put(conn, 'growth_actions', action)
    def reconcile(identifier):
        reconciled.append(identifier)
        with store.transaction() as conn:
            action = actions.get_action(conn, identifier)
            action['status'] = 'succeeded'
            actions._put(conn, 'growth_actions', action)
    monkeypatch.setattr(actions, 'execute', execute)
    monkeypatch.setattr(actions, 'reconcile', reconcile)
    assert worker.tick()['status'] == 'completed'
    assert worker.tick()['status'] == 'completed'
    assert executed == ['approved']
    assert reconciled == ['uncertain']


def test_global_lease_blocks_reentrant_tick_and_failure_releases(workspace, monkeypatch):
    nested = []
    def collect():
        nested.append(worker.tick())
        # Writes during collection verify tick holds no database transaction during IO.
        with store.transaction() as conn:
            store.set_meta(conn, 'network_probe', True)
        return {'status': 'not_configured'}
    monkeypatch.setattr(growth_collector, 'poll', collect)
    assert worker.tick()['status'] == 'completed'
    assert nested == [{'status': 'busy'}]
    def broken():
        raise RuntimeError('offline injected failure')
    monkeypatch.setattr(growth_collector, 'poll', broken)
    with pytest.raises(RuntimeError):
        worker.tick()
    with store.connect() as conn:
        assert store.meta(conn, 'growth_worker_lease') == {}


def test_successful_collector_triggers_analysis_once(workspace, monkeypatch):
    called = []
    monkeypatch.setattr(growth_collector, 'poll', lambda: {'status': 'success', 'imported': 2, 'updated': 0})
    monkeypatch.setattr(growth_api, 'latest_analysis', lambda conn: called.append('analysis'))
    assert worker.tick()['status'] == 'completed'
    assert called == ['analysis']
