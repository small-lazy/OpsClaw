"""Persistent external-event discovery and approved monitoring rules."""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import secrets
import socket
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from . import store
from .service import DomainError


DEFAULT_POLICY = {"monitor_interval_seconds": 60, "worker_enabled": False,
                  "auto_propose": False, "anomaly_threshold": 0.3, "min_orders": 5,
                  "analysis_days": 7, "kill_switch": False}


def initialize(connection):
    connection.execute("CREATE TABLE IF NOT EXISTS growth_monitor(kind TEXT,id TEXT,document TEXT NOT NULL,PRIMARY KEY(kind,id))")


def put(connection, kind, item):
    connection.execute("INSERT INTO growth_monitor VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document",
                       (kind, item['id'], json.dumps(item, ensure_ascii=False, allow_nan=False)))
    return item


def records(connection, kind):
    return [json.loads(r[0]) for r in connection.execute("SELECT document FROM growth_monitor WHERE kind=? ORDER BY rowid DESC", (kind,))]


def get(connection, kind, identifier):
    row = connection.execute("SELECT document FROM growth_monitor WHERE kind=? AND id=?", (kind, identifier)).fetchone()
    if not row:
        raise DomainError('GROWTH_NOT_FOUND', '没有找到该增长记录。', 404)
    return json.loads(row[0])


def policy(connection):
    return DEFAULT_POLICY | (store.meta(connection, 'growth_policy') or {})


def update_policy(connection, changes):
    if set(changes) - DEFAULT_POLICY.keys():
        raise DomainError('INVALID_POLICY', '包含未知策略字段。', 422)
    result = policy(connection) | changes
    for key in ('worker_enabled', 'auto_propose', 'kill_switch'):
        if type(result[key]) is not bool:
            raise DomainError('INVALID_POLICY', f'{key} 必须为布尔值。', 422)
    for key, low, high in [('monitor_interval_seconds', 60, 86400), ('analysis_days', 1, 366), ('min_orders', 1, 100000)]:
        if type(result[key]) is not int or not low <= result[key] <= high:
            raise DomainError('INVALID_POLICY', f'{key} 需要在 {low}–{high} 之间。', 422)
    if type(result['anomaly_threshold']) not in (int, float) or not 0.01 <= result['anomaly_threshold'] <= 10:
        raise DomainError('INVALID_POLICY', '异常阈值需要在 0.01–10 之间。', 422)
    store.set_meta(connection, 'growth_policy', result)
    store.audit(connection, 'growth.policy', '更新增长监控策略。')
    return result


def configuration(connection):
    p = policy(connection)
    return {"brave_configured": bool(os.getenv('BRAVE_SEARCH_API_KEY')),
            "ads_configured": bool(os.getenv('GROWTH_ADS_BASE_URL') and os.getenv('GROWTH_ADS_TOKEN')),
            "collector_configured": bool(os.getenv('GROWTH_COLLECTOR_TOKEN') or os.getenv('GROWTH_SIGNALS_URL')),
            "collector_mode": 'poll' if os.getenv('GROWTH_SIGNALS_URL') else 'webhook',
            "worker_enabled": p['worker_enabled'],
            "environment_keys": ['BRAVE_SEARCH_API_KEY', 'GROWTH_COLLECTOR_TOKEN', 'GROWTH_SIGNALS_URL', 'GROWTH_SIGNALS_TOKEN', 'GROWTH_SIGNALS_SOURCE', 'GROWTH_ADS_BASE_URL', 'GROWTH_ADS_TOKEN', 'GROWTH_MAX_BUDGET_MINOR', 'GROWTH_MAX_RECHARGE_MINOR']}


def public_url(value, allowed_domains=None):
    try:
        parsed = urlsplit(str(value))
        host = (parsed.hostname or '').lower()
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not host:
            raise ValueError()
        if allowed_domains and not any(host == d or host.endswith('.' + d) for d in allowed_domains):
            raise ValueError()
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError()
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path or '/', parsed.query, ''))
    except (ValueError, OSError) as error:
        raise DomainError('INVALID_PUBLIC_URL', '请填写可访问的 HTTPS 公网来源，且域名需属于已确认的品牌或市场官网。', 422) from error


