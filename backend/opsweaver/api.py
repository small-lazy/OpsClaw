from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import Depends, FastAPI, Header, Request, Response, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse

from . import store
from .schemas import Arguments, ConsoleEnvelope
from .service import DomainError, crm_request, dispatch, mcp_invoke, require, skill_arguments


@asynccontextmanager
async def lifespan(app):
    store.initialize()
    store.secret("mcp.token")
    yield


app = FastAPI(title="OpsClaw Local API", version="0.1.0", lifespan=lifespan)


@app.exception_handler(DomainError)
async def domain_error(request, error):
    return JSONResponse(status_code=error.status, content={"error": {"code": error.code, "message": error.message, "retryable": error.status >= 500}})


@app.middleware("http")
async def local_boundary(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in ("http://127.0.0.1:3100", "http://localhost:3100", "http://127.0.0.1:8100"):
            return JSONResponse(status_code=403, content={"error": {"code": "ORIGIN_FORBIDDEN", "message": "请求来源未授权。"}})
        if int(request.headers.get("content-length", "0") or 0) > 55 * 1024 * 1024:
            return JSONResponse(status_code=413, content={"error": {"code": "FILE_TOO_LARGE", "message": "请求过大。"}})
    return await call_next(request)


def session(request: Request):
    token = request.cookies.get("opsweaver_session", "")
    with store.connect() as connection:
        row = connection.execute("SELECT created_at FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not row or (datetime.now(timezone.utc) - datetime.fromisoformat(row["created_at"])).total_seconds() > 86400:
        raise DomainError("LOGIN_REQUIRED", "工作区会话已过期，请刷新后重试。", 401)


def mcp_auth(authorization: str | None = Header(default=None)):
    if not secrets.compare_digest(authorization or "", "Bearer " + store.secret("mcp.token")):
        raise DomainError("MCP_UNAUTHORIZED", "MCP 本地凭据无效。", 401)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "mode": "builtin", "database": "sqlite", "analysis": "evidence-rules"}


@app.get("/api/v1/mcp-config")
def mcp_config():
    return {"data": {"command": sys.executable, "args": [str(store.ROOT / "opsweaver" / "mcp_server.py")], "cwd": str(store.ROOT), "transport": "stdio"}}


@app.post("/api/v1/workspace/session")
@app.post("/api/v1/auth/demo", include_in_schema=False)
def demo(request: Request, response: Response):
    try:
        session(request)
        return {"data": {"role": "workspace-owner", "mode": "builtin"}}
    except DomainError:
        pass
    token = secrets.token_urlsafe(32)
    with store.connect() as connection:
        connection.execute("INSERT INTO sessions VALUES(?,?)", (hashlib.sha256(token.encode()).hexdigest(), store.now()))
    response.set_cookie("opsweaver_session", token, httponly=True, samesite="strict", max_age=86400)
    return {"data": {"role": "workspace-owner", "mode": "builtin"}}


@app.post("/api/v1/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("opsweaver_session", "")
    with store.connect() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie("opsweaver_session")
    return {"data": {"revoked": True}}


@app.get("/api/v1/console", response_model=ConsoleEnvelope)
def console():
    with store.connect() as connection:
        return {"data": store.snapshot(connection)}


@app.post("/api/v1/commands/{command}", dependencies=[Depends(session)])
def command(command: str, payload: dict, idempotency_key: str | None = Header(default=None)):
    if not idempotency_key or len(idempotency_key) > 200:
        raise DomainError("IDEMPOTENCY_REQUIRED", "写操作必须包含有效的幂等键。", 422)
    key = command + ":" + idempotency_key
    request_hash = store.digest(payload)
    with store.transaction() as connection:
        prior = connection.execute("SELECT * FROM requests WHERE key=?", (key,)).fetchone()
        if prior:
            if prior["request_hash"] != request_hash:
                raise DomainError("IDEMPOTENCY_CONFLICT", "相同幂等键不能用于不同内容。")
            return json.loads(prior["response"])
        result, message = dispatch(connection, command, payload)
        store.audit(connection, command, message)
        body = {"data": result, "message": message}
        connection.execute("INSERT INTO requests VALUES(?,?,?)", (key, request_hash, json.dumps(body, ensure_ascii=False)))
        return body


@app.get("/api/v1/crm-tasks")
def crm_tasks():
    try:
        return {"data": crm_request("GET", "/tasks")}
    except httpx.HTTPError as error:
        raise DomainError("CRM_UNAVAILABLE", "CRM 暂不可用。", 502) from error


@app.get("/api/v1/events")
async def events(request: Request):
    async def generate():
        last = request.headers.get("last-event-id", "")
        while not await request.is_disconnected():
            with store.connect() as connection:
                revision = str(store.meta(connection, "revision"))
            if revision != last:
                yield f"id: {revision}\nevent: change\ndata: {{\"revision\": {revision}}}\n\n"
                last = revision
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(2)
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.get("/api/v1/mcp/skills", dependencies=[Depends(mcp_auth)])
def mcp_skills():
    with store.connect() as connection:
        return {"data": [s for s in store.all_items(connection, "skills") if s["status"] == "active"]}


@app.get("/api/v1/mcp/skills/{skill_id}", dependencies=[Depends(mcp_auth)])
def mcp_skill(skill_id: str):
    with store.connect() as connection:
        skill = require(connection, "skills", skill_id)
        if skill["status"] != "active":
            raise DomainError("SKILL_DISABLED", "Skill 已停用。", 403)
        return {"data": skill}


@app.get("/api/v1/mcp/summary", dependencies=[Depends(mcp_auth)])
def mcp_summary():
    with store.connect() as connection:
        return {"data": mcp_invoke(connection, {"status": "active", "tools": ["console_summary"]}, "console_summary", {})}


@app.post("/api/v1/mcp/skills/{skill_id}/run", dependencies=[Depends(mcp_auth)])
def mcp_run(skill_id: str, body: Arguments):
    with store.transaction() as connection:
        skill = require(connection, "skills", skill_id)
        if skill["status"] != "active":
            raise DomainError("SKILL_DISABLED", "Skill 已停用。", 403)
        skill_arguments(skill, body.arguments)
        context = None
        if body.arguments.get("customer_id") and "get_incident" in skill["tools"]:
            context = mcp_invoke(connection, skill, "get_incident", body.arguments)
        result = {"skill_id": skill_id, "version": skill["version"], "instructions": skill["instructions"], "input": body.arguments, "context": context, "allowed_tools": skill["tools"], "mode": "BUILT_IN", "execution": "instructions_for_calling_agent", "notice": "由调用方 Agent 解释 Skill 指令。工具调用仍需逐次经过本服务白名单；此调用未自动执行任何写操作。"}
        store.audit(connection, "mcp.run_skill", "返回 Skill " + skill["name"] + " v" + skill["version"] + " 的指令与授权上下文。")
        return {"data": result}


@app.post("/api/v1/mcp/skills/{skill_id}/tools/{tool}", dependencies=[Depends(mcp_auth)])
def mcp_tool(skill_id: str, tool: str, body: Arguments):
    with store.transaction() as connection:
        skill = require(connection, "skills", skill_id)
        result = mcp_invoke(connection, skill, tool, body.arguments)
        store.audit(connection, "mcp." + tool, "Skill " + skill_id + " 调用已注册工具；不提供批准或执行权限。")
        return {"data": result}


@app.get("/api/v1/sources/{source_id}/rows")
def source_data_rows(source_id: str, offset: int = 0, limit: int = 25):
    import csv
    from . import business
    if offset < 0 or not 1 <= limit <= 100:
        raise DomainError("INVALID_PAGE", "offset 不能小于 0，limit 需为 1–100。", 422)
    with store.connect() as connection:
        source = require(connection, "sources", source_id)
    if source.get("dataset_id"):
        from . import imports
        with store.connect() as connection:
            return {"data": imports.rows(connection, source["dataset_id"], offset, limit)}
    if source.get("origin") == "user_upload" or source_id.startswith("upload-"):

        import re
        if not re.fullmatch(r"upload-[a-f0-9]+", source_id):
            raise DomainError("INVALID_SOURCE", "上传数据源标识无效。", 422)
        path = store.DATA / (source_id + ".csv")
        if not path.exists():
            raise DomainError("SOURCE_FILE_MISSING", "该来源的原始文件不存在。", 404)
        try:
            with path.open(encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                rows = []
                for index, row in enumerate(reader):
                    if index >= offset + limit:
                        break
                    if index >= offset:
                        rows.append({k: v[:1000] if isinstance(v, str) else v for k, v in row.items()})
        except csv.Error as error:
            raise DomainError("INVALID_CSV", "CSV 内容无法解析。", 422) from error
    else:
        rows = business.source_rows(store.DATA, source["role"], offset, limit)
    return {"data": {"rows": rows, "total": source["rows"], "offset": offset, "limit": limit}}


@app.get("/api/v1/customers/{customer_id}/business")
def customer_business_detail(customer_id: str):
    from . import business
    with store.connect() as connection:
        as_of = store.meta(connection, "as_of")
    try:
        return {"data": business.customer_detail(store.DATA, customer_id, as_of)}
    except ValueError as error:
        raise DomainError("CUSTOMER_NOT_FOUND", "没有找到该客户的业务记录。", 404) from error


@app.post('/api/v1/imports', dependencies=[Depends(session)])
async def import_uploads(files: list[UploadFile] = File(...)):
    from . import imports
    from starlette.concurrency import run_in_threadpool
    if not 1 <= len(files) <= 50:
        raise DomainError('FILE_COUNT_LIMIT', '每批上传 1–50 个文件。', 422)
    payload, total = [], 0
    try:
        for upload in files:
            raw = await upload.read(imports.MAX_FILE + 1)
            total += len(raw)
            if total > 50 * 1024 * 1024:
                raise DomainError('BATCH_TOO_LARGE', '每批文件总大小不能超过 50 MB。', 413)
            name = (upload.filename or 'unnamed').replace('\\', '/').split('/')[-1]
            payload.append((name, raw))
        return {'data': await run_in_threadpool(imports.import_files, payload)}
    finally:
        for upload in files:
            await upload.close()


@app.get('/api/v1/imports')
def import_history():
    with store.connect() as connection:
        return {'data': list(reversed(store.all_items(connection, 'imports')))}


@app.get('/api/v1/imports/{import_id}')
def import_detail(import_id: str):
    with store.connect() as connection:
        return {'data': require(connection, 'imports', import_id)}


@app.get('/api/v1/datasets')
def dataset_list():
    with store.connect() as connection:
        return {'data': list(reversed(store.all_items(connection, 'datasets')))}


@app.get('/api/v1/datasets/{dataset_id}')
def dataset_detail(dataset_id: str):
    with store.connect() as connection:
        return {'data': require(connection, 'datasets', dataset_id)}


@app.get('/api/v1/datasets/{dataset_id}/rows')
def dataset_rows(dataset_id: str, offset: int = 0, limit: int = 25):
    from . import imports
    with store.connect() as connection:
        return {'data': imports.rows(connection, dataset_id, offset, limit)}


@app.post('/api/v1/datasets/{dataset_id}/activate', dependencies=[Depends(session)])
def dataset_activate(dataset_id: str):
    from . import imports
    return {'data': imports.activate(dataset_id)}


@app.get('/api/v1/business-schema')
def business_schema():
    from . import business
    with business._connect(store.DATA) as connection:
        tables = [{'role': role, 'columns': [row[1] for row in connection.execute(f'PRAGMA table_info({role})')]} for role in business.ROLES]
    return {'data': {'tables': tables, 'activation': '客户表先接入，其他表按 customer_id 关联；按主键合并。', 'currency': 'CNY', 'amount_unit': 'minor', 'timestamp': 'ISO 8601；无时区时间按 UTC 处理。'}}
