import {auth} from '@/lib/auth/server';
import {emailAllowed} from '@/lib/access';
import {database} from '@/lib/database';
export const dynamic='force-dynamic';
async function handle(request:Request,context:any){
 const path=new URL(request.url).pathname;
 const allowed=['/api/auth/email-otp/send-verification-otp','/api/auth/sign-in/email-otp','/api/auth/get-session','/api/auth/sign-out','/api/auth/token'];
 if(!allowed.includes(path))return Response.json({message:'This sign-in method is not available.'},{status:404});
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin&&origin!==process.env.SITE_ORIGIN)return Response.json({message:'Open sign-in from this tracker.'},{status:403});
 if(request.method==='POST'&&path!=='/api/auth/sign-out'){
  const body=await request.clone().json().catch(()=>null);
  if(!body||typeof body.email!=='string'||!await emailAllowed(database(),body.email))return Response.json({message:'This email address does not have access to this workspace. Ask an admin to add you under Users & access.'},{status:403});
 }
 const handlers=auth().handler();const handler=handlers[request.method as keyof typeof handlers];
 if(!handler)return Response.json({message:'Method not allowed.'},{status:405});
 return handler(request as any,context);
}
export {handle as GET,handle as POST};
