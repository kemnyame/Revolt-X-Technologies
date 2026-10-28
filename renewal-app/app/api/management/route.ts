import {binding,viewer,reply,readBody,failure} from '@/lib/http';
import {readManagement,mutateManagement} from '@/lib/management-store';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request){try{const user=await viewer(),params=new URL(request.url).searchParams,result=await readManagement(binding(),user,params);if(params.get('kind')==='export'&&'csv' in result)return new Response(result.csv as string,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="icdd-management-report.csv"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});return reply(result)}catch(error){return failure(error)}}
export async function POST(request:Request){try{const user=await viewer(),body=await readBody(request);return reply(await mutateManagement(binding(),user,body))}catch(error){return failure(error)}}
