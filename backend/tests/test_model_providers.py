import asyncio
import json

import httpx
import pytest

from opsweaver import model_providers as models, store
from opsweaver.service import DomainError


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'providers.sqlite3')
    with store.connect() as conn:
        models.initialize(conn)
    return tmp_path


def save(**updates):
    payload = {'name': 'Test provider', 'protocol': 'openai', 'base_url': 'https://models.example/v1', 'api_key': 'private-api-secret', 'model': 'selected-model', **updates}
    with store.connect() as conn:
        return models.save_provider(conn, payload)


def transport(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(models.httpx, 'AsyncClient', lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(handler)))


def test_credentials_stay_out_of_database_and_responses_and_empty_preserves(workspace):
    provider = save()
    identifier = provider['id']
    with store.connect() as conn:
        saved = models.save_provider(conn, {'id': identifier, 'name': 'Renamed', 'api_key': ''})
        assert saved['api_key_configured'] is True
        assert 'private-api-secret' not in json.dumps(models.list_providers(conn))
        assert 'private-api-secret' not in conn.execute('SELECT document FROM model_providers').fetchone()[0]
    path = workspace / 'credentials' / 'model_providers.json'
    assert json.loads(path.read_text())[identifier] == 'private-api-secret'
    with store.connect() as conn:
        assert models.delete_provider(conn, identifier)['deleted']
        assert models.list_providers(conn) == []
    assert identifier not in json.loads(path.read_text())


def test_url_rules_and_environment_reference(workspace, monkeypatch):
    for url in ('http://remote.example/v1', 'https://user:key@models.example/v1', 'https://models.example/v1?token=secret', 'https://models.example/v1#part'):
        with pytest.raises(DomainError) as error:
            save(base_url=url)
        assert error.value.code == 'MODEL_BASE_URL'
    assert save(base_url='http://127.0.0.1:11434/v1', api_key='')['key_source'] == 'none'
    assert save(base_url='http://[::1]:8000/v1', api_key='')['api_key_configured'] is False
    monkeypatch.setenv('CUSTOM_MODEL_KEY', 'environment-only-secret')
    provider = save(env_key='CUSTOM_MODEL_KEY')
    assert provider['key_source'] == 'environment'
    assert models._load(provider['id'])[1] == 'environment-only-secret'
    assert 'environment-only-secret' not in (workspace / 'credentials' / 'model_providers.json').read_text()


def test_openai_completion_and_tool_arguments_normalize(workspace, monkeypatch):
    provider = save()
    def upstream(request):
        assert str(request.url) == 'https://models.example/v1/chat/completions'
        assert request.headers['authorization'] == 'Bearer private-api-secret'
        body = json.loads(request.content)
        assert body['model'] == 'selected-model'
        assert body['tools'][0]['function']['name'] == 'lookup'
        return httpx.Response(200, json={'choices': [{'message': {'content': '需要查询数据', 'tool_calls': [{'id': 'call-1', 'type': 'function', 'function': {'name': 'lookup', 'arguments': '{"limit": 3}'}}]}}], 'usage': {'prompt_tokens': 8, 'completion_tokens': 4}})
    transport(monkeypatch, upstream)
    result = asyncio.run(models.complete(provider['id'], [{'role': 'user', 'content': '请查询'}], [{'type': 'function', 'function': {'name': 'lookup', 'parameters': {'type': 'object', 'properties': {'limit': {'type': 'integer'}}}}}]))
    assert result['tool_calls'] == [{'id': 'call-1', 'name': 'lookup', 'arguments': {'limit': 3}}]
    assert result['usage'] == {'input_tokens': 8, 'output_tokens': 4, 'total_tokens': 12}


def test_anthropic_system_tool_use_and_tool_result_translation(workspace, monkeypatch):
    provider = save(protocol='anthropic', base_url='https://anthropic.example/v1')
    def upstream(request):
        assert request.url.path == '/v1/messages'
        assert request.headers['x-api-key'] == 'private-api-secret'
        assert request.headers['anthropic-version'] == '2023-06-01'
        assert 'authorization' not in request.headers
        body = json.loads(request.content)
        assert body['system'] == '规则'
        assert body['messages'][1]['content'][0]['type'] == 'tool_use'
        assert body['messages'][2]['content'][0] == {'type': 'tool_result', 'tool_use_id': 'prior', 'content': '结果'}
        assert body['tools'][0]['input_schema']['type'] == 'object'
        return httpx.Response(200, json={'content': [{'type': 'text', 'text': '已分析'}, {'type': 'tool_use', 'id': 'next', 'name': 'lookup', 'input': {'limit': 2}}], 'usage': {'input_tokens': 20, 'output_tokens': 6}})
    transport(monkeypatch, upstream)
    messages = [{'role': 'system', 'content': '规则'}, {'role': 'user', 'content': '查询'}, {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'prior', 'type': 'function', 'function': {'name': 'lookup', 'arguments': '{}'}}]}, {'role': 'tool', 'tool_call_id': 'prior', 'content': '结果'}]
    result = asyncio.run(models.complete(provider['id'], messages, [{'type': 'function', 'function': {'name': 'lookup'}}]))
    assert result['content'] == '已分析'
    assert result['tool_calls'][0]['arguments'] == {'limit': 2}
    assert result['usage']['total_tokens'] == 26


