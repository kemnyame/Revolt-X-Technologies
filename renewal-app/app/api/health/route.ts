import {binding,reply,failure} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(){try{const schema=await binding().prepare("SELECT to_regclass('portal_records') AS records,to_regclass('portal_evidence') AS evidence").first<{records:string|null;evidence:string|null}>();if(!schema?.records||!schema.evidence)throw new Error('Portal migration is incomplete');return reply({ok:true,database:'connected',portal:'ready',version:'2.0.0'})}catch(error){return failure(error)}}
