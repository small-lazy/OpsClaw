import asyncio
import json

import pytest

from opsweaver import agent_runtime as runtime, model_providers, store
from opsweaver.service import DomainError


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'agents.sqlite3')
    with store.transaction() as connection:
        runtime.initialize(connection)
        model_providers.save_provider(connection, {'id': 'provider-test', 'name': '测试连接', 'base_url': 'http://localhost:11434/v1', 'model': 'test-model'})
        connection.execute('CREATE TABLE datasets(id TEXT PRIMARY KEY, document TEXT NOT NULL)')
        connection.execute('CREATE TABLE dataset_rows(dataset_id TEXT,row_index INTEGER,document TEXT)')
        connection.execute('CREATE TABLE growth_records(kind TEXT,id TEXT,document TEXT)')
        connection.execute('CREATE TABLE growth_monitor(kind TEXT,id TEXT,document TEXT,PRIMARY KEY(kind,id))')
        connection.execute('CREATE TABLE audit(id TEXT PRIMARY KEY,document TEXT)')
        for key, value in [('selected', 'visible record'), ('private', 'SECRET UNSELECTED RECORD')]:
            store.put(connection, 'datasets', {'id': key, 'name': key, 'row_count': 1, 'columns': ['value'], 'analysis': {'summary': value}})
            connection.execute('INSERT INTO dataset_rows VALUES(?,?,?)', (key, 0, json.dumps({'value': value})))
    return tmp_path


def agent(tools=None):
    with store.transaction() as connection:
        return runtime.save_agent(connection, {'name': '分析助手', 'description': '业务分析', 'instructions': '根据明确授权的数据分析。',
            'provider_id': 'provider-test', 'tools': tools or ['dataset_list', 'dataset_summary', 'dataset_rows'], 'status': 'active'})


def call(name, arguments=None):
    return {'id': 'call-1', 'name': name, 'arguments': arguments or {}}


def test_templates_crud_and_deleted_templates_do_not_reappear(workspace):
    with store.transaction() as connection:
        templates = runtime.list_agents(connection)
        assert len(templates) == 6 and all(t['status'] == 'paused' for t in templates)
        changed = runtime.save_agent(connection, {**templates[0], 'name': '我的运营助手'})
        runtime.delete_agent(connection, templates[1]['id'])
        runtime.initialize(connection)
        current = runtime.list_agents(connection)
        assert len(current) == 5
        assert next(t for t in current if t['id'] == changed['id'])['name'] == '我的运营助手'
        with pytest.raises(DomainError) as error:
            runtime.save_agent(connection, {**changed, 'tools': ['execute_advertisement']})
        assert error.value.code == 'AI_TOOL_FORBIDDEN'


def test_real_tool_loop_scopes_data_and_releases_db_before_model_request(workspace, monkeypatch):
    configured = agent()
    requests = []
    async def complete(provider_id, messages, tools=None):
        # A write during model invocation proves no runtime transaction spans this await.
        with store.transaction() as connection:
            store.set_meta(connection, 'provider_called', True)
        requests.append(json.loads(json.dumps(messages)))
        if len(requests) == 1:
            return {'content': '', 'tool_calls': [call('dataset_rows', {'dataset_id': 'selected', 'limit': 1})], 'usage': {'input_tokens': 3, 'output_tokens': 2}}
        assert 'visible record' in messages[-1]['content']
        assert 'SECRET UNSELECTED RECORD' not in json.dumps(messages)
        return {'content': '已核对 1 条授权记录。', 'tool_calls': [], 'usage': {'input_tokens': 5, 'output_tokens': 4}}
    monkeypatch.setattr(model_providers, 'complete', complete)
    queued = runtime.prepare_run(configured['id'], '检查文件', ['selected'])
    assert queued['status'] == 'queued'
    result = asyncio.run(runtime.run_agent(configured['id'], '检查文件', ['selected'], queued['id']))
    assert result['status'] == 'completed' and len(result['trace']) == 3
    assert result['usage'] == {'input_tokens': 8, 'output_tokens': 6}
    assert asyncio.run(runtime.run_agent(configured['id'], '检查文件', ['selected'], queued['id'])) == result
    assert len(requests) == 2


