"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  FileCode2,
  FlaskConical,
  Globe2,
  Info,
  Layers3,
  Loader2,
  Pencil,
  Play,
  PlugZap,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import type { PageProps } from "../lib/types";
import "./skills.css";
import { useModalFocus } from "../lib/use-modal-focus";

type Skill = {
  id: string;
  name: string;
  description: string;
  version: string;
  status: string;
  instructions: string;
  input_schema: string;
  tools: string[];
  updated_at: string;
};
type SkillDraft = {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  input_schema: string;
  tools: string[];
  status: string;
};
const tools = [
  {
    id: "console_summary",
    name: "运营概览",
    description: "读取工作区指标与数据新鲜度",
    tag: "只读",
  },
  {
    id: "list_incidents",
    name: "检索行动缺口",
    description: "筛选案件并返回证据摘要",
    tag: "只读",
  },
  {
    id: "get_incident",
    name: "查看缺口详情",
    description: "读取单个案件、证据与关联动作",
    tag: "只读",
  },
  {
    id: "investigate",
    name: "发起调查",
    description: "创建受控调查，获取结构化证据",
    tag: "受控调查",
  },
  {
    id: "request_plan",
    name: "提出行动方案",
    description: "生成待审方案，交由工作区审批",
    tag: "提案",
  },
];
const blank: SkillDraft = {
  name: "",
  description: "",
  instructions:
    "# 工作目标\n描述这个 Skill 需要解决的业务问题。\n\n## 工作步骤\n1. 读取必要的数据与证据。\n2. 明确来源覆盖和数据限制。\n3. 返回结构化结论与后续建议。\n\n## 结果要求\n引用证据，不将未知状态当作零。",
  input_schema:
    '{\n  "type": "object",\n  "properties": {\n    "customer_id": {\n      "type": "string",\n      "description": "需要调查的客户标识"\n    }\n  },\n  "required": ["customer_id"],\n  "additionalProperties": false\n}',
  tools: ["list_incidents", "get_incident"],
  status: "draft",
};
const label = (value: string) =>
  ({
    active: "已启用",
    draft: "草稿",
    disabled: "已停用",
    paused: "已停用",
    inactive: "已停用",
  })[value] ?? value;
