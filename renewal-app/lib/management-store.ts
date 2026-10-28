import {createHash} from 'node:crypto';
import type {Database} from './database.ts';
import type {Viewer} from './access.ts';
import {canManage} from './access.ts';
import {AREAS,MODULES,MODULE_KEYS,PRIORITIES,controlEdit,controlReview,parseModule,problem,terminal,textValue,transitions,transitionRequirements,validateControl,csvCell} from './management-domain.ts';
import type {Area,Contact,ControlInput,ControlRecord,ControlEvent,Evidence,Unit} from './management-domain.ts';

type Row=Record<string,any>;
const now=()=>new Date().toISOString();
const today=()=>now().slice(0,10);
const one=async(db:Database,sql:string,...values:unknown[])=>db.prepare(sql).bind(...values).first<Row>();
const rows=async(db:Database,sql:string,...values:unknown[])=> (await db.prepare(sql).bind(...values).all<Row>()).results;
const run=async(db:Database,sql:string,...values:unknown[])=>db.prepare(sql).bind(...values).run();
const base='SELECT p.*,u.name AS unit_name,r.reference AS related_reference FROM portal_records p JOIN portal_units u ON u.id=p.unit_id LEFT JOIN portal_records r ON r.id=p.related_id';
export function mapRecord(r:Row):ControlRecord{return {id:r.id,reference:r.reference,module:r.module,title:r.title,description:r.description,area:r.area,unitId:r.unit_id,unitName:r.unit_name||'',category:r.category,priority:r.priority,status:r.status,ownerEmail:r.owner_email,reviewerEmail:r.reviewer_email,dueDate:r.due_date,details:r.details,licenseId:r.license_id||'',relatedId:r.related_id||'',relatedReference:r.related_reference||'',version:r.version,createdBy:r.created_by,updatedBy:r.updated_by,createdAt:r.created_at,updatedAt:r.updated_at,archivedAt:r.archived_at}}
const eventMap=(r:Row):ControlEvent=>({id:r.id,recordId:r.record_id,reference:r.reference,action:r.action,note:r.note,actor:r.actor,createdAt:r.created_at,before:r.before,after:r.after});
const evidenceMap=(r:Row):Evidence=>({id:r.id,name:r.name,mime:r.mime,size:r.size,sha256:r.sha256,uploadedBy:r.uploaded_by,createdAt:r.created_at});
async function record(db:Database,id:string,lock=false){const r=await one(db,base+' WHERE p.id=?'+(lock?' FOR UPDATE OF p':''),id);if(!r)problem('This record could not be found.',404);return mapRecord(r)}
function writeAccess(v:Viewer){if(!controlEdit(v.role))problem('Editor or control reviewer access is required.',403)}
function reviewAccess(v:Viewer,r:ControlRecord){if(!controlReview(v.role))problem('A control reviewer or admin must make this decision.',403);if([r.createdBy,r.ownerEmail].includes(v.email))problem('The creator and owner cannot review their own work. Ask an independent reviewer.',403);if(r.reviewerEmail!==v.email)problem('This decision is assigned to '+(r.reviewerEmail||'an independent reviewer')+'.',403)}
function currentVersion(body:Row,version:number){if(!Number.isSafeInteger(body.version)||body.version!==version)problem('Someone changed this record. Reload it and review the latest version before saving.',409)}
async function event(db:Database,v:Viewer,recordId:string|null,action:string,note:string,before:unknown=null,after:unknown=null){await run(db,'INSERT INTO portal_events(id,record_id,action,note,actor,"before","after",created_at) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),recordId,action,note,v.email,before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after),now())}
async function contacts(db:Database):Promise<Contact[]>{return (await rows(db,"SELECT email,name,role FROM workspace_users WHERE status='active' ORDER BY name,email")).map(r=>({email:r.email,name:r.name,role:r.role}))}
async function validateAssignments(db:Database,input:ControlInput,creator:string,existing?:ControlRecord){
 const unit=await one(db,"SELECT * FROM portal_units WHERE id=? AND status='active' FOR SHARE",input.unitId);if(!unit)problem('Choose an active team or branch. An admin can add it under Teams & branches.');
 const people=await contacts(db),owner=people.find(p=>p.email===input.ownerEmail);if(!owner||!controlEdit(owner.role))problem('Choose an active owner with editor or reviewer access.');
 if(input.reviewerEmail){const reviewer=people.find(p=>p.email===input.reviewerEmail);if(!reviewer||!controlReview(reviewer.role))problem('Choose an active control reviewer or admin.');if([creator,input.ownerEmail].includes(input.reviewerEmail))problem('Choose a reviewer who is different from both the creator and owner.')}
 if(input.licenseId&&!await one(db,'SELECT id FROM licenses WHERE id=? AND archived_at IS NULL',input.licenseId))problem('The linked license is unavailable.');
 if(input.relatedId){const parent=await record(db,input.relatedId,true);if(parent.archivedAt)problem('The related record is archived.');if(terminal(parent.status)&&existing?.relatedId!==parent.id)problem('Reopen the parent record before linking new work.');if(existing){const cycle=await one(db,'WITH RECURSIVE parents AS (SELECT id,related_id FROM portal_records WHERE id=? UNION SELECT p.id,p.related_id FROM portal_records p JOIN parents x ON p.id=x.related_id) SELECT id FROM parents WHERE id=? LIMIT 1',input.relatedId,existing.id);if(cycle)problem('This link would create a cycle. Choose another related record.')}if(input.module==='check'&&(parent.module!=='control'||(parent.status!=='active'&&existing?.relatedId!==parent.id)))problem('A control check must link to an active control.')}
 else if(input.module==='check')problem('Link this check to an active control.');
 return unit;
}
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
async function mutateOnce(db:Database,v:Viewer,body:Row,work:(tx:Database)=>Promise<Row>){
 const id=textValue(body.requestId,'Request reference',80,true);if(!/^[\w-]{16,80}$/.test(id))problem('Start a new request and try again.');
 const fingerprint=hash(body);
 return db.transaction(async tx=>{
  await one(tx,'SELECT pg_advisory_xact_lock(hashtextextended(?,0))',id);
  const prior=await one(tx,'SELECT * FROM portal_receipts WHERE id=?',id);
  if(prior){if(prior.actor!==v.email||prior.action!==body.action||prior.payload_hash!==fingerprint)problem('This request reference was already used for a different change.',409);return prior.result}
  const result=await work(tx);
  await run(tx,'INSERT INTO portal_receipts(id,actor,action,payload_hash,result,created_at) VALUES(?,?,?,?,?,?)',id,v.email,body.action,fingerprint,JSON.stringify(result),now());return result;
 });
}
export async function mutateManagement(db:Database,v:Viewer,body:Row){
 writeAccess(v);
 return mutateOnce(db,v,body,async tx=>{
  if(['unitCreate','unitUpdate'].includes(body.action)){
   if(!canManage(v.role))problem('An admin must manage teams and branches.',403);
   const name=textValue(body.name,'Team or branch name',100,true),area=String(body.area) as Area,status=String(body.status||'active');if(!Object.hasOwn(AREAS,area)||!['active','inactive'].includes(status))problem('Choose a valid area and status.');
   await one(tx,'SELECT pg_advisory_xact_lock(hashtextextended(?,0))','unit:'+area+':'+name.toLowerCase());
   const duplicate=await one(tx,'SELECT id FROM portal_units WHERE lower(name)=lower(?) AND area=? AND id<>?',name,area,String(body.id||''));if(duplicate)problem('This team or branch already exists.');
   const id=body.action==='unitCreate'?crypto.randomUUID():textValue(body.id,'Team or branch',80,true),stamp=now();let before:Row|null=null;
   if(body.action==='unitUpdate'){before=await one(tx,'SELECT * FROM portal_units WHERE id=? FOR UPDATE',id);if(!before)problem('This team or branch was not found.',404);currentVersion(body,before.version);if(before.area!==area&&await one(tx,'SELECT id FROM portal_records WHERE unit_id=? LIMIT 1',id))problem('The area is fixed once records exist. Create a separate team for the new area.');await run(tx,'UPDATE portal_units SET name=?,area=?,status=?,version=version+1,updated_at=? WHERE id=?',name,area,status,stamp,id)}
   else await run(tx,'INSERT INTO portal_units(id,name,area,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,name,area,status,v.email,stamp,stamp);
   await event(tx,v,null,body.action,name,before,{id,name,area,status});return {ok:true,id,message:'Team or branch saved.'};
  }
  if(body.action==='create'){
   const input=validateControl(body),unit=await validateAssignments(tx,input,v.email),id=crypto.randomUUID(),stamp=now(),key=MODULES[input.module].prefix+'-'+stamp.slice(0,4);
   const counter=(await one(tx,'INSERT INTO portal_counters(id,value) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET value=portal_counters.value+1 RETURNING value',key))!;
   const reference=key+'-'+String(counter.value).padStart(5,'0');
   await run(tx,`INSERT INTO portal_records(id,reference,module,title,description,unit_id,area,category,priority,status,owner_email,reviewer_email,due_date,details,license_id,related_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,reference,input.module,input.title,input.description,input.unitId,unit.area,input.category,input.priority,MODULES[input.module].initial,input.ownerEmail,input.reviewerEmail,input.dueDate,JSON.stringify(input.details),input.licenseId||null,input.relatedId||null,v.email,v.email,stamp,stamp);
   const created=await record(tx,id);await event(tx,v,id,'created','Created '+reference,null,created);return {ok:true,id,message:reference+' created.'};
  }
  const id=textValue(body.id,'Record reference',80,true),before=await record(tx,id,true);currentVersion(body,before.version);
  if(body.action==='restore'){
   if(!canManage(v.role))problem('An admin must restore archived records.',403);if(!before.archivedAt)problem('This record is already active.');
   await run(tx,'UPDATE portal_records SET archived_at=NULL,version=version+1,updated_by=?,updated_at=? WHERE id=?',v.email,now(),id);
  }else{
   if(before.archivedAt)problem('This record is archived. Ask an admin to restore it.');
   if(body.action==='update'){
    if(terminal(before.status))problem('Reopen this record before editing it.');
    const input=validateControl(body);if(input.module!==before.module)problem('The work area cannot be changed.');if(input.relatedId===id)problem('A record cannot be linked to itself.');
    // A submitted or approved change cannot have its approved scope silently rewritten.
    if(before.module==='change'&&!['draft','rejected'].includes(before.status)){
     const locked=['title','description','unitId','category','priority','ownerEmail','reviewerEmail','dueDate','licenseId','relatedId'] as const;
     if(locked.some(k=>input[k]!==before[k])||Object.keys(input.details).some(k=>!['outcome','postReview'].includes(k)&&input.details[k]!==before.details[k]))problem('Return this change to draft before changing its scope, plans or assignments. Only outcome and review notes can be updated after submission.');
    }
    const unit=await validateAssignments(tx,input,before.createdBy,before);
    const status=before.module==='control'&&before.status==='active'?'draft':before.status==='pending_review'?'in_progress':before.status==='resolved'?'in_progress':before.status;
    await run(tx,'UPDATE portal_records SET title=?,description=?,unit_id=?,area=?,category=?,priority=?,owner_email=?,reviewer_email=?,due_date=?,details=?,license_id=?,related_id=?,status=?,version=version+1,updated_by=?,updated_at=? WHERE id=?',input.title,input.description,input.unitId,unit.area,input.category,input.priority,input.ownerEmail,input.reviewerEmail,input.dueDate,JSON.stringify(input.details),input.licenseId||null,input.relatedId||null,status,v.email,now(),id);
   }else if(body.action==='transition'){
    const to=textValue(body.to,'Next status',40,true),step=transitions(before).find(x=>x.to===to);if(!step)problem('This status change is not available.');
    const note=textValue(body.note,'Decision or progress note',4000,true);if(step.review)reviewAccess(v,before);
    if(['submitted','pending_review','resolved','monitoring'].includes(to)||step.review){if(!before.reviewerEmail)problem('Assign an independent reviewer first.');const reviewer=await one(tx,"SELECT role,status FROM workspace_users WHERE email=?",before.reviewerEmail);if(!reviewer||reviewer.status!=='active'||!controlReview(reviewer.role))problem('The assigned reviewer is no longer available. Choose another reviewer.');}
    transitionRequirements(before,to);
    if(['pending_review','resolved','closed'].includes(to)&&before.module!=='control'){
     const count=await one(tx,'SELECT COUNT(*) AS n FROM portal_evidence WHERE record_id=?',id);if(!count?.n)problem('Attach supporting evidence before submitting or closing this record.');
    }
    if(['closed','retired'].includes(to)){
     const open=await one(tx,"SELECT COUNT(*) AS n FROM portal_records WHERE related_id=? AND status NOT IN ('closed','retired') AND archived_at IS NULL",id);if(open?.n)problem('Resolve the '+open.n+' open linked record(s) before closing this record.');
    }
    await run(tx,'UPDATE portal_records SET status=?,version=version+1,updated_by=?,updated_at=? WHERE id=?',to,v.email,now(),id);const after=await record(tx,id);await event(tx,v,id,'status_changed',note,before,after);return {ok:true,id,message:before.reference+': '+to.replaceAll('_',' ')+'.'};
   }else if(body.action==='comment'){
    const note=textValue(body.note,'Comment',4000,true);await run(tx,'UPDATE portal_records SET version=version+1,updated_by=?,updated_at=? WHERE id=?',v.email,now(),id);await event(tx,v,id,'comment',note);return {ok:true,id,message:'Comment added.'};
   }else if(body.action==='archive'){
    if(!canManage(v.role))problem('An admin must archive records.',403);if(!terminal(before.status))problem('Close or retire the record before archiving it.');const note=textValue(body.note,'Archive reason',1000,true);await run(tx,'UPDATE portal_records SET archived_at=?,version=version+1,updated_by=?,updated_at=? WHERE id=?',now(),v.email,now(),id);await event(tx,v,id,'archived',note,before,await record(tx,id));return {ok:true,id,message:'Record archived. Its evidence and history have been kept.'};
   }else problem('This action is not supported.');
  }
  await event(tx,v,id,body.action==='update'?'updated':'restored',body.action==='update'?'Record updated. Any pending review must be submitted again.':'Record restored.',before,await record(tx,id));return {ok:true,id,message:body.action==='update'?'Record updated.':'Record restored.'};
 });
}
function filters(params:URLSearchParams,allowAll=false){
 const where=['1=1'],values:unknown[]=[];const add=(sql:string,v:unknown)=>{where.push(sql);values.push(v)};
 const module=params.get('module');if(module&&module!=='all')add('p.module=?',parseModule(module));else if(!allowAll)problem('Choose a work area.');
 const area=params.get('area');if(area&&area!=='all'){if(!Object.hasOwn(AREAS,area))problem('Choose a valid area.');add('p.area=?',area)}
 const unit=params.get('unit');if(unit&&unit!=='all')add('p.unit_id=?',textValue(unit,'Team',80));
 const state=params.get('status');if(state&&state!=='all'){if(state==='open')where.push("p.status NOT IN ('closed','retired')");else add('p.status=?',textValue(state,'Status',40))}
 const priority=params.get('priority');if(priority&&priority!=='all'){if(!PRIORITIES.includes(priority as any))problem('Choose a valid priority.');add('p.priority=?',priority)}
 const owner=params.get('owner');if(owner&&owner!=='all')add('p.owner_email=?',textValue(owner,'Owner',254));
 const q=textValue(params.get('q'),'Search',180);if(q){const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';where.push("(p.title ILIKE ? OR p.reference ILIKE ? OR p.description ILIKE ?)");values.push(pattern,pattern,pattern)}
 for(const [key,op] of [['from','>='],['to','<=']]){const value=params.get(key);if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))problem('Choose a valid report date.');add('p.due_date'+op+'?',value)}}
 if(params.get('overdue')==='true'){where.push("p.status NOT IN ('closed','retired')");add('p.due_date<?',today())}
 where.push(params.get('archived')==='true'?'p.archived_at IS NOT NULL':'p.archived_at IS NULL');return {where:where.join(' AND '),values};
}
export async function readManagement(db:Database,v:Viewer,params:URLSearchParams){
 const kind=params.get('kind')||'bootstrap';
 if(kind==='bootstrap'){
  const units=(await rows(db,'SELECT id,name,area,status,version FROM portal_units ORDER BY area,name')) as Unit[];
  return {units,contacts:await contacts(db),permissions:{edit:controlEdit(v.role),review:controlReview(v.role),manage:canManage(v.role)}};
 }
 if(kind==='records'||kind==='export'){
  const f=filters(params,true),count=(await one(db,'SELECT COUNT(*) AS n FROM portal_records p WHERE '+f.where,...f.values))!.n;
  if(kind==='export'){
   if(count>10000)problem('Narrow the report filters to export at most 10,000 records.');
   const items=(await rows(db,base+' WHERE '+f.where+' ORDER BY p.module,p.due_date,p.reference LIMIT 10000',...f.values)).map(mapRecord);
   const header=['Reference','Work area','Title','Area','Team / branch','Category','Priority','Status','Owner','Reviewer','Due / review date','Linked license ID','Related record','Created by','Created at','Updated at','Details'];
   return {csv:'\uFEFF'+[header,...items.map(r=>[r.reference,MODULES[r.module].name,r.title,AREAS[r.area],r.unitName,r.category,r.priority,r.status,r.ownerEmail,r.reviewerEmail,r.dueDate,r.licenseId,r.relatedReference,r.createdBy,r.createdAt,r.updatedAt,JSON.stringify(r.details)])].map(row=>row.map(csvCell).join(',')).join('\r\n'),count};
  }
  const size=20,page=Math.max(1,Math.min(100000,Number(params.get('page'))||1));if(!Number.isInteger(page))problem('Choose a valid page.');
  return {records:(await rows(db,base+' WHERE '+f.where+" ORDER BY CASE p.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,p.due_date,p.reference LIMIT ? OFFSET ?",...f.values,size,(page-1)*size)).map(mapRecord),total:count,page,size};
 }
 if(kind==='detail'){
  const id=textValue(params.get('id'),'Record reference',80,true),r=await record(db,id),offset=Math.max(0,Math.min(100000,Number(params.get('offset'))||0));if(!Number.isInteger(offset))problem('Choose a valid history page.');
  const [events,evidence,children,total,childTotal]=await Promise.all([rows(db,'SELECT * FROM portal_events WHERE record_id=? ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?',id,offset),rows(db,'SELECT id,name,mime,size,sha256,uploaded_by,created_at FROM portal_evidence WHERE record_id=? ORDER BY created_at DESC',id),rows(db,base+' WHERE p.related_id=? ORDER BY p.created_at DESC LIMIT 50',id),one(db,'SELECT COUNT(*) AS n FROM portal_events WHERE record_id=?',id),one(db,'SELECT COUNT(*) AS n FROM portal_records WHERE related_id=?',id)]);
  return {record:r,events:events.map(eventMap),eventTotal:total!.n,evidence:evidence.map(evidenceMap),children:children.map(mapRecord),childTotal:childTotal!.n};
 }
 if(kind==='dashboard'||kind==='reports'){
  const f=filters(params,true),where=f.where,values=f.values;
  const [summary,byModule,byArea,work,review,events,license]=await Promise.all([
   one(db,`SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE p.status NOT IN ('closed','retired')) AS open,COUNT(*) FILTER(WHERE p.status NOT IN ('closed','retired') AND p.due_date<?) AS overdue,COUNT(*) FILTER(WHERE p.status NOT IN ('closed','retired') AND p.priority IN ('high','critical')) AS high,COUNT(*) FILTER(WHERE (p.status IN ('submitted','pending_review','implemented','resolved') OR (p.module='control' AND p.status='draft') OR (p.module='risk' AND p.status='treatment'))) AS review,COUNT(*) FILTER(WHERE p.owner_email=? AND p.status NOT IN ('closed','retired')) AS mine,COUNT(*) FILTER(WHERE p.status='closed') AS closed FROM portal_records p WHERE `+where,today(),v.email,...values),
   rows(db,"SELECT p.module,COUNT(*) AS total,COUNT(*) FILTER(WHERE p.status NOT IN ('closed','retired')) AS open,COUNT(*) FILTER(WHERE p.status NOT IN ('closed','retired') AND p.due_date<?) AS overdue FROM portal_records p WHERE "+where+' GROUP BY p.module',today(),...values),
   rows(db,"SELECT p.area,COUNT(*) AS total,COUNT(*) FILTER(WHERE p.status NOT IN ('closed','retired')) AS open,COUNT(*) FILTER(WHERE p.status NOT IN ('closed','retired') AND p.due_date<?) AS overdue FROM portal_records p WHERE "+where+' GROUP BY p.area',today(),...values),
   rows(db,base+" WHERE "+where+" AND p.status NOT IN ('closed','retired') ORDER BY CASE WHEN p.owner_email=? THEN 0 ELSE 1 END,p.due_date,p.reference LIMIT 8",...values,v.email),
   rows(db,base+" WHERE "+where+" AND p.reviewer_email=? AND p.created_by<>? AND p.owner_email<>? AND (p.status IN ('submitted','pending_review','implemented','resolved') OR (p.module='control' AND p.status='draft') OR (p.module='risk' AND p.status='treatment')) ORDER BY p.due_date LIMIT 8",...values,v.email,v.email,v.email),
   rows(db,'SELECT e.id,e.record_id,e.action,e.note,e.actor,e.created_at,p.reference FROM portal_events e LEFT JOIN portal_records p ON p.id=e.record_id ORDER BY e.created_at DESC LIMIT 8'),
   one(db,"SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE expiry_date<? AND lower(status) NOT IN ('retired','cancelled','canceled','inactive','suspended')) AS overdue,COUNT(*) FILTER(WHERE expiry_date>=? AND expiry_date<=? AND lower(status) NOT IN ('retired','cancelled','canceled','inactive','suspended')) AS due FROM licenses WHERE archived_at IS NULL",today(),today(),new Date(Date.now()+60*86400000).toISOString().slice(0,10))
  ]);
  return {summary,byModule,byArea,work:work.map(mapRecord),review:review.map(mapRecord),events:events.map(eventMap),licenses:license,today:today()};
 }
 problem('This view is not available.');
}

export const MAX_EVIDENCE=5*1024*1024;
export function validateEvidence(name:string,bytes:Buffer){
 if(!bytes.length||bytes.length>MAX_EVIDENCE)problem('Choose a non-empty evidence file no larger than 5 MB.',413);
 const safe=name.replace(/^.*[\\/]/,'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,150),ext=safe.split('.').pop()?.toLowerCase(),head=bytes.subarray(0,8);
 const types:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 if(!ext||!types[ext])problem('Use PDF, PNG, JPG, TXT, CSV, DOCX or XLSX evidence.');
 const valid=ext==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':ext==='png'?head.equals(Buffer.from([137,80,78,71,13,10,26,10])):['jpg','jpeg'].includes(ext)?head[0]===255&&head[1]===216&&head[2]===255:['docx','xlsx'].includes(ext)?head[0]===80&&head[1]===75&&head[2]===3&&head[3]===4:!bytes.includes(0)&&!bytes.toString('utf8').includes('\uFFFD');
 if(!valid)problem('The file content does not match its file type.');return {name:safe,mime:types[ext],sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function addEvidence(db:Database,v:Viewer,body:Row,bytes:Buffer){
 writeAccess(v);const file=validateEvidence(textValue(body.name,'File name',200,true),bytes);
 return mutateOnce(db,v,{...body,action:'evidence',sha256:file.sha256},async tx=>{
  const r=await record(tx,textValue(body.id,'Record',80,true),true);currentVersion(body,r.version);if(r.archivedAt||terminal(r.status))problem('Reopen or restore the record before attaching new evidence.');
  await one(tx,"SELECT pg_advisory_xact_lock(hashtextextended('icdd-evidence-capacity',0))");
  const usage=(await one(tx,'SELECT COALESCE(SUM(size),0) AS size,COUNT(*) FILTER(WHERE record_id=?) AS count FROM portal_evidence',r.id))!;
  if(usage.count>=20)problem('This record has reached its limit of 20 evidence files.');if(Number(usage.size)+bytes.length>200*1024*1024)problem('Evidence storage has reached its 200 MB limit. Ask the workspace owner to review storage.');
  const id=crypto.randomUUID(),stamp=now();await run(tx,'INSERT INTO portal_evidence(id,record_id,name,mime,size,sha256,content,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,r.id,file.name,file.mime,bytes.length,file.sha256,bytes,v.email,stamp);
  await run(tx,'UPDATE portal_records SET version=version+1,updated_by=?,updated_at=? WHERE id=?',v.email,stamp,r.id);await event(tx,v,r.id,'evidence_added','Attached '+file.name,null,{id,name:file.name,size:bytes.length,sha256:file.sha256});return {ok:true,id:r.id,message:'Evidence attached.'};
 });
}
export async function downloadEvidence(db:Database,id:string){const file=await one(db,'SELECT * FROM portal_evidence WHERE id=?',textValue(id,'Evidence reference',80,true));if(!file)problem('This evidence file could not be found.',404);return file}
