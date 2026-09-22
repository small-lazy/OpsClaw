"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Database, FileText, RefreshCw, UploadCloud, X } from "lucide-react";
import { useModalFocus } from "../lib/use-modal-focus";

type Column = { name: string; type: string; missing: number; missing_percent: number; unique: number; numeric?: { min: number | null; max: number | null; mean: number | null; sum: number | null }; top_values: { value: unknown; count: number }[] };
type Dataset = { id: string; name: string; source_id: string; format: string; sheet?: string; row_count: number; columns: Column[]; preview: Record<string, unknown>[]; analysis: { summary: string; duplicate_rows: number; missing_cells: number; insights: string[] }; business: { role: string | null; status: string; message: string }; created_at: string };
type QueueItem = { id: string; file: File; status: "waiting" | "uploading" | "completed" | "failed"; progress: number; error?: string; datasetIds?: string[] };
type Props = { notify: (message: string) => void; go: (path: string) => void };
const formatValue = (value: unknown) => value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
const time = (value: string) => new Date(value).toLocaleString("zh-CN");
async function readApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? body.detail ?? "请求失败，请重试");
  return body.data;
}

export function DatasetLibrary({ notify, sourceId }: { notify: Props["notify"]; sourceId?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: () => readApi<Dataset[]>("/api/v1/datasets") });
  const items = (datasets.data ?? []).filter(item => !sourceId || item.source_id === sourceId);
  return <section className="panel import-library">
    <div className="panel-head"><div><h2>{sourceId ? "文件分析" : "已导入文件"}</h2><p className="muted">保存原始表结构、质量诊断与分析结果，刷新后可继续查看。</p></div><button className="button" onClick={() => void datasets.refetch()} disabled={datasets.isFetching}><RefreshCw size={15} />刷新列表</button></div>
    {datasets.isPending ? <p className="import-empty">正在读取导入记录…</p> : datasets.isError ? <p className="import-empty" role="alert">{datasets.error.message}</p> : !items.length ? <p className="import-empty">尚无导入文件。上传表格后将在这里显示分析结果。</p> : <div className="sec-table-wrap"><table className="sec-table"><thead><tr><th>文件 / 工作表</th><th>格式</th><th>记录 / 字段</th><th>接入状态</th><th>导入时间</th><th /></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{item.name}</strong>{item.sheet && <small className="import-sheet">{item.sheet}</small>}</td><td>{item.format.toUpperCase()}</td><td>{item.row_count.toLocaleString()} / {item.columns.length}</td><td><span className="badge">{item.business.status === "active" ? "已接入业务" : item.business.status === "available" ? "可接入业务" : "通用分析"}</span></td><td>{time(item.created_at)}</td><td><button className="sec-text-button" onClick={() => setSelected(item.id)}>查看分析<ArrowRight size={14} /></button></td></tr>)}</tbody></table></div>}
    {selected && <DatasetDetail id={selected} close={() => setSelected(null)} notify={notify} />}
  </section>;
}

