"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Database,
  FileText,
  FlaskConical,
  History,
  Info,
  Layers3,
  Link2,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import type { ConsoleData } from "../lib/types";
import "./secondary.css";
import { useModalFocus } from "../lib/use-modal-focus";

type Props = {
  data: ConsoleData;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  notify: (message: string) => void;
  go: (path: string) => void;
};
const roles = [
  { value: "customers", label: "客户档案" },
  { value: "orders", label: "支付订单" },
  { value: "events", label: "行为事件" },
  { value: "contacts", label: "触达记录" },
  { value: "crm_tasks", label: "CRM 任务" },
  { value: "support_tickets", label: "售后工单" },
];
const roleName = (role: string) =>
  roles.find((item) => item.value === role)?.label ?? role;
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const statusName = (status: string) =>
  ({
    healthy: "运行正常",
    ready: "可用",
    active: "已启用",
    draft: "待审核",
    retired: "已归档",
    incomplete: "覆盖不足",
    stale: "数据过旧",
    running: "观察中",
    completed: "已完成",
    paused: "已暂停",
    validated: "已校验",
    pending: "待处理",
  })[status] ?? status;
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sec-heading">
      <div>
        <div className="sec-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="sec-empty">
      <Search size={24} />
      <strong>暂无匹配结果</strong>
      <span>{text}</span>
    </div>
  );
}
function Drawer({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  useModalFocus(true, close);
  return (
    <div className="sec-overlay" onClick={close}>
      <section
        className="sec-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sec-drawer-title">
          <h2>{title}</h2>
          <button
            className="sec-icon-button"
            aria-label="关闭详情"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function DataPage(props: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const sources = props.data.sources.filter(
    (source) =>
      (filter === "all" || source.role === filter) &&
      `${source.name} ${source.role} ${roleName(source.role)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const source = props.data.sources.find((item) => item.id === selected);
  return (
    <>
      <Heading
        eyebrow="DATA WORKSPACE"
        title="数据中心"
        description="把分散的业务数据，整理成可追溯的行动依据。"
      >
        <button
          className="button primary"
          onClick={() => props.go("/onboarding")}
        >
          <Plus size={16} />
          导入数据
        </button>
      </Heading>
      <div className="sec-summary-grid">
        <Summary
          label="已接入数据源"
          value={`${props.data.sources.length}`}
          note="覆盖客户、交易与运营记录"
          icon={<Database size={19} />}
        />
        <Summary
          label="数据记录"
          value={props.data.sources
            .reduce((sum, item) => sum + item.rows, 0)
            .toLocaleString()}
          note="当前接入版本的记录总量"
          icon={<Layers3 size={19} />}
        />
        <Summary
          label="业务表覆盖"
          value={`${new Set(props.data.sources.map((item) => item.role)).size} / 6`}
          note="完整覆盖有助于判断行动缺口"
          icon={<ShieldCheck size={19} />}
        />
      </div>
      <div className="sec-info">
        <Info size={17} />
        <span>
          数据质量决定行动边界。来源覆盖不足时，系统会保留未知状态，并限制受影响的操作。
        </span>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>业务数据源</h2>
            <p className="muted">查看来源、版本和覆盖范围</p>
          </div>
          <div className="sec-toolbar">
            <label className="sec-search">
              <Search size={16} />
              <input
                aria-label="搜索数据源"
                placeholder="搜索数据源…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="数据类型"
              className="field"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部类型</option>
              {roles.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="sec-table-wrap">
          <table className="sec-table">
            <thead>
              <tr>
                <th>数据源</th>
                <th>业务类型</th>
                <th>记录数</th>
                <th>状态</th>
                <th>数据截至</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="sec-source-name">
                      <span className="sec-file-icon">
                        <FileText size={18} />
                      </span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>{item.id}</small>
                      </div>
                    </div>
                  </td>
                  <td>{roleName(item.role)}</td>
                  <td>{item.rows.toLocaleString()}</td>
                  <td>
                    <span
                      className={`sec-status ${["healthy", "ready", "validated"].includes(item.status) ? "sec-status-green" : "sec-status-amber"}`}
                    >
                      {statusName(item.status)}
                    </span>
                  </td>
                  <td className="muted">{date(item.as_of)}</td>
                  <td>
                    <button
                      className="sec-text-button"
                      onClick={() => setSelected(item.id)}
                    >
                      查看详情
                      <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sources.length === 0 && (
          <Empty text="尝试更换关键词，或导入新的业务数据。" />
        )}
      </section>
      <div className="sec-bottom-note">
        <ShieldCheck size={15} />
        每次分析使用固定的数据快照，源文件更新不会改变已发生的运行记录。
      </div>
      {source && (
        <Drawer title="数据源详情" close={() => setSelected(null)}>
          <div className="sec-detail-hero">
            <Database size={26} />
            <h3>{source.name}</h3>
            <span className="badge">{roleName(source.role)}</span>
          </div>
          <dl className="sec-facts">
            <dt>数据源 ID</dt>
            <dd>{source.id}</dd>
            <dt>记录数</dt>
            <dd>{source.rows.toLocaleString()}</dd>
            <dt>数据截至</dt>
            <dd>{date(source.as_of)}</dd>
            <dt>质量状态</dt>
            <dd>{statusName(source.status)}</dd>
            <dt>覆盖声明</dt>
            <dd>
              {source.coverage
                ? "来源声明覆盖完整"
                : "来源覆盖不完整，相关结论受限"}
            </dd>
          </dl>
          <div className="sec-info">
            <Info size={17} />
            <span>
              覆盖声明用于界定结论范围，空数据不自动代表业务中没有发生过对应行为。
            </span>
          </div>
          <h3>已识别字段</h3>
          <div className="sec-tags">
            {source.columns?.length ? (
              source.columns.map((column) => <span key={column}>{column}</span>)
            ) : (
              <span>该来源尚未提供字段清单</span>
            )}
          </div>
          <SourceRows key={source.id} sourceId={source.id} />
          <div className="sec-actions">
            <button
              className="button primary"
              onClick={() => props.go("/onboarding")}
            >
              导入新版本
              <ArrowRight size={16} />
            </button>
          </div>
        </Drawer>
      )}
    </>
  );
}

function SourceRows({ sourceId }: { sourceId: string }) {
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const query = useQuery({
    queryKey: ["source-rows", sourceId, offset],
    queryFn: async () => {
      const response = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/rows?offset=${offset}&limit=${limit}`);
      if (!response.ok) throw new Error("数据暂时无法读取");
      const result = await response.json();
      return result.data as { rows: Record<string, unknown>[]; total: number };
    },
  });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const columns = Object.keys(rows[0] ?? {});
  return <section className="source-records">
    <div className="panel-head"><h3>业务记录</h3><span className="muted">{total.toLocaleString()} 条</span></div>
    {query.isPending ? <p className="muted">正在读取业务记录…</p> : query.isError ? <div className="sec-info">数据读取失败。<button className="text-button" onClick={() => query.refetch()}>重试</button></div> : rows.length === 0 ? <p className="muted">暂无业务记录</p> : <div className="sec-table-wrap"><table className="sec-table"><thead><tr>{columns.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={offset + index}>{columns.map(key => <td key={key}>{row[key] === null ? "—" : String(row[key])}</td>)}</tr>)}</tbody></table></div>}
    <div className="sec-actions"><span className="muted">{total ? offset + 1 : 0}–{Math.min(offset + limit, total)} / {total.toLocaleString()}</span><button className="button" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - limit))}>上一页</button><button className="button" disabled={offset + limit >= total || query.isFetching} onClick={() => setOffset(offset + limit)}>下一页</button></div>
  </section>;
}