def test_no_selection_never_lists_all_datasets(workspace, monkeypatch):
    configured = agent()
    responses = []
    async def complete(provider_id, messages, tools=None):
        if not responses:
            responses.append(True)
            return {'content': '', 'tool_calls': [call('dataset_list')]}
        assert json.loads(messages[-1]['content'])['data'] == []
        assert 'SECRET UNSELECTED RECORD' not in json.dumps(messages)
        return {'content': '请先选择文件。', 'tool_calls': []}
    monkeypatch.setattr(model_providers, 'complete', complete)
    assert asyncio.run(runtime.run_agent(configured['id'], '看看数据'))['status'] == 'completed'


@pytest.mark.parametrize('tool,arguments,code', [
    ('dataset_rows', {'dataset_id': 'private'}, 'AI_DATASET_FORBIDDEN'),
    ('execute', {'amount': 1}, 'AI_TOOL_FORBIDDEN'),
    ('growth_overview', {}, 'AI_TOOL_FORBIDDEN'),
    ('dataset_rows', {'dataset_id': 'selected', 'limit': 10000}, 'INVALID_AI_ARGUMENTS'),
])
def test_unauthorized_tools_and_data_are_persisted_as_failures(workspace, monkeypatch, tool, arguments, code):
    configured = agent()
    async def complete(*args, **kwargs):
        return {'content': '', 'tool_calls': [call(tool, arguments)]}
    monkeypatch.setattr(model_providers, 'complete', complete)
    result = asyncio.run(runtime.run_agent(configured['id'], '分析', ['selected']))
    assert result['status'] == 'failed' and result['error']['code'] == code
    assert 'SECRET UNSELECTED RECORD' not in json.dumps(result)
    with store.connect() as connection:
        assert runtime.get_run(connection, result['id'])['status'] == 'failed'


def test_queue_concurrency_recovery_and_configuration_change(workspace):
    configured = agent()
    queued = [runtime.prepare_run(configured['id'], str(i)) for i in range(3)]
    with pytest.raises(DomainError) as error:
        runtime.prepare_run(configured['id'], 'fourth')
    assert error.value.code == 'AI_CONCURRENCY_LIMIT'
    with store.transaction() as connection:
        with pytest.raises(DomainError):
            runtime.delete_agent(connection, configured['id'])
        runtime.initialize(connection)
        assert all(r['error']['code'] == 'AI_RUN_INTERRUPTED' for r in runtime.list_runs(connection))
    queued = runtime.prepare_run(configured['id'], 'after restart')
    with store.transaction() as connection:
        runtime.save_agent(connection, {**configured, 'instructions': '新的分析范围。'})
    result = asyncio.run(runtime.run_agent(configured['id'], 'after restart', run_id=queued['id']))
    assert result['error']['code'] == 'AI_CONFIG_CHANGED'


def test_step_timeout_and_unexpected_error_boundaries(workspace, monkeypatch):
    configured = agent()
    monkeypatch.setattr(runtime, 'MAX_STEPS', 2)
    async def endless(*args, **kwargs):
        return {'content': '', 'tool_calls': [call('dataset_list')]}
    monkeypatch.setattr(model_providers, 'complete', endless)
    assert asyncio.run(runtime.run_agent(configured['id'], 'steps'))['error']['code'] == 'AI_STEP_LIMIT'
    monkeypatch.setattr(runtime, 'MAX_SECONDS', .01)
    async def slow(*args, **kwargs):
        await asyncio.sleep(1)
    monkeypatch.setattr(model_providers, 'complete', slow)
    assert asyncio.run(runtime.run_agent(configured['id'], 'timeout'))['error']['code'] == 'AI_RUN_TIMEOUT'
    async def broken(*args, **kwargs):
        raise RuntimeError('SECRET PROVIDER TOKEN')
    monkeypatch.setattr(model_providers, 'complete', broken)
    result = asyncio.run(runtime.run_agent(configured['id'], 'failure'))
    assert result['error']['code'] == 'AI_RUN_FAILED'
    assert 'SECRET PROVIDER TOKEN' not in json.dumps(result)


