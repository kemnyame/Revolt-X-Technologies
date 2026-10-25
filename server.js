const express=require('express');
const path=require('node:path');
const crypto=require('node:crypto');
const {Pool}=require('pg');
const solutions=require('./data/solutions.json');

const app=express();
const portArgument=process.argv.indexOf('--port');
const PORT=Number(process.env.PORT||(portArgument>=0?process.argv[portArgument+1]:10000));
const production=process.env.NODE_ENV==='production';
const databaseRetryMs=30000;
let pool=null,databaseReady=false,databaseInitializing=false;

// Public pages start independently of the database. Credentials stay on the server.
if(process.env.DATABASE_URL){
 try{
  const connection=new URL(process.env.DATABASE_URL);
  const neon=connection.hostname.endsWith('.neon.tech');
  if(neon)connection.searchParams.set('sslmode','verify-full');
  pool=new Pool({connectionString:connection.toString(),ssl:production||neon?{rejectUnauthorized:true}:false,max:10,idleTimeoutMillis:30000,connectionTimeoutMillis:8000,query_timeout:10000});
 }catch{console.error('Database configuration could not be loaded. Public pages remain online.')}
}
function isDatabaseUnavailable(error){return ['DATABASE_UNAVAILABLE','ENOTFOUND','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH','ETIMEDOUT','EAI_AGAIN','57P01','57P02','57P03','53300'].includes(error.code)||/^08/.test(error.code||'')||/timeout|connection terminated|connection ended/i.test(error.message||'')}
pool?.on('error',error=>{databaseReady=false;console.error('Database pool unavailable:',error.code||'CONNECTION_ERROR')});
async function q(text,params=[]){
 if(!pool){const error=new Error('Database unavailable');error.code='DATABASE_UNAVAILABLE';throw error}
 try{return await pool.query(text,params)}catch(error){if(isDatabaseUnavailable(error))databaseReady=false;throw error}
}
function databaseUnavailable(req,res){
 res.setHeader('Retry-After',String(databaseRetryMs/1000));
 const message=req.originalUrl.startsWith('/api/demo')?'We could not save your request. Your entries are still here. Please try again or call +233 55 748 5233.':'Administration is temporarily unavailable. Please try again shortly.';
 return res.status(503).json({ok:false,code:'DATABASE_UNAVAILABLE',message,error:message});
}
function requireDatabase(req,res,next){if(!databaseReady)return databaseUnavailable(req,res);next()}
async function recordActivity(text,params){if(!databaseReady)return;try{await q(text,params)}catch(error){console.error('Activity logging unavailable:',error.code||'QUERY_ERROR')}}
function hash(password,salt=crypto.randomBytes(16).toString('hex')){return salt+':'+crypto.scryptSync(password,salt,64).toString('hex')}
function verify(password,stored){try{const [salt,key]=stored.split(':');return crypto.timingSafeEqual(Buffer.from(key,'hex'),crypto.scryptSync(password,salt,64))}catch{return false}}
function cookieToken(req){for(const item of (req.headers.cookie||'').split(';')){const position=item.indexOf('=');if(item.slice(0,position).trim()==='rx_admin'){try{return decodeURIComponent(item.slice(position+1))}catch{return null}}}return null}
function clean(value,max){return typeof value==='string'&&value.length<=max?value.trim():null}
function passwordValue(value){return typeof value==='string'&&value.length<=200?value:null}
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function initDb(){
 // Schema changes are kept in db/migrations and applied on a direct connection.
 const migration=await q('SELECT version FROM website_migrations WHERE version=$1',['001_initial']);
 if(!migration.rows.length){const error=new Error('Website migrations must be applied');error.code='SCHEMA_NOT_READY';throw error}
 const count=await q('SELECT COUNT(*)::int n FROM admins');
 if(count.rows[0].n===0){
  const email=process.env.ADMIN_EMAIL,password=process.env.ADMIN_PASSWORD;
  if(email&&emailPattern.test(email)&&password&&password.length>=12){await q('INSERT INTO admins(name,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',['Administrator',email.toLowerCase(),hash(password)]);console.log('Website administrator provisioned from protected configuration.')}
  else console.error('Administrator setup requires ADMIN_EMAIL and a password of at least 12 characters.');
 }
 await q('DELETE FROM sessions WHERE expires_at <= NOW()');
}
async function reconnectDatabase(){
 if(!pool||databaseReady||databaseInitializing)return;
 databaseInitializing=true;
 try{await initDb();databaseReady=true;console.log('Database ready. Enquiries and administration are available.')}catch(error){databaseReady=false;console.error('Database unavailable; public website remains online:',error.code||'INITIALIZATION_FAILED')}finally{databaseInitializing=false}
}

