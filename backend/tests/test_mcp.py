

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "opsweaver" / "mcp_server.py"
EXPECTED_TOOLS = {"list_skills", "get_skill", "run_skill", "invoke_skill_tool", "console_summary"}


def decode(result: Any) -> dict[str, Any]:
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        return structured
    text = next(item.text for item in result.content if item.type == "text")
    return json.loads(text)


@pytest.fixture(scope="module")
def live_backend() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    api = env.get("OPSWEAVER_API_URL", "http://127.0.0.1:8100/api/v1/mcp").rstrip("/")
    token = env.get("OPSWEAVER_MCP_TOKEN", "").strip()
    if not token:
        path = Path(env.get("OPSWEAVER_MCP_TOKEN_FILE", str(ROOT / "data" / "mcp.token")))
        if not path.exists():
            pytest.skip("Live backend token missing; start the OpsWeaver API first.")
        token = path.read_text(encoding="utf-8-sig").strip()
    env["OPSWEAVER_MCP_TOKEN"] = token
    try:
        response = httpx.get(f"{api}/summary", headers={"Authorization": f"Bearer {token}"}, timeout=5, trust_env=False)
    except httpx.RequestError:
        pytest.skip("Live backend unavailable; start the OpsWeaver API first.")
    assert response.status_code == 200, f"Backend MCP summary returned {response.status_code}"
    return env


async def protocol_roundtrip(env: dict[str, str], cwd: Path) -> None:

    parameters = StdioServerParameters(command=sys.executable, args=[str(SCRIPT)], env=env, cwd=str(cwd))
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            initialized = await session.initialize()
            assert initialized.serverInfo.name == "OpsWeaver"
            listing = await session.list_tools()
            assert {item.name for item in listing.tools} == EXPECTED_TOOLS
            assert all("approve" not in item.name and "execute" not in item.name for item in listing.tools)
            summary = await session.call_tool("console_summary", {})
            assert not summary.isError
            assert isinstance(decode(summary), dict)
            response = await session.call_tool("list_skills", {})
            assert not response.isError
            skill_list = decode(response)["skills"]
            assert skill_list, "Seed at least one Skill before running protocol tests."
            skill_id = skill_list[0]["id"]
            detail = await session.call_tool("get_skill", {"skill_id": skill_id})
            assert not detail.isError
            assert decode(detail)["id"] == skill_id
            retention = next((item for item in skill_list if item["id"] == "skill-retention"), None)
            assert retention is not None and retention["status"] == "active"
            context = await session.call_tool("run_skill", {"skill_id": "skill-retention", "arguments": {"customer_id": "C001"}})
            assert not context.isError
            context_body = decode(context)
            assert "instructions" in context_body and "allowed_tools" in context_body
            assert isinstance(context_body["allowed_tools"], list)
            read_tool = next(tool for tool in retention["tools"] if tool in {"console_summary", "list_incidents", "get_incident"})
            arguments = {"incident_id": "inc-001"} if read_tool == "get_incident" else {}
            tool_result = await session.call_tool("invoke_skill_tool", {"skill_id": "skill-retention", "tool": read_tool, "arguments": arguments})
            assert not tool_result.isError
            resources = await session.list_resource_templates()
            assert any(str(item.uriTemplate) == "opsweaver://skills/{skill_id}" for item in resources.resourceTemplates)
            resource = await session.read_resource(f"opsweaver://skills/{skill_id}")
            assert json.loads(resource.contents[0].text)["id"] == skill_id
            prompts = await session.list_prompts()
            assert "use_skill" in {item.name for item in prompts.prompts}
            prompt = await session.get_prompt("use_skill", {"skill_id": skill_id})
            assert prompt.messages and "run_skill" in prompt.messages[0].content.text
            rejected = await session.call_tool("invoke_skill_tool", {"skill_id": skill_id, "tool": "execute", "arguments": {}})
            assert rejected.isError
            traversal = await session.call_tool("get_skill", {"skill_id": "../settings"})
            assert traversal.isError


def test_stdio_live_protocol(live_backend: dict[str, str], tmp_path: Path) -> None:
    asyncio.run(protocol_roundtrip(live_backend, tmp_path))


def test_stdio_rejects_wrong_backend_token(live_backend: dict[str, str], tmp_path: Path) -> None:
    async def check() -> None:
        env = {**live_backend, "OPSWEAVER_MCP_TOKEN": "invalid-test-token"}
        parameters = StdioServerParameters(command=sys.executable, args=[str(SCRIPT)], env=env, cwd=str(tmp_path))
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool("console_summary", {})
                assert result.isError
                message = " ".join(item.text for item in result.content if item.type == "text")
                assert "denied" in message.lower()
                assert "invalid-test-token" not in message

    asyncio.run(check())


def test_http_transport_is_explicitly_unavailable() -> None:
    import subprocess

    result = subprocess.run([sys.executable, str(SCRIPT), "--http"], capture_output=True, text=True, timeout=30)
    assert result.returncode != 0
    assert "HTTP MCP is not enabled" in result.stderr
    assert not result.stdout