def test_generate_draft_validates_tool_grants_and_does_not_save(workspace, monkeypatch):
    config = {'name': '库存诊断', 'description': '核对库存文件', 'instructions': '先检查来源与字段。', 'tools': ['dataset_summary']}
    async def complete(*args, **kwargs):
        return {'content': json.dumps(config), 'tool_calls': []}
    monkeypatch.setattr(model_providers, 'complete', complete)
    draft = asyncio.run(runtime.generate_agent('provider-test', '生成库存助手'))
    assert draft['status'] == 'paused' and draft['provider_id'] == 'provider-test'
    with store.connect() as connection:
        assert len(runtime.list_agents(connection)) == 6
    config['tools'] = ['recharge']
    with pytest.raises(DomainError) as error:
        asyncio.run(runtime.generate_agent('provider-test', '生成充值助手'))
    assert error.value.code == 'AI_TOOL_FORBIDDEN'


def test_explicit_growth_grant_returns_aggregate_not_private_rows(workspace, monkeypatch):
    configured = agent(['growth_overview'])
    with store.transaction() as connection:
        connection.execute('INSERT INTO growth_records VALUES(?,?,?)', ('order', 'secret-order', json.dumps({'private_customer': 'SENSITIVE'})))
        connection.execute('INSERT INTO growth_records VALUES(?,?,?)', ('report', 'report-1', json.dumps({'id': 'report-1', 'summary': {'count': 1}, 'currency': 'CNY', 'amount_unit': 'minor', 'timezone': 'Asia/Shanghai', 'raw_rows': 'SENSITIVE'})))
    calls = []
    async def complete(provider_id, messages, tools=None):
        if not calls:
            calls.append(1)
            return {'content': '', 'tool_calls': [call('growth_overview')]}
        assert 'SENSITIVE' not in messages[-1]['content']
        assert json.loads(messages[-1]['content'])['data']['record_counts']['order'] == 1
        assert json.loads(messages[-1]['content'])['data']['reports'][0]['amount_unit'] == 'minor'
        return {'content': '工作区中有 1 条订单记录。', 'tool_calls': []}
    monkeypatch.setattr(model_providers, 'complete', complete)
    assert asyncio.run(runtime.run_agent(configured['id'], '总结'))['status'] == 'completed'


def test_factor_tool_reads_actual_monitor_schema(workspace, monkeypatch):
    from opsweaver import growth_monitor
    configured = agent(['growth_factors'])
    with store.transaction() as connection:
        factor = growth_monitor.save_factor(connection, {'name': '新品公告', 'school': '品牌 A', 'college': '家居',
            'allowed_domains': ['example.com'], 'keywords': ['新品'], 'interval_seconds': 600})
    calls = []
    async def complete(provider_id, messages, tools=None):
        if not calls:
            calls.append(1)
            return {'content': '', 'tool_calls': [call('growth_factors')]}
        item = json.loads(messages[-1]['content'])['data'][0]
        assert item['id'] == factor['id'] and item['status'] == 'pending_review'
        assert item['allowed_domains'] == ['example.com'] and item['interval_seconds'] == 600
        return {'content': '现有规则待人工核验，未启用。', 'tool_calls': []}
    monkeypatch.setattr(model_providers, 'complete', complete)
    assert asyncio.run(runtime.run_agent(configured['id'], '规划监控'))['status'] == 'completed'


def test_invalid_provider_and_missing_model_rejected_before_queue(workspace):
    with store.transaction() as connection:
        with pytest.raises(DomainError) as error:
            runtime.save_agent(connection, {'name': 'test', 'instructions': 'test', 'provider_id': 'nonexistent', 'tools': []})
        assert error.value.code == 'AI_PROVIDER_NOT_FOUND'
    configured = agent()
    with store.transaction() as connection:
        model_providers.save_provider(connection, {'id': 'provider-test', 'model': ''})
    with pytest.raises(DomainError):
        runtime.prepare_run(configured['id'], 'invalid model')
    with store.connect() as connection:
        assert runtime.list_runs(connection) == []
