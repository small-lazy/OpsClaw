"""Growth workspace API; remote collectors use a separate bearer credential."""
from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from . import store, growth_analysis as analysis, growth_actions as actions, growth_monitor as monitor
from .service import DomainError


def initialize(connection):
    analysis.initialize(connection)
    actions.initialize(connection)
    monitor.initialize(connection)


def latest_analysis(connection, start=None, end=None):
    p = monitor.policy(connection)
    orders = analysis.list_records(connection, 'order')
    dates = [o['paid_at'][:10] for o in orders if o.get('paid_at')]
    end = end or (max(dates) if dates else datetime.now(timezone(timedelta(hours=8))).date().isoformat())
    try:
        start = start or (datetime.fromisoformat(end).date() - timedelta(days=p['analysis_days'] - 1)).isoformat()
    except (TypeError, ValueError) as error:
        raise DomainError('INVALID_ANALYSIS_DATE', '请填写有效分析日期。', 422) from error
    return analysis.analyze(connection, start, end, anomaly_threshold=p['anomaly_threshold'], min_orders=p['min_orders'])


def discover_report(report):
    """Search only school-level aggregate hints, never private source rows."""
    if not report['anomalies'] or not os.getenv('BRAVE_SEARCH_API_KEY'):
        return report
    evidence, errors = [], []
    schools = list(dict.fromkeys(c['school'] for c in report['candidates'] if c.get('school') and c['school'] != '未标注'))[:5]
    for school in schools:
        try:
            for result in monitor.brave_search(f'{school} 新品 促销 补货 节日 商业公告')[:5]:
                evidence.append({'school': school, 'title': str(result.get('title', ''))[:500], 'url': result.get('url', ''),
                                 'excerpt': str(result.get('description', ''))[:1500], 'retrieved_at': store.now(), 'status': 'unverified'})
        except DomainError as error:
            errors.append(error.message)
    report['external_evidence'], report['search_errors'] = evidence, errors
    with store.transaction() as connection:
        connection.execute("UPDATE growth_records SET document=? WHERE kind='report' AND id=?", (json.dumps(report, ensure_ascii=False), report['id']))
    return report


