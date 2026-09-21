"""Incremental bridge to a user-configured, authorized signal data service."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

from . import growth_analysis, store
from .service import DomainError

MAX_BYTES = 5 * 1024 * 1024
MAX_SIGNALS = 50000
LEASE_SECONDS = 180
REQUEST_SECONDS = 60


def _configuration():
    url = os.environ.get('GROWTH_SIGNALS_URL', '').strip()
    token = os.environ.get('GROWTH_SIGNALS_TOKEN', '').strip()
    source = os.environ.get('GROWTH_SIGNALS_SOURCE', '').strip() or 'collector'
    identifier = hashlib.sha256((source + '\n' + url).encode()).hexdigest()
    return url, token, source[:200], identifier


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read(conn, identifier):
    growth_analysis.initialize(conn)
    row = conn.execute("SELECT document FROM growth_records WHERE kind='collector' AND id=?", (identifier,)).fetchone()
    return json.loads(row[0]) if row else {'id': identifier, 'cursor': None, 'status': 'idle', 'last_attempt': None, 'last_success': None, 'last_error': None, 'imported': 0, 'updated': 0}


def _public(state, source, configured):
    return {'configured': configured, 'source': source, **{key: state.get(key) for key in ('status', 'last_attempt', 'last_success', 'last_error', 'imported', 'updated')}}


def get_status():
    url, _, source, identifier = _configuration()
    if not url:
        return {'configured': False, 'source': source, 'status': 'not_configured', 'last_attempt': None, 'last_success': None, 'last_error': None, 'imported': 0, 'updated': 0}
    with store.transaction() as conn:
        state = _read(conn, identifier)
    result = _public(state, source, True)
    if state.get('lease_until', 0) <= time.time() and state.get('status') == 'running':
        result['status'] = 'lease_expired'
    return result


def _protocol(code, message):
    raise DomainError(code, message, 422)


def _fetch(url, token, cursor, transport=None):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ValueError()
    except ValueError:
        _protocol('COLLECTOR_URL', '采集服务地址需为有效 HTTP(S) 地址，凭据请通过 TOKEN 配置。')
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    deadline = time.monotonic() + REQUEST_SECONDS
    with httpx.Client(timeout=httpx.Timeout(20, connect=10), follow_redirects=False, transport=transport) as client:
        with client.stream('GET', url, params={'cursor': cursor} if cursor is not None else {}, headers=headers) as response:
            if response.status_code != 200:
                _protocol('COLLECTOR_HTTP', f'采集服务返回 HTTP {response.status_code}，游标未推进。')
            size = response.headers.get('content-length')
            if size and size.isdigit() and int(size) > MAX_BYTES:
                _protocol('COLLECTOR_RESPONSE_LIMIT', '采集响应超过 5 MB。')
            content = bytearray()
            for chunk in response.iter_bytes():
                if time.monotonic() > deadline:
                    _protocol('COLLECTOR_TIMEOUT', '采集响应超过总时限。')
                content.extend(chunk)
                if len(content) > MAX_BYTES:
                    _protocol('COLLECTOR_RESPONSE_LIMIT', '采集响应超过 5 MB。')
    def invalid_number(value):
        raise ValueError('Non-finite JSON number')
    try:
        payload = json.loads(content, parse_constant=invalid_number)
    except (ValueError, UnicodeError):
        _protocol('COLLECTOR_JSON', '采集响应不是有效 JSON。')
    if not isinstance(payload, dict) or not isinstance(payload.get('signals'), list) or 'next_cursor' not in payload:
        _protocol('COLLECTOR_PROTOCOL', '采集响应需包含 signals 数组和 next_cursor。')
    if len(payload['signals']) > MAX_SIGNALS:
        _protocol('COLLECTOR_ROW_LIMIT', '单次采集不能超过 50,000 条信号。')
    if payload['next_cursor'] is not None and (not isinstance(payload['next_cursor'], str) or len(payload['next_cursor']) > 4096):
        _protocol('COLLECTOR_CURSOR', 'next_cursor 需为不超过 4,096 字符的字符串或 null。')
    return payload


def poll(*, transport=None):
    """Fetch one page. Optional httpx transport supports offline protocol tests."""
    url, token, source, identifier = _configuration()
    if not url:
        return {'status': 'not_configured', 'source': source, 'message': '尚未配置授权信号数据服务。'}
    owner = secrets.token_hex(16)
    with store.transaction() as conn:
        state = _read(conn, identifier)
        if state.get('lease_until', 0) > time.time():
            return {'status': 'busy', 'source': source, 'last_success': state.get('last_success')}
        state.update(status='running', lease_owner=owner, lease_until=time.time() + LEASE_SECONDS, last_attempt=_now())
        growth_analysis._put(conn, 'collector', identifier, state)
        cursor = state.get('cursor')
    try:
        # No database connection/transaction spans this network operation.
        payload = _fetch(url, token, cursor, transport)
        with store.transaction() as conn:
            current = _read(conn, identifier)
            if current.get('lease_owner') != owner or current.get('lease_until', 0) <= time.time():
                return {'status': 'superseded', 'source': source}
            result = growth_analysis.ingest_signals(conn, payload['signals'], source=source, coverage_start=payload.get('coverage_start'), coverage_end=payload.get('coverage_end'))
            current.update(status='success', cursor=payload['next_cursor'] if payload['next_cursor'] is not None else cursor, lease_owner=None, lease_until=0, last_success=_now(), last_error=None, imported=result['imported'], updated=result['updated'])
            growth_analysis._put(conn, 'collector', identifier, current)
        return {'status': 'success', 'source': source, **result, 'last_success': current['last_success']}
    except Exception as error:
        # Neither upstream response bodies nor exception strings can enter diagnostics.
        if isinstance(error, DomainError):
            code = error.code
            message = '信号或覆盖声明校验失败，游标未推进。' if not code.startswith('COLLECTOR_') else error.message
        elif isinstance(error, httpx.TimeoutException):
            code, message = 'COLLECTOR_TIMEOUT', '连接采集服务超时，游标未推进。'
        elif isinstance(error, httpx.HTTPError):
            code, message = 'COLLECTOR_NETWORK', '无法读取采集服务，游标未推进。'
        else:
            code, message = 'COLLECTOR_FAILED', '采集未完成，游标未推进。'
        detail = {'code': code, 'message': message}
        with store.transaction() as conn:
            current = _read(conn, identifier)
            if current.get('lease_owner') != owner:
                return {'status': 'superseded', 'source': source}
            current.update(status='error', lease_owner=None, lease_until=0, last_error=detail)
            growth_analysis._put(conn, 'collector', identifier, current)
        return {'status': 'error', 'source': source, 'error': detail, 'last_success': current.get('last_success')}
