# 增长工作台

OpsClaw 将订单同比、站内信号、外部事件、监控规则、内容资产和广告动作放在同一条可复核流程中。打开工作台左侧的「增长工作台」，按订单、事件、内容、审批、接入设置依次操作。

## 数据与分析

在数据中心导入电商后台导出的 CSV 或 XLSX，然后在「订单与诊断」选择数据集。自动识别订单号、支付时间、实付金额、退款金额、订单状态、品牌或市场、品类或客群、商品等常见中文列名，也可手动调整字段映射。金额单位需明确选择元或分，`*_minor` 字段使用分。

为兼容已有数据和接口，英文 API 字段名保持不变。普通商业场景按下表赋值，在订单、行为、事件和内容资产中使用一致的分组名称：

| API 字段 | 商业含义 | 示例 |
|---|---|---|
| `school` | 一级分组：品牌或市场 | 品牌 A |
| `college` | 二级分组：品类或客群 | 收纳用品 |
| `product` | 商品名称 | 夏季收纳套装 |
| `admissions_count` | 用于机会测算的潜在人群规模 | 根据实际调研填写 |

品牌与市场、品类与客群分别复用一个分组字段；应选择适合当前分析的一组口径。

接入时按订单号更新或新增记录，随后自动分析以最近支付日期为结束日的 7 天窗口。可在策略中调整窗口天数，或手动指定日期。已支付订单计入订单量，退款抵减净 GMV；未付及取消订单不计入支付指标。退款按订单累计退款额抵减，订单归属支付日期。

同比使用北京时间的日历日期，与上一年同月同日比较。闰日映射至上一年 2 月 28 日。可按品牌或市场、品类或客群、商品查看分组；订单量或净 GMV 的变化达到设定阈值时，生成异常与待核验因子。零基线同比显示未知，不显示无穷增长。

覆盖声明表示导入记录覆盖指定时间段。只有本期和去年同期的覆盖均完整，才能计算同比；缺少记录的时间段不能自动解释为零订单。分别导入历史和当期文件时，为各文件声明实际覆盖区间，不要把中间未提供的数据包含在内。相同订单号跨文件更新，避免重复累计。

站内行为支持私信、评论、点赞、收藏的计数及品牌、品类、需求主题标签。采集端可提交已提取标签；也可提供临时 `text`、`body` 或 `content`，系统按已登记内容资产和监控因子的分组值、产品与关键词进行字面匹配。显式标签优先，同一分组字段出现多个匹配对象时保留未标注。分析只保存聚合字段，不保存正文。信号可用于解释相关线索，外部检索结果和候选因子不自动视为已证实的因果关系。

例如，排查某款收纳套装的订单异常时，可对照该商品的收藏和咨询变化，再核对品牌官方发布的促销公告。若时间、商品范围与渠道一致，可将“促销节点可能影响该商品需求”登记为待验证因子，持续关注后续公告和相同口径的订单、行为信号。新品发布、库存补货、节假日和季节性需求也可按此流程核验；这些是排查方向，不代表已经证实原因或投放效果。

## 事件与常态监控

![上新与补货因子监控](qa/growth-factors-desktop.png)

配置 Brave 后，异常分析可补充外部检索线索，并在报告中保存标题、摘要、来源 URL 和检索时间。候选因子可以转为监控规则：填写品牌或市场、品类或客群、关键词和官方域名白名单，人工核验后启用。商业事件规则请显式填写 `query`，例如“品牌 A 促销 公告”，并设置 `keywords`，例如“促销”“新品”“补货”。

规则可配置品牌官网或活动官网的 HTTPS 公告列表页。配置列表页时直接读取公告链接；未配置时使用 Brave 搜索。新链接按一级分组与 URL 去重，事件首次发现时间与公告发布时间分别保存。搜索结果或列表页没有明确发布日期时保持空值，不能拿抓取时间当发布日期。

发现的事件进入待审核状态。核验来源、日期和潜在人群规模后批准，再用于生成投放提案。同一事件手工重新提交可以补充日期或规模，并重新进入审核。监控规则可以拒绝以停止后续采集。

后台调度默认关闭，在「接入设置」启用。API 进程运行期间，工作线程检查到期规则、采集站内信号、执行已批准动作并回读广告绩效。默认规则间隔为 60 秒；请求时长、排队、页面更新和搜索索引延迟会影响实际发现时间，不保证固定发现时延。请求失败会退避重试；刷新、重启和重复轮询不会重复登记同一事件。

可在创建因子时设置 `action_parameters`，字段与下方机会提案相同。启用 `auto_propose` 后，已批准事件会自动生成待审批方案；方案仍需人工批准。该选项不会跳过事件审核，也不会直接充值。

