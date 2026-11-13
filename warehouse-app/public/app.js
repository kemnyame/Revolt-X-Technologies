const root = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toastArea = document.querySelector('#toasts');
const settings = { allowSignup:false, enableDemo:false };
const hashParams = new URLSearchParams(location.hash.slice(1));
const invitation = hashParams.get('invite');
if (invitation) history.replaceState(null,'',location.pathname);
const state = {user:null,dashboard:null,page:'dashboard',auth:invitation?'invite':'login',authNote:'',seq:0,lists:{},products:[]};
const roles={admin:'Administrator',warehouse:'Warehouse operator',sales:'Sales clerk',finance:'Finance officer',viewer:'Viewer'};
const methods={cash:'Cash',credit:'Credit',cheque:'Cheque',momo:'Mobile Money',transfer:'Bank transfer'};
const actions={inbound:'Stock received',sale:'Sale posted','inbound reversal':'Receipt reversed','sale reversal':'Sale reversed',adjustment:'Stock adjustment'};
const nav=[
 ['Workspace',[
  ['dashboard','Overview','grid'],['inventory','Available stock','boxes'],
  ['inbound','Inbound stock','in',['admin','warehouse']],['sales','Sales','receipt',['admin','sales','finance']],
  ['expenses','Expenses','wallet',['admin','finance']],['movements','Stock movements','arrows',['admin','warehouse','finance']]
 ]],
 ['Administration',[
  ['users','Users & access','users',['admin']],['audit','Audit log','shield',['admin']],['settings','Settings','settings',['admin']]
 ]]
];
const paths={
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 boxes:'M12 3 3 8v8l9 5 9-5V8l-9-5z M3 8l9 5 9-5m-9 5v8m-4.5-15.5 9 5',
 in:'M4 16v4h16v-4M12 3v12m-5-5 5 5 5-5',
 receipt:'M5 3h14v18l-3-2-4 2-4-2-3 2z M9 8h6m-6 4h6m-6 4h3',
 wallet:'M4 6h14a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3h11m3 6h-5a3 3 0 0 0 0 6h5m-5-3h.01',
 arrows:'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-4-11a4 4 0 0 1 0 8M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
 shield:'M12 22s7-3 7-9V5l-7-3-7 3v8c0 6 7 9 7 9zm-3-10 2 2 4-4',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M10 2h4l1 3 3 1 3-1 2 3-2 2v4l2 2-2 3-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-3 2-2v-4L1 8l2-3 3 1 3-1z',
 plus:'M12 5v14M5 12h14', download:'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
 search:'M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
 chevron:'m9 6 6 6-6 6', back:'m15 6-6 6 6 6', close:'m6 6 12 12M18 6 6 18',
 menu:'M4 6h16M4 12h16M4 18h16', signout:'M10 4H4v16h6m3-12 4 4-4 4m-5-4h13',
 bell:'M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M10 21h4',
 trend:'m3 17 6-6 4 4 7-9m-6 0h6v6', out:'M12 20V5m-5 5 5-5 5 5M4 16v4h16v-4',
 check:'m4 12 5 5L20 6', clock:'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
 alert:'M12 3 2 20h20L12 3zm0 7v4m0 3h.01'
};
const icon = key => '<svg aria-hidden="true" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[key]+'"/></svg>';
const esc = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => new Intl.NumberFormat('en-GH',{style:'currency',currency:state.user?.currency||'GHS',currencyDisplay:'code'}).format(Number(value||0)/100);
const count = value => new Intl.NumberFormat('en-GH').format(Number(value||0));
const initials = value => String(value||'').trim().split(/\s+/).slice(0,2).map(v=>v[0]||'').join('').toUpperCase();
const date = value => value ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:String(value).length===10?'UTC':state.user?.timezone||'UTC'}).format(new Date(String(value).length===10?value+'T12:00:00Z':value)) : '—';
const day = value => String(value||'').slice(0,10);
const today = () => state.dashboard?.today||new Date().toISOString().slice(0,10);
const can = (...allowed) => allowed.includes(state.user?.role);
const el = id => document.getElementById(id);
const mark = (label,tone='') => '<span class="status '+tone+'">'+esc(label)+'</span>';
const button = (label,classes='',glyph='',attrs='') => '<button type="button" class="btn '+classes+'" '+attrs+'>'+(glyph?icon(glyph):'')+esc(label)+'</button>';
const primary = (label,action,glyph='plus') => button(label,'primary',glyph,'data-action="'+action+'"');
const field = (label,control,full=false) => '<label class="field'+(full?' full':'')+'">'+esc(label)+control+'</label>';
const input = (name,value='',attrs='') => '<input name="'+name+'" value="'+esc(value)+'" '+attrs+'>';
const note = (name,value='',attrs='') => '<textarea name="'+name+'" '+attrs+'>'+esc(value)+'</textarea>';
const select = (name,items,value='',attrs='') => '<select name="'+name+'" '+attrs+'>'+items.map(([key,label])=>'<option value="'+esc(key)+'"'+(key===value?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
const roleChoices=Object.entries(roles);
const currencyChoices=[['GHS','GHS · Ghana cedi'],['USD','USD · US dollar'],['GBP','GBP · British pound'],['EUR','EUR · Euro'],['NGN','NGN · Nigerian naira']];
const timezoneChoices=[['Africa/Accra','Accra · GMT'],['Africa/Lagos','Lagos'],['Europe/London','London'],['Europe/Paris','Paris'],['America/New_York','New York'],['UTC','UTC']];
const paymentChoices=Object.entries(methods);
const dateField = (name='date',value=today(),limited=true) => input(name,value,'type="date" required'+(limited?' max="'+today()+'"':''));
const amountField = (name,value='') => input(name,value,'type="number" min="0" step="0.01" max="100000000" required inputmode="decimal"');
const cents = value => Math.round(Number(value)*100);
const toMajor = minor => (Number(minor||0)/100).toFixed(2);
const roleName = () => roles[state.user?.role]||'';
const paymentTone = status => ({paid:'good',settled:'good',pending:'warn','cheque pending':'warn','part paid':'blue',outstanding:'warn',overdue:'bad',reversed:'bad',rejected:'bad'}[String(status).toLowerCase()]||'');
const title = key => nav.flatMap(([,entries])=>entries).find(([name])=>name===key)?.[1]||'Overview';

function toast(message,bad=false){
  const box=document.createElement('div');
  box.className='toast'+(bad?' error':'');
  box.textContent=message;
  toastArea.append(box);
  setTimeout(()=>box.remove(),4200);
}
async function request(path,{method='GET',body,key,quiet=false}={}){
  const headers={accept:'application/json'};
  if (body!==undefined) headers['content-type']='application/json';
  if (key) headers['idempotency-key']=key;
  const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store'});
  const value=await response.json().catch(()=>null);
  if(!response.ok){
    if(response.status===401&&!quiet&&state.user){
      state.user=null;
      if(dialog.open)dialog.close();
      state.auth='login';
      state.authNote='Your session ended. Sign in to continue.';
      renderAuth();
    }
    throw Object.assign(Error(value?.error||'The request could not be completed. Try again.'),{status:response.status});
  }
  return value;
}
function submit(form,handler){
  const submitButton=form.querySelector('[type=submit]');
  const error=form.querySelector('[data-form-error]');
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(submitButton.disabled)return;
    submitButton.disabled=true;
    if(error)error.textContent='';
    try { await handler(Object.fromEntries(new FormData(form)),form); }
    catch(err){ if(error)error.textContent=err.message; else toast(err.message,true); }
    finally { submitButton.disabled=false; }
  });
}
const errorBox = '<div class="notice error form-error" data-form-error role="alert"></div>';
const authHeading={
 login:['Sign in','Enter your workspace code and account details.'],
 signup:['Create a business workspace','Start with an empty warehouse and invite your team.'],
 recover:['Reset password','Use the recovery code you saved when setting up your account.'],
 invite:['Accept your invitation','Create a password to activate your warehouse account.']
};
const hero=String.raw`<svg class="hero" viewBox="0 0 500 250" fill="none" aria-hidden="true">
  <defs><pattern id="lattice" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0 0h28v28" stroke="#fff" stroke-opacity=".08"/></pattern></defs>
  <rect width="500" height="250" fill="url(#lattice)"/>
  <g stroke="#7da995" stroke-width="1.5" opacity=".8"><path d="M20 212h455M54 189h380M79 166h332M108 142h281M139 119h221M166 96h171M195 73h116"/><path d="m31 212 207-154m-134 154L247 58m-68 154 76-154m1 154 7-154m70 154L273 58m134 154L281 58m194 154L290 58"/></g>
  <g stroke="#bfdccb" stroke-width="1.9" stroke-linejoin="round">
    <path fill="#2b5142" d="m102 104 53-28 57 27-55 30z"/><path fill="#244a3c" d="m102 104 55 29v66l-55-29z"/><path fill="#3f6956" d="m157 133 55-30v66l-55 30z"/>
    <path d="m127 91 55 29v28l-11 6v-28l-55-29" opacity=".8"/>
    <path fill="#2b5142" d="m221 62 58-32 64 31-62 34z"/><path fill="#244a3c" d="m221 62 60 33v72l-60-32z"/><path fill="#3f6956" d="m281 95 62-34v72l-62 34z"/>
    <path d="m248 47 63 31v33l-12 6V84l-62-32" opacity=".8"/>
    <path fill="#315846" d="m300 134 44-25 49 24-47 27z"/><path fill="#244a3c" d="m300 134 46 26v54l-46-25z"/><path fill="#416c59" d="m346 160 47-27v54l-47 27z"/>
    <path d="m319 123 50 24v23l-10 6v-23l-49-25" opacity=".8"/>
  </g>
  <g stroke="#b4d2c2" stroke-width="1.4" opacity=".85"><path d="M55 79h16m-8-8v16m341-25h16m-8-8v16M77 132h8m-4-4v8m355 17h10m-5-5v10"/></g>
</svg>`;
function authControls(){
  const email=field('Email address',input('email','','type="email" autocomplete="username" required maxlength="254"'));
  const pass=field(state.auth==='login'?'Password':'New password',input('password','','type="password" autocomplete="'+(state.auth==='login'?'current-password':'new-password')+'" required maxlength="128"'+(state.auth==='login'?'':' minlength="12"')));
  const code=field('Workspace code',input('workspace',localStorage.getItem('rx-wh-workspace')||'','autocomplete="organization" required maxlength="64" placeholder="business-a1234567"'));
  if(state.auth==='signup')return field('Business name',input('business','','autocomplete="organization" required maxlength="120"'))+
    field('Your name',input('name','','autocomplete="name" required maxlength="120"'))+email+
    '<div class="form-grid">'+field('Currency',select('currency',currencyChoices,'GHS'))+field('Time zone',select('timezone',timezoneChoices,'Africa/Accra'))+'</div>'+pass;
  if(state.auth==='recover')return code+email+field('Recovery code',input('recoveryCode','','required maxlength="43" autocomplete="off"'))+pass;
  if(state.auth==='invite')return pass;
  return code+email+pass;
}
function renderAuth(){
  const [heading,sub]=authHeading[state.auth];
  root.innerHTML='<div class="auth-shell"><section class="auth-story" aria-label="About Revolt-X Warehouse">'+
    '<div class="brand"><img src="/mark.svg" alt=""><span><strong>Revolt-X</strong><small>Warehouse Management</small></span></div>'+
    '<div class="kicker">Inventory and sales</div><h1>Track stock from receipt to sale</h1>'+
    '<p>Record imported shipments, see what is available, and follow payments and expenses across your business.</p>'+hero+
    '<footer>Revolt-X Technologies</footer></section><main class="auth-side" id="main-content"><section class="auth-card">'+
    '<div class="kicker">Warehouse workspace</div><h2>'+heading+'</h2><p>'+sub+'</p>'+
    (state.authNote?'<div class="notice">'+esc(state.authNote)+'</div>':'')+
    '<form id="auth-form">'+authControls()+errorBox+'<button class="btn primary" type="submit">'+heading+icon('chevron')+'</button></form>'+
    '<div class="auth-switch">'+(state.auth==='login'?
      (settings.allowSignup?'<button class="link-button" data-auth="signup">Create a workspace</button>':'')+'<button class="link-button" data-auth="recover">Forgot your password?</button>':
      '<button class="link-button" data-auth="login">Back to sign in</button>')+'</div>'+
    (settings.enableDemo&&state.auth==='login'?'<div class="auth-demo"><span><strong>Explore with sample data</strong><p>Fictional stock, customers and users</p></span>'+button('Open demo','','boxes','id="demo-start"')+'</div>':'')+
    '</section></main></div>';
  root.querySelectorAll('[data-auth]').forEach(item=>item.onclick=()=>{
    state.auth=item.dataset.auth;state.authNote='';renderAuth();
  });
  submit(el('auth-form'),async values=>{
    const kind=state.auth;
    if(kind==='invite')values.token=invitation;
    const result=await request('/api/auth/'+(kind==='invite'?'accept':kind),{method:'POST',body:values,quiet:true});
    if(result.workspace)localStorage.setItem('rx-wh-workspace',result.workspace);
    else if(kind==='login')localStorage.setItem('rx-wh-workspace',values.workspace);
    if(kind==='recover'){
      state.auth='login';
      state.authNote='Password updated. Sign in with your new password.';
      renderAuth();
      showRecovery(result);
      return;
    }
    await openWorkspace();
    if(result.recoveryCode)showRecovery(result);
  });
  if(el('demo-start'))el('demo-start').onclick=async()=>{
    const trigger=el('demo-start');
    trigger.disabled=true;trigger.textContent='Opening demo…';
    try{await request('/api/auth/demo',{method:'POST',body:{},quiet:true});await openWorkspace();}
    catch(err){trigger.disabled=false;trigger.textContent='Open demo';toast(err.message,true);}
  };
}