def save_factor(connection, payload):
    school, name = str(payload.get('school', '')).strip(), str(payload.get('name', '')).strip()
    domains = payload.get('allowed_domains', [])
    urls = payload.get('urls', [])
    if not school or not name or not isinstance(domains, list) or not domains or len(domains) > 20:
        raise DomainError('FACTOR_FIELDS', '请填写因子名称、品牌或市场和官网域名白名单。', 422)
    domains = [str(d).strip().lower() for d in domains]
    if any('/' in d or ':' in d or not d or '.' not in d for d in domains):
        raise DomainError('FACTOR_DOMAINS', '白名单填写域名，不含协议或路径。', 422)
    if not isinstance(urls, list) or len(urls) > 10:
        raise DomainError('FACTOR_URLS', '每个因子最多配置 10 个公告列表页。', 422)
    urls = [public_url(u, domains) for u in urls]
    keywords = payload.get('keywords') or ['促销', '新品', '补货', '节日']
    if not isinstance(keywords, list) or len(keywords) > 20 or any(not isinstance(k, str) or not k.strip() for k in keywords):
        raise DomainError('FACTOR_KEYWORDS', '关键词需要非空文本数组，最多 20 项。', 422)
    interval = payload.get('interval_seconds', policy(connection)['monitor_interval_seconds'])
    if type(interval) is not int or not 60 <= interval <= 86400:
        raise DomainError('FACTOR_INTERVAL', '监控间隔需要 60–86400 秒。', 422)
    identifier = 'factor-' + hashlib.sha256(json.dumps([school, name, domains, urls], ensure_ascii=False).encode()).hexdigest()[:24]
    existing = next((f for f in records(connection, 'factor') if f['id'] == identifier), None)
    if existing:
        return existing
    factor = {'id': identifier, 'name': name[:200], 'school': school[:200], 'college': str(payload.get('college', ''))[:200],
              'query': str(payload.get('query') or f'{school} {payload.get("college", "")} 新品 促销 补货 节日 商业公告')[:500],
              'allowed_domains': domains, 'urls': urls, 'keywords': keywords, 'status': 'pending_review',
              'candidate_id': payload.get('candidate_id'), 'created_at': store.now(), 'last_checked_at': None,
              'next_check_at': None, 'last_error': None, 'failure_count': 0}
    parameters = payload.get('action_parameters') or {}
    if not isinstance(parameters, dict):
        raise DomainError('FACTOR_ACTION_PARAMETERS', '机会策略参数需要对象。', 422)
    factor['action_parameters'] = parameters
    factor['interval_seconds'] = interval
    put(connection, 'factor', factor)
    store.audit(connection, 'growth.factor', '新建待审核监控因子。')
    return factor