function jsonObject(text: string, label: string) {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}必须是 JSON 对象。`);
  return value as Record<string, unknown>;
}
function validateSchema(text: string) {
  const value = jsonObject(text, "输入 Schema");
  if (value.type !== "object")
    throw new Error('输入 Schema 的 type 必须为 "object"。');
  if (
    value.properties != null &&
    (typeof value.properties !== "object" || Array.isArray(value.properties))
  )
    throw new Error("properties 必须为对象。");
  if (
    value.required != null &&
    (!Array.isArray(value.required) ||
      value.required.some((item) => typeof item !== "string"))
  )
    throw new Error("required 必须为字符串数组。");
  return value;
}

export function SkillsPage({ data, mutate, notify }: PageProps) {
  const skills = (data as typeof data & { skills?: Skill[] }).skills ?? [];
  const [tab, setTab] = useState("skills");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorTab, setEditorTab] = useState("instructions");
  const [schemaMessage, setSchemaMessage] = useState("");
  const [schemaValid, setSchemaValid] = useState(false);
  const [testArgs, setTestArgs] = useState('{\n  "customer_id": "C001"\n}');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [python, setPython] = useState("");
  const [backend, setBackend] = useState("");
  const transport = "stdio";
  const [mcpArgs, setMcpArgs] = useState<string[]>([]);
  const [configSource, setConfigSource] = useState("正在读取当前安装的 MCP 配置…");
  const [copiedConfig, setCopiedConfig] = useState<string | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const configReady = Boolean(python.trim() && backend.trim() && mcpArgs.length && !configLoading && !configError);
  useModalFocus(Boolean(draft || selected), () => {
    if (!busy) {
      setDraft(null);
      setSelected(null);
    }
  });
  const chosen = skills.find((item) => item.id === selected);
  const visible = skills.filter(
    (item) =>
      `${item.name} ${item.description} ${item.tools.join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (filter === "all" || item.status === filter ||
        (filter === "disabled" && ["paused", "inactive"].includes(item.status))),
  );
  useEffect(() => {
    const controller = new AbortController();
    setConfigLoading(true);
    setConfigError(false);
    setCopiedConfig(null);
    setConfigSource("正在读取当前安装的 MCP 配置…");
    void fetch("/api/v1/mcp-config", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("MCP 配置读取失败");
        const result = await response.json();
        const value = result.data;
        if (
          value?.transport === "stdio" &&
          typeof value.command === "string" && value.command.trim() &&
          typeof value.cwd === "string" && value.cwd.trim() &&
          Array.isArray(value.args) && value.args.length > 0 &&
          value.args.every((item: unknown) => typeof item === "string")
        ) {
          setPython(value.command);
          setMcpArgs(value.args);
          if (typeof value.cwd === "string") setBackend(value.cwd);
          setConfigSource("已读取 MCP 配置，可调整路径后复制到客户端。");
        } else {
          throw new Error("MCP 配置不完整");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setConfigError(true);
          setConfigSource("MCP 配置读取失败，请重试。");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setConfigLoading(false);
      });
    return () => controller.abort();
  }, [configAttempt]);
  const config = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            opsclaw: { command: python.trim(), args: mcpArgs, cwd: backend.trim() },
          },
        },
        null,
        2,
      ),
    [python, backend, mcpArgs],
  );
  function edit(skill?: Skill) {
    setSelected(null);
    setDraft(
      skill
        ? {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            input_schema:
              typeof skill.input_schema === "string"
                ? skill.input_schema
                : JSON.stringify(skill.input_schema, null, 2),
            tools: [...skill.tools],
            status: skill.status,
          }
        : { ...blank, tools: [...blank.tools] },
    );
    setEditorTab("instructions");
    setSchemaMessage("");
    setSchemaValid(false);
  }
  function checkSchema() {
    if (!draft) return;
    try {
      validateSchema(draft.input_schema);
      setSchemaValid(true);
      setSchemaMessage(
        "JSON 语法与基本 Schema 结构有效；完整校验由服务端完成。",
      );
    } catch (error) {
      setSchemaValid(false);
      setSchemaMessage(
        error instanceof Error ? error.message : "JSON 格式有误",
      );
    }
  }
  async function save() {
    if (!draft) return;
    try {
      if (
        !draft.name.trim() ||
        !draft.description.trim() ||
        !draft.instructions.trim()
      )
        throw new Error("请填写 Skill 名称、简介与工作指令。");
      validateSchema(draft.input_schema);
      if (!draft.tools.length) throw new Error("请至少选择一个工具。");
      if (draft.tools.some((tool) => !tools.some((item) => item.id === tool)))
        throw new Error("工具列表包含未授权的工具。");
      setBusy(true);
      if (
        (await mutate("skill-save", {
          ...draft,
          name: draft.name.trim(),
          description: draft.description.trim(),
        })) == null
      )
        return;
      setDraft(null);
      notify("Skill 配置已保存");
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function toggle(skill: Skill) {
    setBusy(true);
    try {
      if ((await mutate("skill-toggle", { id: skill.id })) == null) return;
      notify("Skill 状态已更新");
    } catch (error) {
      notify(error instanceof Error ? error.message : "状态更新失败。");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!chosen) return;
    try {
      const args = jsonObject(testArgs, "测试参数");
      setBusy(true);
      setTestResult(null);
      const result = await mutate("skill-test", {
        id: chosen.id,
        arguments: args,
      });
      if (result == null) {
        setTestResult(
          JSON.stringify(
            { error: "参数测试失败，请根据错误提示修改后重试。" },
            null,
            2,
          ),
        );
        return;
      }
      setTestResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setTestResult(
        JSON.stringify(
          { error: error instanceof Error ? error.message : "测试失败" },
          null,
          2,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!configReady) return;
    try {
      JSON.parse(config);
      await navigator.clipboard.writeText(config);
      setCopiedConfig(config);
      notify("MCP 配置已复制");
    } catch {
      notify("无法直接复制，请选择配置文本手动复制。");
    }
  }
  function download(skill: Skill) {
    const content = `# ${skill.name}\n\n${skill.description}\n\n${skill.instructions}\n\n## 输入参数\n\n\`\`\`json\n${skill.input_schema}\n\`\`\`\n\n## 工具白名单\n\n${skill.tools.map((tool) => `- ${tool}`).join("\n")}\n`;
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${skill.name.replace(/[<>:"/\\|?*]/g, "-")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <header className="skill-heading">
        <div>
          <div className="skill-eyebrow">BUILD ON YOUR EXPERTISE</div>
          <h1 className="page-title">Skill 工坊</h1>
          <p className="page-subtitle">
            把你的运营方法写成技能，让其他 Agent 也能调用。
          </p>
        </div>
        <button className="button primary" onClick={() => edit()}>
          <Plus size={16} />
          创建 Skill
        </button>
      </header>
      <div className="skill-top-tabs">
        <button
          className={tab === "skills" ? "active" : ""}
          onClick={() => setTab("skills")}
        >
          <Layers3 size={16} />
          我的 Skills<span>{skills.length}</span>
        </button>
        <button
          className={tab === "mcp" ? "active" : ""}
          onClick={() => setTab("mcp")}
        >
          <PlugZap size={16} />
          MCP 接入
        </button>
      </div>
      {tab === "skills" ? (
        <>
          <div className="skill-intro">
            <div className="skill-intro-icon">
              <BookOpen size={26} />
            </div>
            <div>
              <h2>让经验成为可以复用的工作方法</h2>
              <p>
                使用 Markdown 定义步骤、JSON Schema
                约束输入，再选择必要的工具。每一次修改都有版本记录。
              </p>
            </div>
            <button className="skill-text-button" onClick={() => setTab("mcp")}>
              接入其他 Agent
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="skill-toolbar">
            <div className="tabs">
              {[
                ["all", "全部"],
                ["active", "已启用"],
                ["draft", "草稿"],
                ["disabled", "已停用"],
              ].map(([value, name]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={filter === value ? "active" : ""}
                >
                  {name}
                </button>
              ))}
            </div>
            <label className="skill-search">
              <Search size={16} />
              <input
                aria-label="搜索 Skill"
                placeholder="搜索技能名称、用途或工具…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="skill-grid">
            {visible.map((skill, index) => (
              <article className="skill-card" key={skill.id}>
                <div className="skill-card-top">
                  <span className={`skill-glyph skill-glyph-${index % 3}`}>
                    {index % 3 === 0 ? (
                      <Sparkles size={22} />
                    ) : index % 3 === 1 ? (
                      <FileCode2 size={22} />
                    ) : (
                      <Layers3 size={22} />
                    )}
                  </span>
                  <span
                    className={`skill-state ${skill.status === "active" ? "skill-state-active" : ""}`}
                  >
                    <span />
                    {label(skill.status)}
                  </span>
                </div>
                <button
                  className="skill-card-title"
                  onClick={() => {
                    setSelected(skill.id);
                    setTestResult(null);
                  }}
                >
                  <h3>{skill.name}</h3>
                  <ChevronRight size={16} />
                </button>
                <p>{skill.description}</p>
                <div className="skill-tool-tags">
                  {skill.tools.slice(0, 3).map((tool) => (
                    <span key={tool}>
                      {tools.find((item) => item.id === tool)?.name ?? tool}
                    </span>
                  ))}
                  {skill.tools.length > 3 && (
                    <span>+{skill.tools.length - 3}</span>
                  )}
                </div>
                <footer>
                  <span>
                    v{skill.version} <i /> {skill.tools.length} 个工具
                  </span>
                  <button
                    aria-label={`编辑 ${skill.name}`}
                    className="skill-text-button"
                    onClick={() => edit(skill)}
                  >
                    <Pencil size={13} />
                    编辑
                  </button>
                </footer>
              </article>
            ))}
            <button className="skill-create-card" onClick={() => edit()}>
              <span>
                <Plus size={24} />
              </span>
              <strong>创建你的下一个 Skill</strong>
              <p>从一个业务方法开始</p>
            </button>
          </div>
          {!visible.length && skills.length > 0 && (
            <div className="skill-empty">
              <Search size={23} />
              <strong>没有找到匹配的 Skill</strong>
              <span>尝试其他关键词或状态。</span>
            </div>
          )}
          <div className="skill-note">
            <ShieldCheck size={16} />
            <span>
              Skill 定义工作方法；工具白名单约束操作范围。MCP
              不提供审批或直接执行入口。
            </span>
          </div>
        </>
      ) : (
        <div className="skill-mcp-layout">
          <section className="panel skill-mcp-panel">
            <div className="skill-panel-title">
              <span className="skill-glyph">
                <PlugZap size={24} />
              </span>
              <div>
                <h2>连接 OpsClaw</h2>
                <p>让支持 MCP 的 Agent 读取证据、发起调查与提交提案。</p>
              </div>
            </div>
            <div className="skill-transport">
              <button
                className={transport === "stdio" ? "active" : ""}
                onClick={() => setCopiedConfig(null)}
              >
                <Terminal size={16} />
                stdio<span>推荐</span>
              </button>
              <button
                disabled
                title="当前版本仅提供 stdio，不监听 HTTP MCP 端口"
              >
                <Globe2 size={16} />
                HTTP · 未提供
              </button>
            </div>
            {transport === "stdio" ? (
              <div className="skill-connection-fields">
                <label>
                  Python 可执行文件
                  <input
                    className="field"
                    value={python}
                    disabled={configLoading || configError}
                    onChange={(event) => {
                      setPython(event.target.value);
                      setCopiedConfig(null);
                    }}
                    placeholder="C:\\path\\to\\python.exe"
                  />
                </label>
                <label>
                  后端工作目录
                  <input
                    className="field"
                    value={backend}
                    disabled={configLoading || configError}
                    onChange={(event) => {
                      setBackend(event.target.value);
                      setMcpArgs(["-m", "opsweaver.mcp_server"]);
                      setCopiedConfig(null);
                    }}
                    placeholder="C:\\path\\to\\OpsClaw\\backend"
                  />
                </label>
                <p role="status">{configSource}</p>
                <button className="skill-text-button" disabled={configLoading} onClick={() => setConfigAttempt((value) => value + 1)}>
                  {configLoading ? "正在读取…" : configError ? "重新读取配置" : "恢复安装路径"}
                </button>
              </div>
            ) : (
              <div className="skill-callout">
                <Info size={17} />
                <span>
                  请使用 stdio 配置连接其他 Agent。
                </span>
              </div>
            )}
            <div className="skill-code-title">
              <span>
                <Braces size={15} />
                MCP 客户端配置
              </span>
              <button disabled={!configReady} onClick={() => void copy()} className="skill-text-button">
                {copiedConfig === config ? <Check size={14} /> : <Copy size={14} />}
                {copiedConfig === config ? "已复制" : "复制配置"}
              </button>
            </div>
            <pre className="skill-code">{configReady ? config : configLoading || configError ? configSource : "请填写 Python 可执行文件和后端工作目录。"}</pre>
            <div className="skill-mcp-steps">
              <div>
                <span>1</span>
                <p>启动并确认 OpsClaw 后端可用。</p>
              </div>
              <div>
                <span>2</span>
                <p>将配置添加到支持 MCP 的 Agent 客户端。</p>
              </div>
              <div>
                <span>3</span>
                <p>在客户端刷新工具列表，先调用 console_summary 验证读取。</p>
              </div>
            </div>
            <div className="skill-callout">
              <CircleHelp size={17} />
              <span>
                复制上方配置即可接入当前安装。stdio
                服务使用本机令牌连接后端，HTTP MCP 当前未提供。
              </span>
            </div>
          </section>
          <aside>
            <section className="panel skill-boundary">
              <h3>
                <ShieldCheck size={18} />
                工具边界清晰可见
              </h3>
              <p>只暴露已注册的受控能力。</p>
              {tools.map((tool) => (
                <div className="skill-boundary-tool" key={tool.id}>
                  <div>
                    <code>{tool.id}</code>
                    <small>{tool.description}</small>
                  </div>
                  <span>{tool.tag}</span>
                </div>
              ))}
              <div className="skill-boundary-footer">
                <CheckCircle2 size={16} />
                <span>方案进入审批中心后，仍需满足原有授权与校验。</span>
              </div>
            </section>
            <section className="skill-mcp-tip">
              <Code2 size={21} />
              <h3>一次定义，多处调用</h3>
              <p>
                Skill 保存指令、输入契约和工具范围。外部 Agent 通过 MCP
                使用平台能力，不执行任意上传代码。
              </p>
            </section>
          </aside>
        </div>
      )}

      {draft && (
        <div
          className="skill-overlay"
          onClick={() => {
            if (!busy) setDraft(null);
          }}
        >
          <section
            className="skill-editor"
            role="dialog"
            aria-modal="true"
            aria-label={draft.id ? "编辑 Skill" : "创建 Skill"}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="skill-eyebrow">SKILL BUILDER</span>
                <h2>{draft.id ? "编辑 Skill" : "创建新 Skill"}</h2>
              </div>
              <button
                className="skill-close"
                aria-label="关闭 Skill 编辑器"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="skill-editor-scroll">
              <div className="skill-meta-fields">
                <label>
                  Skill 名称
                  <input
                    className="field"
                    maxLength={80}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    placeholder="例如：高价值客户调查助手"
                  />
                </label>
                <label>
                  用途简介
                  <textarea
                    className="field"
                    rows={2}
                    maxLength={300}
                    value={draft.description}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                    placeholder="这个 Skill 为谁解决什么问题？"
                  />
                </label>
              </div>
              <div className="skill-editor-tabs">
                {[
                  ["instructions", "工作指令", BookOpen],
                  ["schema", "输入参数", Braces],
                  ["tools", "工具权限", ShieldCheck],
                ].map(([value, name, Icon]) => {
                  const Component = Icon as typeof BookOpen;
                  return (
                    <button
                      key={String(value)}
                      className={editorTab === value ? "active" : ""}
                      onClick={() => setEditorTab(String(value))}
                    >
                      <Component size={15} />
                      {String(name)}
                    </button>
                  );
                })}
              </div>
              {editorTab === "instructions" && (
                <div className="skill-editor-section">
                  <div className="skill-editor-caption">
                    <span>Markdown 指令</span>
                    <small>定义目标、工作步骤与输出要求</small>
                  </div>
                  <textarea
                    aria-label="Markdown 工作指令"
                    spellCheck={false}
                    className="skill-code-input skill-instruction-input"
                    value={draft.instructions}
                    onChange={(event) =>
                      setDraft({ ...draft, instructions: event.target.value })
                    }
                  />
                  <div className="skill-inline-tip">
                    <Info size={14} />
                    用明确的步骤描述方法，并说明缺少证据时如何处理。
                  </div>
                </div>
              )}
              {editorTab === "schema" && (
                <div className="skill-editor-section">
                  <div className="skill-editor-caption">
                    <span>JSON Schema</span>
                    <button className="skill-text-button" onClick={checkSchema}>
                      <CheckCircle2 size={14} />
                      检验 JSON
                    </button>
                  </div>
                  <textarea
                    aria-label="输入 JSON Schema"
                    spellCheck={false}
                    className="skill-code-input"
                    value={draft.input_schema}
                    onChange={(event) => {
                      setDraft({ ...draft, input_schema: event.target.value });
                      setSchemaMessage("");
                    }}
                  />
                  {schemaMessage && (
                    <p
                      className={`skill-validation ${schemaValid ? "skill-validation-ok" : ""}`}
                    >
                      {schemaValid ? (
                        <CheckCircle2 size={15} />
                      ) : (
                        <Info size={15} />
                      )}
                      {schemaMessage}
                    </p>
                  )}
                  <div className="skill-inline-tip">
                    <Info size={14} />
                    输入根类型为 object；必填参数由 required 定义。
                  </div>
                </div>
              )}
              {editorTab === "tools" && (
                <div className="skill-editor-section">
                  <p className="skill-tool-description">
                    仅勾选完成这个 Skill 必需的工具。
                  </p>
                  {tools.map((tool) => (
                    <label
                      className={`skill-tool-option ${draft.tools.includes(tool.id) ? "selected" : ""}`}
                      key={tool.id}
                    >
                      <input
                        type="checkbox"
                        checked={draft.tools.includes(tool.id)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            tools: event.target.checked
                              ? [...draft.tools, tool.id]
                              : draft.tools.filter((item) => item !== tool.id),
                          })
                        }
                      />
                      <div>
                        <strong>
                          {tool.name}
                          <code>{tool.id}</code>
                        </strong>
                        <p>{tool.description}</p>
                      </div>
                      <span>{tool.tag}</span>
                    </label>
                  ))}
                  <div className="skill-callout">
                    <ShieldCheck size={16} />
                    <span>
                      审批、直接执行、任意代码和任意 SQL 不在可选工具范围内。
                    </span>
                  </div>
                </div>
              )}
            </div>
            <footer className="skill-editor-footer">
              <label>
                <input
                  type="checkbox"
                  checked={draft.status === "active"}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      status: event.target.checked ? "active" : "draft",
                    })
                  }
                />
                保存后启用
              </label>
              <div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setDraft(null)}
                >
                  取消
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy && <Loader2 className="skill-spin" size={15} />}
                  {busy ? "正在保存…" : "保存 Skill"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {chosen && (
        <div className="skill-overlay" onClick={() => { if (!busy) setSelected(null); }}>
          <section
            className="skill-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Skill 详情"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span className="skill-eyebrow">SKILL DETAILS</span>
              <button
                className="skill-close"
                aria-label="关闭 Skill 详情"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="skill-detail-title">
              <span className="skill-glyph">
                <Sparkles size={24} />
              </span>
              <h2>{chosen.name}</h2>
              <p>{chosen.description}</p>
              <div>
                <span className="skill-version">v{chosen.version}</span>
                <span
                  className={`skill-state ${chosen.status === "active" ? "skill-state-active" : ""}`}
                >
                  <span />
                  {label(chosen.status)}
                </span>
              </div>
            </div>
            <div className="skill-detail-actions">
              <button className="button" disabled={busy} onClick={() => edit(chosen)}>
                <Pencil size={14} />
                编辑
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => void toggle(chosen)}
              >
                <Play size={14} />
                {chosen.status === "active" ? "停用" : "启用"}
              </button>
              <button className="button" onClick={() => download(chosen)}>
                <ArrowDownToLine size={14} />
                导出
              </button>
            </div>
            <div className="skill-detail-section">
              <h3>
                工作指令<span>Markdown</span>
              </h3>
              <pre className="skill-instructions-preview">
                {chosen.instructions}
              </pre>
            </div>
            <div className="skill-detail-section">
              <h3>
                工具权限<span>{chosen.tools.length} 项</span>
              </h3>
              <div className="skill-tool-tags">
                {chosen.tools.map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
            </div>
            <div className="skill-detail-section">
              <h3>
                输入契约<span>JSON Schema</span>
              </h3>
              <pre className="skill-code skill-code-light">
                {typeof chosen.input_schema === "string"
                  ? chosen.input_schema
                  : JSON.stringify(chosen.input_schema, null, 2)}
              </pre>
            </div>
            <div className="skill-detail-section">
              <h3>
                <span className="skill-test-title">
                  <FlaskConical size={16} />
                  只读参数测试
                </span>
              </h3>
              <p className="skill-detail-copy">
                检查参数是否符合 Skill
                契约，结果来自服务端。该入口不批准或执行业务动作。
              </p>
              <textarea
                aria-label="Skill 测试参数"
                disabled={busy}
                className="skill-code-input skill-test-input"
                spellCheck={false}
                value={testArgs}
                onChange={(event) => {
                  setTestArgs(event.target.value);
                  setTestResult(null);
                }}
              />
              <button
                disabled={busy}
                className="button primary"
                onClick={() => void test()}
              >
                {busy ? (
                  <Loader2 className="skill-spin" size={14} />
                ) : (
                  <Play size={14} />
                )}
                {busy ? "正在检查…" : "测试参数"}
              </button>
              {testResult && (
                <pre
                  className="skill-code skill-code-light skill-test-result"
                  aria-label="服务端测试结果"
                >
                  {testResult}
                </pre>
              )}
            </div>
            <div className="skill-detail-date">
              最后更新 {new Date(chosen.updated_at).toLocaleString("zh-CN")} ·{" "}
              {chosen.id}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
