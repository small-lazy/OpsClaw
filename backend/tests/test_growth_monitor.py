from contextlib import contextmanager
from datetime import datetime, timezone
import socket

import httpx
import pytest

from opsweaver import growth_monitor as monitor, store
from opsweaver.service import DomainError


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'monitor.sqlite3')
    monkeypatch.delenv('BRAVE_SEARCH_API_KEY', raising=False)
    monkeypatch.setattr(monitor.socket, 'getaddrinfo', lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))])
    with store.transaction() as conn:
        conn.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
        conn.execute('CREATE TABLE audit(id TEXT PRIMARY KEY,document TEXT NOT NULL)')
        monitor.initialize(conn)
    return tmp_path


def factor(active=False, urls=None):
    with store.transaction() as conn:
        result = monitor.save_factor(conn, {'school': '甲大学', 'name': '招生公告', 'allowed_domains': ['university.edu.cn'], 'urls': ['https://admissions.university.edu.cn/notices/'] if urls is None else urls})
        if active:
            result = monitor.review(conn, 'factor', result['id'], 'approve')
        return result


def fake_html(monkeypatch, html, calls=None):
    @contextmanager
    def stream(method, url, **kwargs):
        if calls is not None:
            calls.append(url)
        response = httpx.Response(200, headers={'Content-Type': 'text/html; charset=utf-8'}, content=html.encode(), request=httpx.Request(method, url))
        yield response
    monkeypatch.setattr(monitor.httpx, 'stream', stream)


def test_factor_persistent_manual_review_gates_monitoring(workspace):
    item = factor()
    assert item['status'] == 'pending_review'
    with pytest.raises(DomainError) as error:
        monitor.monitor_one(item['id'])
    assert error.value.code == 'FACTOR_NOT_ACTIVE'
    with store.transaction() as conn:
        monitor.review(conn, 'factor', item['id'], 'approve')
    with store.connect() as conn:
        assert monitor.get(conn, 'factor', item['id'])['status'] == 'active'
        assert factor()['id'] == item['id']
    with store.transaction() as conn:
        monitor.review(conn, 'factor', item['id'], 'reject')
    with pytest.raises(DomainError):
        monitor.monitor_one(item['id'], force=True)


