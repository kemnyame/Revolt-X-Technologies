'use strict';
const $ = (id) => document.getElementById(id);
const state = {
  page:'birthdays',filter:'upcoming',data:{staff:[],summary:{},reminder_days:30},
  calendar:new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1)),
  selectedDay:null,editId:null,greetingId:null,history:[],query:''
};
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
function escapeHtml(value){const d=document.createElement('div');d.textContent=String(value??'');return d.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function shortDate(value){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(String(value)+'T00:00:00Z'));}
function dayLabel(d){return d===0?'Today':d===1?'Tomorrow':'In '+d+' days';}
function nameOf(s){return [s.first_name,s.last_name].filter(Boolean).join(' ');}
function formatStaffBirthday(s){
  return String(s.birth_day).padStart(2,'0')+'/'+String(s.birth_month).padStart(2,'0')+
    (s.birth_year!==null&&s.birth_year!==undefined?'/'+s.birth_year:'');
}
function initials(s){return ((s.first_name||'?')[0]+(s.last_name||'?')[0]).toUpperCase();}
function avatar(s){
  const color=(s.staff_code||'').split('').reduce((a,x)=>a+x.charCodeAt(0),0)%5;
  const safeName=escapeHtml(nameOf(s));
  return s.avatar_url&&s.avatar_url.startsWith('https://')
    ? '<img class="avatar" alt="'+safeName+'" src="'+escapeHtml(s.avatar_url)+'" loading="lazy" referrerpolicy="no-referrer"/>'
    : '<span class="avatar color-'+color+'" aria-label="'+safeName+'">'+escapeHtml(initials(s))+'</span>';
}
function personInfo(s){
  return '<div class="person-info">'+avatar(s)+'<div class="person-description"><h3>'+escapeHtml(nameOf(s))+'</h3><p>'+escapeHtml(s.job_title||s.department||s.staff_code)+'</p></div></div>';
}
let toastTimer;
function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4500);}
async function api(url,options={}){
  const config={credentials:'same-origin',...options};
  if(options.body&&!(options.body instanceof FormData)){config.headers={'Content-Type':'application/json',...(options.headers||{})};config.body=JSON.stringify(options.body);}
  const res=await fetch(url,config);
  const type=res.headers.get('content-type')||'';
  const body=type.includes('application/json')?await res.json():null;
  if(!res.ok){
    if(res.status===401&&url!=='/api/login')showLogin();
    throw new Error(body?.error||'The request could not be completed.');
  }
  return body;
}
function showLogin(){
  $('loading').classList.add('hidden');$('shell').classList.add('hidden');
  $('passwordChangeLayer').classList.add('hidden');$('authLayer').classList.remove('hidden');
  $('loginError').textContent='';
}
function showApp(){
  $('loading').classList.add('hidden');$('authLayer').classList.add('hidden');
  $('passwordChangeLayer').classList.add('hidden');$('shell').classList.remove('hidden');
}
function showRequiredPasswordChange(email){
  $('loading').classList.add('hidden');$('shell').classList.add('hidden');
  $('authLayer').classList.add('hidden');$('passwordChangeLayer').classList.remove('hidden');
  $('firstPasswordEmail').textContent=email;
  $('firstPasswordForm').reset();
  $('firstPasswordError').textContent='';
}
async function download(url,fallback){
  try{
    const res=await fetch(url,{credentials:'same-origin'});
    if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error||'Export could not be completed.');}
    const name=res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||fallback;
    const blob=await res.blob(),href=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=href;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(href),30000);toast('Excel file downloaded.');
  }catch(e){toast(e.message);}
}
const visible = () => state.data.staff.filter(s=>s.employment_status==='active'&&!s.hide_from_celebrations);
const pending = (s) => s.days_until<=state.data.reminder_days&&!s.greeted;
async function refresh(silent=false){
  try{
    const data=await api('/api/overview');state.data=data;
    $('reminderDays').value=String(data.reminder_days||30);
    renderAll();
    if(!silent)toast('Birthday records updated.');
  }catch(e){if(e.message)toast(e.message);}
}
function renderAll(){
  renderBanner();renderBirthdays();renderCalendar();renderStats();renderDirectory();
  $('navBadge').textContent=String(state.data.summary.pending||0);
  $('topBadge').textContent=String(state.data.summary.pending||0);
}
function renderBanner(){
  const s=visible().sort((a,b)=>a.days_until-b.days_until)[0];
  const today=visible().filter(p=>p.days_until===0);
  if(today.length){
    const first=today[0];
    $('bannerEyebrow').textContent='Today · '+today.length+' birthday'+(today.length===1?'':'s');
    $('bannerTitle').textContent='Happy Birthday, '+first.first_name+'!';
    $('bannerSubtitle').textContent='Wishing '+first.first_name+' a wonderful day filled with happiness, success and good health.';
    $('bannerButton').textContent='Send a message →';
    $('bannerButton').onclick=()=>openGreeting(first.id);
  }else if(s){
    $('bannerEyebrow').textContent=dayLabel(s.days_until)+' · On the calendar';
    $('bannerTitle').textContent=s.first_name+"'s birthday is coming up!";
    $('bannerSubtitle').textContent='Help make the day special. '+shortDate(s.next_birthday)+' is just around the corner.';
    $('bannerButton').textContent='Prepare a message →';
    $('bannerButton').onclick=()=>openGreeting(s.id);
  }else{
    $('bannerEyebrow').textContent='Your team, celebrated';
    $('bannerTitle').textContent='Every birthday matters.';
    $('bannerSubtitle').textContent='Add your staff to see birthdays, reminders and celebrations here.';
    $('bannerButton').textContent='Add your first staff member →';
    $('bannerButton').onclick=()=>openStaff();
  }
}
function birthdaysForFilter(){
  const base=visible();
  if(state.filter==='upcoming')return base.filter(s=>s.days_until<=30).sort((a,b)=>a.days_until-b.days_until);
  if(state.filter==='pending')return base.filter(pending).sort((a,b)=>a.days_until-b.days_until);
  if(state.filter==='month')return base.filter(s=>s.birth_month===new Date().getUTCMonth()+1)
    .sort((a,b)=>a.birth_day-b.birth_day);
  if(state.filter==='calendar'&&state.selectedDay){
    const sel=state.selectedDay;
    const leap=sel.year%4===0&&(sel.year%100!==0||sel.year%400===0);
    return base.filter(s=>s.birth_month===sel.month&&(s.birth_day===sel.day||
      (sel.month===2&&sel.day===28&&!leap&&s.birth_day===29)));
  }
  return base.sort((a,b)=>a.days_until-b.days_until);
}
function renderBirthdays(){
  const names={upcoming:'Upcoming Birthdays',month:'Birthdays This Month',all:'All Birthdays',pending:'Pending Birthday Greetings',calendar:'Birthdays on selected date'};
  $('listTitle').textContent=names[state.filter];
  document.querySelectorAll('.pill-tab').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
  const search=state.query.toLowerCase();
  const list=birthdaysForFilter().filter(s=>(nameOf(s)+' '+s.department+' '+s.job_title+' '+s.staff_code).toLowerCase().includes(search));
  $('listCount').textContent=list.length+' '+(list.length===1?'person':'people');
  if(!list.length){
    $('birthdayList').innerHTML='<div class="empty-state"><span class="empty-illustration">🎂</span><h3>No birthdays to show</h3><p>'+(state.data.staff.length?'Try another filter or search for someone else.':'Your team celebration list will appear once staff birthdays are added.')+'</p></div>';
    return;
  }
  const today=new Date();
  $('birthdayList').innerHTML=list.map(s=>{
    const inMonth=state.filter==='month';
    const calendarSelected=state.filter==='calendar';
    const displayDate=(inMonth||calendarSelected)
      ? String(s.birth_day).padStart(2,'0')+' '+months[s.birth_month-1]
      : shortDate(s.next_birthday);
    const monthNote=inMonth
      ? (s.birth_day===today.getUTCDate()?'Today':s.birth_day<today.getUTCDate()?'Earlier this month':'Later this month')
      : calendarSelected?'Birthday on this date':s.greeted?'✓ Celebrated':dayLabel(s.days_until);
    return '<article class="person-row">'+personInfo(s)+
      '<div class="person-date"><span aria-hidden="true">▦</span><div><strong>'+displayDate+'</strong><small>'+monthNote+'</small></div></div>'+
      '<button class="person-action" data-message="'+escapeHtml(s.id)+'">✉ &nbsp; Send Message</button></article>';
  }).join('');
}
function renderCalendar(){
  const view=state.calendar,y=view.getUTCFullYear(),m=view.getUTCMonth();
  $('calendarMonth').textContent=months[m]+' '+y;
  const offset=(new Date(Date.UTC(y,m,1)).getUTCDay()+6)%7;
  const length=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const today=new Date(),todayY=today.getUTCFullYear(),todayM=today.getUTCMonth(),todayD=today.getUTCDate();
  let html='';
  for(let i=0;i<offset;i++)html+='<span aria-hidden="true"></span>';
  for(let d=1;d<=length;d++){
    const has=visible().some(s=>s.birth_month===m+1&&(s.birth_day===d||(s.birth_day===29&&m===1&&d===28&&
      !(y%4===0&&(y%100!==0||y%400===0)))));
    const isToday=y===todayY&&m===todayM&&d===todayD;
    const selected=state.selectedDay&&state.selectedDay.year===y&&state.selectedDay.month===m+1&&state.selectedDay.day===d;
    html+='<button class="calendar-day'+(has?' dot':'')+(isToday?' today':'')+(selected?' selected':'')+'" aria-label="'+d+' '+months[m]+' '+y+
      (has?', birthdays':'')+'" data-day="'+d+'">'+d+'</button>';
  }
  $('calendarGrid').innerHTML=html;
}
function renderStats(){
  $('statMonth').textContent=state.data.summary.month||0;
  $('statStaff').textContent=state.data.summary.active||0;
  $('statUpcoming').textContent=state.data.summary.upcoming||0;
}
function renderDirectory(){
  const staff=state.data.staff;
  const existing=$('departmentFilter').value;
  const departments=[...new Set(staff.map(s=>s.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  $('departmentFilter').innerHTML='<option value="">All departments</option>'+departments.map(d=>'<option value="'+escapeHtml(d)+'">'+escapeHtml(d)+'</option>').join('');
  if(departments.includes(existing))$('departmentFilter').value=existing;
  const dep=$('departmentFilter').value,status=$('statusFilter').value,search=state.query.toLowerCase();
  const list=staff.filter(s=>(!dep||s.department===dep)&&(!status||s.employment_status===status)&&
    (nameOf(s)+' '+s.staff_code+' '+s.phone_number+' '+s.department+' '+s.job_title+' '+s.email).toLowerCase().includes(search));
  $('directoryCount').textContent=list.length+' staff';
  if(!list.length){
    $('staffTable').innerHTML='<div class="empty-state"><span class="empty-illustration">👥</span><h3>No staff found</h3><p>Add staff manually or import them from Excel.</p></div>';
    return;
  }
  $('staffTable').innerHTML='<table class="directory-table"><thead><tr>'+
    '<th>Staff ID</th><th>Name</th><th>Number</th><th>Birthday</th><th>Department</th><th>Job Title</th><th>Email</th><th>Action</th>'+
    '</tr></thead><tbody>'+
    list.map(s=>'<tr><td><strong>'+escapeHtml(s.staff_code)+'</strong></td>'+
      '<td>'+personInfo(s)+'</td>'+
      '<td>'+escapeHtml(s.phone_number||'—')+'</td>'+
      '<td>'+escapeHtml(formatStaffBirthday(s))+'</td>'+
      '<td>'+escapeHtml(s.department||'—')+'</td>'+
      '<td>'+escapeHtml(s.job_title||'—')+'</td>'+
      '<td>'+escapeHtml(s.email||'—')+'</td>'+
      '<td><button class="small-action" data-edit="'+escapeHtml(s.id)+'">Edit</button></td></tr>').join('')+
    '</tbody></table>';
}
async function renderHistory(){
  try{
    const r=await api('/api/history');state.history=r.history;
    if(!r.history.length){
      $('greetingHistory').innerHTML='<div class="empty-state"><span class="empty-illustration">💌</span><h3>No greetings recorded yet</h3><p>As you celebrate colleagues, you can mark their birthdays as acknowledged.</p></div>';return;
    }
    $('greetingHistory').innerHTML='<table class="directory-table"><thead><tr><th>Colleague</th><th>Staff ID</th><th>Birthday</th><th>Recorded on</th><th>Note</th></tr></thead><tbody>'+
      r.history.map(x=>'<tr><td><strong>'+escapeHtml(x.first_name+' '+x.last_name)+'</strong></td><td>'+escapeHtml(x.staff_code)+'</td><td>'+shortDate(x.birthday_on)+'</td><td>'+
        new Date(x.created_at).toLocaleDateString('en-GB')+'</td><td>'+escapeHtml(x.note||'Marked as celebrated')+'</td></tr>').join('')+'</tbody></table>';
  }catch(e){toast(e.message);}
}
async function renderImports(){
  try{
    const r=await api('/api/imports');
    $('importHistory').innerHTML=r.runs.length?r.runs.map(run=>'<div class="import-run"><div><strong>'+escapeHtml(run.filename)+'</strong><small>'+
      new Date(run.created_at).toLocaleString('en-GB')+'</small></div><div>'+
      run.inserted+' added · '+run.updated+' updated · '+run.skipped+' skipped</div>'+
      (run.errors?.length?'<div class="import-errors">'+run.errors.map(e=>'Row '+e.row+': '+escapeHtml(e.reason)).join('<br>')+'</div>':'')+'</div>').join('')
      :'<p class="muted">No imports yet. Download the Excel template from Staff Directory to get started.</p>';
  }catch(e){toast(e.message);}
}
function navigate(page){
  if(!['birthdays','staff','history','settings','admins'].includes(page))return;
  state.page=page;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('hidden',p.id!=='page-'+page));
  document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});
  if(page==='history')renderHistory();
  if(page==='settings')renderImports();
  if(page==='admins')renderAdmins();
}
function openStaff(id=null){
  state.editId=id;
  const form=$('staffForm');
  form.reset();$('staffError').textContent='';
  $('staffModalTitle').textContent=id?'Edit staff member':'Add staff member';
  if(id){
    const s=state.data.staff.find(x=>x.id===id);
    if(!s)return toast('Staff record not found.');
    const fields={
      staff_code:s.staff_code,
      name:nameOf(s),
      number:s.phone_number||'',
      birthday:formatStaffBirthday(s),
      department:s.department||'',
      job_title:s.job_title||'',
      email:s.email||''
    };
    for(const [key,value] of Object.entries(fields)){
      const input=form.elements.namedItem(key);
      if(input)input.value=value;
    }
  }
  $('staffDialog').showModal();
}
async function saveStaff(e){
  e.preventDefault();
  const form=$('staffForm'),data=Object.fromEntries(new FormData(form).entries());
  if(state.editId){
    const existing=state.data.staff.find(s=>s.id===state.editId);
    // Preserve existing admin-only account/status/privacy fields while simplifying the form.
    data.avatar_url=existing?.avatar_url||'';
    data.employment_status=existing?.employment_status||'active';
    data.hide_from_celebrations=!!existing?.hide_from_celebrations;
  }
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{
    await api('/api/staff'+(state.editId?'/'+state.editId:''),{
      method:state.editId?'PUT':'POST',body:data
    });
    $('staffDialog').close();
    await refresh(true);
    toast(state.editId?'Staff member updated.':'Staff member added.');
  }catch(err){$('staffError').textContent=err.message;}
  finally{button.disabled=false;}
}
function openGreeting(id){
  const s=state.data.staff.find(x=>x.id===id);
  if(!s)return toast('Staff member not found.');
  state.greetingId=id;
  $('greetingTitle').textContent='Celebrate '+s.first_name;
  $('greetingHint').textContent='Birthday: '+shortDate(s.next_birthday)+(s.email?' · '+s.email:' · No email address recorded');
  $('greetingText').value='Happy Birthday, '+s.first_name+'! Wishing you a wonderful year ahead, filled with happiness, good health and success. Thank you for all you do!';
  $('emailGreeting').disabled=!s.email;
  $('markCelebrated').disabled=s.greeted;
  $('markCelebrated').textContent=s.greeted?'✓ Already marked as celebrated':'✓ Mark as celebrated';
  $('greetingDialog').showModal();
}
async function markGreeting(){
  if(!state.greetingId)return;
  $('markCelebrated').disabled=true;
  try{
    await api('/api/greetings',{method:'POST',body:{staff_id:state.greetingId,note:$('greetingText').value.slice(0,1000)}});
    $('greetingDialog').close();await refresh(true);toast('Birthday marked as celebrated.');
  }catch(e){$('markCelebrated').disabled=false;toast(e.message);}
}
function sendGreetingEmail(){
  const s=state.data.staff.find(x=>x.id===state.greetingId);
  if(!s?.email)return toast('Add a staff email address first.');
  const subject='Happy Birthday, '+s.first_name+'!';
  const mailto='mailto:'+s.email+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent($('greetingText').value);
  window.location.href=mailto;
}
async function importExcel(e){
  e.preventDefault();
  const form=$('importForm'),result=$('importResult'),button=form.querySelector('button[type=submit]');
  result.textContent='Validating and importing records...';button.disabled=true;
  try{
    const r=await api('/api/import',{method:'POST',body:new FormData(form)});
    result.innerHTML='<strong>Import complete.</strong> '+r.inserted+' added, '+r.updated+' updated, '+r.skipped+' skipped.'+
      (r.errors?.length?'<p class="import-errors">'+r.errors.map(x=>'Row '+x.row+': '+escapeHtml(x.reason)).join('<br>')+'</p>':'')+
      (r.more_errors?'<p>Additional invalid rows were skipped.</p>':'');
    form.reset();await refresh(true);
    toast('Birthday import completed.');if(state.page==='settings')renderImports();
  }catch(e){result.innerHTML='<p class="import-errors">'+escapeHtml(e.message)+'</p>';}finally{button.disabled=false;}
}
async function renderAdmins(){
  try{
    const data=await api('/api/admins'),list=data.admins||[];
    if(!list.length){
      $('adminTable').innerHTML='<div class="empty-state"><h3>No administrators found</h3></div>';
      return;
    }
    $('adminTable').innerHTML='<table class="directory-table"><thead><tr>'+
      '<th>Administrator</th><th>Account status</th><th>Initial password</th><th>Last login</th><th>Actions</th></tr></thead><tbody>'+
      list.map(a=>{
        const self=a.id===data.current_admin_id;
        const status=a.is_active?'<span class="status-chip">Active</span>':'<span class="status-chip inactive">Suspended</span>';
        const first=a.must_change_password?'<span class="privacy-chip">Change required</span>':'<span class="status-chip">Completed</span>';
        const last=a.last_login_at?new Date(a.last_login_at).toLocaleString('en-GB'):'Not yet';
        const actions=self?'<span class="muted">Current account</span>':
          '<button type="button" class="small-action" data-reset-admin="'+escapeHtml(a.id)+'" '+(!a.is_active?'disabled':'')+'>Reset password</button> '+
          '<button type="button" class="small-action" data-toggle-admin="'+escapeHtml(a.id)+'" data-active="'+(a.is_active?'false':'true')+'">'+
          (a.is_active?'Suspend':'Reactivate')+'</button>';
        return '<tr><td><strong>'+escapeHtml(a.full_name||'Administrator')+
          '</strong><br/><span class="muted">'+escapeHtml(a.email)+'</span></td><td>'+status+'</td><td>'+first+
          '</td><td>'+escapeHtml(last)+'</td><td>'+actions+'</td></tr>';
      }).join('')+'</tbody></table>';
  }catch(e){toast(e.message);}
}
function openAdminForm(){
  $('adminDialogTitle').textContent='Add administrator';
  $('adminForm').reset();
  $('adminFormError').textContent='';
  $('adminForm').classList.remove('hidden');
  $('adminCredentialPanel').classList.add('hidden');
  $('adminTemporaryPassword').textContent='';
  $('adminDialog').showModal();
}
function showAdminCredential(admin,password,heading){
  $('adminForm').classList.add('hidden');
  $('adminDialogTitle').textContent='Temporary password generated';
  $('adminCredentialPanel').classList.remove('hidden');
  $('adminCredentialHeading').textContent=heading;
  $('adminCredentialEmail').textContent=admin.email;
  $('adminTemporaryPassword').textContent=password;
  if(!$('adminDialog').open)$('adminDialog').showModal();
}
async function createAdmin(e){
  e.preventDefault();
  const button=$('adminForm').querySelector('button[type="submit"]');
  button.disabled=true;$('adminFormError').textContent='';
  try{
    const result=await api('/api/admins',{method:'POST',body:{
      full_name:$('adminName').value.trim(),email:$('adminEmail').value.trim()
    }});
    showAdminCredential(result.admin,result.temporary_password,'Administrator created successfully');
    await renderAdmins();
  }catch(err){$('adminFormError').textContent=err.message;}finally{button.disabled=false;}
}
async function resetAdminPassword(id){
  if(!window.confirm('Reset this administrator password? Their existing sessions will be signed out.'))return;
  try{
    const result=await api('/api/admins/'+encodeURIComponent(id)+'/reset-password',{method:'POST'});
    showAdminCredential(result.admin,result.temporary_password,'Password reset successfully');
    await renderAdmins();
  }catch(err){toast(err.message);}
}
async function setAdminStatus(id,isActive){
  if(!window.confirm((isActive?'Reactivate':'Suspend')+' this administrator account?'))return;
  try{
    await api('/api/admins/'+encodeURIComponent(id)+'/status',{method:'PATCH',body:{is_active:isActive}});
    await renderAdmins();toast(isActive?'Administrator reactivated.':'Administrator suspended.');
  }catch(err){toast(err.message);}
}
async function changeInitialPassword(e){
  e.preventDefault();
  const current=$('firstCurrentPassword').value;
  const next=$('firstNewPassword').value;
  const confirm=$('firstConfirmPassword').value;
  const error=$('firstPasswordError');
  error.textContent='';
  if(next!==confirm){error.textContent='The new passwords do not match.';return;}
  if(next===current){error.textContent='Your new password must be different from your temporary password.';return;}
  const button=$('firstPasswordForm').querySelector('button[type="submit"]');button.disabled=true;
  try{
    await api('/api/account/password',{method:'POST',body:{current,next}});
    $('firstPasswordForm').reset();
    showApp();
    navigate('birthdays');
    await refresh(true);
    toast('Password changed. Welcome to Birthday Management!');
  }catch(err){error.textContent=err.message;}finally{button.disabled=false;}
}
async function init(){
  try{
    const user=await api('/api/me');$('profileEmail').textContent=user.email;
    if(user.must_change_password){showRequiredPasswordChange(user.email);return;}
    showApp();await refresh(true);
  }catch{showLogin();}
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const submit=e.target.querySelector('[type=submit]');submit.disabled=true;
  $('loginError').textContent='';
  try{
    const user=await api('/api/login',{method:'POST',body:{email:$('loginEmail').value,password:$('loginPassword').value}});
    $('profileEmail').textContent=user.email;$('loginPassword').value='';
    if(user.must_change_password){showRequiredPasswordChange(user.email);return;}
    showApp();await refresh(true);
  }catch(err){$('loginError').textContent=err.message;}finally{submit.disabled=false;}
});
async function logout(){try{await api('/api/logout',{method:'POST'});}catch{}showLogin();}
$('logoutButton').addEventListener('click',logout);
$('firstPasswordSignout').addEventListener('click',logout);
$('firstPasswordForm').addEventListener('submit',changeInitialPassword);
$('addAdminButton').addEventListener('click',openAdminForm);
$('adminForm').addEventListener('submit',createAdmin);
$('adminTable').addEventListener('click',e=>{
  const reset=e.target.closest('[data-reset-admin]');
  if(reset){resetAdminPassword(reset.dataset.resetAdmin);return;}
  const toggle=e.target.closest('[data-toggle-admin]');
  if(toggle)setAdminStatus(toggle.dataset.toggleAdmin,toggle.dataset.active==='true');
});
$('copyAdminPassword').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('adminTemporaryPassword').textContent);toast('Temporary password copied.');}
  catch{toast('Select the temporary password and copy it manually.');}
});
$('adminCredentialDone').addEventListener('click',()=>$('adminDialog').close());
$('adminDialog').addEventListener('close',()=>{
  // Plaintext temporary passwords live only in this one-time dialog.
  $('adminTemporaryPassword').textContent='';
  $('adminCredentialEmail').textContent='';
  $('adminForm').reset();$('adminCredentialPanel').classList.add('hidden');
});
document.querySelectorAll('.nav-link').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
$('mobileMenuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
$('globalSearch').addEventListener('input',e=>{state.query=e.target.value;renderBirthdays();renderDirectory();});
$('notificationButton').addEventListener('click',()=>{navigate('birthdays');state.filter='pending';renderBirthdays();});
document.querySelectorAll('.pill-tab').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;state.selectedDay=null;renderBirthdays();renderCalendar();}));
$('refreshButton').addEventListener('click',()=>refresh());
$('addFromHome').addEventListener('click',()=>openStaff());
$('addStaffButton').addEventListener('click',()=>openStaff());
$('staffForm').addEventListener('submit',saveStaff);
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$((b.dataset.close)).close()));
$('birthdayList').addEventListener('click',e=>{const b=e.target.closest('[data-message]');if(b)openGreeting(b.dataset.message);});
$('staffTable').addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)openStaff(b.dataset.edit);});
$('departmentFilter').addEventListener('change',renderDirectory);
$('statusFilter').addEventListener('change',renderDirectory);
$('calendarGrid').addEventListener('click',e=>{
  const b=e.target.closest('[data-day]');if(!b)return;
  state.selectedDay={year:state.calendar.getUTCFullYear(),month:state.calendar.getUTCMonth()+1,day:Number(b.dataset.day)};
  state.filter='calendar';renderCalendar();renderBirthdays();
});
$('prevMonth').addEventListener('click',()=>{state.calendar=new Date(Date.UTC(state.calendar.getUTCFullYear(),state.calendar.getUTCMonth()-1,1));renderCalendar();});
$('nextMonth').addEventListener('click',()=>{state.calendar=new Date(Date.UTC(state.calendar.getUTCFullYear(),state.calendar.getUTCMonth()+1,1));renderCalendar();});
$('encourageButton').addEventListener('click',()=>{const s=visible().sort((a,b)=>a.days_until-b.days_until)[0];if(s)openGreeting(s.id);else toast('Add staff records to start celebrating.');});
$('markCelebrated').addEventListener('click',markGreeting);
$('emailGreeting').addEventListener('click',sendGreetingEmail);
$('copyGreeting').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('greetingText').value);toast('Birthday message copied.');}catch{toast('Select the message and copy it from the text box.');}
});
$('exportPending').addEventListener('click',()=>download('/api/export?scope=pending','pending_birthdays.xlsx'));
$('exportAllButton').addEventListener('click',()=>download('/api/export?scope=all','all_staff_birthdays.xlsx'));
$('templateButton').addEventListener('click',()=>download('/api/template','revolt_birthday_template.xlsx'));
$('importButton').addEventListener('click',()=>{$('importResult').textContent='';$('importDialog').showModal();});
$('importForm').addEventListener('submit',importExcel);
$('reminderForm').addEventListener('submit',async e=>{
  e.preventDefault();
  try{await api('/api/settings',{method:'PUT',body:{reminder_days:Number($('reminderDays').value)}});await refresh(true);toast('Reminder window saved.');}
  catch(err){toast(err.message);}
});
$('passwordForm').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('/api/account/password',{method:'POST',body:{current:$('currentPassword').value,next:$('newPassword').value}});
    e.target.reset();toast('Administrator password changed.');
  }catch(err){toast(err.message);}
});
init();
