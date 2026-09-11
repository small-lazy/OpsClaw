import sqlite3
from datetime import datetime, timedelta

from opsweaver.business import customer_detail, evaluate_incidents, initialize, source_rows, source_stats

AS_OF = "2026-09-10T00:00:00+00:00"


def test_real_tables_counts_and_initialization_preserves_records(tmp_path):
    initialize(tmp_path, AS_OF)
    stats = {item["role"]: item for item in source_stats(tmp_path)}
    assert len(stats) == 6
    assert stats["customers"]["rows"] == 500
    assert stats["orders"]["rows"] == 6000
    assert stats["events"]["rows"] == 30000
    assert all(item["rows"] > 0 and 0 < len(item["preview"]) <= 5 for item in stats.values())
    first = source_rows(tmp_path, "orders", 0, 10)
    initialize(tmp_path, "2027-01-01T00:00:00Z")
    assert source_rows(tmp_path, "orders", 0, 10) == first
    assert source_stats(tmp_path) == list(stats.values())


def test_customer_amount_and_session_metrics_come_from_database(tmp_path):
    initialize(tmp_path, AS_OF)
    detail = customer_detail(tmp_path, "C001", AS_OF)
    with sqlite3.connect(tmp_path / "business.sqlite3") as db:
        actual = db.execute("SELECT SUM(paid_amount_minor-refunded_amount_minor) FROM orders WHERE customer_id='C001'").fetchone()[0]
        db.execute("UPDATE orders SET refunded_amount_minor=refunded_amount_minor+10000 WHERE order_id='O-C001-01'")
    assert detail["value"] == actual
    assert detail["orders28"] == 2 and detail["orders14"] == 0
    assert detail["sessions_previous14"] >= 4 and detail["sessions14"] == 0
    changed = customer_detail(tmp_path, "C001", AS_OF)
    assert changed["value"] == actual - 10000
    incident = next(item for item in evaluate_incidents(tmp_path, AS_OF) if item["customer"] == "C001")
    assert incident["value"] == changed["value"]
    assert f"{changed['value']/100:,.2f}" in incident["facts"][0]


def test_named_operational_cases_and_coverage(tmp_path):
    initialize(tmp_path, AS_OF)
    incidents = {item["customer"]: item for item in evaluate_incidents(tmp_path, AS_OF)}
    assert set(["C001", "C018", "C027", "C056", "C063", "C079", "C214"]).issubset(incidents)
    assert incidents["C001"]["support"] and "支付失败" in incidents["C001"]["facts"][3]
    assert incidents["C079"]["support"] and "投诉" in incidents["C079"]["facts"][3]
    assert incidents["C027"]["kind"] == "TASK_OVERDUE"
    assert "不新建重复任务" in incidents["C027"]["facts"][2]
    assert incidents["C018"]["status"] == "open" and not incidents["C063"]["support"]
    for cid in ("C056", "C214"):
        assert not incidents[cid]["coverage"] and incidents[cid]["status"] == "blocked"
        assert "无法确认" in incidents[cid]["facts"][2]
    for item in incidents.values():
        assert len(item["facts"]) == 4 and item["run_id"] is None
        assert isinstance(item["value"], int) and 0 <= item["priority"] <= 100


def test_recent_contacts_active_tasks_and_short_grace_remove_missing_actions(tmp_path):
    initialize(tmp_path, AS_OF)
    now = datetime.fromisoformat(AS_OF)
    with sqlite3.connect(tmp_path / "business.sqlite3") as db:
        db.execute("INSERT INTO contacts VALUES(?,?,?,?,?,?,?)", ("check-contact", "C018", "retention", "crm", "completed", (now-timedelta(hours=1)).isoformat(), "test"))
        db.execute("INSERT INTO crm_tasks VALUES(?,?,?,?,?,?,?,?)", ("check-task", "C063", "retention_followup", "episode-C063", "open", "owner", (now+timedelta(days=1)).isoformat(), AS_OF))
        db.execute("UPDATE customers SET first_observed_at=? WHERE customer_id='C079'", ((now-timedelta(hours=2)).isoformat(),))
    customers = {item["customer"] for item in evaluate_incidents(tmp_path, AS_OF)}
    assert not {"C018", "C063", "C079"} & customers


