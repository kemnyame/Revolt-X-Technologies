import {timingSafeEqual} from 'node:crypto';
import {parseTriggerDelivery} from '@neon/functions/triggers';

function manualAccess(request){const expected=process.env.CRON_SECRET,header=request.headers.get('authorization');if(!expected||!header?.startsWith('Bearer '))return false;const a=Buffer.from(header.slice(7)),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)}
export default {
 async fetch(request){
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const path=new URL(request.url).pathname;
  if(path==='/cron'){
   const parsed=await parseTriggerDelivery(request);
   if(!parsed.ok||parsed.invocation.type!=='schedule'||parsed.invocation.trigger.name!=='icdd-daily-renewals')return new Response('Unauthorised',{status:401});
  }else if(path!=='/run'||!manualAccess(request)){return new Response('Unauthorised',{status:401})}
  if(!process.env.CRON_SECRET||!process.env.SITE_ORIGIN)return new Response('Reminder connection is unavailable',{status:503});
  const headers={'Authorization':'Bearer '+process.env.CRON_SECRET,'Content-Type':'application/json'},origin=process.env.SITE_ORIGIN;
  try{
   const run=await fetch(new URL('/api/reminders/run',origin),{method:'POST',headers,body:'{}',redirect:'manual',signal:AbortSignal.timeout(180000)});
   if(!run.ok){console.error('ICDD check returned HTTP',run.status);return Response.json({ok:false,error:'The tracker check did not succeed.',status:run.status},{status:502})}
   const result=await run.json();
   const readback=await fetch(new URL('/api/reminders/status',origin),{headers,redirect:'manual',signal:AbortSignal.timeout(30000)});
   if(!readback.ok)return Response.json({ok:false,error:'The reminder result could not be confirmed.'},{status:502});
   const status=await readback.json();
   if(result.checkedAt&&status.lastChecked!==result.checkedAt)return Response.json({ok:false,error:'The saved check time did not match.'},{status:502});
   console.log(JSON.stringify({state:result.state,accepted:result.accepted,failed:result.failed,needsReview:result.needsReview||0,checkedAt:result.checkedAt}));
   return Response.json({ok:true,run:result,saved:{enabled:status.enabled,configured:status.configured,leadMonths:status.leadMonths,lastChecked:status.lastChecked,result:status.result,needsReview:status.needsReview}});
  }catch{console.error('ICDD reminder check could not reach the tracker.');return Response.json({ok:false,error:'The tracker could not be reached.'},{status:502})}
 }
};
