"""Approved, idempotent growth actions and attribution-based lifecycle decisions.

Amounts are integer CNY minor units. Network execution owns its transactions;
other public operations accept the caller's SQLite connection.
"""
from __future__ import annotations

import json
import math
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlsplit

import httpx

from . import store
from .service import DomainError

KINDS = {'recharge', 'create_campaign', 'update_budget', 'update_roi', 'pause_campaign'}


def initialize(connection):
    for table in ('growth_assets', 'growth_actions'):
        connection.execute(f'CREATE TABLE IF NOT EXISTS {table}(id TEXT PRIMARY KEY, document TEXT NOT NULL)')


def _all(connection, table):
    return [json.loads(row[0]) for row in connection.execute(f'SELECT document FROM {table} ORDER BY rowid DESC')]


def _get(connection, table, key):
    row = connection.execute(f'SELECT document FROM {table} WHERE id=?', (key,)).fetchone()
    if not row:
        raise DomainError('GROWTH_NOT_FOUND', '没有找到该增长记录。', 404)
    return json.loads(row[0])


def _put(connection, table, item):
    connection.execute(f'INSERT INTO {table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document', (item['id'], json.dumps(item, ensure_ascii=False, allow_nan=False)))
    return item


def list_assets(connection):
    return _all(connection, 'growth_assets')


def list_actions(connection):
    return _all(connection, 'growth_actions')


def get_action(connection, action_id):
    return _get(connection, 'growth_actions', action_id)


def _text(value, name):
    if not isinstance(value, str) or not value.strip() or len(value) > 500:
        raise DomainError('INVALID_GROWTH_FIELD', f'{name} 需要 1–500 个字符。', 422)
    return value.strip()