def create_router(session):
    router = APIRouter(prefix='/api/v1/growth', tags=['Growth'])

    def collector_auth(request: Request):
        authorization = request.headers.get('authorization')
        if authorization:
            token = os.getenv('GROWTH_COLLECTOR_TOKEN', '')
            if not token or not secrets.compare_digest(authorization, 'Bearer ' + token):
                raise DomainError('COLLECTOR_UNAUTHORIZED', '采集凭据无效。', 401)
        else:
            session(request)

    @router.get('/overview', dependencies=[Depends(session)])
    def overview():
        from .growth_collector import get_status
        collector_status = get_status()
        with store.connect() as connection:
            count = lambda kind: connection.execute('SELECT COUNT(*) FROM growth_records WHERE kind=?', (kind,)).fetchone()[0]
            coverage = analysis.list_records(connection, 'coverage')
            return {'data': {'config': monitor.configuration(connection), 'policy': monitor.policy(connection),
                             'orders': {'total': count('order'), 'coverage': [c for c in coverage if c['kind'] == 'order']},
                             'signals': {'total': count('signal'), 'coverage': [c for c in coverage if c['kind'] == 'signal']},
                             'reports': analysis.list_records(connection, 'report')[:30], 'candidates': analysis.list_records(connection, 'candidate')[:100],
                             'factors': monitor.records(connection, 'factor'), 'events': monitor.records(connection, 'event')[:300],
                             'assets': actions.list_assets(connection), 'actions': actions.list_actions(connection),
                             'worker': store.meta(connection, 'growth_worker_status'), 'collector': collector_status}}

    @router.get('/config', dependencies=[Depends(session)])
    def config():
        with store.connect() as connection:
            return {'data': {'config': monitor.configuration(connection), 'policy': monitor.policy(connection)}}

    @router.put('/config', dependencies=[Depends(session)])
    def configure(body: dict):
        value = body.get('policy', body)
        if not isinstance(value, dict):
            raise DomainError('INVALID_POLICY', '策略需要 JSON 对象。', 422)
        with store.transaction() as connection:
            return {'data': monitor.update_policy(connection, value)}

    @router.post('/orders/bind', dependencies=[Depends(session)])
    def bind(body: dict):
        identifier = body.get('dataset_id')
        with store.transaction() as connection:
            if not isinstance(identifier, str) or not store.get(connection, 'datasets', identifier):
                raise DomainError('DATASET_NOT_FOUND', '请选择已导入的数据集。', 404)
            rows = [json.loads(r[0]) for r in connection.execute('SELECT document FROM dataset_rows WHERE dataset_id=? ORDER BY row_index', (identifier,))]
            result = analysis.ingest_orders(connection, rows, body.get('mapping'), amount_unit=body.get('amount_unit', 'yuan'), source=identifier,
                                             coverage_start=body.get('coverage_start'), coverage_end=body.get('coverage_end'))
            report = latest_analysis(connection, body.get('start'), body.get('end'))
            store.audit(connection, 'growth.orders', '订单数据已接入并完成分析。')
        result['report'] = discover_report(report)
        return {'data': result}

    @router.post('/orders', dependencies=[Depends(collector_auth)])
    def ingest_orders(body: dict):
        if not isinstance(body.get('orders'), list) or len(body['orders']) > 100000:
            raise DomainError('INVALID_ORDERS', 'orders 需要最多 100000 条记录的数组。', 422)
        with store.transaction() as connection:
            result = analysis.ingest_orders(connection, body.get('orders', []), body.get('mapping'), amount_unit=body.get('amount_unit', 'yuan'),
                                             source='order-api', coverage_start=body.get('coverage_start'), coverage_end=body.get('coverage_end'))
            report = latest_analysis(connection, body.get('start'), body.get('end'))
            store.audit(connection, 'growth.orders', '订单接口完成增量接入。')
        return {'data': result | {'report': discover_report(report)}}

    @router.post('/collect', dependencies=[Depends(collector_auth)])
    def collect(body: dict):
        if not isinstance(body.get('signals'), list) or len(body['signals']) > 50000:
            raise DomainError('INVALID_SIGNALS', 'signals 需要最多 50000 条记录的数组。', 422)
        with store.transaction() as connection:
            result = analysis.ingest_signals(connection, body.get('signals', []), source='webhook',
                                              coverage_start=body.get('coverage_start'), coverage_end=body.get('coverage_end'))
            store.audit(connection, 'growth.collect', '行为信号已接入。')
        return {'data': result}

    @router.post('/reports', dependencies=[Depends(session)])
    def reports(body: dict):
        with store.transaction() as connection:
            p = monitor.policy(connection)
            report = analysis.analyze(connection, body.get('start'), body.get('end'),
                                      anomaly_threshold=body.get('anomaly_threshold', p['anomaly_threshold']), min_orders=body.get('min_orders', p['min_orders']))
            store.audit(connection, 'growth.analyze', '生成订单同比与异常分析。')
        return {'data': discover_report(report)}

    @router.post('/factors', dependencies=[Depends(session)])
    def factor(body: dict):
        with store.transaction() as connection:
            return {'data': monitor.save_factor(connection, body)}

    @router.post('/factors/{identifier}/review', dependencies=[Depends(session)])
    def factor_review(identifier: str, body: dict):
        with store.transaction() as connection:
            return {'data': monitor.review(connection, 'factor', identifier, body.get('decision'))}

    @router.post('/events', dependencies=[Depends(session)])
    def event(body: dict):
        with store.transaction() as connection:
            return {'data': monitor.save_event(connection, body)}

    @router.post('/events/{identifier}/review', dependencies=[Depends(session)])
    def event_review(identifier: str, body: dict):
        with store.transaction() as connection:
            return {'data': monitor.review(connection, 'event', identifier, body.get('decision'))}

    @router.post('/monitor', dependencies=[Depends(session)])
    def poll(body: dict):
        with store.connect() as connection:
            ids = [body['factor_id']] if body.get('factor_id') else [f['id'] for f in monitor.records(connection, 'factor') if f['status'] == 'active'][:20]
        return {'data': [monitor.monitor_one(identifier, force=True) for identifier in ids]}

    @router.post('/assets', dependencies=[Depends(session)])
    def asset(body: dict):
        with store.transaction() as connection:
            return {'data': actions.register_asset(connection, body)}

    @router.post('/proposals', dependencies=[Depends(session)])
    def proposal(body: dict):
        parameters = body.get('parameters', {})
        if not isinstance(parameters, dict):
            raise DomainError('INVALID_PARAMETERS', '机会参数需要 JSON 对象。', 422)
        with store.transaction() as connection:
            e = monitor.get(connection, 'event', body.get('event_id', ''))
            if e['status'] != 'approved':
                raise DomainError('EVENT_REVIEW_REQUIRED', '请先核验并批准事件，再创建投放方案。', 409)
            return {'data': actions.propose(connection, e, parameters)}

    @router.post('/actions/{identifier}/review', dependencies=[Depends(session)])
    def review_action(identifier: str, body: dict):
        with store.transaction() as connection:
            return {'data': actions.decide(connection, identifier, body)}

    @router.post('/actions/{identifier}/execute', dependencies=[Depends(session)])
    def execute(identifier: str):
        return {'data': actions.execute(identifier)}

    @router.post('/actions/{identifier}/reconcile', dependencies=[Depends(session)])
    def reconcile(identifier: str):
        return {'data': actions.reconcile(identifier)}

    @router.post('/actions/{identifier}/adjust', dependencies=[Depends(session)])
    def adjust(identifier: str, body: dict):
        with store.transaction() as connection:
            return {'data': actions.propose_adjustment(connection, identifier, body)}

    @router.post('/actions/{identifier}/performance', dependencies=[Depends(collector_auth)])
    def performance(identifier: str, body: dict):
        with store.transaction() as connection:
            return {'data': actions.ingest_performance(connection, identifier, body)}

    @router.post('/actions/{identifier}/lifecycle', dependencies=[Depends(session)])
    def lifecycle(identifier: str):
        with store.transaction() as connection:
            return {'data': actions.evaluate_lifecycle(connection, identifier)}

    return router
