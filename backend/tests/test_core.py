import copy
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient

from opsweaver import store, service
from opsweaver.api import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "test.sqlite3")
    with TestClient(app) as c:
        c.post("/api/v1/auth/demo")
        yield c


def cmd(client, name, payload, key=None):
    return client.post("/api/v1/commands/" + name, json=payload, headers={"Idempotency-Key": key or store.now()})


def state(client):
    response = client.get("/api/v1/console")
    assert response.status_code == 200
    return response.json()["data"]


def approve(client, plan_id="plan-C001"):
    plan = next(p for p in state(client)["plans"] if p["id"] == plan_id)
    response = cmd(client, "approval", {"id": plan_id, "hash": plan["hash"], "decision": "approve"})
    assert response.status_code == 200, response.text


def test_unauthenticated_and_cross_origin_rejected(client):
    client.cookies.clear()
    assert cmd(client, "settings", {"kill_switch": True}).status_code == 401
    assert client.post("/api/v1/auth/demo", headers={"Origin": "https://untrusted.example"}).status_code == 403


def test_missing_coverage_and_overdue_do_not_create_duplicate_plan(client):
    assert cmd(client, "investigate", {"id": "inc-C056"}).status_code == 409
    response = cmd(client, "investigate", {"id": "inc-C027"})
    assert response.status_code == 200
    snapshot = state(client)
    assert not any(p["customer"] == "C027" for p in snapshot["plans"])
    assert next(r for r in snapshot["runs"] if r["customer"] == "C027")["state"] == "blocked"


def test_investigation_idempotency_and_branches(client):
    first = cmd(client, "investigate", {"id": "inc-C018"}, "same").json()
    second = cmd(client, "investigate", {"id": "inc-C018"}, "same").json()
    assert first == second
    cmd(client, "investigate", {"id": "inc-C018"}, "new")
    plans = state(client)["plans"]
    assert sum(p["customer"] == "C018" for p in plans) == 1
    assert next(p for p in plans if p["customer"] == "C001")["purpose"] == "support_followup"
    assert next(p for p in plans if p["customer"] == "C018")["purpose"] == "retention_followup"
    assert cmd(client, "investigate", {"id": "inc-C042"}, "same").status_code == 409


def test_immutable_approval_and_reject_reason(client):
    assert cmd(client, "approval", {"id": "plan-C001", "hash": "forged", "decision": "approve"}).status_code == 409
    plan = state(client)["plans"][0]
    assert cmd(client, "approval", {"id": plan["id"], "hash": plan["hash"], "decision": "reject"}).status_code == 422
    approve(client)
    assert cmd(client, "approval", {"id": plan["id"], "hash": plan["hash"], "decision": "reject", "comment": "late"}).status_code == 409


def test_executor_approval_stop_and_repeated_delivery(client, monkeypatch):
    external = {}
    def fake_crm(method, path, payload=None):
        if path == "/tasks" and method == "GET":
            return list(external.values())
        if method == "POST" and path == "/tasks":
            external.setdefault(payload["external_ref"], {**payload, "id": "CRM-TEST", "status": "open"})
            return external[payload["external_ref"]]
        return external[path.split("/")[-1]]
    monkeypatch.setattr(service, "crm_request", fake_crm)
    assert cmd(client, "execute", {"id": "plan-C001"}).status_code == 403
    approve(client)
    cmd(client, "settings", {"kill_switch": True})
    assert cmd(client, "execute", {"id": "plan-C001"}).status_code == 409
    cmd(client, "settings", {"kill_switch": False})
    for i in range(10):
        assert cmd(client, "execute", {"id": "plan-C001"}, str(i)).status_code == 200
    snapshot = state(client)
    assert len(external) == 1
    assert len(snapshot["actions"]) == 1
    assert snapshot["actions"][0]["status"] == "succeeded"
    assert next(r for r in snapshot["runs"] if r["customer"] == "C001")["state"] == "waiting_observation"


def test_unknown_on_transport_failure_does_not_resubmit(client, monkeypatch):
    def offline(*args, **kwargs):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(service, "crm_request", offline)
    approve(client)
    response = cmd(client, "execute", {"id": "plan-C001"})
    assert response.json()["data"]["status"] == "unknown"
    repeated = cmd(client, "execute", {"id": "plan-C001"})
    assert repeated.json()["data"]["reused"] is True
    assert len(state(client)["actions"]) == 1


