from __future__ import annotations

import csv
import io
import json
import secrets
from datetime import datetime, timedelta

import httpx
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from . import business, store
from .schemas import SkillInput

TOOLS = {"console_summary", "list_incidents", "get_incident", "investigate", "request_plan"}
ROLES = {"customers", "orders", "events", "contacts", "crm_tasks", "support_tickets"}


class DomainError(Exception):
    def __init__(self, code: str, message: str, status=409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def require(connection, kind, entity_id):
    item = store.get(connection, kind, entity_id)
    if not item:
        raise DomainError("NOT_FOUND", "当前工作区没有找到该记录。", 404)
    return item


def active(connection):
    if store.meta(connection, "settings")["kill_switch"]:
        raise DomainError("EMERGENCY_STOP", "自动执行已停止，请由管理员在设置中恢复。")


def event(run, node, title, detail, status="completed", tool=None):
    item = {"id": str(len(run["events"]) + 1), "node": node, "title": title, "detail": detail, "status": status, "at": store.now()}
    if tool:
        item["tool"] = tool
    run["events"].append(item)


def investigate(connection, incident_id, propose=True, refresh=True):
    active(connection)
    if refresh:
        store.refresh_business(connection)
    incident = require(connection, "incidents", incident_id)
    if not incident["coverage"]:
        raise DomainError("INCOMPLETE_COVERAGE", "数据来源不完整，不能把没有记录解释为无人跟进。")
    if incident["hours"] < 24:
        raise DomainError("GRACE_PERIOD", "信号尚未经过 24 小时宽限期。")
    existing_run = store.get(connection, "runs", incident["run_id"]) if incident["run_id"] else None
    has_plan = any(p["incident_id"] == incident_id for p in store.all_items(connection, "plans"))
    if existing_run and (not propose or has_plan or incident["kind"] == "TASK_OVERDUE"):
        return {"run_id": incident["run_id"], "reused": True}
    settings = store.meta(connection, "settings")
    if not existing_run and len(store.all_items(connection, "runs")) >= settings["daily_limit"]:
        raise DomainError("INVESTIGATION_LIMIT", "当前数据范围的调查额度已用完。", 429)
    agent = require(connection, "agents", "retention")
    if agent["status"] != "active":
        raise DomainError("AGENT_PAUSED", "请先激活 Agent。")
    run = existing_run or {"id": f"run-{incident['customer']}", "incident_id": incident_id, "customer": incident["customer"], "title": "客户支付与售后调查" if incident["support"] else "高价值用户跟进调查", "state": "waiting_approval", "started_at": store.now(), "model_calls": 0, "tool_calls": 3, "events": []}
    if not existing_run:
        event(run, "detect", "确认业务数据中的行动缺口", incident["facts"][1], tool="metrics.evaluate")
        event(run, "investigate", "核查 CRM 与工单证据", " ".join(incident["facts"][2:]), tool="crm.lookup / support.lookup")
    if incident["kind"] == "TASK_OVERDUE":
        run["state"] = "blocked"
        event(run, "plan", "保留原任务，转交原负责人", "已存在超期任务。当前适配器尚不支持升级原任务，不能新建重复跟进任务。", "blocked")
        incident["status"] = "covered"
    elif not propose:
        run["state"] = "completed"
        event(run, "investigate", "仅完成证据调查", "当前 Skill 未请求提案，不创建行动方案。", tool="investigate")
        incident["status"] = "investigating"
    else:
        run["state"] = "waiting_approval"
        purpose = "support_followup" if incident["support"] else "retention_followup"
        plan = {"id": f"plan-{incident['customer']}", "incident_id": incident_id, "run_id": run["id"], "customer": incident["customer"], "title": incident["customer"] + (" · 售后协调任务" if incident["support"] else " · 高价值用户跟进计划"), "purpose": purpose, "owner": "售后支持组" if incident["support"] else "客户成功组", "status": "pending", "version": 1, "budget": 0, "expires_at": (datetime.fromisoformat(store.meta(connection, "as_of")) + timedelta(days=1)).isoformat(), "reason": incident["facts"][3], "checks": ["来源覆盖与时效已确认", "精确客户范围已固定", "未发现同目的进行中任务", "只创建人工任务，不执行营销"]}
        plan["hash"] = store.digest({k: v for k, v in plan.items() if k != "status"})
        store.put(connection, "plans", plan)
        event(run, "plan", "生成任务方案", plan["title"] + "；预算 ¥0.00。", tool="policy.check")
        event(run, "approve", "等待人工审批", "方案 hash 已固定；尚未写入外部系统。", "waiting_approval")
        incident["status"] = "action_planned"
    incident["run_id"] = run["id"]
    store.put(connection, "incidents", incident)
    store.put(connection, "runs", run)
    if not existing_run:
        agent["runs"] += 1
    store.put(connection, "agents", agent)
    return {"run_id": run["id"]}


def crm_request(method, path, payload=None):
    response = httpx.request(method, "http://127.0.0.1:8101" + path, headers={"Authorization": "Bearer " + store.secret("crm.token")}, json=payload, timeout=8, trust_env=False)
    response.raise_for_status()
    return response.json()


def verify_action(connection, action, receipt):
    if any(receipt.get(key) != action[key] for key in ("customer", "title", "owner")) or receipt.get("external_ref") != action["idempotency_key"]:
        action["status"] = "unknown"
        store.put(connection, "actions", action)
        return False
    if receipt.get("status") == "cancelled":
        action["status"] = "compensated"
    else:
        action["status"] = "succeeded"
    action["external_id"] = receipt["id"]
    action["verified_at"] = store.now()
    store.put(connection, "actions", action)
    plan = require(connection, "plans", action["plan_id"])
    incident = require(connection, "incidents", plan["incident_id"])
    run = require(connection, "runs", plan["run_id"])
    if receipt.get("status") == "cancelled":
        incident["status"] = "dismissed"
        run["state"] = "cancelled"
        store.put(connection, "incidents", incident)
        store.put(connection, "runs", run)
        store.update_operational_metrics(connection)
        return True
    incident["status"] = "observing"
    run["state"] = "waiting_observation"
    if not any(e["node"] == "execute" and e["status"] == "completed" for e in run["events"]):
        event(run, "execute", "CRM 创建与回读验证完成", "独立 CRM 对象 " + receipt["id"] + " 已核对客户、任务参数和负责人。", tool="mock_crm.create / get")
        event(run, "observe", "等待 7 天新数据", "观察到期：" + action["due_at"] + "。任务创建不代表触达或挽回成功。", "waiting_observation")
    store.put(connection, "incidents", incident)
    store.put(connection, "runs", run)
    store.update_operational_metrics(connection)
    return True


def execute(connection, plan_id):
    active(connection)
    plan = require(connection, "plans", plan_id)
    if plan["status"] != "approved":
        raise DomainError("APPROVAL_REQUIRED", "该方案尚未获得有效审批。", 403)
    if datetime.fromisoformat(plan["expires_at"]) <= datetime.fromisoformat(store.meta(connection, "as_of")):
        raise DomainError("PLAN_EXPIRED", "方案已超过数据时间下的有效期。")
    incident = require(connection, "incidents", plan["incident_id"])
    if not incident["coverage"]:
        raise DomainError("INCOMPLETE_COVERAGE", "执行前复核发现来源不完整。")
    if incident["support"] and plan["purpose"] != "support_followup":
        raise DomainError("SUPPORT_RESTRICTION", "存在未关闭售后工单，不能执行普通挽回。", 403)
    previous = next((a for a in store.all_items(connection, "actions") if a["plan_id"] == plan_id), None)
    if previous:
        return {"action_id": previous["id"], "status": previous["status"], "reused": True}
    key = "mock-" + store.digest({"incident": incident["id"], "purpose": plan["purpose"], "version": plan["version"]})[:36]
    action = {"id": "act-" + secrets.token_hex(6), "customer": plan["customer"], "title": plan["title"], "owner": plan["owner"], "status": "running", "external_id": "", "idempotency_key": key, "verified_at": "", "due_at": (datetime.fromisoformat(store.meta(connection, "as_of")) + timedelta(days=7)).isoformat(), "plan_id": plan_id}
    try:
        existing = crm_request("GET", "/tasks")
        if any(t["customer"] == plan["customer"] and t["status"] == "open" and t["external_ref"] != key for t in existing):
            raise DomainError("ALREADY_COVERED", "执行前回读发现已有相关任务，已阻止重复创建。")
        crm_request("POST", "/tasks", {"external_ref": key, "customer": plan["customer"], "title": plan["title"], "owner": plan["owner"], "due_at": (datetime.fromisoformat(store.meta(connection, "as_of")) + timedelta(days=1)).isoformat()})
        receipt = crm_request("GET", "/tasks/by-reference/" + key)
        verify_action(connection, action, receipt)
    except (httpx.HTTPError, ValueError):
        action["status"] = "unknown"
        store.put(connection, "actions", action)
    return {"action_id": action["id"], "status": action["status"]}


def schema_validate(schema_text):
    try:
        schema = json.loads(schema_text)
        if not isinstance(schema, dict) or schema.get("type") != "object":
            raise ValueError("根类型必须为 object")

        def check(value):
            if isinstance(value, dict):
                if "$ref" in value or "$dynamicRef" in value:
                    raise ValueError("当前仅支持内联 Schema，不允许引用外部资源")
                for child in value.values():
                    check(child)
            elif isinstance(value, list):
                for child in value:
                    check(child)
        check(schema)
        Draft202012Validator.check_schema(schema)
        return schema
    except Exception as error:
        raise DomainError("INVALID_SCHEMA", "输入 Schema 无效：" + str(error)[:200], 422) from error


def skill_arguments(skill, args):
    validator = Draft202012Validator(schema_validate(skill["input_schema"]))
    errors = list(validator.iter_errors(args))
    if errors:
        raise DomainError("INVALID_ARGUMENTS", "参数不满足 Skill 输入约束：" + errors[0].message, 422)


def dispatch(connection, command, payload):
    if command == "scan":
        active(connection)
        store.refresh_business(connection)
        results = []
        for incident in sorted(store.all_items(connection, "incidents"), key=lambda item: -item["priority"]):
            if incident["coverage"] and incident["hours"] >= 24 and incident["status"] == "open" and not incident["run_id"]:
                results.append(investigate(connection, incident["id"], refresh=False))
            if len(results) >= 10:
                break
        return {"runs": results, "count": len(results)}, "内置业务数据检测完成，已保存 " + str(len(results)) + " 条调查。"
    if command == "investigate":
        return investigate(connection, payload.get("id")), "调查与证据已保存。"
    if command == "approval":
        plan = require(connection, "plans", payload.get("id"))
        if plan["status"] != "pending":
            raise DomainError("ALREADY_DECIDED", "当前方案已有最终决定，请刷新查看。")
        if plan["hash"] != payload.get("hash"):
            raise DomainError("PLAN_STALE", "方案版本已变化，请重新审阅。")
        decision = payload.get("decision")
        if decision not in ("approve", "reject"):
            raise DomainError("INVALID_DECISION", "审批决定无效。", 422)
        if decision == "reject" and not str(payload.get("comment", "")).strip():
            raise DomainError("REASON_REQUIRED", "拒绝方案必须填写原因。", 422)
        plan["status"] = "approved" if decision == "approve" else "rejected"
        plan["decided_at"] = store.now()
        plan["decided_by"] = "workspace-owner"
        plan["comment"] = str(payload.get("comment", ""))[:2000]
        store.put(connection, "plans", plan)
        run = require(connection, "runs", plan["run_id"])
        event(run, "approve", "方案已批准" if decision == "approve" else "方案已拒绝", plan["comment"] or "已核对精确范围与计划版本。")
        if decision == "reject":
            run["state"] = "cancelled"
            incident = require(connection, "incidents", plan["incident_id"])
            incident["status"] = "dismissed"
            store.put(connection, "incidents", incident)
        else:
            run["state"] = "queued"
        store.put(connection, "runs", run)
        return {"plan_id": plan["id"], "status": plan["status"]}, "方案已批准，请在动作台账执行。" if decision == "approve" else "已记录拒绝决定。"
    if command == "execute":
        result = execute(connection, payload.get("id"))
        return result, "CRM 已回读验证，等待后续观察数据。" if result["status"] == "succeeded" else "外部状态尚未确认，请先核对状态，不要重新提交。"
    if command == "reconcile":
        action = require(connection, "actions", payload.get("id"))
        try:
            receipt = crm_request("GET", "/tasks/by-reference/" + action["idempotency_key"])
            verify_action(connection, action, receipt)
        except httpx.HTTPError as error:
            raise DomainError("CRM_UNAVAILABLE", "暂未能核对外部任务，状态保持未知。", 502) from error
        return action, "外部状态已核对。"
    if command == "compensate":
        action = require(connection, "actions", payload.get("id"))
        if action["status"] not in ("succeeded", "compensated"):
            raise DomainError("NOT_REVERSIBLE", "当前动作不能取消，请先核对外部状态。")
        try:
            receipt = crm_request("POST", "/tasks/" + action["external_id"] + "/cancel")
            if receipt["status"] != "cancelled":
                raise DomainError("NOT_REVERSIBLE", "外部任务未取消。")
        except httpx.HTTPError as error:
            raise DomainError("CRM_UNAVAILABLE", "CRM 未确认取消，请稍后核对。", 502) from error
        action["status"] = "compensated"
        store.put(connection, "actions", action)
        plan = require(connection, "plans", action["plan_id"])
        run = require(connection, "runs", plan["run_id"])
        run["state"] = "cancelled"
        event(run, "execute", "任务已取消并记录补偿", action["external_id"])
        store.put(connection, "runs", run)
        incident = require(connection, "incidents", plan["incident_id"])
        incident["status"] = "dismissed"
        store.put(connection, "incidents", incident)
        store.update_operational_metrics(connection)
        return action, "任务已取消，补偿记录已保存。"
    if command == "settings":
        settings = store.meta(connection, "settings")
        if "workspace_name" in payload:
            name = str(payload["workspace_name"]).strip()
            if not name or len(name) > 50:
                raise DomainError("INVALID_NAME", "工作区名称需为 1–50 个字符。", 422)
            settings["workspace_name"] = name
        if "daily_limit" in payload:
            try:
                limit = int(payload["daily_limit"])
            except (TypeError, ValueError) as error:
                raise DomainError("INVALID_LIMIT", "调查额度必须为整数。", 422) from error
            if not 1 <= limit <= 1000:
                raise DomainError("INVALID_LIMIT", "调查额度需在 1–1000 之间。", 422)
            settings["daily_limit"] = limit
        if "kill_switch" in payload:
            if not isinstance(payload["kill_switch"], bool):
                raise DomainError("INVALID_SWITCH", "停止开关必须为布尔值。", 422)
            settings["kill_switch"] = payload["kill_switch"]
        store.set_meta(connection, "settings", settings)
        return settings, "工作区设置已保存。"
    if command == "agent-toggle":
        agent = require(connection, "agents", payload.get("id"))
        agent["status"] = "paused" if agent["status"] == "active" else "active"
        store.put(connection, "agents", agent)
        return agent, "Agent 状态已更新。"
    if command == "connection-test":
        try:
            tasks = crm_request("GET", "/tasks")
        except httpx.HTTPError as error:
            raise DomainError("CRM_UNAVAILABLE", "无法连接本地 任务中心，请检查 8101 服务。", 502) from error
        return {"connected": True, "task_count": len(tasks)}, "任务中心 连接正常，已完成真实只读请求。"
    if command == "memory-review":
        memory = require(connection, "memories", payload.get("id"))
        if payload.get("decision") not in ("approve", "retire"):
            raise DomainError("INVALID_DECISION", "审核决定无效。", 422)
        memory["status"] = "active" if payload["decision"] == "approve" else "retired"
        memory["updated_at"] = store.now()[:10]
        store.put(connection, "memories", memory)
        return memory, "记忆审核结果已保存。"
    if command == "upload":
        filename, content, role = str(payload.get("filename", "")), payload.get("content", ""), payload.get("role")
        if role not in ROLES:
            raise DomainError("INVALID_ROLE", "请选择六类标准业务表之一。", 422)
        if not filename.lower().endswith(".csv") or not isinstance(content, str):
            raise DomainError("UNSUPPORTED_FORMAT", "当前本地版已接通 CSV；XLSX 与 Parquet 尚未接通。", 422)
        if len(content.encode("utf-8")) > 50 * 1024 * 1024:
            raise DomainError("FILE_TOO_LARGE", "文件不能超过 50 MB。", 413)
        csv.field_size_limit(5 * 1024 * 1024)
        reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
        columns = reader.fieldnames
        if not columns or len(set(columns)) != len(columns) or len(columns) > 100:
            raise DomainError("INVALID_CSV", "CSV 缺少表头、表头重复或列数超限。", 422)
        preview, count = [], 0
        try:
            for row in reader:
                if None in row or any(v is None for v in row.values()):
                    raise DomainError("INVALID_CSV", "CSV 行的列数与表头不一致。", 422)
                count += 1
                if count > 500000:
                    raise DomainError("ROW_LIMIT", "单次数据集最多 500,000 行。", 413)
                if len(preview) < 50:
                    preview.append({k: v[:1000] for k, v in row.items()})
        except csv.Error as error:
            raise DomainError("INVALID_CSV", "CSV 无法解析，单个字段上限为 5 MB：" + str(error), 422) from error
        if not count:
            raise DomainError("EMPTY_CSV", "CSV 没有数据行。", 422)
        source_id = "upload-" + secrets.token_hex(6)

        (store.DATA / (source_id + ".csv")).write_text(content, encoding="utf-8")
        source = {"id": source_id, "role": role, "name": filename.replace("\\", "/").split("/")[-1], "rows": count, "status": "needs_mapping", "coverage": False, "as_of": store.meta(connection, "as_of"), "columns": columns, "preview": preview, "origin": "user_upload", "analysis_scope": "preview_only"}
        store.put(connection, "sources", source)
        return {"source_id": source_id, "columns": columns, "rows": count, "preview": preview}, "CSV 已保存与剖析，请确认映射。上传数据尚未替换内置业务数据。"
    if command == "mapping":
        source = require(connection, "sources", payload.get("source_id"))
        mapping = payload.get("mapping")
        if not isinstance(mapping, dict) or not mapping:
            raise DomainError("MAPPING_REQUIRED", "请确认字段映射。", 422)
        if payload.get("unit") not in ("yuan", "major", "minor", "元", "分", "CNY", "cents") or not payload.get("timezone"):
            raise DomainError("UNITS_REQUIRED", "请明确金额单位与时区。", 422)
        columns = source.get("columns", [])
        if any(value and value not in columns for value in mapping.values()):
            raise DomainError("MAPPING_INVALID", "映射引用了不存在的原始列。", 422)
        if not payload.get("coverage"):
            raise DomainError("COVERAGE_REQUIRED", "请明确确认来源覆盖范围。", 422)
        source.update(mapping=mapping, status="ready", coverage=True, unit=payload["unit"], timezone=payload["timezone"])
        store.put(connection, "sources", source)
        return source, "映射已保存；可查看导入数据预览。当前自动分析使用内置业务数据库，上传文件尚未加入分析管线。"
    if command == "activate":
        if payload.get("source_id"):
            source = require(connection, "sources", payload["source_id"])
            if source["status"] != "ready":
                raise DomainError("SOURCE_NOT_READY", "请先完成字段映射和覆盖确认。")
        agent = require(connection, "agents", "retention")
        agent["status"] = "active"
        store.put(connection, "agents", agent)
        return {"agent_id": agent["id"], "scope": "fixed_demo_snapshot"}, "运营 Agent 已激活。新上传的数据目前仅用于接入与映射预览。"
    if command == "skill-save":
        try:
            parsed = SkillInput.model_validate(payload)
        except ValidationError as error:
            raise DomainError("INVALID_SKILL", "Skill 必填字段或长度无效。", 422) from error
        schema_validate(parsed.input_schema)
        if not set(parsed.tools).issubset(TOOLS):
            raise DomainError("TOOL_FORBIDDEN", "Skill 只能调用白名单工具，不能授予审批或执行权限。", 403)
        if parsed.status not in ("draft", "active", "disabled"):
            raise DomainError("INVALID_STATUS", "Skill 状态无效。", 422)
        old = require(connection, "skills", parsed.id) if parsed.id else None
        skill = parsed.model_dump()
        skill["id"] = parsed.id or "skill-" + secrets.token_hex(6)
        skill["version"] = f"1.0.{int(old['version'].split('.')[-1]) + 1}" if old else "1.0.0"
        skill["updated_at"] = store.now()
        store.put(connection, "skills", skill)
        connection.execute("INSERT INTO skill_versions VALUES(?,?,?)", (skill["id"], skill["version"], json.dumps(skill, ensure_ascii=False)))
        return skill, "Skill 已保存并归档版本，可通过 MCP 发现与调用。"
    if command == "skill-toggle":
        skill = require(connection, "skills", payload.get("id"))
        skill["status"] = "disabled" if skill["status"] == "active" else "active"
        skill["updated_at"] = store.now()
        store.put(connection, "skills", skill)
        return skill, "Skill 状态已更新。"
    if command == "skill-test":
        skill = require(connection, "skills", payload.get("id"))
        args = payload.get("arguments", {})
        skill_arguments(skill, args)
        return {"valid": True, "skill_id": skill["id"], "version": skill["version"], "arguments": args, "allowed_tools": skill["tools"], "diagnostic": "参数符合 Schema；未执行调查、提案或外部写入。"}, "参数校验通过。"
    raise DomainError("UNKNOWN_COMMAND", "该操作尚未实现。", 404)


def mcp_invoke(connection, skill, tool, arguments):
    if skill["status"] != "active":
        raise DomainError("SKILL_DISABLED", "该 Skill 尚未启用。", 403)
    if tool not in skill["tools"] or tool not in TOOLS:
        raise DomainError("TOOL_FORBIDDEN", "该工具不在 Skill 的授权范围内。", 403)
    if tool == "console_summary":
        state = store.snapshot(connection)
        return {"mode": state["mode"], "as_of": state["as_of"], "incidents": len(state["incidents"]), "pending_approvals": sum(p["status"] == "pending" for p in state["plans"]), "notes": "内置业务数据，指标由本机记录计算"}
    if tool == "list_incidents":
        return [i for i in store.all_items(connection, "incidents") if not arguments.get("status") or i["status"] == arguments["status"]][:100]
    customer = arguments.get("customer_id")
    incident = next((i for i in store.all_items(connection, "incidents") if i["customer"] == customer or i["id"] == arguments.get("incident_id")), None)
    if not incident:
        raise DomainError("NOT_FOUND", "请指定当前工作区有效的 customer_id 或 incident_id。", 404)
    if tool == "get_incident":
        return {**incident, "business_detail": business.customer_detail(store.DATA, incident["customer"], store.meta(connection, "as_of"))}
    if tool in ("investigate", "request_plan"):
        return investigate(connection, incident["id"], propose=tool == "request_plan")
    raise DomainError("TOOL_FORBIDDEN", "不可调用该工具。", 403)
