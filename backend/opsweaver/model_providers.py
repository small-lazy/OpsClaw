"""Persisted model connections with private credentials and normalized protocol adapters."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import secrets
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

from . import store
from .service import DomainError

PRESETS = [
    {'id': 'openai', 'name': 'OpenAI', 'protocol': 'openai', 'base_url': 'https://api.openai.com/v1', 'model': '', 'env_key': 'OPENAI_API_KEY'},
    {'id': 'deepseek', 'name': 'DeepSeek', 'protocol': 'openai', 'base_url': 'https://api.deepseek.com/v1', 'model': 'deepseek-chat', 'env_key': 'DEEPSEEK_API_KEY'},
    {'id': 'qwen', 'name': 'Qwen / 通义千问', 'protocol': 'openai', 'base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'model': 'qwen-plus', 'env_key': 'DASHSCOPE_API_KEY'},
    {'id': 'openrouter', 'name': 'OpenRouter', 'protocol': 'openai', 'base_url': 'https://openrouter.ai/api/v1', 'model': '', 'env_key': 'OPENROUTER_API_KEY'},
    {'id': 'anthropic', 'name': 'Anthropic', 'protocol': 'anthropic', 'base_url': 'https://api.anthropic.com/v1', 'model': '', 'env_key': 'ANTHROPIC_API_KEY'},
    {'id': 'ollama', 'name': 'Ollama', 'protocol': 'openai', 'base_url': 'http://localhost:11434/v1', 'model': '', 'env_key': ''},
    {'id': 'vllm', 'name': 'vLLM', 'protocol': 'openai', 'base_url': 'http://localhost:8000/v1', 'model': '', 'env_key': ''},
]
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_TOOLS = 32
_SECRET_LOCK = threading.RLock()


def _error(code, message, status=422):
    raise DomainError(code, message, status)


def initialize(connection):
    connection.execute('CREATE TABLE IF NOT EXISTS model_providers(id TEXT PRIMARY KEY,document TEXT NOT NULL)')


def _credential_path():
    return store.DATA / 'credentials' / 'model_providers.json'


def _read_credentials():
    path = _credential_path()
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in value.items()):
            raise ValueError()
        return value
    except (OSError, ValueError):
        _error('MODEL_CREDENTIALS_UNAVAILABLE', '无法读取本机模型凭据，请检查凭据文件权限和格式。', 500)


def _write_credentials(credentials):
    path = _credential_path()
    temp_path = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(path.parent, 0o700)
        descriptor, temp_path = tempfile.mkstemp(prefix='.providers-', suffix='.tmp', dir=path.parent)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            os.chmod(temp_path, 0o600)
            json.dump(credentials, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        temp_path = None
        os.chmod(path, 0o600)
    except OSError:
        _error('MODEL_CREDENTIALS_UNAVAILABLE', '无法保存本机模型凭据，请检查目录权限。', 500)
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


def _local(host):
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _url(value):
    try:
        if not isinstance(value, str) or any(c.isspace() for c in value):
            raise ValueError()
        parsed = urlsplit(value)
        if not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment:
            raise ValueError()
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and _local(parsed.hostname.lower())):
            raise ValueError()
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError()
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip('/'), '', ''))
    except (ValueError, TypeError):
        _error('MODEL_BASE_URL', '模型地址需为 HTTPS；本机 localhost 或回环地址可使用 HTTP。地址不能包含用户名、密码、查询参数或片段。')


def _text(value, label, *, required=True, maximum=200):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        _error('MODEL_FIELD', f'{label}格式无效。')
    value = value.strip()
    if required and not value:
        _error('MODEL_FIELD', f'请填写{label}。')
    return value


def _get(connection, provider_id):
    initialize(connection)
    row = connection.execute('SELECT document FROM model_providers WHERE id=?', (provider_id,)).fetchone()
    if not row:
        _error('MODEL_PROVIDER_NOT_FOUND', '没有找到该模型连接。', 404)
    return json.loads(row[0])


def _public(provider):
    env = provider.get('env_key')
    with _SECRET_LOCK:
        stored = bool(_read_credentials().get(provider['id']))
    return {**provider, 'api_key_configured': bool(os.environ.get(env)) if env else stored,
            'key_source': 'environment' if env else 'stored' if stored else 'none'}


def list_providers(connection):
    initialize(connection)
    return [_public(json.loads(r[0])) for r in connection.execute('SELECT document FROM model_providers ORDER BY rowid')]


def save_provider(connection, payload):
    initialize(connection)
    if not isinstance(payload, dict):
        _error('MODEL_PAYLOAD', '模型配置需为对象。')
    identifier = payload.get('id') or 'provider-' + secrets.token_hex(12)
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier):
        _error('MODEL_ID', '模型连接标识无效。')
    existing = connection.execute('SELECT document FROM model_providers WHERE id=?', (identifier,)).fetchone()
    previous = json.loads(existing[0]) if existing else {}
    protocol = payload.get('protocol', previous.get('protocol', 'openai'))
    if protocol not in ('openai', 'anthropic'):
        _error('MODEL_PROTOCOL', '模型协议需为 openai 或 anthropic。')
    env = _text(payload.get('env_key', previous.get('env_key', '')), '环境变量名称', required=False)
    if env and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', env):
        _error('MODEL_ENV_KEY', '环境变量名称无效。')
    key = payload.get('api_key', '')
    if not isinstance(key, str) or len(key) > 8192 or any(ord(c) < 32 for c in key):
        _error('MODEL_API_KEY', 'API Key 格式无效。')
    provider = {'id': identifier, 'name': _text(payload.get('name', previous.get('name', '')), '连接名称'), 'protocol': protocol,
                'base_url': _url(payload.get('base_url', previous.get('base_url', ''))),
                'model': _text(payload.get('model', previous.get('model', '')), '模型名称', required=False),
                'env_key': env, 'created_at': previous.get('created_at', store.now()), 'updated_at': store.now()}
    # Acquire the caller's SQLite write lock before touching the shared credential file.
    connection.execute('INSERT INTO model_providers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document', (identifier, json.dumps(provider, ensure_ascii=False)))
    if key.strip():
        with _SECRET_LOCK:
            credentials = _read_credentials()
            credentials[identifier] = key.strip()
            _write_credentials(credentials)
    return _public(provider)


def delete_provider(connection, provider_id):
    _get(connection, provider_id)
    connection.execute('DELETE FROM model_providers WHERE id=?', (provider_id,))
    with _SECRET_LOCK:
        credentials = _read_credentials()
        if provider_id in credentials:
            del credentials[provider_id]
            _write_credentials(credentials)
    return {'id': provider_id, 'deleted': True}


def _load(provider_id):
    with store.connect() as connection:
        provider = _get(connection, provider_id)
    _url(provider['base_url'])
    env = provider.get('env_key')
    with _SECRET_LOCK:
        key = os.environ.get(env, '') if env else _read_credentials().get(provider_id, '')
    if not key and not _local(urlsplit(provider['base_url']).hostname):
        _error('MODEL_KEY_REQUIRED', '请配置该模型的 API Key 或对应环境变量。')
    if any(ord(c) < 32 for c in key):
        _error('MODEL_API_KEY', 'API Key 格式无效。')
    return provider, key


def _headers(provider, key):
    headers = {'Accept': 'application/json'}
    if provider['protocol'] == 'anthropic':
        headers['anthropic-version'] = '2023-06-01'
        if key:
            headers['x-api-key'] = key
    elif key:
        headers['Authorization'] = 'Bearer ' + key
    return headers


def validate_provider(provider_id):
    """Validate a saved connection before queueing a run, without contacting it."""
    provider, _ = _load(provider_id)
    if not provider['model']:
        _error('MODEL_SELECTION_REQUIRED', '请先为该连接选择模型。')
    return _public(provider)


async def _request(provider, key, method, endpoint, payload=None):
    try:
        async with asyncio.timeout(90):
            return await _request_once(provider, key, method, endpoint, payload)
    except TimeoutError:
        _error('MODEL_TIMEOUT', '模型请求超过总时限，请稍后重试。', 504)


async def _request_once(provider, key, method, endpoint, payload=None):
    if payload is not None:
        try:
            if len(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()) > MAX_REQUEST_BYTES:
                _error('MODEL_REQUEST_LIMIT', '模型请求超过 2 MB。')
        except (ValueError, TypeError):
            _error('MODEL_REQUEST_FORMAT', '模型请求包含无效内容。')
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10), follow_redirects=False, trust_env=False) as client:
            async with client.stream(method, provider['base_url'] + '/' + endpoint, headers=_headers(provider, key), json=payload) as response:
                if response.status_code in (401, 403):
                    _error('MODEL_AUTH_FAILED', '模型服务拒绝认证，请检查 API Key 和访问权限。', 502)
                if response.status_code == 429:
                    _error('MODEL_RATE_LIMITED', '模型服务限流或配额不足，请稍后重试。', 502)
                if response.status_code >= 300:
                    _error('MODEL_REMOTE_ERROR', f'模型服务返回 HTTP {response.status_code}，请检查服务地址和模型名称。', 502)
                length = response.headers.get('content-length', '')
                if length.isdigit() and int(length) > MAX_RESPONSE_BYTES:
                    _error('MODEL_RESPONSE_LIMIT', '模型服务响应超过 2 MB。', 502)
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > MAX_RESPONSE_BYTES:
                        _error('MODEL_RESPONSE_LIMIT', '模型服务响应超过 2 MB。', 502)
        value = json.loads(content)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except httpx.TimeoutException:
        _error('MODEL_TIMEOUT', '模型服务响应超时，请稍后重试。', 504)
    except httpx.HTTPError:
        _error('MODEL_NETWORK', '无法连接模型服务，请检查服务地址和网络。', 502)
    except (ValueError, UnicodeError):
        _error('MODEL_RESPONSE_FORMAT', '模型服务返回了无法识别的响应。', 502)


def _tools(tools):
    if tools is None:
        return []
    if not isinstance(tools, list) or len(tools) > MAX_TOOLS:
        _error('MODEL_TOOLS_LIMIT', '每次请求最多携带 32 个工具。')
    validated = []
    for tool in tools:
        if not isinstance(tool, dict) or tool.get('type') != 'function' or not isinstance(tool.get('function'), dict):
            _error('MODEL_TOOL_FORMAT', '工具需为 OpenAI function schema。')
        fn = tool['function']
        name = _text(fn.get('name'), '工具名称', maximum=100)
        parameters = fn.get('parameters', {'type': 'object', 'properties': {}})
        if not isinstance(parameters, dict) or parameters.get('type', 'object') != 'object':
            _error('MODEL_TOOL_FORMAT', '工具参数需为对象 schema。')
        validated.append({'type': 'function', 'function': {'name': name, 'description': str(fn.get('description', ''))[:4000], 'parameters': parameters}})
    return validated


def _messages(messages):
    if not isinstance(messages, list) or not 1 <= len(messages) <= 200:
        _error('MODEL_MESSAGES', '消息需为 1–200 项数组。')
    result = []
    for message in messages:
        if not isinstance(message, dict) or message.get('role') not in ('system', 'developer', 'user', 'assistant', 'tool'):
            _error('MODEL_MESSAGES', '消息角色无效。')
        content = message.get('content')
        if content is not None and not isinstance(content, str):
            _error('MODEL_MESSAGES', '当前模型接口接收文本消息。')
        item = {'role': message['role'], 'content': content or ''}
        if message.get('tool_calls'):
            if message['role'] != 'assistant' or not isinstance(message['tool_calls'], list) or len(message['tool_calls']) > MAX_TOOLS:
                _error('MODEL_TOOL_FORMAT', '历史工具调用格式无效。')
            calls = []
            for call in message['tool_calls']:
                if not isinstance(call, dict) or not isinstance(call.get('function'), dict):
                    _error('MODEL_TOOL_FORMAT', '历史工具调用格式无效。')
                fn = call['function']
                arguments = _arguments(fn.get('arguments', '{}'), incoming=True)
                calls.append({'id': _text(call.get('id'), '工具调用标识'), 'type': 'function', 'function': {'name': _text(fn.get('name'), '工具名称'), 'arguments': json.dumps(arguments, ensure_ascii=False)}})
            item['tool_calls'] = calls
        if message['role'] == 'tool':
            item['tool_call_id'] = _text(message.get('tool_call_id'), '工具调用标识')
        result.append(item)
    return result


def _arguments(raw, incoming=False):
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(parsed, dict):
            raise ValueError()
        json.dumps(parsed, allow_nan=False)
        return parsed
    except (ValueError, TypeError):
        _error('MODEL_TOOL_ARGUMENTS', '工具调用参数不是有效 JSON 对象。', 422 if incoming else 502)


def _anthropic_messages(messages):
    system, converted = [], []
    for message in messages:
        role, content = message['role'], message['content']
        if role in ('system', 'developer'):
            system.append(content)
            continue
        if role == 'tool':
            target, blocks = 'user', [{'type': 'tool_result', 'tool_use_id': message['tool_call_id'], 'content': content}]
        else:
            target, blocks = role, ([{'type': 'text', 'text': content}] if content else [])
            for call in message.get('tool_calls', []):
                blocks.append({'type': 'tool_use', 'id': call['id'], 'name': call['function']['name'], 'input': _arguments(call['function']['arguments'], incoming=True)})
        if not blocks:
            _error('MODEL_MESSAGES', 'Anthropic 对话消息不能为空。')
        if converted and converted[-1]['role'] == target:
            converted[-1]['content'].extend(blocks)
        else:
            converted.append({'role': target, 'content': blocks})
    if not converted:
        _error('MODEL_MESSAGES', '请至少提供一条用户或助手消息。')
    return '\n\n'.join(system), converted


def _usage(value, protocol):
    value = value if isinstance(value, dict) else {}
    def count(key):
        number = value.get(key, 0)
        return number if isinstance(number, int) and not isinstance(number, bool) and number >= 0 else 0
    inputs = count('input_tokens' if protocol == 'anthropic' else 'prompt_tokens')
    outputs = count('output_tokens' if protocol == 'anthropic' else 'completion_tokens')
    return {'input_tokens': inputs, 'output_tokens': outputs, 'total_tokens': inputs + outputs}


async def discover_models(provider_id):
    provider, key = _load(provider_id)
    response = await _request(provider, key, 'GET', 'models')
    values = response.get('data')
    if not isinstance(values, list):
        _error('MODEL_RESPONSE_FORMAT', '模型列表响应需包含 data 数组。', 502)
    result, seen = [], set()
    for model in values[:1000]:
        if not isinstance(model, dict) or not isinstance(model.get('id'), str) or not model['id'] or model['id'] in seen:
            continue
        seen.add(model['id'])
        result.append({'id': model['id'], 'name': str(model.get('display_name') or model.get('name') or model['id'])})
    return result


async def complete(provider_id, messages, tools=None):
    provider, key = _load(provider_id)
    if not provider['model']:
        _error('MODEL_SELECTION_REQUIRED', '请先为该连接选择模型。')
    messages, tools = _messages(messages), _tools(tools)
    payload = {'model': provider['model'], 'max_tokens': 4096, 'stream': False}
    if provider['protocol'] == 'anthropic':
        system, converted = _anthropic_messages(messages)
        payload['messages'] = converted
        if system:
            payload['system'] = system
        if tools:
            payload['tools'] = [{'name': t['function']['name'], 'description': t['function']['description'], 'input_schema': t['function']['parameters']} for t in tools]
        response = await _request(provider, key, 'POST', 'messages', payload)
        blocks = response.get('content')
        if not isinstance(blocks, list):
            _error('MODEL_RESPONSE_FORMAT', '模型服务缺少 content 响应。', 502)
        content, calls = [], []
        for block in blocks:
            if not isinstance(block, dict):
                _error('MODEL_RESPONSE_FORMAT', '模型消息块格式无效。', 502)
            if block.get('type') == 'text' and isinstance(block.get('text'), str):
                content.append(block['text'])
            elif block.get('type') == 'tool_use':
                calls.append({'id': block.get('id'), 'name': block.get('name'), 'arguments': _arguments(block.get('input'))})
        content = '\n'.join(content)
    else:
        model_name = provider['model'].rsplit('/', 1)[-1].lower()
        if re.match(r'^(?:gpt-5|o1|o3|o4)(?:$|[-.:])', model_name):
            payload['max_completion_tokens'] = payload.pop('max_tokens')
        payload['messages'] = messages
        if tools:
            payload['tools'] = tools
        response = await _request(provider, key, 'POST', 'chat/completions', payload)
        choices = response.get('choices')
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict) or not isinstance(choices[0].get('message'), dict):
            _error('MODEL_RESPONSE_FORMAT', '模型服务缺少 choices 消息响应。', 502)
        message = choices[0]['message']
        content = message.get('content') or ''
        if not isinstance(content, str):
            _error('MODEL_RESPONSE_FORMAT', '模型返回的文本格式无效。', 502)
        raw_calls = message.get('tool_calls') or []
        if not isinstance(raw_calls, list) or len(raw_calls) > MAX_TOOLS:
            _error('MODEL_TOOLS_LIMIT', '模型返回的工具调用超过 32 项或格式无效。', 502)
        calls = []
        for call in raw_calls:
            if not isinstance(call, dict) or not isinstance(call.get('function'), dict):
                _error('MODEL_RESPONSE_FORMAT', '模型工具调用格式无效。', 502)
            fn = call['function']
            calls.append({'id': call.get('id'), 'name': fn.get('name'), 'arguments': _arguments(fn.get('arguments', '{}'))})
    if len(calls) > MAX_TOOLS or any(not isinstance(c.get('id'), str) or not c['id'] or not isinstance(c.get('name'), str) or not c['name'] for c in calls):
        _error('MODEL_TOOL_FORMAT', '模型返回的工具调用数量或标识无效。', 502)
    return {'content': content, 'tool_calls': calls, 'usage': _usage(response.get('usage'), provider['protocol'])}


async def test_provider(provider_id):
    result = await complete(provider_id, [{'role': 'user', 'content': 'Reply with OK.'}])
    if not result['content'].strip() or result['tool_calls']:
        _error('MODEL_EMPTY_TEST', '模型未返回有效测试文本，请检查模型选择或服务配置。', 502)
    with store.connect() as connection:
        provider = _get(connection, provider_id)
    return {'ok': True, 'provider_id': provider_id, 'model': provider['model'], 'content': result['content'], 'usage': result['usage']}
