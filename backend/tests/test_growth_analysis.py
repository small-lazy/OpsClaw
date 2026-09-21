import json
import sqlite3

import pytest

from opsweaver import growth_analysis as growth
from opsweaver.service import DomainError


@pytest.fixture
def conn(tmp_path):
    with sqlite3.connect(tmp_path / 'growth.sqlite3') as connection:
        growth.initialize(connection)
        yield connection


def order(identifier, day, amount='100', **kwargs):
    return {'订单号': identifier, '支付时间': day, '实付金额': amount, '订单状态': '已完成', '学校': '甲大学', '学院': '商学院', '产品': '资料', **kwargs}


def test_order_aliases_refund_idempotency_and_cancelled(conn):
    records = [order('1', '2026-09-01', '120.50', 退款金额='20.50'), order('2', '', '300', 订单状态='已取消')]
    assert growth.ingest_orders(conn, records)['imported'] == 2
    assert growth.ingest_orders(conn, [order('1', '2026-09-01', '150', 退款金额='20')])['updated'] == 1
    report = growth.analyze(conn, '2026-09-01', '2026-09-07')
    assert report['summary']['current'] == {'orders': 1, 'gmv_minor': 13000}
    assert report['summary']['yoy']['orders'] is None
    assert report['coverage']['orders']['current'] == 'incomplete'
    assert report['anomalies'] == []
    assert len(growth.list_records(conn, 'report')) == 1


def test_calendar_yoy_and_school_scoped_college(conn):
    growth.ingest_orders(conn, [order('a', '2024-02-29', '200'), order('b', '2024-02-29', '100', 学校='乙大学')], coverage_start='2024-02-29', coverage_end='2024-02-29')
    growth.ingest_orders(conn, [order('c', '2023-02-28', '100')], coverage_start='2023-02-28', coverage_end='2023-02-28')
    report = growth.analyze(conn, '2024-02-29', '2024-02-29', min_orders=1)
    assert report['previous_start'] == report['previous_end'] == '2023-02-28'
    assert report['summary']['yoy'] == {'orders': 1.0, 'gmv_minor': 2.0}
    colleges = report['groups']['college']
    assert len(colleges) == 2
    assert {r['school'] for r in colleges} == {'甲大学', '乙大学'}
    new_group = next(r for r in colleges if r['school'] == '乙大学')
    assert new_group['yoy']['gmv_minor'] is None
    assert report['candidates']
    assert all(c['causal_status'] == 'unconfirmed' for c in growth.list_records(conn, 'candidate'))


def test_coverage_gaps_and_zero_baseline(conn):
    growth.ingest_orders(conn, [], coverage_start='2025-09-01', coverage_end='2025-09-07')
    growth.ingest_orders(conn, [order('x', '2026-09-02')], coverage_start='2026-09-01', coverage_end='2026-09-03')
    growth.ingest_orders(conn, [], coverage_start='2026-09-05', coverage_end='2026-09-07')
    report = growth.analyze(conn, '2026-09-01', '2026-09-07')
    assert report['coverage']['orders']['current'] == 'incomplete'
    growth.ingest_orders(conn, [], coverage_start='2026-09-04', coverage_end='2026-09-04')
    report = growth.analyze(conn, '2026-09-01', '2026-09-07')
    assert report['coverage']['orders']['current'] == 'complete'
    assert report['summary']['yoy']['gmv_minor'] is None
    assert report['summary']['zero_baseline']['gmv_minor']


def test_signals_privacy_trend_and_corroboration(conn):
    for year, amount, count in [(2025, '100', 2), (2026, '200', 4)]:
        day = f'{year}-09-01'
        growth.ingest_orders(conn, [order(str(year), day, amount)], coverage_start=day, coverage_end=day)
        growth.ingest_signals(conn, [{'id': str(year), 'type': '私信', 'occurred_at': day, 'school': '甲大学', 'college': '商学院', 'topic': '咨询', 'count': str(count), 'body': '不能保留的正文', 'user_id': '私人账号'}], coverage_start=day, coverage_end=day)
    stored = json.dumps(growth.list_records(conn, 'signal'), ensure_ascii=False)
    assert '不能保留' not in stored and '私人账号' not in stored and 'body' not in stored
    report = growth.analyze(conn, '2026-09-01', '2026-09-01', min_orders=1)
    assert report['signals']['by_type']['dm']['yoy'] == 1
    assert report['signals']['trend'][0]['count'] == 4
    candidate = next(c for c in report['candidates'] if c['dimension'] == 'school')
    assert candidate['evidence']['signals_yoy'] == 1
    assert candidate['status'] == 'pending_review'


def test_invalid_rows_are_atomic_and_units_are_explicit(conn):
    with pytest.raises(DomainError):
        growth.ingest_orders(conn, [order('good', '2026-09-01'), order('bad', '2026-09-01', '10', 退款金额='11')])
    assert growth.list_records(conn, 'order') == []
    row = {'order_id': 'minor', 'paid_at': '2026-09-01', 'paid_amount_minor': 1001, 'status': 'paid'}
    with pytest.raises(DomainError):
        growth.ingest_orders(conn, [row])
    growth.ingest_orders(conn, [row], amount_unit='minor')
    assert growth.list_records(conn, 'order')[0]['net_gmv_minor'] == 1001
    with pytest.raises(DomainError):
        growth.ingest_orders(conn, [order('bad', '2026-09-01', 订单状态='退款成功')])
    with pytest.raises(DomainError):
        growth.analyze(conn, '2026-09-01', '2026-09-07', anomaly_threshold=float('nan'))