def test_model_discovery_and_local_no_key_smoke_test(workspace, monkeypatch):
    provider = save(base_url='http://localhost:11434/v1', api_key='', model='')
    def upstream(request):
        assert 'authorization' not in request.headers
        if request.method == 'GET':
            return httpx.Response(200, json={'data': [{'id': 'local-model'}, {'id': 'local-model'}, {'id': 'second', 'name': 'Second'}]})
        return httpx.Response(200, json={'choices': [{'message': {'content': 'OK'}}], 'usage': {}})
    transport(monkeypatch, upstream)
    assert asyncio.run(models.discover_models(provider['id'])) == [{'id': 'local-model', 'name': 'local-model'}, {'id': 'second', 'name': 'Second'}]
    with store.connect() as conn:
        models.save_provider(conn, {'id': provider['id'], 'model': 'local-model'})
    assert asyncio.run(models.test_provider(provider['id']))['ok']


@pytest.mark.parametrize('mode,expected', [('auth', 'MODEL_AUTH_FAILED'), ('timeout', 'MODEL_TIMEOUT'), ('huge', 'MODEL_RESPONSE_LIMIT'), ('invalid', 'MODEL_RESPONSE_FORMAT')])
def test_remote_failures_are_bounded_and_redacted(workspace, monkeypatch, mode, expected):
    provider = save()
    def upstream(request):
        if mode == 'auth':
            return httpx.Response(401, text='private-api-secret sensitive backend detail')
        if mode == 'timeout':
            raise httpx.ReadTimeout('private-api-secret sensitive backend detail')
        if mode == 'huge':
            return httpx.Response(200, content=b'x' * (models.MAX_RESPONSE_BYTES + 1))
        return httpx.Response(200, text='private-api-secret malformed JSON')
    transport(monkeypatch, upstream)
    with pytest.raises(DomainError) as error:
        asyncio.run(models.complete(provider['id'], [{'role': 'user', 'content': 'test'}]))
    assert error.value.code == expected
    assert 'private-api-secret' not in error.value.message
    assert 'sensitive' not in error.value.message


def test_connection_test_rejects_empty_model_reply(workspace, monkeypatch):
    provider = save()
    transport(monkeypatch, lambda request: httpx.Response(200, json={'choices': [{'message': {'content': ''}}]}))
    with pytest.raises(DomainError) as error:
        asyncio.run(models.test_provider(provider['id']))
    assert error.value.code == 'MODEL_EMPTY_TEST'


def test_tool_limits_and_malformed_tool_response(workspace, monkeypatch):
    provider = save()
    transport(monkeypatch, lambda request: httpx.Response(200, json={'choices': [{'message': {'tool_calls': [{'id': 'x', 'function': {'name': 'lookup', 'arguments': 'not json'}}]}}]}))
    with pytest.raises(DomainError) as error:
        asyncio.run(models.complete(provider['id'], [{'role': 'user', 'content': 'test'}], [{}] * 33))
    assert error.value.code == 'MODEL_TOOLS_LIMIT'
    with pytest.raises(DomainError) as error:
        asyncio.run(models.complete(provider['id'], [{'role': 'user', 'content': 'test'}]))
    assert error.value.code == 'MODEL_TOOL_ARGUMENTS'


def test_validate_provider_before_queueing_is_local_and_redacted(workspace, monkeypatch):
    monkeypatch.setattr(models.httpx, 'AsyncClient', lambda **kwargs: pytest.fail('validation must not contact network'))
    provider = save()
    result = models.validate_provider(provider['id'])
    assert result['id'] == provider['id'] and result['api_key_configured'] is True
    assert 'private-api-secret' not in json.dumps(result)
    no_model = save(model='')
    with pytest.raises(DomainError) as error:
        models.validate_provider(no_model['id'])
    assert error.value.code == 'MODEL_SELECTION_REQUIRED'
    no_key = save(api_key='')
    with pytest.raises(DomainError) as error:
        models.validate_provider(no_key['id'])
    assert error.value.code == 'MODEL_KEY_REQUIRED'
    local = save(base_url='http://localhost:11434/v1', api_key='')
    assert models.validate_provider(local['id'])['key_source'] == 'none'


@pytest.mark.parametrize('model,token_field', [
    ('gpt-5', 'max_completion_tokens'),
    ('gpt-5.2', 'max_completion_tokens'),
    ('openai/gpt-5-mini', 'max_completion_tokens'),
    ('o1', 'max_completion_tokens'),
    ('openai/o3-mini', 'max_completion_tokens'),
    ('vendor/o4-mini:extended', 'max_completion_tokens'),
    ('deepseek-chat', 'max_tokens'),
    ('qwen-plus', 'max_tokens'),
    ('gpt-4o', 'max_tokens'),
])
def test_openai_reasoning_models_use_compatible_token_parameter(workspace, monkeypatch, model, token_field):
    provider = save(model=model)
    def upstream(request):
        payload = json.loads(request.content)
        assert payload[token_field] == 4096
        other_field = 'max_tokens' if token_field == 'max_completion_tokens' else 'max_completion_tokens'
        assert other_field not in payload
        return httpx.Response(200, json={'choices': [{'message': {'content': 'OK'}}]})
    transport(monkeypatch, upstream)
    assert asyncio.run(models.complete(provider['id'], [{'role': 'user', 'content': 'test'}]))['content'] == 'OK'
