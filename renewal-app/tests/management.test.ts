import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from '../lib/database.ts';
import type {Viewer} from '../lib/access.ts';
import {canEdit,resolveAccess} from '../lib/access.ts';
import {MODULES,MODULE_KEYS,validateControl,validDate,csvCell,controlReview,score} from '../lib/management-domain.ts';
import type {Module,ControlRecord,ControlInput,RecordDetail} from '../lib/management-domain.ts';
import {readManagement,mutateManagement,addEvidence,downloadEvidence,validateEvidence} from '../lib/management-store.ts';

const details=(module:Module)=>Object.fromEntries(MODULES[module].fields.map(f=>[f.key,f.type==='select'?f.options![0]:f.type==='date'?'2026-11-01':f.type==='number'?'0':'Synthetic development evidence for '+f.key]));
const base=(module:Module,extra:Record<string,unknown>={})=>({module,title:'Development control verification',description:'Synthetic test record only',unitId:'unit',category:MODULES[module].categories[0],priority:'high',ownerEmail:'owner@example.test',reviewerEmail:'reviewer@example.test',dueDate:'2026-11-02',details:details(module),licenseId:'',relatedId:'',...extra});
test('control forms validate dates, bounded amounts, enums and risk scores',()=>{
 for(const module of MODULE_KEYS)assert.equal(validateControl(base(module)).module,module);
 for(const date of ['2026-02-30','2026-99-01','not-a-date'])assert.throws(()=>validDate(date,'Due date'),/valid/);
 assert.equal(validDate('','Optional'), '');assert.throws(()=>validateControl(base('exception',{priority:'urgent'})),/priority/);
 assert.throws(()=>validateControl(base('change',{details:{...details('change'),plannedEnd:'2026-10-01'}})),/end date/);
 assert.throws(()=>validateControl(base('incident',{details:{...details('incident'),loss:'-1'}})),/non-negative/);
 assert.throws(()=>validateControl(base('risk',{details:{...details('risk'),likelihood:'6'}})),/valid/);
 assert.equal(score({likelihood:'4',impact:'5'}),20);assert.equal(score({likelihood:'0',impact:'5'}),null);
 assert.equal(controlReview('reviewer'),true);assert.equal(canEdit('reviewer'),false);
});
test('evidence checks content and CSV exports neutralize spreadsheet formulas',()=>{
 assert.equal(validateEvidence('../support.txt',Buffer.from('Real plain text')).name,'support.txt');
 assert.throws(()=>validateEvidence('report.pdf',Buffer.from('<html>not a PDF</html>')),/does not match/);
 assert.throws(()=>validateEvidence('page.html',Buffer.from('<html>')),/Use PDF/);
 assert.throws(()=>validateEvidence('support.txt',Buffer.from([0,1,2])),/does not match/);
 assert.throws(()=>validateEvidence('large.txt',Buffer.alloc(5*1024*1024+1)),/5 MB/);
 assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell(' @sum(A1)'), '"\' @sum(A1)"');
});
test('PostgreSQL portal: independent decisions, evidence, concurrent saves, links, archive and reporting',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {db,close}=createDatabase(process.env.TEST_DATABASE_URL!),suffix=crypto.randomUUID().slice(0,8),stamp=new Date().toISOString();
 const person=(name:string,role:Viewer['role']):Viewer=>({userId:'portal-test-'+name+'-'+suffix,email:'portal-'+name+'-'+suffix+'@example.test',displayName:'Portal QA '+name,role});
 const admin=person('admin','admin'),editor=person('editor','editor'),reviewer=person('reviewer','reviewer'),viewer=person('viewer','viewer');
 const request=(action:string,data:Record<string,unknown>={})=>({action,requestId:crypto.randomUUID(),...data});
 const createdIds:string[]=[];
 async function detail(id:string){return await readManagement(db,editor,new URLSearchParams({kind:'detail',id})) as RecordDetail}
 async function current(id:string){return (await detail(id)).record}
 async function step(id:string,to:string,who=editor){const r=await current(id);return mutateManagement(db,who,request('transition',{id,version:r.version,to,note:'Synthetic reviewed decision'}))}
 async function attach(id:string){const r=await current(id);return addEvidence(db,editor,{id,version:r.version,requestId:crypto.randomUUID(),name:'development-evidence.txt'},Buffer.from('Synthetic development evidence. No production data.'))}
 async function create(module:Module,extra:Record<string,unknown>={},who=editor){const result=await mutateManagement(db,who,request('create',base(module,{unitId,ownerEmail:editor.email,reviewerEmail:reviewer.email,...extra})));createdIds.push(result.id);return result.id as string}
 let unitId='';
 try{
  for(const p of [admin,editor,reviewer,viewer])await db.prepare('INSERT INTO workspace_users(id,email,name,role,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),p.email,p.displayName,p.role,'active',admin.email,stamp,stamp).run();
  assert.equal((await resolveAccess(db,{id:reviewer.userId,email:reviewer.email,emailVerified:true})).role,'reviewer');
  await assert.rejects(mutateManagement(db,viewer,request('create',base('action'))),/access is required/);
  await assert.rejects(mutateManagement(db,editor,request('unitCreate',{name:'Forbidden unit',area:'it'})),/admin/);
  unitId=(await mutateManagement(db,admin,request('unitCreate',{name:'Portal QA unit '+suffix,area:'it'}))).id;
  await assert.rejects(mutateManagement(db,admin,request('unitCreate',{name:'Portal QA unit '+suffix,area:'it'})),/already exists/);
  const createRequest=request('create',base('exception',{unitId,ownerEmail:editor.email,reviewerEmail:reviewer.email}));
  const first=await mutateManagement(db,editor,createRequest);createdIds.push(first.id);assert.deepEqual(await mutateManagement(db,editor,createRequest),first);
  await assert.rejects(mutateManagement(db,editor,{...createRequest,title:'Different payload'}),/different change/);
  const exception=first.id as string;
  await assert.rejects(create('action',{reviewerEmail:editor.email}),/different/);
  let r=await current(exception);
  const edits=await Promise.allSettled(['First concurrent change','Second concurrent change'].map(title=>mutateManagement(db,editor,request('update',{...r,title,id:r.id,version:r.version}))));
  assert.equal(edits.filter(e=>e.status==='fulfilled').length,1);assert.equal(edits.filter(e=>e.status==='rejected').length,1);
  await step(exception,'in_progress');await assert.rejects(step(exception,'closed',reviewer),/not available/);
  await assert.rejects(step(exception,'pending_review'),/supporting evidence/);await attach(exception);await step(exception,'pending_review');
  await assert.rejects(step(exception,'closed',editor),/reviewer or admin/);
  await assert.rejects(step(exception,'closed',admin),/assigned/);
  await step(exception,'closed',reviewer);
  r=await current(exception);await assert.rejects(mutateManagement(db,editor,request('update',{...r,title:'Closed overwrite',version:r.version})),/Reopen/);
  await mutateManagement(db,admin,request('archive',{id:r.id,version:r.version,note:'Synthetic archive verification'}));
  r=await current(exception);assert.ok(r.archivedAt);await mutateManagement(db,admin,request('restore',{id:r.id,version:r.version}));assert.equal((await current(exception)).archivedAt,null);
  await step(exception,'open',reviewer);
  const file=(await detail(exception)).evidence[0];assert.equal((await downloadEvidence(db,file.id)).content.toString(),'Synthetic development evidence. No production data.');
  await assert.rejects(db.prepare('UPDATE portal_events SET note=? WHERE record_id=?').bind('tamper',exception).run(),/append-only/);
  await assert.rejects(db.prepare('DELETE FROM portal_evidence WHERE id=?').bind(file.id).run(),/append-only/);

  const change=await create('change');await step(change,'submitted');
  r=await current(change);await assert.rejects(mutateManagement(db,editor,request('update',{...r,title:'Unapproved scope change'})),/scope/);
  await step(change,'approved',reviewer);await step(change,'scheduled');await step(change,'in_progress');await step(change,'implemented');
  await assert.rejects(step(change,'closed',reviewer),/supporting evidence/);await attach(change);await step(change,'closed',reviewer);
  // Even a control reviewer cannot approve a change they created.
  const self=await create('change',{ownerEmail:editor.email,reviewerEmail:admin.email},reviewer);await step(self,'submitted');await assert.rejects(step(self,'approved',reviewer),/own work/);

  const control=await create('control');await step(control,'active',reviewer);const check=await create('check',{relatedId:control,details:{...details('check'),result:'Effective'}});
  await assert.rejects(step(control,'retired',reviewer),/open linked/);await step(check,'in_progress');await attach(check);await step(check,'pending_review');await step(check,'closed',reviewer);await step(control,'retired',reviewer);
  const a=await create('action'),b=await create('action',{relatedId:a});r=await current(a);await assert.rejects(mutateManagement(db,editor,request('update',{...r,relatedId:b})),/cycle/);
  await step(a,'in_progress');await attach(a);await step(a,'pending_review');await assert.rejects(step(a,'closed',reviewer),/open linked/);

  const risk=await create('risk');await step(risk,'assessing');await step(risk,'treatment');await step(risk,'monitoring',reviewer);await attach(risk);await step(risk,'closed',reviewer);
  const incident=await create('incident');await step(incident,'in_progress');await attach(incident);await step(incident,'resolved');await step(incident,'closed',reviewer);
  const finding=await create('finding');await step(finding,'in_progress');await attach(finding);await step(finding,'pending_review');await step(finding,'closed',reviewer);
  const suspended=await create('action');await step(suspended,'in_progress');await attach(suspended);await db.prepare("UPDATE workspace_users SET status='suspended' WHERE email=?").bind(reviewer.email).run();await assert.rejects(step(suspended,'pending_review'),/no longer available/);await db.prepare("UPDATE workspace_users SET status='active' WHERE email=?").bind(reviewer.email).run();

  const filter=new URLSearchParams({kind:'records',module:'all',unit:unitId});const records=await readManagement(db,viewer,filter) as any;assert.ok(records.total>=10);assert.ok(records.records.every((item:ControlRecord)=>item.unitId===unitId));
  const report=await readManagement(db,admin,new URLSearchParams({kind:'reports',module:'all',unit:unitId})) as any;assert.equal(report.summary.total,records.total);assert.ok(report.summary.closed>=5);
  const exported=await readManagement(db,viewer,new URLSearchParams({kind:'export',module:'all',unit:unitId})) as any;assert.equal(exported.count,records.total);assert.match(exported.csv,/Reference/);assert.match(exported.csv,/CHG-/);
  const history=await detail(change);assert.equal(history.record.status,'closed');assert.ok(history.events.some(e=>e.action==='status_changed'&&e.actor===reviewer.email));
  console.log('Portal workflows verified against the isolated development database. No email was sent.');
 }finally{
  if(createdIds.length)await db.prepare('UPDATE portal_records SET archived_at=? WHERE created_by IN (?,?,?)').bind(new Date().toISOString(),admin.email,editor.email,reviewer.email).run();
  await db.prepare("UPDATE workspace_users SET status='suspended' WHERE email IN (?,?,?,?)").bind(admin.email,editor.email,reviewer.email,viewer.email).run();
  if(unitId)await db.prepare("UPDATE portal_units SET status='inactive' WHERE id=?").bind(unitId).run();await close();
 }
});
