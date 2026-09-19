"""Exercise imports through the public API with isolated persistent storage."""
import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from opsweaver import store
from opsweaver.api import app


def upload(client, name, records):
    response = client.post('/api/v1/imports', files=[('files', (name, json.dumps(records, ensure_ascii=False).encode('utf-8'), 'application/json'))])
    assert response.status_code == 200, response.text
    batch = response.json()['data']
    assert batch['status'] == 'completed', batch
    return batch['files'][0]['dataset_ids'][0]


def activate(client, dataset_id):
    return client.post(f'/api/v1/datasets/{dataset_id}/activate')


def test_imported_customer_orders_survive_restart_without_previous_workspace_records(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path)
    monkeypatch.setattr(store, 'DB', tmp_path / 'console.sqlite3')
    now = datetime.now(timezone.utc)
    at = lambda days: (now - timedelta(days=days)).isoformat()
    customer = {
        'customer_id': 'CUSTOMER-REAL-001', 'created_at': at(365),
        'segment': '测试客户原始文本 合成数据', 'marketing_consent': None,
        'do_not_contact': 0, 'updated_at': at(1), 'coverage_complete': 0,
        'coverage_reason': '待核实触达覆盖', 'first_observed_at': at(2),
    }
    order = {
        'order_id': 'ORDER-REAL-001', 'customer_id': customer['customer_id'],
        'paid_at': at(3), 'status': 'paid', 'paid_amount_minor': 125050,
        'refunded_amount_minor': 5050, 'currency': 'CNY', 'updated_at': at(1),
    }
    with TestClient(app) as client:
        client.post('/api/v1/workspace/session').raise_for_status()
        customer_dataset = upload(client, '客户.json', [customer])
        order_dataset = upload(client, '订单.json', [order])
        response = activate(client, customer_dataset)
        assert response.status_code == 200, response.text
        response = activate(client, order_dataset)
        assert response.status_code == 200, response.text
        detail = client.get('/api/v1/customers/CUSTOMER-REAL-001/business')
        assert detail.status_code == 200, detail.text
        assert detail.json()['data']['net90'] == 120000
        assert detail.json()['data']['orders14'] == 1
        assert detail.json()['data']['segment'] == customer['segment']
        assert client.get('/api/v1/customers/C001/business').status_code == 404
        snapshot = client.get('/api/v1/console')
        assert snapshot.status_code == 200, snapshot.text
        assert snapshot.json()['data']['runs'] == []
        assert snapshot.json()['data']['plans'] == []
        response = client.get(f'/api/v1/datasets/{customer_dataset}/rows')
        assert response.status_code == 200, response.text
        assert response.json()['data']['rows'][0] == customer
        # Reapplying a file must merge on its key, not double the payment total.
        repeated = activate(client, order_dataset)
        assert repeated.status_code == 200, repeated.text
        assert client.get('/api/v1/customers/CUSTOMER-REAL-001/business').json()['data']['net90'] == 120000
        invalid_order = {**order, 'order_id': 'UNMATCHED-ORDER', 'customer_id': 'MISSING-CUSTOMER'}
        invalid_dataset = upload(client, '关联缺失订单.json', [invalid_order])
        rejected = activate(client, invalid_dataset)
        assert rejected.status_code == 422, rejected.text
        assert rejected.json()['error']['code'] == 'CUSTOMER_REFERENCE_MISSING'
        assert client.get('/api/v1/customers/CUSTOMER-REAL-001/business').json()['data']['net90'] == 120000
    with TestClient(app) as restarted:
        response = restarted.get('/api/v1/customers/CUSTOMER-REAL-001/business')
        assert response.status_code == 200, response.text
        assert response.json()['data']['net90'] == 120000
        assert restarted.get('/api/v1/customers/C001/business').status_code == 404
        assert restarted.get('/api/v1/console').status_code == 200
        records = restarted.get(f'/api/v1/datasets/{order_dataset}/rows').json()['data']['rows']
        assert records == [order]