def test_future_query_does_not_claim_source_coverage(tmp_path):
    initialize(tmp_path, AS_OF)
    future = (datetime.fromisoformat(AS_OF) + timedelta(days=1)).isoformat()
    incidents = evaluate_incidents(tmp_path, future)
    assert incidents and all(not item["coverage"] for item in incidents)


def test_store_integration_preserves_uploads_and_workflow_state(tmp_path, monkeypatch):
    from opsweaver import store
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "console.sqlite3")
    store.initialize()
    with store.connect() as db:
        source = {"id": "upload-abcdef", "role": "orders", "name": "我的订单.csv", "rows": 1, "status": "ready", "coverage": True, "as_of": AS_OF, "origin": "user_upload"}
        store.put(db, "sources", source)
        incident = store.get(db, "incidents", "inc-C001")
        assert incident["run_id"] and store.get(db, "plans", "plan-C001")
        incident["status"] = "observing"
        store.put(db, "incidents", incident)
        store.put(db, "incidents", {**incident, "id": "inc-C086", "customer": "C086", "status": "open", "run_id": None})
        initial_runs = store.all_items(db, "runs")
    store.initialize()
    with store.connect() as db:
        assert store.get(db, "sources", "upload-abcdef") == source
        assert store.get(db, "incidents", "inc-C001")["status"] == "observing"
        assert store.all_items(db, "runs") == initial_runs
        assert store.get(db, "incidents", "inc-C086")["status"] == "dismissed"
        assert store.meta(db, "legacy_incident:inc-C086")["status"] == "open"
        state = store.snapshot(db)
        assert next(item for item in state["sources"] if item["role"] == "orders")["rows"] == 6000
        assert len(state["incidents"]) > 20
        assert state["coverage"]["denominator"] > 0
        assert len(state["trend"]) == 30
        assert len({item["date"] for item in state["trend"]}) == 30
        assert all(item["detected"] >= 0 and item["covered"] >= 0 for item in state["trend"])
        plan = store.get(db, "plans", "plan-C001")
        plan["reason"] = "审批中引用的合成数据说明必须保持原文"
        plan["hash"] = store.digest({k: v for k, v in plan.items() if k not in {"hash", "status"}})
        plan["status"] = "approved"
        store.put(db, "plans", plan)
        store.set_meta(db, "product_text_version", 0)
    store.initialize()
    with store.connect() as db:
        assert store.get(db, "plans", "plan-C001") == plan


def test_business_rows_endpoint_reads_actual_records(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from opsweaver import store
    from opsweaver.api import app
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "console.sqlite3")
    with TestClient(app) as client:
        response = client.get("/api/v1/sources/builtin-orders/rows?offset=25&limit=25")
        assert response.status_code == 200
        body = response.json()["data"]
        assert body["total"] == 6000 and len(body["rows"]) == 25
        assert body["rows"] == source_rows(tmp_path, "orders", 25, 25)
        detail = client.get("/api/v1/customers/C001/business").json()["data"]
        assert detail["value"] == customer_detail(tmp_path, "C001", AS_OF)["value"]
        assert client.get("/api/v1/sources/builtin-orders/rows?limit=1000").status_code == 422


def test_scan_refreshes_dataset_once_for_ten_investigations(tmp_path, monkeypatch):
    from opsweaver import service, store
    monkeypatch.setattr(store, "DATA", tmp_path)
    monkeypatch.setattr(store, "DB", tmp_path / "console.sqlite3")
    store.initialize()
    original = store.refresh_business
    calls = []
    def counted(connection):
        calls.append(True)
        return original(connection)
    monkeypatch.setattr(store, "refresh_business", counted)
    with store.transaction() as db:
        result, _ = service.dispatch(db, "scan", {})
        assert result["count"] == 10 and len(calls) == 1
        runs = store.all_items(db, "runs")
        plans = store.all_items(db, "plans")
        service.investigate(db, "inc-C001")
        assert len(calls) == 2
        assert store.all_items(db, "runs") == runs
        assert store.all_items(db, "plans") == plans
