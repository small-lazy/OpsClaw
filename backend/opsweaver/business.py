
from __future__ import annotations

import json
import math
import random
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROLES = ("customers", "orders", "events", "contacts", "crm_tasks", "support_tickets")
SEED = 20260910
SPECIAL = {1, 18, 27, 56, 63, 79, 214}


def _time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _connect(data_dir: Path) -> sqlite3.Connection:
    filename = "business.sqlite3"
    app_db = Path(data_dir) / "opsweaver.sqlite3"
    from . import store
    app_db = store.DB if Path(data_dir) == store.DATA else app_db
    if app_db.exists():
        with sqlite3.connect(app_db) as state:
            try:
                active = state.execute("SELECT value FROM metadata WHERE key='external_business'").fetchone()
                if active and json.loads(active[0]):
                    filename = "user_business.sqlite3"
            except sqlite3.OperationalError:
                pass
    connection = sqlite3.connect(Path(data_dir) / filename, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize(data_dir: Path, as_of: str) -> None:

    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    now = _time(as_of)
    rng = random.Random(SEED)
    with _connect(data_dir) as db:
        db.execute("CREATE TABLE IF NOT EXISTS business_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM business_metadata WHERE key='initialized'").fetchone():
            return
        schema = [
            "CREATE TABLE IF NOT EXISTS customers(customer_id TEXT PRIMARY KEY,created_at TEXT,segment TEXT,marketing_consent INTEGER,do_not_contact INTEGER,updated_at TEXT,coverage_complete INTEGER,coverage_reason TEXT,first_observed_at TEXT)",
            "CREATE TABLE IF NOT EXISTS orders(order_id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(customer_id),paid_at TEXT,status TEXT,paid_amount_minor INTEGER,refunded_amount_minor INTEGER,currency TEXT,updated_at TEXT)",
            "CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(customer_id),event_name TEXT,event_time TEXT,session_id TEXT)",
            "CREATE TABLE IF NOT EXISTS contacts(contact_id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(customer_id),purpose TEXT,channel TEXT,status TEXT,occurred_at TEXT,external_ref TEXT)",
            "CREATE TABLE IF NOT EXISTS crm_tasks(task_id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(customer_id),purpose TEXT,signal_episode_ref TEXT,status TEXT,owner_id TEXT,due_at TEXT,updated_at TEXT)",
            "CREATE TABLE IF NOT EXISTS support_tickets(ticket_id TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(customer_id),category TEXT,status TEXT,opened_at TEXT,updated_at TEXT)",
        ]
        for statement in schema:
            db.execute(statement)
        def at(days: float = 0, hours: float = 0) -> str:
            return (now - timedelta(days=days, hours=hours)).isoformat()
        for n in range(1, 501):
            cid = f"C{n:03d}"
            risk = n in SPECIAL or n % 7 == 0
            coverage = n not in {56, 214}
            consent = None if n % 19 == 0 else int(n % 17 != 0)
            db.execute("INSERT INTO customers VALUES(?,?,?,?,?,?,?,?,?)", (cid, at(400 + n), "高价值客户" if risk else ("成长客户" if n % 3 else "稳定复购客户"), consent, int(n % 97 == 0), at(), int(coverage), "" if coverage else "CRM 触达历史未覆盖全部负责人", at(hours=30 + n % 90)))
            for j in range(12):
                age = ([16, 20, 32, 37, 42, 47, 52, 57, 62, 67, 72, 80][j] if risk else [2, 7, 12, 18, 24, 31, 38, 45, 52, 59, 66, 78][j])
                amount = (200000 + rng.randrange(20000)) if n in SPECIAL else (90000 + rng.randrange(25000) if risk else 4000 + rng.randrange(45000))
                refund = amount // 5 if j == 5 and n % 4 == 0 else 0
                db.execute("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)", (f"O-{cid}-{j+1:02d}", cid, at(age, j / 4), "paid", amount, refund, "CNY", at()))
            for j in range(60):
                age = 15 + j if risk else j + 0.5
                db.execute("INSERT INTO events VALUES(?,?,?,?,?)", (f"E-{cid}-{j+1:03d}", cid, "session_start", at(age), f"S-{cid}-{j+1:03d}"))

            if n % 4 == 0 or n in {1, 18, 27, 63, 79}:
                recent = n not in SPECIAL and n % 4 == 0
                db.execute("INSERT INTO contacts VALUES(?,?,?,?,?,?,?)", (f"CT-{cid}", cid, "retention", "crm", "completed", at(1 if recent else 10), f"contact-ref-{cid}"))
            if n == 27 or (n not in SPECIAL and n % 5 == 0):
                db.execute("INSERT INTO crm_tasks VALUES(?,?,?,?,?,?,?,?)", (f"TASK-{cid}", cid, "retention_followup", f"episode-{cid}", "open", "客户成功组", at(2) if n == 27 else at(-2), at(3)))
            if n in {1, 79} or n % 23 == 0:
                category = "payment_failed" if n == 1 else "complaint" if n == 79 else "delivery"
                db.execute("INSERT INTO support_tickets VALUES(?,?,?,?,?,?)", (f"SUP-{cid}", cid, category, "open", at(3), at(1)))
        for table, col in (("orders", "paid_at"), ("events", "event_time"), ("contacts", "occurred_at"), ("crm_tasks", "due_at"), ("support_tickets", "opened_at")):
            db.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_customer_time ON {table}(customer_id,{col})")
        for key, value in {"initialized": True, "seed": SEED, "as_of": now.isoformat(), "origin": "built_in", "signal_history": "preloaded_first_observed_at"}.items():
            db.execute("INSERT INTO business_metadata VALUES(?,?)", (key, json.dumps(value)))


def source_rows(data_dir: Path, role: str, offset: int = 0, limit: int = 50) -> list[dict[str, Any]]:
    if role not in ROLES:
        raise ValueError("Unknown business table")
    if offset < 0 or not 1 <= limit <= 100:
        raise ValueError("offset must be nonnegative; limit must be 1–100")
    with _connect(data_dir) as db:
        return [dict(row) for row in db.execute(f"SELECT * FROM {role} ORDER BY rowid LIMIT ? OFFSET ?", (limit, offset))]


def source_stats(data_dir: Path) -> list[dict[str, Any]]:
    with _connect(data_dir) as db:
        return [{"role": role, "rows": db.execute(f"SELECT COUNT(*) FROM {role}").fetchone()[0], "columns": [row[1] for row in db.execute(f"PRAGMA table_info({role})")], "preview": [dict(row) for row in db.execute(f"SELECT * FROM {role} ORDER BY rowid LIMIT 5")]} for role in ROLES]


def _aggregate(db: sqlite3.Connection, now: datetime) -> list[dict[str, Any]]:
    cutoff = lambda days: (now - timedelta(days=days)).isoformat()
    rows = db.execute("""
      WITH o AS (
        SELECT customer_id,
          SUM(CASE WHEN paid_at>=:d90 AND paid_at<:asof AND status='paid' THEN paid_amount_minor-refunded_amount_minor ELSE 0 END) net90,
          SUM(CASE WHEN paid_at>=:d28 AND paid_at<:asof AND status='paid' THEN 1 ELSE 0 END) orders28,
          SUM(CASE WHEN paid_at>=:d14 AND paid_at<:asof AND status='paid' THEN 1 ELSE 0 END) orders14,
          MAX(CASE WHEN status='paid' AND paid_at<:asof THEN paid_at END) last_payment
        FROM orders GROUP BY customer_id
      ), e AS (
        SELECT customer_id,
          COUNT(DISTINCT CASE WHEN event_time>=:d14 AND event_time<:asof THEN session_id END) sessions14,
          COUNT(DISTINCT CASE WHEN event_time>=:d28 AND event_time<:d14 THEN session_id END) sessions_previous14
        FROM events GROUP BY customer_id
      )
      SELECT c.*,COALESCE(o.net90,0) net90,COALESCE(o.orders28,0) orders28,COALESCE(o.orders14,0) orders14,o.last_payment,
        COALESCE(e.sessions14,0) sessions14,COALESCE(e.sessions_previous14,0) sessions_previous14
      FROM customers c LEFT JOIN o USING(customer_id) LEFT JOIN e USING(customer_id) ORDER BY c.customer_id
    """, {"asof": now.isoformat(), "d90": cutoff(90), "d28": cutoff(28), "d14": cutoff(14)}).fetchall()
    values = sorted(row["net90"] for row in rows if row["net90"] > 0)
    position = (len(values) - 1) * .8 if values else 0
    threshold = values[math.floor(position)] + (values[math.ceil(position)] - values[math.floor(position)]) * (position % 1) if values else None
    meta = db.execute("SELECT value FROM business_metadata WHERE key='as_of'").fetchone()
    watermark = _time(json.loads(meta[0]))
    complete_window = watermark >= now and now - watermark <= timedelta(hours=24)
    origin = db.execute("SELECT value FROM business_metadata WHERE key='origin'").fetchone()
    if origin and json.loads(origin[0]) == "user_upload":
        roles = db.execute("SELECT value FROM business_metadata WHERE key='roles'").fetchone()
        complete_window = complete_window and roles is not None and set(json.loads(roles[0])) == set(ROLES)
    result = []
    for row in rows:
        item = dict(row)
        cid = item["customer_id"]
        contacts = [dict(r) for r in db.execute("SELECT * FROM contacts WHERE customer_id=? AND occurred_at>=? AND occurred_at<? AND purpose IN ('retention','retention_followup') AND status IN ('sent','completed')", (cid, cutoff(3), now.isoformat()))]
        tasks = [dict(r) for r in db.execute("SELECT * FROM crm_tasks WHERE customer_id=? AND status IN ('open','in_progress') AND updated_at<=?", (cid, now.isoformat()))]
        tickets = [dict(r) for r in db.execute("SELECT * FROM support_tickets WHERE customer_id=? AND status IN ('open','in_progress') AND opened_at<=?", (cid, now.isoformat()))]
        overdue = [task for task in tasks if _time(task["due_at"]) < now]
        value_percentile = sum(v <= item["net90"] for v in values) / max(len(values), 1)
        hours = max(0, int((now - _time(item["first_observed_at"])).total_seconds() // 3600))
        item.update(p80_minor=threshold, high_value=threshold is not None and item["net90"] >= max(50000, threshold), successful_contacts_72h=contacts, active_tasks=tasks, overdue_tasks=overdue, open_support_tickets=tickets, hours=hours, value_percentile=value_percentile, watermark=watermark.isoformat(), data_fresh=complete_window)
        result.append(item)
    return result


def customer_detail(data_dir: Path, customer_id: str, asof: str) -> dict[str, Any]:
    now = _time(asof)
    with _connect(data_dir) as db:
        item = next((item for item in _aggregate(db, now) if item["customer_id"] == customer_id), None)
        if item is None:
            raise ValueError("Customer not found")
        item["orders"] = [dict(row) for row in db.execute("SELECT * FROM orders WHERE customer_id=? AND paid_at<? ORDER BY paid_at DESC LIMIT 20", (customer_id, now.isoformat()))]
        item["event_count"] = db.execute("SELECT COUNT(*) FROM events WHERE customer_id=? AND event_time<?", (customer_id, now.isoformat())).fetchone()[0]
        item["as_of"] = now.isoformat()
        item["currency"] = "CNY"
        item["value"] = item["net90"]
        return item


def evaluate_incidents(data_dir: Path, as_of: str) -> list[dict[str, Any]]:
    now = _time(as_of)
    with _connect(data_dir) as db:
        customers = _aggregate(db, now)
    incidents = []
    for c in customers:
        if not (c["high_value"] and c["orders28"] >= 2 and c["orders14"] == 0 and c["sessions_previous14"] >= 4 and c["sessions14"] <= c["sessions_previous14"] / 2):
            continue
        if c["hours"] < 24:
            continue
        covered = bool(c["successful_contacts_72h"] or c["active_tasks"])
        if covered and not c["overdue_tasks"]:
            continue
        complete = bool(c["coverage_complete"] and c["data_fresh"])
        overdue = c["overdue_tasks"]
        tickets = c["open_support_tickets"]
        categories = sorted({ticket["category"] for ticket in tickets})
        category_labels = {"payment_failed": "支付失败", "complaint": "投诉", "delivery": "物流售后"}
        support_text = "、".join(category_labels.get(category, category) for category in categories)
        kind = "TASK_OVERDUE" if overdue else "ACTION_MISSING"
        title = "来源覆盖待确认" if not complete else "已有任务超期，需原负责人处理" if overdue else "支付问题需要跟进" if "payment_failed" in categories else "未关闭投诉需要跟进" if "complaint" in categories else "高价值客户缺少跟进"
        severe = 1 - c["sessions14"] / max(c["sessions_previous14"], 1)
        priority = round(100 * (.45 * c["value_percentile"] + .30 * severe + .15 * min(c["hours"] / 168, 1) + .10 * int(complete)))
        crm_fact = f"存在 {len(overdue)} 条超期任务（{', '.join(task['task_id'] for task in overdue)}），保留原任务，不新建重复任务。" if overdue else f"最近 72 小时成功挽回触达 {len(c['successful_contacts_72h'])} 次，进行中任务 {len(c['active_tasks'])} 条。"
        if not complete:
            crm_fact = (c["coverage_reason"] or "当前查询时间已超过数据覆盖终点") + "，无法确认是否存在行动缺口。"
        facts = [f"最近 90 天净支付 ¥{c['net90']/100:,.2f}，高价值门槛为 P80 ¥{c['p80_minor']/100:,.2f} 且不低于 ¥500.00。", f"过去 28 天支付 {c['orders28']} 笔，最近 14 天支付 {c['orders14']} 笔；前 14 天会话 {c['sessions_previous14']} 次，最近 14 天 {c['sessions14']} 次。", crm_fact, f"查询到 {len(tickets)} 条未关闭工单：{support_text}；优先安排售后核查。" if tickets else "查询覆盖范围内未发现未关闭售后工单，可提出人工跟进任务。"]
        incidents.append({"id": "inc-" + c["customer_id"], "customer": c["customer_id"], "segment": c["segment"], "title": title, "kind": kind, "priority": priority, "status": "open" if complete else "blocked", "hours": c["hours"], "value": c["net90"], "consent": None if c["marketing_consent"] is None else bool(c["marketing_consent"]), "support": bool(tickets), "coverage": complete, "owner": overdue[0]["owner_id"] if overdue else "售后支持组" if tickets else "客户成功组", "facts": facts, "run_id": None})
    return sorted(incidents, key=lambda item: (-item["priority"], item["customer"]))


def create_empty(path: Path, as_of: str):
    """Create an isolated external workspace with the same validated relational schema."""
    from . import store
    with _connect(store.DATA) as source, sqlite3.connect(path) as target:
        for row in source.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
            statement = row[0].replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ', 1)
            target.execute(statement)
        for key, value in {'initialized': True, 'as_of': as_of, 'origin': 'user_upload'}.items():
            target.execute('INSERT OR IGNORE INTO business_metadata VALUES(?,?)', (key, json.dumps(value)))