def test_mapping_timezone_and_reopen(tmp_path):
    path = tmp_path / 'durable.sqlite3'
    with sqlite3.connect(path) as conn:
        growth.ingest_orders(conn, [{'custom_id': 'X', 'amount': 12, 'time': '2026-08-31T17:00:00Z', 'state': 'paid'}], mapping={'order_id': 'custom_id', 'paid_amount': 'amount', 'paid_at': 'time', 'status': 'state'})
        report = growth.analyze(conn, '2026-09-01', '2026-09-01')
        assert report['summary']['current']['orders'] == 1
    with sqlite3.connect(path) as conn:
        assert len(growth.list_records(conn, 'report')) == 1
        assert len(growth.list_records(conn, 'order')) == 1


def register_signal_catalog(conn):
    conn.execute('CREATE TABLE growth_assets(id TEXT PRIMARY KEY,document TEXT NOT NULL)')
    conn.execute('CREATE TABLE growth_monitor(kind TEXT,id TEXT,document TEXT NOT NULL,PRIMARY KEY(kind,id))')
    for identifier, school, college, product in [('a', '甲大学', '经济学院', '经济学资料'), ('b', '乙大学', '管理学院', '管理学资料'), ('c', '甲大学', '商学院', '商科资料')]:
        conn.execute('INSERT INTO growth_assets VALUES(?,?)', (identifier, json.dumps({'school': school, 'college': college, 'product': product}, ensure_ascii=False)))
    conn.execute('INSERT INTO growth_monitor VALUES(?,?,?)', ('factor', 'f1', json.dumps({'school': '丙大学', 'college': '金融学院', 'keywords': ['复试咨询']}, ensure_ascii=False)))


def test_signal_text_extracts_catalog_labels_without_retaining_body(conn):
    register_signal_catalog(conn)
    growth.ingest_signals(conn, [
        {'id': 'asset-hit', 'type': 'dm', 'occurred_at': '2026-09-21', 'body': '我是张某，手机号 13812345678，想了解甲大学经济学院的经济学资料', 'user_id': 'private-user'},
        {'id': 'factor-hit', 'type': 'comment', 'occurred_at': '2026-09-21', 'content': '丙大学金融学院复试咨询'},
    ])
    signals = {row['id']: row for row in growth.list_records(conn, 'signal')}
    assert (signals['asset-hit']['school'], signals['asset-hit']['college'], signals['asset-hit']['topic']) == ('甲大学', '经济学院', '经济学资料')
    assert (signals['factor-hit']['school'], signals['factor-hit']['college'], signals['factor-hit']['topic']) == ('丙大学', '金融学院', '复试咨询')
    document = json.dumps(signals, ensure_ascii=False)
    assert all(secret not in document for secret in ('张某', '13812345678', 'private-user', 'body', 'content'))


def test_signal_ambiguous_labels_and_explicit_labels_take_priority(conn):
    register_signal_catalog(conn)
    growth.ingest_signals(conn, [
        {'id': 'schools', 'type': 'dm', 'occurred_at': '2026-09-21', 'text': '比较甲大学经济学院和乙大学管理学院'},
        {'id': 'colleges', 'type': 'dm', 'occurred_at': '2026-09-21', 'text': '甲大学经济学院和商学院怎么样'},
        {'id': 'explicit', 'type': 'dm', 'occurred_at': '2026-09-21', 'school': '已核验学校', 'college': '已核验学院', 'topic': '已核验需求', 'text': '甲大学经济学院经济学资料 乙大学管理学院'},
    ])
    signals = {row['id']: row for row in growth.list_records(conn, 'signal')}
    assert (signals['schools']['school'], signals['schools']['college']) == ('未标注', '未标注')
    assert (signals['colleges']['school'], signals['colleges']['college']) == ('甲大学', '未标注')
    assert (signals['explicit']['school'], signals['explicit']['college'], signals['explicit']['topic']) == ('已核验学校', '已核验学院', '已核验需求')


def test_signal_text_without_catalog_does_not_create_asset_tables(conn):
    growth.ingest_signals(conn, [{'id': 'no-catalog', 'type': 'dm', 'occurred_at': '2026-09-21', 'text': '甲大学经济学院资料需求'}])
    row = growth.list_records(conn, 'signal')[0]
    assert (row['school'], row['college'], row['topic']) == ('未标注', '未标注', '未标注')
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert tables == {'growth_records'}
    assert 'text' not in row


def test_commercial_brand_market_category_audience_aliases(conn):
    growth.ingest_orders(conn, [
        {'订单号': 'BRAND-01', '支付时间': '2026-09-01', '实付金额': '120.50', '订单状态': '已完成', '品牌': '远山咖啡', '品类': '挂耳咖啡', '产品': '秋季组合'},
        {'订单号': 'MARKET-02', '支付时间': '2026-09-01', '实付金额': '80', '订单状态': '已完成', '市场': '华东市场', '客群': '办公室客群', '产品': '季度订阅'},
    ], amount_unit='yuan')
    report = growth.analyze(conn, '2026-09-01', '2026-09-01')
    assert report['summary']['current'] == {'orders': 2, 'gmv_minor': 20050}
    assert {row['name'] for row in report['groups']['school']} == {'远山咖啡', '华东市场'}
    assert {(row['school'], row['name']) for row in report['groups']['college']} == {('远山咖啡', '挂耳咖啡'), ('华东市场', '办公室客群')}