def save_event(connection, payload, *, discovered=False):
    title, school = str(payload.get('title', '')).strip(), str(payload.get('school', '')).strip()
    if not title or not school:
        raise DomainError('EVENT_FIELDS', '事件需要标题和品牌或市场。', 422)
    url = public_url(payload.get('url', ''))
    published = payload.get('published_at')
    if published:
        try:
            published = datetime.fromisoformat(published.replace('Z', '+00:00'))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            if published > datetime.now(timezone.utc) + timedelta(minutes=5):
                raise ValueError()
            published = published.isoformat()
        except (ValueError, TypeError, AttributeError) as error:
            raise DomainError('EVENT_DATE', '发布日期需要有效的 ISO 时间，且不能晚于当前时间。', 422) from error
    identifier = 'event-' + hashlib.sha256((school + '\n' + url).encode()).hexdigest()[:24]
    old = next((e for e in records(connection, 'event') if e['id'] == identifier), None)
    if old and discovered:
        return old
    admissions = payload.get('admissions_count')
    if admissions is not None and (type(admissions) is not int or not 1 <= admissions <= 1000000):
        raise DomainError('EVENT_ADMISSIONS', '潜在人群规模需要 1–1000000 的整数。', 422)
    item = {'id': identifier, 'title': title[:500], 'school': school[:200], 'college': str(payload.get('college', ''))[:200],
            'url': url, 'published_at': published, 'detected_at': store.now(), 'status': 'pending_review',
            'factor_id': payload.get('factor_id'), 'event_type': str(payload.get('event_type', 'commercial_event'))[:100],
            'admissions_count': admissions, 'excerpt': str(payload.get('excerpt', ''))[:1500],
            'source': 'monitor' if discovered else 'manual', 'causal_status': 'unconfirmed'}
    if old:
        item['detected_at'] = old['detected_at']
        item['factor_id'] = item['factor_id'] or old.get('factor_id')
    return put(connection, 'event', item)


def review(connection, kind, identifier, decision):
    if decision not in ('approve', 'reject'):
        raise DomainError('INVALID_REVIEW', '审核动作需要 approve 或 reject。', 422)
    item = get(connection, kind, identifier)
    item.update(status=('active' if kind == 'factor' else 'approved') if decision == 'approve' else 'rejected', reviewed_at=store.now())
    put(connection, kind, item)
    store.audit(connection, f'growth.{kind}.review', f'已{decision} {identifier}。')
    return item


def brave_search(query):
    key = os.getenv('BRAVE_SEARCH_API_KEY')
    if not key:
        raise DomainError('BRAVE_NOT_CONFIGURED', '请配置 BRAVE_SEARCH_API_KEY 后使用外部检索。', 409)
    try:
        response = httpx.get('https://api.search.brave.com/res/v1/web/search', params={'q': query, 'count': 10, 'freshness': 'pw', 'extra_snippets': 'true'},
                             headers={'X-Subscription-Token': key, 'Accept': 'application/json'}, timeout=15)
        response.raise_for_status()
        body = response.json()
        results = body.get('web', {}).get('results', [])
        if not isinstance(results, list) or any(not isinstance(item, dict) for item in results):
            raise ValueError('invalid search response')
        return [item for item in results if isinstance(item.get('url'), str) and urlsplit(item['url']).scheme == 'https']
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as error:
        raise DomainError('SEARCH_UNAVAILABLE', '外部检索失败，请检查配置、配额和网络后重试。', 502) from error


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items, self.current = [], None

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            attrs = dict(attrs)
            self.current = {'url': attrs.get('href', ''), 'title': attrs.get('title', ''), 'text': ''}

    def handle_data(self, text):
        if self.current is not None:
            self.current['text'] += text

    def handle_endtag(self, tag):
        if tag == 'a' and self.current is not None:
            self.current['title'] = self.current['title'] or self.current['text'].strip()
            self.items.append(self.current)
            self.current = None


def fetch_links(url, domains):
    for _ in range(4):
        url = public_url(url, domains)
        with httpx.stream('GET', url, timeout=15, follow_redirects=False, headers={'User-Agent': 'OpsClaw-NoticeMonitor/1.0'}) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get('location', ''))
                continue
            response.raise_for_status()
            if 'html' not in response.headers.get('content-type', '').lower():
                raise DomainError('NOTICE_CONTENT_TYPE', '监控地址需要 HTML 公告列表页。', 422)
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > 2 * 1024 * 1024:
                    raise DomainError('NOTICE_TOO_LARGE', '公告列表页超过 2 MB。', 422)
            parser = Links()
            parser.feed(bytes(content).decode(response.encoding or 'utf-8', errors='replace'))
            return [{'title': x['title'], 'url': urljoin(url, x['url'])} for x in parser.items
                    if x['url'].strip() and not x['url'].strip().startswith('#')
                    and urlsplit(urljoin(url, x['url'])).scheme == 'https']
    raise DomainError('NOTICE_REDIRECT', '公告页面重定向次数过多。', 422)


