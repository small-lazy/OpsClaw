"""Order and on-platform signal analysis with explicit coverage and reviewable hypotheses."""
from __future__ import annotations

import hashlib
import json
import math
import secrets
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from .service import DomainError

ALIASES = {
    'order_id': ('order_id', '订单号', '订单编号', '主订单编号'),
    'paid_amount': ('paid_amount_minor', 'paid_amount', '实付金额', '实付款', '买家实付金额', '订单实付金额'),
    'refund_amount': ('refunded_amount_minor', 'refund_amount', '退款金额', '已退款金额'),
    'paid_at': ('paid_at', '支付时间', '付款时间', '订单支付时间'),
    'status': ('status', '订单状态', '订单当前状态'),
    'school': ('school', '品牌', '市场', '品牌名称', '市场名称', '学校', '院校', '学校名称'),
    'college': ('college', '品类', '客群', '品类名称', '客群名称', '学院', '学院名称'),
    'product': ('product', '产品', '商品名称', '商品标题', '商品'),
}
PAID = {'paid', 'completed', 'shipped', 'delivered', 'refunded', 'partially_refunded', '已付款', '已支付', '待发货', '待收货', '已发货', '交易成功', '已完成', '已退款', '部分退款', '退款成功'}
UNPAID = {'cancelled', 'canceled', 'unpaid', 'pending', 'closed', '已取消', '待付款', '未付款', '交易关闭', '已关闭'}
SIGNAL_TYPES = {'dm': 'dm', 'private_message': 'dm', '私信': 'dm', 'comment': 'comment', '评论': 'comment', 'like': 'like', '点赞': 'like', 'favorite': 'favorite', 'save': 'favorite', '收藏': 'favorite'}


def fail(code, message):
    raise DomainError(code, message, 422)


