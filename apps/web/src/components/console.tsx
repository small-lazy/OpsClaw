"use client";
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Activity,
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  FlaskConical,
  Layers3,
  LayoutDashboard,
  Link2,
  Loader2,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  TrendingUp,
  Workflow,
  X,
  XCircle,
  SquareArrowOutUpRight,
  LogOut,
  BookOpen,
  Filter,
  CalendarDays,
  Command,
  PanelLeftClose,
  ClipboardList,
  MessageSquareText,
  BarChart3,
  Upload,
  Info,
} from "lucide-react";
import type { ConsoleData, Incident, Plan, Run, PageProps } from "../lib/types";
import { seed } from "../lib/seed";
import type { components } from "../lib/api.generated";
import { SkillsPage } from "./skills-page";
import {
  DataPage,
  OnboardingPage,
  ExperimentsPage,
  MemoriesPage,
  SettingsPage,
} from "./secondary-pages";
const TrendChart = dynamic(() => import("./charts"), {
  ssr: false,
  loading: () => <div className="chart-loading">正在准备趋势图…</div>,
});
const RunGraph = dynamic(() => import("./run-graph"), {
  ssr: false,
  loading: () => <div className="chart-loading">正在加载运行图…</div>,
});
const stateLabels: Record<string, string> = {
  queued: "待执行",
  open: "待调查",
  action_planned: "待审批",
  blocked: "数据受限",
  investigating: "调查中",
  covered: "已覆盖",
  observing: "待观察",
  resolved: "已完成",
  dismissed: "已关闭",
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  succeeded: "已回读验证",
  compensated: "已补偿",
  cancelled: "已取消",
  waiting_approval: "待审批",
  waiting_observation: "待观察数据",
  completed: "已完成",
  failed: "失败",
  unknown: "状态待核对",
  active: "运行中",
  paused: "已暂停",
  ready: "已就绪",
  draft: "草稿",
  observational: "观察证据",
  operational_fact: "操作事实",
};
function shortTime(value: string) {
  return value.includes("T")
    ? new Date(value).toLocaleTimeString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : value;
}
function shortDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function Badge({ state, children }: { state?: string; children?: ReactNode }) {
  return (
    <span className={`badge ${state || ""}`}>
      <span className="badge-dot" />
      {children || stateLabels[state || ""] || state}
    </span>
  );
}
function Logo() {
  return (
    <div className="brand">
      <div className="brand-symbol">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <div>
        <strong>
          OpsWeaver
        </strong>
        <small>数据运营工作台</small>
      </div>
    </div>
  );
}
function Empty({
  title = "暂无记录",
  detail = "完成相关操作后，记录会出现在这里。",
  children,
}: {
  title?: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Layers3 size={28} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <small>OPSWEAVER / 工作空间</small>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭弹窗">
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
function Heading({
  title,
  subtitle,
  children,
  eyebrow,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Spark({
  color = "blue",
  line = false,
}: {
  color?: string;
  line?: boolean;
}) {
  return line ? (
    <svg className="spark-line" viewBox="0 0 110 38" aria-hidden="true">
      <path
        d="M2 32 Q10 37 20 24 T40 21 T60 12 T80 15 T106 3"
        fill="none"
        stroke="#20a380"
        strokeWidth="2.2"
      />
    </svg>
  ) : (
    <div className={`spark-bars ${color}`}>
      {[10, 16, 13, 23, 18, 31, 25, 35, 21].map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </div>
  );
}
function download(
  name: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff", content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const navGroups = [
  {
    label: "工作空间",
    items: [
      { url: "/overview", label: "运营总览", icon: LayoutDashboard },
      { url: "/incidents", label: "行动缺口", icon: ClipboardList },
      { url: "/agents", label: "Agent 运行", icon: Bot },
      { url: "/approvals", label: "审批中心", icon: FileCheck2 },
      { url: "/actions", label: "动作台账", icon: CheckCheck },
    ],
  },
  {
    label: "数据与策略",
    items: [
      { url: "/data", label: "数据中心", icon: Database },
      { url: "/experiments", label: "实验中心", icon: FlaskConical },
      { url: "/memories", label: "策略记忆", icon: BookOpen },
      { url: "/skills", label: "Skill 工坊", icon: Sparkles },
    ],
  },
];
function IncidentTable({
  items,
  go,
  compact = false,
}: {
  items: Incident[];
  go: (path: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table
        className={`data-table incident-table ${compact ? "compact" : ""}`}
      >
        <thead>
          <tr>
            <th>客户</th>
            <th>发现的缺口</th>
            <th>优先级</th>
            {!compact && <th>持续时间</th>}
            <th>状态</th>
            <th className="right">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, index) => (
            <tr key={i.id} onClick={() => go(`/incidents/${i.id}`)}>
              <td>
                <div className="customer">
                  <span className={`avatar pastel-${index % 5}`}>
                    {i.customer.slice(1, 3)}
                  </span>
                  <div>
                    <strong>{i.customer}</strong>
                    <small>{i.segment}</small>
                  </div>
                </div>
              </td>
              <td>
                <span className="incident-title">{i.title}</span>
                {!compact && (
                  <small className="table-secondary">{i.kind}</small>
                )}
              </td>
              <td>
                {i.status === "blocked" ? (
                  <span className="priority unknown">待核查</span>
                ) : (
                  <span
                    className={`priority ${i.priority >= 80 ? "high" : "medium"}`}
                  >
                    <i />
                    {i.priority >= 80 ? "高" : "中"}
                    {!compact && ` · ${i.priority}`}
                  </span>
                )}
              </td>
              {!compact && <td>{i.hours} 小时</td>}
              <td>
                <Badge state={i.status} />
              </td>
              <td className="right">
                <button
                  className="text-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(`/incidents/${i.id}`);
                  }}
                >
                  查看 <ArrowRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <Empty title="没有符合条件的缺口" detail="尝试更换关键词或筛选条件。" />
      )}
    </div>
  );
}
function Overview({ data, go, mutate, notify }: PageProps) {
  const [tab, setTab] = useState("all");
  const [range, setRange] = useState("7");
  const [detail, setDetail] = useState(false);
  const pending = data.plans.filter((p) => p.status === "pending");
  const actionable = data.incidents.filter(
    (i) => !["blocked", "covered", "observing", "dismissed"].includes(i.status),
  );
  const shown = data.incidents
    .filter((i) => tab === "all" || i.status === tab)
    .slice(0, 5);
  const coverage = data.coverage.denominator
    ? data.coverage.numerator / data.coverage.denominator
    : null;
  return (
    <>
      <Heading
        title="运营总览"
        subtitle="从数据信号到可验证的行动，让每一次跟进都有据可循。"
      >
        <button className="button" onClick={() => go("/data")}>
          <BarChart3 size={16} />
          查看数据
        </button>
        <button
          className="button primary"
          onClick={() => mutate("scan")}
          disabled={data.settings.kill_switch}
        >
          <Play size={15} fill="currentColor" />
          运行检测
        </button>
      </Heading>
      <div className="freshness">
        <span className="live-dot" />
        运营数据已就绪
        <span className="divider" />
        {data.as_of.slice(0, 16).replace("T", " ")}
        <span className="divider" />
        {data.sources.length} 个数据源
        <span className="mini-label">内置数据</span>
      </div>
      <div className="metrics">
        <button className="metric" onClick={() => go("/incidents")}>
          <div className="metric-label">
            待处理行动缺口
            <ClipboardList size={17} />
          </div>
          <strong>
            {actionable.length}
            <small>个</small>
          </strong>
          <div className="metric-foot">
            <span className="orange">
              优先处理 {actionable.filter((i) => i.priority >= 80).length}{" "}
              个高优先级
            </span>
            <Spark color="orange" />
          </div>
        </button>
        <button className="metric" onClick={() => go("/approvals")}>
          <div className="metric-label">
            等待人工审批
            <Clock3 size={18} />
          </div>
          <strong>
            {pending.length}
            <small>项</small>
          </strong>
          <div className="metric-foot">
            <span>方案已完成权限检查</span>
            <Spark color="amber" />
          </div>
        </button>
        <button className="metric" onClick={() => go("/actions")}>
          <div className="metric-label">
            已执行待观察
            <CheckCircle2 size={18} />
          </div>
          <strong>
            {data.actions.filter((a) => a.status === "succeeded").length}
            <small>项</small>
          </strong>
          <div className="metric-foot">
            <span>
              <CheckCircle2 size={13} className="green" /> 以 CRM 回读为准
            </span>
            <Spark color="green" />
          </div>
        </button>
        <button className="metric" onClick={() => setDetail(true)}>
          <div className="metric-label">
            24h 行动覆盖率
            <TrendingUp size={18} />
          </div>
          <strong>
            {coverage === null ? "—" : (coverage * 100).toFixed(1)}
            {coverage !== null && <em>%</em>}
          </strong>
          <div className="metric-foot">
            <span className="green">
              {data.coverage.previous_denominator ? `${(((coverage ?? 0) - data.coverage.previous) * 100).toFixed(1)} pp 较上期` : "无上期成熟样本"}
            </span>
          </div>
        </button>
      </div>
      <div className="dashboard-grid">
        <section className="panel gaps-panel">
          <div className="panel-head">
            <h2>
              优先处理的行动缺口{" "}
              <span className="count-pill">{actionable.length}</span>
            </h2>
            <button className="text-button" onClick={() => go("/incidents")}>
              全部缺口
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="tabs compact-tabs">
            {[
              ["all", "全部"],
              ["open", "待调查"],
              ["action_planned", "待审批"],
              ["blocked", "受限"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
                <span>
                  {
                    data.incidents.filter(
                      (i) => key === "all" || i.status === key,
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <IncidentTable items={shown} go={go} compact />
        </section>
        <section className="panel todo-panel">
          <div className="panel-head">
            <h2>
              待办与提醒{" "}
              <span className="count-pill amber">{pending.length}</span>
            </h2>
            <Bell size={17} className="muted" />
          </div>
          <button className="approval-callout" onClick={() => go("/approvals")}>
            <span className="callout-icon">
              <Clock3 size={20} />
            </span>
            <div>
              <strong>
                {pending.length
                  ? `${pending.length} 个行动方案等待审阅`
                  : "所有方案已处理"}
              </strong>
              <p>人工确认后，执行获授权的任务。</p>
            </div>
            <ChevronRight size={16} />
          </button>
          {pending.slice(0, 2).map((p) => (
            <button
              className="todo-item"
              key={p.id}
              onClick={() => go(`/approvals?plan=${p.id}`)}
            >
              <span className="soft-icon">
                <FileText size={19} />
              </span>
              <div>
                <strong>{p.title}</strong>
                <small>1 位客户 · {p.owner}</small>
                <span className="todo-time">计划 v{p.version} · 等待审批</span>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
          <button
            className="todo-item source-todo"
            onClick={() => go("/incidents?status=blocked")}
          >
            <span className="soft-icon neutral">
              <Database size={19} />
            </span>
            <div>
              <strong>来源覆盖需要确认</strong>
              <small>
                {data.incidents.filter((i) => !i.coverage).length}{" "}
                个案例暂无法判断行动缺口
              </small>
            </div>
            <ChevronRight size={15} />
          </button>
        </section>
        <section className="panel trend-panel">
          <div className="panel-head">
            <h2>
              行动缺口趋势{" "}
              <span className="inline-meta">近 {range} 天 · 内置数据</span>
            </h2>
            <div className="segmented">
              {["7", "30"].map((r) => (
                <button
                  key={r}
                  className={range === r ? "active" : ""}
                  onClick={() => setRange(r)}
                >
                  {r} 天
                </button>
              ))}
            </div>
          </div>
          <div className="chart-legend">
            <span>
              <i className="blue-dot" />
              新发现缺口
            </span>
            <span>
              <i className="green-dot" />
              已覆盖缺口
            </span>
            <button
              className="text-button subtle"
              onClick={() => setDetail(true)}
            >
              查看明细
            </button>
          </div>
          <TrendChart rows={data.trend.slice(-Number(range))} />
        </section>
        <section className="panel recent-panel">
          <div className="panel-head">
            <h2>最近 Agent 运行</h2>
            <button className="text-button" onClick={() => go("/agents")}>
              全部运行
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="recent-list">
            {data.runs
              .slice()
              .reverse()
              .slice(0, 3)
              .map((r) => (
                <button
                  className="recent-item"
                  key={r.id}
                  onClick={() => go(`/runs/${r.id}`)}
                >
                  <span
                    className={`timeline-dot ${r.state === "waiting_approval" ? "amber" : "green"}`}
                  >
                    {r.state === "waiting_approval" ? (
                      <Clock3 size={15} />
                    ) : (
                      <Check size={15} />
                    )}
                  </span>
                  <div>
                    <div className="recent-title">
                      <strong>{r.title}</strong>
                      <Badge state={r.state} />
                    </div>
                    <small>
                      {r.customer} · {shortTime(r.started_at).slice(0, 5)}
                    </small>
                    <span className="mono">#{r.id}</span>
                  </div>
                </button>
              ))}
          </div>
          <div className="panel-bottom">
            <ShieldCheck size={14} />
            每一步调查和执行均保留记录
          </div>
        </section>
      </div>
      {detail && (
        <Dialog title="行动指标与趋势明细" onClose={() => setDetail(false)}>
          <div className="info-strip">
            <Info size={18} />
            当前数据为预置内置数据，不代表实际业务收益。
          </div>
          <h3>24 小时行动覆盖率</h3>
          <p className="body-copy">
            已完整经过 24 小时窗口的 {data.coverage.denominator} 个缺口中，
            {data.coverage.numerator}{" "}
            个在窗口内得到相关任务或成功触达覆盖。创建任务不等于已触达或已挽回客户。
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>新发现</th>
                <th>已覆盖</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td>{r.detected}</td>
                  <td>{r.covered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Dialog>
      )}
    </>
  );
}
function Incidents({ data, go }: PageProps) {
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [status, setStatus] = useState(params.get("status") || "all");
  const [priority, setPriority] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = data.incidents.filter(
    (i) =>
      (status === "all" || i.status === status) &&
      (priority === "all" ||
        (priority === "high" ? i.priority >= 80 : i.priority < 80)) &&
      `${i.customer} ${i.title} ${i.segment}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function update(q: string, s: string) {
    setQuery(q);
    setStatus(s);
    setPage(1);
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s !== "all") p.set("status", s);
    window.history.replaceState(null, "", `/incidents${p.size ? "?" + p : ""}`);
  }
  return (
    <>
      <Heading
        title="行动缺口"
        subtitle="发现该跟进却尚未跟进的客户，将证据转化为下一步行动。"
      >
        <button
          className="button"
          onClick={() =>
            download(
              "行动缺口.csv",
              "客户,缺口,优先级,状态\n" +
                filtered
                  .map(
                    (i) =>
                      `${i.customer},${i.title},${i.priority},${stateLabels[i.status]}`,
                  )
                  .join("\n"),
            )
          }
        >
          <Download size={16} />
          导出列表
        </button>
      </Heading>
      <div className="summary-strip">
        <div>
          <Target size={20} />
          <span>
            已确认缺口
            <strong>{data.incidents.filter((i) => i.coverage).length}</strong>
          </span>
        </div>
        <div>
          <TriangleAlert size={20} />
          <span>
            高优先级
            <strong>
              {
                data.incidents.filter((i) => i.priority >= 80 && i.coverage)
                  .length
              }
            </strong>
          </span>
        </div>
        <div>
          <Clock3 size={20} />
          <span>
            任务已超期
            <strong>
              {data.incidents.filter((i) => i.kind === "TASK_OVERDUE").length}
            </strong>
          </span>
        </div>
        <div>
          <ShieldCheck size={20} />
          <span>
            来源待核查
            <strong>{data.incidents.filter((i) => !i.coverage).length}</strong>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <div className="tabs">
            {[
              ["all", "全部案例"],
              ["open", "待调查"],
              ["action_planned", "待审批"],
              ["observing", "待观察"],
              ["blocked", "受限"],
            ].map(([s, l]) => (
              <button
                className={s === status ? "active" : ""}
                key={s}
                onClick={() => update(query, s)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="filter-controls">
            <label className="search-field">
              <Search size={16} />
              <input
                placeholder="搜索客户或缺口…"
                value={query}
                onChange={(e) => update(e.target.value, status)}
                aria-label="搜索缺口"
              />
            </label>
            <select
              aria-label="优先级筛选"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">全部优先级</option>
              <option value="high">高优先级</option>
              <option value="medium">中优先级</option>
            </select>
          </div>
        </div>
        <IncidentTable
          items={filtered.slice((page - 1) * 10, page * 10)}
          go={go}
        />
        <div className="pagination">
          <span>共 {filtered.length} 条记录 · 优先级为规则评分</span>
          <div>
            <button
              className="button small"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(filtered.length / 10))}
            </span>
            <button
              className="button small"
              disabled={page * 10 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
function CustomerRecords({ customer }: { customer: string }) {
  const q = useQuery({
    queryKey: ["customer-business", customer],
    queryFn: async () => {
      const r = await fetch(`/api/v1/customers/${encodeURIComponent(customer)}/business`);
      if (!r.ok) throw Error("客户业务记录读取失败");
      return (await r.json()).data as { orders: { order_id: string; paid_at: string; paid_amount_minor: number; refunded_amount_minor: number }[]; event_count: number; sessions14: number; sessions_previous14: number };
    },
  });
  return <section className="panel spaced"><div className="panel-head"><h2>客户交易明细</h2><span className="inline-meta">{q.data ? `${q.data.event_count} 条行为记录` : "业务数据"}</span></div>
    {q.isPending ? <p className="quiet-note">正在读取交易记录…</p> : q.isError ? <div className="quiet-note">读取失败 <button className="text-button" onClick={() => q.refetch()}>重新读取</button></div> : <><div className="quiet-note">最近 14 天会话 {q.data.sessions14} 次 · 前 14 天 {q.data.sessions_previous14} 次</div><div className="table-scroll"><table className="data-table"><thead><tr><th>订单编号</th><th>支付时间</th><th>支付金额</th><th>退款金额</th></tr></thead><tbody>{q.data.orders.slice(0, 6).map(order => <tr key={order.order_id}><td className="mono">{order.order_id}</td><td>{order.paid_at.slice(0, 10)}</td><td>¥{(order.paid_amount_minor / 100).toLocaleString()}</td><td>¥{(order.refunded_amount_minor / 100).toLocaleString()}</td></tr>)}</tbody></table></div></>}
  </section>;
}

function IncidentDetail({ data, go, mutate, id }: PageProps & { id: string }) {
  const i = data.incidents.find((x) => x.id === id);
  const [evidence, setEvidence] = useState<number | null>(null);
  if (!i)
    return <Empty title="未找到该缺口" detail="该记录可能不在当前工作区。" />;
  const plan = data.plans.find((p) => p.incident_id === id);
  return (
    <>
      <button className="back-button" onClick={() => go("/incidents")}>
        <ArrowLeft size={15} />
        返回行动缺口
      </button>
      <Heading
        title={`${i.customer} · ${i.title}`}
        subtitle={`案件 ${i.id}  /  数据截至 ${data.as_of.slice(0, 16).replace("T", " ")}`}
      >
        <Badge state={i.status} />
        {i.run_id ? (
          <button
            className="button primary"
            onClick={() => go(`/runs/${i.run_id}`)}
          >
            <Workflow size={16} />
            查看调查运行
          </button>
        ) : (
          <button
            className="button primary"
            onClick={async () => {
              const r = await mutate("investigate", { id });
              if (r?.run_id) go(`/runs/${r.run_id}`);
            }}
            disabled={!i.coverage || data.settings.kill_switch}
          >
            <Play size={15} />
            开始调查
          </button>
        )}
      </Heading>
      {!i.coverage && (
        <div className="warning-strip">
          <TriangleAlert size={20} />
          CRM 来源覆盖不完整，当前无法确认行动缺口。补齐数据后再调查。
        </div>
      )}
      <div className="detail-grid">
        <div>
          <section className="panel">
            <div className="panel-head">
              <h2>业务信号与缺口依据</h2>
              <Badge state="ready">内置数据</Badge>
            </div>
            <div className="detail-metrics">
              <div>
                <small>90 天净支付</small>
                <strong>¥{(i.value / 100).toLocaleString()}</strong>
              </div>
              <div>
                <small>信号已持续</small>
                <strong>
                  {i.hours}
                  <em>小时</em>
                </strong>
              </div>
              <div>
                <small>规则优先级</small>
                <strong>
                  {i.priority}
                  <em>/ 100</em>
                </strong>
              </div>
            </div>
            <div className="evidence-list">
              {i.facts.map((fact, n) => (
                <button
                  className="evidence-item"
                  onClick={() => setEvidence(n)}
                  key={n}
                >
                  <span className="evidence-index">0{n + 1}</span>
                  <div>
                    <small>
                      {
                        [
                          "交易价值",
                          "活跃与交易信号",
                          "CRM 行动覆盖",
                          "售后限制",
                        ][n]
                      }
                    </small>
                    <p>{fact}</p>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>
          </section>
          <CustomerRecords customer={i.customer} />
          <section className="panel spaced">
            <div className="panel-head">
              <h2>建议的行动方案</h2>
              {plan && <span className="mono">v{plan.version}</span>}
            </div>
            {plan ? (
              <div className="plan-summary">
                <span className="soft-icon large">
                  <FileCheck2 size={24} />
                </span>
                <div>
                  <h3>{plan.title}</h3>
                  <p>{plan.reason}</p>
                  <div className="tag-row">
                    <span>负责人：{plan.owner}</span>
                    <span>预算：¥0.00</span>
                    <span>仅创建人工任务</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => go(`/approvals?plan=${plan.id}`)}
                  >
                    查看完整方案
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <Empty
                title="还没有行动方案"
                detail={
                  i.coverage
                    ? "开始调查后，基于 CRM 与工单证据生成方案。"
                    : "补齐来源覆盖后，才可判断下一步行动。"
                }
              />
            )}
          </section>
        </div>
        <div>
          <section className="panel context-panel">
            <div className="panel-head">
              <h2>客户与数据范围</h2>
              <ShieldCheck size={18} />
            </div>
            <div className="profile">
              <span className="avatar big pastel-0">
                {i.customer.slice(1, 3)}
              </span>
              <h3>{i.customer}</h3>
              <p>{i.segment}</p>
            </div>
            <dl className="detail-list">
              <div>
                <dt>营销同意</dt>
                <dd>
                  {i.consent === null
                    ? "未知"
                    : i.consent
                      ? "已同意"
                      : "未同意"}
                </dd>
              </div>
              <div>
                <dt>售后问题</dt>
                <dd>{i.support ? "有未关闭工单" : "未发现"}</dd>
              </div>
              <div>
                <dt>来源覆盖</dt>
                <dd>{i.coverage ? "完整" : "待确认"}</dd>
              </div>
              <div>
                <dt>当前负责人</dt>
                <dd>{i.owner}</dd>
              </div>
              <div>
                <dt>数据环境</dt>
                <dd>内置数据</dd>
              </div>
            </dl>
          </section>
          <div className="quiet-note">
            <Info size={17} />
            <p>
              优先级用于确定处理顺序，不代表流失概率。净支付金额不代表可挽回收益。
            </p>
          </div>
        </div>
      </div>
      {evidence !== null && (
        <Dialog
          title={`证据 0${evidence + 1} · ${i.customer}`}
          onClose={() => setEvidence(null)}
        >
          <Badge state="ready">快照证据</Badge>
          <p className="evidence-quote">{i.facts[evidence]}</p>
          <dl className="detail-list">
            <div>
              <dt>来源</dt>
              <dd>
                {
                  [
                    "orders",
                    "events / orders",
                    "contacts / crm_tasks",
                    "support_tickets",
                  ][evidence]
                }
              </dd>
            </div>
            <div>
              <dt>客户范围</dt>
              <dd>{i.customer}</dd>
            </div>
            <div>
              <dt>快照时间</dt>
              <dd>{data.as_of}</dd>
            </div>
            <div>
              <dt>数据属性</dt>
              <dd>内置业务数据</dd>
            </div>
          </dl>
          <div className="info-strip">
            <Info size={18} />
            当前证据限于已接入数据，不对未接入系统作出判断。
          </div>
        </Dialog>
      )}
    </>
  );
}
function Agents({ data, go, mutate }: PageProps) {
  return (
    <>
      <Heading
        title="Agent 运行"
        subtitle="有状态的调查工作流，每一步都有事实、权限和执行记录。"
      >
        <button className="button" onClick={() => go("/onboarding")}>
          <Plus size={16} />
          配置 Agent
        </button>
        <button
          className="button primary"
          disabled={data.settings.kill_switch}
          onClick={() => mutate("scan")}
        >
          <Play size={15} />
          运行检测
        </button>
      </Heading>
      {data.agents.map((a) => (
        <section className="panel agent-card" key={a.id}>
          <div className="agent-identity">
            <div className="agent-logo">
              <Bot size={30} />
            </div>
            <div>
              <div className="agent-title">
                <h2>{a.name}</h2>
                <Badge state={a.status} />
              </div>
              <p>{a.description}</p>
              <div className="tag-row">
                <span>AgentSpec v{a.version}</span>
                <span>电商用户挽回</span>
                <span>规则与证据调查</span>
              </div>
            </div>
          </div>
          <div className="agent-card-right">
            <button
              className="button"
              onClick={() => mutate("agent-toggle", { id: a.id })}
            >
              {a.status === "active" ? <Pause size={15} /> : <Play size={15} />}{" "}
              {a.status === "active" ? "暂停 Agent" : "激活 Agent"}
            </button>
            <small>每日调查上限 {data.settings.daily_limit} 次</small>
          </div>
          <div className="agent-flow">
            {[
              "发现信号",
              "确认缺口",
              "工具调查",
              "行动规划",
              "人工审批",
              "执行回读",
              "等待观察",
            ].map((s, n) => (
              <span key={s}>
                <span className="flow-number">{n + 1}</span>
                {s}
                {n < 6 && <ChevronRight size={15} />}
              </span>
            ))}
          </div>
        </section>
      ))}
      <section className="panel spaced">
        <div className="panel-head">
          <h2>
            运行记录{" "}
            <span className="count-pill neutral">{data.runs.length}</span>
          </h2>
          <span className="inline-meta">基于服务端持久事件</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>运行任务</th>
                <th>客户</th>
                <th>状态</th>
                <th>工具调用</th>
                <th>开始时间</th>
                <th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.runs
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      <small className="table-secondary mono">{r.id}</small>
                    </td>
                    <td>{r.customer}</td>
                    <td>
                      <Badge state={r.state} />
                    </td>
                    <td>
                      {r.tool_calls} 次{" "}
                      <small className="muted">/ 模型 {r.model_calls} 次</small>
                    </td>
                    <td>{shortDate(r.started_at)}</td>
                    <td className="right">
                      <button
                        className="text-button"
                        onClick={() => go(`/runs/${r.id}`)}
                      >
                        查看运行
                        <ArrowRight size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="quiet-note">
        <Info size={17} />
        <p>
          调查依据订单、行为、触达及工单记录生成证据。模型用量按实际调用记录展示。
        </p>
      </div>
    </>
  );
}
function RunPage({ data, go, notify, id }: PageProps & { id: string }) {
  const run = data.runs.find((r) => r.id === id);
  const [selected, setSelected] = useState(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("node") || "approve"
      : "approve",
  );
  if (!run) return <Empty title="未找到该运行" />;
  const event = run.events
    .slice()
    .reverse()
    .find((e) => e.node === selected);
  function select(n: string) {
    setSelected(n);
    window.history.replaceState(null, "", `/runs/${id}?node=${n}`);
  }
  return (
    <>
      <button className="back-button" onClick={() => go("/agents")}>
        <ArrowLeft size={15} />
        返回 Agent 运行
      </button>
      <Heading
        title={run.title}
        subtitle={`${run.customer}  /  ${run.id}  /  内置数据`}
      >
        <Badge state={run.state} />
        <button
          className="button"
          onClick={() => go(`/incidents/${run.incident_id}`)}
        >
          查看案件
          <ArrowUpRight size={16} />
        </button>
      </Heading>
      <div
        className={
          run.state === "waiting_approval" ? "warning-strip" : "info-strip"
        }
      >
        <Clock3 size={20} />
        <div>
          <strong>
            {run.state === "waiting_approval"
              ? "调查已完成，等待你审阅行动方案"
              : run.state === "waiting_observation"
                ? "CRM 已回读验证，等待后续观察数据"
                : "运行状态已保存"}
          </strong>
          <p>
            {run.state === "waiting_approval"
              ? "当前暂停在人工审批节点，审批前不会执行 CRM 写入。"
              : run.state === "waiting_observation"
                ? "需要覆盖完整 7 天观察窗口的新数据，当前尚不能判断业务效果。"
                : "请查看节点详情与事件记录，了解已完成的步骤和当前限制。"}
          </p>
        </div>
        {run.state === "waiting_approval" && (
          <button
            className="button"
            onClick={() => go(`/approvals?plan=plan-${run.customer}`)}
          >
            审阅方案
            <ArrowRight size={15} />
          </button>
        )}
      </div>
      <div className="run-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>
              <Workflow size={18} /> 调查工作流
            </h2>
            <span className="inline-meta">只读 · 点击节点查看证据</span>
          </div>
          <RunGraph run={run} selected={selected} onSelect={select} />
          <div className="node-nav">
            {[
              "detect",
              "investigate",
              "plan",
              "approve",
              "execute",
              "observe",
            ].map((n, k) => (
              <button
                key={n}
                className={selected === n ? "active" : ""}
                onClick={() => select(n)}
              >
                {["发现", "调查", "规划", "审批", "执行", "观察"][k]}
              </button>
            ))}
          </div>
          <div className="run-stats">
            <span>
              <Link2 size={15} />
              {run.tool_calls} 次工具调用
            </span>
            <span>
              <Bot size={15} />
              {run.model_calls} 次模型调用
            </span>
            <span>
              <ShieldCheck size={15} />
              状态已持久化
            </span>
          </div>
        </section>
        <section className="panel inspector">
          <div className="panel-head">
            <h2>节点详情</h2>
            <span className="mono">{selected}</span>
          </div>
          {event ? (
            <div className="inspector-body">
              <Badge state={event.status} />
              <h3>{event.title}</h3>
              <p>{event.detail}</p>
              <h4>输入范围</h4>
              <pre>
                {JSON.stringify(
                  {
                    customer_id: run.customer,
                    mode: data.mode,
                    snapshot: data.as_of,
                  },
                  null,
                  2,
                )}
              </pre>
              <h4>工具 / 记录</h4>
              <code>{event.tool || "workflow.event"}</code>
              <div className="inspector-time">
                <Clock3 size={14} />
                {shortTime(event.at)}
              </div>
            </div>
          ) : (
            <Empty
              title="尚未进入此节点"
              detail="完成前置审批或补齐观察数据后继续。"
            />
          )}
        </section>
      </div>
      <section className="panel spaced">
        <div className="panel-head">
          <h2>
            事件时间线{" "}
            <span className="count-pill neutral">{run.events.length}</span>
          </h2>
          <button
            className="text-button"
            onClick={() => {
              download(
                `${run.id}.json`,
                JSON.stringify(run.events, null, 2),
                "application/json",
              );
              notify("运行事件已导出");
            }}
          >
            <Download size={15} />
            导出事件
          </button>
        </div>
        <div className="event-timeline">
          {run.events.map((e, index) => (
            <button
              key={e.id}
              className="event-line"
              onClick={() => select(e.node)}
            >
              <span
                className={`timeline-dot ${e.status === "completed" ? "green" : "amber"}`}
              >
                {e.status === "completed" ? (
                  <Check size={14} />
                ) : (
                  <Clock3 size={14} />
                )}
              </span>
              <span className="event-time mono">{shortTime(e.at)}</span>
              <div>
                <strong>{e.title}</strong>
                <p>{e.detail}</p>
              </div>
              <span className="event-seq mono">#{index + 1}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
function Approvals({ data, go, mutate }: PageProps) {
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<Plan | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("plan");
    if (id) setSelected(data.plans.find((p) => p.id === id) || null);
  }, [data.plans]);
  const current = selected
    ? data.plans.find((p) => p.id === selected.id)
    : null;
  const plans = data.plans.filter(
    (p) => filter === "all" || p.status === filter,
  );
  return (
    <>
      <Heading
        title="审批中心"
        subtitle="审阅精确的作用对象、事实依据与执行边界，让每一次行动经过确认。"
      >
        <span className="reviewer-tag">
          <ShieldCheck size={16} />
          方案审批
        </span>
      </Heading>
      <div className="approval-summary">
        <div className="approval-summary-icon">
          <FileCheck2 size={30} />
        </div>
        <div>
          <h2>
            {data.plans.filter((p) => p.status === "pending").length}{" "}
            个方案等待你的决定
          </h2>
          <p>审批绑定当前方案版本；批准后还需执行与回读验证。</p>
        </div>
        <div className="approval-summary-stat">
          <strong>¥0.00</strong>
          <small>待审方案总预算 · 仅人工任务</small>
        </div>
      </div>
      <div className="tabs page-tabs">
        {[
          ["pending", "待审批"],
          ["approved", "已批准"],
          ["rejected", "已拒绝"],
          ["all", "全部方案"],
        ].map(([s, l]) => (
          <button
            key={s}
            className={filter === s ? "active" : ""}
            onClick={() => setFilter(s)}
          >
            {l}
            <span>
              {data.plans.filter((p) => s === "all" || p.status === s).length}
            </span>
          </button>
        ))}
      </div>
      <div className="approval-cards">
        {plans.map((p) => (
          <section key={p.id} className="panel approval-card">
            <div className="approval-card-top">
              <span
                className={`soft-icon large ${p.purpose === "support_followup" ? "purple" : ""}`}
              >
                {p.purpose === "support_followup" ? (
                  <MessageSquareText size={23} />
                ) : (
                  <Target size={23} />
                )}
              </span>
              <Badge state={p.status} />
            </div>
            <h2>{p.title}</h2>
            <p>{p.reason}</p>
            <dl className="detail-list">
              <div>
                <dt>作用对象</dt>
                <dd>{p.customer} · 1 位客户</dd>
              </div>
              <div>
                <dt>负责人</dt>
                <dd>{p.owner}</dd>
              </div>
              <div>
                <dt>执行预算</dt>
                <dd>¥{(p.budget / 100).toFixed(2)}</dd>
              </div>
              <div>
                <dt>方案版本</dt>
                <dd>v{p.version} · 不可变</dd>
              </div>
            </dl>
            <div className="approval-check">
              <ShieldCheck size={15} />
              权限检查通过 · 无营销发送
            </div>
            <button
              className="button full"
              onClick={() => {
                setSelected(p);
                setDecision(null);
                setChecked(false);
                setComment("");
              }}
            >
              审阅方案
              <ArrowRight size={16} />
            </button>
          </section>
        ))}
      </div>
      {plans.length === 0 && (
        <section className="panel">
          <Empty
            title="这里没有待处理的方案"
            detail="新调查生成方案后，会在审批中心汇总。"
          />
        </section>
      )}
      {current && (
        <Dialog
          title={current.title}
          onClose={() => {
            setSelected(null);
            setDecision(null);
            window.history.replaceState(null, "", "/approvals");
          }}
          wide
        >
          <div className="approval-dialog-top">
            <Badge state={current.status} />
            <span className="mono">
              v{current.version} · {current.hash.slice(0, 26)}…
            </span>
          </div>
          <h3>将创建什么</h3>
          <div className="change-preview">
            <span className="plus-sign">+</span>
            <div>
              <strong>在 客户管理 中创建 1 条人工跟进任务</strong>
              <p>
                客户 {current.customer} · {current.owner} ·{" "}
                {current.purpose === "support_followup"
                  ? "售后协调"
                  : "普通挽回跟进"}
              </p>
            </div>
          </div>
          <h3>为什么这样做</h3>
          <p className="body-copy">{current.reason}</p>
          <button
            className="text-button"
            onClick={() => go(`/incidents/${current.incident_id}`)}
          >
            查看案件与证据
            <ArrowUpRight size={14} />
          </button>
          <div className="approval-checks">
            {current.checks.map((c) => (
              <div key={c}>
                <CheckCircle2 size={16} />
                {c}
              </div>
            ))}
          </div>
          <div className="info-strip">
            <Info size={18} />
            <div>
              仅创建可取消的内部任务，不发邮件、不发优惠券。任务创建后，仍需等待
              7 天的新数据观察业务结果。
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>方案有效期</dt>
              <dd>{current.expires_at.slice(0, 16).replace("T", " ")}</dd>
            </div>
            <div>
              <dt>预算 / 作用对象</dt>
              <dd>¥0.00 / {current.customer}</dd>
            </div>
          </dl>
          {current.status === "pending" && (
            <>
              <label className="field">
                审批意见
                <textarea
                  placeholder="补充审批意见；拒绝时必须说明原因"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                我已核对客户、任务参数、证据和方案版本
              </label>
              <div className="dialog-actions">
                <button
                  className="button danger"
                  disabled={!comment.trim()}
                  onClick={() => setDecision("reject")}
                >
                  <XCircle size={16} />
                  拒绝方案
                </button>
                <button
                  className="button primary"
                  disabled={!checked}
                  onClick={() => setDecision("approve")}
                >
                  <Check size={17} />
                  批准方案
                </button>
              </div>
              {decision && (
                <div className="confirm-inline">
                  <p>
                    {decision === "approve"
                      ? "确认批准当前版本？批准后，可在动作台账执行。"
                      : "确认拒绝该方案？拒绝原因将保留在审计记录。"}
                  </p>
                  <button className="button" onClick={() => setDecision(null)}>
                    返回审阅
                  </button>
                  <button
                    className="button primary"
                    onClick={async () => {
                      const r = await mutate("approval", {
                        id: current.id,
                        decision,
                        comment,
                        hash: current.hash,
                      });
                      if (r) {
                        setSelected(null);
                        setDecision(null);
                      }
                    }}
                  >
                    确认{decision === "approve" ? "批准" : "拒绝"}
                  </button>
                </div>
              )}
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
function Actions({ data, go, mutate }: PageProps) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const [crm, setCrm] = useState(false);
  const [cancel, setCancel] = useState<string | null>(null);
  const approved = data.plans.filter(
    (p) =>
      p.status === "approved" && !data.actions.some((a) => a.plan_id === p.id),
  );
  const current = data.actions.find((a) => a.id === receipt);
  return (
    <>
      <Heading
        title="动作台账"
        subtitle="从授权到执行，再到外部回读。每一次写入都有可追溯的凭据。"
      >
        <button className="button" onClick={() => setCrm(true)}>
          <ExternalLink size={16} />
          查看 客户管理
        </button>
      </Heading>
      {approved.length > 0 && (
        <div className="approved-queue">
          <div>
            <ShieldCheck size={20} />
            <strong>{approved.length} 个方案已批准，等待执行</strong>
          </div>
          {approved.map((p) => (
            <div className="queue-item" key={p.id}>
              <span>{p.title}</span>
              <button
                className="button primary small"
                disabled={data.settings.kill_switch}
                onClick={() => mutate("execute", { id: p.id })}
              >
                <Play size={14} />
                执行到 客户管理
              </button>
            </div>
          ))}
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>
            执行记录{" "}
            <span className="count-pill neutral">{data.actions.length}</span>
          </h2>
          <button
            className="text-button"
            onClick={() =>
              download(
                "动作台账.json",
                JSON.stringify(data.actions, null, 2),
                "application/json",
              )
            }
          >
            <Download size={15} />
            导出台账
          </button>
        </div>
        {data.actions.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>动作 / 客户</th>
                  <th>执行状态</th>
                  <th>外部对象</th>
                  <th>回读时间</th>
                  <th className="right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.actions.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      <small className="table-secondary">
                        {a.customer} · {a.owner}
                      </small>
                    </td>
                    <td>
                      <Badge state={a.status} />
                    </td>
                    <td>
                      <code>{a.external_id}</code>
                    </td>
                    <td>
                      {a.verified_at ? shortDate(a.verified_at) : "尚未验证"}
                    </td>
                    <td className="right">
                      <button
                        className="text-button"
                        onClick={() => setReceipt(a.id)}
                      >
                        查看凭据
                        <ArrowUpRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="下一次行动，从审阅方案开始"
            detail="已批准方案执行后，将在此展示 CRM 对象、回读结果和后续观察。"
          >
            <button className="button primary" onClick={() => go("/approvals")}>
              前往审批中心
              <ArrowRight size={15} />
            </button>
          </Empty>
        )}
      </section>
      <div className="two-columns spaced">
        <section className="panel guidance-card">
          <span className="soft-icon">
            <CheckCheck size={23} />
          </span>
          <h3>技术执行验证</h3>
          <p>
            检查任务是否存在，客户、负责人和行动参数是否匹配。通过回读后才计为执行成功。
          </p>
        </section>
        <section className="panel guidance-card">
          <span className="soft-icon purple">
            <Clock3 size={23} />
          </span>
          <h3>业务效果观察</h3>
          <p>
            任务创建不等于触达完成。当前等待覆盖 7
            天窗口的新数据，不提前判断挽回效果。
          </p>
        </section>
      </div>
      {current && (
        <Dialog title="动作执行凭据" onClose={() => setReceipt(null)}>
          <Badge state={current.status} />
          <h3>{current.title}</h3>
          <dl className="detail-list">
            <div>
              <dt>外部任务</dt>
              <dd>{current.external_id}</dd>
            </div>
            <div>
              <dt>客户</dt>
              <dd>{current.customer}</dd>
            </div>
            <div>
              <dt>负责人</dt>
              <dd>{current.owner}</dd>
            </div>
            <div>
              <dt>幂等键</dt>
              <dd className="mono break">{current.idempotency_key}</dd>
            </div>
            <div>
              <dt>回读时间</dt>
              <dd>{current.verified_at || "尚未验证"}</dd>
            </div>
            <div>
              <dt>观察到期</dt>
              <dd>{current.due_at}</dd>
            </div>
          </dl>
          <div className="dialog-actions">
            {current.status === "unknown" && (
              <button
                className="button primary"
                onClick={() => mutate("reconcile", { id: current.id })}
              >
                核对外部状态
              </button>
            )}
            {current.status === "succeeded" && (
              <button
                className="button danger"
                onClick={() => setCancel(current.id)}
              >
                取消 CRM 任务
              </button>
            )}
          </div>
          {cancel === current.id && (
            <div className="confirm-inline">
              <p>
                将把尚未完成的 客户管理
                任务标为取消，并记录补偿；不能撤销已完成触达。
              </p>
              <button className="button" onClick={() => setCancel(null)}>
                保留任务
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  const r = await mutate("compensate", { id: current.id });
                  if (r) setCancel(null);
                }}
              >
                确认取消任务
              </button>
            </div>
          )}
        </Dialog>
      )}
      {crm && (
        <Dialog title="客户管理 · 外部任务" onClose={() => setCrm(false)} wide>
          <div className="info-strip">
            <Database size={18} />
            这是独立 CRM 服务的任务查看入口，状态由服务端读取。
          </div>
          <CrmRecords />
        </Dialog>
      )}
    </>
  );
}
function CrmRecords() {
  const q = useQuery({
    queryKey: ["crm"],
    queryFn: async () => {
      const r = await fetch("/api/v1/crm-tasks");
      if (!r.ok) throw Error("无法连接 客户管理");
      return (await r.json()).data as {
        id: string;
        customer: string;
        title: string;
        status: string;
        owner: string;
      }[];
    },
  });
  return q.isPending ? (
    <div className="loading-state">
      <Loader2 className="spin" />
      正在回读 CRM…
    </div>
  ) : q.isError ? (
    <Empty title="CRM 暂不可用" detail="请确认后端与 CRM 服务已启动。" />
  ) : q.data.length ? (
    <table className="data-table">
      <thead>
        <tr>
          <th>任务</th>
          <th>客户</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {q.data.map((t) => (
          <tr key={t.id}>
            <td>
              {t.title}
              <small className="table-secondary mono">{t.id}</small>
            </td>
            <td>{t.customer}</td>
            <td>
              {t.status === "open"
                ? "待跟进"
                : t.status === "cancelled"
                  ? "已取消"
                  : t.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <Empty
      title="CRM 暂无新增任务"
      detail="批准并执行方案后，外部任务会保存在这里。"
    />
  );
}
function App() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [mobile, setMobile] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [search, setSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [stop, setStop] = useState(false);
  const go = useCallback(
    (p: string) => {
      router.push(p);
      setMobile(false);
      setSearch(false);
    },
    [router],
  );
  const notify = useCallback((m: string) => setToast(m), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const q = useQuery({
    queryKey: ["console"],
    queryFn: async () => {
      const session = await fetch("/api/v1/workspace/session", { method: "POST" });
      if (!session.ok) throw Error("工作区连接失败，请重新连接");
      const r = await fetch("/api/v1/console");
      if (!r.ok) throw Error("工作区服务尚未连接");
      const body: components["schemas"]["ConsoleEnvelope"] = await r.json();
      return body.data as ConsoleData;
    },
    retry: false,
    refetchOnWindowFocus: true,
  });
  const data = q.data || seed;
  const connected = !!q.data;
  useEffect(() => {
    if (!connected) return;
    const stream = new EventSource("/api/v1/events");
    stream.addEventListener("change", () =>
      queryClient.invalidateQueries({ queryKey: ["console"] }),
    );
    return () => stream.close();
  }, [connected, queryClient]);
  async function mutate(action: string, payload: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(action);
    try {
      const response = await fetch(`/api/v1/commands/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok)
        throw Error(body.error?.message || body.detail || "操作未完成");
      await queryClient.invalidateQueries({ queryKey: ["console"] });
      await queryClient.invalidateQueries({ queryKey: ["crm"] });
      notify(body.message || "操作已保存");
      return body.data || { ok: true };
    } catch (e) {
      notify(
        (e as Error).message === "Unexpected token"
          ? "服务暂不可用"
          : (e as Error).message,
      );
      return null;
    } finally {
      setBusy("");
    }
  }
  const props = { data, go, mutate, notify };
  const root = pathname === "/login" ? "overview" : pathname.split("/")[1] || "overview";
  const title =
    navGroups.flatMap((g) => g.items).find((n) => n.url === `/${root}`)
      ?.label ||
    (
      {
        settings: "工作区设置",
        onboarding: "数据接入向导",
        runs: "运行详情",
      } as Record<string, string>
    )[root] ||
    "运营总览";
  const pending = data.plans.filter((p) => p.status === "pending").length;
  return (
    <div className="app-shell">
      {mobile && (
        <div className="mobile-backdrop" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "visible" : ""}`}>
        <Logo />
        <button className="workspace-select" onClick={() => go("/settings")}>
          <Layers3 size={16} />
          <span>{data.settings.workspace_name}</span>
          <ChevronDown size={15} />
        </button>
        <nav aria-label="主导航">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((n) => (
                <button
                  key={n.url}
                  className={`nav-item ${n.url === `/${root}` || (n.url === "/agents" && root === "runs") ? "active" : ""}`}
                  onClick={() => go(n.url)}
                >
                  <n.icon size={18} />
                  <span>{n.label}</span>
                  {n.url === "/incidents" && (
                    <span className="nav-count">
                      {
                        data.incidents.filter(
                          (i) =>
                            i.coverage &&
                            !["observing", "covered", "dismissed"].includes(
                              i.status,
                            ),
                        ).length
                      }
                    </span>
                  )}
                  {n.url === "/approvals" && pending > 0 && (
                    <span className="nav-count alert">{pending}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <div>
              <ShieldCheck size={15} />
              <strong>证据驱动，受控执行</strong>
            </div>
            <p>所有行动都经过权限检查</p>
          </div>
          <button
            className={`nav-item ${root === "settings" ? "active" : ""}`}
            onClick={() => go("/settings")}
          >
            <Settings2 size={18} />
            <span>工作区设置</span>
          </button>
          <button
            className="user-profile"
            onClick={() => go("/settings")}
          >
            <span className="avatar user-avatar">林</span>
            <span>
              <strong>工作区管理员</strong>
              <small>运营工作区</small>
            </span>
            <ChevronRight size={15} />
          </button>
          <div className="system-status">
            <span className={`live-dot ${!connected ? "offline" : ""}`} />
            {connected ? "服务运行正常" : "服务连接中断"}
            <ChevronRight size={13} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="打开导航"
            >
              <Menu size={21} />
            </button>
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="top-search"
              onClick={() => setSearch(true)}
              aria-label="全局搜索"
            >
              <Search size={16} />
              <span>搜索</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="mode-badge">
              <span />
              工作区已就绪
            </span>
            <span className="top-divider" />
            <button
              className="icon-button notification-button"
              aria-label="通知"
              onClick={() => setNotifications(!notifications)}
            >
              <Bell size={18} />
              {pending > 0 && <i />}
            </button>
            <button
              className="top-avatar"
              onClick={() => go("/settings")}
              aria-label="工作区设置"
            >
              林
            </button>
          </div>
          {notifications && (
            <div className="notification-popover">
              <div className="panel-head">
                <h3>工作区通知</h3>
                <button
                  className="icon-button"
                  onClick={() => setNotifications(false)}
                  aria-label="关闭通知"
                >
                  <X size={16} />
                </button>
              </div>
              {data.plans
                .filter((p) => p.status === "pending")
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      go(`/approvals?plan=${p.id}`);
                      setNotifications(false);
                    }}
                  >
                    <Clock3 size={17} />
                    <span>
                      {p.title}
                      <small>等待人工审批</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              {!pending && <p className="muted">暂时没有待审批事项。</p>}
            </div>
          )}
        </header>
        <main className="main-content">
          {!connected && !q.isPending && (
            <div className="preview-banner">
              <Info size={16} />
              <span>
                工作区暂时无法连接，请检查启动程序并重试。
              </span>
              <button onClick={() => q.refetch()}>
                重新连接
                <RefreshCw size={13} />
              </button>
            </div>
          )}
          {data.settings.kill_switch && (
            <div className="warning-strip">
              <Pause size={18} />
              <span>自动执行已停止。待执行操作将被服务端拦截。</span>
              <button className="text-button" onClick={() => go("/settings")}>
                查看设置
              </button>
            </div>
          )}
          {!connected ? (
            <section className="panel loading-page" aria-busy="true">
              <h1>{title}</h1>
              <div className="loading-state">
                <Loader2 className="spin" size={22} />
                {q.isPending ? "正在读取工作区…" : "工作区连接中断，请重新连接"}
              </div>
            </section>
          ) : root === "overview" || pathname === "/" ? (
            <Overview {...props} />
          ) : root === "incidents" ? (
            pathname.split("/")[2] ? (
              <IncidentDetail {...props} id={pathname.split("/")[2]} />
            ) : (
              <Incidents {...props} />
            )
          ) : root === "agents" ? (
            <Agents {...props} />
          ) : root === "runs" ? (
            <RunPage {...props} id={pathname.split("/")[2]} />
          ) : root === "approvals" ? (
            <Approvals {...props} />
          ) : root === "actions" ? (
            <Actions {...props} />
          ) : root === "data" ? (
            <DataPage {...props} />
          ) : root === "onboarding" ? (
            <OnboardingPage {...props} />
          ) : root === "experiments" ? (
            <ExperimentsPage {...props} />
          ) : root === "memories" ? (
            <MemoriesPage {...props} />
          ) : root === "skills" ? (
            <SkillsPage {...props} />
          ) : root === "settings" ? (
            <SettingsPage {...props} />
          ) : (
            <Empty title="页面不存在">
              <button className="button" onClick={() => go("/overview")}>
                返回总览
              </button>
            </Empty>
          )}
          <footer className="footer">
            <span>
              <span className="tiny-brand" />
              OpsWeaver <span className="version">v0.1</span>
            </span>
            <span>从业务证据到行动闭环</span>
            <button onClick={() => setStop(true)}>
              <Pause size={12} />
              紧急停止
            </button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="mutation-indicator" role="status">
          <Loader2 size={16} className="spin" />
          正在处理并保存…
        </div>
      )}
      {search && (
        <Dialog title="搜索工作区" onClose={() => setSearch(false)}>
          <label className="search-field big-search">
            <Search size={20} />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索客户、案件或页面"
              aria-label="全局搜索内容"
            />
          </label>
          <div className="search-results">
            {navGroups
              .flatMap((g) => g.items)
              .filter((n) => n.label.includes(searchQuery))
              .map((n) => (
                <button key={n.url} onClick={() => go(n.url)}>
                  <n.icon size={18} />
                  {n.label}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            {data.incidents
              .filter((i) =>
                `${i.customer} ${i.title}`
                  .toLowerCase()
                  .includes(searchQuery.toLowerCase()),
              )
              .slice(0, 6)
              .map((i) => (
                <button key={i.id} onClick={() => go(`/incidents/${i.id}`)}>
                  <ClipboardList size={18} />
                  {i.customer} · {i.title}
                  <ArrowUpRight size={15} />
                </button>
              ))}
          </div>
        </Dialog>
      )}
      {stop && (
        <Dialog title="停止自动执行" onClose={() => setStop(false)}>
          <div className="warning-strip">
            <TriangleAlert size={22} />
            将阻止新的检测与尚未执行的 CRM 操作。
          </div>
          <p className="body-copy">
            已有任务和审计记录会保留。已完成操作不会因此撤销。
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setStop(false)}>
              返回
            </button>
            <button
              className="button danger"
              onClick={async () => {
                await mutate("settings", { kill_switch: true });
                setStop(false);
              }}
            >
              确认停止
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
export default function Console() {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 10000 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}
