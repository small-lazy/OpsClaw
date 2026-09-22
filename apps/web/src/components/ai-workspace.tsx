"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, ChevronRight, Clock3, KeyRound, Loader2, Play, Plus, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { useModalFocus } from "../lib/use-modal-focus";
import "./ai-workspace.css";

type Provider = { id: string; name: string; protocol: string; base_url: string; model: string; env_key?: string; api_key_configured?: boolean; key_source?: string; status?: string };
type Agent = { id?: string; name: string; description: string; instructions: string; provider_id?: string; tools: string[]; status: string; builtin?: boolean; is_template?: boolean; template?: boolean };
type Run = { id: string; agent_id: string; agent_name?: string; task: string; status: string; result?: unknown; output?: unknown; trace?: Record<string, unknown>[]; events?: Record<string, unknown>[]; error?: unknown; created_at?: string; started_at?: string; provider_id?: string; model?: string };
type Workspace = { providers: Provider[]; agents: Agent[]; runs: Run[]; tools: { name: string; description: string }[]; presets: { providers: (Partial<Provider> & { id: string; name: string })[]; agents: Agent[] } };
type Dataset = { id: string; name: string; row_count: number };
type Mutate = <T = any>(path: string, body?: Record<string, unknown>, method?: string) => Promise<T | null>;
const blankAgent: Agent = { name: "", description: "", instructions: "", provider_id: "", tools: [], status: "paused" };
const statusNames: Record<string, string> = { queued: "等待执行", running: "执行中", completed: "已完成", succeeded: "已完成", failed: "失败", active: "已启用", paused: "已暂停", disabled: "已停用" };
const text = (value: unknown): string => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
async function request<T>(path: string, body?: Record<string, unknown>, method = "GET"): Promise<T> {
  const response = await fetch(`/api/v1/ai${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || result.detail || "请求失败，请稍后重试");
  return result.data;
}
function isLocalProvider(provider: Partial<Provider>) { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(provider.base_url || "").hostname); } catch { return false; } }
function Field({ title, children }: { title: string; children: ReactNode }) { const id = useId(); return <div className="ai-field"><span id={id}>{title}</span><div className="ai-field-control" role="group" aria-labelledby={id}>{children}</div></div>; }
function Panel({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) { return <section className="panel ai-panel"><div className="panel-head"><div><h2>{title}</h2>{description && <p className="muted">{description}</p>}</div>{action}</div><div className="ai-panel-body">{children}</div></section>; }
function Status({ status }: { status: string }) { return <span className={`ai-status ${["completed", "succeeded", "active"].includes(status) ? "good" : status === "failed" ? "bad" : ""}`}>{statusNames[status] || status}</span>; }
function Empty({ children }: { children: ReactNode }) { return <p className="ai-empty">{children}</p>; }
function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { useModalFocus(true, close); return <div className="sec-overlay" onClick={close}><section className="ai-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><header><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭编辑窗口" onClick={close}><X size={20} /></button></header>{children}</section></div>; }

export function AIWorkspace({ notify, legacy }: { notify: (message: string) => void; legacy: ReactNode }) {
  const client = useQueryClient();
  const [tab, setTab] = useState("agents");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [agentEdit, setAgentEdit] = useState<Agent | null>(null);
  const [providerEdit, setProviderEdit] = useState<Partial<Provider> | null>(null);
  const [agentId, setAgentId] = useState("");
  const [runId, setRunId] = useState("");
  const [generation, setGeneration] = useState(false);
  const query = useQuery({ queryKey: ["ai-workspace"], queryFn: () => request<Workspace>("/workspace") });
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: async () => { const response = await fetch("/api/v1/datasets"); if (!response.ok) throw new Error("无法读取数据集"); return (await response.json()).data as Dataset[]; } });
  const mutate: Mutate = async (path, body, method = "POST") => {
    setBusy(true); setError("");
    try { const result = await request<any>(path, body, method); await client.invalidateQueries({ queryKey: ["ai-workspace"] }); return result; }
    catch (failure) { const message = failure instanceof Error ? failure.message : "请求失败"; setError(message); notify(message); return null; }
    finally { setBusy(false); }
  };
  const data = query.data;
  if (query.isPending) return <section className="panel ai-loading"><Loader2 className="spin" />正在读取 Agent 工作台…</section>;
  if (query.isError || !data) return <section className="panel ai-loading"><h1>Agent 工作台</h1><p role="alert">{query.error?.message || "服务暂不可用"}</p><button className="button" onClick={() => void query.refetch()}>重新连接</button></section>;
  const providers = data.providers || [], agents = data.agents || [], tools = data.tools || [];
  return <div className="ai-workspace">
    <div className="sec-heading"><div><div className="sec-eyebrow">AGENT WORKSPACE</div><h1 className="page-title">Agent 工作台</h1><p className="page-subtitle">连接自己的模型，为业务任务配置 Agent，查看每一次工具调用与结果。</p></div><button className="button" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} />刷新</button></div>
    <div className="ai-summary"><div className="panel"><Bot size={20} /><span>可用 Agent<strong>{agents.filter(agent => agent.status === "active").length}</strong></span></div><div className="panel"><KeyRound size={20} /><span>模型连接<strong>{providers.length}</strong></span></div><div className="panel"><CheckCircle2 size={20} /><span>运行记录<strong>{data.runs.length}</strong></span></div></div>
    <nav className="ai-tabs" aria-label="Agent 工作台分类">{[["agents", "我的 Agent"], ["providers", "模型连接"], ["run", "运行任务"], ["history", "运行历史"]].map(([id, title]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setError(""); }}>{title}</button>)}</nav>
    {error && <div className="ai-error" role="alert">{error}</div>}
    {tab === "agents" && <>
      {!providers.length && <div className="ai-notice"><KeyRound size={18} /><span>先添加模型连接，再将连接分配给 Agent。模型服务与 API 凭据由工作区使用者自行配置。</span><button className="button" onClick={() => setTab("providers")}>添加模型连接</button></div>}
      <Panel title="业务 Agent" description="从任务模板开始，也可以编写指令或根据需求生成草稿。" action={<div className="ai-actions"><button className="button" disabled={!providers.length} onClick={() => setGeneration(true)}><Sparkles size={16} />从需求生成</button><button className="button primary" onClick={() => setAgentEdit({ ...blankAgent })}><Plus size={16} />创建 Agent</button></div>}>
        <div className="ai-agent-grid">{agents.map(agent => { const provider = providers.find(item => item.id === agent.provider_id); return <article key={agent.id} className="ai-agent-card"><header><span className="ai-bot-icon"><Bot size={22} /></span><Status status={agent.status} /></header><h3>{agent.name}</h3><p>{agent.description}</p><div className="ai-tool-tags">{agent.tools.map(tool => <span key={tool}>{tool}</span>)}</div><div className="ai-card-model"><KeyRound size={13} />{provider ? `${provider.name} · ${provider.model}` : "尚未分配模型连接"}</div><footer><button className="button" onClick={() => setAgentEdit({ ...agent })}><Settings2 size={14} />配置</button><button className="button primary" disabled={!provider || agent.status !== "active"} onClick={() => { setAgentId(agent.id || ""); setTab("run"); }}><Play size={14} />运行</button></footer></article>; })}</div>
        {!agents.length && <Empty>尚无 Agent，创建一个并选择可用工具。</Empty>}
      </Panel>
    </>}
    {tab === "providers" && <Panel title="模型连接" description="支持常见服务预设、自定义 OpenAI 兼容接口与 Anthropic。密钥保存后不回显。" action={<button className="button primary" onClick={() => setProviderEdit({ protocol: "openai", name: "", base_url: "", model: "" })}><Plus size={16} />新增模型连接</button>}>
      <div className="ai-provider-list">{providers.map(provider => <article className="ai-provider-card" key={provider.id}><header><span className="ai-bot-icon"><KeyRound size={21} /></span><div><h3>{provider.name}</h3><p>{provider.model}</p></div><span className="ai-status">{provider.api_key_configured ? "密钥已配置" : isLocalProvider(provider) ? "本地服务" : "密钥待配置"}</span></header><dl><dt>接口地址</dt><dd>{provider.base_url}</dd><dt>协议</dt><dd>{provider.protocol === "anthropic" ? "Anthropic" : "OpenAI compatible"}</dd></dl><button className="button" onClick={() => setProviderEdit(provider)}>编辑与测试连接<ChevronRight size={14} /></button></article>)}</div>{!providers.length && <Empty>尚未配置模型连接。选择服务预设并填写 API Key 与模型名称后，可以测试实际连通性。</Empty>}
    </Panel>}
    {tab === "run" && <><RunForm agents={agents} providers={providers} datasets={datasets.data || []} selected={agentId} onSelect={setAgentId} busy={busy} mutate={mutate} onRun={id => setRunId(id)} />{datasets.isError && <div className="ai-error">数据集暂不可用，请刷新后重试。</div>}{runId && <RunDetail id={runId} />}</>}
    {tab === "history" && <><Panel title="运行历史" description="任务、模型响应与工具轨迹按运行保存。"><div className="ai-history">{data.runs.map(run => <button key={run.id} onClick={() => setRunId(run.id)}><Clock3 size={17} /><span><strong>{run.task}</strong><small>{run.agent_name || agents.find(agent => agent.id === run.agent_id)?.name || run.agent_id} · {run.created_at ? new Date(run.created_at).toLocaleString("zh-CN") : run.id}</small></span><Status status={run.status} /><ChevronRight size={15} /></button>)}</div>{!data.runs.length && <Empty>尚无模型运行记录。完成连接配置后，从运行任务开始。</Empty>}</Panel>{runId && <RunDetail id={runId} />}</>}
    <details className="ai-legacy"><summary>规则工作流与历史记录</summary>{legacy}</details>
    {agentEdit && <AgentEditor initial={agentEdit} error={error} providers={providers} tools={tools} busy={busy} mutate={mutate} close={() => setAgentEdit(null)} />}
    {providerEdit && <ProviderEditor initial={providerEdit} error={error} presets={data.presets?.providers || []} busy={busy} mutate={mutate} close={() => setProviderEdit(null)} />}
    {generation && <Generation error={error} providers={providers} busy={busy} mutate={mutate} close={() => setGeneration(false)} onDraft={draft => { setGeneration(false); setAgentEdit(draft); }} />}
  </div>;
}

function AgentEditor({ initial, error, providers, tools, busy, mutate, close }: { initial: Agent; error: string; providers: Provider[]; tools: Workspace["tools"]; busy: boolean; mutate: Mutate; close: () => void }) {
  const [draft, setDraft] = useState<Agent>(initial);
  const [deleting, setDeleting] = useState(false);
  return <Dialog title={initial.id ? "配置 Agent" : "创建 Agent"} close={close}>{error && <div className="ai-error" role="alert">{error}</div>}<form onSubmit={async event => { event.preventDefault(); if (await mutate("/agents", { ...draft, provider_id: draft.provider_id || null })) close(); }}>
    <Field title="Agent 名称"><input className="field" aria-label="Agent 名称" required maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
    <Field title="用途简介"><input className="field" aria-label="用途简介" required value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field>
    <Field title="模型连接"><select className="field" aria-label="Agent 模型连接" value={draft.provider_id || ""} onChange={event => setDraft({ ...draft, provider_id: event.target.value })}><option value="">暂不分配模型连接</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}</select></Field>
    <Field title="工作指令"><textarea className="field ai-instructions" aria-label="工作指令" required value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></Field>
    <fieldset className="ai-tool-options"><legend>允许调用的工具</legend>{tools.map(tool => <label key={tool.name}><input type="checkbox" checked={draft.tools.includes(tool.name)} onChange={event => setDraft({ ...draft, tools: event.target.checked ? [...draft.tools, tool.name] : draft.tools.filter(name => name !== tool.name) })} /><span><strong>{tool.name}</strong><small>{tool.description}</small></span></label>)}</fieldset>
    <label className="ai-checkbox"><input type="checkbox" checked={draft.status === "active"} onChange={event => setDraft({ ...draft, status: event.target.checked ? "active" : "paused" })} />启用此 Agent</label>
    <div className="ai-form-footer">{initial.id && <button className="button ai-danger" type="button" disabled={busy} onClick={async () => { if (!deleting) setDeleting(true); else if (await mutate(`/agents/${initial.id}`, {}, "DELETE")) close(); }}>{deleting ? "确认删除 Agent" : "删除 Agent"}</button>}<button className="button primary" disabled={busy}>{busy ? "正在保存…" : "保存 Agent"}</button></div>
  </form></Dialog>;
}

function ProviderEditor({ initial, error, presets, busy, mutate, close }: { initial: Partial<Provider>; error: string; presets: Workspace["presets"]["providers"]; busy: boolean; mutate: Mutate; close: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  async function save() { const saved = await mutate<Provider>("/providers", { ...draft, ...(key.trim() ? { api_key: key.trim(), env_key: "" } : {}) }); if (saved) { setDraft(saved); setKey(""); } return saved; }
  async function act(kind: "test" | "models") { const saved = await save(); if (!saved) return; const response = await mutate<any>(`/providers/${saved.id}/${kind}`, {}); if (response === null) return; if (kind === "models") { setModels(response.map((model: string | { id: string; name?: string }) => typeof model === "string" ? model : model.id)); setResult(`模型服务返回 ${response.length} 个模型。请选择一个或直接填写模型名称。`); } else setResult(response); }
  return <Dialog title="模型连接配置" close={close}>{error && <div className="ai-error" role="alert">{error}</div>}<form onSubmit={async event => { event.preventDefault(); if (await save()) close(); }}>
    <Field title="服务预设"><select className="field" aria-label="服务预设" defaultValue="" onChange={event => { const preset = presets.find(item => item.id === event.target.value); if (preset) setDraft({ ...draft, name: preset.name, protocol: preset.protocol || "openai", base_url: preset.base_url || "", model: preset.model || "" }); }}><option value="">自定义连接</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></Field>
    <div className="ai-form-grid"><Field title="连接名称"><input className="field" aria-label="连接名称" required value={draft.name || ""} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field><Field title="接口协议"><select className="field" aria-label="接口协议" value={draft.protocol || "openai"} onChange={event => setDraft({ ...draft, protocol: event.target.value })}><option value="openai">OpenAI compatible</option><option value="anthropic">Anthropic</option></select></Field></div>
    <Field title="API Base URL"><input className="field" aria-label="API Base URL" required type="url" value={draft.base_url || ""} onChange={event => setDraft({ ...draft, base_url: event.target.value })} placeholder="https://api.example.com/v1" /></Field>
    <Field title="API Key"><input className="field" aria-label="API Key" type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} placeholder={draft.api_key_configured ? "已保存；留空保留原密钥" : "填写服务商提供的 API Key"} /></Field>
    <Field title="环境变量名（可选）"><input className="field" aria-label="环境变量名（可选）" value={draft.env_key || ""} onChange={event => setDraft({ ...draft, env_key: event.target.value })} placeholder="例如 MY_MODEL_API_KEY" /></Field>
    <Field title="模型名称"><input className="field" aria-label="模型名称" list="ai-provider-models" required value={draft.model || ""} onChange={event => setDraft({ ...draft, model: event.target.value })} placeholder="填写服务商支持的模型 ID" /><datalist id="ai-provider-models">{models.map(model => <option key={model} value={model} />)}</datalist></Field>
    <p className="muted ai-hint">测试和获取模型会先保存当前连接，再请求模型服务。可直接填写模型 ID；不同服务的模型列表能力可能不同。</p>
    <div className="ai-actions"><button className="button" type="button" disabled={busy || !draft.name || !draft.base_url || !draft.model} onClick={() => void act("test")}>测试连接</button><button className="button" type="button" disabled={busy || !draft.name || !draft.base_url} onClick={() => void act("models")}>获取模型列表</button></div>
    {result !== null && <div className="ai-connection-result" role="status"><pre>{text(result)}</pre></div>}
    <div className="ai-form-footer">{draft.id && <button className="button ai-danger" type="button" disabled={busy} onClick={async () => { if (!deleting) setDeleting(true); else if (await mutate(`/providers/${draft.id}`, {}, "DELETE")) close(); }}>{deleting ? "确认删除连接" : "删除连接"}</button>}<button className="button primary" disabled={busy}>{busy ? "正在处理…" : "保存连接"}</button></div>
  </form></Dialog>;
}

function Generation({ error, providers, busy, mutate, close, onDraft }: { error: string; providers: Provider[]; busy: boolean; mutate: Mutate; close: () => void; onDraft: (agent: Agent) => void }) {
  return <Dialog title="根据需求生成 Agent" close={close}>{error && <div className="ai-error" role="alert">{error}</div>}<form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const providerId = String(form.get("provider_id")); const draft = await mutate<Agent>("/generate", { provider_id: providerId, requirement: form.get("requirement") }); if (draft) onDraft({ ...blankAgent, ...draft, id: undefined, provider_id: providerId }); }}><Field title="用于生成的模型"><select className="field" aria-label="用于生成的模型" name="provider_id" required>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}</select></Field><Field title="描述工作需求"><textarea className="field ai-instructions" aria-label="描述工作需求" name="requirement" required placeholder="例如：每周检查订单变化，找出销量下降的品类，引用数据并提出可核验的运营建议。" /></Field><p className="muted ai-hint">生成后会打开草稿，核对工作指令与工具权限后再保存。</p><div className="ai-form-footer"><button className="button primary" disabled={busy}><Sparkles size={15} />{busy ? "正在生成草稿…" : "生成 Agent 草稿"}</button></div></form></Dialog>;
}

function RunForm({ agents, providers, datasets, selected, onSelect, busy, mutate, onRun }: { agents: Agent[]; providers: Provider[]; datasets: Dataset[]; selected: string; onSelect: (id: string) => void; busy: boolean; mutate: Mutate; onRun: (id: string) => void }) {
  const agent = agents.find(item => item.id === selected), provider = providers.find(item => item.id === agent?.provider_id);
  return <Panel title="运行任务" description="选择 Agent、明确任务和可读取的数据集，提交后查看模型响应与工具轨迹。"><form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const run = await mutate<Run>("/runs", { agent_id: selected, task: form.get("task"), dataset_ids: form.getAll("dataset_ids") }); if (run) onRun(run.id); }}><Field title="执行 Agent"><select className="field" aria-label="执行 Agent" required value={selected} onChange={event => onSelect(event.target.value)}><option value="">选择 Agent</option>{agents.filter(item => item.status === "active").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>{agent && <p className="ai-model-note">{provider ? `模型连接：${provider.name} / ${provider.model}` : "此 Agent 尚未分配模型连接，请先在配置中选择连接。"}</p>}<Field title="本次任务"><textarea className="field ai-instructions" aria-label="本次任务" name="task" required placeholder="明确希望回答的问题、时间范围和输出要求…" /></Field><fieldset className="ai-dataset-options"><legend>本次授权的数据集</legend>{datasets.length ? datasets.map(dataset => <label key={dataset.id}><input type="checkbox" name="dataset_ids" value={dataset.id} /><span>{dataset.name}<small>{dataset.row_count.toLocaleString()} 条记录</small></span></label>) : <p className="muted">暂无导入文件，可先在数据中心接入数据。</p>}</fieldset><div className="ai-form-footer"><button className="button primary" disabled={busy || !agent || !provider}><Play size={15} />{busy ? "正在提交…" : "开始运行"}</button></div></form></Panel>;
}

function RunDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["ai-run", id], queryFn: () => request<Run>(`/runs/${id}`), refetchInterval: query => query.state.error ? false : ["queued", "running"].includes(query.state.data?.status || "queued") ? 1500 : false });
  useEffect(() => { if (query.data && !["queued", "running"].includes(query.data.status)) void client.invalidateQueries({ queryKey: ["ai-workspace"] }); }, [query.data?.status, client]);
  const run = query.data;
  return <Panel title="运行结果与轨迹" description={id} action={run && <Status status={run.status} />}>
    {query.isPending ? <Empty>正在读取运行状态…</Empty> : query.isError ? <div className="ai-error" role="alert">{query.error.message}<button className="button" onClick={() => void query.refetch()}>重试</button></div> : run && <>
      <p className="ai-task-text">{run.task}</p>{["queued", "running"].includes(run.status) && <div className="ai-notice"><Loader2 className="spin" size={16} />任务处理中，页面会自动更新结果。</div>}{run.error && <div className="ai-error" role="alert">{typeof run.error === "object" && run.error && "message" in run.error ? text(run.error.message) : text(run.error)}</div>}
      {(run.result != null || run.output != null) && <section className="ai-output"><h3>模型输出</h3><pre>{text(run.result ?? run.output)}</pre></section>}
      <h3 className="ai-trace-title">执行轨迹</h3><ol className="ai-trace">{(run.trace || run.events || []).map((event, index) => <li key={index}><span>{index + 1}</span><div><strong>{text(event.title || event.tool || event.name || event.type || "执行步骤")}</strong><details><summary>查看步骤详情</summary><pre>{text(event)}</pre></details></div></li>)}</ol>{!(run.trace || run.events || []).length && <p className="muted">尚无执行轨迹。</p>}
    </>}
  </Panel>;
}
