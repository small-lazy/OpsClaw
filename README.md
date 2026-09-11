# OpsClaw

**让业务信号成为有据可循的行动。**

OpsClaw 是面向数据运营场景的 Agent 工作台，将数据查看、缺口检测、证据调查、方案审批与执行跟踪连接起来。通过可视化工作流查看每一步的依据和进展，也可以编写自定义 Skill，通过 MCP 与其他 Agent 协作。

[核心功能](#核心功能) · [界面预览](#界面预览) · [快速开始](#快速开始) · [Skill 与 MCP](#skill-与-mcp) · [开发](#开发)

![运营总览](docs/qa/overview-desktop.png)

## 核心功能

- **运营总览**：集中查看行动缺口、待审方案、执行进度、行动覆盖率和趋势，快速定位需要处理的事项。
- **数据中心**：浏览客户、订单、行为、触达、任务与售后记录，支持 CSV 导入、字段映射、来源状态查看和分页预览。
- **缺口检测**：结合客户价值、交易变化、活跃趋势与跟进记录识别待处理事项，并按优先级组织案件。
- **证据调查**：关联交易、行为和工单信息，用流程图、节点详情与事件时间线呈现调查过程。
- **方案审批**：集中审阅客户范围、负责人、任务内容与依据，记录批准、拒绝和版本信息。
- **执行跟踪**：创建客户跟进任务、回读执行结果、核对任务状态，保留动作记录与后续观察状态。
- **自定义 Skill**：使用 Markdown 编写工作指令，配置输入参数和工具权限，支持版本管理、启停、参数测试与导出。
- **MCP 接入**：向其他 Agent 提供 Skill、业务上下文和授权工具，复用工作区中的数据与工作方法。

## 界面预览

### 客户与证据

在同一页面查看客户概况、业务信号、交易明细和行动建议。

![客户案件与交易明细](docs/qa/customer-desktop.png)

### 数据中心

按业务类型管理数据源，查看字段、覆盖情况与记录明细。

![数据中心](docs/qa/data-desktop.png)

![数据记录分页](docs/qa/data-records-desktop.png)

### 审批与工作流

从方案审阅到执行回读，沿着流程图和事件时间线跟踪任务进展。

![审批中心](docs/qa/approvals-desktop.png)

![调查工作流与事件时间线](docs/qa/run-desktop.png)

### Skill 工坊

将业务经验整理为可复用的工作指令，统一管理参数、版本和工具权限。

![Skill 工坊](docs/qa/skills-desktop.png)

### 响应式布局

桌面与窄屏均可浏览工作区，查看关键指标、案件和任务状态。

<img src="docs/qa/overview-mobile.png" alt="窄屏运营总览" width="360" />

## 快速开始

### 环境要求

- Windows
- Git
- Node.js 22
- pnpm 10
- Python 3.13

以下命令使用 PowerShell，在仓库根目录执行。

### 1. 获取源码

```powershell
git clone https://github.com/small-lazy/OpsClaw.git
cd OpsClaw
npm install --global pnpm@10
```

### 2. 安装后端依赖

```powershell
py -3.13 -m venv .\backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.lock.txt
```

### 3. 安装前端依赖并构建

```powershell
Push-Location .\apps\web
pnpm install --frozen-lockfile
pnpm build
Pop-Location
```

### 4. 启动应用

打开三个 PowerShell 终端，每个终端均从仓库根目录开始，依次运行以下服务。

**终端 1：客户任务服务**

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe -m uvicorn opsweaver.crm:app --host 127.0.0.1 --port 8101
```

**终端 2：业务 API**

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe -m uvicorn opsweaver.api:app --host 127.0.0.1 --port 8100
```

**终端 3：前端**

```powershell
Set-Location .\apps\web
pnpm start
```

打开 [http://127.0.0.1:3100/overview](http://127.0.0.1:3100/overview)。停止服务时，在各终端按 `Ctrl+C`。

| 服务 | 地址 |
|---|---|
| 工作台 | `http://127.0.0.1:3100` |
| 业务 API | `http://127.0.0.1:8100` |
| 客户任务服务 | `http://127.0.0.1:8101` |

## Skill 与 MCP

在 **Skill 工坊** 创建工作指令，定义 JSON Schema 输入参数，并选择需要使用的工具。保存后即可管理 Skill 的版本与启用状态。

连接其他 Agent：

1. 启动 OpsClaw，进入 **Skill 工坊 → MCP 接入**。
2. 复制页面生成的配置，添加到 Agent 客户端的 MCP 配置中。
3. 连接后获取 Skill，提交参数并调用授权工具。

MCP 使用 **stdio** 传输，提供以下接口：

| 接口 | 用途 |
|---|---|
| `list_skills` / `get_skill` | 列出 Skill、读取指令和参数定义 |
| `run_skill` | 校验输入，获取 Skill 指令与业务上下文 |
| `invoke_skill_tool` | 调用 Skill 授权的业务工具 |
| `console_summary` | 获取工作区概况 |
| `opsweaver://skills/{skill_id}` | 读取 Skill 资源 |
| `use_skill` | 获取 Skill 提示词 |

查看 [MCP 配置示例](mcp.config.example.json) 与 [接入文档](docs/MCP.md)。

## 开发

### 开发模式

保持两个后端服务运行，在前端终端使用 `pnpm dev` 替代 `pnpm start`，启用热更新。

```powershell
Set-Location .\apps\web
pnpm dev
```

开发前端与生产前端共用 3100 端口，切换前按 `Ctrl+C` 停止运行中的前端。

### 构建与检查

```powershell
Push-Location .\apps\web
pnpm typecheck
pnpm build
Pop-Location
```

更新生产版本时，停止前端、执行 `pnpm build`，然后使用 `pnpm start` 重新启动。

### 测试

后端测试：

```powershell
Push-Location .\backend
.\.venv\Scripts\python.exe -m pytest tests -q
Pop-Location
```

浏览器测试使用 Google Chrome，运行前启动三个服务：

```powershell
Push-Location .\apps\web
pnpm exec playwright test
Pop-Location
```

## 技术栈

| 模块 | 技术 |
|---|---|
| 前端 | Next.js 16、React 19、TypeScript |
| 数据与可视化 | TanStack Query、ECharts、React Flow |
| 后端 | Python、FastAPI、Pydantic、SQLite |
| Agent 接口 | MCP SDK、JSON Schema、HTTPX |
| 测试 | pytest、Playwright |

## 项目结构

```text
.
├── apps/web/                 # 前端页面、组件与浏览器测试
├── backend/
│   ├── opsweaver/            # 业务逻辑、API、数据查询与 MCP
│   ├── tests/                # 后端测试
│   └── requirements.lock.txt # 后端依赖锁定文件
├── docs/                     # 接入文档与运行截图
└── mcp.config.example.json   # MCP 配置示例
```
