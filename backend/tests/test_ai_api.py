"""Exercise the HTTP adapter and Agent loop through an isolated protocol server."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from opsweaver import store
from opsweaver.api import app


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'workspace.sqlite3')
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, payload):
            raw = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            assert self.path == '/v1/models'
            self.reply({'data': [{'id': 'protocol-test-model'}]})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append(body)
            assert self.path == '/v1/chat/completions'
            messages = body['messages']
            if messages[-1]['content'] == 'Reply with OK.':
                message = {'content': 'OK'}
            elif '只返回 JSON' in messages[0]['content']:
                message = {'content': json.dumps({'name': '商品分析', 'description': '检查商品数据', 'instructions': '先核对数据质量，再总结销售变化。', 'tools': ['dataset_list', 'dataset_summary']}, ensure_ascii=False)}
            elif any(m['role'] == 'tool' for m in messages):
                message = {'content': '已读取本次选择的数据集，接下来可以核验商品销售变化。'}
            else:
                message = {'content': '', 'tool_calls': [{'id': 'call-1', 'type': 'function', 'function': {'name': 'dataset_list', 'arguments': '{}'}}]}
            self.reply({'choices': [{'message': message}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}})

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        with TestClient(app) as client:
            yield client, f'http://127.0.0.1:{server.server_port}/v1', requests
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


def test_connection_generation_and_tool_run_over_http(setup):
    client, base_url, requests = setup
    assert client.get('/api/v1/ai/workspace').status_code == 401
    client.post('/api/v1/workspace/session')
    workspace = client.get('/api/v1/ai/workspace').json()['data']
    assert len(workspace['agents']) >= 6
    saved = client.post('/api/v1/ai/providers', json={'name': '本机协议验证', 'protocol': 'openai', 'base_url': base_url, 'model': 'protocol-test-model', 'api_key': 'test-private-value'}).json()['data']
    provider_id = saved['id']
    assert 'test-private-value' not in json.dumps(saved)
    assert client.post(f'/api/v1/ai/providers/{provider_id}/test').json()['data']['ok']
    assert client.post(f'/api/v1/ai/providers/{provider_id}/models').json()['data'][0]['id'] == 'protocol-test-model'
    draft = client.post('/api/v1/ai/generate', json={'provider_id': provider_id, 'requirement': '分析商品销售数据'}).json()['data']
    assert len(client.get('/api/v1/ai/workspace').json()['data']['agents']) == len(workspace['agents'])
    draft['status'] = 'active'
    agent = client.post('/api/v1/ai/agents', json=draft).json()['data']
    assert client.delete(f'/api/v1/ai/providers/{provider_id}').status_code == 409
    batch = client.post('/api/v1/imports', files={'files': ('sales.csv', '商品,销售额\n背包,100\n'.encode())}).json()['data']
    dataset_id = batch['files'][0]['dataset_ids'][0]
    response = client.post('/api/v1/ai/runs', json={'agent_id': agent['id'], 'task': '检查商品文件', 'dataset_ids': [dataset_id]})
    assert response.status_code == 202, response.text
    run_id = response.json()['data']['id']
    for _ in range(100):
        run = client.get(f'/api/v1/ai/runs/{run_id}').json()['data']
        if run['status'] in ('completed', 'failed'):
            break
        time.sleep(.02)
    assert run['status'] == 'completed', run
    assert any(t['type'] == 'tool' for t in run['trace'])
    assert run['usage']['total_tokens'] == 30
    assert any(m['role'] == 'tool' and dataset_id in m['content'] for m in requests[-1]['messages'])
    assert client.get('/api/v1/ai/runs/' + run_id).json()['data']['result'] == run['result']
    assert 'test-private-value' not in client.get('/api/v1/ai/workspace').text
    # A queued/running task must keep its selected connection throughout the loop.
    with store.transaction() as connection:
        locked = dict(run, status='running')
        connection.execute('UPDATE ai_runs SET document=? WHERE id=?', (json.dumps(locked), run_id))
    assert client.post('/api/v1/ai/providers', json={**saved, 'model': 'changed-model'}).status_code == 409
    with store.transaction() as connection:
        connection.execute('UPDATE ai_runs SET document=? WHERE id=?', (json.dumps(run), run_id))
    assert client.delete('/api/v1/ai/agents/' + agent['id']).status_code == 200
    assert client.delete('/api/v1/ai/providers/' + provider_id).status_code == 200
