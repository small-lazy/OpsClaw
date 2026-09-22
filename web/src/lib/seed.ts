import type { ConsoleData, Incident } from "./types";
const people = [
  "C001",
  "C018",
  "C027",
  "C042",
  "C056",
  "C063",
  "C079",
  "C086",
  "C103",
  "C126",
  "C148",
  "C192",
  "C214",
  "C258",
];
const titles = [
  "支付问题待跟进",
  "高价值用户未跟进",
  "跟进任务已超期",
  "活跃下降，无相关任务",
  "触达数据覆盖不完整",
  "高价值用户未跟进",
  "售后投诉待协调",
  "活跃下降，无相关任务",
  "高价值用户未跟进",
  "跟进任务已超期",
  "高价值用户未跟进",
  "活跃下降，无相关任务",
  "来源覆盖待确认",
  "高价值用户未跟进",
];
const incidents: Incident[] = people.map((customer, i) => ({
  id: `inc-${customer}`,
  customer,
  segment: ["高价值用户", "新客 · 潜力用户", "沉睡用户", "活跃用户"][i % 4],
  title: titles[i],
  kind:
    i === 2 || i === 9
      ? "TASK_OVERDUE"
      : i === 4 || i === 12
        ? "COVERAGE_UNKNOWN"
        : "ACTION_MISSING",
  priority: Math.round(94 - i * 3.5),
  status: [0, 5, 6].includes(i)
    ? "action_planned"
    : i === 4 || i === 12
      ? "blocked"
      : "open",
  hours: 32 + i * 7,
  value: 128600 + i * 43600,
  consent: i === 4 ? null : true,
  support: i === 0 || i === 6,
  coverage: i !== 4 && i !== 12,
  owner: i === 2 || i === 9 ? "客户成功组" : "待分配",
  facts: [
    `近 90 天净支付 ¥${((128600 + i * 43600) / 100).toLocaleString("zh-CN")}`,
    `最近 ${15 + (i % 5)} 天没有支付，活跃会话由 ${12 + i} 次降至 ${3 + (i % 3)} 次`,
    i === 4 || i === 12
      ? "触达来源覆盖不完整，无法确认是否无人跟进。"
      : i === 2 || i === 9
        ? "已存在相关跟进任务，当前超期；不能再新建重复任务。"
        : "已接入且覆盖确认的 CRM 范围内，72 小时未发现相关成功触达。",
    i === 0 || i === 6
      ? "发现未关闭售后工单，禁止促销，建议协调售后。"
      : "未发现未关闭售后工单。",
  ],
  run_id: [0, 5, 6].includes(i) ? `run-${customer}` : null,
}));
const runs = incidents
  .filter((i) => i.run_id)
  .map((i, index) => ({
    id: i.run_id!,
    incident_id: i.id,
    customer: i.customer,
    title: i.support ? "客户支付与售后调查" : "高价值用户跟进调查",
    state: "waiting_approval",
    started_at: `2026-09-10T0${7 - index}:22:00+08:00`,
    model_calls: 0,
    tool_calls: 3,
    events: [
      {
        id: "1",
        node: "detect",
        title: "确认行动缺口",
        detail: i.facts[1],
        at: "07:22:01",
        status: "completed",
        tool: "metrics.evaluate",
      },
      {
        id: "2",
        node: "investigate",
        title: "核查 CRM 与工单",
        detail: i.facts[2] + " " + i.facts[3],
        at: "07:22:02",
        status: "completed",
        tool: "crm.lookup",
      },
      {
        id: "3",
        node: "plan",
        title: "生成可审查方案",
        detail: i.support
          ? "优先建立售后协调任务，不发送促销。"
          : "建立普通人工跟进任务，暂不发放优惠券。",
        at: "07:22:03",
        status: "completed",
        tool: "policy.check",
      },
      {
        id: "4",
        node: "approve",
        title: "等待人工审批",
        detail: "方案已固定版本和作用对象。审批后将写入 客户管理。",
        at: "07:22:04",
        status: "waiting_approval",
      },
    ],
  }));