function openDialog(heading,subtitle,body,wide=false){
  dialog.classList.toggle('wide',wide);
  dialog.innerHTML='<div class="dialog-head"><div><h2 id="dialog-title">'+esc(heading)+'</h2>'+
    (subtitle?'<p>'+esc(subtitle)+'</p>':'')+'</div>'+button('Close','small no-print','close','data-dialog-close')+
    '</div><div class="dialog-body">'+body+'</div>';
  dialog.querySelector('[data-dialog-close]').onclick=()=>dialog.close();
  if(!dialog.open)dialog.showModal();
  dialog.scrollTop=0;
}
function copyValue(id){
  const input=el(id);
  (navigator.clipboard?navigator.clipboard.writeText(input.value):Promise.reject()).then(()=>toast('Copied.'),()=>{input.select();toast('Select and copy the value.');});
}
function showRecovery({workspace,recoveryCode}){
  openDialog('Save your sign-in details','Keep the recovery code somewhere secure.',
    '<div class="notice warn">This code is shown once. It is required if you forget your password.</div><div class="detail-section form-grid">'+
    field('Workspace code',input('workspace',workspace,'readonly'))+
    field('Recovery code',input('code',recoveryCode,'readonly id="recovery-code"'),true)+'</div>'+
    '<div class="form-footer">'+button('Copy recovery code','','','id="copy-recovery"')+button('Done','primary','','data-done')+'</div>');
  el('copy-recovery').onclick=()=>copyValue('recovery-code');
  dialog.querySelector('[data-done]').onclick=()=>dialog.close();
}
function showInvite(url){
  openDialog('Invitation link','Share this link privately with the intended team member.',
    '<div class="notice">The link expires in three days and can be used once.</div><div class="detail-section">'+
    field('Invitation link',input('invite',url,'readonly id="copy-invite"'))+'</div><div class="form-footer">'+
    button('Copy link','primary','','id="copy-invite-button"')+'</div>');
  el('copy-invite-button').onclick=()=>copyValue('copy-invite');
}
function formDialog(heading,subtitle,controls,label,handler,{wide=false,documentBody=''}={}){
  openDialog(heading,subtitle,'<form id="dialog-form">'+errorBox+'<div class="form-grid">'+controls+'</div>'+documentBody+
    '<div class="form-footer">'+button('Cancel','','','data-cancel')+'<button class="btn primary" type="submit">'+esc(label)+'</button></div></form>',wide);
  const form=el('dialog-form');
  form.querySelector('[data-cancel]').onclick=()=>dialog.close();
  submit(form,handler);
  return form;
}
function writer(path,method='POST'){
  let previous='',key='';
  return body=>{
    const fingerprint=JSON.stringify(body);
    if(fingerprint!==previous){previous=fingerprint;key=crypto.randomUUID();}
    return request(path,{method,body,key});
  };
}
async function saved(message,next=state.page){
  if(dialog.open)dialog.close();
  toast(message);
  await go(next);
}
const brand='<div class="brand"><img src="/mark.svg" alt=""><span><strong>Revolt-X</strong><small>Warehouse Management</small></span></div>';
function navItem([id,label,glyph,allowed]){
  if(allowed&&!can(...allowed))return '';
  return '<button class="nav-item" data-page="'+id+'"'+(state.page===id?' aria-current="page"':'')+'>'+icon(glyph)+esc(label)+'</button>';
}
function renderShell(){
  const u=state.user;
  root.innerHTML='<div class="shell"><aside class="sidebar" id="sidebar">'+brand+
    '<div class="workspace-chip"><div class="avatar">'+esc(initials(u.workspace_name))+'</div><span><strong>'+esc(u.workspace_name)+'</strong><small>'+esc(u.is_demo?'Demo workspace':u.slug)+'</small></span></div>'+
    '<nav aria-label="Warehouse navigation">'+nav.map(([name,entries])=>{const links=entries.map(navItem).join('');return links?'<div class="nav-group"><div class="nav-label">'+name+'</div>'+links+'</div>':'';}).join('')+'</nav>'+
    '<div class="sidebar-person"><div class="avatar">'+esc(initials(u.member_name))+'</div><span><strong>'+esc(u.member_name)+'</strong><small>'+roleName()+'</small></span>'+
    '<button type="button" title="Sign out" aria-label="Sign out" id="sign-out">'+icon('signout')+'</button></div></aside>'+
    '<main id="main-content"><header class="topbar"><div class="crumb">'+button('Menu','menu-button small','menu','id="menu-button" aria-expanded="false"')+
    '<span class="crumb-root">Warehouse</span><span class="crumb-chevron">'+icon('chevron')+'</span><strong id="breadcrumb">'+title(state.page)+'</strong></div>'+
    '<div class="top-actions">'+(u.is_demo?'<span class="demo-tag">Demo workspace</span>':'<span class="live-tag">Live workspace</span>')+
    '<div class="avatar top-avatar" title="'+esc(u.member_name)+'">'+esc(initials(u.member_name))+'</div></div></header>'+
    '<div id="workspace-content" class="content"></div></main></div>';
  el('menu-button').onclick=()=>{
    const expanded=el('sidebar').classList.toggle('open');
    el('menu-button').setAttribute('aria-expanded',String(expanded));
  };
  root.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));
  el('sign-out').onclick=async()=>{
    try {
      await request('/api/auth/logout',{method:'POST',body:{},quiet:true});
      state.user=null;state.dashboard=null;state.auth='login';state.authNote='';state.lists={};state.products=[];
      renderAuth();
    } catch(err){toast(err.message,true);}
  };
}
async function openWorkspace(existing){
  state.user=existing||await request('/api/session',{quiet:true});
  state.page='dashboard';
  state.lists={};
  renderShell();
  await go('dashboard');
}
function allowedPage(page){
  const entry=nav.flatMap(([,entries])=>entries).find(([id])=>id===page);
  return Boolean(entry&&(!entry[3]||can(...entry[3])));
}
async function go(page,filter){
  if(!state.user||!allowedPage(page))return;
  const seq=++state.seq;
  state.page=page;
  if(filter!==undefined)state.lists[page]={q:'',filter,page:1};
  const target=el('workspace-content');
  const previous=target.querySelector('h1')?.textContent;
  if((page==='dashboard'&&!previous)||(previous!==title(page)&&page!=='dashboard'))target.innerHTML='<div class="loading" role="status">Loading '+esc(title(page).toLowerCase())+'…</div>';
  el('breadcrumb').textContent=title(page);
  el('sidebar').classList.remove('open');
  el('menu-button').setAttribute('aria-expanded','false');
  root.querySelectorAll('[data-page]').forEach(item=>{if(item.dataset.page===page)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
  try{
    if(page==='dashboard'){
      const result=await request('/api/dashboard');
      if(seq!==state.seq)return;
      state.dashboard=result;
      renderDashboard(result);
    } else if(page==='settings')renderSettings();
    else{
      const query=state.lists[page]??={q:'',filter:page==='inventory'?'active':'',page:1};
      const result=await request('/api/'+page+'?'+new URLSearchParams(query));
      if(seq!==state.seq)return;
      renderList(page,result,query);
    }
  }catch(error){
    if(seq===state.seq&&state.user)target.innerHTML=pageHeader(title(page),'')+'<div class="notice error" role="alert">'+esc(error.message)+'</div>';
  }
}

function pageHeader(heading,sub,actions='',kicker=''){
  return '<div class="page-intro"><div>'+(kicker?'<div class="kicker">'+esc(kicker)+'</div>':'')+
    '<h1>'+esc(heading)+'</h1>'+(sub?'<p>'+esc(sub)+'</p>':'')+'</div>'+(actions?'<div class="actions">'+actions+'</div>':'')+'</div>';
}
const metric = (name,value,sub,glyph,tone='') => '<article class="metric"><div class="metric-heading">'+esc(name)+
  '<span class="metric-icon '+tone+'">'+icon(glyph)+'</span></div><strong class="metric-value">'+esc(value)+'</strong><small>'+esc(sub)+'</small></article>';
const empty = (message,glyph='boxes') => '<div class="empty">'+icon(glyph)+esc(message)+'</div>';
const panelHead = (name,sub,action='') => '<div class="panel-header"><div><h2>'+esc(name)+'</h2>'+
  (sub?'<p>'+esc(sub)+'</p>':'')+'</div>'+action+'</div>';
function table(columns,rows){
  if(!rows.length)return empty('No matching records.');
  return '<div class="scroll-table"><table><thead><tr>'+columns.map(([name,,cls])=>'<th scope="col" class="'+(cls||'')+'">'+esc(name)+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(([,value,cls])=>'<td class="'+(cls||'')+'">'+value(row)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function trendChart(rows){
  const amounts=rows.map(row=>Number(row.amount));
  const width=550,height=155,pad=44,ceiling=Math.max(100,Math.ceil(Math.max(...amounts)/4/100)*400);
  const points=amounts.map((amount,i)=>[pad+i*(width-pad-16)/Math.max(1,rows.length-1),height-27-(amount/ceiling)*(height-47)]);
  const path=points.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' ');
  const labels=rows.map(row=>new Intl.DateTimeFormat('en-GB',{weekday:'short',timeZone:'UTC'}).format(new Date(day(row.day)+'T12:00:00Z')));
  return '<svg class="chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Seven-day sales trend">'+
    '<defs><linearGradient id="area-fill" x2="0" y2="1"><stop stop-color="#a8cfbc" stop-opacity=".45"/><stop offset="1" stop-color="#e9f4ed" stop-opacity=".08"/></linearGradient></defs>'+
    Array.from({length:5},(_,i)=>{const y=height-27-i*(height-47)/4;return '<path class="gridline" d="M'+pad+' '+y+'H'+(width-13)+'"/><text x="'+(pad-8)+'" y="'+(y+4)+'" text-anchor="end">'+esc(count(ceiling*i/400))+'</text>';}).join('')+
    (points.length?'<path d="'+path+'L'+points.at(-1)[0]+' '+(height-27)+'H'+pad+'Z" fill="url(#area-fill)"/><path class="chart-line" d="'+path+'"/>':'')+
    points.map(([x,y],i)=>'<circle class="point" cx="'+x+'" cy="'+y+'" r="3"><title>'+esc(date(rows[i].day)+' · '+money(amounts[i]))+'</title></circle>'+
      '<text x="'+x+'" y="'+(height-8)+'" text-anchor="middle">'+labels[i]+'</text>').join('')+'</svg>';
}
function paymentChart(rows){
  const colours={cash:'#34775f',credit:'#71a893',cheque:'#d7aa5b',momo:'#88a8bc'};
  const ordered=['cash','credit','cheque','momo'].map(method=>({method,amount:Number(rows.find(row=>row.method===method)?.amount||0),transactions:Number(rows.find(row=>row.method===method)?.transactions||0)}));
  const total=ordered.reduce((sum,row)=>sum+row.amount,0), transactions=ordered.reduce((sum,row)=>sum+row.transactions,0);
  let offset=0;
  const arcs=ordered.map(row=>{
    const portion=total?row.amount/total*100:0;
    const segment=portion?'<circle cx="66" cy="66" r="49" fill="none" stroke="'+colours[row.method]+'" stroke-width="15" pathLength="100" stroke-dasharray="'+Math.max(0,portion-1.2)+' '+(100-Math.max(0,portion-1.2))+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 66 66)"/>':'';
    offset+=portion;return segment;
  }).join('');
  return '<div class="donut-wrap"><svg class="donut" viewBox="0 0 132 132" role="img" aria-label="Sales totals by payment method">'+
    '<circle cx="66" cy="66" r="49" fill="none" stroke="#edf1ef" stroke-width="15"/>'+arcs+
    '<text x="66" y="64" font-size="22" font-weight="680" text-anchor="middle">'+count(transactions)+'</text>'+
    '<text class="donut-label" x="66" y="80" font-size="10" text-anchor="middle">sales this month</text></svg><div class="legend">'+
    ordered.map(row=>'<div class="legend-row"><span><i class="dot '+row.method+'"></i>'+methods[row.method]+'</span><strong>'+esc(money(row.amount))+'</strong></div>').join('')+'</div></div>';
}
function renderDashboard(report){
  const {stock,finance}=report;
  const cards=metric('Available stock',count(stock.units),'Across '+count(stock.skus)+' active products','boxes')+
    (finance?metric('Sales this month',money(finance.sales),'Posted sales','trend','blue')+
      metric('Outstanding balances',money(finance.outstanding),Number(finance.pending)>0?money(finance.pending)+' in pending cheques':'All unpaid sales','clock','amber'):
      metric('Active products',count(stock.skus),'Inventory catalogue','boxes','blue')+
      metric('Stock valuation',stock.stock_value===undefined?'—':money(stock.stock_value),'Using catalogue costs','wallet','slate'))+
    metric('Low-stock items',count(stock.low),'At or below reorder level','alert','amber');
  const shortcuts=(can('admin','warehouse')?button('Receive stock','','in','data-action="new-inbound"'):'')+(can('admin','sales')?primary('New sale','new-sales'):'');
  const activity=report.activity.length?'<div class="activity-list">'+report.activity.map(row=>
    '<div class="activity-row"><div class="activity-product"><div class="activity-icon '+(row.delta<0?'out':'')+'">'+icon(row.delta<0?'out':'in')+
    '</div><div><strong>'+esc(row.name)+'</strong><small>'+esc(actions[row.kind])+' · '+esc(row.reference)+'</small></div></div>'+
    '<div class="activity-amount '+(row.delta<0?'neg':'pos')+'">'+(row.delta>0?'+':'')+count(row.delta)+' <span class="subdued">'+esc(row.unit)+'</span></div></div>').join('')+'</div>':
    empty('Stock activity appears here once you receive or sell products.','arrows');
  const low=report.low.length?table([
    ['Product',row=>'<strong>'+esc(row.name)+'</strong><small>'+esc(row.sku)+'</small>'],
    ['Available',row=>mark(count(row.quantity)+' '+row.unit,row.quantity?'warn':'bad'),'num'],
    ['Reorder at',row=>count(row.reorder_point),'num']
  ],report.low):empty('No products are at their reorder level.','check');
  const movements=allowedPage('movements')?button('View ledger','small','chevron','data-go="movements"'):'';
  const chartRow=finance?
    '<div class="dashboard-row"><section class="panel">'+panelHead('Sales trend','Posted sales over the last 7 days','<span class="status good">7 days</span>')+
    '<div class="panel-body"><strong class="chart-total">'+esc(money(report.trend.reduce((sum,row)=>sum+Number(row.amount),0)))+'</strong></div><div class="chart-wrap">'+trendChart(report.trend)+'</div></section>'+
    '<section class="panel">'+panelHead('Sales by payment method','This month')+paymentChart(report.paymentBreakdown)+'</section></div>':'';
  el('workspace-content').innerHTML=pageHeader('Warehouse overview','Stock, sales and warehouse activity at a glance.',shortcuts,'Warehouse operations')+
    '<div class="metric-grid">'+cards+'</div>'+chartRow+
    '<div class="dashboard-row"><section class="panel">'+panelHead('Recent stock activity','Latest posted movements',movements)+activity+'</section>'+
    '<section class="panel list-panel">'+panelHead('Low-stock alerts','Products to review for replenishment',button('View all','small','chevron','data-go="inventory" data-filter="low"'))+low+'</section></div>';
  bindPageActions();
}

const display = {
  inventory:{description:'Check quantities, locations and reorder levels across your catalogue.',create:'Add product',filters:[['active','Active products'],['low','Low stock'],['archived','Archived'],['','All products']]},
  inbound:{description:'Receive shipments and add imported stock to the warehouse.',create:'Receive stock',filters:[['','All receipts'],['posted','Posted'],['reversed','Reversed']]},
  sales:{description:'Record sales and track settled payments, outstanding credit and cheques.',create:'New sale',filters:[['','All sales'],['cash','Cash'],['credit','Credit'],['cheque','Cheque'],['momo','Mobile Money'],['paid','Paid'],['outstanding','Outstanding'],['part paid','Part paid'],['cheque pending','Cheque pending'],['overdue','Overdue'],['reversed','Reversed']]},
  expenses:{description:'Track operating costs, payees and payment references.',create:'Record expense',filters:[['','All expenses'],['posted','Posted'],['reversed','Reversed']]},
  movements:{description:'Review the quantities received, sold, reversed or adjusted.',filters:[['','All movements'],['inbound','Inbound'],['sale','Sales'],['adjustment','Adjustments'],['inbound reversal','Inbound reversals'],['sale reversal','Sale reversals']]},
  users:{description:'Manage invitations and role-based access to this workspace.',create:'Invite user',filters:[['','All users'],['active','Active'],['invited','Invited'],['disabled','Disabled'],...roleChoices]},
  audit:{description:'Review who made each recorded change and when it happened.',filters:[['','All activity']]}
};
function rowButton(label,action,id){
  return button(label,'small','','data-action="'+action+'" data-id="'+esc(id)+'"');
}
const refLink = (row,page) => '<button type="button" class="link-button reference" data-action="view-'+page+'" data-id="'+esc(row.id)+'">'+esc(row.reference)+'</button>';
const financialView = () => can('admin','finance');
const stockEdit = () => can('admin','warehouse');
const productStatus = row => row.archived?mark('Archived'):!row.quantity?mark('Out of stock','bad'):
  row.quantity<=row.reorder_point?mark('Low stock','warn'):mark('In stock','good');
function columns(page){
  if(page==='inventory')return [
    ['Product',r=>'<strong>'+esc(r.name)+'</strong><small>'+esc(r.sku)+'</small>'],
    ['Category',r=>esc(r.category)],['Location',r=>esc(r.location)],['Available',r=>count(r.quantity)+' '+esc(r.unit),'num'],
    ['Reorder level',r=>count(r.reorder_point),'num'],['Sale price',r=>esc(money(r.price_minor)),'num'],
    ['Status',productStatus],...(stockEdit()?[['Actions',r=>rowButton('Edit','edit-product',r.id)+
      (can('admin')&&!r.archived?' '+rowButton('Adjust','adjust-product',r.id):'')]]:[])
  ];
  if(page==='inbound')return [
    ['Receipt',r=>refLink(r,page)],['Supplier',r=>esc(r.supplier)],['Shipment',r=>esc(r.shipment||'—')],
    ['Received',r=>esc(date(r.received_on))],['Receipt cost',r=>esc(money(r.total_minor)),'num'],
    ['Status',r=>r.voided_at?mark('Reversed','bad'):mark('Posted','good')]
  ];
  if(page==='sales')return [
    ['Sale',r=>refLink(r,page)],['Customer',r=>esc(r.customer)],['Date',r=>esc(date(r.sold_on))],
    ['Method',r=>esc(methods[r.method])],['Total',r=>esc(money(r.total_minor)),'num'],
    ['Amount owing',r=>esc(money(r.balance_minor)),'num'],['Status',r=>mark(r.status,paymentTone(r.status))+
      (r.overdue&&r.status!=='Overdue'?' '+mark('Overdue','bad'):'')]
  ];
  if(page==='expenses')return [
    ['Expense',r=>refLink(r,page)],['Payee',r=>esc(r.payee)],['Category',r=>esc(r.category)],
    ['Paid on',r=>esc(date(r.paid_on))],['Method',r=>esc(methods[r.method])],['Amount',r=>esc(money(r.amount_minor)),'num'],
    ['Status',r=>r.voided_at?mark('Reversed','bad'):mark('Posted','good')]
  ];
  if(page==='movements')return [
    ['Reference',r=>'<span class="reference">'+esc(r.reference)+'</span>'],['Product',r=>'<strong>'+esc(r.name)+'</strong><small>'+esc(r.sku)+'</small>'],
    ['Movement',r=>esc(actions[r.kind])],['Change',r=>'<strong class="'+(r.delta>0?'pos':'neg')+'">'+(r.delta>0?'+':'')+count(r.delta)+' '+esc(r.unit)+'</strong>','num'],
    ['Balance after',r=>count(r.balance_after),'num'],['Effective date',r=>esc(date(r.effective_on))]
  ];
  if(page==='users')return [
    ['User',r=>'<strong>'+esc(r.name)+'</strong><small>'+esc(r.email)+'</small>'],['Role',r=>esc(roles[r.role])],
    ['Status',r=>mark(r.status[0].toUpperCase()+r.status.slice(1),r.status==='active'?'good':r.status==='invited'?'warn':'')],
    ['Added',r=>esc(date(r.created_at))],['Actions',r=>r.id===state.user.member_id?'<span class="subdued">Your account</span>':
      rowButton('Edit access','edit-user',r.id)+(r.status==='invited'&&!state.user.is_demo?' '+rowButton('New invite link','renew-invite',r.id):'')]
  ];
  return [
    ['When',r=>esc(date(r.created_at))+'<small>'+esc(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:state.user.timezone}).format(new Date(r.created_at)))+'</small>'],
    ['User',r=>esc(r.actor_name)],['Action',r=>esc(r.action)],['Reference',r=>'<span class="reference">'+esc(r.reference)+'</span>'],['Details',r=>esc(r.detail||'—')]
  ];
}
function createAction(page){
  if(page==='inventory')return stockEdit();
  if(page==='inbound')return stockEdit();
  if(page==='sales')return can('admin','sales');
  if(page==='expenses')return financialView();
  if(page==='users')return can('admin')&&!state.user.is_demo;
  return false;
}
function renderList(page,result,query){
  const def=display[page];
  const max=Math.max(1,Math.ceil(result.total/result.pageSize));
  if(query.page>max){
    query.page=max;
    void go(page);
    return;
  }
  state.visibleRows=result.rows;
  const newAction=page==='inventory'?'new-product':page==='users'?'new-user':'new-'+page;
  const headerAction=createAction(page)?primary(def.create,newAction):'';
  const range=result.total?((result.page-1)*result.pageSize+1)+'–'+Math.min(result.page*result.pageSize,result.total)+' of '+count(result.total):'0 records';
  const titleText=title(page);
  el('workspace-content').innerHTML=pageHeader(titleText,def.description,headerAction)+
    (page==='users'&&state.user.is_demo?'<p class="notice warn">Sample team members are fictional. Create a business workspace to invite your own team.</p>':'')+
    '<section class="panel list-panel" aria-label="'+titleText+' records"><div class="list-tools"><form id="list-filter">'+
    '<div class="search-box">'+icon('search')+input('q',query.q,'aria-label="Search records" maxlength="120" placeholder="Search records"')+'</div>'+
    (def.filters.length>1?select('filter',def.filters,query.filter,'aria-label="Filter records"'):'')+
    '<button class="btn" type="submit">Search</button></form>'+button('Export CSV','','download','data-action="export"')+'</div>'+
    table(columns(page),result.rows)+'<div class="page-nav"><span>'+range+'</span><div class="inline">'+
    button('Previous','small','','id="previous-page"'+(result.page<=1?' disabled':''))+
    button('Next','small','','id="next-page"'+(result.page>=max?' disabled':''))+'</div></div></section>';
  const filters=el('list-filter');
  filters.onsubmit=event=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(filters));
    state.lists[page]={q:values.q.trim(),filter:values.filter||'',page:1};
    void go(page);
  };
  if(filters.elements.filter)filters.elements.filter.onchange=()=>filters.requestSubmit();
  el('previous-page').onclick=()=>{query.page--;void go(page);};
  el('next-page').onclick=()=>{query.page++;void go(page);};
  bindPageActions();
}
function renderSettings(){
  const u=state.user;
  el('workspace-content').innerHTML=pageHeader('Settings','Manage workspace preferences and review what each role can do.')+
    '<div class="settings-grid"><section class="panel">'+panelHead('Workspace details','Share the workspace code with invited staff.')+
    '<div class="panel-body"><form id="settings-form">'+errorBox+'<div class="form-grid">'+
    field('Workspace name',input('name',u.workspace_name,'required maxlength="120"'),true)+
    field('Workspace code',input('code',u.slug,'readonly'),true)+
    field('Currency',select('currency',currencyChoices,u.currency))+field('Time zone',select('timezone',timezoneChoices,u.timezone))+
    '</div><div class="form-footer"><button type="submit" class="btn primary">Save settings</button></div></form></div></section>'+
    '<section class="panel">'+panelHead('Access by role','Permissions apply within this workspace.')+
    '<div class="panel-body role-guide">'+[
      ['Administrator','Manage stock, sales, finance, users and the audit log.'],
      ['Warehouse operator','Manage products, receive shipments and view stock movements.'],
      ['Sales clerk','View available stock and post sales.'],
      ['Finance officer','Review sales, record payments and expenses, and reconcile cheques.'],
      ['Viewer','See available stock and low-stock alerts.']
    ].map(([name,description])=>'<div><strong>'+name+'</strong><small>'+description+'</small></div>').join('')+'</div></section></div>';
  const write=writer('/api/workspace','PUT');
  submit(el('settings-form'),async values=>{
    delete values.code;
    await write(values);
    state.user=await request('/api/session');
    renderShell();
    toast('Settings saved.');
    await go('settings');
  });
}