def monitor_one(identifier, *, force=False):
    now = datetime.now(timezone.utc)
    owner = secrets.token_hex(12)
    with store.transaction() as connection:
        factor = get(connection, 'factor', identifier)
        if factor['status'] != 'active':
            raise DomainError('FACTOR_NOT_ACTIVE', '请先审核并启用监控因子。', 409)
        due = factor.get('next_check_at')
        if due and datetime.fromisoformat(due) > now and not force:
            return {'factor_id': identifier, 'status': 'not_due', 'new_events': []}
        lease = factor.get('lease_until')
        if lease and datetime.fromisoformat(lease) > now:
            return {'factor_id': identifier, 'status': 'running', 'new_events': []}
        factor['lease_until'] = (now + timedelta(minutes=5)).isoformat()
        factor['lease_owner'] = owner
        put(connection, 'factor', factor)
    try:
        found = []
        if factor['urls']:
            for url in factor['urls']:
                found.extend(fetch_links(url, factor['allowed_domains']))
        else:
            # One request per rule avoids a burst per domain.
            sites = ' OR '.join('site:' + d for d in factor['allowed_domains'])
            found = brave_search(f'{factor["query"]} ({sites})')
        events = []
        with store.transaction() as connection:
            latest = get(connection, 'factor', identifier)
            if latest.get('lease_owner') != owner:
                return {'factor_id': identifier, 'status': 'superseded', 'new_events': []}
            if latest['status'] != 'active':
                latest.update(lease_until=None, lease_owner=None)
                put(connection, 'factor', latest)
                return {'factor_id': identifier, 'status': 'inactive', 'new_events': []}
            known = {e['id'] for e in records(connection, 'event')}
            for result in found[:200]:
                title = str(result.get('title', '')).strip()
                if title in {'招生', '研究生招生', '招生信息', '招生工作', '复试', '推免', '通知公告', '更多', '查看更多'}:
                    continue
                if not any(k in title for k in factor['keywords']):
                    continue
                try:
                    target_url = public_url(result.get('url', ''), factor['allowed_domains'])
                    if target_url.rstrip('/') in {u.rstrip('/') for u in factor['urls']}:
                        continue
                    event = save_event(connection, {'title': title, 'url': result['url'], 'school': factor['school'], 'college': factor['college'],
                                                    'factor_id': identifier, 'excerpt': result.get('description', '')}, discovered=True)
                    if event['id'] not in known:
                        events.append(event)
                        known.add(event['id'])
                except DomainError:
                    continue
            current = get(connection, 'factor', identifier)
            current.update(last_checked_at=store.now(), last_error=None, failure_count=0, lease_until=None, lease_owner=None,
                           next_check_at=(now + timedelta(seconds=current.get('interval_seconds', policy(connection)['monitor_interval_seconds']))).isoformat())
            put(connection, 'factor', current)
            store.audit(connection, 'growth.monitor', f'监控完成，发现 {len(events)} 个新事件。')
        return {'factor_id': identifier, 'status': 'completed', 'new_events': events}
    except (DomainError, httpx.HTTPError, ValueError, OSError) as error:
        message = error.message if isinstance(error, DomainError) else '公告来源暂时不可用，请检查网络或页面地址。'
        with store.transaction() as connection:
            current = get(connection, 'factor', identifier)
            if current.get('lease_owner') != owner:
                return {'factor_id': identifier, 'status': 'superseded', 'new_events': []}
            failures = current.get('failure_count', 0) + 1
            current.update(last_checked_at=store.now(), last_error=message, failure_count=failures, lease_until=None, lease_owner=None,
                           next_check_at=(now + timedelta(seconds=min(3600, 60 * 2 ** min(failures, 6)))).isoformat())
            put(connection, 'factor', current)
        raise DomainError('MONITOR_FAILED', message, 502) from error
