from fastapi.testclient import TestClient

from opsweaver import store
from opsweaver.api import app


def test_invalid_nested_bodies_and_cancelled_order_analysis(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'opsweaver.sqlite3')
    monkeypatch.delenv('BRAVE_SEARCH_API_KEY', raising=False)
    with TestClient(app) as client:
        client.post('/api/v1/workspace/session')
        for path, body in [('/collect', {'signals': None}), ('/orders', {'orders': None}),
                           ('/proposals', {'parameters': None}), ('/proposals', {'parameters': []})]:
            response = client.post('/api/v1/growth' + path, json=body)
            assert response.status_code == 422
        assert client.put('/api/v1/growth/config', json={'policy': None}).status_code == 422
        assert client.put('/api/v1/growth/config', json={'anomaly_threshold': True}).status_code == 422
        response = client.post('/api/v1/growth/orders', json={'orders': [{'order_id': 'cancelled-1', 'status': 'cancelled'}]})
        assert response.status_code == 200, response.text
        assert response.json()['data']['report']['summary']['current']['orders'] == 0
