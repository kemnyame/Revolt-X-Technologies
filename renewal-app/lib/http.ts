import {timingSafeEqual} from 'node:crypto';
import {auth,ownerAllowed} from './auth/server';
import {database} from './database.ts';
import {InputError} from './domain.ts';
import {initialize} from './store.ts';
export const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export const binding=()=>database();
export function checkOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin&&origin!==process.env.SITE_ORIGIN){const error=new InputError('This request must come from the tracker.');error.status=403;throw error}}
export async function readBody(request:Request){checkOrigin(request);if(!request.headers.get('content-type')?.includes('application/json'))throw new InputError('Please send a valid form request.');const text=await request.text();if(text.length>2200000){const error=new InputError('This import is too large. Split it into smaller files.');error.status=413;throw error}try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid form');return body}catch{throw new InputError('The submitted information could not be read.')}}
export async function viewer(){const {data}=await auth().getSession();const user=data?.user;if(!user){const error=new InputError('Sign in to access your renewal register.');error.status=401;throw error}if(!ownerAllowed(user.email)||!user.emailVerified){const error=new InputError('This account does not have access to the tracker.');error.status=403;throw error}const owner={userId:user.id,email:user.email,displayName:user.name||user.email};await initialize(binding(),owner);return owner}
export function cronAccess(request:Request){const expected=process.env.CRON_SECRET,provided=request.headers.get('authorization');if(!expected||!provided?.startsWith('Bearer '))return false;const actual=Buffer.from(provided.slice(7)),correct=Buffer.from(expected);return actual.length===correct.length&&timingSafeEqual(actual,correct)}
export async function jobAccess(request:Request){if(!cronAccess(request))await viewer()}
export function failure(error:unknown){if(error instanceof InputError)return reply({ok:false,message:error.message},error.status);console.error('Tracker request failed:',error instanceof Error?error.name:'Unknown error');return reply({ok:false,message:'The tracker could not complete this request. Your entries have been kept. Please try again.'},503)}
export const emailConfig=()=>({encryptionKey:process.env.EMAIL_SETTINGS_KEY,origin:process.env.SITE_ORIGIN||''});
