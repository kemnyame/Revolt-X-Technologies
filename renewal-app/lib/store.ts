import { InputError, validateLicense, matchKey, DEFAULT_LEAD_DAYS, parseDate, moneyMinor, emailValid, recipientsInput, leadDaysInput, todayUTC, displayMoney } from './domain.ts';
import type { License, LicenseInput, Settings } from './domain.ts';
import { encryptSecret } from './secrets.ts';
import type {Database,Statement} from './database.ts';
export type Viewer={userId:string;email:string;displayName:string};
export type Row=Record<string,any>;
export const iso=()=>new Date().toISOString();
export const all=async(db:Database,sql:string,...values:any[])=>((await db.prepare(sql).bind(...values).all<Row>()).results||[]);
export const one=async(db:Database,sql:string,...values:any[])=>db.prepare(sql).bind(...values).first<Row>();
export function toLicense(r:Row):License{return {id:r.id,sn:r.sn,name:r.name,vendor:r.vendor,licenseType:r.license_type,department:r.department,purchaseDate:r.purchase_date,expiryDate:r.expiry_date,quantityPurchased:r.quantity_purchased,seatCount:r.seat_count,quantityInUse:r.quantity_in_use,status:r.status,lastPaymentDate:r.last_payment_date,lastPaymentMinor:r.last_payment_minor,notes:r.notes,createdAt:r.created_at,updatedAt:r.updated_at,archivedAt:r.archived_at}}
export async function initialize(db:Database,viewer?:Viewer){
 await db.prepare(`INSERT INTO settings (id,owner_id,sender_name,sender_email,reply_to,recipients,lead_days,lead_months,overdue_interval,enabled,schedule_registered,updated_at) VALUES(1,?,?,?,?,?,?,2,7,0,0,?) ON CONFLICT (id) DO NOTHING`).bind(viewer?.userId||'','ICDD License Renewal Tracker','','','[]',JSON.stringify(DEFAULT_LEAD_DAYS),iso()).run();
 if(viewer){await db.prepare("UPDATE settings SET owner_id=? WHERE id=1 AND owner_id=''").bind(viewer.userId).run();const s=await one(db,'SELECT owner_id FROM settings WHERE id=1');if(s?.owner_id!==viewer.userId){const e=new InputError('This tracker is restricted to its owner.');e.status=403;throw e}}
}
export function safeSettings(r:Row):Settings&{lastTestAt:string|null}{return {senderName:r.sender_name,senderEmail:r.sender_email,replyTo:r.reply_to,recipients:JSON.parse(r.recipients),leadDays:JSON.parse(r.lead_days),leadMonths:r.lead_months??2,overdueInterval:r.overdue_interval,enabled:!!r.enabled,apiKeySet:!!r.encrypted_api_key,jobLastChecked:r.job_last_checked,jobLastResult:r.job_last_result,scheduleRegistered:!!r.schedule_registered,lastTestAt:r.last_test_at}}
export async function getState(db:Database,viewer:Viewer){
 await initialize(db,viewer);
 const [records,renewals,activity,emails,settings]=await Promise.all([all(db,'SELECT * FROM licenses ORDER BY created_at DESC LIMIT 5000'),all(db,'SELECT r.*,l.name FROM renewals r JOIN licenses l ON l.id=r.license_id ORDER BY r.created_at DESC LIMIT 500'),all(db,'SELECT * FROM activity ORDER BY created_at DESC LIMIT 250'),all(db,'SELECT id,recipient,subject,status,provider_id,error,attempts,created_at,updated_at FROM email_log ORDER BY created_at DESC LIMIT 100'),one(db,'SELECT * FROM settings WHERE id=1')]);
 return {licenses:records.map(toLicense),renewals,activity,emails,settings:safeSettings(settings!),viewer:{displayName:viewer.displayName,email:viewer.email},today:todayUTC()};
}
const columns=['id','sn','name','vendor','license_type','department','purchase_date','expiry_date','quantity_purchased','seat_count','quantity_in_use','status','last_payment_date','last_payment_minor','notes','match_key','created_at','updated_at','archived_at'];
function sqlRow(v:LicenseInput,id:string,now:string,created=now,archivedAt:string|null=null):Row{return {id,sn:v.sn,name:v.name,vendor:v.vendor,license_type:v.licenseType,department:v.department,purchase_date:v.purchaseDate,expiry_date:v.expiryDate,quantity_purchased:v.quantityPurchased,seat_count:v.seatCount,quantity_in_use:v.quantityInUse,status:v.status,last_payment_date:v.lastPaymentDate,last_payment_minor:v.lastPaymentMinor,notes:v.notes,match_key:matchKey(v),created_at:created,updated_at:now,archived_at:archivedAt}}
function writeRows(db:Database,rows:Row[],update:boolean){return db.prepare(`INSERT INTO licenses (${columns.join(',')}) SELECT ${columns.map(c=>'v.'+c).join(',')} FROM jsonb_populate_recordset(NULL::licenses,?::jsonb) AS v WHERE true ${update?'ON CONFLICT(match_key) DO UPDATE SET '+columns.filter(c=>!['id','created_at','match_key'].includes(c)).map(c=>`${c}=excluded.${c}`).join(','):''}`).bind(JSON.stringify(rows))}
function audit(db:Database,actor:string,action:string,summary:string,details:unknown={},licenseId:string|null=null){return db.prepare('INSERT INTO activity(id,license_id,action,summary,details,actor,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),licenseId,action,summary,JSON.stringify(details),actor,iso())}
export async function receipt(db:Database,id:string,action:string){const r=await one(db,'SELECT action,result FROM request_receipts WHERE id=?',id);if(r&&r.action!==action)throw new InputError('This request identifier was already used. Please start a new action.');return r?JSON.parse(r.result):null}
async function commit(db:Database,requestId:string,action:string,result:unknown,statements:Statement[]){
 try{await db.batch([...statements,db.prepare('INSERT INTO request_receipts(id,action,result,created_at) VALUES(?,?,?,?)').bind(requestId,action,JSON.stringify(result),iso())]);return result}catch(error){const prior=await receipt(db,requestId,action);if(prior)return prior;throw error}
}
export async function mutateRecords(db:Database,viewer:Viewer,body:Row){
 const action=String(body.action||''),requestId=String(body.requestId||'');if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))throw new InputError('A valid request identifier is required.');
 const prior=await receipt(db,requestId,action);if(prior)return prior;await initialize(db,viewer);
 if(action==='create'||action==='update'){
  const v=validateLicense(body.record||{}),now=iso();let previous:Row|null=null,id=crypto.randomUUID();
  if(action==='update'){previous=await one(db,'SELECT * FROM licenses WHERE id=?',String(body.id));if(!previous)throw new InputError('The record could not be found.');if(previous.archived_at)throw new InputError('Restore this archived record before editing it.');id=previous.id}
  const duplicate=await one(db,'SELECT id,archived_at FROM licenses WHERE match_key=?',matchKey(v));if(duplicate&&duplicate.id!==id)throw new InputError(duplicate.archived_at?'A matching record is archived. Restore it from the register.':'A matching software, vendor, licence type and owner record already exists. Open it to make changes.');
  if(!previous){const count=await one(db,'SELECT COUNT(*) AS n FROM licenses');if(count!.n>=5000)throw new InputError('The register supports up to 5,000 records.');if(!v.sn){const n=await one(db,"SELECT COALESCE(MAX(CASE WHEN sn ~ '^[0-9]{1,12}$' THEN sn::bigint ELSE 0 END),0)+1 AS n FROM licenses");v.sn=String(n!.n)}}
  const row=sqlRow(v,id,now,previous?.created_at||now),result={ok:true,id,message:action==='create'?'Record added.':'Record updated.'};
  return commit(db,requestId,action,result,[previous?db.prepare(`UPDATE licenses SET ${columns.filter(c=>!['id','created_at'].includes(c)).map(c=>c+'=?').join(',')} WHERE id=?`).bind(...columns.filter(c=>!['id','created_at'].includes(c)).map(c=>row[c]),id):writeRows(db,[row],false),audit(db,viewer.email,action,(action==='create'?'Added ':'Updated ')+v.name,{before:previous?toLicense(previous):null,after:v},id)]);
 }
 if(action==='import'){
  if(!Array.isArray(body.records)||!body.records.length||body.records.length>1000)throw new InputError('Choose between 1 and 1,000 valid rows to import.');
  const inputs=body.records.map((r:Row,index:number)=>{try{return validateLicense(r)}catch(error){throw new InputError(`Import row ${index+1}: ${error instanceof Error?error.message:'Invalid record.'}`)}}),seen=new Set<string>();
  for(const v of inputs){const key=matchKey(v);if(seen.has(key))throw new InputError('There are duplicate rows within this file. Correct them before importing.');seen.add(key)}
  const existing=await all(db,'SELECT * FROM licenses'),known=new Map(existing.map(r=>[r.match_key,r])),rows:Row[]=[],before:Row[]=[],now=iso();let created=0,updated=0,skipped=0,nextSN=Math.max(0,...existing.map(r=>Number(r.sn)||0))+1;
  for(const v of inputs){const old=known.get(matchKey(v));if(old&&body.mode!=='update'){skipped++;continue}if(old?.archived_at)throw new InputError('An import row matches an archived record. Restore it before updating.');if(!v.sn)v.sn=old?.sn||String(nextSN++);rows.push(sqlRow(v,old?.id||crypto.randomUUID(),now,old?.created_at||now));if(old){before.push(old);updated++}else created++}
  if(existing.length+created>5000)throw new InputError('The register supports up to 5,000 records.');
  const audits=rows.map(row=>({id:crypto.randomUUID(),license_id:row.id,action:'import',summary:'Imported '+row.name,details:JSON.stringify({before:known.has(row.match_key)?toLicense(known.get(row.match_key)!):null,after:toLicense(row)}),actor:viewer.email,created_at:now}));
  const statements:Statement[]=[];if(rows.length)statements.push(writeRows(db,rows,body.mode==='update'),db.prepare("INSERT INTO activity(id,license_id,action,summary,details,actor,created_at) SELECT id,license_id,action,summary,details,actor,created_at FROM jsonb_populate_recordset(NULL::activity,?::jsonb)").bind(JSON.stringify(audits)));
  statements.push(audit(db,viewer.email,'import',`Spreadsheet import: ${created} added, ${updated} updated, ${skipped} skipped.`));
  return commit(db,requestId,action,{ok:true,created,updated,skipped,message:`${created} added · ${updated} updated · ${skipped} skipped.`},statements);
 }
 if(action==='archive'||action==='restore'){
  const old=await one(db,'SELECT * FROM licenses WHERE id=?',String(body.id));if(!old)throw new InputError('The record could not be found.');const now=iso(),archived=action==='archive'?now:null;
  return commit(db,requestId,action,{ok:true,message:action==='archive'?'Record archived. You can restore it from the register.':'Record restored.'},[db.prepare('UPDATE licenses SET archived_at=?,updated_at=? WHERE id=?').bind(archived,now,old.id),audit(db,viewer.email,action,(action==='archive'?'Archived ':'Restored ')+old.name,{},old.id)]);
 }
 if(action==='renew'){
  const old=await one(db,'SELECT * FROM licenses WHERE id=?',String(body.id));if(!old||old.archived_at)throw new InputError('An active register record is required.');const date=parseDate(body.nextExpiry,'New expiry date');if(!date)throw new InputError('A new expiry date is required.');if(old.expiry_date&&date<=old.expiry_date)throw new InputError('The new expiry date must be later than the current expiry date.');
  const paid=parseDate(body.paymentDate,'Payment date')||todayUTC(),amount=moneyMinor(body.paymentAmount),notes=String(body.notes||'').trim();if(notes.length>5000)throw new InputError('Renewal notes are too long.');const now=iso();
  return commit(db,requestId,action,{ok:true,message:'Renewal recorded. The previous expiry and payment remain in history.'},[db.prepare('INSERT INTO renewals(id,license_id,previous_expiry,next_expiry,payment_date,payment_minor,notes,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),old.id,old.expiry_date,date,paid,amount,notes,viewer.email,now),db.prepare("UPDATE licenses SET purchase_date=?,expiry_date=?,last_payment_date=?,last_payment_minor=?,status='Active',updated_at=? WHERE id=?").bind(paid,date,paid,amount,now,old.id),audit(db,viewer.email,'renew',`Renewed ${old.name} to ${date}. Payment: ${displayMoney(amount)}.`,{previousExpiry:old.expiry_date,nextExpiry:date,previousPaymentMinor:old.last_payment_minor,paymentMinor:amount,notes},old.id)]);
 }
 throw new InputError('This record action is not supported.');
}
export async function updateSettings(db:Database,viewer:Viewer,body:Row,encryptionKey:string|undefined){
 await initialize(db,viewer);const old=(await one(db,'SELECT * FROM settings WHERE id=1'))!;
 const senderName=String(body.senderName||'ICDD License Renewal Tracker').trim();if(senderName.length>100||/[<>\r\n]/.test(senderName))throw new InputError('Enter a short sender name without angle brackets.');
 const senderEmail=String(body.senderEmail||'').trim().toLowerCase(),replyTo=String(body.replyTo||'').trim().toLowerCase();if(senderEmail&&!emailValid(senderEmail))throw new InputError('Enter a valid sender email.');if(replyTo&&!emailValid(replyTo))throw new InputError('Enter a valid reply-to email.');
 const recipients=recipientsInput(body.recipients),leadDays=leadDaysInput(body.leadDays),interval=Number(body.overdueInterval),months=Number(body.leadMonths??2);if(!Number.isInteger(months)||months<0||months>12)throw new InputError('Months before renewal must be between 0 and 12.');if(!Number.isInteger(interval)||interval<0||interval>30)throw new InputError('Overdue repeat must be between 0 and 30 days.');
 let encrypted=old.encrypted_api_key;const newKey=String(body.apiKey||'').trim();if(body.removeApiKey===true)encrypted=null;else if(newKey){if(!/^re_[a-zA-Z0-9_\-]{12,180}$/.test(newKey))throw new InputError('Enter a valid Resend API key.');if(!encryptionKey)throw new InputError('The secure email connection is not available. Please contact the tracker owner.');encrypted=await encryptSecret(newKey,encryptionKey)}
 if(body.enabled&&(!encrypted||!senderEmail||!recipients.length))throw new InputError('Add a sender, recipients and an email connection before enabling reminders.');
 const changed=senderEmail!==old.sender_email||!!newKey||body.removeApiKey===true;
 await db.batch([db.prepare('UPDATE settings SET sender_name=?,sender_email=?,reply_to=?,recipients=?,lead_days=?,lead_months=?,overdue_interval=?,enabled=?,encrypted_api_key=?,last_test_at=?,updated_at=? WHERE id=1').bind(senderName,senderEmail,replyTo,JSON.stringify(recipients),JSON.stringify(leadDays),months,interval,body.enabled?1:0,encrypted,changed?null:old.last_test_at,iso()),audit(db,viewer.email,'settings','Updated email reminder settings.',{enabled:!!body.enabled,leadDays,leadMonths:months,overdueInterval:interval,recipientCount:recipients.length})]);
 return {ok:true,message:'Email settings saved.'};
}