function productForm(row){
  const edit=Boolean(row);
  const write=writer('/api/inventory'+(edit?'/'+row.id:''),edit?'PUT':'POST');
  const controls=field('Product name',input('name',row?.name,'required maxlength="120"'),true)+
    field('SKU',input('sku',row?.sku,'required maxlength="48" placeholder="e.g. EL-1005"'))+
    field('Category',input('category',row?.category,'required maxlength="80"'))+
    field('Unit',input('unit',row?.unit||'pcs','required maxlength="24"'))+
    field('Bin or location',input('location',row?.location,'required maxlength="60" placeholder="e.g. A-05"'))+
    field('Reorder point',input('reorderPoint',row?.reorder_point??0,'type="number" min="0" max="1000000000" step="1" required'))+
    field('Catalogue unit cost',amountField('cost',row?toMajor(row.cost_minor):''))+
    field('Default sale price',amountField('price',row?toMajor(row.price_minor):''))+
    (edit?field('Product status',select('status',[['active','Active'],['archived','Archived']],row.archived?'archived':'active')):'');
  formDialog(edit?'Edit product':'Add product',edit?'Update the catalogue information. Use a stock adjustment to change the quantity.':'Receive a shipment to add quantity after creating the product.',controls,edit?'Save product':'Add product',async values=>{
    const {name,sku,category,unit,location}=values;
    await write({name,sku,category,unit,location,reorderPoint:Number(values.reorderPoint),costMinor:cents(values.cost),priceMinor:cents(values.price),...(edit?{archived:values.status==='archived'}:{})});
    await saved(edit?'Product updated.':'Product added.','inventory');
  });
}
function adjustProduct(row){
  const write=writer('/api/inventory/'+row.id+'/adjust');
  formDialog('Adjust stock',row.name+' · '+row.quantity+' '+row.unit+' currently available',
    field('Quantity change',input('delta','','type="number" step="1" min="-1000000" max="1000000" required'),true)+
    field('Reason',note('reason','','required maxlength="240" placeholder="e.g. Physical stock count correction"'),true),
    'Post adjustment',async values=>{const result=await write({delta:Number(values.delta),reason:values.reason});await saved('Adjustment posted · '+result.reference,'inventory');});
}
async function stockDocument(isSale){
  const write=writer(isSale?'/api/sales':'/api/inbound');
  const initial=await request('/api/products/options');
  if(!initial.length){
    openDialog(isSale?'New sale':'Receive stock','','<p class="notice warn">Add an active product to the inventory catalogue first.</p>');
    return;
  }
  const people=isSale?field('Customer',input('customer','','required maxlength="120"'),true):field('Supplier',input('supplier','','required maxlength="120"'));
  const when=field(isSale?'Sale date':'Received date',dateField());
  const extra=isSale?field('Payment method',select('method',paymentChoices.filter(([key])=>key!=='transfer'),'cash'))+
    '<div id="due-control" hidden>'+field('Credit due date',dateField('dueOn','',false))+'</div>'+
    '<div id="payment-control" hidden>'+field('Payment reference',input('reference','','maxlength="120"'))+'</div>':
    field('Shipment or import reference',input('shipment','','maxlength="120"'),true);
  const controls=people+when+extra+field('Notes',note('notes','','maxlength="500"'),true);
  const lineArea='<div class="line-wrap"><div class="line-head"><h3>Items</h3>'+button('Add line','small','plus','id="add-line"')+'</div>'+
    '<div id="line-search"></div><div class="line-headers"><span>Product</span><span>Quantity</span><span>'+
    (isSale?'Unit price':'Unit cost')+'</span><span>Subtotal</span><span></span></div><div id="line-items"></div>'+
    '<div id="document-total" class="doc-total"></div></div>';
  const form=formDialog(isSale?'New sale':'Receive inbound stock',isSale?'Posting a sale reduces available stock immediately.':'Posting a receipt adds its quantities to available stock.',
    controls,isSale?'Post sale':'Post receipt',async values=>{
    const lines=Array.from(el('line-items').querySelectorAll('.line')).map(line=>({
      productId:line.querySelector('select').value,quantity:Number(line.querySelector('[name=lineQuantity]').value),
      [isSale?'priceMinor':'costMinor']:cents(line.querySelector('[name=lineAmount]').value)
    }));
    const payload=isSale?{customer:values.customer,date:values.date,method:values.method,dueOn:values.method==='credit'?values.dueOn:null,reference:values.reference,notes:values.notes,lines}:
      {supplier:values.supplier,date:values.date,shipment:values.shipment,notes:values.notes,lines};
    const result=await write(payload);
    await saved((isSale?'Sale posted':'Stock received')+' · '+result.reference,isSale?'sales':'inbound');
  },{wide:true,documentBody:lineArea});
  let products=initial;
  const lineItems=el('line-items');
  const picker=document.createElement('div');
  picker.className='toolbar form-grid';
  picker.innerHTML=field('Find a product',input('productSearch','','aria-label="Find a product" maxlength="120" placeholder="Search by SKU or name"'))+
    '<div class="inline">'+button('Find','small','search','id="find-product"')+'</div>';
  form.querySelector('#line-search').replaceWith(picker);
  function productOptions(selected){
    const options=[['','Select product'],...products.map(p=>[p.id,p.sku+' · '+p.name+' ('+p.quantity+' '+p.unit+' available)'])];
    return select('product',options,selected||'','required aria-label="Product"');
  }
  function calculate(){
    let total=0;
    for(const line of lineItems.querySelectorAll('.line')){
      const sub=Number(line.querySelector('[name=lineQuantity]').value)*cents(line.querySelector('[name=lineAmount]').value);
      line.querySelector('output').textContent=money(sub);total+=sub;
    }
    el('document-total').textContent='Total '+money(total);
  }
  function addLine(){
    if(lineItems.children.length>=40){toast('A document can contain up to 40 items.',true);return;}
    const line=document.createElement('div');
    line.className='line';
    line.innerHTML=productOptions()+
      input('lineQuantity',1,'aria-label="Quantity" type="number" min="1" max="1000000" step="1" required')+
      amountField('lineAmount')+'<output></output>'+button('×','small','','title="Remove line" aria-label="Remove line" data-remove-line');
    line.querySelector('[name=lineAmount]').setAttribute('aria-label',isSale?'Unit price':'Unit cost');
    line.addEventListener('change',event=>{
      if(event.target.name==='product'){
        const p=products.find(item=>item.id===event.target.value);
        line.querySelector('[name=lineAmount]').value=p?toMajor(isSale?p.price_minor:p.cost_minor):'';
      }
      calculate();
    });
    line.addEventListener('input',calculate);
    line.querySelector('[data-remove-line]').onclick=()=>{
      if(lineItems.children.length===1)return;
      line.remove();calculate();
    };
    lineItems.append(line);calculate();
  }
  el('add-line').onclick=addLine;
  el('find-product').onclick=async()=>{
    try{
      const query=form.elements.productSearch.value.trim();
      const matches=await request('/api/products/options?'+new URLSearchParams({q:query}));
      if(!form.isConnected)return;
      const chosen=Array.from(lineItems.querySelectorAll('select')).map(control=>control.value);
      products=[...new Map([...products.filter(p=>chosen.includes(p.id)),...matches].map(p=>[p.id,p])).values()];
      Array.from(lineItems.querySelectorAll('select')).forEach((control,i)=>{
        const wrapper=document.createElement('div');wrapper.innerHTML=productOptions(chosen[i]);
        control.replaceWith(wrapper.firstElementChild);
      });
      if(!matches.length)toast('No active products match that search.',true);
    }catch(error){toast(error.message,true);}
  };
  form.elements.productSearch.onkeydown=event=>{
    if(event.key==='Enter'){event.preventDefault();el('find-product').click();}
  };
  if(isSale){
    const configure=()=>{
      const method=form.elements.method.value, credit=method==='credit';
      const reference=method==='cheque'||method==='momo';
      el('due-control').hidden=!credit;
      form.elements.dueOn.required=credit;
      el('payment-control').hidden=!reference;
      form.elements.reference.required=reference;
      form.elements.reference.placeholder=method==='cheque'?'Cheque number':'Mobile Money transaction ID';
    };
    form.elements.method.onchange=configure;
    configure();
  }
  addLine();
}
function expenseForm(){
  const write=writer('/api/expenses');
  const form=formDialog('Record expense','Add a payment already made for a warehouse operating cost.',
    field('Payee',input('payee','','required maxlength="120"'))+
    field('Category',input('category','','required maxlength="80" placeholder="e.g. Freight"'))+
    field('Paid on',dateField())+field('Amount',amountField('amount'))+
    field('Payment method',select('method',paymentChoices.filter(([key])=>key!=='credit'),'cash'))+
    field('Payment reference',input('reference','','maxlength="120"'))+
    field('Description',note('description','','required maxlength="500"'),true),
    'Record expense',async values=>{const {amount,...fields}=values;const result=await write({...fields,amountMinor:cents(amount)});await saved('Expense recorded · '+result.reference,'expenses');});
  form.elements.method.onchange=()=>{form.elements.reference.required=form.elements.method.value!=='cash';};
}
function userForm(row){
  const write=writer(row?'/api/users/'+row.id:'/api/users',row?'PUT':'POST');
  const controls=(row?'':field('Full name',input('name','','required maxlength="120"'),true)+
    field('Email address',input('email','','required type="email" maxlength="254"'),true))+
    field('Role',select('role',roleChoices,row?.role||'viewer'))+
    (row?field('Status',select('status',row.status==='invited'?[['invited','Invited'],['disabled','Disabled']]:
      row.status==='disabled'?[['disabled','Disabled'],['active','Active'],['invited','Reinvite if not yet activated']]:[['active','Active'],['disabled','Disabled']],row.status)):'');
  formDialog(row?'Edit access':'Invite a user',row?row.name+' · '+row.email:'Create a one-time link for this team member.',
    controls,row?'Save access':'Create invitation',async values=>{
      const result=await write(values);
      await saved(row?'User access updated.':'Invitation created.','users');
      if(result.invitationUrl)showInvite(result.invitationUrl);
    });
}
function receiptControls(label,value){
  return '<div class="detail-cell"><span>'+esc(label)+'</span><strong>'+esc(value??'—')+'</strong></div>';
}
function printDocument(){
  document.body.classList.add('printing');
  try{window.print();}finally{document.body.classList.remove('printing');}
}
async function showDocument(page,id){
  const doc=await request('/api/'+page+'/'+id);
  const isSale=page==='sales', inbound=page==='inbound';
  const heading=isSale?'Sale':inbound?'Inbound receipt':'Expense';
  const details=isSale?[
    ['Customer',doc.customer],['Sale date',date(doc.sold_on)],['Payment method',methods[doc.method]],['Total',money(doc.total_minor)],
    ['Amount paid',money(doc.paid_minor)],['Amount owing',money(doc.balance_minor)],['Pending cheques',money(doc.pending_minor)],
    ['Credit due',date(doc.due_on)],['Status',doc.status]
  ]:inbound?[
    ['Supplier',doc.supplier],['Shipment',doc.shipment],['Received',date(doc.received_on)],['Total cost',money(doc.total_minor)],['Status',doc.voided_at?'Reversed':'Posted']
  ]:[
    ['Payee',doc.payee],['Category',doc.category],['Date',date(doc.paid_on)],['Payment method',methods[doc.method]],['Payment reference',doc.payment_reference],
    ['Amount',money(doc.amount_minor)],['Status',doc.voided_at?'Reversed':'Posted']
  ];
  const documentLines=doc.lines?'<section class="detail-section"><h3>Items</h3>'+table([
    ['SKU',r=>esc(r.sku)],['Product',r=>esc(r.name)],['Quantity',r=>count(r.quantity)+' '+esc(r.unit),'num'],
    [isSale?'Unit price':'Unit cost',r=>esc(money(isSale?r.price_minor:r.cost_minor)),'num'],
    ['Subtotal',r=>esc(money(r.quantity*Number(isSale?r.price_minor:r.cost_minor))),'num']
  ],doc.lines)+'</section>':'';
  const paymentRows=isSale?'<section class="detail-section"><h3>Payment history</h3>'+table([
    ['Received',r=>esc(date(r.received_on))],['Method',r=>esc(methods[r.method])],['Reference',r=>esc(r.reference||'—')],
    ['Amount',r=>esc(money(r.amount_minor)),'num'],['Status',r=>mark(r.status,paymentTone(r.status))],
    ...(financialView()&&!doc.voided_at?[['Actions',r=>r.status==='pending'?rowButton('Clear cheque','clear-cheque',r.id)+' '+rowButton('Reject cheque','reject-cheque',r.id):'']]:[])
  ],doc.payments)+'</section>':'';
  const remaining=Number(doc.balance_minor||0)-Number(doc.pending_minor||0);
  const reverseAllowed=!doc.voided_at&&(isSale||inbound?can('admin'):financialView());
  openDialog(heading+' '+doc.reference,state.user.workspace_name,
    '<div class="detail-grid">'+details.map(pair=>receiptControls(...pair)).join('')+'</div>'+
    (doc.void_reason?'<div class="notice warn">Reversal reason: '+esc(doc.void_reason)+'</div>':'')+
    ((doc.notes||doc.description)?'<p class="muted">'+esc(doc.notes||doc.description)+'</p>':'')+documentLines+paymentRows+
    '<div class="form-footer no-print">'+
    (reverseAllowed?button('Reverse '+heading.toLowerCase(),'danger','','data-reverse'):'')+
    button('Print / Save PDF','','','data-print')+
    (isSale&&financialView()&&remaining>0&&!doc.voided_at?button('Record payment','primary','','data-add-payment'):'')+
    '</div>',true);
  dialog.querySelector('[data-print]').onclick=printDocument;
  if(reverseAllowed)dialog.querySelector('[data-reverse]').onclick=()=>reverseDocument(page,doc);
  dialog.querySelector('[data-add-payment]')?.addEventListener('click',()=>paymentForm(doc,remaining));
  dialog.querySelectorAll('[data-action$="-cheque"]').forEach(trigger=>trigger.onclick=()=>{
    const payment=doc.payments.find(r=>r.id===trigger.dataset.id);
    chequeForm(doc,payment,trigger.dataset.action==='clear-cheque');
  });
}
function reverseDocument(page,doc){
  const write=writer('/api/'+page+'/'+doc.id+'/reverse');
  const noteText=page==='sales'?'Stock will be returned and recorded payments marked reversed. Handle any refund separately.':
    page==='inbound'?'The original quantities will be removed if sufficient stock is still available.':'The expense will be marked reversed and kept in the history.';
  formDialog('Reverse '+doc.reference,noteText,field('Reason',note('reason','','required maxlength="240"'),true),'Confirm reversal',
    async values=>{await write(values);await saved(doc.reference+' reversed.',page);});
}
function paymentForm(sale,remaining){
  const write=writer('/api/sales/'+sale.id+'/payments');
  const form=formDialog('Record payment',sale.reference+' · '+money(remaining)+' available for payment',
    field('Payment amount',amountField('amount',toMajor(remaining)))+field('Received on',dateField())+
    field('Method',select('method',paymentChoices.filter(([key])=>['cash','momo','cheque'].includes(key)),'cash'))+
    field('Payment reference',input('reference','','maxlength="120"')),
    'Save payment',async values=>{
      const {amount,...rest}=values;
      await write({...rest,amountMinor:cents(amount)});
      toast('Payment recorded.');void go('sales');await showDocument('sales',sale.id);
    });
  form.elements.method.onchange=()=>{form.elements.reference.required=form.elements.method.value!=='cash';};
}
function chequeForm(sale,payment,clear){
  const write=writer('/api/sales/'+sale.id+'/payments/'+payment.id+'/decision');
  formDialog(clear?'Clear cheque':'Reject cheque',sale.reference+' · '+payment.reference+' · '+money(payment.amount_minor),
    field(clear?'Cleared on':'Rejected on',dateField(),true)+
    (!clear?field('Reason',note('reason','','required maxlength="240"'),true):''),
    clear?'Mark as cleared':'Mark as rejected',async values=>{
      await write({...values,action:clear?'clear':'reject'});
      toast(clear?'Cheque cleared.':'Cheque rejected.');void go('sales');await showDocument('sales',sale.id);
    });
}
async function perform(trigger){
  const name=trigger.dataset.action,id=trigger.dataset.id;
  const row=state.visibleRows?.find(item=>item.id===id);
  if(name==='new-product')return productForm();
  if(name==='edit-product'&&row)return productForm(row);
  if(name==='adjust-product'&&row)return adjustProduct(row);
  if(name==='new-inbound'||name==='new-sales')return stockDocument(name==='new-sales');
  if(name==='new-expenses')return expenseForm();
  if(name==='new-user')return userForm();
  if(name==='edit-user'&&row)return userForm(row);
  if(name==='renew-invite'&&row){
    const write=writer('/api/users/'+id+'/invite');
    formDialog('Replace invitation link',row.name+' · '+row.email,'<p class="notice full">Any earlier invitation link for this user will expire.</p>','Create new link',
      async()=>showInvite((await write({})).invitationUrl));
    return;
  }
  if(name==='export'){
    const {q,filter}=state.lists[state.page];
    const url='/api/'+state.page+'/export?'+new URLSearchParams({q,filter});
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok){const error=await response.json().catch(()=>null);throw Error(error?.error||'Export could not be downloaded.');}
    const objectUrl=URL.createObjectURL(await response.blob());
    const link=document.createElement('a');link.href=objectUrl;link.download='warehouse-'+state.page+'.csv';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
    return;
  }
  if(name.startsWith('view-'))return showDocument(name.slice(5),id);
}
function bindPageActions(){
  const panel=el('workspace-content');
  panel.querySelectorAll('[data-go]').forEach(trigger=>trigger.onclick=()=>go(trigger.dataset.go,trigger.dataset.filter));
  panel.querySelectorAll('[data-action]').forEach(trigger=>trigger.onclick=async()=>{
    trigger.disabled=true;
    try{await perform(trigger);}
    catch(error){toast(error.message,true);}
    finally{trigger.disabled=false;}
  });
}
async function boot(){
  try{
    Object.assign(settings,await request('/api/public',{quiet:true}));
    if(invitation){renderAuth();return;}
    const user=await request('/api/session',{quiet:true}).catch(error=>{if(error.status!==401)throw error;return null;});
    if(user)await openWorkspace(user);
    else renderAuth();
  }catch(error){
    root.innerHTML='<div class="startup"><img src="/mark.svg" alt="" width="44" height="44"><strong>Revolt-X Warehouse</strong>'+
      '<p role="alert">'+esc(error.message)+'</p>'+button('Try again','primary','','id="boot-retry"')+'</div>';
    el('boot-retry').onclick=boot;
  }
}
void boot();
