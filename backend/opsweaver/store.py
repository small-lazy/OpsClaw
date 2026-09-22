from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import business

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("OPSWEAVER_DATA_DIR", str(ROOT / "data")))
DATA.mkdir(parents=True, exist_ok=True)
DB = DATA / "opsweaver.sqlite3"
KINDS = ("incidents", "runs", "plans", "actions", "sources", "agents", "experiments", "memories", "skills", "audit", "datasets", "imports")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB, timeout=20)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize() -> None:
    with connect() as connection:
        for kind in KINDS:
            connection.execute(f"CREATE TABLE IF NOT EXISTS {kind}(id TEXT PRIMARY KEY, document TEXT NOT NULL)")
        connection.execute("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL)")
        connection.execute("CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL)")
        connection.execute("CREATE TABLE IF NOT EXISTS skill_versions(skill_id TEXT NOT NULL, version TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(skill_id,version))")
        connection.execute("CREATE TABLE IF NOT EXISTS dataset_rows(dataset_id TEXT NOT NULL,row_index INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(dataset_id,row_index))")
        from .growth_api import initialize as initialize_growth
        initialize_growth(connection)
        from . import model_providers, agent_runtime
        model_providers.initialize(connection)
        agent_runtime.initialize(connection)
        fresh = not connection.execute("SELECT 1 FROM metadata WHERE key='initialized'").fetchone()
        if fresh:
            seed = json.loads((ROOT / "seed.json").read_text(encoding="utf-8"))

            for kind in ("agents", "skills", "experiments", "memories"):
                for item in seed.get(kind, []):
                    put(connection, kind, item)
            for key in ("mode", "as_of", "revision", "trend", "coverage", "settings"):
                set_meta(connection, key, seed[key])
            set_meta(connection, "initialized", True)
            for skill in seed.get("skills", []):
                connection.execute("INSERT OR IGNORE INTO skill_versions VALUES(?,?,?)", (skill["id"], skill["version"], json.dumps(skill, ensure_ascii=False)))
        refresh_business(connection)
        migrate_product_text(connection)
        if fresh:
            from .service import investigate
            investigate(connection, "inc-C001", refresh=False)


def migrate_product_text(connection):
    if meta(connection, "external_business") or meta(connection, "product_text_version") == 3:
        return
    replacements = (("演示检测仍使用固定快照", "自动分析使用内置业务数据"), ("Mock CRM", "任务中心"), ("模拟外部系统", "任务中心"), ("合成演示数据", "内置业务数据"), ("合成快照", "业务快照"), ("固定演示快照", "当前业务快照"), ("演示快照", "业务快照"), ("模拟时钟", "数据时间"), ("模拟实验", "内置实验"), ("合成数据", "内置数据"), ("合成样本", "内置样本"), ("合成观察", "内置数据观察"), ("确定性演示", "确定性规则"), ("演示电商工作区", "电商运营工作区"), ("本地演示", "本机工作区"), ("演示 Agent", "运营 Agent"))
    def clean(value):
        if isinstance(value, str):
            for old, new in replacements:
                value = value.replace(old, new)
            return value
        if isinstance(value, list):
            return [clean(v) for v in value]
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items()}
        return value
    for kind in KINDS:
        if kind in {"skills", "plans"}:
            continue
        for item in all_items(connection, kind):
            if kind == "sources" and (item.get("origin") == "user_upload" or item["id"].startswith("upload-")):
                continue
            put(connection, kind, clean(item))
    set_meta(connection, "settings", clean(meta(connection, "settings")))
    set_meta(connection, "product_text_version", 3)


def refresh_business(connection):

    as_of = meta(connection, "as_of")
    if not meta(connection, "external_business"):
        business.initialize(DATA, as_of)
    labels = {"customers": "客户档案", "orders": "订单明细", "events": "行为事件", "contacts": "触达记录", "crm_tasks": "CRM 任务", "support_tickets": "售后工单"}
    prior_sources = all_items(connection, "sources")
    for stat in business.source_stats(DATA):
        old = next((s for s in prior_sources if s["role"] == stat["role"] and s.get("origin") != "user_upload" and not s["id"].startswith("upload-")), None)
        partial = stat["role"] not in (meta(connection, "external_roles") or []) if meta(connection, "external_business") else stat["role"] == "contacts"
        source = {"id": old["id"] if old else "builtin-" + stat["role"], "role": stat["role"], "name": labels[stat["role"]], "rows": stat["rows"], "columns": stat["columns"], "preview": [{k: "未知" if v is None else str(v) for k, v in row.items()} for row in stat["preview"]], "status": "incomplete" if partial else "ready", "coverage": not partial, "as_of": as_of, "origin": "business_workspace" if meta(connection, "external_business") else "built_in", "analysis_scope": "business_sqlite"}
        put(connection, "sources", source)
    computed = business.evaluate_incidents(DATA, as_of)
    computed_ids = {item["id"] for item in computed}
    for previous in all_items(connection, "incidents"):
        if previous["id"] in computed_ids or previous.get("run_id") or previous.get("business_eligible") is False:
            continue

        try:
            detail = business.customer_detail(DATA, previous["customer"], as_of)
        except ValueError:
            connection.execute("DELETE FROM incidents WHERE id=?", (previous["id"],))
            continue
        if not meta(connection, "legacy_incident:" + previous["id"]):
            set_meta(connection, "legacy_incident:" + previous["id"], previous)
        previous.update(status="dismissed", title="历史案件：当前未满足缺口条件", value=detail["net90"], business_eligible=False, facts=[f"最近 90 天净支付 ¥{detail['net90']/100:,.2f}。", f"过去 28 天支付 {detail['orders28']} 笔，最近 14 天支付 {detail['orders14']} 笔；最近/前一周期会话 {detail['sessions14']}/{detail['sessions_previous14']} 次。", f"查询到成功触达 {len(detail['successful_contacts_72h'])} 次、进行中任务 {len(detail['active_tasks'])} 条。", f"未关闭售后工单 {len(detail['open_support_tickets'])} 条；当前组合条件未产生新的行动缺口。"])
        put(connection, "incidents", previous)
    for incident in computed:
        incident["business_eligible"] = True
        previous = get(connection, "incidents", incident["id"])
        if previous and (previous.get("run_id") or previous["status"] not in {"open", "blocked"}):
            incident["status"] = previous["status"]
            incident["run_id"] = previous.get("run_id")
        put(connection, "incidents", incident)
    set_meta(connection, "mode", "USER_DATA" if meta(connection, "external_business") else "BUILT_IN")
    set_meta(connection, "business_data_version", 1)
    update_operational_metrics(connection)
    return computed