def _number(value, name, minimum=0, maximum=1e12, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum or (integer and value != int(value)):
        raise DomainError('INVALID_GROWTH_NUMBER', f'{name} 超出允许范围。', 422)
    return int(value) if integer else value


def _date(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError) as error:
        raise DomainError('INVALID_GROWTH_DATE', '时间需要带时区的 ISO 8601 格式。', 422) from error


def register_asset(connection, payload):
    item = {field: _text(payload.get(field), field) for field in ('school', 'college', 'product', 'content_id')}
    item.update(id='asset-' + secrets.token_hex(12), created_at=store.now())
    existing = next((asset for asset in list_assets(connection) if all(asset[key] == item[key] for key in ('school', 'college', 'product', 'content_id'))), None)
    return existing or _put(connection, 'growth_assets', item)


def _hard_limit(name, default):
    try:
        value = int(os.environ.get(name, default))
        if value <= 0:
            raise ValueError()
        return value
    except ValueError as error:
        raise DomainError('INVALID_GROWTH_CONFIG', f'{name} 必须为正整数。', 503) from error


def _policy(value):
    if not isinstance(value, dict):
        raise DomainError('INVALID_LIFECYCLE_POLICY', '生命周期策略需要对象。', 422)
    for field in ('enabled', 'auto_execute'):
        if field in value and not isinstance(value[field], bool):
            raise DomainError('INVALID_LIFECYCLE_POLICY', f'{field} 需要布尔值。', 422)
    return {
        'enabled': value.get('enabled', True), 'auto_execute': value.get('auto_execute', False),
        **{f'day{day}_min_roi': _number(value.get(f'day{day}_min_roi', 1), 'ROI 阈值', 0, 1000) for day in (1, 2, 3)},
        'min_spend_minor': _number(value.get('min_spend_minor', 100), '最低观测消耗', 1, 10**12, True),
        'reduce_ratio': _number(value.get('reduce_ratio', .5), '预算保留比例', .01, .99),
        'minimum_budget_minor': _number(value.get('minimum_budget_minor', 100), '最低预算', 1, 10**12, True),
    }


def _history(action, operation, message):
    action['history'].append({'at': store.now(), 'operation': operation, 'message': message})
    action['updated_at'] = store.now()


def _signed(action):
    return {key: action[key] for key in ('id', 'version', 'kind', 'payload', 'opportunity', 'policy', 'parent_id')}


def _performance_hash(sample):
    return store.digest({key: value for key, value in sample.items() if key != 'received_at'})


def _new(connection, kind, payload, opportunity=None, policy=None, parent_id=None):
    action = {'id': 'growth-' + secrets.token_hex(12), 'version': 1, 'kind': kind, 'payload': payload,
              'opportunity': opportunity or {}, 'policy': policy or {}, 'parent_id': parent_id,
              'status': 'pending_approval', 'approval': None, 'performance': [], 'history': [], 'created_at': store.now()}
    action['hash'] = store.digest(_signed(action))
    action['idempotency_key'] = action['id'] + ':v1'
    _history(action, 'proposed', '已生成待人工审批的独立动作。')
    return _put(connection, 'growth_actions', action)


def propose(connection, event, parameters):
    kind = parameters.get('kind', 'create_campaign')
    if kind not in ('create_campaign', 'recharge'):
        raise DomainError('INVALID_GROWTH_KIND', '机会提案仅支持创建广告或独立充值。', 422)
    school, college = (_text(event.get(field), field) for field in ('school', 'college'))
    assets = [asset for asset in list_assets(connection) if asset['school'] == school and asset['college'] == college]
    if parameters.get('asset_id'):
        assets = [asset for asset in assets if asset['id'] == parameters['asset_id']]
    if len(assets) != 1:
        raise DomainError('CONTENT_ASSET_REQUIRED', '请为该品牌或市场及品类或客群选择唯一的已登记内容资产。', 422)
    asset = assets[0]
    count = _number(parameters.get('admissions_count'), '潜在人群规模', 1, 10**8, True)
    rate = _number(parameters.get('conversion_rate'), '历史转化率', 0, 1)
    price = _number(parameters.get('average_order_value_minor'), '客单价', 1, 10**10, True)
    cap = _number(parameters.get('budget_cap_minor'), '预算上限', 1, _hard_limit('GROWTH_MAX_BUDGET_MINOR', 1000000), True)
    roi = _number(parameters.get('target_roi'), '目标 ROI', .1, 1000)
    expected_gmv = int(count * rate * price)
    budget = min(cap, int(expected_gmv / roi))
    if budget < 1:
        raise DomainError('INSUFFICIENT_OPPORTUNITY', '预估收入不足以形成可投放预算。', 422)
    opportunity = {'event_id': event.get('id'), 'school': school, 'college': college,
                   'admissions_count': count, 'conversion_rate': rate, 'average_order_value_minor': price,
                   'expected_orders': count * rate, 'expected_gmv_minor': expected_gmv,
                   'budget_cap_minor': cap, 'target_roi': roi}
    payload = {'asset_id': asset['id'], 'content_id': asset['content_id'], 'product': asset['product'],
               'school': school, 'college': college, 'budget_minor': budget, 'target_roi': roi, 'currency': 'CNY'}
    policy = _policy(parameters.get('lifecycle_policy', {})) if kind == 'create_campaign' else {}
    if kind == 'recharge':
        amount = _number(parameters.get('amount_minor'), '独立充值金额', 1, _hard_limit('GROWTH_MAX_RECHARGE_MINOR', 1000000), True)
        if amount > cap:
            raise DomainError('RECHARGE_CAP_EXCEEDED', '充值金额超过已声明预算上限。', 422)
        payload = {'amount_minor': amount, 'currency': 'CNY', 'asset_id': asset['id']}
    return _new(connection, kind, payload, opportunity, policy)


def propose_adjustment(connection, campaign_action_id, parameters):
    campaign = get_action(connection, campaign_action_id)
    if campaign['kind'] != 'create_campaign' or campaign['status'] != 'succeeded':
        raise DomainError('CAMPAIGN_NOT_ACTIVE', '需要已成功创建的广告记录。', 409)
    kind = parameters.get('kind')
    if kind not in ('update_budget', 'update_roi', 'pause_campaign'):
        raise DomainError('INVALID_GROWTH_KIND', '调整仅支持预算、ROI 或停投。', 422)
    body = {'campaign_id': campaign['campaign_id']}
    if kind == 'update_budget':
        body['budget_minor'] = _number(parameters.get('budget_minor'), '预算', 1, min(campaign['opportunity']['budget_cap_minor'], _hard_limit('GROWTH_MAX_BUDGET_MINOR', 1000000)), True)
    if kind == 'update_roi':
        body['target_roi'] = _number(parameters.get('target_roi'), '目标 ROI', .1, 1000)
    return _new(connection, kind, body, campaign['opportunity'], parent_id=campaign_action_id)


def decide(connection, action_id, payload):
    action = get_action(connection, action_id)
    if payload.get('hash') != action['hash'] or action['hash'] != store.digest(_signed(action)):
        raise DomainError('GROWTH_APPROVAL_STALE', '方案版本已变化，请重新审阅。', 409)
    decision = payload.get('decision')
    if decision not in ('approve', 'reject'):
        raise DomainError('INVALID_GROWTH_DECISION', '审批决定需要 approve 或 reject。', 422)
    if action['status'] != 'pending_approval':
        if action.get('approval', {}).get('decision') == decision:
            return action
        raise DomainError('GROWTH_ALREADY_DECIDED', '该方案已审批，不能改变决定。', 409)
    action['approval'] = {'decision': decision, 'hash': action['hash'], 'at': store.now(), 'by': 'workspace-owner'}
    action['status'] = 'approved' if decision == 'approve' else 'rejected'
    _history(action, decision, '人工批准动作。' if decision == 'approve' else '人工拒绝动作。')
    return _put(connection, 'growth_actions', action)


def _configuration():
    url, token = os.environ.get('GROWTH_ADS_BASE_URL', '').rstrip('/'), os.environ.get('GROWTH_ADS_TOKEN', '')
    parts = urlsplit(url)
    if not url or not token or parts.scheme not in ('http', 'https') or not parts.netloc or parts.username or parts.password or parts.query or parts.fragment:
        raise DomainError('ADS_NOT_CONFIGURED', '请配置有效的 GROWTH_ADS_BASE_URL 和 GROWTH_ADS_TOKEN。', 503)
    return url, token


def _execution_checks(connection, action):
    settings = store.meta(connection, 'settings') or {}
    growth_policy = store.meta(connection, 'growth_policy') or {}
    if settings.get('kill_switch') or settings.get('growth_kill_switch') or growth_policy.get('kill_switch'):
        raise DomainError('GROWTH_KILL_SWITCH', '增长动作执行已停止。', 409)
    approval = action.get('approval') or {}
    if approval.get('decision') != 'approve' or approval.get('hash') != action['hash'] or store.digest(_signed(action)) != action['hash']:
        raise DomainError('GROWTH_APPROVAL_REQUIRED', '执行前必须批准当前版本。', 403)
    payload = action['payload']
    if action['kind'] == 'recharge':
        _number(payload.get('amount_minor'), '充值金额', 1, _hard_limit('GROWTH_MAX_RECHARGE_MINOR', 1000000), True)
    if 'budget_minor' in payload:
        _number(payload['budget_minor'], '预算', 1, min(_hard_limit('GROWTH_MAX_BUDGET_MINOR', 1000000), action['opportunity'].get('budget_cap_minor', 1000000)), True)
    if 'target_roi' in payload:
        _number(payload['target_roi'], '目标 ROI', .1, 1000)
    if action.get('parent_id'):
        parent = get_action(connection, action['parent_id'])
        if parent['status'] != 'succeeded' or payload.get('campaign_id') != parent.get('campaign_id'):
            raise DomainError('CAMPAIGN_NOT_ACTIVE', '广告关联信息已变化。', 409)
        paused = any(item.get('parent_id') == parent['id'] and item['kind'] == 'pause_campaign' and item['status'] == 'succeeded' for item in list_actions(connection))
        if paused:
            raise DomainError('CAMPAIGN_PAUSED', '广告已停投，不能继续执行旧调整方案。', 409)
        day = action['opportunity'].get('lifecycle_day')
        if day:
            sample = next((s for s in parent['performance'] if s['day'] == day), None)
            if not sample or _performance_hash(sample) != action['opportunity'].get('performance_hash'):
                raise DomainError('STALE_LIFECYCLE_EVIDENCE', '绩效数据已更新，请重新审阅该调整。', 409)


def _receipt(action, result):
    if not isinstance(result, dict) or any(result.get(k) != action[k] for k in ('idempotency_key', 'kind', 'payload')):
        raise ValueError('广告服务回执与批准动作不匹配。')
    if result.get('status') not in ('succeeded', 'failed', 'pending'):
        raise ValueError('广告服务返回了未知状态。')
    if result['status'] == 'succeeded' and action['kind'] == 'create_campaign' and (not isinstance(result.get('campaign_id'), str) or not result['campaign_id'].strip()):
        raise ValueError('广告服务未返回 campaign_id。')
    return result


def _perform(action_id, read_only):
    # Claim and persist before the remote side effect; a crash can only lead to a readback.
    with store.transaction() as connection:
        action = get_action(connection, action_id)
        if action['status'] in ('succeeded', 'failed'):
            return action
        if read_only:
            if action['status'] not in ('running', 'unknown'):
                raise DomainError('RECONCILE_NOT_NEEDED', '只有已发送且待核对的动作可以回读。', 409)
        else:
            if action['status'] in ('running', 'unknown'):
                raise DomainError('GROWTH_RECONCILE_REQUIRED', '该动作已发送，必须回读核对，不能重复提交。', 409)
            _execution_checks(connection, action)
            if action['status'] not in ('approved', 'blocked_configuration'):
                raise DomainError('GROWTH_NOT_EXECUTABLE', '该动作当前状态不能执行。', 409)
        try:
            url, token = _configuration()
        except DomainError as error:
            action['last_error'] = error.code
            if not read_only:
                action['status'] = 'blocked_configuration'
            _history(action, 'blocked', error.message)
            _put(connection, 'growth_actions', action)
            return action
        if not read_only:
            action['status'] = 'running'
            action['sent_at'] = store.now()
            _history(action, 'sent', '动作已持久化，开始提交广告服务。')
            _put(connection, 'growth_actions', action)
    try:
        with httpx.Client(timeout=15, trust_env=False, follow_redirects=False) as client:
            headers = {'Authorization': 'Bearer ' + token}
            if read_only:
                response = client.get(url + '/actions/' + quote(action['idempotency_key'], safe=''), headers=headers)
            else:
                response = client.post(url + '/actions', headers=headers, json={key: action[key] for key in ('kind', 'idempotency_key', 'payload')})
            response.raise_for_status()
            result = _receipt(action, response.json())
        error = None
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        result = None
        # Do not persist request headers, token, or an untrusted response body.
        error = '广告服务请求或回执未确认：' + type(exc).__name__
    with store.transaction() as connection:
        current = get_action(connection, action_id)
        # A concurrent successful readback is authoritative over a late timeout.
        if current['status'] in ('succeeded', 'failed'):
            return current
        current['status'] = result['status'] if result and result['status'] != 'pending' else 'unknown'
        if result:
            current['receipt'] = result
        current['last_error'] = error
        if current['status'] == 'succeeded':
            current['succeeded_at'] = store.now()
            if current['kind'] == 'create_campaign':
                current['campaign_id'] = result['campaign_id']
                current['campaign_started_at'] = store.now()
        _history(current, 'reconciled' if read_only else 'receipt', error or '广告服务已返回匹配回执：' + current['status'])
        return _put(connection, 'growth_actions', current)


def execute(action_id):
    return _perform(action_id, False)


def reconcile(action_id):
    return _perform(action_id, True)


def fetch_performance(action_id):
    with store.connect() as connection:
        action = get_action(connection, action_id)
    if action['kind'] != 'create_campaign' or action['status'] != 'succeeded' or not action.get('campaign_id'):
        raise DomainError('CAMPAIGN_NOT_ACTIVE', '只有广告服务确认创建的广告可以回读绩效。', 409)
    url, token = _configuration()
    try:
        with httpx.Client(timeout=15, trust_env=False, follow_redirects=False) as client:
            response = client.get(url + '/campaigns/' + quote(action['campaign_id'], safe='') + '/performance', headers={'Authorization': 'Bearer ' + token})
            response.raise_for_status()
            sample = response.json()
        if not isinstance(sample, dict) or sample.get('campaign_id', action['campaign_id']) != action['campaign_id']:
            raise ValueError('广告绩效关联不匹配。')
    except (httpx.HTTPError, ValueError, TypeError) as error:
        raise DomainError('ADS_PERFORMANCE_UNAVAILABLE', '广告服务绩效回读未成功，请稍后重试。', 502) from error
    with store.transaction() as connection:
        return ingest_performance(connection, action_id, sample)


def ingest_performance(connection, action_id, payload):
    action = get_action(connection, action_id)
    if action['kind'] != 'create_campaign' or action['status'] != 'succeeded':
        raise DomainError('CAMPAIGN_NOT_ACTIVE', '绩效记录需要已成功创建的广告。', 409)
    day = _number(payload.get('day'), '生命周期天数', 1, 3, True)
    start, end = _date(payload.get('window_start')), _date(payload.get('window_end'))
    if end <= start or end > datetime.now(timezone.utc):
        raise DomainError('INVALID_PERFORMANCE_WINDOW', '绩效窗口结束时间需晚于开始且不能晚于当前时间。', 422)
    if not isinstance(payload.get('attribution_complete'), bool):
        raise DomainError('INVALID_ATTRIBUTION', '需明确提供 attribution_complete。', 422)
    sample = {'day': day, 'spend_minor': _number(payload.get('spend_minor'), '广告消耗', 0, 10**12, True),
              'attributed_gmv_minor': _number(payload.get('attributed_gmv_minor'), '归因 GMV', 0, 10**12, True),
              'window_start': start.isoformat(), 'window_end': end.isoformat(),
              'attribution_complete': payload['attribution_complete'], 'received_at': store.now()}
    sample['roi'] = sample['attributed_gmv_minor'] / sample['spend_minor'] if sample['spend_minor'] else None
    existing = next((s for s in action['performance'] if s['day'] == day), None)
    if existing and _date(existing['window_end']) > end:
        raise DomainError('STALE_PERFORMANCE', '不能用更早的绩效窗口覆盖当前数据。', 409)
    if existing and _performance_hash(existing) == _performance_hash(sample):
        return action
    action['performance'] = [s for s in action['performance'] if s['day'] != day] + [sample]
    _history(action, 'performance', f'更新第 {day} 天归因绩效。')
    return _put(connection, 'growth_actions', action)


def evaluate_lifecycle(connection, action_id, policy=None):
    action = get_action(connection, action_id)
    if action['kind'] != 'create_campaign' or action['status'] != 'succeeded':
        raise DomainError('CAMPAIGN_NOT_ACTIVE', '仅可评估成功创建的广告。', 409)
    original = action.get('policy') or _policy({})
    chosen = _policy(policy) if policy is not None else original
    if not chosen.get('enabled'):
        return {'status': 'disabled', 'message': '生命周期策略未启用。'}
    started = _date(action['campaign_started_at'])
    eligible = [s for s in action['performance'] if s['attribution_complete'] and s['spend_minor'] >= chosen['min_spend_minor'] and _date(s['window_start']) <= started and _date(s['window_end']) >= started + timedelta(days=s['day'])]
    if not eligible:
        return {'status': 'waiting_data', 'message': '归因窗口或消耗尚未成熟，不作投放判断。'}
    sample = max(eligible, key=lambda s: s['day'])
    day, roi = sample['day'], sample['roi']
    threshold = chosen[f'day{day}_min_roi']
    if roi >= threshold:
        return {'status': 'healthy', 'message': f'第 {day} 天 ROI 达到策略阈值。', 'roi': roi, 'threshold': threshold}
    children = [a for a in list_actions(connection) if a.get('parent_id') == action_id]
    if any(a['kind'] == 'pause_campaign' and a['status'] == 'succeeded' for a in children):
        return {'status': 'paused', 'message': '广告已经停止。'}
    existing = next((a for a in children if a.get('opportunity', {}).get('lifecycle_day') == day and a['status'] != 'superseded'), None)
    if existing:
        if existing['status'] in ('running', 'unknown', 'succeeded', 'failed') or existing['opportunity'].get('performance_hash') == _performance_hash(sample):
            return {'status': existing['status'], 'message': '该观察日已有处理方案。', 'action': existing}
        existing['status'] = 'superseded'
        _history(existing, 'superseded', '归因数据更新，原调整方案已失效。')
        _put(connection, 'growth_actions', existing)
    active_budgets = [a for a in children if a['kind'] == 'update_budget' and a['status'] == 'succeeded']
    current_budget = max(active_budgets, key=lambda a: a['succeeded_at'])['payload']['budget_minor'] if active_budgets else action['payload']['budget_minor']
    reduced = int(current_budget * chosen['reduce_ratio'])
    kind = 'pause_campaign' if day == 3 or reduced < chosen['minimum_budget_minor'] else 'update_budget'
    body = {'campaign_id': action['campaign_id']}
    if kind == 'update_budget':
        body['budget_minor'] = reduced
    opportunity = {**action['opportunity'], 'lifecycle_day': day, 'observed_roi': roi, 'threshold': threshold, 'performance_hash': _performance_hash(sample)}
    child = _new(connection, kind, body, opportunity, parent_id=action_id)
    # Only the exact policy in the approved campaign proposal can preauthorize automatic action.
    if original.get('auto_execute') and chosen == original and action.get('approval', {}).get('hash') == action['hash'] and store.digest(_signed(action)) == action['hash']:
        child['status'] = 'approved'
        child['approval'] = {'decision': 'approve', 'hash': child['hash'], 'at': store.now(), 'by': 'preauthorized-policy', 'parent_id': action_id}
        _history(child, 'policy_approved', '依据创建广告时人工批准的生命周期策略授权。')
        _put(connection, 'growth_actions', child)
    return {'status': child['status'], 'message': 'ROI 低于阈值，已生成减预算或停投动作。', 'action': child}
