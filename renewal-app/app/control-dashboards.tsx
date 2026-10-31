'use client';
import {Building2,ClipboardCheck,FileCheck2,Layers3,ShieldCheck,Timer,TriangleAlert} from 'lucide-react';
import {AREAS,PRIORITIES,statusLabel} from '@/lib/management-domain';
import type {Area} from '@/lib/management-domain';

export type ControlScope=Area|'all';
export type Dataset='all'|'actual'|'sample';
export type Analytics={
 summary:{total:number;open:number;overdue:number;high:number;review:number;mine:number;closed:number;sample:number};
 byStatus:{status:string;total:number}[];
 byPriority:{priority:string;total:number}[];
 byUnit:{name:string;total:number;closed:number;overdue:number}[];
 health:{controls:number;active_controls:number;checks:number;tested:number;effective:number;partial:number;ineffective:number;findings:number;overdue_actions:number};
};
export function ScopeSelector({scope,dataset,onScope,onDataset}:{scope:ControlScope;dataset:Dataset;onScope:(scope:ControlScope)=>void;onDataset:(dataset:Dataset)=>void}){
 return <section className="mg-scope-selector" aria-label="Control workspace selection">
  <div><span className="mg-eyebrow">CHOOSE YOUR CONTROL AREA</span><div className="mg-scope-buttons" role="group" aria-label="Control area">
   <button className={scope==='all'?'active':''} aria-pressed={scope==='all'} onClick={()=>onScope('all')}><Layers3 size={17}/>All controls</button>
   {(Object.entries(AREAS) as [Area,string][]).map(([area,name])=><button key={area} className={scope===area?'active '+area:area} aria-pressed={scope===area} onClick={()=>onScope(area)}>{area==='it'?<ShieldCheck size={17}/>:area==='branch'?<Building2 size={17}/>:<ClipboardCheck size={17}/>} {name}</button>)}
  </div></div>
  <label className="mg-dataset"><span>Data source</span><select value={dataset} onChange={e=>onDataset(e.target.value as Dataset)}><option value="all">Actual + sample records</option><option value="actual">Actual records only</option><option value="sample">Sample records only</option></select></label>
 </section>;
}
export function SampleNotice({count}:{count:number}){return count>0?<div className="mg-sample-notice" role="status"><Layers3 size={20}/><p><strong>{count} sample records in this view.</strong> These fictional scenarios demonstrate the portal. They are labelled, read-only and excluded when you select “Actual records only”.</p></div>:null}
function Stat({label,value,description,tone='sage'}:{label:string;value:number;description:string;tone?:string}){return <section className={'mg-metric '+tone}><div><span>{label}</span></div><strong>{value.toLocaleString()}</strong><p>{description}</p></section>}
function Bars({items,total}:{items:{label:string;value:number;tone?:string}[];total:number}){return <div className="mg-chart-bars">{items.map(item=><div key={item.label}><div><span>{item.label}</span><strong>{item.value}</strong></div><div className="mg-bar-track" role="img" aria-label={`${item.label}: ${item.value} of ${total}`}><span className={item.tone||''} style={{width:`${total?Math.min(100,item.value/total*100):0}%`}}/></div></div>)}</div>}
export function RegisterMetrics({data}:{data:Analytics}){return <div className="mg-metrics"><Stat label="Records in this module" value={data.summary.total} description="Matches the current area and filters"/><Stat label="Overdue work" value={data.summary.overdue} description="Open records past their due date" tone="copper"/><Stat label="Awaiting review" value={data.summary.review} description="Includes draft controls awaiting activation" tone="lilac"/><Stat label="Closed records" value={data.summary.closed} description="Sample closures are fictional scenarios"/></div>}
export function ControlHealth({data}:{data:Analytics}){return <div className="mg-metrics"><Stat label="Controls in library" value={data.health.controls} description={`${data.health.active_controls} active control definitions`}/><Stat label="Open findings" value={data.health.findings} description="Findings requiring remediation" tone="copper"/><Stat label="Control checks" value={data.health.checks} description={`${data.health.tested} submitted or completed with results`} tone="lilac"/><Stat label="Overdue actions" value={data.health.overdue_actions} description="Corrective actions past their due date" tone="ochre"/></div>}
export function ModuleCharts({data,showTeams=false}:{data:Analytics;showTeams?:boolean}){
 return <>
  <div className="mg-dashboard-grid mg-analytics-grid">
   <section className="panel mg-panel"><div className="mg-panel-heading"><div><span className="mg-eyebrow">WORKFLOW PROGRESS</span><h2>Records by status</h2></div><ClipboardCheck size={23}/></div>{data.byStatus.length?<Bars total={data.summary.total} items={data.byStatus.map(x=>({label:statusLabel(x.status),value:x.total}))}/>:<p className="mg-quiet">No records match this selection.</p>}</section>
   <section className="panel mg-panel"><div className="mg-panel-heading"><div><span className="mg-eyebrow">PRIORITY MIX</span><h2>Records by severity</h2></div><TriangleAlert size={23}/></div><Bars total={data.summary.total} items={[...PRIORITIES].reverse().map(p=>({label:statusLabel(p),value:data.byPriority.find(x=>x.priority===p)?.total||0,tone:p}))}/><p className="mg-chart-caption">Severity is the assigned priority of each record.</p></section>
  </div>
  {showTeams&&<div className="mg-dashboard-grid mg-analytics-grid"><section className="panel mg-panel"><div className="mg-panel-heading"><div><span className="mg-eyebrow">ACCOUNTABILITY</span><h2>Teams & branches</h2></div><Building2 size={23}/></div>{data.byUnit.length?<div className="mg-table-scroll"><table className="mg-table"><thead><tr><th scope="col">Team / branch</th><th scope="col">Total</th><th scope="col">Closed</th><th scope="col">Overdue</th></tr></thead><tbody>{data.byUnit.map(u=><tr key={u.name}><td>{u.name}</td><td>{u.total}</td><td>{u.closed}</td><td className={u.overdue?'mg-overdue':''}>{u.overdue}</td></tr>)}</tbody></table></div>:<p className="mg-quiet">No team records in this selection.</p>}</section><section className="panel mg-panel"><div className="mg-panel-heading"><div><span className="mg-eyebrow">TESTING OUTCOMES</span><h2>Control effectiveness</h2></div><FileCheck2 size={23}/></div><Bars total={data.health.tested} items={[{label:'Effective',value:data.health.effective},{label:'Partly effective',value:data.health.partial,tone:'medium'},{label:'Ineffective',value:data.health.ineffective,tone:'critical'}]}/><p className="mg-chart-caption">{data.health.tested} submitted or closed checks with a recorded result. Planned and unfinished checks are excluded. Sample results are demonstrations.</p></section></div>}
 </>;
}