app.disable('x-powered-by');
app.set('trust proxy',1);
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');if(req.path.startsWith('/api/')||req.path.startsWith('/admin/'))res.setHeader('Cache-Control','no-store');next()});
app.use(express.json({limit:'32kb'}));
app.use(express.urlencoded({extended:false,limit:'32kb'}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:0}));

// Browser writes must come from the website that is serving the form.
app.use('/api',(req,res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.get('host'))return res.status(403).json({ok:false,message:'Please use the form on the Revolt-X website.'})}catch{return res.status(403).json({ok:false,message:'Please reload the page and try again.'})}}
 next();
});
const rateCounters=new Map();
function rateLimit(label,max,windowMs){return (req,res,next)=>{const key=label+':'+req.ip,now=Date.now();let value=rateCounters.get(key);if(!value||value.until<=now)value={count:0,until:now+windowMs};value.count++;rateCounters.set(key,value);if(value.count>max){res.setHeader('Retry-After',String(Math.ceil((value.until-now)/1000)));return res.status(429).json({ok:false,message:'Please wait a little before trying again.'})}next()}}
const rateCleanup=setInterval(()=>{for(const [key,value] of rateCounters)if(value.until<=Date.now())rateCounters.delete(key)},60000);rateCleanup.unref();
app.use('/api/admin',requireDatabase);
async function auth(req,res,next){
 try{const token=cookieToken(req);if(!token)return res.status(401).json({error:'Please sign in.'});const result=await q('SELECT a.id,a.name,a.email FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=$1 AND s.expires_at>NOW()',[token]);if(!result.rows[0])return res.status(401).json({error:'Please sign in again.'});req.admin=result.rows[0];next()}catch(error){next(error)}
}

