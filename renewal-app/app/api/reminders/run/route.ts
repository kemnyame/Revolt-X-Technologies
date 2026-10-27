import {binding,reply,readBody,failure,emailConfig,jobAccess} from '@/lib/http';
import {runReminders} from '@/lib/email';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{await jobAccess(request);const body=await readBody(request);return reply(await runReminders(binding(),emailConfig(),{dryRun:body.dryRun===true}))}catch(error){return failure(error)}}
