"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
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
  X,
} from "lucide-react";
import { DatasetDetail, DatasetLibrary, ImportWorkspace } from "./import-workspace";
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
  roles.find((item) => item.value === role)?.label ?? (role === "general" ? "通用数据" : role);
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
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
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
          value={`${new Set(props.data.sources.filter(item => roles.some(role => role.value === item.role)).map((item) => item.role)).size} / 6`}
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
              <option value="general">通用数据</option>
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
      <DatasetLibrary notify={props.notify} />
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
          {source.dataset_id && <button className="button" onClick={() => { setSelectedDataset(source.dataset_id!); setSelected(null); }}>查看文件分析<ArrowRight size={16} /></button>}
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
      {selectedDataset && <DatasetDetail id={selectedDataset} close={() => setSelectedDataset(null)} notify={props.notify} />}
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
  return <ImportWorkspace notify={props.notify} go={props.go} />;
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