def test_domain_whitelist_private_ips_and_redirect_rejection(workspace, monkeypatch):
    assert monitor.public_url('https://admissions.university.edu.cn/a#part', ['university.edu.cn']) == 'https://admissions.university.edu.cn/a'
    for url in ['https://university.edu.cn.evil.example/a', 'http://university.edu.cn/a', 'https://user:password@university.edu.cn/a']:
        with pytest.raises(DomainError):
            monitor.public_url(url, ['university.edu.cn'])
    monkeypatch.setattr(monitor.socket, 'getaddrinfo', lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(DomainError):
        monitor.public_url('https://university.edu.cn/')
    monkeypatch.setattr(monitor.socket, 'getaddrinfo', lambda *a, **k: [(socket.AF_INET6, socket.SOCK_STREAM, 6, '', ('::1', 443, 0, 0))])
    with pytest.raises(DomainError):
        monitor.public_url('https://university.edu.cn/')


def test_real_html_links_and_repeated_poll_deduplicate(workspace, monkeypatch):
    calls = []
    fake_html(monkeypatch, '<a href="../info/100/42.htm"><span>2026 年推免招生通知</span></a><a href="../info/100/42.htm">招生通知重复链接</a><a href="https://evil.example/x">复试通知</a><a href="/about">学校简介</a><a href="javascript:void(0)">招生栏目</a>', calls)
    item = factor(active=True)
    first = monitor.monitor_one(item['id'])
    assert first['status'] == 'completed'
    assert len(first['new_events']) == 1
    event = first['new_events'][0]
    assert event['url'] == 'https://admissions.university.edu.cn/info/100/42.htm'
    assert event['status'] == 'pending_review'
    assert event['causal_status'] == 'unconfirmed'
    assert monitor.monitor_one(item['id'])['status'] == 'not_due'
    assert len(calls) == 1
    assert monitor.monitor_one(item['id'], force=True)['new_events'] == []
    with store.connect() as conn:
        assert len(monitor.records(conn, 'event')) == 1


def test_navigation_and_current_listing_are_not_notice_events(workspace, monkeypatch):
    fake_html(monkeypatch, '<a href="/admission">研究生招生</a><a href="/notices/">招生公告入口</a>'
              '<a href="/articles/11.html">学院复试工作通知</a>')
    item = factor(active=True)
    result = monitor.monitor_one(item['id'])
    assert [e['title'] for e in result['new_events']] == ['学院复试工作通知']


def test_failure_backoff_and_recovery(workspace, monkeypatch):
    item = factor(active=True)
    @contextmanager
    def unavailable(method, url, **kwargs):
        raise httpx.ConnectError('private diagnostic not to expose')
        yield
    monkeypatch.setattr(monitor.httpx, 'stream', unavailable)
    for attempt in (1, 2):
        before = datetime.now(timezone.utc)
        with pytest.raises(DomainError) as error:
            monitor.monitor_one(item['id'], force=True)
        assert error.value.code == 'MONITOR_FAILED'
        with store.connect() as conn:
            current = monitor.get(conn, 'factor', item['id'])
        assert current['failure_count'] == attempt
        assert current['lease_until'] is None
        assert (datetime.fromisoformat(current['next_check_at']) - before).total_seconds() >= 60 * 2**attempt - 2
        assert 'private diagnostic' not in current['last_error']
    fake_html(monkeypatch, '<a href="/notice/2">复试通知</a>')
    assert monitor.monitor_one(item['id'], force=True)['status'] == 'completed'
    with store.connect() as conn:
        assert monitor.get(conn, 'factor', item['id'])['failure_count'] == 0


def test_brave_missing_configuration_is_explicit(workspace, monkeypatch):
    monkeypatch.setattr(monitor.httpx, 'get', lambda *a, **k: pytest.fail('must not contact external service'))
    with pytest.raises(DomainError) as error:
        monitor.brave_search('甲大学 招生通知')
    assert error.value.code == 'BRAVE_NOT_CONFIGURED'
    item = factor(active=True, urls=[])
    with pytest.raises(DomainError) as error:
        monitor.monitor_one(item['id'])
    assert error.value.code == 'MONITOR_FAILED'
    with store.connect() as conn:
        assert 'BRAVE_SEARCH_API_KEY' in monitor.get(conn, 'factor', item['id'])['last_error']


def test_redirect_cannot_leave_official_domain(workspace, monkeypatch):
    calls = []
    @contextmanager
    def redirect(method, url, **kwargs):
        calls.append(url)
        yield httpx.Response(302, headers={'location': 'https://evil.example/private'}, request=httpx.Request(method, url))
    monkeypatch.setattr(monitor.httpx, 'stream', redirect)
    with pytest.raises(DomainError):
        monitor.fetch_links('https://university.edu.cn/notices', ['university.edu.cn'])
    assert len(calls) == 1


def test_empty_anchors_do_not_become_events(workspace, monkeypatch):
    fake_html(monkeypatch, '<a href="">招生通知</a><a href="#list">复试通知</a><a>推免通知</a>')
    item = factor(active=True)
    assert monitor.monitor_one(item['id'])['new_events'] == []


def test_rejection_during_fetch_prevents_event_write(workspace, monkeypatch):
    item = factor(active=True)
    @contextmanager
    def reject_during_request(method, url, **kwargs):
        with store.transaction() as conn:
            monitor.review(conn, 'factor', item['id'], 'reject')
        yield httpx.Response(200, headers={'Content-Type': 'text/html'}, content='<a href="/notice/1">招生通知</a>'.encode(), request=httpx.Request(method, url))
    monkeypatch.setattr(monitor.httpx, 'stream', reject_during_request)
    assert monitor.monitor_one(item['id'])['status'] == 'inactive'
    with store.connect() as conn:
        assert monitor.records(conn, 'event') == []
        assert monitor.get(conn, 'factor', item['id'])['lease_until'] is None