function Summary({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="panel sec-summary">
      <div className="sec-summary-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="sec-summary-value">{value}</div>
      <p>{note}</p>
    </section>
  );
}

export function OnboardingPage(props: Props) {
  const [step, setStep] = useState(0);
  const [role, setRole] = useState("orders");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [unit, setUnit] = useState("minor");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [coverage, setCoverage] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState("减少高价值用户跟进遗漏");
  const [approved, setApproved] = useState(false);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headers =
    content
      .split(/\r?\n/)[0]
      ?.split(",")
      .map((item) => item.trim().replace(/^"|"$/g, "")) ?? [];
  const fields: Record<string, string[]> = {
    customers: [
      "customer_id",
      "created_at",
      "marketing_consent",
      "do_not_contact",
    ],
    orders: [
      "order_id",
      "customer_id",
      "paid_at",
      "paid_amount_minor",
      "refunded_amount_minor",
    ],
    events: ["event_id", "customer_id", "event_time", "session_id"],
    contacts: ["contact_id", "customer_id", "purpose", "status", "occurred_at"],
    crm_tasks: ["task_id", "customer_id", "purpose", "status", "due_at"],
    support_tickets: [
      "ticket_id",
      "customer_id",
      "category",
      "status",
      "opened_at",
    ],
  };
  async function readFile(file?: File) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      props.notify(
        "当前导入支持 CSV。XLSX / Parquet 解析尚未接通，请先导出 CSV。",
      );
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      props.notify("文件超过 50 MB，请缩小文件后重试。");
      return;
    }
    const text = await file.text();
    setFilename(file.name);
    setContent(text);
    const columns = text
      .split(/\r?\n/)[0]
      .split(",")
      .map((item) => item.trim().replace(/^"|"$/g, ""));
    setMapping(
      Object.fromEntries(
        fields[role].map((field) => [
          field,
          columns.includes(field) ? field : "",
        ]),
      ),
    );
  }
  async function next() {
    setBusy(true);
    try {
      if (step === 0) {
        if (!content.trim()) throw new Error("请先选择有内容的 CSV 文件。");
        const result = await props.mutate("upload", {
          filename,
          content,
          role,
        });
        if (result == null) return;
        const id =
          result?.source_id ??
          result?.id ??
          result?.source?.id ??
          result?.dataset_version_id;
        if (!id)
          throw new Error("导入接口没有返回数据源 ID，请检查导入结果后重试。");
        setSourceId(String(id));
      }
      if (step === 1) {
        if (Object.values(mapping).some((value) => !value))
          throw new Error("请完成所有字段映射。");
        if (!coverage) throw new Error("请确认来源覆盖声明后继续。");
        if (
          (await props.mutate("mapping", {
            source_id: sourceId,
            mapping,
            unit,
            timezone,
            coverage,
          })) == null
        )
          return;
      }
      if (step === 2 && !goal.trim()) throw new Error("请输入运营目标。");
      if (step === 3) {
        if (!approved) throw new Error("请确认工作区的工具权限。");
        if (
          (await props.mutate("activate", {
            source_id: sourceId,
            goal,
            tools: ["query_metrics", "get_support_tickets", "create_crm_task"],
            mode: "simulated",
          })) == null
        )
          return;
        setFinished(true);
      } else setStep((value) => value + 1);
    } catch (error) {
      props.notify(
        error instanceof Error ? error.message : "操作失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="CONNECT YOUR DATA"
        title="接入业务数据"
        description="从清晰的数据映射开始，让每一个行动都有依据。"
      />
      <div className="sec-wizard">
        <aside className="sec-wizard-steps">
          {["上传数据", "确认字段映射", "定义运营目标", "权限与激活"].map(
            (label, index) => (
              <div
                key={label}
                className={`sec-step ${index === step ? "sec-step-active" : ""}`}
              >
                <span>
                  {index < step || finished ? (
                    <Check size={16} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {
                      [
                        "选择标准表角色与文件",
                        "确认单位、时间和覆盖",
                        "限定首个业务场景",
                        "检查可用能力并启用",
                      ][index]
                    }
                  </small>
                </div>
              </div>
            ),
          )}
          <div className="sec-wizard-tip">
            <ShieldCheck size={20} />
            <p>执行动作将写入客户管理系统，并回读确认结果。</p>
          </div>
        </aside>
        <section className="panel sec-wizard-body">
          {finished ? (
            <div className="sec-complete">
              <CheckCircle2 size={48} />
              <h2>数据接入配置已保存</h2>
              <p>
                上传文件与字段映射已保存，可在数据中心查看预览。当前分析使用内置业务数据集。
              </p>
              <button
                className="button primary"
                onClick={() => props.go("/agents")}
              >
                查看 Agent
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="sec-section-kicker">STEP 0{step + 1} / 04</div>
              <h2>
                {
                  [
                    "选择需要接入的数据",
                    "让字段与业务含义对齐",
                    "你希望 Agent 关注什么？",
                    "检查并启用工作流",
                  ][step]
                }
              </h2>
              <p className="muted">
                {
                  [
                    "支持 CSV 文件，单文件不超过 50 MB。",
                    "系统建议仅供参考，请确认关键业务字段。",
                    "当前业务包专注于高价值客户的跟进遗漏。",
                    "操作能力同时受到来源覆盖和工具权限约束。",
                  ][step]
                }
              </p>
              {step === 0 && (
                <>
                  <label className="sec-label">
                    标准业务表
                    <select
                      className="field"
                      value={role}
                      onChange={(e) => {
                        setRole(e.target.value);
                        setMapping(
                          Object.fromEntries(
                            fields[e.target.value].map((field) => [
                              field,
                              headers.includes(field) ? field : "",
                            ]),
                          ),
                        );
                      }}
                    >
                      {roles.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label} · {item.value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv"
                    className="sec-hidden"
                    onChange={(e) => void readFile(e.target.files?.[0])}
                  />
                  <button
                    className="sec-upload"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void readFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <span>
                      <UploadCloud size={26} />
                    </span>
                    <strong>{filename || "点击选择或拖入 CSV 文件"}</strong>
                    <small>
                      {filename
                        ? "点击重新选择文件"
                        : "UTF-8 编码 · 第一行为字段名称"}
                    </small>
                  </button>
                  <p className="sec-helper">
                    XLSX / Parquet 导入待接通，可先导出为
                    CSV。复杂引号或多行字段以服务端校验结果为准。
                  </p>
                </>
              )}
              {step === 1 && (
                <>
                  <div className="sec-mapping-title">
                    <span>标准字段</span>
                    <span>源文件字段</span>
                  </div>
                  {fields[role].map((field) => (
                    <label className="sec-mapping-row" key={field}>
                      <code>{field}</code>
                      <select
                        className="field"
                        value={mapping[field] ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [field]: e.target.value })
                        }
                      >
                        <option value="">请选择对应字段</option>
                        {headers.map((header, index) => (
                          <option key={`${header}-${index}`} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <div className="sec-form-grid">
                    <label className="sec-label">
                      金额单位
                      <select
                        className="field"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      >
                        <option value="minor">人民币分（整数）</option>
                        <option value="major">人民币元</option>
                      </select>
                    </label>
                    <label className="sec-label">
                      来源时区
                      <select
                        className="field"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                      >
                        <option value="Asia/Shanghai">
                          Asia/Shanghai · UTC+8
                        </option>
                        <option value="UTC">UTC</option>
                      </select>
                    </label>
                  </div>
                  <label className="sec-check">
                    <input
                      type="checkbox"
                      checked={coverage}
                      onChange={(e) => setCoverage(e.target.checked)}
                    />
                    <span>
                      我确认该来源在声明范围内完整覆盖，空记录不代表未接入的业务。
                    </span>
                  </label>
                </>
              )}
              {step === 2 && (
                <>
                  <label className="sec-label">
                    运营目标
                    <textarea
                      aria-label="运营目标"
                      className="field"
                      rows={3}
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                    />
                  </label>
                  <div className="sec-rule-card">
                    <span className="sec-icon-tile">
                      <Layers3 size={21} />
                    </span>
                    <div>
                      <strong>高价值用户挽回</strong>
                      <p>
                        从客户价值、近期支付和活跃变化发现信号，再检查是否缺少跟进。
                      </p>
                      <span className="badge">24 小时宽限期</span>
                      <span className="badge">72 小时触达冷却</span>
                    </div>
                  </div>
                  <div className="sec-info">
                    <CircleHelp size={18} />
                    <span>
                      来源不足时仅提供风险洞察，不能据此断言没有跟进动作。
                    </span>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <div className="sec-permission">
                    <CheckCircle2 size={20} />
                    <div>
                      <strong>读取业务指标与证据</strong>
                      <p>仅访问已接入的业务范围与固定快照</p>
                    </div>
                    <span className="badge">只读</span>
                  </div>
                  <div className="sec-permission">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>在 Sandbox 建立 CRM 任务</strong>
                      <p>执行前完成策略校验，按要求提交人工审批</p>
                    </div>
                    <span className="badge">受控写入</span>
                  </div>
                  <div className="sec-info">
                    <Info size={17} />
                    <span>
                      发送营销、发放优惠券及真实 CRM 写入未在此接入流程中授权。
                    </span>
                  </div>
                  <label className="sec-check">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    <span>确认以上目标与工具权限，激活工作区。</span>
                  </label>
                </>
              )}
              <div className="sec-wizard-footer">
                <button
                  className="button"
                  disabled={step === 0 || busy}
                  onClick={() => setStep((value) => value - 1)}
                >
                  上一步
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void next()}
                >
                  {busy
                    ? "正在处理…"
                    : step === 3
                      ? "编译并激活"
                      : "保存并继续"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export function ExperimentsPage(props: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const experiments = props.data.experiments.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) &&
      (tab === "all" || (tab === "mature" ? item.mature : !item.mature)),
  );
  const chosen = props.data.experiments.find((item) => item.id === selected);
  return (
    <>
      <Heading
        eyebrow="MEASURE WHAT MATTERS"
        title="实验与效果观察"
        description="先等待完整的观察窗口，再判断数据说明了什么。"
      >
        <span className="sec-status sec-status-blue">效果观察</span>
      </Heading>
      <div className="sec-summary-grid">
        <Summary
          label="实验总数"
          value={String(props.data.experiments.length)}
          note="当前工作区的行动实验"
          icon={<FlaskConical size={19} />}
        />
        <Summary
          label="等待观察"
          value={String(
            props.data.experiments.filter((item) => !item.mature).length,
          )}
          note="尚未满足完整观察条件"
          icon={<History size={19} />}
        />
        <Summary
          label="已成熟实验"
          value={String(
            props.data.experiments.filter((item) => item.mature).length,
          )}
          note="成熟不等同于已证明策略有效"
          icon={<CheckCircle2 size={19} />}
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <div className="tabs">
            {[
              ["all", "全部实验"],
              ["waiting", "观察中"],
              ["mature", "已成熟"],
            ].map(([value, label]) => (
              <button
                className={tab === value ? "active" : ""}
                key={value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="sec-search">
            <Search size={16} />
            <input
              aria-label="搜索实验"
              placeholder="搜索实验名称…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="sec-experiment-list">
          {experiments.map((item) => (
            <button
              className="sec-experiment"
              key={item.id}
              onClick={() => setSelected(item.id)}
            >
              <div className="sec-experiment-top">
                <span className="sec-icon-tile">
                  <FlaskConical size={21} />
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.id} · 7 日净支付客户比例</small>
                </div>
                <span
                  className={`sec-status ${item.mature ? "sec-status-green" : "sec-status-amber"}`}
                >
                  {item.mature ? "观察窗口已成熟" : "等待观察数据"}
                </span>
                <ChevronRight size={17} />
              </div>
              <div className="sec-experiment-metrics">
                <div>
                  <small>处理组 / 对照组</small>
                  <strong>
                    {item.treatment_n} / {item.control_n}
                    <em>人</em>
                  </strong>
                </div>
                <div>
                  <small>计划样本量</small>
                  <strong>
                    {item.target_n}
                    <em>人</em>
                  </strong>
                </div>
                <div>
                  <small>观察进度</small>
                  <strong>
                    {item.days_elapsed} / {item.window_days}
                    <em>天</em>
                  </strong>
                </div>
                <div>
                  <small>结论状态</small>
                  <strong className="sec-small-value">
                    {item.mature ? "查看数据与质量诊断" : "尚不作效果判断"}
                  </strong>
                </div>
              </div>
              <div className="sec-progress">
                <span
                  style={{
                    width: `${Math.min(100, (100 * item.days_elapsed) / Math.max(1, item.window_days))}%`,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
        {!experiments.length && <Empty text="当前筛选下没有实验。" />}
      </section>
      <div className="sec-info">
        <Info size={17} />
        <span>
          实验按目标人群、分组和观察窗口跟踪结果。未经对照的观察变化不能归因于本次行动。
        </span>
      </div>
      {chosen && (
        <Drawer title="实验详情" close={() => setSelected(null)}>
          <div className="sec-detail-hero">
            <FlaskConical size={28} />
            <h3>{chosen.name}</h3>
            <span className="badge">行动实验</span>
          </div>
          <h3>冻结分组与观察数据</h3>
          <table className="sec-table">
            <thead>
              <tr>
                <th>组别</th>
                <th>分配人数</th>
                <th>支付人数</th>
                <th>观测比例</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["处理组", chosen.treatment_n, chosen.treatment_success],
                ["对照组", chosen.control_n, chosen.control_success],
              ].map(([label, n, success]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{n}</td>
                  <td>{success}</td>
                  <td>
                    {Number(n)
                      ? `${((100 * Number(success)) / Number(n)).toFixed(1)}%`
                      : "暂无样本"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sec-info">
            <Info size={17} />
            <span>
              {chosen.mature
                ? "窗口已成熟。当前页面提供描述统计；区间估计、SRM 与资格质量检查尚未接通，因此不提供胜出判断。"
                : `观察进度 ${chosen.days_elapsed}/${chosen.window_days} 天。最终结果仍需完整数据覆盖与质量校验。`}
            </span>
          </div>
          <dl className="sec-facts">
            <dt>分析原则</dt>
            <dd>按最初分配组计算，保留执行失败者</dd>
            <dt>计划样本量</dt>
            <dd>{chosen.target_n} 人</dd>
            <dt>证据等级</dt>
            <dd>simulated_experiment</dd>
          </dl>
        </Drawer>
      )}
    </>
  );
}

export function MemoriesPage(props: Props) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const memories = props.data.memories.filter(
    (item) =>
      (tab === "all" || item.status === tab) &&
      `${item.title} ${item.summary} ${item.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const chosen = props.data.memories.find((item) => item.id === selected);
  const grades: Record<string, string> = {
    operational_fact: "运营事实",
    observational: "观察关联",
    simulated_experiment: "行动实验",
    randomized_experiment: "随机实验",
  };
  async function review(decision: string) {
    if (!chosen) return;
    setBusy(true);
    try {
      if (
        (await props.mutate("memory-review", {
          id: chosen.id,
          memory_id: chosen.id,
          decision,
          comment,
        })) == null
      )
        return;
      props.notify("审核意见已保存");
      setSelected(null);
      setComment("");
    } catch (error) {
      props.notify(
        error instanceof Error ? error.message : "审核未保存，请重试",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="KNOWLEDGE WITH EVIDENCE"
        title="策略记忆"
        description="留下有依据的经验，让下一次判断有迹可循。"
      />
      <div className="sec-info">
        <ShieldCheck size={18} />
        <span>
          记忆先审核、再引用。经验保留适用条件和证据来源，观察关联不会自动升级为因果结论。
        </span>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div className="tabs">
            {[
              ["all", "全部记忆"],
              ["draft", "待审核"],
              ["active", "已启用"],
              ["retired", "已归档"],
            ].map(([value, label]) => (
              <button
                className={tab === value ? "active" : ""}
                key={value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="sec-search">
            <Search size={16} />
            <input
              aria-label="搜索策略记忆"
              placeholder="搜索名称、内容或标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="sec-memory-grid">
          {memories.map((item) => (
            <button
              className="sec-memory"
              key={item.id}
              onClick={() => {
                setSelected(item.id);
                setComment("");
              }}
            >
              <div className="sec-memory-top">
                <span className="sec-status sec-status-blue">
                  {grades[item.grade] ?? item.grade}
                </span>
                <span
                  className={`sec-status ${item.status === "active" ? "sec-status-green" : "sec-status-amber"}`}
                >
                  {statusName(item.status)}
                </span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              <div className="sec-tags">
                {item.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <footer>
                <span>
                  样本 {item.sample_size} · {date(item.updated_at)}
                </span>
                <ChevronRight size={16} />
              </footer>
            </button>
          ))}
        </div>
        {!memories.length && <Empty text="尝试其他标签或审核状态。" />}
      </section>
      {chosen && (
        <Drawer title="策略记忆详情" close={() => setSelected(null)}>
          <span className="sec-status sec-status-blue">
            {grades[chosen.grade] ?? chosen.grade}
          </span>
          <h2>{chosen.title}</h2>
          <p className="sec-reading">{chosen.summary}</p>
          <dl className="sec-facts">
            <dt>状态</dt>
            <dd>{statusName(chosen.status)}</dd>
            <dt>样本量</dt>
            <dd>{chosen.sample_size}</dd>
            <dt>更新时间</dt>
            <dd>{date(chosen.updated_at)}</dd>
            <dt>适用标签</dt>
            <dd>{chosen.tags.join("、")}</dd>
          </dl>
          <div className="sec-info">
            <Info size={17} />
            <span>
              审核通过允许在适用范围内作为规划背景，不能改变安全规则、预算或客户同意状态。
            </span>
          </div>
          <label className="sec-label">
            审核意见
            <textarea
              className="field"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="记录证据边界、适用场景或退回原因…"
            />
          </label>
          <div className="sec-actions">
            {chosen.status === "draft" && (
              <button
                disabled={busy}
                className="button primary"
                onClick={() => void review("approve")}
              >
                审核通过
              </button>
            )}
            {chosen.status !== "retired" && (
              <button
                disabled={busy}
                className="button"
                onClick={() => void review("retire")}
              >
                归档记忆
              </button>
            )}
          </div>
        </Drawer>
      )}
    </>
  );
}

export function SettingsPage(props: Props) {
  const [tab, setTab] = useState("workspace");
  const [name, setName] = useState(props.data.settings.workspace_name);
  const [limit, setLimit] = useState(props.data.settings.daily_limit);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim() || limit < 1 || !Number.isInteger(limit)) {
      props.notify("请填写工作区名称和大于 0 的整数配额。");
      return;
    }
    setBusy(true);
    try {
      if (
        (await props.mutate("settings", {
          workspace_name: name.trim(),
          daily_limit: limit,
        })) == null
      )
        return;
      props.notify("工作区设置已保存");
    } catch (error) {
      props.notify(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      const result = await props.mutate("connection-test", {
        kind: "mock-crm",
      });
      if (result == null) return;
      props.notify(
        result?.message ??
          (result?.health
            ? `连接检查：${result.health}`
            : "连接检查已返回，请查看来源健康状态。"),
      );
    } catch (error) {
      props.notify(error instanceof Error ? error.message : "连接检查失败");
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      if (
        (await props.mutate("settings", {
          kill_switch: !props.data.settings.kill_switch,
          reason: "工作区设置页更新执行开关",
        })) == null
      )
        return;
      props.notify(
        props.data.settings.kill_switch
          ? "已提交恢复自动执行"
          : "已提交暂停自动执行",
      );
    } catch (error) {
      props.notify(error instanceof Error ? error.message : "状态更新失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="WORKSPACE CONTROL"
        title="工作区设置"
        description="管理连接、执行边界，以及工作区的运行记录。"
      />
      <div className="sec-settings-layout">
        <nav className="sec-settings-nav" aria-label="设置分类">
          {[
            ["workspace", "工作区", Settings2],
            ["connections", "数据与连接", Link2],
            ["safety", "执行控制", ShieldCheck],
            ["audit", "审计日志", History],
          ].map(([value, label, Icon]) => {
            const Component = Icon as typeof Settings2;
            return (
              <button
                key={String(value)}
                className={tab === value ? "active" : ""}
                onClick={() => setTab(String(value))}
              >
                <Component size={17} />
                {String(label)}
              </button>
            );
          })}
        </nav>
        <section className="panel sec-settings-body">
          {tab === "workspace" && (
            <>
              <h2>基本设置</h2>
              <p className="muted">为团队定义清晰的工作空间与运行配额。</p>
              <label className="sec-label">
                工作区名称
                <input
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="sec-form-grid">
                <label className="sec-label">
                  每日完整调查上限
                  <input
                    className="field"
                    type="number"
                    min={1}
                    step={1}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  />
                </label>
                <label className="sec-label">
                  工作区时区
                  <input
                    className="field"
                    readOnly
                    value="Asia/Shanghai · UTC+8"
                  />
                </label>
              </div>
              <div className="sec-info">
                <Info size={17} />
                <span>
                  配额用于限制自动调查次数，达到额度后保留已获得的证据并停止新的调查。
                </span>
              </div>
              <div className="sec-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "正在保存…" : "保存设置"}
                </button>
              </div>
            </>
          )}
          {tab === "connections" && (
            <>
              <h2>连接器</h2>
              <p className="muted">
                检查工具可用性，查看本次运行依赖的数据来源。
              </p>
              <div className="sec-connector">
                <span className="sec-icon-tile">
                  <Link2 size={22} />
                </span>
                <div>
                  <h3>客户管理</h3>
                  <p>跟进任务、执行回读与状态同步</p>
                  <span className="badge">读取客户 / 建立任务 / 回读验证</span>
                </div>
                <button
                  disabled={busy}
                  className="button"
                  onClick={() => void test()}
                >
                  {busy ? "检查中…" : "测试连接"}
                </button>
              </div>
              <h3>来源健康</h3>
              {props.data.sources.map((source) => (
                <div key={source.id} className="sec-health-row">
                  <span>
                    {roleName(source.role)}
                    <small>{source.name}</small>
                  </span>
                  <span className="badge">{statusName(source.status)}</span>
                </div>
              ))}
              <div className="sec-info">
                <Info size={17} />
                <span>
                  连接测试检查客户管理服务的可访问性，不执行业务写入。
                </span>
              </div>
            </>
          )}
          {tab === "safety" && (
            <>
              <h2>执行控制</h2>
              <p className="muted">在工作区范围管理后续自动动作。</p>
              <div
                className={`sec-safety-box ${props.data.settings.kill_switch ? "sec-safety-paused" : ""}`}
              >
                <ShieldCheck size={25} />
                <div>
                  <h3>
                    {props.data.settings.kill_switch
                      ? "自动执行已暂停"
                      : "自动执行开关已开启"}
                  </h3>
                  <p>暂停会拦截尚未执行的动作，已完成的外部操作仍保留记录。</p>
                </div>
                <button
                  disabled={busy}
                  className="button"
                  onClick={() => void stop()}
                >
                  {props.data.settings.kill_switch
                    ? "恢复执行"
                    : "暂停自动执行"}
                </button>
              </div>
              <h3>当前工作区边界</h3>
              {[
                "数据保存在当前设备的工作区中",
                "计划审批绑定准确人群、参数与版本",
                "营销同意未知时禁止自动促销",
                "外部状态未知时先核对，避免重复操作",
              ].map((text) => (
                <div className="sec-rule-line" key={text}>
                  <CheckCircle2 size={17} />
                  {text}
                </div>
              ))}
              <div className="sec-info">
                <Info size={17} />
                <span>
                  工作区统一管理操作权限，审批记录与执行记录均可追溯。
                </span>
              </div>
            </>
          )}
          {tab === "audit" && (
            <>
              <h2>审计日志</h2>
              <p className="muted">按服务端记录展示操作与状态变化。</p>
              <div className="sec-audit-list">
                {props.data.audit.map((item) => (
                  <div key={item.id} className="sec-audit">
                    <span>
                      <History size={16} />
                    </span>
                    <div>
                      <strong>{item.operation}</strong>
                      <p>{item.detail}</p>
                      <small>
                        {date(item.at)} · {item.id}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
              {!props.data.audit.length && (
                <Empty text="保存设置或执行操作后，可在这里检查审计记录。" />
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