const companyContext='Revolt-X Technologies builds business software, websites, mobile experiences, AI assistants, automation, reports and connections between existing tools. Revolt-X OS brings users, access, teams and workflows together. Revolt-X AI helps with company information, documents and routine work, with people reviewing important actions. Costs depend on scope and are agreed in a quote. Do not invent clients, completed projects, statistics, guarantees or prices. Contact: +233 55 748 5233. Visitors can use the Let us talk contact form. Explain everything in plain, short sentences.';
const norm=value=>value.toLowerCase();
function tokens(value){const stop=new Set('what which where when why how does do can could would should about tell explain need want have with from your our this that into they them then than business company solution solutions system systems software please'.split(' '));return [...new Set(norm(value).split(/[^a-z0-9]+/).filter(word=>word.length>2&&!stop.has(word)))]}
function localAssistant(question){
 const text=norm(question),words=tokens(question);
 if(/\b(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(text))return {answer:'Hi, I’m Adriana. Tell me what you want to make easier, or ask about Revolt-X. I can help you find a useful starting point.',source:'Revolt-X'};
 if(/revolt.?x os|\bos\b/.test(text))return {answer:'Revolt-X OS brings your people, business applications and everyday work together. It helps you organise teams, give each person the right access, and follow tasks and approvals in one shared workspace.',source:'Revolt-X OS'};
 if(/revolt.?x ai|artificial intelligence|ai agent|\bai\b/.test(text))return {answer:'Revolt-X AI helps your team find answers, work with documents and handle routine tasks. We agree what it can do, which information it can use and where people need to review the work.',source:'Revolt-X AI'};
 if(/price|cost|pricing|quote/.test(text))return {answer:'The cost depends on what you need to build, the number of users, links to other tools and ongoing support. Tell us what you have in mind. We will agree the scope and quote before work begins.',source:'Getting started'};
 if(/demo|meeting|consult|contact|talk|speak|project|get started|start/.test(text))return {answer:'Choose “Let’s talk” and tell us about your idea or what is difficult in your current work. You do not need a technical brief. You can also call or WhatsApp +233 55 748 5233.',source:'Getting started'};
 if(/what.*(build|offer|do)|services|solutions/.test(text))return {answer:'We build business software, websites, mobile apps and AI tools. We also help with reports, everyday tasks, approvals and connections between existing systems. Start with what you want to make easier.',source:'Revolt-X solutions'};
 if(/website|web app|mobile app|software development/.test(text))return {answer:'We design and build websites, web apps and mobile experiences around the people who will use them. Tell us who the service is for and what you need it to do. We will discuss a clear plan with you.',source:'Websites & apps'};
 const ranked=solutions.map(solution=>({solution,score:words.filter(word=>tokens([solution.title,solution.summary,...solution.features,...solution.useCases].join(' ')).includes(word)).length})).sort((a,b)=>b.score-a.score);
 if(ranked[0]?.score>=2){const solution=ranked[0].solution;return {answer:solution.title+' could be a useful starting point. '+solution.summary+' We can discuss the details around your people, current tools and goals.',source:'Revolt-X: '+solution.title}}
 return null;
}
async function aiAssistant(question){
 const key=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL;
 if(!key||!model)return null;
 try{const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,instructions:'You are Adriana, the Revolt-X website guide. Answer briefly using plain English and only verified company facts. '+companyContext,input:question,max_output_tokens:400}),signal:AbortSignal.timeout(12000)});if(!response.ok){console.error('Assistant provider response:',response.status);return null}const result=await response.json();const answer=result.output_text||result.output?.flatMap(item=>item.content||[]).map(item=>item.text).filter(Boolean).join('\n');return answer?{answer,source:'Adriana · Revolt-X'}:null}catch{console.error('Assistant provider temporarily unavailable.');return null}
}
app.post('/api/assistant',rateLimit('assistant',60,600000),async(req,res,next)=>{
 try{const question=clean(req.body?.question,1500);if(!question)return res.status(400).json({message:'Please enter a question of up to 1,500 characters.'});const result=localAssistant(question)||await aiAssistant(question)||{answer:'I can help with Revolt-X services and tools. Tell me what you want to build or make easier. For a specific project, choose “Let’s talk” or call +233 55 748 5233.',source:'Revolt-X'};void recordActivity('INSERT INTO assistant_logs(question,answer,source) VALUES($1,$2,$3)',[question,result.answer,result.source]);res.json(result)}catch(error){next(error)}
});
app.post('/api/advisor',rateLimit('advisor',30,600000),async(req,res,next)=>{
 try{const problem=clean(req.body?.problem,2500);if(!problem)return res.status(400).json({message:'Please describe what you would like to make easier.'});const text=norm(problem);const rules=[['inventory-procurement',['stock','inventory','warehouse','supplier','procurement','reorder']],['fleet-logistics',['vehicle','fleet','driver','gps','delivery','route','fuel']],['crm-sales',['customer','lead','sales','crm','pipeline']],['hr-workforce',['staff','employee','payroll','leave','attendance','human resources']],['property-facility',['property','rent','tenant','facility']],['business-intelligence',['excel','data','dashboard','report','forecast','analytics']],['enterprise-data',['document','contract','policy','knowledge']],['workflow-automation',['approval','repetitive','workflow','form','process']],['web-mobile',['website','mobile app','web app']],['ai-business-solutions',['assistant','artificial intelligence','chatbot']]];let best={slug:'custom-applications',score:0};for(const [slug,keys] of rules){const score=keys.filter(key=>text.includes(key)).length;if(score>best.score)best={slug,score}}const solution=solutions.find(item=>item.slug===best.slug);void recordActivity('INSERT INTO advisor_logs(problem,solution) VALUES($1,$2)',[problem,solution.title]);res.json({solution:solution.title,reason:solution.summary,capabilities:solution.features})}catch(error){next(error)}
});
app.post('/api/demo',rateLimit('enquiry',20,3600000),requireDatabase,async(req,res,next)=>{
 try{
  const body=req.body||{};
  const name=clean(body.name,120),organisation=clean(body.organisation,160),email=clean(body.email,254),problem=clean(body.problem,5000),phone=clean(body.phone??'',40),solution=clean(body.solution??'',160);
  if(body.website)return res.status(400).json({ok:false,message:'Please reload the form and try again.'});
  if(!name||!organisation||!email||!emailPattern.test(email)||!problem||phone===null||solution===null)return res.status(400).json({ok:false,message:'Please check your name, organisation, email and message.'});
  await q('INSERT INTO demo_requests(name,organisation,email,phone,country,solution,industry,size,problem) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[name,organisation,email.toLowerCase(),phone,clean(body.country??'',100)||'',solution,clean(body.industry??'',100)||'',clean(body.size??'',100)||'',problem]);
  res.status(201).json({ok:true,message:'Thank you. Your message has been received. We’ll be in touch.'});
 }catch(error){next(error)}
});

app.post('/api/admin/login',rateLimit('login',10,900000),async(req,res,next)=>{
 try{const email=clean(req.body?.email,254),password=passwordValue(req.body?.password);if(!email||!password)return res.status(400).json({ok:false,message:'Enter your email address and password.'});const row=(await q('SELECT * FROM admins WHERE lower(email)=lower($1)',[email])).rows[0];if(!row||!verify(password,row.password_hash))return res.status(401).json({ok:false,message:'The email address or password is incorrect.'});const token=crypto.randomBytes(32).toString('hex');await q('INSERT INTO sessions(token,admin_id,expires_at) VALUES($1,$2,$3)',[token,row.id,new Date(Date.now()+8*3600000)]);res.setHeader('Set-Cookie',`rx_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production?'; Secure':''}`);res.json({ok:true})}catch(error){next(error)}
});
app.post('/api/admin/logout',auth,async(req,res,next)=>{try{await q('DELETE FROM sessions WHERE token=$1',[cookieToken(req)]);res.setHeader('Set-Cookie',`rx_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);res.json({ok:true})}catch(error){next(error)}});
app.get('/api/admin/me',auth,(req,res)=>res.json(req.admin));
app.get('/api/admin/dashboard',auth,async(req,res,next)=>{try{const [total,newCount,assistant,advisor,recent]=await Promise.all([q('SELECT COUNT(*)::int n FROM demo_requests'),q("SELECT COUNT(*)::int n FROM demo_requests WHERE status='new'"),q('SELECT COUNT(*)::int n FROM assistant_logs'),q('SELECT COUNT(*)::int n FROM advisor_logs'),q('SELECT * FROM demo_requests ORDER BY id DESC LIMIT 6')]);res.json({stats:{total:total.rows[0].n,new:newCount.rows[0].n,assistant:assistant.rows[0].n,advisor:advisor.rows[0].n},recent:recent.rows})}catch(error){next(error)}});
app.get('/api/admin/demos',auth,async(req,res,next)=>{try{res.json((await q('SELECT * FROM demo_requests ORDER BY id DESC')).rows)}catch(error){next(error)}});
app.patch('/api/admin/demos/:id',auth,async(req,res,next)=>{try{const status=clean(req.body?.status,30),notes=clean(req.body?.notes??'',10000);if(!/^\d+$/.test(req.params.id)||!['new','contacted','qualified','scheduled','closed'].includes(status)||notes===null)return res.status(400).json({message:'Check the status and notes, then try again.'});const result=await q('UPDATE demo_requests SET status=$1,notes=$2 WHERE id=$3 RETURNING id',[status,notes,req.params.id]);if(!result.rows.length)return res.status(404).json({message:'This enquiry could not be found.'});res.json({ok:true})}catch(error){next(error)}});
app.delete('/api/admin/demos/:id',auth,async(req,res,next)=>{try{if(!/^\d+$/.test(req.params.id))return res.status(400).json({message:'Choose a valid enquiry.'});await q('DELETE FROM demo_requests WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(error){next(error)}});
app.get('/api/admin/assistant',auth,async(req,res,next)=>{try{res.json((await q('SELECT * FROM assistant_logs ORDER BY id DESC LIMIT 200')).rows)}catch(error){next(error)}});
app.get('/api/admin/advisor',auth,async(req,res,next)=>{try{res.json((await q('SELECT * FROM advisor_logs ORDER BY id DESC LIMIT 200')).rows)}catch(error){next(error)}});
app.post('/api/admin/password',auth,async(req,res,next)=>{try{const current=passwordValue(req.body?.currentPassword),password=passwordValue(req.body?.newPassword),row=(await q('SELECT * FROM admins WHERE id=$1',[req.admin.id])).rows[0];if(!current||!verify(current,row.password_hash))return res.status(400).json({message:'The current password is incorrect.'});if(!password||password.length<12)return res.status(400).json({message:'Use a new password with at least 12 characters.'});await q('UPDATE admins SET password_hash=$1 WHERE id=$2',[hash(password),req.admin.id]);res.json({ok:true,message:'Your password has been updated.'})}catch(error){next(error)}});

// Website availability and database readiness are separate signals.
app.get('/api/health',(req,res)=>res.json({ok:true,service:'Revolt-X website',status:databaseReady?'ready':'degraded',database:databaseReady?'postgresql':'unavailable'}));
app.get('/api/health/database',async(req,res)=>{if(!databaseReady)return res.status(503).json({ok:false,database:'unavailable'});try{await q('SELECT 1');res.json({ok:true,database:'postgresql'})}catch{databaseReady=false;res.status(503).json({ok:false,database:'unavailable'})}});
app.use((error,req,res,next)=>{if(isDatabaseUnavailable(error)){databaseReady=false;return databaseUnavailable(req,res)}if(error.type==='entity.parse.failed'||error.type==='entity.too.large')return res.status(400).json({message:'Please check the information and try again.'});console.error('Request failed:',error.code||error.name);res.status(500).json({error:'We could not complete this just now. Please try again.'})});
app.listen(PORT,'0.0.0.0',()=>{console.log('Revolt-X running on port '+PORT);if(!pool)console.error('DATABASE_URL is not configured; public website remains online.');void reconnectDatabase()});
const databaseRetry=setInterval(()=>void reconnectDatabase(),databaseRetryMs);databaseRetry.unref();
