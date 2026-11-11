import {binding,reply,failure} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(){try{await binding().prepare('SELECT 1').first();return reply({ok:true,database:'connected'})}catch(error){return failure(error)}}
