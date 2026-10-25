'use strict';
const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isValidBirthday, staffWithBirthday } = require('./birthdays');

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
      'SELECT a.id,a.email FROM birthday_sessions s JOIN birthday_admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>now()',
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
    const result=await db.query('SELECT id,email,password_hash FROM birthday_admins WHERE email=$1',[email]);
    const admin=result.rows[0];
    if(!admin || !verifyPassword(password,admin.password_hash)){
      counter.attempts++;limits.set(ip,counter);
      if(limits.size>5000)limits.clear();
      return fail(res,401,'Incorrect email or password.');
    }
    limits.delete(ip);
    const token=crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO birthday_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,now()+interval \'12 hours\')',[tokenDigest(token),admin.id]);
    setCookie(res,token,12*3600000);
    res.json({email:admin.email});
  }catch(e){next(e);}
});
app.post('/api/logout',requireAdmin,async(req,res,next)=>{
  try{await db.query('DELETE FROM birthday_sessions WHERE token_hash=$1',[tokenDigest(req.token)]);setCookie(res,'',0);res.json({ok:true});}
  catch(e){next(e);}
});
app.get('/health',async(req,res)=>{try{await db.query('SELECT 1');res.json({status:'ok'});}catch{res.status(503).json({status:'db_unavailable'});}});
app.use('/api',requireAdmin);
app.get('/api/me',(req,res)=>res.json({email:req.admin.email}));
app.post('/api/account/password',async(req,res,next)=>{
  try{
    const current=String(req.body?.current||''),nextPassword=String(req.body?.next||'');
    if(nextPassword.length<12 || nextPassword.length>256)return fail(res,400,'New password must be at least 12 characters.');
    const info=await db.query('SELECT password_hash FROM birthday_admins WHERE id=$1',[req.admin.id]);
    if(!info.rows.length||!verifyPassword(current,info.rows[0].password_hash))return fail(res,403,'Current password is incorrect.');
    await db.query('UPDATE birthday_admins SET password_hash=$1,updated_at=now() WHERE id=$2',[passwordHash(nextPassword),req.admin.id]);
    await db.query('DELETE FROM birthday_sessions WHERE admin_id=$1 AND token_hash<>$2',[req.admin.id,tokenDigest(req.token)]);
    res.json({ok:true});
  }catch(e){next(e);}
});
function text(value,max=120){return String(value??'').trim().slice(0,max);}
function validateStaff(input){
  const staff_code=text(input.staff_code,32).toUpperCase();
  const first_name=text(input.first_name,80),last_name=text(input.last_name,80);
  const birth_day=Number(input.birth_day),birth_month=Number(input.birth_month);
  const birth_year=input.birth_year===null||input.birth_year===undefined||String(input.birth_year).trim()===''?null:Number(input.birth_year);
  const email=text(input.email,200).toLowerCase();
  const avatar_url=text(input.avatar_url,500);
  const employment_status=text(input.employment_status||'active',20).toLowerCase();
  const hide_from_celebrations=[true,'true','yes','1',1].includes(input.hide_from_celebrations);
  if(!/^[A-Z0-9][A-Z0-9._/-]{1,31}$/.test(staff_code))throw Error('Staff ID must be 2–32 letters, numbers, dots, underscores, slashes or hyphens.');
  if(!first_name||!last_name)throw Error('First name and last name are required.');
  if(!isValidBirthday(birth_month,birth_day))throw Error('Enter a valid birth month and day.');
  if(birth_year!==null&&(!Number.isInteger(birth_year)||birth_year<1900||birth_year>new Date().getUTCFullYear()))throw Error('Birth year must be valid or blank.');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');
  if(avatar_url&&!/^https:\/\/[^\s]+$/i.test(avatar_url))throw Error('Photo URL must start with https://');
  if(!['active','inactive'].includes(employment_status))throw Error('Status must be active or inactive.');
  return {staff_code,first_name,last_name,birth_day,birth_month,birth_year,email,avatar_url,employment_status,hide_from_celebrations,
    department:text(input.department,100),job_title:text(input.job_title,120)};
}
const cols='staff_code,first_name,last_name,birth_day,birth_month,birth_year,department,job_title,email,avatar_url,employment_status,hide_from_celebrations';
function values(s){return [s.staff_code,s.first_name,s.last_name,s.birth_day,s.birth_month,s.birth_year,s.department,s.job_title,s.email,s.avatar_url,s.employment_status,s.hide_from_celebrations];}
async function saveStaff(s,id){
  if(id)return db.query('UPDATE birthday_staff SET staff_code=$1,first_name=$2,last_name=$3,birth_day=$4,birth_month=$5,birth_year=$6,department=$7,job_title=$8,email=$9,avatar_url=$10,employment_status=$11,hide_from_celebrations=$12,updated_at=now() WHERE id=$13 RETURNING *',[...values(s),id]);
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
  catch(e){if(e.code==='23505')return fail(res,409,'That Staff ID already exists.'); if(e.message?.startsWith('Enter ')||/^(Staff ID|First name|Birth year|Status|Photo)/.test(e.message))return fail(res,400,e.message);next(e);}
});
app.put('/api/staff/:id',async(req,res,next)=>{
  try{const s=validateStaff(req.body||{});const r=await saveStaff(s,req.params.id);if(!r.rowCount)return fail(res,404,'Staff record not found.');res.json(r.rows[0]);}
  catch(e){if(e.code==='23505')return fail(res,409,'That Staff ID already exists.');if(e.code==='22P02')return fail(res,400,'Invalid staff record.');if(e.message?.startsWith('Enter ')||/^(Staff ID|First name|Birth year|Status|Photo)/.test(e.message))return fail(res,400,e.message);next(e);}
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
const HEADERS=['Staff ID','First Name','Last Name','Birth Day','Birth Month','Birth Year','Department','Job Title','Email','Employment Status','Hide From Celebrations'];
function newWorkbook(){
  const wb=new ExcelJS.Workbook();wb.creator='Revolt Staff Birthdays';
  const ws=wb.addWorksheet('Staff Birthdays',{views:[{state:'frozen',ySplit:1}]});
  ws.addRow(HEADERS);
  ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE90032'}};
  ws.columns=HEADERS.map((_,i)=>({width:[20,23,23,13,16,15,25,26,30,20,28][i]}));
  ws.autoFilter={from:'A1',to:'K1'};
  return {wb,ws};
}
async function sendBook(res,wb,name){
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition','attachment; filename="'+name+'"');
  await wb.xlsx.write(res);res.end();
}
app.get('/api/template',async(req,res,next)=>{
  try{const {wb}=newWorkbook();
    const help=wb.addWorksheet('Instructions');
    help.columns=[{width:28},{width:88}];
    help.addRows([['Field','Instructions'],['Staff ID','Required. Unique staff ID. Rows with an existing Staff ID update the existing record.'],['First Name / Last Name','Required for every employee.'],['Birth Day / Birth Month','Required as numbers (1–31 and 1–12). 29 February is accepted.'],['Birth Year','Optional, leave blank if not required by company policy.'],['Employment Status','active or inactive. Default is active.'],['Hide From Celebrations','Yes if an employee should not appear on birthday calendars or pending exports.'],['Important','Enter real staff records only on the Staff Birthdays worksheet. The template is intentionally blank.']]);
    help.getRow(1).font={bold:true};
    await sendBook(res,wb,'revolt_birthday_import_template.xlsx');}
  catch(e){next(e);}
});
app.get('/api/export',async(req,res,next)=>{
  try{
    const scope=text(req.query.scope||'pending',30);
    if(!['pending','upcoming','this_month','all'].includes(scope))return fail(res,400,'Invalid export selection.');
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
    const {wb,ws}=newWorkbook();
    for(const s of filtered){
      ws.addRow([s.staff_code,s.first_name,s.last_name,s.birth_day,s.birth_month,s.birth_year??'',s.department,s.job_title,s.email,s.employment_status,s.hide_from_celebrations?'Yes':'No']);
    }
    ws.getColumn(12).width=18;ws.getColumn(13).width=16;
    ws.getCell('L1').value='Next Birthday';ws.getCell('M1').value='Days Until';
    filtered.forEach((s,i)=>{ws.getCell(i+2,12).value=s.next_birthday;ws.getCell(i+2,13).value=s.days_until;});
    await sendBook(res,wb,'revolt_birthdays_'+scope+'_'+new Date().toISOString().slice(0,10)+'.xlsx');
  }catch(e){next(e);}
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:3*1024*1024,files:1},
  fileFilter:(req,file,cb)=>cb(null,/\.xlsx$/i.test(file.originalname))});
function cellString(cell){
  const v=cell?.value;
  if(v===null||v===undefined)return '';
  if(v instanceof Date)return v.toISOString().slice(0,10);
  if(typeof v==='object')return String(v.result??v.text??v.richText?.map(p=>p.text).join('')??'');
  return String(v).trim();
}
app.post('/api/import',upload.single('file'),async(req,res,next)=>{
  try{
    if(!req.file)return fail(res,400,'Choose an Excel .xlsx file of no more than 3 MB.');
    const wb=new ExcelJS.Workbook();
    try{await wb.xlsx.load(req.file.buffer);}catch{return fail(res,400,'Could not read this Excel file. Download and use the template.');}
    const ws=wb.worksheets[0];
    if(!ws||ws.rowCount<2)return fail(res,400,'The spreadsheet contains no staff records.');
    if(ws.rowCount>2001)return fail(res,400,'You can import up to 2,000 staff records at once.');
    const normalize=v=>String(v).toLowerCase().replace(/[^a-z0-9]/g,'');
    const headers={};
    ws.getRow(1).eachCell((cell,col)=>{headers[normalize(cellString(cell))]=col;});
    for(const key of ['staffid','firstname','lastname','birthday','birthmonth']){
      if(!headers[key])return fail(res,400,'Missing spreadsheet column: '+key+'. Download the template to see the required columns.');
    }
    const get=(row,key)=>headers[key]?cellString(row.getCell(headers[key])):'';
    const client=await db.connect();
    let inserted=0,updated=0,skipped=0;const errors=[];
    try{
      await client.query('BEGIN');
      for(let i=2;i<=ws.rowCount;i++){
        const row=ws.getRow(i);
        if(!row.hasValues)continue;
        try{
          const s=validateStaff({
            staff_code:get(row,'staffid'),first_name:get(row,'firstname'),last_name:get(row,'lastname'),
            birth_day:get(row,'birthday'),birth_month:get(row,'birthmonth'),birth_year:get(row,'birthyear'),
            department:get(row,'department'),job_title:get(row,'jobtitle'),email:get(row,'email'),
            employment_status:get(row,'employmentstatus')||'active',
            hide_from_celebrations:get(row,'hidefromcelebrations').toLowerCase()==='yes'
          });
          const q='INSERT INTO birthday_staff('+cols+') VALUES('+values(s).map((_,j)=>'$'+(j+1)).join(',')+') ON CONFLICT(staff_code) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,birth_day=excluded.birth_day,birth_month=excluded.birth_month,birth_year=excluded.birth_year,department=excluded.department,job_title=excluded.job_title,email=excluded.email,employment_status=excluded.employment_status,hide_from_celebrations=excluded.hide_from_celebrations,updated_at=now() RETURNING (xmax = 0) AS inserted';
          await client.query('SAVEPOINT staff_import_row');
          try {
            const outcome=await client.query(q,values(s));
            if(outcome.rows[0].inserted)inserted++;else updated++;
            await client.query('RELEASE SAVEPOINT staff_import_row');
          } catch(queryError) {
            await client.query('ROLLBACK TO SAVEPOINT staff_import_row');
            await client.query('RELEASE SAVEPOINT staff_import_row');
            throw queryError;
          }
        }catch(e){
          skipped++;if(errors.length<100)errors.push({row:i,reason:e.message||'Invalid row'});
        }
      }
      await client.query('INSERT INTO birthday_import_runs(filename,inserted,updated,skipped,errors,performed_by) VALUES($1,$2,$3,$4,$5,$6)',
        [path.basename(req.file.originalname).slice(0,200),inserted,updated,skipped,JSON.stringify(errors),req.admin.id]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
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
