"use client";
import type { ReactNode, FormEvent, InputHTMLAttributes } from "react";
export type Row = Record<string, any>;
export type GrowthProps = { data: Row; busy: boolean; run: (path: string, body?: Row, method?: string) => Promise<Row | null> };
export function Field({ title, children, ...rest }: { title: string; children?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) { return <label className="growth-field"><span>{title}</span>{children || <input className="field" {...rest} />}</label>; }
export function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) { return <section className="panel growth-panel"><div className="panel-head"><div><h2>{title}</h2>{description && <p className="muted">{description}</p>}</div>{action}</div><div className="growth-panel-body">{children}</div></section>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="growth-empty">{children}</div>; }
export const names: Record<string,string> = { configured:"已配置", idle:"等待运行", not_configured:"待配置", completed:"已完成", pending_review:"待审核", blocked_configuration:"待配置", waiting_data:"数据未成熟", update_budget:"调整预算", update_roi:"调整 ROI", running:"执行中", superseded:"已失效", pending:"待审批", pending_approval:"待审批", candidate:"候选", approved:"已批准", active:"监控中", rejected:"已拒绝", succeeded:"已执行", executed:"已执行", verified:"已核验", unknown:"待核对", failed:"失败", blocked:"受限", needs_configuration:"待配置", create_campaign:"创建广告", recharge:"充值", reduce_budget:"降低预算", pause_campaign:"暂停广告", increase_budget:"增加预算" };
export function Status({ status }: { status: string }) { return <span className={`growth-status ${["configured","active","approved","succeeded","verified"].includes(status) ? "good" : ""}`}>{names[status] || status}</span>; }
export function Detail({ data, title="查看完整记录" }: { data: unknown; title?: string }) { return <details className="growth-details"><summary>{title}</summary><pre>{JSON.stringify(data,null,2)}</pre></details>; }
export const formData = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return new FormData(event.currentTarget); };
export const num = (data: FormData, key: string, fallback=0) => data.get(key) == null || data.get(key) === "" ? fallback : Number(data.get(key));
export const money = (data: FormData,key:string) => Math.round(num(data,key)*100);
export const pct = (value: number|null|undefined) => value == null ? "未知" : `${(value*100).toFixed(1)}%`;
export const amount = (value: number|null|undefined) => value == null ? "未知" : `¥${(value/100).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
