# 文件导入与分析 API

所有路径以 `/api/v1` 为前缀。浏览器通过工作台同源路径访问；外部本机程序可访问 `http://127.0.0.1:8100/api/v1`。写操作先调用 `POST /workspace/session`，后续请求携带返回的会话 Cookie。

## 接口

| 方法与路径 | 用途 |
|---|---|
| `POST /imports` | multipart/form-data，重复使用 `files` 字段提交一个或多个文件 |
| `GET /imports` | 获取已保存的导入批次 |
| `GET /imports/{id}` | 获取批次状态、各文件错误和生成的数据集 ID |
| `GET /datasets` | 获取数据集列表 |
| `GET /datasets/{id}` | 获取字段统计、记录预览、分析结论及业务接入状态 |
| `GET /datasets/{id}/rows?offset=0&limit=25` | 分页读取记录，limit 为 1–100 |
| `GET /business-schema` | 获取业务表所需字段 |
| `POST /datasets/{id}/activate` | 将标准业务数据集接入运营分析 |

返回值位于 `data`。导入批次状态为 `completed`、`partial` 或 `failed`；调用方必须检查 `files[].status` 与 `files[].error`，HTTP 成功不代表所有文件都成功。每个成功文件返回 `dataset_ids`，Excel 可返回多个 ID。

## 文件格式与处理

支持 CSV、TSV、XLSX、JSON、JSONL/NDJSON。文本支持 UTF-8、带 BOM 的 UTF-16 与 GB18030。CSV 自动识别逗号、分号或制表符，支持引号包裹与跨行字段。JSON 接受对象数组，也接受 `{"data": [...]}`；JSONL 每行一个对象。嵌套对象保存为 JSON 文本。

每个文件最多 20 MB，每张表最多 100,000 行、200 列；Excel 最多 30 个工作表，解压后总大小最多 100 MB。表头不能为空或重复。空白记录会跳过；只有标准业务字段完整的表允许仅含表头，以声明零条记录。单个文件解析失败不会撤销同批次其他已成功文件。Excel 公式按文本保存，需要计算值时请先在表格软件中转为值。

网页以有界并发队列逐文件发送，避免一次请求装入全部文件。每个批次最多 50 个文件、文件总大小最多 50 MB（HTTP 请求体最多 55 MB）；更大文件集合请分批发送。队列中尚未发送的文件需要保持页面打开，完成的导入历史和数据集会持久化。

每个字段提供类型、缺失数与比例、去重值数量、高频值；完整数值列提供最小值、最大值、均值与总和。完全重复行只标记，不自动删除；缺失数据不自动填补。归一化记录与分析结果保存到 SQLite，原始上传文件不另存副本。

## 业务分析接入

通用分析无需指定业务类型。业务检测要求字段匹配标准表，可查询 `/business-schema` 或使用以下模板：

- [客户档案](import-templates/customers.csv)
- [订单](import-templates/orders.csv)
- [行为事件](import-templates/events.csv)
- [触达记录](import-templates/contacts.csv)
- [客户任务](import-templates/crm_tasks.csv)
- [售后工单](import-templates/support_tickets.csv)

模板中的 `YOUR-...` 和日期、金额需替换成自己的记录。先接入客户表，再接入通过 `customer_id` 关联的表。日期使用 ISO 8601，建议显式时区；日期会统一为 UTC。金额使用人民币整数分，10000 表示 100 元，退款金额同单位。权限与覆盖字段只可使用 0/1；未知营销同意可留空。

第一次接入客户表会切换到独立的业务分析库，之前的工作台案件和动作保留在归档中；之后按主键更新或新增。当前检测按接入的记录计算，不与其他业务数据集合并。未完成来源覆盖时保留不完整状态，补齐数据后再运行检测。客户 ID 不存在、重复主键、字段缺失、金额或日期不合法时，业务接入失败，已完成的通用分析仍可查看。

## Python 调用示例

```python
from pathlib import Path
import httpx

base = "http://127.0.0.1:8100/api/v1"
with httpx.Client(base_url=base, timeout=120) as client:
    client.post("/workspace/session").raise_for_status()
    with Path("orders.xlsx").open("rb") as stream:
        response = client.post("/imports", files=[("files", ("orders.xlsx", stream))])
    response.raise_for_status()
    batch = response.json()["data"]
    for file in batch["files"]:
        if file["status"] == "failed":
            print(file["name"], file["error"])
            continue
        for dataset_id in file["dataset_ids"]:
            result = client.get(f"/datasets/{dataset_id}")
            result.raise_for_status()
            print(result.json()["data"]["analysis"])
```

重复上传会生成新的数据集；网络中断后先检查导入历史，确认结果后再重试。接口采用同步处理，适合上述容量范围内的本机文件分析。XLS、Parquet、压缩包和数据库增量同步尚未提供。
