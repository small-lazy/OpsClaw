import json
import sqlite3

import httpx
import pytest

from opsweaver import growth_analysis, growth_collector, store


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'collector.sqlite3')
    monkeypatch.setenv('GROWTH_SIGNALS_URL', 'https://authorized.invalid/signals')
    monkeypatch.setenv('GROWTH_SIGNALS_TOKEN', 'secret-token-do-not-save')
    monkeypatch.delenv('GROWTH_SIGNALS_SOURCE', raising=False)
    return tmp_path


def signal(identifier='s1'):
    return {'id': identifier, 'type': 'dm', 'occurred_at': '2026-09-21', 'school': '甲大学', 'count': 2, 'body': 'PRIVATE BODY DO NOT STORE'}


def raw_state():
    with store.connect() as conn:
        return growth_analysis.list_records(conn, 'collector')[0]


def test_unconfigured_does_not_contact_network(workspace, monkeypatch):
    monkeypatch.delenv('GROWTH_SIGNALS_URL')
    assert growth_collector.poll()['status'] == 'not_configured'
    assert growth_collector.get_status()['configured'] is False


def test_incremental_cursor_idempotency_privacy_and_no_network_db_lock(workspace):
    requests = []
    def upstream(request):
        requests.append(request)
        assert request.headers['authorization'] == 'Bearer secret-token-do-not-save'
        with store.transaction() as conn:
            # A write from inside the request handler proves no poll transaction holds the lock.
            conn.execute('CREATE TABLE IF NOT EXISTS network_probe(value INTEGER)')
            conn.execute('INSERT INTO network_probe VALUES(1)')
        assert growth_collector.poll(transport=httpx.MockTransport(lambda _: pytest.fail('concurrent request')))['status'] == 'busy'
        return httpx.Response(200, json={'signals': [signal()], 'next_cursor': 'page-2', 'coverage_start': '2026-09-21', 'coverage_end': '2026-09-21'})
    transport = httpx.MockTransport(upstream)
    first = growth_collector.poll(transport=transport)
    second = growth_collector.poll(transport=transport)
    assert first['status'] == second['status'] == 'success'
    assert first['imported'] == 1 and second['updated'] == 1
    assert requests[0].url.params.get('cursor') is None
    assert requests[1].url.params['cursor'] == 'page-2'
    assert raw_state()['cursor'] == 'page-2'
    assert growth_collector.get_status()['last_success']
    with store.connect() as conn:
        documents = '\n'.join(r[0] for r in conn.execute('SELECT document FROM growth_records'))
    assert 'PRIVATE BODY' not in documents
    assert 'secret-token' not in documents
    assert 'cursor' not in growth_collector.get_status()


def test_invalid_page_is_atomic_and_does_not_advance_cursor(workspace):
    growth_collector.poll(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'signals': [signal()], 'next_cursor': 'stable'})))
    bad = {'signals': [signal('new'), {'id': 'invalid', 'type': 'PRIVATE BODY', 'occurred_at': 'x'}], 'next_cursor': 'bad'}
    response = growth_collector.poll(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=bad)))
    assert response['status'] == 'error'
    assert raw_state()['cursor'] == 'stable'
    with store.connect() as conn:
        assert [r['id'] for r in growth_analysis.list_records(conn, 'signal')] == ['s1']
    assert 'PRIVATE BODY' not in json.dumps(raw_state())
    assert raw_state()['last_success']


def test_storage_failure_rolls_back_signal_and_cursor(workspace, monkeypatch):
    original = growth_analysis.ingest_signals
    def broken(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError('PRIVATE BODY secret-token-do-not-save')
    monkeypatch.setattr(growth_analysis, 'ingest_signals', broken)
    result = growth_collector.poll(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'signals': [signal()], 'next_cursor': 'advanced'})))
    assert result['status'] == 'error'
    assert raw_state()['cursor'] is None
    with store.connect() as conn:
        assert growth_analysis.list_records(conn, 'signal') == []
    assert 'PRIVATE BODY' not in json.dumps(raw_state())


def test_bounds_http_failures_and_retry(workspace, monkeypatch):
    monkeypatch.setattr(growth_collector, 'MAX_BYTES', 80)
    result = growth_collector.poll(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b'x' * 81)))
    assert result['error']['code'] == 'COLLECTOR_RESPONSE_LIMIT'
    monkeypatch.setattr(growth_collector, 'MAX_BYTES', 50000)
    monkeypatch.setattr(growth_collector, 'MAX_SIGNALS', 1)
    result = growth_collector.poll(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'signals': [signal('a'), signal('b')], 'next_cursor': 'next'})))
    assert result['error']['code'] == 'COLLECTOR_ROW_LIMIT'
    result = growth_collector.poll(transport=httpx.MockTransport(lambda _: httpx.Response(401, text='secret upstream error')))
    assert result['error']['code'] == 'COLLECTOR_HTTP'
    assert 'secret upstream' not in json.dumps(raw_state())
    result = growth_collector.poll(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'signals': [], 'next_cursor': None})))
    assert result['status'] == 'success'
    assert raw_state()['cursor'] is None


def test_lease_owner_rechecked_before_ingest(workspace):
    def upstream(request):
        with store.transaction() as conn:
            _, _, _, identifier = growth_collector._configuration()
            state = growth_collector._read(conn, identifier)
            state['lease_owner'] = 'another-worker'
            growth_analysis._put(conn, 'collector', identifier, state)
        return httpx.Response(200, json={'signals': [signal()], 'next_cursor': 'not-consumed'})
    assert growth_collector.poll(transport=httpx.MockTransport(upstream))['status'] == 'superseded'
    with store.connect() as conn:
        assert growth_analysis.list_records(conn, 'signal') == []
    assert raw_state()['cursor'] is None
