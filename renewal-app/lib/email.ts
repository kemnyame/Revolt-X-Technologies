import { InputError, reminderBucket, daysUntil, displayDate, todayUTC, dormant, emailValid } from './domain.ts';
import type { License } from './domain.ts';
import { all, one, iso, initialize, safeSettings, toLicense } from './store.ts';
import type { Row } from './store.ts';
import type {Database} from './database.ts';
import {emailConnected} from './email-connection.ts';
import { decryptSecret } from './secrets.ts';
export type EmailConfig={encryptionKey?:string;origin:string};
export type Fetcher=(input:string,init:RequestInit)=>Promise<Response>;
type Payload={from:string;to:string[];reply_to?:string;subject:string;html:string;text:string};
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
class DeliveryError extends Error{retryable:boolean;attempts:number;constructor(message:string,retryable:boolean,attempts:number){super(message);this.retryable=retryable;this.attempts=attempts}}
export async function sendProvider(apiKey:string,payload:Payload,idempotencyKey:string,fetcher:Fetcher=fetch):Promise<{id:string;attempts:number}>{
 for(let attempt=1;attempt<=3;attempt++){
  let retryable=true,message='The email provider could not be reached.';
  try{
   const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   const result=await response.json().catch(()=>({})) as Row;
   if(response.ok&&typeof result.id==='string')return {id:result.id,attempts:attempt};
   retryable=response.status>=500||response.status===429||response.ok;
   message=String(result.message||'Email request rejected ('+response.status+').').replaceAll(apiKey,'[redacted]').replace(/re_[a-zA-Z0-9_-]+/g,'[redacted]').slice(0,350);
   const retryAfter=Number(response.headers.get('retry-after')||0);if(retryAfter>5)throw new DeliveryError(message,true,attempt);
  }catch(error){if(error instanceof DeliveryError)throw error;message=error instanceof Error&&error.name==='TimeoutError'?'The email provider timed out. Its final acceptance is not confirmed.':'The email provider could not be reached. Its final acceptance is not confirmed.'}
  if(!retryable||attempt===3)throw new DeliveryError(message,retryable,attempt);
  await new Promise(resolve=>setTimeout(resolve,attempt*700));
 }
 throw new DeliveryError('Email acceptance was not confirmed.',true,3);
}
function digestPayload(settings:Row,recipient:string,items:License[],origin:string,now:Date):Payload{
 const subject=`ICDD renewal reminder: ${items.length} item${items.length===1?'':'s'} to review`;
 const lines=items.map(item=>{const d=daysUntil(item.expiryDate!,now);return `${item.name} | ${item.vendor||'Vendor not recorded'} | ${item.department||'Owner not recorded'} | Renewal: ${displayDate(item.expiryDate)} | ${d<0?`${-d} days overdue`:d===0?'Due today':`Due in ${d} days`}`});
 const text=`ICDD License Renewal Tracker\nRenewal status as at ${displayDate(todayUTC(now))}.\n\n${lines.join('\n\n')}\n\nOpen your private renewal register: ${origin}\n\nManage recipients and reminder periods in Email reminders.`;
 const rows=items.map(item=>{const d=daysUntil(item.expiryDate!,now);return `<tr><td style="padding:16px 0;border-bottom:1px solid #dfe8e5"><strong>${escape(item.name)}</strong><br><span style="color:#526b66">${escape(item.vendor||'Vendor not recorded')} · ${escape(item.department||'Owner not recorded')}</span><br>Renewal: ${escape(displayDate(item.expiryDate))}<br><strong style="color:${d<0?'#a13d36':'#246959'}">${d<0?`${-d} days overdue`:d===0?'Due today':`Due in ${d} days`}</strong></td></tr>`}).join('');
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(subject)}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f2f6f4;color:#173c33;font:16px/1.6 Arial,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:30px 16px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;background:white;border-radius:12px"><tr><td style="padding:30px"><p style="font-size:12px;letter-spacing:1px;color:#426a5e">ICDD LICENSE RENEWAL TRACKER</p><h1 style="font-size:26px;line-height:1.3;margin:14px 0">Your renewal review</h1><p>Renewal status as at ${escape(displayDate(todayUTC(now)))}. Please review these items and confirm the next action.</p><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table><p style="margin-top:28px"><a href="${escape(origin)}" style="background:#216c59;color:white;padding:13px 20px;text-decoration:none;border-radius:6px;display:inline-block">Open renewal register</a></p><p style="color:#526b66;font-size:14px">Recipients and reminder periods can be changed in Email reminders.</p></td></tr></table></td></tr></table></body></html>`;
 return {from:settings.sender_name+' <'+settings.sender_email+'>',to:[recipient],...(settings.reply_to?{reply_to:settings.reply_to}:{}),subject,html,text};
}
async function recordOutcome(db:Database,emailId:string,result:{id?:string;attempts:number;error?:string;retryable?:boolean}){
 const now=iso(),status=result.id?'accepted':result.retryable?'retry':'failed';
 await db.batch([db.prepare('UPDATE email_log SET status=?,provider_id=?,error=?,attempts=attempts+?,updated_at=? WHERE id=?').bind(status,result.id||null,result.error||null,result.attempts,now,emailId),db.prepare('UPDATE reminder_events SET status=? WHERE email_id=?').bind(result.id?'accepted':result.retryable?'retry':'failed',emailId)]);
}
export async function runReminders(db:Database,config:EmailConfig,options:{dryRun?:boolean;registerSchedule?:boolean;now?:Date;fetcher?:Fetcher}={}){
 await initialize(db);const now=options.now||new Date(),checkedAt=now.toISOString(),runId=crypto.randomUUID();
 const lease=await db.prepare('INSERT INTO job_lease(id,run_id,lease_until) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,lease_until=excluded.lease_until WHERE job_lease.lease_until<? RETURNING run_id').bind(runId,Date.now()+900000,Date.now()).first<Row>();
 if(!lease)return {ok:true,state:'already_running',accepted:0,failed:0,due:0,checkedAt};
 try{
  const settings=(await one(db,'SELECT * FROM settings WHERE id=1'))!;
  if(options.registerSchedule)await db.prepare('UPDATE settings SET schedule_registered=1 WHERE id=1').run();
  const records=(await all(db,'SELECT * FROM licenses WHERE archived_at IS NULL')).map(toLicense),leads=JSON.parse(settings.lead_days) as number[],recipients=JSON.parse(settings.recipients) as string[];
  const due=records.filter(record=>reminderBucket(record,leads,settings.overdue_interval,now,settings.lead_months??2)!==null);
  const gmail=settings.email_provider==='gmail';
  let state=options.dryRun?'preview':!settings.enabled?'paused':!emailConnected(settings)||(!gmail&&!config.encryptionKey)||!settings.sender_email||!recipients.length?'not_configured':'ready',accepted=0,failed=0,queued=0;
  if(!emailConnected(settings)||!settings.sender_email||!recipients.length)state='not_configured';
  if(options.dryRun||state!=='ready'){
   await db.prepare('UPDATE settings SET job_last_checked=?,job_last_result=? WHERE id=1').bind(checkedAt,state).run();
   return {ok:true,state,accepted,failed,due:due.length,checkedAt};
  }
  const apiKey=gmail?'':await decryptSecret(settings.encrypted_api_key,config.encryptionKey!);
  // Retry an unchanged payload only inside the provider's 24-hour idempotency window.
  const pending=gmail?[]:await all(db,"SELECT * FROM email_log WHERE delivery_provider='resend' AND status IN ('retry','pending') ORDER BY created_at LIMIT 10");
  for(const mail of pending){
   if(Date.now()-Date.parse(mail.created_at)>23*3600000||mail.attempts>=6){await db.batch([db.prepare("UPDATE email_log SET status='needs_review',error=?,updated_at=? WHERE id=?").bind('Acceptance is uncertain. Check the email provider logs before sending again.',iso(),mail.id),db.prepare("UPDATE reminder_events SET status='needs_review' WHERE email_id=?").bind(mail.id)]);continue}
   const events=await all(db,'SELECT * FROM reminder_events WHERE email_id=?',mail.id),stale=events.some(event=>!records.some(record=>record.id===event.license_id&&record.expiryDate===event.expiry_date&&!dormant(record)));
   if(stale||!recipients.includes(mail.recipient)){await db.batch([db.prepare("UPDATE email_log SET status='cancelled',error=?,updated_at=? WHERE id=?").bind('The renewal date or recipient changed before acceptance was confirmed. Review provider logs if needed.',iso(),mail.id),db.prepare("UPDATE reminder_events SET status='needs_review' WHERE email_id=?").bind(mail.id)]);continue}
   try{const result=await sendProvider(apiKey,JSON.parse(mail.payload),mail.id,options.fetcher);await recordOutcome(db,mail.id,result);accepted++}catch(error){const e=error as DeliveryError;await recordOutcome(db,mail.id,{error:e.message,attempts:e.attempts||1,retryable:e.retryable});failed++}
  }
  for(const recipient of recipients){
   const events=await all(db,'SELECT id,status FROM reminder_events WHERE recipient=?',recipient),known=new Map(events.map(event=>[event.id,event.status])),items:License[]=[],eventRows:Row[]=[];
   for(const item of due){const bucket=reminderBucket(item,leads,settings.overdue_interval,now,settings.lead_months??2)!,id=await hash([item.id,item.expiryDate,bucket,recipient].join('|'));if(known.has(id)&&!['failed','cancelled'].includes(known.get(id)))continue;items.push(item);eventRows.push({id,license_id:item.id,expiry_date:item.expiryDate,bucket,recipient})}
   if(!items.length)continue;
   const emailId='renewal-'+await hash([gmail?'gmail':'resend',settings.sender_email,recipient,...eventRows.map(e=>e.id).sort()].join('|'));
   let mail=await one(db,'SELECT * FROM email_log WHERE id=?',emailId);
   if(mail?.status==='accepted'||mail?.status==='needs_review'||(mail&&mail.attempts>=3&&Date.parse(mail.updated_at)>=Date.parse(settings.updated_at)))continue;
   const payload:Payload=mail?JSON.parse(mail.payload):digestPayload(settings,recipient,items,config.origin,now),created=iso();
   await db.batch([db.prepare("INSERT INTO email_log(id,delivery_provider,recipient,subject,status,payload,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?) ON CONFLICT (id) DO NOTHING").bind(emailId,gmail?'gmail':'resend',recipient,payload.subject,gmail?'queued':'pending',JSON.stringify(payload),created,created),db.prepare("INSERT INTO reminder_events(id,license_id,expiry_date,bucket,recipient,email_id,status,created_at) SELECT v.id,v.license_id,v.expiry_date,v.bucket,v.recipient,?,?,? FROM jsonb_populate_recordset(NULL::reminder_events,?::jsonb) AS v WHERE true ON CONFLICT(id) DO UPDATE SET email_id=excluded.email_id,status=excluded.status").bind(emailId,gmail?'queued':'pending',created,JSON.stringify(eventRows))]);
   if(gmail){queued++;continue}
   try{const result=await sendProvider(apiKey,payload,emailId,options.fetcher);await recordOutcome(db,emailId,result);accepted++}catch(error){const e=error as DeliveryError;await recordOutcome(db,emailId,{error:e.message,attempts:e.attempts||1,retryable:e.retryable});failed++}
  }
  const needsReview=(await one(db,"SELECT COUNT(*) AS n FROM email_log WHERE status='needs_review'"))!.n;state=failed?'attention_needed':needsReview?'needs_review':queued?'queued':accepted?'accepted':'up_to_date';
  await db.prepare('UPDATE settings SET job_last_checked=?,job_last_result=? WHERE id=1').bind(checkedAt,state).run();
  return {ok:true,state,accepted,failed,queued,needsReview,due:due.length,checkedAt};
 }finally{await db.prepare('UPDATE job_lease SET lease_until=0 WHERE id=1 AND run_id=?').bind(runId).run()}
}
export async function testEmail(db:Database,config:EmailConfig,requestId:string,fetcher:Fetcher=fetch,requestedRecipient?:unknown){
 const settings=(await one(db,'SELECT * FROM settings WHERE id=1'))!,recipients=JSON.parse(settings.recipients) as string[];
 const recipient=String(requestedRecipient??recipients[0]??'').trim().toLowerCase();if(!emailValid(recipient))throw new InputError('Enter a valid email address for the test.');
 const gmail=settings.email_provider==='gmail';if(!emailConnected(settings)||(!gmail&&!config.encryptionKey)||!settings.sender_email)throw new InputError('Connect the sender before sending a test.');
 const id=(gmail?'test-gmail-':'test-')+requestId,prior=await one(db,'SELECT status,provider_id,recipient,payload FROM email_log WHERE id=?',id);if(prior&&prior.recipient!==recipient)throw new InputError('Start a new test when choosing a different recipient.');if(prior?.status==='accepted')return {ok:true,message:'This test was already accepted by the email provider.'};
 const payload:Payload=prior?JSON.parse(prior.payload):{from:settings.sender_name+' <'+settings.sender_email+'>',to:[recipient],...(settings.reply_to?{reply_to:settings.reply_to}:{}),subject:'ICDD License Renewal Tracker · Email connection test',text:'Your ICDD License Renewal Tracker email connection is working. This is a connection test, not a licence renewal reminder. Open your tracker: '+config.origin,html:'<html lang="en"><body style="font:16px/1.7 Arial,sans-serif;color:#214d40"><h1 style="font-size:24px">Your email connection is working.</h1><p>This is a connection test from ICDD License Renewal Tracker. It is not a licence renewal reminder.</p><p><a href="'+escape(config.origin)+'">Open your renewal tracker</a></p></body></html>'};
 const now=iso();await db.prepare("INSERT INTO email_log(id,delivery_provider,recipient,subject,status,payload,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?) ON CONFLICT (id) DO NOTHING").bind(id,gmail?'gmail':'resend',recipient,payload.subject,gmail?'queued':'pending',JSON.stringify(payload),now,now).run();
 if(gmail)return {ok:true,state:'queued',message:'Test queued for Gmail delivery. Automatic delivery checks run hourly.'};
 try{const key=await decryptSecret(settings.encrypted_api_key,config.encryptionKey!);const result=await sendProvider(key,payload,id,fetcher);await db.batch([db.prepare("UPDATE email_log SET status='accepted',provider_id=?,attempts=attempts+?,error=NULL,updated_at=? WHERE id=?").bind(result.id,result.attempts,iso(),id),db.prepare('UPDATE settings SET last_test_at=? WHERE id=1').bind(iso())]);return {ok:true,message:'Test accepted by the email provider for '+recipient+'. Check the inbox and spam folder.'}}catch(error){const e=error as DeliveryError;await recordOutcome(db,id,{error:e.message,attempts:e.attempts||1,retryable:e.retryable});throw new InputError(e.message)}
}