def update_operational_metrics(connection):
    as_of = datetime.fromisoformat(meta(connection, "as_of"))
    incidents = all_items(connection, "incidents")
    actions = all_items(connection, "actions")

    with business._connect(DATA) as records:
        first = {r["customer_id"]: datetime.fromisoformat(r["first_observed_at"]) + timedelta(hours=24) for r in records.execute("SELECT customer_id,first_observed_at FROM customers")}
    confirmed = [i for i in incidents if i["coverage"] and i.get("business_eligible", False) and i["kind"] == "ACTION_MISSING" and i["customer"] in first]
    mature = [i for i in confirmed if first[i["customer"]] + timedelta(hours=24) <= as_of]
    by_customer = {a["customer"]: a for a in actions if a["status"] == "succeeded" and a.get("verified_at")}
    covered = sum(i["customer"] in by_customer and datetime.fromisoformat(by_customer[i["customer"]]["verified_at"]) <= first[i["customer"]] + timedelta(hours=24) for i in mature)
    prior = [i for i in confirmed if as_of - timedelta(days=14) <= first[i["customer"]] < as_of - timedelta(days=7)]
    prior_covered = sum(i["customer"] in by_customer and datetime.fromisoformat(by_customer[i["customer"]]["verified_at"]) <= first[i["customer"]] + timedelta(hours=24) for i in prior)
    set_meta(connection, "coverage", {"numerator": covered, "denominator": len(mature), "previous": prior_covered / len(prior) if prior else 0, "previous_denominator": len(prior)})
    trend = []
    for offset in range(29, -1, -1):
        day = (as_of - timedelta(days=offset)).date()
        detected = sum(first[i["customer"]].date() == day for i in confirmed)
        acted = sum(datetime.fromisoformat(a["verified_at"]).astimezone(as_of.tzinfo).date() == day for a in by_customer.values())
        trend.append({"date": day.strftime("%m/%d"), "detected": detected, "covered": acted})
    set_meta(connection, "trend", trend)


def all_items(connection, kind: str):
    if kind not in KINDS:
        raise ValueError("Unknown entity")
    return [json.loads(r["document"]) for r in connection.execute(f"SELECT document FROM {kind} ORDER BY rowid")]


def get(connection, kind: str, entity_id: str):
    if kind not in KINDS:
        raise ValueError("Unknown entity")
    row = connection.execute(f"SELECT document FROM {kind} WHERE id=?", (entity_id,)).fetchone()
    return json.loads(row["document"]) if row else None


def put(connection, kind: str, item: dict):
    if kind not in KINDS:
        raise ValueError("Unknown entity")
    connection.execute(f"INSERT INTO {kind}(id,document) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document", (item["id"], json.dumps(item, ensure_ascii=False)))
    return item


def meta(connection, key):
    row = connection.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def set_meta(connection, key, value):
    connection.execute("INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value, ensure_ascii=False)))


def snapshot(connection):
    result = {kind: all_items(connection, kind) for kind in KINDS}
    for key in ("mode", "as_of", "revision", "trend", "coverage", "settings"):
        result[key] = meta(connection, key)
    return result


def audit(connection, operation, detail):
    put(connection, "audit", {"id": secrets.token_hex(12), "operation": operation, "detail": detail, "at": now()})
    set_meta(connection, "revision", (meta(connection, "revision") or 0) + 1)


@contextmanager
def transaction():
    connection = connect()
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def secret(name: str) -> str:
    path = DATA / name
    if not path.exists():
        try:
            with path.open("x", encoding="utf-8") as handle:
                handle.write(secrets.token_urlsafe(40))
        except FileExistsError:
            pass
    return path.read_text(encoding="utf-8").strip()
