import { binding,reply,readBody,viewer,failure,emailConfig } from '@/lib/http';
import { getState,mutateRecords,updateSettings,manageMember } from '@/lib/store';
import { runReminders,testEmail } from '@/lib/email';
import { InputError } from '@/lib/domain';
import {requireAccess} from '@/lib/access';
export const dynamic='force-dynamic';
export async function GET(){try{return reply(await getState(binding(),await viewer()))}catch(error){return failure(error)}}
export async function POST(request:Request){try{
 const user=await viewer(),body=await readBody(request),db=binding();
 if(body.action==='addUser'||body.action==='updateUser')return reply(await manageMember(db,user,body));
 if(['settings','testEmail','runReminders'].includes(body.action))requireAccess(user,'manage');
 if(body.action==='settings')return reply(await updateSettings(db,user,body,emailConfig().encryptionKey));
 if(body.action==='testEmail'){if(!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId||''))throw new InputError('Start a new test request.');return reply(await testEmail(db,emailConfig(),body.requestId,fetch,body.recipient))}
 if(body.action==='runReminders')return reply(await runReminders(db,emailConfig()));
 return reply(await mutateRecords(db,user,body));
}catch(error){return failure(error)}}