def initialize(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS growth_records(kind TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(kind,id))')


def _put(conn, kind, identifier, value):
    conn.execute('INSERT INTO growth_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document', (kind, identifier, json.dumps(value, ensure_ascii=False, allow_nan=False)))


def list_records(conn, kind):
    initialize(conn)
    return [json.loads(r[0]) for r in conn.execute('SELECT document FROM growth_records WHERE kind=? ORDER BY rowid DESC', (kind,))]


def _date(value):
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        fail('INVALID_GROWTH_DATE', '日期需为 YYYY-MM-DD。')


def _timestamp(value):
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace('Z', '+00:00').replace('/', '-'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone(timedelta(hours=8)))
        return parsed.astimezone(timezone(timedelta(hours=8))).isoformat()
    except (ValueError, TypeError):
        fail('INVALID_GROWTH_TIME', '订单和信号时间需为有效 ISO 日期时间；无时区时间按北京时间。')


def _text(value, default='未标注'):
    return str(value).strip()[:200] if value is not None and str(value).strip() else default


def _money(value, unit):
    try:
        parsed = Decimal(str(value).replace(',', '').replace('¥', '').replace('￥', '').strip())
        minor = parsed * 100 if unit == 'yuan' else parsed
        if not minor.is_finite() or minor < 0 or minor != minor.to_integral_value() or minor > 10**15:
            raise ValueError()
        return int(minor)
    except (InvalidOperation, ValueError, TypeError):
        fail('INVALID_GROWTH_AMOUNT', '金额需为非负数；元精确到分，分必须为整数。')


def _coverage_record(kind, source, start, end):
    if start is None and end is None:
        return None
    if start is None or end is None:
        fail('GROWTH_COVERAGE_REQUIRED', '覆盖声明需要同时提供起止日期。')
    first, last = _date(start), _date(end)
    if first > last:
        fail('INVALID_GROWTH_RANGE', '覆盖开始日期不能晚于结束日期。')
    identifier = hashlib.sha256(f'{kind}:{source}:{first}:{last}'.encode()).hexdigest()
    return identifier, {'id': identifier, 'kind': kind, 'source': source, 'start': first.isoformat(), 'end': last.isoformat()}


def _write_batch(conn, kind, records, coverage):
    initialize(conn)
    existing = {r[0] for r in conn.execute('SELECT id FROM growth_records WHERE kind=?', (kind,))}
    unique = {row['id']: row for row in records}
    conn.execute('SAVEPOINT growth_ingest')
    try:
        for identifier, record in unique.items():
            _put(conn, kind, identifier, record)
        if coverage:
            _put(conn, 'coverage', *coverage)
        conn.execute('RELEASE SAVEPOINT growth_ingest')
    except Exception:
        conn.execute('ROLLBACK TO SAVEPOINT growth_ingest')
        conn.execute('RELEASE SAVEPOINT growth_ingest')
        raise
    return {'imported': len(set(unique) - existing), 'updated': len(set(unique) & existing), 'total': len(existing | set(unique)), 'coverage': coverage[1] if coverage else None}


def ingest_orders(conn, rows, mapping=None, *, amount_unit='yuan', source='dataset', coverage_start=None, coverage_end=None):
    if amount_unit not in ('yuan', 'minor'):
        fail('GROWTH_AMOUNT_UNIT', '金额单位需明确为 yuan（元）或 minor（分）。')
    mapping = mapping or {}
    if not isinstance(mapping, dict) or set(mapping) - set(ALIASES) or any(not isinstance(v, str) or not v for v in mapping.values()):
        fail('GROWTH_MAPPING', '字段映射需使用标准字段名指向原始列名。')
    coverage = _coverage_record('order', source, coverage_start, coverage_end)
    records = []
    for row in rows:
        if not isinstance(row, dict):
            fail('GROWTH_ORDER_ROW', '订单记录需为对象。')
        currency = row.get('currency', row.get('币种', 'CNY'))
        if currency not in ('CNY', '人民币', 'RMB'):
            fail('GROWTH_CURRENCY', '当前分析要求订单金额统一为人民币 CNY。')
        def get(key, default=None):
            names = (mapping[key],) if key in mapping else ALIASES[key]
            field = next((name for name in names if name in row), None)
            return (row[field] if field is not None else default), field
        identifier, _ = get('order_id')
        if identifier is None or not str(identifier).strip():
            fail('GROWTH_ORDER_ID', '每条订单需要稳定的订单号。')
        status, _ = get('status')
        status = _text(status, '').lower()
        if status not in PAID | UNPAID:
            fail('GROWTH_ORDER_STATUS', f'无法识别订单状态 {status or "空值"}，请规范为 paid、refunded、unpaid 或 cancelled。')
        included = status in PAID
        paid, paid_field = get('paid_amount', 0)
        refund, refund_field = get('refund_amount', 0)
        if any(field and field.endswith('_minor') for field in (paid_field, refund_field)) and amount_unit != 'minor':
            fail('GROWTH_AMOUNT_UNIT', '使用 *_minor 字段时 amount_unit 必须为 minor。')
        paid_minor = _money(paid, amount_unit) if paid not in (None, '') else 0
        refund_minor = _money(refund, amount_unit) if refund not in (None, '') else 0
        if included and (paid_field is None or paid in (None, '')):
            fail('GROWTH_ORDER_AMOUNT_REQUIRED', '已支付订单缺少实付金额。')
        if status in {'refunded', '已退款', '退款成功', 'partially_refunded', '部分退款'} and (refund_field is None or refund in (None, '')):
            fail('GROWTH_REFUND_REQUIRED', '退款订单需明确退款金额。')
        if refund_minor > paid_minor:
            fail('GROWTH_REFUND_AMOUNT', '退款金额不能大于实付金额。')
        paid_at, _ = get('paid_at')
        if included and not paid_at:
            fail('GROWTH_ORDER_TIME', '已支付订单缺少支付时间。')
        records.append({'id': str(identifier).strip(), 'order_id': str(identifier).strip(), 'paid_at': _timestamp(paid_at) if paid_at else None, 'status': status, 'included': included, 'paid_amount_minor': paid_minor, 'refunded_amount_minor': refund_minor, 'net_gmv_minor': paid_minor - refund_minor if included else 0, 'school': _text(get('school')[0]), 'college': _text(get('college')[0]), 'product': _text(get('product')[0]), 'source': _text(source)})
    return _write_batch(conn, 'order', records, coverage)


def _signal_catalog(conn):
    """Read only existing approved-workspace catalogs; never create their tables."""
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    entries = []
    for table, clause in (('growth_assets', ''), ('growth_monitor', " WHERE kind='factor'")):
        if table not in tables:
            continue
        for row in conn.execute(f'SELECT document FROM {table}{clause}'):
            try:
                item = json.loads(row[0])
            except (ValueError, TypeError):
                continue
            if not isinstance(item, dict):
                continue
            school = item.get('school')
            college = item.get('college')
            terms = [item.get('product')] + (item.get('keywords') if isinstance(item.get('keywords'), list) else [])
            entries.append({'school': school.strip() if isinstance(school, str) else '',
                            'college': college.strip() if isinstance(college, str) else '',
                            'topics': {v.strip() for v in terms if isinstance(v, str) and v.strip()}})
    return entries


def _signal_labels(row, catalog):
    labels = {key: _text(row.get(key)) for key in ('school', 'college', 'topic')}
    text = '\n'.join(row[key] for key in ('text', 'body', 'content') if isinstance(row.get(key), str))
    if not text or not catalog:
        return labels
    school_hits = {item['school'] for item in catalog if item['school'] and item['school'] in text}
    explicit_school = labels['school'] != '未标注'
    ambiguous_school = not explicit_school and len(school_hits) > 1
    if not explicit_school and len(school_hits) == 1:
        labels['school'] = next(iter(school_hits))
    scoped = [item for item in catalog if labels['school'] == '未标注' or item['school'] == labels['school']]
    if labels['college'] == '未标注' and not ambiguous_school:
        colleges = {item['college'] for item in scoped if item['college'] and item['college'] in text}
        if len(colleges) == 1:
            labels['college'] = next(iter(colleges))
    if labels['topic'] == '未标注':
        topics = {term for item in scoped for term in item['topics'] if term in text}
        if topics:
            labels['topic'] = '、'.join(sorted(topics))[:200]
    return labels


def ingest_signals(conn, rows, *, source='platform', coverage_start=None, coverage_end=None):
    coverage = _coverage_record('signal', source, coverage_start, coverage_end)
    catalog = _signal_catalog(conn)
    records = []
    for row in rows:
        if not isinstance(row, dict) or not row.get('id'):
            fail('GROWTH_SIGNAL_ID', '每条信号需要稳定的 id，重复导入将按 id 更新。')
        kind = SIGNAL_TYPES.get(row.get('type'))
        if not kind:
            fail('GROWTH_SIGNAL_TYPE', '信号类型支持 dm、comment、like、favorite。')
        count = row.get('count', 1)
        try:
            parsed_count = Decimal(str(count))
            if isinstance(count, bool) or not parsed_count.is_finite() or parsed_count != parsed_count.to_integral_value() or not 0 <= parsed_count <= 10**9:
                raise ValueError()
            count = int(parsed_count)
        except (ValueError, InvalidOperation, TypeError):
            fail('GROWTH_SIGNAL_COUNT', '信号数量需为 0–1,000,000,000 的整数。')
        labels = _signal_labels(row, catalog)
        # Deliberate allowlist: body, message, author, user handles and contact details are never retained.
        records.append({'id': str(row['id']), 'type': kind, 'occurred_at': _timestamp(row.get('occurred_at')), 'school': labels['school'], 'college': labels['college'], 'topic': labels['topic'], 'count': count, 'source': _text(row.get('source', source))})
    return _write_batch(conn, 'signal', records, coverage)


def _previous(day):
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        return day.replace(year=day.year - 1, day=28)


def _covered(coverage, kind, start, end):
    cursor = start
    for item in sorted((v for v in coverage if v['kind'] == kind), key=lambda v: v['start']):
        first, last = _date(item['start']), _date(item['end'])
        if first > cursor:
            break
        if last >= cursor:
            if last >= end:
                return 'complete'
            cursor = last + timedelta(days=1)
    return 'incomplete'


def _metric(rows):
    return {'orders': len(rows), 'gmv_minor': sum(row['net_gmv_minor'] for row in rows)}


def _yoy(current, previous, complete):
    return {key: (current[key] - previous[key]) / previous[key] if complete and previous[key] != 0 else None for key in current}


def analyze(conn, start, end, *, anomaly_threshold=0.3, min_orders=5):
    first, last = _date(start), _date(end)
    if first > last or (last - first).days > 1095 or first.year < 2:
        fail('INVALID_GROWTH_RANGE', '分析窗口需为有效日期，最长 1,096 天。')
    if isinstance(anomaly_threshold, bool) or not isinstance(anomaly_threshold, (int, float)) or not math.isfinite(anomaly_threshold) or not 0 < anomaly_threshold <= 10 or isinstance(min_orders, bool) or not isinstance(min_orders, int) or min_orders < 1:
        fail('INVALID_GROWTH_THRESHOLD', '异常变化阈值需大于 0 且不超过 10，最小订单数需为正整数。')
    pfirst, plast = _previous(first), _previous(last)
    all_orders, all_signals, declared = list_records(conn, 'order'), list_records(conn, 'signal'), list_records(conn, 'coverage')
    def window(records, field, lo, hi):
        return [r for r in records if r.get(field) and lo <= _date(r[field][:10]) <= hi]
    orders = [r for r in all_orders if r['included']]
    current, previous = window(orders, 'paid_at', first, last), window(orders, 'paid_at', pfirst, plast)
    current_signals, previous_signals = window(all_signals, 'occurred_at', first, last), window(all_signals, 'occurred_at', pfirst, plast)
    coverage = {label: {'current': _covered(declared, kind, first, last), 'previous': _covered(declared, kind, pfirst, plast)} for label, kind in [('orders', 'order'), ('signals', 'signal')]}
    complete = all(v == 'complete' for v in coverage['orders'].values())
    signals_complete = all(v == 'complete' for v in coverage['signals'].values())
    groups, anomalies, candidates = {}, [], []
    report_id = 'growth-' + secrets.token_hex(12)
    signal_groups = []
    for signal_window in (current_signals, previous_signals):
        totals = defaultdict(int)
        for row in signal_window:
            totals[('school', row['school'])] += row['count']
            totals[('college', row['school'], row['college'])] += row['count']
        signal_groups.append(totals)
    for dimension in ('school', 'college', 'product'):
        grouped = []
        def group_key(row):
            # College names are only unique inside their parent school.
            return (row['school'], row['college']) if dimension == 'college' else (row[dimension],)
        current_groups, previous_groups = defaultdict(list), defaultdict(list)
        for row in current:
            current_groups[group_key(row)].append(row)
        for row in previous:
            previous_groups[group_key(row)].append(row)
        keys = sorted(set(current_groups) | set(previous_groups))
        for key in keys:
            a, b = current_groups[key], previous_groups[key]
            ma, mb = _metric(a), _metric(b)
            change = _yoy(ma, mb, complete)
            item = {'name': key[-1], 'school': key[0] if dimension == 'college' else None, 'current': ma, 'previous': mb, 'yoy': change, 'coverage': 'complete' if complete else 'incomplete', 'zero_baseline': {k: mb[k] == 0 for k in mb}}
            grouped.append(item)
            if complete and max(ma['orders'], mb['orders']) >= min_orders and any(value is not None and abs(value) >= anomaly_threshold for value in change.values()):
                evidence = {'dimension': dimension, **item}
                anomalies.append(evidence)
                ca = signal_groups[0][(dimension, *key)] if dimension != 'product' else 0
                cb = signal_groups[1][(dimension, *key)] if dimension != 'product' else 0
                signal_change = (ca - cb) / cb if signals_complete and cb and dimension != 'product' else None
                candidate_id = 'factor-' + secrets.token_hex(10)
                candidates.append({'id': candidate_id, 'report_id': report_id, 'status': 'pending_review', 'dimension': dimension, 'name': key[-1], 'school': item['school'], 'hypothesis': '站内关注变化可能与订单变化有关' if signal_change is not None else '订单变化原因需要补充证据', 'evidence': {'orders': evidence, 'signals_current': ca if dimension != 'product' else None, 'signals_previous': cb if dimension != 'product' else None, 'signals_yoy': signal_change}, 'causal_status': 'unconfirmed', 'next_steps': ['核对渠道覆盖、活动和价格变化', '对照商业活动节点与产品供给变化', '补充站内聚合信号并人工核验']})
        groups[dimension] = grouped
    counts = lambda records: {kind: sum(r['count'] for r in records if r['type'] == kind) for kind in ('dm', 'comment', 'like', 'favorite')}
    sc, sp = counts(current_signals), counts(previous_signals)
    trend = []
    daily = defaultdict(int)
    for row in current_signals:
        daily[row['occurred_at'][:10]] += row['count']
    day = first
    while day <= last:
        trend.append({'date': day.isoformat(), 'count': daily[day.isoformat()] if coverage['signals']['current'] == 'complete' else None, 'observed_count': daily[day.isoformat()]})
        day += timedelta(days=1)
    report = {'id': report_id, 'created_at': datetime.now(timezone.utc).isoformat(), 'start': first.isoformat(), 'end': last.isoformat(), 'previous_start': pfirst.isoformat(), 'previous_end': plast.isoformat(), 'timezone': 'Asia/Shanghai', 'currency': 'CNY', 'amount_unit': 'minor', 'coverage': coverage, 'summary': {'current': _metric(current), 'previous': _metric(previous), 'yoy': _yoy(_metric(current), _metric(previous), complete), 'zero_baseline': {key: value == 0 for key, value in _metric(previous).items()}}, 'groups': groups, 'signals': {'current': sum(sc.values()), 'previous': sum(sp.values()), 'by_type': {kind: {'current': sc[kind], 'previous': sp[kind], 'yoy': (sc[kind] - sp[kind]) / sp[kind] if signals_complete and sp[kind] else None} for kind in sc}, 'trend': trend}, 'anomalies': anomalies, 'candidates': candidates, 'settings': {'anomaly_threshold': anomaly_threshold, 'min_orders': min_orders}, 'limitations': ['覆盖不足时数值仅代表已观察记录，同比不可计算；无记录不能解释为零需求。', '零基线同比为未知；闰日映射到上一年的 2 月 28 日。', '订单按支付时间归属，退款按订单累计退款金额抵减，非退款发生期现金流。', '站内信号仅作相关线索，候选因子须人工核验，不确证因果。']}
    _put(conn, 'report', report_id, report)
    for candidate in candidates:
        _put(conn, 'candidate', candidate['id'], candidate)
    return report
