import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { audit, fail, first, id, transaction } from './db.mjs';
import { currency, email, label, password, timezone } from './validation.mjs';

const derive = promisify(scrypt);
const token = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,63}$/,'Enter your workspace code.');
const secret = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
const inviteToken = z.string().regex(/^[a-f0-9-]{36}\.[a-zA-Z0-9_-]{43}$/);
const signupForm = z.object({business:label(),name:label(),email,password,currency,timezone});
const loginForm = z.object({workspace:slug,email,password:z.string().min(1).max(128)});
const recoveryForm = z.object({workspace:slug,email,recoveryCode:secret,password});
const parameters = {N:32768,r:8,p:3,maxmem:64*1024*1024};
const dummyHash = 'a'.repeat(32)+':'+ '0'.repeat(128);
let activeDerivations=0;

async function key(value,salt) {
  if(activeDerivations>=4)fail(429,'Sign-in is busy. Try again shortly.');
  activeDerivations++;
  try { return await derive(value,salt,64,parameters); }
  finally { activeDerivations--; }
}
async function passwordHash(value) {
  const salt=randomBytes(16).toString('hex');
  return salt+':'+(await key(value,salt)).toString('hex');
}
async function verifyPassword(value,digest) {
  const [salt,expected]=digest.split(':');
  return timingSafeEqual(await key(value,salt),Buffer.from(expected,'hex'));
}