## 内容、机会与投放

使用品牌或市场、品类或客群、商品与 `content_id` 登记已准备好的内容资产。`content_id` 对应使用者投放平台中的真实内容。

机会参数包括潜在人群规模、历史转化率、客单价、预算上限和目标 ROI。当前预算计算为：

```text
预期订单数 = 潜在人群规模 × 转化率
预期 GMV = 预期订单数 × 客单价
建议预算 = min(预算上限, 预期 GMV / 目标 ROI)
```

这些参数是可审阅的决策输入，不代表已经发生的收益。创建广告、充值、调整预算、调整目标 ROI 和停止广告都是独立动作。审批绑定动作版本与参数哈希；充值金额必须明确填写并独立批准。

动作发送前持久化幂等键。只有广告服务返回与动作类型、参数和幂等键匹配的回执，才记为成功。发送超时或回执不确定时进入待核对状态，只回读已有动作，不自动重发充值。执行前再次核对硬限额、审批与停止开关。

## 生命周期

广告绩效使用累计广告消耗与归因 GMV，实际 ROI = 归因 GMV / 消耗。每条数据须说明观察日、窗口起止时间和归因是否完成。窗口不完整或消耗不足时继续等待，不能据此判断低 ROI。

可配置第 1、2、3 天的最低 ROI、最低观测消耗、预算保留比例和最低预算。低于阈值时提出降预算；第 3 天或降低后预算过小时提出停投。已停止的广告不会因旧预算动作恢复。

默认生成待审批调整。只有原投放方案中明确批准 `auto_execute` 的生命周期策略，才能自动执行降预算或停投；不会据此自动追加预算或充值。绩效数据更新后，基于旧数据生成的自动动作需要重新核对。

## 使用者配置

复制 [`backend/.env.example`](../backend/.env.example) 为 `backend/.env`，填写使用的服务，重启 API。环境变量优先于 `.env`。配置状态只显示是否就绪，不返回密钥。

| 环境变量 | 用途 |
|---|---|
| `BRAVE_SEARCH_API_KEY` | Brave Search API 凭据 |
| `GROWTH_COLLECTOR_TOKEN` | 外部采集程序写入 OpsClaw 的 Bearer 凭据 |
| `GROWTH_SIGNALS_URL` | 已授权行为数据服务的增量 GET 地址 |
| `GROWTH_SIGNALS_TOKEN` | 该数据服务的 Bearer 凭据 |
| `GROWTH_SIGNALS_SOURCE` | 采集来源标识，默认 collector |
| `GROWTH_ADS_BASE_URL` | 广告适配服务基址 |
| `GROWTH_ADS_TOKEN` | 广告适配服务的 Bearer 凭据 |
| `GROWTH_MAX_BUDGET_MINOR` | 单动作预算硬上限，人民币分，默认 1000000 |
| `GROWTH_MAX_RECHARGE_MINOR` | 单次充值硬上限，人民币分，默认 1000000 |

官方入口：

