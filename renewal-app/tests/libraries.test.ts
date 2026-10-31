import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CONTROL_CATALOG} from '../lib/control-catalog.ts';
import {buildSampleData,seedSampleData,SAMPLE_SET} from '../lib/sample-data.ts';
import {MODULES,validateControl} from '../lib/management-domain.ts';
import type {Area,ControlRecord} from '../lib/management-domain.ts';
import {createDatabase} from '../lib/database.ts';
import {readManagement,mutateManagement,addEvidence} from '../lib/management-store.ts';
import type {Viewer} from '../lib/access.ts';

test('three complete control libraries and realistic, linked, explicitly fictional scenarios',()=>{
 const data=buildSampleData(new Date('2026-10-31T12:00:00Z'));
 assert.equal(data.records.length,276);assert.equal(data.units.length,12);
 assert.equal(data.evidence.length,276);assert.equal(new Set(data.records.map(r=>r.id)).size,276);
 assert.equal(new Set(data.records.map(r=>r.reference)).size,276);
 for(const area of Object.keys(CONTROL_CATALOG) as Area[]){
  assert.equal(CONTROL_CATALOG[area].length,24);
  for(const module of Object.keys(MODULES))assert.ok(data.records.some(r=>r.area===area&&r.module===module));
  assert.equal(data.records.filter(r=>r.area===area&&r.module==='finding').length,12);
 }
 for(const row of data.records){
  assert.equal(row.sample_set,SAMPLE_SET);assert.match(row.description as string,/DEMONSTRATION ONLY/);
  assert.ok((row.owner_email as string).endsWith('@sample.invalid'));
  assert.ok(MODULES[row.module].statuses.includes(row.status));assert.equal(row.license_id,null);
  const parsed=validateControl({module:row.module,title:row.title,description:row.description,unitId:row.unit_id,category:row.category,priority:row.priority,ownerEmail:row.owner_email,reviewerEmail:row.reviewer_email,dueDate:row.due_date,details:row.details,relatedId:row.related_id,licenseId:''});
  assert.equal(parsed.title,row.title);
  if(row.related_id){const parent=data.records.find(r=>r.id===row.related_id);assert.ok(parent);assert.equal(parent.area,row.area);if(row.module==='check'){assert.equal(parent.module,'control');assert.equal(parent.status,'active')}}
 }
 for(const item of data.evidence){const bytes=Buffer.from(item.content_base64,'base64');assert.equal(item.sha256,createHash('sha256').update(bytes).digest('hex'));assert.match(bytes.toString(),/DEMONSTRATION ONLY/)}
 assert.ok(data.records.some(r=>(r.due_date as string)<'2026-10-31'&&r.status!=='closed'));
});

test('database: idempotent sample load, separate area/module totals, filters, CSV and read-only demonstrations',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {db,close}=createDatabase(process.env.TEST_DATABASE_URL!);
 const admin:Viewer={email:'library.qa@example.test',userId:'library-qa',displayName:'Library QA',role:'admin'};
 const query=(kind:string,extra:Record<string,string>={})=>readManagement(db,admin,new URLSearchParams({kind,module:'all',dataset:'sample',...extra})) as Promise<any>;
 try{
  await seedSampleData(db);assert.equal((await seedSampleData(db)).inserted,0);
  const before=await db.prepare('SELECT COUNT(*) AS n FROM workspace_users WHERE email LIKE ?').bind('%@sample.invalid').first<{n:number}>();assert.equal(before?.n,0);
  const all=await query('dashboard');assert.equal(all.summary.total,276);assert.equal(all.summary.sample,276);assert.equal(all.health.controls,72);assert.equal(all.health.checks,72);
  for(const area of Object.keys(CONTROL_CATALOG)){
   const summary=await query('dashboard',{area});assert.equal(summary.summary.total,92);assert.equal(summary.health.controls,24);assert.equal(summary.health.checks,24);
   assert.equal(summary.byArea.length,1);assert.equal(summary.byArea[0].area,area);assert.equal(summary.byUnit.length,4);
   assert.ok(summary.events.every((e:any)=>e.reference.startsWith('DEMO-'+{it:'IT',head_office:'HO',branch:'BR'}[area as Area])));
   for(const module of Object.keys(MODULES)){
    const list=await query('records',{area,module}),stats=await query('dashboard',{area,module});assert.equal(stats.summary.total,list.total);assert.ok(list.total>0);
    assert.ok(list.records.every((r:ControlRecord)=>r.area===area&&r.module===module&&r.sampleSet===SAMPLE_SET));
   }
  }
  const empty=await query('records',{dataset:'actual',q:'DEMO-IT-CTL'});assert.equal(empty.total,0);
  const csv=await query('export',{module:'control',area:'branch'});assert.equal(csv.count,24);assert.match(csv.csv,/Data source/);assert.match(csv.csv,/SAMPLE - fictional/);assert.doesNotMatch(csv.csv,/DEMO-IT-/);
  const r=(await query('records',{module:'control',area:'it'})).records[0];
  await assert.rejects(mutateManagement(db,admin,{action:'transition',id:r.id,version:r.version,to:'retired',note:'Forbidden sample mutation',requestId:crypto.randomUUID()}),/read-only/);
  await assert.rejects(addEvidence(db,admin,{id:r.id,version:r.version,requestId:crypto.randomUUID(),name:'extra.txt'},Buffer.from('Not permitted on a sample.')),/read-only/);
  await assert.rejects(query('dashboard',{dataset:'invalid'}),/data source/);
  const open=await query('dashboard',{module:'finding',status:'closed'});assert.equal(open.summary.total,9);assert.equal(open.summary.closed,9);assert.equal(open.summary.overdue,0);
  console.log('Three libraries, all module dashboards, source filters, exports and sample boundaries verified.');
 }finally{await close()}
});