async function limit(db,name,maximum) {
  const row=await first(db,
    "INSERT INTO auth_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') "+
    'ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN auth_limits.expires_at<=now() THEN 1 ELSE auth_limits.attempts+1 END, '+
    'expires_at=CASE WHEN auth_limits.expires_at<=now() THEN excluded.expires_at ELSE auth_limits.expires_at END RETURNING attempts',[hash(name)]);
  if(row.attempts>maximum)fail(429,'Too many requests. Try again in 15 minutes.');
}
function cookieValue(request,name) {
  const item=(request.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='));
  const value=item?.slice(name.length+1)||'';
  return /^[a-zA-Z0-9_-]{43}$/.test(value)?value:null;
}

async function createWorkspace(db,form,isDemo=false) {
  const workspaceId=id(), memberId=id();
  const stem=form.business.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40).replace(/-$/,'')||'warehouse';
  const code=stem+'-'+workspaceId.replaceAll('-','').slice(0,12);
  const expires=isDemo?new Date(Date.now()+12*3600000):null;
  await db.query('INSERT INTO workspaces(id,slug,name,currency,timezone,is_demo,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [workspaceId,code,form.business,form.currency,form.timezone,isDemo,expires]);
  await db.query("INSERT INTO members(id,workspace_id,name,email,role,password_hash,recovery_hash,status) VALUES($1,$2,$3,$4,'admin',$5,$6,'active')",
    [memberId,workspaceId,form.name,form.email,form.passwordHash??null,form.recoveryHash??null]);
  const context={workspace_id:workspaceId,member_id:memberId,member_name:form.name,timezone:form.timezone,slug:code,role:'admin'};
  await audit(db,context,isDemo?'Demo opened':'Workspace created',code);
  return context;
}

export function registerAuth(app,db,{secure,appOrigin,inviteKey,allowSignup,enableDemo,seedDemo}) {
  const name=secure?'__Host-warehouse_session':'warehouse_session';
  const cookie=(reply,value,age)=>reply.header('set-cookie',name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(secure?'; Secure':''));
  const makeInvite=inviteId=>inviteId+'.'+createHmac('sha256',inviteKey).update(inviteId).digest('base64url');
  const invitationUrl=inviteId=>appOrigin+'/#invite='+encodeURIComponent(makeInvite(inviteId));
  const openSession=async(client,workspaceId,memberId)=>{
    const value=token();
    await client.query("INSERT INTO sessions(token_hash,workspace_id,member_id,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
      [hash(value),workspaceId,memberId]);
    return value;
  };
  async function access(request,client=db) {
    const value=cookieValue(request,name);
    if(!value)fail(401,'Sign in to continue.');
    const context=await first(client,
      'SELECT w.id workspace_id,w.name workspace_name,w.slug,w.currency,w.timezone,w.is_demo,w.expires_at, '+
      'm.id member_id,m.name member_name,m.email,m.role FROM sessions s '+
      'JOIN members m ON m.workspace_id=s.workspace_id AND m.id=s.member_id JOIN workspaces w ON w.id=s.workspace_id '+
      "WHERE s.token_hash=$1 AND s.expires_at>now() AND m.status='active' AND (w.expires_at IS NULL OR w.expires_at>now())",[hash(value)]);
    if(!context)fail(401,'Your session ended. Sign in again to continue.');
    return context;
  }
  app.get('/api/session',request=>access(request));
  app.get('/api/public',async()=>({allowSignup,enableDemo}));
  app.post('/api/auth/login',async(request,reply)=>{
    const form=loginForm.parse(request.body);
    await limit(db,'login-ip:'+request.ip,36);
    await limit(db,'login-account:'+form.workspace+':'+form.email,12);
    const member=await first(db,"SELECT m.id,m.workspace_id,m.password_hash FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE w.slug=$1 AND m.email=$2 AND m.status='active' AND NOT w.is_demo",[form.workspace,form.email]);
    const good=await verifyPassword(form.password,member?.password_hash||dummyHash);
    if(!member?.password_hash||!good)fail(401,'Check your workspace code, email and password.');
    const session=await transaction(db,async client=>{
      const active=await first(client,"SELECT id FROM members WHERE workspace_id=$1 AND id=$2 AND status='active' AND password_hash=$3 FOR UPDATE",[member.workspace_id,member.id,member.password_hash]);
      if(!active)fail(401,'Check your workspace code, email and password.');
      return openSession(client,member.workspace_id,member.id);
    });
    await db.query('DELETE FROM auth_limits WHERE key=$1',[hash('login-account:'+form.workspace+':'+form.email)]);
    cookie(reply,session,43200);
    return {ok:true};
  });
  app.post('/api/auth/signup',async(request,reply)=>{
    if(!allowSignup)fail(403,'New workspace registration is closed.');
    const form=signupForm.parse(request.body);
    await limit(db,'signup:'+request.ip,8);
    const digest=await passwordHash(form.password), recoveryCode=token();
    const {workspace,session}=await transaction(db,async client=>{
      const workspace=await createWorkspace(client,{...form,passwordHash:digest,recoveryHash:hash(recoveryCode)});
      return {workspace,session:await openSession(client,workspace.workspace_id,workspace.member_id)};
    });
    cookie(reply,session,43200);
    return {workspace:workspace.slug,recoveryCode};
  });
  app.post('/api/auth/demo',async(request,reply)=>{
    if(!enableDemo)fail(404,'Demo access is unavailable.');
    await limit(db,'demo:'+request.ip,12);
    const existing=await access(request).catch(error=>{if(error.statusCode!==401)throw error;return null;});
    if(existing)fail(409,'Sign out of the current workspace before opening a demo.');
    const session=await transaction(db,async client=>{
      const workspace=await createWorkspace(client,{business:'Harbourline Trading',name:'Demo Administrator',
        email:'administrator@example.test',currency:'GHS',timezone:'Africa/Accra'},true);
      await seedDemo(client,workspace);
      return openSession(client,workspace.workspace_id,workspace.member_id);
    });
    cookie(reply,session,43200);
    return {ok:true};
  });
  app.post('/api/auth/logout',async(request,reply)=>{
    const value=cookieValue(request,name);
    if(value)await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(value)]);
    cookie(reply,'',0);
    return {ok:true};
  });
  app.post('/api/auth/recover',async(request,reply)=>{
    const form=recoveryForm.parse(request.body);
    await limit(db,'recovery:'+request.ip,12);
    const params=[form.workspace,form.email,hash(form.recoveryCode)];
    const lookup="SELECT m.id,m.workspace_id,m.name FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE w.slug=$1 AND m.email=$2 AND m.recovery_hash=$3 AND m.status='active' AND NOT w.is_demo";
    if(!await first(db,lookup,params))fail(400,'The workspace code, email or recovery code is invalid.');
    const digest=await passwordHash(form.password), recoveryCode=token();
    await transaction(db,async client=>{
      const entry=await first(client,lookup,params);
      if(!entry)fail(400,'The workspace code, email or recovery code is invalid.');
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[entry.workspace_id]);
      const member=await first(client,lookup+' FOR UPDATE OF m',params);
      if(!member)fail(400,'The workspace code, email or recovery code is invalid.');
      await client.query('UPDATE members SET password_hash=$2,recovery_hash=$3 WHERE id=$1',[member.id,digest,hash(recoveryCode)]);
      await client.query('DELETE FROM sessions WHERE workspace_id=$1 AND member_id=$2',[member.workspace_id,member.id]);
      await audit(client,{workspace_id:member.workspace_id,member_id:member.id,member_name:member.name},'Password recovered',form.email);
    });
    cookie(reply,'',0);
    return {workspace:form.workspace,recoveryCode};
  });
  const inviteLookup="SELECT i.*,m.name,m.email,w.slug FROM invites i JOIN members m ON m.workspace_id=i.workspace_id AND m.id=i.member_id JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at>now() AND m.status='invited' AND NOT w.is_demo";
  app.post('/api/auth/accept',async(request,reply)=>{
    const form=z.object({token:inviteToken,password}).parse(request.body);
    const params=[hash(form.token)];
    await limit(db,'accept-invite:'+request.ip,12);
    const entry=await first(db,inviteLookup,params);
    if(!entry)fail(400,'This invitation is invalid or expired.');
    const digest=await passwordHash(form.password), recoveryCode=token();
    const result=await transaction(db,async client=>{
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[entry.workspace_id]);
      const invite=await first(client,inviteLookup+' FOR UPDATE OF m,i',params);
      if(!invite)fail(400,'This invitation is invalid or expired.');
      await client.query("UPDATE members SET status='active',password_hash=$2,recovery_hash=$3 WHERE id=$1",[invite.member_id,digest,hash(recoveryCode)]);
      await client.query('UPDATE invites SET used_at=now() WHERE token_hash=$1',params);
      await audit(client,{workspace_id:invite.workspace_id,member_id:invite.member_id,member_name:invite.name},'Invitation accepted',invite.email);
      return {workspace:invite.slug,session:await openSession(client,invite.workspace_id,invite.member_id)};
    });
    cookie(reply,result.session,43200);
    return {workspace:result.workspace,recoveryCode};
  });

  async function refreshInvite(client,context,memberId) {
    if(context.is_demo)fail(403,'Open a business workspace to invite real users.');
    const member=await first(client,'SELECT * FROM members WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,memberId]);
    if(!member||member.status!=='invited')fail(409,'This account has no pending invitation.');
    const inviteId=id();
    await client.query('UPDATE invites SET used_at=now() WHERE workspace_id=$1 AND member_id=$2 AND used_at IS NULL',[context.workspace_id,memberId]);
    await client.query("INSERT INTO invites(token_hash,workspace_id,member_id,expires_at) VALUES($1,$2,$3,now()+interval '3 days')",
      [hash(makeInvite(inviteId)),context.workspace_id,memberId]);
    await audit(client,context,'Invitation link issued',member.email);
    return {id:memberId,inviteId};
  }
  async function inviteMember(client,context,form) {
    if(context.is_demo)fail(403,'Open a business workspace to invite real users.');
    const memberId=id();
    await client.query("INSERT INTO members(id,workspace_id,name,email,role,status) VALUES($1,$2,$3,$4,$5,'invited')",
      [memberId,context.workspace_id,form.name,form.email,form.role]);
    return refreshInvite(client,context,memberId);
  }
  async function editMember(client,context,memberId,form) {
    const member=await first(client,'SELECT * FROM members WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,memberId]);
    if(!member)fail(404,'User not found.');
    if(memberId===context.member_id)fail(409,'Ask another administrator to change your own role or access.');
    if(form.status==='active'&&!member.password_hash&&!context.is_demo)fail(409,'This user must accept an invitation before activation.');
    if(form.status==='invited'&&member.password_hash)fail(409,'Choose Active or Disabled for a user who already accepted their invitation.');
    await client.query('UPDATE members SET role=$3,status=$4 WHERE workspace_id=$1 AND id=$2',[context.workspace_id,memberId,form.role,form.status]);
    if(member.status!==form.status||member.role!==form.role)await client.query('DELETE FROM sessions WHERE workspace_id=$1 AND member_id=$2',[context.workspace_id,memberId]);
    if(form.status==='disabled')await client.query('UPDATE invites SET used_at=now() WHERE workspace_id=$1 AND member_id=$2 AND used_at IS NULL',[context.workspace_id,memberId]);
    await audit(client,context,'User access updated',member.email,form.role+' · '+form.status);
    return {id:memberId};
  }
  return {access,inviteMember,refreshInvite,editMember,invitationUrl};
}
