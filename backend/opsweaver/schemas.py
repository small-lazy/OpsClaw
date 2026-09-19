from typing import Any
from pydantic import BaseModel, Field


class Incident(BaseModel):
    id: str
    customer: str
    segment: str
    title: str
    kind: str
    priority: int
    status: str
    hours: int
    value: int
    consent: bool | None
    support: bool
    coverage: bool
    owner: str
    facts: list[str]
    run_id: str | None


class RunEvent(BaseModel):
    id: str
    node: str
    title: str
    detail: str
    at: str
    status: str
    tool: str | None = None


class Run(BaseModel):
    id: str
    incident_id: str
    customer: str
    title: str
    state: str
    started_at: str
    model_calls: int
    tool_calls: int
    events: list[RunEvent]


class Plan(BaseModel):
    id: str
    incident_id: str
    run_id: str
    customer: str
    title: str
    purpose: str
    owner: str
    status: str
    version: int
    hash: str
    budget: int
    expires_at: str
    reason: str
    checks: list[str]


class Action(BaseModel):
    id: str
    customer: str
    title: str
    status: str
    external_id: str
    idempotency_key: str
    verified_at: str
    due_at: str
    plan_id: str
    owner: str


class Source(BaseModel):
    id: str
    role: str
    name: str
    rows: int
    status: str
    coverage: bool
    as_of: str
    columns: list[str] | None = None
    preview: list[dict[str, str]] | None = None
    mapping: dict[str, str] | None = None
    dataset_id: str | None = None
    origin: str | None = None
    analysis_scope: str | None = None


class Agent(BaseModel):
    id: str
    name: str
    description: str
    status: str
    version: str
    tools: list[str]
    runs: int


class Skill(BaseModel):
    id: str
    name: str
    description: str
    version: str
    status: str
    instructions: str
    input_schema: str
    tools: list[str]
    updated_at: str


class ConsoleData(BaseModel):
    mode: str
    as_of: str
    revision: int
    incidents: list[Incident]
    runs: list[Run]
    plans: list[Plan]
    actions: list[Action]
    sources: list[Source]
    agents: list[Agent]
    skills: list[Skill]
    trend: list[dict[str, Any]]
    coverage: dict[str, int | float]
    experiments: list[dict[str, Any]]
    memories: list[dict[str, Any]]
    settings: dict[str, Any]
    audit: list[dict[str, Any]]


class ConsoleEnvelope(BaseModel):
    data: ConsoleData


class SkillInput(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=1000)
    instructions: str = Field(min_length=1, max_length=30000)
    input_schema: str = Field(max_length=30000)
    tools: list[str] = Field(min_length=1, max_length=5)
    status: str = "draft"


class Arguments(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)
