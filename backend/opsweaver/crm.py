
import json
import secrets
import sqlite3

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .store import DATA, now, secret

app = FastAPI(title="OpsClaw Mock CRM", version="0.1.0")
DB = DATA / "mock-crm.sqlite3"
with sqlite3.connect(DB) as db:
    db.execute("CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, external_ref TEXT UNIQUE NOT NULL, document TEXT NOT NULL)")


def authorize(authorization):
    if not secrets.compare_digest(authorization or "", "Bearer " + secret("crm.token")):
        raise HTTPException(401, "CRM authentication required")


class TaskRequest(BaseModel):
    external_ref: str = Field(min_length=1, max_length=200)
    customer: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=200)
    owner: str = Field(min_length=1, max_length=100)
    due_at: str


@app.get("/health")
def health():
    return {"status": "ok", "mode": "SIMULATED"}


@app.get("/tasks")
def tasks(authorization: str | None = Header(default=None)):
    authorize(authorization)
    with sqlite3.connect(DB) as db:
        return [json.loads(r[0]) for r in db.execute("SELECT document FROM tasks ORDER BY rowid DESC")]


@app.post("/tasks")
def create(body: TaskRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    with sqlite3.connect(DB, timeout=20) as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute("SELECT document FROM tasks WHERE external_ref=?", (body.external_ref,)).fetchone()
        if old:
            return json.loads(old[0])
        item = {**body.model_dump(), "id": "CRM-" + secrets.token_hex(4).upper(), "status": "open", "created_at": now()}
        db.execute("INSERT INTO tasks VALUES(?,?,?)", (item["id"], item["external_ref"], json.dumps(item, ensure_ascii=False)))
        return item


@app.get("/tasks/by-reference/{reference}")
def by_reference(reference: str, authorization: str | None = Header(default=None)):
    authorize(authorization)
    with sqlite3.connect(DB) as db:
        row = db.execute("SELECT document FROM tasks WHERE external_ref=?", (reference,)).fetchone()
        if not row:
            raise HTTPException(404, "Task not found")
        return json.loads(row[0])


@app.post("/tasks/{task_id}/cancel")
def cancel(task_id: str, authorization: str | None = Header(default=None)):
    authorize(authorization)
    with sqlite3.connect(DB, timeout=20) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT document FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Task not found")
        item = json.loads(row[0])
        if item["status"] == "completed":
            raise HTTPException(409, "NOT_REVERSIBLE")
        item["status"] = "cancelled"
        db.execute("UPDATE tasks SET document=? WHERE id=?", (json.dumps(item, ensure_ascii=False), task_id))
        return item
