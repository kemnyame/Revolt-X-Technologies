// Credentials arrive through stdin, stay in memory, and are never printed.
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const net=require('node:net');
const crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const assert=require('node:assert/strict');
const readline=require('node:readline');
const path=require('node:path');

console.log('Ready for database verification configuration on stdin.');
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
input.once('line',async line=>{
 input.close();
 let child;
 try{
  const configuration=JSON.parse(line);
  if(!/^postgres(?:ql)?:\/\//.test(configuration.databaseUrl))throw Error('A database connection is required');
  const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const password=crypto.randomBytes(24).toString('base64url');
  child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:configuration.databaseUrl,ADMIN_EMAIL:'website-qa@example.invalid',ADMIN_PASSWORD:password,OPENAI_API_KEY:'',OPENAI_MODEL:''},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',chunk=>{logs+=chunk});child.stderr.on('data',chunk=>{logs+=chunk});
  const base='http://127.0.0.1:'+port;
  const request=(route,method='GET',body,cookie)=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const deadline=Date.now()+25000;let ready=false;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Verification server exited');try{ready=(await (await request('/api/health')).json()).status==='ready';if(ready)break}catch{}await delay(150)}
  assert.equal(ready,true,'Database-backed website did not become ready. '+logs.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));
  assert.equal((await request('/api/health/database')).status,200);
  const marker='Website verification '+crypto.randomBytes(5).toString('hex');
  assert.equal((await request('/api/admin/demos')).status,401);
  const invalid=await request('/api/demo','POST',{name:'Test',organisation:'Test',email:'invalid',problem:'Test'});assert.equal(invalid.status,400);
  const invalidType=await request('/api/assistant','POST',{question:{invalid:true}});assert.equal(invalidType.status,400);
  const enquiry=await request('/api/demo','POST',{name:marker,organisation:'Revolt-X isolated verification branch',email:'verification@example.invalid',phone:'',solution:'Websites & mobile apps',problem:'Check that contact requests reach the website administrator.'});assert.equal(enquiry.status,201);assert.equal((await enquiry.json()).ok,true);
  const login=await request('/api/admin/login','POST',{email:'website-qa@example.invalid',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  const me=await request('/api/admin/me','GET',undefined,cookie);assert.equal(me.status,200);assert.equal((await me.json()).email,'website-qa@example.invalid');
  const enquiries=await (await request('/api/admin/demos','GET',undefined,cookie)).json();const saved=enquiries.find(row=>row.name===marker);assert.ok(saved,'Saved enquiry missing from admin results');
  const edit=await request('/api/admin/demos/'+saved.id,'PATCH',{status:'contacted',notes:'Verified only on the isolated database branch.'},cookie);assert.equal(edit.status,200);
  const updated=await (await request('/api/admin/demos','GET',undefined,cookie)).json();assert.equal(updated.find(row=>row.id===saved.id).status,'contacted');
  const assistant=await request('/api/assistant','POST',{question:'What is Revolt-X OS?'});assert.equal(assistant.status,200);assert.match((await assistant.json()).answer,/Revolt-X OS/);
  const guide=await request('/api/advisor','POST',{problem:'Manage warehouse inventory and stock'});assert.equal(guide.status,200);assert.match((await guide.json()).solution,/Stock/i);
  const overview=await request('/api/admin/dashboard','GET',undefined,cookie);assert.equal(overview.status,200);assert.ok((await overview.json()).stats.total>=1);
  assert.equal((await request('/api/admin/logout','POST',{},cookie)).status,200);
  assert.equal((await request('/api/admin/me','GET',undefined,cookie)).status,401);
  console.log(JSON.stringify({databaseReady:true,contactSaved:true,invalidInputRejected:true,adminSignIn:true,enquiryListed:true,enquiryUpdated:true,assistant:true,guide:true,dashboard:true,signOut:true,testData:'isolated Neon verification branch only'}));
 }catch(error){console.error('Verification failed:',error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1}
 finally{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited}}
});
