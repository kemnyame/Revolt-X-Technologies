const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {mkdtemp,writeFile,readFile,rm}=require('node:fs/promises');
const net=require('node:net');
const os=require('node:os');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');

const root=path.resolve(__dirname,'..');
const demo={name:'Test visitor',organisation:'Test organisation',email:'visitor@example.invalid',problem:'Automate inventory'};

async function waitFor(check,timeout=10000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(await check())return;await delay(40)}
 throw new Error('Timed out waiting for the expected server state');
}

async function startServer(t,environment={},preload){
 const reservation=net.createServer();
 reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const port=reservation.address().port;
 await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,[...(preload?['--require',preload]:[]),'server.js'],{
  cwd:root,
  env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:'',OPENAI_API_KEY:'',ADMIN_EMAIL:'test@example.invalid',ADMIN_PASSWORD:'test-only-password',...environment},
  stdio:['ignore','pipe','pipe']
 });
 let output='';
 child.stdout.on('data',chunk=>{output+=chunk});
 child.stderr.on('data',chunk=>{output+=chunk});
 t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited}});
 const url='http://127.0.0.1:'+port;
 await waitFor(async()=>{
  if(child.exitCode!==null)throw new Error('Server exited unexpectedly: '+output);
  try{return (await fetch(url+'/api/health')).ok}catch{return false}
 });
 const request=(route,body)=>fetch(url+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {request,logs:()=>output,child};
}

async function assertPublicWebsite(request){
 const page=await request('/');
 assert.equal(page.status,200);
 assert.match(await page.text(),/Revolt-X Technologies/);
 const script=await request('/js/app.js');assert.equal(script.status,200);
 const health=await request('/api/health');assert.equal(health.status,200);
 const status=await health.json();assert.equal(status.ok,true);
 const answer=await request('/api/assistant',{question:'What is Revolt-X OS?'});
 assert.equal(answer.status,200);assert.match((await answer.json()).answer,/Revolt-X OS/);
 const advisor=await request('/api/advisor',{problem:'Manage warehouse inventory and stock'});
 assert.equal(advisor.status,200);assert.match((await advisor.json()).solution,/Inventory/i);
}

async function assertUnavailableWrites(request){
 const response=await request('/api/demo',demo);
 assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'30');
 const body=await response.json();assert.equal(body.ok,false);assert.equal(body.code,'DATABASE_UNAVAILABLE');
 assert.match(body.message,/could not save/i);
 const admin=await request('/api/admin/login',{email:'test@example.invalid',password:'test-only-password'});
 assert.equal(admin.status,503);
 assert.equal((await request('/api/health/database')).status,503);
}

test('public pages, assistant and advisor work without DATABASE_URL; writes fail honestly',async t=>{
 const {request}=await startServer(t);
 await assertPublicWebsite(request);
 assert.equal((await (await request('/api/health')).json()).status,'degraded');
 await assertUnavailableWrites(request);
});

test('an unreachable database does not crash the website or fail its Render health check',async t=>{
 const server=await startServer(t,{DATABASE_URL:'postgresql://test:test@revolt-database.invalid:5432/revoltx'});
 await waitFor(()=>server.logs().includes('Database unavailable; public website remains online:'));
 assert.equal(server.child.exitCode,null);
 await assertPublicWebsite(server.request);
 await assertUnavailableWrites(server.request);
});

test('database features recover automatically; later outages and log failures leave pages online',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'revoltx-availability-'));
 // All data below belongs only to this test.
 const statePath=path.join(directory,'state.json');
 const savedPath=path.join(directory,'saved.json');
 const preload=path.join(directory,'controlled-pg.cjs');
 await writeFile(statePath,JSON.stringify({online:false}));
 await writeFile(preload,`
const Module=require('node:module');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
class Pool extends EventEmitter{
 async query(sql,params){
  const state=JSON.parse(fs.readFileSync(process.env.TEST_DATABASE_STATE,'utf8'));
  if(!state.online){const error=new Error('Test database unavailable');error.code='ENOTFOUND';throw error}
  if(state.failLogs&&/INSERT INTO (assistant_logs|advisor_logs)/.test(sql)){const error=new Error('Test log failure');error.code='42P01';throw error}
  if(/SELECT COUNT/.test(sql))return {rows:[{n:1}]};
  if(/INSERT INTO demo_requests/.test(sql))fs.writeFileSync(process.env.TEST_DATABASE_SAVED,JSON.stringify(params));
  return {rows:[]};
 }
}
const load=Module._load;
Module._load=function(name,...args){return name==='pg'?{Pool}:load.call(this,name,...args)};
const interval=global.setInterval;
global.setInterval=(fn,ms,...args)=>interval(fn,ms===30000?60:ms,...args);
`);
 const {request,logs}=await startServer(t,{
  DATABASE_URL:'postgresql://test:test@controlled.invalid/revoltx',
  TEST_DATABASE_STATE:statePath,TEST_DATABASE_SAVED:savedPath
 },preload);
 t.after(()=>rm(directory,{recursive:true,force:true}));
 await assertUnavailableWrites(request);
 await writeFile(statePath,JSON.stringify({online:true,failLogs:true}));
 await waitFor(async()=>(await (await request('/api/health')).json()).status==='ready');
 assert.equal((await request('/api/health/database')).status,200);
 await assertPublicWebsite(request);
 await waitFor(()=>logs().includes('Activity logging unavailable:'));
 const saved=await request('/api/demo',demo);
 assert.equal(saved.status,200);assert.equal((await saved.json()).ok,true);
 assert.equal(JSON.parse(await readFile(savedPath,'utf8'))[0],demo.name);
 await writeFile(statePath,JSON.stringify({online:false}));
 assert.equal((await request('/api/demo',demo)).status,503);
 await assertPublicWebsite(request);
 await assertUnavailableWrites(request);
 await writeFile(statePath,JSON.stringify({online:true}));
 await waitFor(async()=>(await (await request('/api/health')).json()).status==='ready');
 assert.equal((await request('/api/demo',demo)).status,200);
});