export const seed: ConsoleData = {
  mode: "SIMULATED",
  as_of: "2026-09-10T08:00:00+08:00",
  revision: 1,
  incidents,
  runs,
  plans: runs.map((r) => ({
    id: `plan-${r.customer}`,
    incident_id: r.incident_id,
    run_id: r.id,
    customer: r.customer,
    title:
      r.customer === "C001" || r.customer === "C079"
        ? `${r.customer} · 售后协调任务`
        : `${r.customer} · 高价值用户跟进计划`,
    purpose:
      r.customer === "C001" || r.customer === "C079"
        ? "support_followup"
        : "retention_followup",
    owner:
      r.customer === "C001" || r.customer === "C079"
        ? "售后支持组"
        : "客户成功组",
    status: "pending",
    version: 1,
    hash: `sha256:demo-${r.customer}-v1`,
    budget: 0,
    expires_at: "2026-09-11T08:00:00+08:00",
    reason: incidents.find((i) => i.id === r.incident_id)!.facts[3],
    checks: [
      "来源覆盖与时效已确认",
      "客户与行动范围已固定",
      "未发现相关进行中任务",
      "仅允许创建人工任务，不发送营销",
    ],
  })),
  actions: [],
  sources: [
    "customers",
    "orders",
    "events",
    "contacts",
    "crm_tasks",
    "support_tickets",
  ].map((role, i) => ({
    id: `src-${role}`,
    role,
    name: [
      "客户主数据",
      "交易订单",
      "行为事件",
      "触达记录",
      "CRM 跟进任务",
      "售后工单",
    ][i],
    rows: [500, 1800, 5000, 386, 128, 42][i],
    status: "ready",
    coverage: true,
    as_of: "2026-09-10T08:00:00+08:00",
    columns: [
      "customer_id",
      i === 1 ? "paid_amount_minor" : "status",
      "updated_at",
    ],
  })),
  trend: [
    { date: "09/04", detected: 21, covered: 8 },
    { date: "09/05", detected: 23, covered: 8 },
    { date: "09/06", detected: 30, covered: 13 },
    { date: "09/07", detected: 31, covered: 18 },
    { date: "09/08", detected: 25, covered: 19 },
    { date: "09/09", detected: 26, covered: 16 },
    { date: "09/10", detected: 33, covered: 24 },
  ],
  coverage: { numerator: 19, denominator: 22, previous: 0.782 },
  agents: [
    {
      id: "retention",
      name: "高价值用户跟进 Agent",
      description: "识别行动缺口，调查售后与触达证据，生成受控跟进方案。",
      status: "active",
      version: "1.0.0",
      tools: [
        "metrics.evaluate",
        "crm.lookup",
        "support.lookup",
        "create_crm_task",
      ],
      runs: 3,
    },
  ],
  experiments: [
    {
      id: "exp-001",
      name: "低活跃高价值用户 · 人工跟进观察",
      status: "observing",
      treatment_n: 64,
      control_n: 64,
      treatment_success: 9,
      control_success: 7,
      target_n: 420,
      mature: false,
      days_elapsed: 3,
      window_days: 7,
    },
  ],
  memories: [
    {
      id: "mem-1",
      title: "支付障碍优先转交售后",
      status: "active",
      grade: "operational_fact",
      summary:
        "存在未关闭支付工单时，建立售后协调任务，待问题处理后重新评估挽回资格。任务回读已验证，业务收益尚未验证。",
      tags: ["支付问题", "售后优先", "内置数据"],
      sample_size: 8,
      updated_at: "2026-09-09",
    },
    {
      id: "mem-2",
      title: "已有相关任务时避免重复跟进",
      status: "draft",
      grade: "operational_fact",
      summary:
        "客户已有进行中任务时，保留原负责人；若任务超期，提出升级处理方案。",
      tags: ["去重", "任务超期"],
      sample_size: 12,
      updated_at: "2026-09-10",
    },
    {
      id: "mem-3",
      title: "活跃下降不等于需要促销",
      status: "draft",
      grade: "observational",
      summary:
        "当前业务样本显示多种活跃下降原因，需要先查工单和近期触达。观察关联不构成因果证据。",
      tags: ["证据不足", "历史观察"],
      sample_size: 32,
      updated_at: "2026-09-10",
    },
  ],
  settings: {
    kill_switch: false,
    daily_limit: 30,
    workspace_name: "电商运营工作区",
  },
  skills: [
    {
      id: "skill-retention",
      name: "高价值用户调查助手",
      description:
        "在完整证据范围内调查客户跟进缺口，向外部 Agent 返回可审查的事实与提案。",
      version: "1.0.0",
      status: "active",
      instructions:
        "# 任务目标\n核查指定客户的行动缺口。\n\n## 工作步骤\n1. 使用 get_incident 读取客户案例。\n2. 区分已确认事实与来源限制。\n3. 有未关闭售后工单时优先建议售后任务。\n4. 不自动执行或批准，返回证据与待审建议。",
      input_schema: JSON.stringify(
        {
          type: "object",
          properties: { customer_id: { type: "string" } },
          required: ["customer_id"],
          additionalProperties: false,
        },
        null,
        2,
      ),
      tools: [
        "console_summary",
        "list_incidents",
        "get_incident",
        "investigate",
        "request_plan",
      ],
      updated_at: "2026-09-10",
    },
  ],
  audit: [
    {
      id: "audit-seed",
      operation: "初始化业务数据",
      detail: "已载入业务数据与初始运营案例。",
      at: "2026-09-10T08:00:00+08:00",
    },
  ],
};
