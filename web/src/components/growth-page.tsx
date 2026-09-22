"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Database, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { GrowthOrders, GrowthEvents, GrowthSettings } from "./growth-data";
import { GrowthAssets, GrowthActions } from "./growth-actions";
import type { Row } from "./growth-shared";
import "./growth-page.css";
export async function growthApi(path:string,body?:Row,method="POST") { const response=await fetch(`/api/v1/growth${path}`,body===undefined?undefined:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); const result=await response.json(); if(!response.ok) throw new Error(result.error?.message||result.detail||"操作失败，请重试"); return result.data as Row; }
export function GrowthPage({notify,go}:{notify:(message:string)=>void;go:(path:string)=>void}) {
 const client=useQueryClient();const [tab,setTab]=useState("orders");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const query=useQuery({queryKey:["growth"],queryFn:()=>growthApi("/overview"),refetchInterval:30000});
 async function run(path:string,body:Row={},method="POST") {setBusy(true);setError("");try {const result=await growthApi(path,body,method);await client.invalidateQueries({queryKey:["growth"]});notify(result.message||"操作已完成，请查看处理结果");return result;}catch(failure){const message=failure instanceof Error?failure.message:"操作失败";setError(message);notify(message);return null;}finally{setBusy(false);}}
 if(query.isPending)return <section className="panel growth-loading"><Loader2 className="spin"/>正在读取增长工作台…</section>;
 if(query.isError||!query.data)return <section className="panel growth-loading"><h1>增长工作台</h1><p role="alert">{query.error?.message||"增长服务暂不可用"}</p><button className="button" onClick={()=>void query.refetch()}>重新连接</button></section>;
 const data=query.data;const props={data,busy,run};
 return <div className="growth-workspace"><div className="sec-heading"><div><div className="sec-eyebrow">GROWTH WORKSPACE</div><h1 className="page-title">增长工作台</h1><p className="page-subtitle">从订单变化发现机会，将事件证据连接到内容与投放。</p></div><button className="button" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw size={16}/>刷新工作台</button></div>
 <div className="growth-summary">{[["已接入订单",data.orders.total,Database],["采集信号",data.signals.total,Activity],["启用监控",data.factors.filter((item:Row)=>["active","approved"].includes(item.status)).length,Activity],["待审行动",data.actions.filter((item:Row)=>item.status==="pending_approval").length,ShieldCheck]].map(([title,count,Icon])=>{const Component=Icon as typeof Database;return <div className="panel growth-summary-card" key={String(title)}><span>{String(title)}<Component size={18}/></span><strong>{Number(count).toLocaleString()}</strong></div>;})}</div>
 <nav className="growth-tabs" aria-label="增长工作台分类">{[["orders","订单与诊断"],["events","事件与因子"],["assets","内容与机会"],["actions","审批与投放"],["settings","接入设置"]].map(([id,title])=><button key={id} className={tab===id?"active":""} onClick={()=>{setTab(id);setError("");}}>{title}</button>)}</nav>{error&&<div className="growth-error" role="alert">{error}</div>}
 {tab==="orders"&&<GrowthOrders {...props} go={go}/>} {tab==="events"&&<GrowthEvents {...props}/>} {tab==="assets"&&<GrowthAssets {...props}/>} {tab==="actions"&&<GrowthActions {...props}/>} {tab==="settings"&&<GrowthSettings {...props}/>}
 </div>;
}
