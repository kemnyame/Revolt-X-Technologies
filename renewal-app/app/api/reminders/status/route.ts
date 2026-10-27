import {binding,reply,failure,jobAccess} from '@/lib/http';
import {one,initialize} from '@/lib/store';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{await jobAccess(request);const db=binding();await initialize(db);const s=(await one(db,'SELECT * FROM settings WHERE id=1'))!,review=(await one(db,"SELECT COUNT(*) AS n FROM email_log WHERE status='needs_review'"))!.n;return reply({ok:true,enabled:!!s.enabled,configured:!!(s.encrypted_api_key&&s.sender_email&&JSON.parse(s.recipients).length),leadMonths:s.lead_months,leadDays:JSON.parse(s.lead_days),scheduleRegistered:!!s.schedule_registered,lastChecked:s.job_last_checked,result:s.job_last_result,needsReview:review})}catch(error){return failure(error)}}
