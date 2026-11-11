import {InputError,emailValid} from './domain.ts';
import type {Database} from './database.ts';

export type Role='owner'|'admin'|'editor'|'viewer';
export type Viewer={userId:string;email:string;displayName:string;role:Role};
export type Member={id:string;email:string;name:string;role:Role;status:'active'|'suspended';createdAt:string;lastSignInAt:string|null};
type Identity={id:string;email:string;name?:string|null;emailVerified?:boolean};
type MemberRow={id:string;email:string;name:string;role:Role;status:'active'|'suspended';created_at:string;last_sign_in_at:string|null};
export const normalizeEmail=(value:string)=>value.trim().toLowerCase();
export const ownerAllowed=(email:string)=>(process.env.ADMIN_EMAILS||'').split(',').map(normalizeEmail).filter(Boolean).includes(normalizeEmail(email));
export const canManage=(role:Role)=>role==='owner'||role==='admin';
export const canEdit=(role:Role)=>canManage(role)||role==='editor';
export function requireAccess(viewer:Viewer,permission:'manage'|'edit'){
 if(!(permission==='manage'?canManage(viewer.role):canEdit(viewer.role))){const error=new InputError(permission==='manage'?'An admin must make this change.':'Your access is view-only. Ask an admin for editor access.');error.status=403;throw error}
}
export async function emailAllowed(db:Database,email:string){
 const normalized=normalizeEmail(email);if(!emailValid(normalized))return false;if(ownerAllowed(normalized))return true;
 const member=await db.prepare("SELECT role,status FROM workspace_users WHERE email=?").bind(normalized).first<{role:Role;status:string}>();
 return !!member&&member.status==='active'&&member.role!=='owner';
}
export async function resolveAccess(db:Database,identity:Identity):Promise<Viewer>{
 const email=normalizeEmail(identity.email),now=new Date().toISOString();
 if(!identity.emailVerified){const error=new InputError('Verify your email before opening this workspace.');error.status=403;throw error}
 if(ownerAllowed(email))await db.prepare(`INSERT INTO workspace_users(id,email,name,role,status,user_id,created_by,created_at,updated_at,last_sign_in_at) VALUES(?,?,?,'owner','active',?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role='owner',status='active',user_id=excluded.user_id,last_sign_in_at=excluded.last_sign_in_at`).bind(crypto.randomUUID(),email,identity.name||'Workspace owner',identity.id,email,now,now,now).run();
 const member=await db.prepare('SELECT * FROM workspace_users WHERE email=?').bind(email).first<MemberRow>();
 if(!member||member.status!=='active'||(member.role==='owner'&&!ownerAllowed(email))){const error=new InputError('This account does not have access to the tracker. Ask an admin to add your email.');error.status=403;throw error}
 if(member.role!=='owner')await db.prepare('UPDATE workspace_users SET user_id=?,last_sign_in_at=? WHERE id=?').bind(identity.id,now,member.id).run();
 return {userId:identity.id,email,displayName:member.name||identity.name||email,role:member.role};
}
export async function listMembers(db:Database):Promise<Member[]>{
 const result=await db.prepare("SELECT id,email,name,role,status,created_at,last_sign_in_at FROM workspace_users ORDER BY CASE WHEN role='owner' THEN 0 ELSE 1 END,name,email").all<MemberRow>();
 return result.results.map(row=>({id:row.id,email:row.email,name:row.name,role:row.role,status:row.status,createdAt:row.created_at,lastSignInAt:row.last_sign_in_at}));
}
