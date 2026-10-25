'use strict';
const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isValidBirthday, staffWithBirthday, birthdayCountdownLabel } = require('./birthdays');
const { parseBirthday, displayBirthday, splitName } = require('./birthday-fields');
const { importRecords, exportContent, PENDING_HEADERS, STAFF_HEADERS, FORMATS } = require('./file-formats');

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL must be configured'); process.exit(1); }
const db = new Pool({ connectionString: DATABASE_URL, max: 6, idleTimeoutMillis: 30000 });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({limit:'100kb'}));
app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','strict-origin-when-cross-origin');
  res.set('X-Frame-Options','DENY');
  res.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (req.path.startsWith('/api/')) res.set('Cache-Control','no-store');
  next();
});
function fail(res,status,error){return res.status(status).json({error});}
function cookieValue(req,key){
  const found=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='));
  return found ? decodeURIComponent(found.slice(key.length+1)) : '';
}
function tokenDigest(token){return crypto.createHash('sha256').update(token).digest('hex');}
function passwordHash(value,salt=crypto.randomBytes(16).toString('hex')){
  return salt+':'+crypto.scryptSync(value,salt,64).toString('hex');
}
function verifyPassword(value,saved){
  if (!saved || !saved.includes(':')) return false;
  const [salt,original]=saved.split(':');
  try {const actual=crypto.scryptSync(value,salt,64);return crypto.timingSafeEqual(actual,Buffer.from(original,'hex'));}
  catch{return false;}
}
function setCookie(res,token,maxAge){
  res.cookie('revolt_birthday_session',token,{
    path:'/',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',
    maxAge
  });
}
async function requireAdmin(req,res,next){
  try{
    const token=cookieValue(req,'revolt_birthday_session');
    if(!token || !/^[a-f0-9]{64}$/.test(token)) return fail(res,401,'Please sign in to continue.');
    const {rows}=await db.query(
      'SELECT a.id,a.email,a.full_name,a.must_change_password FROM birthday_sessions s JOIN birthday_admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.is_active=true',
      [tokenDigest(token)]);
    if(!rows.length)return fail(res,401,'Your session has expired. Please sign in again.');
    req.admin=rows[0];req.token=token;next();
  }catch(e){next(e);}
}
app.use((req,res,next)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();
  const origin=req.get('origin');
  if(origin){
    try{if(new URL(origin).host!==req.get('host'))return fail(res,403,'Cross-site request blocked.');}
    catch{return fail(res,403,'Invalid request origin.');}
  }
  next();
});
const limits=new Map();
app.post('/api/login', async(req,res,next)=>{
  try{
    const ip=String(req.ip||'unknown'), now=Date.now();
    let counter=limits.get(ip)||{attempts:0,until:now+600000};
    if(counter.until<now)counter={attempts:0,until:now+600000};
    if(counter.attempts>=10)return fail(res,429,'Too many sign-in attempts. Try again later.');
    const email=String(req.body?.email||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    if(!email || !password)return fail(res,400,'Enter your email address and password.');
    const result=await db.query('SELECT id,email,password_hash,must_change_password,full_name FROM birthday_admins WHERE email=$1 AND is_active=true',[email]);
    const admin=result.rows[0];
    if(!admin || !verifyPassword(password,admin.password_hash)){
      counter.attempts++;limits.set(ip,counter);
      if(limits.size>5000)limits.clear();
      return fail(res,401,'Incorrect email or password.');
    }
    limits.delete(ip);
    await db.query('UPDATE birthday_admins SET last_login_at=now() WHERE id=$1',[admin.id]);
    const token=crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO birthday_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval \'12 hours\')',[tokenDigest(token),admin.id]);
    setCookie(res,token,12*3600000);
    res.json({email:admin.email,full_name:admin.full_name,must_change_password:admin.must_change_password});
  }catch(e){next(e);}
});
app.post('/api/logout',requireAdmin,async(req,res,next)=>{
  try{await db.query('DELETE FROM birthday_sessions WHERE token_hash=$1',[tokenDigest(req.token)]);setCookie(res,'',0);res.json({ok:true});}
  catch(e){next(e);}
});
app.get('/health',async(req,res)=>{try{await db.query('SELECT 1');res.json({status:'ok'});}catch{res.status(503).json({status:'db_unavailable'});}});
app.use('/api',requireAdmin);
app.use('/api',(req,res,next)=>{
  // This guard applies to all protected APIs, including exports and staff data.
  // A newly created or reset administrator can only change their password or sign out.
  const routePath=req.originalUrl.split('?')[0];
  if(req.admin.must_change_password && !['/api/me','/api/account/password','/api/logout'].includes(routePath)){
    return res.status(403).json({error:'Change your temporary password to continue.',password_change_required:true});
  }
  next();
});
app.get('/api/me',(req,res)=>res.json({email:req.admin.email,full_name:req.admin.full_name,must_change_password:req.admin.must_change_password}));
app.post('/api/account/password',async(req,res,next)=>{
  try{
    const current=String(req.body?.current||''),nextPassword=String(req.body?.next||'');
    if(nextPassword.length<12 || nextPassword.length>256)return fail(res,400,'New password must be between 12 and 256 characters.');
    if(nextPassword===current)return fail(res,400,'Choose a different password from your current password.');
    const info=await db.query('SELECT password_hash FROM birthday_admins WHERE id=$1',[req.admin.id]);
    if(!info.rows.length||!verifyPassword(current,info.rows[0].password_hash))return fail(res,403,'Current password is incorrect.');
    await db.query('UPDATE birthday_admins SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',[passwordHash(nextPassword),req.admin.id]);
    await db.query('DELETE FROM birthday_sessions WHERE admin_id=$1 AND token_hash<>$2',[req.admin.id,tokenDigest(req.token)]);
    res.json({ok:true});
  }catch(e){next(e);}
});
function newTemporaryPassword(){
  // Random, one-time password: never persisted, logged or emailed in plain text.
  return 'RBM-'+crypto.randomBytes(21).toString('base64url');
}
app.get('/api/admins',async(req,res,next)=>{
  try{
    const r=await db.query('SELECT id,email,full_name,is_active,must_change_password,created_at,last_login_at FROM birthday_admins ORDER BY created_at ASC LIMIT 250');
    res.json({admins:r.rows,current_admin_id:req.admin.id});
  }catch(e){next(e);}
});
app.post('/api/admins',async(req,res,next)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase();
    const fullName=String(req.body?.full_name||'').trim();
    if(email.length>200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return fail(res,400,'Enter a valid administrator email address.');
    if(fullName.length<2 || fullName.length>120)
      return fail(res,400,'Enter the administrator’s full name (2–120 characters).');
    const temporary_password=newTemporaryPassword();
    const created=await db.query(
      'INSERT INTO birthday_admins(email,full_name,password_hash,must_change_password,is_active,created_by) VALUES($1,$2,$3,true,true,$4) RETURNING id,email,full_name,created_at',
      [email,fullName,passwordHash(temporary_password),req.admin.id]
    );
    res.status(201).json({admin:created.rows[0],temporary_password,must_change_password:true});
  }catch(e){
    if(e.code==='23505')return fail(res,409,'An administrator with this email already exists.');
    next(e);
  }
});
app.post('/api/admins/:id/reset-password',async(req,res,next)=>{
  try{
    if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return fail(res,400,'Invalid administrator ID.');
    if(req.params.id===req.admin.id)return fail(res,400,'Change your own password from Settings.');
    const temporary_password=newTemporaryPassword();
    const client=await db.connect();
    let admin;
    try{
      await client.query('BEGIN');
      const result=await client.query(
        'UPDATE birthday_admins SET password_hash=$1,must_change_password=true,updated_at=now() WHERE id=$2 AND is_active=true RETURNING id,email,full_name',
        [passwordHash(temporary_password),req.params.id]
      );
      admin=result.rows[0];
      if(admin)await client.query('DELETE FROM birthday_sessions WHERE admin_id=$1',[admin.id]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    if(!admin)return fail(res,404,'Active administrator not found.');
    res.json({admin,temporary_password,must_change_password:true});
  }catch(e){next(e);}
});
app.patch('/api/admins/:id/status',async(req,res,next)=>{
  try{
    if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return fail(res,400,'Invalid administrator ID.');
    if(typeof req.body?.is_active!=='boolean')return fail(res,400,'Choose active or suspended.');
    if(req.params.id===req.admin.id)return fail(res,400,'You cannot suspend your own account.');
    const client=await db.connect();
    let result;
    try{
      await client.query('BEGIN');
      result=await client.query(
        'UPDATE birthday_admins SET is_active=$1,updated_at=now() WHERE id=$2 RETURNING id,email,is_active',
        [req.body.is_active,req.params.id]
      );
      if(result.rowCount && !req.body.is_active)
        await client.query('DELETE FROM birthday_sessions WHERE admin_id=$1',[req.params.id]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    if(!result.rowCount)return fail(res,404,'Administrator not found.');
    res.json({admin:result.rows[0]});
  }catch(e){next(e);}
});
function text(value,max=120){return String(value??'').trim().slice(0,max);}
function validateStaff(input){
  const staff_code=text(input.staff_code,32).toUpperCase();
  const hasSimpleFields=Object.hasOwn(input,'name')||Object.hasOwn(input,'birthday');
  let first_name,last_name,birth_day,birth_month,birth_year;
  if(hasSimpleFields){
    ({first_name,last_name}=splitName(input.name));
    ({birth_day,birth_month,birth_year}=parseBirthday(input.birthday));
  }else{
    first_name=text(input.first_name,80);last_name=text(input.last_name,80);
    birth_day=Number(input.birth_day);birth_month=Number(input.birth_month);
    birth_year=input.birth_year===null||input.birth_year===undefined||String(input.birth_year).trim()===''?null:Number(input.birth_year);
  }
  const phone_number=text(input.number??input.phone_number,40);
  const email=text(input.email,200).toLowerCase();
  const avatar_url=text(input.avatar_url,500);
  const employment_status=text(input.employment_status||'active',20).toLowerCase();
  const hide_from_celebrations=[true,'true','yes','1',1].includes(input.hide_from_celebrations);
  if(!/^[A-Z0-9][A-Z0-9._/-]{1,31}$/.test(staff_code))
    throw Error('Staff ID must be 2–32 letters, numbers, dots, underscores, slashes or hyphens.');
  if(!first_name)throw Error('Name is required.');
  if(!isValidBirthday(birth_month,birth_day))throw Error('Birthday is not a valid calendar date.');
  if(birth_year!==null&&(!Number.isInteger(birth_year)||birth_year<1900||birth_year>new Date().getUTCFullYear()))
    throw Error('Birthday year is not valid.');
  if(phone_number&&!/^\+?[\d\s().-]{5,35}$/.test(phone_number))throw Error('Number must be a valid phone number.');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');
  if(avatar_url&&!/^https:\/\/[^\s]+$/i.test(avatar_url))throw Error('Photo URL must start with https://');
  if(!['active','inactive'].includes(employment_status))throw Error('Status must be active or inactive.');
  return {staff_code,first_name,last_name,birth_day,birth_month,birth_year,phone_number,email,avatar_url,employment_status,hide_from_celebrations,
    department:text(input.department,100),job_title:text(input.job_title,120)};
}
const cols='staff_code,first_name,last_name,birth_day,birth_month,birth_year,department,job_title,email,avatar_url,employment_status,hide_from_celebrations,phone_number';
function values(s){return [s.staff_code,s.first_name,s.last_name,s.birth_day,s.birth_month,s.birth_year,s.department,s.job_title,s.email,s.avatar_url,s.employment_status,s.hide_from_celebrations,s.phone_number];}
async function saveStaff(s,id){
  if(id)return db.query('UPDATE birthday_staff SET staff_code=$1,first_name=$2,last_name=$3,birth_day=$4,birth_month=$5,birth_year=$6,department=$7,job_title=$8,email=$9,avatar_url=$10,employment_status=$11,hide_from_celebrations=$12,phone_number=$13,updated_at=now() WHERE id=$14 RETURNING *',[...values(s),id]);
  return db.query('INSERT INTO birthday_staff('+cols+') VALUES('+values(s).map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',values(s));
}
app.get('/api/overview',async(req,res,next)=>{
  try{
    const staff=(await db.query('SELECT * FROM birthday_staff ORDER BY first_name,last_name LIMIT 10000')).rows;
    const greets=(await db.query("SELECT staff_id,birthday_on::text AS birthday_on FROM birthday_greetings WHERE birthday_on >= (current_date - interval '1 day') AND birthday_on < (current_date + interval '2 years')")).rows;
    const greeted=new Set(greets.map(r=>r.staff_id+':'+r.birthday_on));
    const enriched=staff.map(s=>staffWithBirthday(s,new Date(),greeted)).sort((a,b)=>a.days_until-b.days_until||a.first_name.localeCompare(b.first_name));
    const visible=enriched.filter(s=>s.employment_status==='active'&&!s.hide_from_celebrations);
    const reminder=await db.query("SELECT value FROM birthday_settings WHERE key='reminder_days'");
    const reminderDays=Number(reminder.rows[0]?.value||30);
    const thisMonth=visible.filter(s=>s.birth_month===new Date().getUTCMonth()+1);
    res.json({staff:enriched,summary:{active:enriched.filter(s=>s.employment_status==='active').length,
      today:visible.filter(s=>s.days_until===0).length,month:thisMonth.length,upcoming:visible.filter(s=>s.days_until<=30).length,
      pending:visible.filter(s=>s.days_until<=reminderDays&&!s.greeted).length},reminder_days:reminderDays,
      server_date:new Date().toISOString().slice(0,10)});
  }catch(e){next(e);}
});
app.post('/api/staff',async(req,res,next)=>{
  try{const s=validateStaff(req.body||{});const r=await saveStaff(s);res.status(201).json(r.rows[0]);}
  catch(e){if(e.code==='23505')return fail(res,409,'That Staff ID already exists.'); if(e.message?.startsWith('Enter ')||/^(Staff ID|Name |Birthday |Number |First name|Birth year|Status|Photo|Use DD)/.test(e.message))return fail(res,400,e.message);next(e);}
});
app.put('/api/staff/:id',async(req,res,next)=>{
  try{const s=validateStaff(req.body||{});const r=await saveStaff(s,req.params.id);if(!r.rowCount)return fail(res,404,'Staff record not found.');res.json(r.rows[0]);}
  catch(e){if(e.code==='23505')return fail(res,409,'That Staff ID already exists.');if(e.code==='22P02')return fail(res,400,'Invalid staff record.');if(e.message?.startsWith('Enter ')||/^(Staff ID|Name |Birthday |Number |First name|Birth year|Status|Photo|Use DD)/.test(e.message))return fail(res,400,e.message);next(e);}
});
app.delete('/api/staff/:id',async(req,res,next)=>{
  try{const r=await db.query("UPDATE birthday_staff SET employment_status='inactive',updated_at=now() WHERE id=$1 RETURNING id",[req.params.id]);if(!r.rowCount)return fail(res,404,'Staff record not found.');res.json({ok:true});}
  catch(e){next(e);}
});
app.post('/api/greetings',async(req,res,next)=>{
  try{
    const id=text(req.body?.staff_id,50),note=text(req.body?.note,1000);
    const check=await db.query("SELECT * FROM birthday_staff WHERE id=$1 AND employment_status='active' AND hide_from_celebrations=false",[id]);
    if(!check.rows.length)return fail(res,404,'Staff member not found or excluded from celebrations.');
    const birthday=staffWithBirthday(check.rows[0]).next_birthday;
    await db.query("INSERT INTO birthday_greetings(staff_id,birthday_on,greeted_by,note) VALUES($1,$2,$3,$4) ON CONFLICT(staff_id,birthday_on) DO UPDATE SET note=excluded.note,created_at=now(),greeted_by=excluded.greeted_by",[id,birthday,req.admin.id,note]);
    res.json({ok:true,birthday});
  }catch(e){if(e.code==='22P02')return fail(res,400,'Invalid staff record.');next(e);}
});
app.get('/api/history',async(req,res,next)=>{
  try{const r=await db.query("SELECT g.id,g.birthday_on::text AS birthday_on,g.note,g.created_at,s.first_name,s.last_name,s.staff_code FROM birthday_greetings g JOIN birthday_staff s ON s.id=g.staff_id ORDER BY g.created_at DESC LIMIT 200");res.json({history:r.rows});}
  catch(e){next(e);}
});
app.get('/api/imports',async(req,res,next)=>{
  try{const r=await db.query('SELECT * FROM birthday_import_runs ORDER BY created_at DESC LIMIT 20');res.json({runs:r.rows});}
  catch(e){next(e);}
});
app.put('/api/settings',async(req,res,next)=>{
  try{const reminder=Number(req.body?.reminder_days);if(![7,14,30,60].includes(reminder))return fail(res,400,'Select 7, 14, 30 or 60 days.');
    await db.query("INSERT INTO birthday_settings(key,value) VALUES('reminder_days',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[String(reminder)]);
    res.json({reminder_days:reminder});
  }catch(e){next(e);}
});
const HEADERS=['Staff ID','Name','Number','Birthday','Department','Job Title','Email'];
function newWorkbook(){
  const wb=new ExcelJS.Workbook();wb.creator='Revolt - Technologies Birthday Management';
  const ws=wb.addWorksheet('Staff Birthdays',{views:[{state:'frozen',ySplit:1}]});
  ws.addRow(HEADERS);
  ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE90032'}};
  ws.columns=HEADERS.map((_,i)=>({width:[22,30,24,23,26,30,38][i]}));
  ws.getColumn(1).numFmt='@';ws.getColumn(3).numFmt='@';ws.getColumn(4).numFmt='@';
  ws.autoFilter={from:'A1',to:'G1'};
  return {wb,ws};
}
async function sendBook(res,wb,name){
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition','attachment; filename="'+name+'"');
  await wb.xlsx.write(res);res.end();
}
app.get('/api/template',async(req,res,next)=>{
  try{
    const {wb}=newWorkbook();
    const help=wb.addWorksheet('Instructions');
    help.columns=[{width:25},{width:95}];
    help.addRows([
      ['Column','How to fill it in'],
      ['Staff ID','Required and unique (e.g., STF-001). Used to update existing staff safely.'],
      ['Name','Full name in one cell (e.g., Akosua Mensah).'],
      ['Number','Contact telephone number; keep leading zeros by entering as text.'],
      ['Birthday','DD/MM/YYYY (e.g., 25/10/1990), DD/MM (if year unknown), or an actual Excel date.'],
      ['Department','Department name (e.g., Finance).'],
      ['Job Title','Position or role (e.g., Officer).'],
      ['Email','Work email address.'],
      ['Import','Use only the first worksheet for records. It is intentionally blank, with seven columns.']
    ]);
    help.getRow(1).font={bold:true};
    await sendBook(res,wb,'revolt_birthday_import_template.xlsx');
  }catch(e){next(e);}
});
app.get('/api/export',async(req,res,next)=>{
  try{
    const scope=text(req.query.scope||'pending',30);
    const format=text(req.query.format||'xlsx',10).toLowerCase();
    if(!['pending','upcoming','this_month','all'].includes(scope))return fail(res,400,'Invalid export selection.');
    if(!FORMATS.includes(format))return fail(res,400,'Export format must be xls, xlsx, csv or pdf.');
    const r=await db.query('SELECT * FROM birthday_staff ORDER BY first_name,last_name LIMIT 10000');
    const greetingRows=(await db.query("SELECT staff_id,birthday_on::text AS birthday_on FROM birthday_greetings WHERE birthday_on>=current_date AND birthday_on<current_date+interval '2 years'")).rows;
    const greeted=new Set(greetingRows.map(x=>x.staff_id+':'+x.birthday_on));
    const upcoming=r.rows.map(x=>staffWithBirthday(x,new Date(),greeted));
    const settings=await db.query("SELECT value FROM birthday_settings WHERE key='reminder_days'");
    const days=Number(settings.rows[0]?.value||30);
    const filtered=upcoming.filter(x=>scope==='all'||(x.employment_status==='active'&&!x.hide_from_celebrations&&
      (scope==='this_month' ? x.birth_month===new Date().getUTCMonth()+1 :
       scope==='upcoming' ? x.days_until<=30 :
       x.days_until<=days&&!x.greeted)));
    if(format!=='xlsx'){
      const headers=scope==='pending'?PENDING_HEADERS:STAFF_HEADERS;
      const records=filtered.map(s=>{
        const row=[s.staff_code,[s.first_name,s.last_name].filter(Boolean).join(' '),s.phone_number||'',
          displayBirthday(s),s.department,s.job_title,s.email];
        if(scope==='pending')row.push(s.next_birthday,birthdayCountdownLabel(s.days_until));
        return row;
      });
      const file=await exportContent(format,headers,records,scope);
      res.set('Content-Type',file.mime);
      res.set('Content-Disposition','attachment; filename="revolt_birthdays_'+scope+'_'+new Date().toISOString().slice(0,10)+'.'+format+'"');
      res.set('Content-Length',String(file.buffer.length));
      return res.send(file.buffer);
    }
    const {wb,ws}=newWorkbook();
    if(scope==='pending'){
      // Preserve the seven standard staff columns, adding actionable information
      // only to the pending-birthday report.
      ws.getCell('H1').value='Upcoming Birthday Date';
      ws.getCell('I1').value='Birthday Reminder';
      for(const cell of ['H1','I1']){
        ws.getCell(cell).font={bold:true,color:{argb:'FFFFFFFF'}};
        ws.getCell(cell).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE90032'}};
      }
      ws.getColumn('H').width=26;
      ws.getColumn('H').numFmt='dd mmm yyyy';
      ws.getColumn('I').width=23;
      ws.autoFilter={from:'A1',to:'I1'};
    }
    for(const s of filtered){
      const staffRow=[s.staff_code,[s.first_name,s.last_name].filter(Boolean).join(' '),s.phone_number||'',
        displayBirthday(s),s.department,s.job_title,s.email];
      if(scope==='pending'){
        // Store an actual Excel date so report recipients can sort/filter it.
        staffRow.push(new Date(s.next_birthday+'T00:00:00.000Z'),birthdayCountdownLabel(s.days_until));
      }
      ws.addRow(staffRow);
    }
    await sendBook(res,wb,'revolt_birthdays_'+scope+'_'+new Date().toISOString().slice(0,10)+'.xlsx');
  }catch(e){next(e);}
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},
  fileFilter:(req,file,cb)=>cb(null,/\.(xls|xlsx|csv|pdf)$/i.test(file.originalname))});
app.post('/api/import',upload.single('file'),async(req,res,next)=>{
  try{
    if(!req.file)return fail(res,400,'Choose an XLS, XLSX, CSV or text-based PDF file, maximum 5 MB.');
    let records;
    try{records=await importRecords(req.file.buffer,req.file.originalname);}
    catch(error){return fail(res,400,error.message);}
    const client=await db.connect();
    let inserted=0,updated=0,skipped=0;const errors=[];
    try{
      await client.query('BEGIN');
      for(const row of records){
        try{
          const s=validateStaff(row);
          // Reimports preserve privacy preferences, active status, and photos.
          const args=[s.staff_code,s.first_name,s.last_name,s.phone_number,s.birth_day,s.birth_month,
            s.birth_year,s.department,s.job_title,s.email];
          const q='INSERT INTO birthday_staff(staff_code,first_name,last_name,phone_number,birth_day,birth_month,birth_year,department,job_title,email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) '+
            'ON CONFLICT(staff_code) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,phone_number=excluded.phone_number,'+
            'birth_day=excluded.birth_day,birth_month=excluded.birth_month,birth_year=excluded.birth_year,'+
            'department=excluded.department,job_title=excluded.job_title,email=excluded.email,updated_at=now() RETURNING (xmax = 0) AS inserted';
          await client.query('SAVEPOINT staff_import_row');
          try{
            const outcome=await client.query(q,args);
            if(outcome.rows[0].inserted)inserted++;else updated++;
            await client.query('RELEASE SAVEPOINT staff_import_row');
          }catch(error){
            await client.query('ROLLBACK TO SAVEPOINT staff_import_row');
            await client.query('RELEASE SAVEPOINT staff_import_row');
            throw error;
          }
        }catch(error){
          skipped++;
          if(errors.length<100)errors.push({row:row.row,reason:error.message||'Invalid row'});
        }
      }
      await client.query('INSERT INTO birthday_import_runs(filename,inserted,updated,skipped,errors,performed_by) VALUES($1,$2,$3,$4,$5,$6)',
        [path.basename(req.file.originalname).slice(0,200),inserted,updated,skipped,JSON.stringify(errors),req.admin.id]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    res.json({inserted,updated,skipped,errors,more_errors:skipped>errors.length});
  }catch(e){next(e);}
});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html'],maxAge:0}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));
app.use((err,req,res,next)=>{
  console.error('Birthday app request failed:',err.code||err.message);
  if(err instanceof multer.MulterError)return fail(res,400,err.code==='LIMIT_FILE_SIZE'?'Maximum Excel file size is 3 MB.':'Invalid upload.');
  if(err.code==='23505')return fail(res,409,'A record with these details already exists.');
  if(err.code==='22P02')return fail(res,400,'Invalid record identifier.');
  res.status(500).json({error:'Could not complete this request. Please try again.'});
});
async function main(){
  const sql=fs.readFileSync(path.join(__dirname,'sql/schema.sql'),'utf8');
  await db.query(sql);
  await db.query('DELETE FROM birthday_sessions WHERE expires_at<now()');
  const count=await db.query('SELECT count(*)::integer AS count FROM birthday_admins');
  if(count.rows[0].count===0){
    const email=(process.env.ADMIN_EMAIL||'').trim().toLowerCase(),password=process.env.ADMIN_PASSWORD||'';
    if(email&&password.length>=12){
      await db.query('INSERT INTO birthday_admins(email,password_hash) VALUES($1,$2) ON CONFLICT (email) DO NOTHING',[email,passwordHash(password)]);
      console.log('Initial birthday administrator provisioned.');
    }else console.warn('No admin exists. Configure ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters).');
  }
  app.listen(PORT,'0.0.0.0',()=>console.log('Revolt Staff Birthdays listening on port '+PORT));
}
main().catch(e=>{console.error('Startup failed:',e.message);process.exit(1);});
