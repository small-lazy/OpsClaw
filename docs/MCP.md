# OpsWeaver MCP 接入

MCP 适配器通过带令牌的本地 HTTP API 访问 OpsWeaver。当前实现并验证的目标传输方式是 **stdio**；HTTP MCP 尚未启用，`--http` 会明确退出，不会在 8102 端口启动服务。

## 安装与配置

先安装后端依赖并启动 OpsWeaver API。默认 API 基址为 `http://127.0.0.1:8100/api/v1/mcp`。适配器从 `OPSWEAVER_MCP_TOKEN` 读取令牌，未设置时读取后端目录的 `data/mcp.token`。该文件由主后端生成。令牌不会被写入 MCP 工具结果。

客户端配置示例，请替换 Python 和脚本的绝对路径：

```json
{
  "mcpServers": {
    "opsweaver": {
      "command": "C:\\path\\to\\python.exe",
      "args": ["C:\\path\\to\\opsweaver\\backend\\opsweaver\\mcp_server.py"]
    }
  }
}
```

绝对脚本启动不依赖客户端当前目录。也支持模块启动：

```json
{
  "mcpServers": {
    "opsweaver": {
      "command": "C:\\path\\to\\python.exe",
      "args": ["-m", "opsweaver.mcp_server"],
      "cwd": "C:\\path\\to\\opsweaver\\backend"
    }
  }
}
```

Python 环境需要 `mcp` 和 `httpx`。可通过 `OPSWEAVER_API_URL` 改变本地 API 基址，通过 `OPSWEAVER_MCP_TOKEN_FILE` 指定令牌文件绝对路径。适配器只连接 loopback HTTP 地址，禁用环境代理和自动重定向。

## 已暴露能力

| 类型 | 名称 | 行为 |
|---|---|---|
| Tool | `list_skills` | 列出注册 Skill、版本与状态 |
| Tool | `get_skill` | 读取指令、输入契约和工具白名单 |
| Tool | `run_skill` | 校验参数并取得指令与上下文，不自动执行其工具 |
| Tool | `invoke_skill_tool` | 调用该 Skill 获准使用的受控工具 |
| Tool | `console_summary` | 读取工作区概况 |
| Resource | `opsweaver://skills/{skill_id}` | JSON 格式 Skill 定义 |
| Prompt | `use_skill(skill_id)` | 加载 Skill 并说明输入、证据与权限要求 |

`invoke_skill_tool` 仅接受 `console_summary`、`list_incidents`、`get_incident`、`investigate`、`request_plan`。主后端还必须检查 Skill 状态及其自身白名单。调查和提案可能创建平台内业务记录；审批、CRM 执行、任意代码和任意 SQL 不在 MCP 能力中。

建议外部 Agent 先调用 `list_skills` → `get_skill` → `run_skill`，再按用户任务选择必要的 `invoke_skill_tool`。返回的业务字段和 Markdown 指令不构成扩大权限的授权。数据来源、覆盖限制与待观察结果应如实保留。
