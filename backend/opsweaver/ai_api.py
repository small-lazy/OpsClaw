"""Authenticated model connections and executable Agent workspace."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import store, model_providers as providers, agent_runtime as runtime
from .service import DomainError

TASKS: set[asyncio.Task] = set()


class RunInput(BaseModel):
    agent_id: str = Field(min_length=1, max_length=100)
    task: str = Field(min_length=1, max_length=20000)
    dataset_ids: list[str] = Field(default_factory=list, max_length=20)


class GenerateInput(BaseModel):
    provider_id: str = Field(min_length=1, max_length=100)
    requirement: str = Field(min_length=1, max_length=10000)


async def shutdown():
    tasks = list(TASKS)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


def create_router(session):
    router = APIRouter(prefix='/api/v1/ai', tags=['Agents'], dependencies=[Depends(session)])

    @router.get('/workspace')
    def workspace():
        with store.connect() as connection:
            return {'data': {'providers': providers.list_providers(connection),
                             'agents': runtime.list_agents(connection),
                             'runs': runtime.list_runs(connection),
                             'presets': {'providers': providers.PRESETS, 'agents': []},
                             'tools': runtime.TOOL_CATALOG}}

    @router.post('/providers')
    def save_provider(body: dict):
        with store.transaction() as connection:
            if isinstance(body.get('id'), str) and connection.execute(
                "SELECT 1 FROM ai_runs WHERE json_extract(document,'$.provider_id')=? "
                "AND json_extract(document,'$.status') IN ('queued','running') LIMIT 1", (body['id'],)
            ).fetchone():
                raise DomainError('PROVIDER_RUNNING', '该连接有 Agent 正在运行，请等待完成后编辑。', 409)
            return {'data': providers.save_provider(connection, body)}

    @router.delete('/providers/{provider_id}')
    def delete_provider(provider_id: str):
        with store.transaction() as connection:
            if any(a.get('provider_id') == provider_id for a in runtime.list_agents(connection)):
                raise DomainError('PROVIDER_IN_USE', '请先为关联 Agent 更换模型连接。', 409)
            return {'data': providers.delete_provider(connection, provider_id)}

    @router.post('/providers/{provider_id}/test')
    async def test_provider(provider_id: str):
        return {'data': await providers.test_provider(provider_id)}

    @router.post('/providers/{provider_id}/models')
    async def models(provider_id: str):
        return {'data': await providers.discover_models(provider_id)}

    @router.post('/agents')
    def save_agent(body: dict):
        with store.transaction() as connection:
            return {'data': runtime.save_agent(connection, body)}

    @router.delete('/agents/{agent_id}')
    def delete_agent(agent_id: str):
        with store.transaction() as connection:
            return {'data': runtime.delete_agent(connection, agent_id)}

    @router.post('/generate')
    async def generate(body: GenerateInput):
        return {'data': await runtime.generate_agent(body.provider_id, body.requirement)}

    @router.post('/runs', status_code=202)
    async def run(body: RunInput):
        if len(TASKS) >= 3:
            raise DomainError('AGENT_BUSY', '已有 3 个 Agent 任务运行，请稍后重试。', 429)
        item = runtime.prepare_run(body.agent_id, body.task, body.dataset_ids)
        task = asyncio.create_task(runtime.run_agent(body.agent_id, body.task, body.dataset_ids, run_id=item['id']))
        TASKS.add(task)
        task.add_done_callback(TASKS.discard)
        return {'data': item}

    @router.get('/runs/{run_id}')
    def run_detail(run_id: str):
        with store.connect() as connection:
            return {'data': runtime.get_run(connection, run_id)}

    return router