- [Brave Web Search 文档](https://api-dashboard.search.brave.com/documentation/services/web-search)：当前使用 `GET https://api.search.brave.com/res/v1/web/search`，请求头为 `X-Subscription-Token`，读取 `web.results`。
- [小红书开放平台](https://open.xiaohongshu.com/)：查询对应应用获授权的数据能力。
- [小红书聚光](https://ad.xiaohongshu.com/)及[营销 API 入口](https://ad-market.xiaohongshu.com/)：查询广告账户和应用可用接口。
- [千帆后台](https://ark.xiaohongshu.com/)：导出订单文件后接入。

行为与广告适配使用下述 OpsClaw 协议。使用者需要将获授权的平台接口转换为该协议，处理平台签名、账户标识和接口版本；平台网页地址不能直接当作广告适配服务地址。当前不包含小红书登录态抓取程序，不声称所有应用都具有私信或广告充值权限。没有配置连接器时，文件分析仍可使用，广告动作显示待配置。

## HTTP 接口

前缀为 `/api/v1/growth`。工作台请求沿用工作区会话；采集端调用 `/collect`、`/orders`、`/actions/{id}/performance` 时可使用 `Authorization: Bearer <GROWTH_COLLECTOR_TOKEN>`。响应包裹在 `data` 中。

| 方法与路径 | 用途 |
|---|---|
| `GET /overview` | 指标、报告、因子、事件、资产、动作、采集与调度状态 |
| `GET /config`、`PUT /config` | 连接就绪状态和非密钥策略 |
| `POST /orders/bind` | 从已导入数据集接入订单并自动分析 |
| `POST /orders` | 订单增量写入 |
| `POST /collect` | 行为信号增量写入 |
| `POST /reports` | 指定起止日期执行同比与异常分析 |
| `POST /factors`、`POST /factors/{id}/review` | 创建监控规则、人工审核 |
| `POST /events`、`POST /events/{id}/review` | 登记或补充事件、核验事件 |
| `POST /monitor` | 立即轮询启用规则，可传 factor_id |
| `POST /assets` | 登记内容资产 |
| `POST /proposals` | 以已批准事件生成投放或独立充值方案 |
| `POST /actions/{id}/review` | approve/reject，必须传当前 hash |
| `POST /actions/{id}/execute`、`POST /actions/{id}/reconcile` | 执行、回读核对 |
| `POST /actions/{id}/adjust` | 创建预算、ROI 或停投调整 |
| `POST /actions/{id}/performance`、`POST /actions/{id}/lifecycle` | 接收绩效、评估生命周期 |

订单接入请求示意：

```json
{"dataset_id":"dataset-ID","amount_unit":"yuan","mapping":{"order_id":"订单号","paid_at":"支付时间","paid_amount":"实付金额","refund_amount":"退款金额","status":"订单状态","school":"品牌","college":"品类","product":"商品名称"},"coverage_start":"2026-09-01","coverage_end":"2026-09-07","start":"2026-09-01","end":"2026-09-07"}
```

行为写入请求：

```json
{"signals":[{"id":"source-event-ID","type":"comment","occurred_at":"2026-09-01T09:00:00+08:00","school":"品牌 A","college":"收纳用品","topic":"夏季收纳需求","count":1}],"coverage_start":"2026-09-01","coverage_end":"2026-09-01"}
```

支持 `dm`、`comment`、`like`、`favorite`。事件 ID 须全局稳定且唯一，建议以来源作为前缀。采集端在完成相应时间段同步后再提交覆盖声明。

### 增量采集服务协议

OpsClaw 对 `GROWTH_SIGNALS_URL` 发送 `GET ?cursor=...`，以 Bearer 传递 `GROWTH_SIGNALS_TOKEN`，期望返回：

```json
{"signals":[],"next_cursor":"next-page-token","coverage_start":"2026-09-01","coverage_end":"2026-09-01"}
```

单页最多 50000 条信号、5 MB。信号入库与游标更新同事务，失败保留旧游标。地址或来源改变时使用独立游标。服务每轮读取一页，后续轮询从新游标继续。

### 广告适配服务协议

请求使用 `Authorization: Bearer <GROWTH_ADS_TOKEN>`。以下路径相对于 `GROWTH_ADS_BASE_URL`，由使用者的获授权适配服务实现：

- `POST /actions` 接收 `{kind,idempotency_key,payload}`。类型为 `create_campaign`、`recharge`、`update_budget`、`update_roi`、`pause_campaign`。
- `GET /actions/{idempotency_key}` 读取同一动作的持久结果，不重新执行。
- 动作回执返回 `{kind,idempotency_key,payload,status}`，前三项须精确回显；状态为 `succeeded`、`failed`、`pending`。创建广告成功时额外返回真实 `campaign_id`。
- `GET /campaigns/{campaign_id}/performance` 返回 `{campaign_id,day,spend_minor,attributed_gmv_minor,window_start,window_end,attribution_complete}`。金额均为人民币分，时间使用带时区 ISO 8601，`day` 为 1、2、3，第 3 天可覆盖后续观察期。

适配服务应保证幂等键唯一执行并可查询。OpsClaw 的批准动作以同一幂等键执行，不能将动作回执中的“请求已收到”解释为平台操作已完成。

## 数据与运行

订单、聚合信号、报告、事件、规则、内容资产、审批哈希、广告回执和采集游标保存在工作区 SQLite 数据库。密钥由环境或本机 `.env` 提供。数据库、凭据、日志和上传记录不提交到 GitHub。

增长分析独立于客户运营表，绑定订单不会覆盖原工作区客户记录。后台线程与 API 同生共停；部署多进程时使用持久租约限制重复调度。停止 API 后不会继续采集或调整广告，重新启动后继续检查已保存状态。

## 验证

后端测试覆盖订单退款与幂等更新、闰日同比、时间覆盖缺口、咨询标签歧义、采集游标回滚、公告白名单、事件去重、审批哈希、充值超时核对和生命周期只执行一次。HTTP 协议测试使用隔离传输，不对外部广告账户产生操作。

前端测试使用实际 CSV 文件验证中文映射、同比报告、事件核验、资产登记、方案审批和未配置服务时的执行限制，并检查桌面路由与 390 像素窄屏。外部平台的账户权限、签名和真实回执需由使用者完成连接配置后验证。