def test_csv_upload_mapping_and_path_isolation(client, tmp_path):
    response = cmd(client, "upload", {"filename": "../../malicious.csv", "role": "customers", "content": "customer_id,status,updated_at\nC100,active,2026-09-10\n"})
    assert response.status_code == 200
    source_id = response.json()["data"]["source_id"]
    assert (tmp_path / (source_id + ".csv")).exists()
    response = cmd(client, "mapping", {"source_id": source_id, "mapping": {"customer_id": "customer_id"}, "unit": "minor", "timezone": "Asia/Shanghai", "coverage": True})
    assert response.status_code == 200
    assert cmd(client, "upload", {"filename": "x.csv", "role": "orders", "content": "a,a\n1,2"}).status_code == 422
    assert cmd(client, "upload", {"filename": "x.xlsx", "role": "orders", "content": "x"}).status_code == 422


def test_skills_version_schema_permissions_and_validation(client):
    payload = {"name": "Test skill", "description": "Readonly test", "instructions": "Read evidence.", "input_schema": json.dumps({"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}), "tools": ["get_incident"], "status": "active"}
    response = cmd(client, "skill-save", payload)
    assert response.status_code == 200
    skill = response.json()["data"]
    payload["id"] = skill["id"]
    updated = cmd(client, "skill-save", payload).json()["data"]
    assert updated["version"] != skill["version"]
    with store.connect() as connection:
        assert connection.execute("SELECT count(*) FROM skill_versions WHERE skill_id=?", (skill["id"],)).fetchone()[0] == 2
    assert cmd(client, "skill-test", {"id": skill["id"], "arguments": {}}).status_code == 422
    assert cmd(client, "skill-test", {"id": skill["id"], "arguments": {"customer_id": "C001"}}).json()["data"]["valid"]
    payload["tools"] = ["execute"]
    assert cmd(client, "skill-save", payload).status_code == 403
    payload["tools"] = ["get_incident"]
    payload["input_schema"] = '{"type":"object","$ref":"https://evil.example/schema"}'
    assert cmd(client, "skill-save", payload).status_code == 422


def test_mcp_boundary_and_no_execution(client):
    headers = {"Authorization": "Bearer " + store.secret("mcp.token")}
    assert client.get("/api/v1/mcp/skills").status_code == 401
    response = client.post("/api/v1/mcp/skills/skill-retention/run", json={"arguments": {"customer_id": "C001"}}, headers=headers)
    assert response.status_code == 200
    assert response.json()["data"]["execution"] == "instructions_for_calling_agent"
    assert state(client)["actions"] == []
    assert client.post("/api/v1/mcp/skills/skill-retention/tools/execute", json={"arguments": {}}, headers=headers).status_code == 403
    cmd(client, "skill-toggle", {"id": "skill-retention"})
    assert client.get("/api/v1/mcp/skills/skill-retention", headers=headers).status_code == 403


def test_state_survives_new_connection(client):
    cmd(client, "settings", {"workspace_name": "持久化测试工作区"})
    store.initialize()
    with store.connect() as connection:
        assert store.meta(connection, "settings")["workspace_name"] == "持久化测试工作区"


def test_logout_revokes_mutation_session(client):
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 200
    assert cmd(client, "settings", {"kill_switch": True}).status_code == 401


def test_skill_investigation_does_not_gain_plan_permission(client):
    with store.transaction() as connection:
        skill = {"status": "active", "tools": ["investigate"]}
        result = service.mcp_invoke(connection, skill, "investigate", {"customer_id": "C018"})
        assert result["run_id"]
        assert not any(p["customer"] == "C018" for p in store.all_items(connection, "plans"))
        with pytest.raises(service.DomainError):
            service.mcp_invoke(connection, skill, "request_plan", {"customer_id": "C018"})
        skill["tools"].append("request_plan")
        service.mcp_invoke(connection, skill, "request_plan", {"customer_id": "C018"})
        assert sum(p["customer"] == "C018" for p in store.all_items(connection, "plans")) == 1


def test_large_csv_field_has_explicit_limit(client):
    accepted = cmd(client, "upload", {"filename": "notes.csv", "role": "customers", "content": "customer_id,notes\nC001," + "a" * 131073})
    assert accepted.status_code == 200
    assert len(accepted.json()["data"]["preview"][0]["notes"]) == 1000
    rejected = cmd(client, "upload", {"filename": "notes.csv", "role": "customers", "content": "customer_id,notes\nC001," + "a" * (5 * 1024 * 1024 + 1)})
    assert rejected.status_code == 422


def test_reconcile_cancelled_task_never_reopens_observation(client):
    with store.transaction() as connection:
        action = {"id": "test-action", "customer": "C001", "title": "task", "owner": "owner", "status": "unknown", "plan_id": "plan-C001", "idempotency_key": "key", "verified_at": "", "due_at": "", "external_id": ""}
        receipt = {"id": "CRM-CANCELLED", "customer": "C001", "title": "task", "owner": "owner", "external_ref": "key", "status": "cancelled"}
        service.verify_action(connection, action, receipt)
        assert store.get(connection, "actions", "test-action")["status"] == "compensated"
        assert store.get(connection, "runs", "run-C001")["state"] == "cancelled"