export function DatasetDetail({ id, close, notify }: { id: string; close: () => void; notify: Props["notify"] }) {
  useModalFocus(true, close);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["dataset", id], queryFn: () => readApi<Dataset>(`/api/v1/datasets/${encodeURIComponent(id)}`) });
  const item = query.data;
  async function activate() {
    setBusy(true);
    try {
      await readApi(`/api/v1/datasets/${encodeURIComponent(id)}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await Promise.all([client.invalidateQueries({ queryKey: ["datasets"] }), client.invalidateQueries({ queryKey: ["dataset", id] }), client.invalidateQueries({ queryKey: ["console"] })]);
      notify("已接入业务分析，数据中心已更新");
    } catch (error) { notify(error instanceof Error ? error.message : "接入失败"); }
    finally { setBusy(false); }
  }
  return <div className="sec-overlay" onClick={close}><section className="sec-drawer import-detail" role="dialog" aria-modal="true" aria-label="文件分析详情" onClick={event => event.stopPropagation()}><div className="sec-drawer-title"><h2>文件分析详情</h2><button className="sec-icon-button" onClick={close} aria-label="关闭分析"><X size={20} /></button></div>
    {query.isPending ? <p>正在读取分析…</p> : query.isError ? <div role="alert">{query.error.message}<button className="button" onClick={() => void query.refetch()}>重试</button></div> : item && <>
      <div className="sec-detail-hero"><Database size={26} /><h3>{item.name}</h3><span className="badge">{item.sheet || item.format.toUpperCase()}</span></div>
      <p className="sec-reading">{item.analysis.summary}</p>
      <div className="import-metrics"><div><small>记录数</small><strong>{item.row_count.toLocaleString()}</strong></div><div><small>字段数</small><strong>{item.columns.length}</strong></div><div><small>缺失单元格</small><strong>{item.analysis.missing_cells.toLocaleString()}</strong></div><div><small>重复记录</small><strong>{item.analysis.duplicate_rows.toLocaleString()}</strong></div></div>
      <h3>分析发现</h3><ul className="import-insights">{item.analysis.insights.map((insight, index) => <li key={index}>{insight}</li>)}</ul>
      <h3>字段质量与数值统计</h3><div className="sec-table-wrap"><table className="sec-table"><thead><tr><th>字段</th><th>类型</th><th>缺失</th><th>不同值</th><th>最小 / 最大</th><th>均值 / 合计</th><th>常见值</th></tr></thead><tbody>{item.columns.map(column => <tr key={column.name}><td>{column.name}</td><td>{column.type}</td><td>{column.missing} ({column.missing_percent.toFixed(1)}%)</td><td>{column.unique}</td><td>{column.numeric ? `${formatValue(column.numeric.min)} / ${formatValue(column.numeric.max)}` : "—"}</td><td>{column.numeric ? `${column.numeric.mean == null ? "不可计算" : Number(column.numeric.mean.toFixed(3))} / ${formatValue(column.numeric.sum)}` : "—"}</td><td>{column.top_values?.slice(0, 3).map(entry => `${formatValue(entry.value)} (${entry.count})`).join("、") || "—"}</td></tr>)}</tbody></table></div>
      <h3>数据预览</h3><p className="muted">前 {item.preview.length} 条记录；统计基于全表。</p><div className="sec-table-wrap"><table className="sec-table"><thead><tr>{item.columns.map(column => <th key={column.name}>{column.name}</th>)}</tr></thead><tbody>{item.preview.map((row, index) => <tr key={index}>{item.columns.map(column => <td key={column.name}>{formatValue(row[column.name])}</td>)}</tr>)}</tbody></table></div>
      <div className="sec-info">{item.business.message}</div>{item.business.status === "available" && <div className="sec-actions"><button className="button primary" disabled={busy} onClick={() => void activate()}>{busy ? "正在接入…" : "接入业务分析"}</button></div>}
    </>}
  </section></div>;
}

export function ImportWorkspace({ notify, go }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const client = useQueryClient();
  const patch = (id: string, changes: Partial<QueueItem>) => setQueue(items => items.map(item => item.id === id ? { ...item, ...changes } : item));
  function add(files: FileList | File[]) {
    const entries = Array.from(files).map(file => {
      const error = !/\.(csv|tsv|xlsx|json|jsonl)$/i.test(file.name) ? "不支持此格式，请选择 CSV、TSV、XLSX、JSON 或 JSONL" : file.size > 20 * 1024 * 1024 ? "文件超过 20 MB，请拆分后上传" : file.size === 0 ? "文件为空" : undefined;
      return { id: crypto.randomUUID(), file, status: error ? "failed" as const : "waiting" as const, progress: 0, error };
    });
    setQueue(items => [...items, ...entries]);
  }
  async function upload(item: QueueItem) {
    patch(item.id, { status: "uploading", progress: 0, error: undefined });
    try {
      const result = await new Promise<{ files: { status: string; error?: string; dataset_ids: string[] }[] }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/v1/imports");
        xhr.timeout = 300000;
        xhr.upload.onprogress = event => { if (event.lengthComputable) patch(item.id, { progress: Math.round(event.loaded / event.total * 100) }); };
        xhr.onerror = () => reject(new Error("网络连接失败，请重试"));
        xhr.ontimeout = () => reject(new Error("请求超时，请先刷新导入记录确认结果，再重试"));
        xhr.onload = () => {
          try { const body = JSON.parse(xhr.responseText); if (xhr.status < 200 || xhr.status >= 300) reject(new Error(typeof body.error === "string" ? body.error : body.error?.message ?? body.detail ?? "上传失败")); else resolve(body.data); }
          catch { reject(new Error("服务器未返回有效导入结果，请重试")); }
        };
        const form = new FormData(); form.append("files", item.file); xhr.send(form);
      });
      const outcome = result.files[0];
      if (!outcome || outcome.status !== "completed") throw new Error(outcome?.error ?? "文件处理失败");
      patch(item.id, { status: "completed", progress: 100, datasetIds: outcome.dataset_ids });
      await Promise.all([client.invalidateQueries({ queryKey: ["datasets"] }), client.invalidateQueries({ queryKey: ["console"] })]);
    } catch (error) { patch(item.id, { status: "failed", error: error instanceof Error ? error.message : "导入失败" }); }
    finally { await client.invalidateQueries({ queryKey: ["imports"] }); }
  }
  async function run(items: QueueItem[]) {
    if (lock.current || !items.length) return;
    lock.current = true; setBusy(true);
    try { let next = 0; await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => { while (next < items.length) { const item = items[next++]; await upload(item); } })); }
    finally { lock.current = false; setBusy(false); }
  }
  const waiting = queue.filter(item => item.status === "waiting");
  return <>
    <div className="sec-heading"><div><div className="sec-eyebrow">CONNECT YOUR DATA</div><h1 className="page-title">导入与分析</h1><p className="page-subtitle">批量接入文件，自动识别表结构、检查数据质量并生成分析。</p></div><button className="button" onClick={() => go("/data")}>返回数据中心<ArrowRight size={16} /></button></div>
    <section className="panel import-upload"><div className="panel-head"><div><h2>选择需要接入的数据</h2><p className="muted">支持 CSV、TSV、XLSX、JSON、JSONL。每文件最大 20 MB，每表最多 10 万行、200 列。</p></div><span className="badge">自动识别 · 逐文件处理</span></div>
      <input ref={input} type="file" multiple accept=".csv,.tsv,.xlsx,.json,.jsonl" aria-label="选择导入文件" className="import-file-input" onChange={event => { if (event.target.files) add(event.target.files); event.target.value = ""; }} />
      <button className={`import-drop ${dragging ? "is-dragging" : ""}`} onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); add(event.dataTransfer.files); }}><UploadCloud size={32} /><strong>拖入文件，或点击批量选择</strong><span>支持一次选择多个文件，Excel 将按工作表分别分析</span></button>
      {queue.length > 0 && <><div className="import-queue-heading"><h3>本次队列 · {queue.length} 个文件</h3><span className="muted" role="status">已完成 {queue.filter(item => item.status === "completed").length} · 失败 {queue.filter(item => item.status === "failed").length}</span></div><ul className="import-queue">{queue.map(item => <li key={item.id}><FileText size={20} /><div className="import-file-description"><strong>{item.file.name}</strong><small>{(item.file.size / 1024).toFixed(1)} KB · {item.status === "waiting" ? "等待导入" : item.status === "completed" ? `导入完成 · ${item.datasetIds?.length ?? 0} 张表` : item.status === "failed" ? item.error : item.progress === 100 ? "上传完成，正在识别与分析…" : `正在上传 ${item.progress}%`}</small>{item.status === "uploading" && <progress max={100} value={item.progress} aria-label={`${item.file.name} 上传进度`} />}</div>{item.status === "failed" && <button className="button" disabled={busy} onClick={() => void run([item])}>重试</button>}{item.status === "waiting" && <button className="sec-icon-button" disabled={busy} aria-label={`移除 ${item.file.name}`} onClick={() => setQueue(items => items.filter(entry => entry.id !== item.id))}><X size={17} /></button>}</li>)}</ul><div className="sec-actions"><button className="button" disabled={busy} onClick={() => setQueue(items => items.filter(item => item.status !== "completed"))}>清除已完成</button><button className="button primary" disabled={busy || !waiting.length} onClick={() => void run(waiting)}>{busy ? "正在导入与分析…" : `开始导入${waiting.length ? ` (${waiting.length})` : ""}`}</button></div></>}
    </section>
    <DatasetLibrary notify={notify} />
    <ImportHistory />
  </>;
}


type ImportBatch = { id: string; created_at: string; status: string; files: { name: string; status: string; error?: string; dataset_ids: string[] }[] };
function ImportHistory() {
  const query = useQuery({ queryKey: ["imports"], queryFn: () => readApi<ImportBatch[]>("/api/v1/imports") });
  return <section className="panel import-library"><div className="panel-head"><div><h2>导入历史</h2><p className="muted">保留每次导入的处理结果。失败文件可重新选择后再次导入。</p></div><button className="button" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新历史</button></div>{query.isPending ? <p className="import-empty">正在读取历史…</p> : query.isError ? <p className="import-empty" role="alert">{query.error.message}</p> : !query.data?.length ? <p className="import-empty">尚无导入记录。</p> : <div className="sec-table-wrap import-history-table"><table className="sec-table"><thead><tr><th>文件</th><th>导入时间</th><th>处理结果</th></tr></thead><tbody>{query.data.flatMap(batch => batch.files.map((file, index) => <tr key={`${batch.id}-${index}`}><td>{file.name}</td><td>{time(batch.created_at)}</td><td>{file.status === "completed" ? `已完成 · ${file.dataset_ids.length} 张表` : `失败：${file.error || "请检查文件后重试"}`}</td></tr>))}</tbody></table></div>}</section>;
}
