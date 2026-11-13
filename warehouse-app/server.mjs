import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { cleanExpired, database, fail, migrate } from './db.mjs';
import { registerAuth } from './auth.mjs';
import { registerOperations } from './operations.mjs';
import { seedDemo } from './demo.mjs';

const assets = {
  '/': ['./public/index.html','text/html; charset=utf-8'],
  '/app.js': ['./public/app.js','text/javascript; charset=utf-8'],
  '/styles.css': ['./public/styles.css','text/css; charset=utf-8'],
  '/mark.svg': ['./public/mark.svg','image/svg+xml']
};

export async function appFor(db, options){
  const {secure,appOrigin,inviteKey,allowSignup,enableDemo,trustProxy,logging}=options;
  const app=Fastify({logger:logging?{level:'warn'}:false,trustProxy:trustProxy??false,bodyLimit:64*1024});
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('cache-control','no-store')
      .header('x-content-type-options','nosniff')
      .header('referrer-policy','no-referrer')
      .header('x-frame-options','DENY')
      .header('permissions-policy','camera=(), microphone=(), geolocation=()')
      .header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if(secure)reply.header('strict-transport-security','max-age=31536000');
    if(['POST','PUT','PATCH','DELETE'].includes(request.method)){
      if(request.headers.origin!==appOrigin||request.headers['sec-fetch-site']==='cross-site')fail(403,'Open the warehouse application to make this change.');
      if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']||''))fail(415,'Send this request as JSON.');
    }
  });
  app.setErrorHandler((error,request,reply)=>{
    if(error instanceof ZodError) return reply.code(400).send({error:error.issues.map(issue=>{
      const path=issue.path.join('.');
      return path?path.replace(/([A-Z])/g,' $1').toLowerCase()+': '+issue.message:issue.message;
    }).join(' ')});
    if(error.code==='23505'){
      const message=error.constraint==='unique_momo_reference'?'That Mobile Money reference has already been recorded.':
        error.constraint?.includes('sku')?'That SKU already exists in this workspace.':
        error.constraint?.includes('email')?'That email already belongs to this workspace.':'A record with that reference already exists.';
      return reply.code(409).send({error:message});
    }
    if(error.statusCode&&error.statusCode<500)return reply.code(error.statusCode).send({error:error.message});
    request.log.error({code:error.code,name:error.name,requestId:request.id},'Warehouse request failed');
    return reply.code(500).send({error:'The warehouse could not complete the request. Try again.',requestId:request.id});
  });
  for(const [path,[file,contentType]] of Object.entries(assets)){
    const contents=await readFile(new URL(file,import.meta.url));
    app.get(path,async(_request,reply)=>reply.type(contentType).send(contents));
  }
  app.get('/health',async(_request,reply)=>{
    try{await db.query('SELECT 1');return {status:'ready'};}
    catch{return reply.code(503).send({status:'unavailable'});}
  });
  const auth=registerAuth(app,db,{secure,appOrigin,inviteKey,allowSignup,enableDemo,seedDemo});
  registerOperations(app,db,auth);
  return app;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const secure=process.env.NODE_ENV==='production';
  const port=Number(process.env.PORT||3000);
  const appOrigin=process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL||(!secure?'http://localhost:'+port:'');
  const inviteKey=process.env.INVITE_KEY||(!secure?'local-development-only-invitation-key':'');
  if(!process.env.DATABASE_URL||!appOrigin||inviteKey.length<32)throw Error('Set DATABASE_URL, APP_ORIGIN and a secure INVITE_KEY.');
  if(new URL(appOrigin).origin!==appOrigin||(secure&&!appOrigin.startsWith('https://')))throw Error('APP_ORIGIN must be the HTTPS origin without a trailing slash.');
  const db=database(process.env.DATABASE_URL);
  db.on('error',error=>console.error('Database connection error',error.code||error.name));
  try { await migrate(db); }
  catch(error){ console.error('Warehouse database initialisation failed',error.code||error.name);process.exit(1); }
  const app=await appFor(db,{secure,appOrigin,inviteKey,allowSignup:process.env.ALLOW_SIGNUP==='1',
    enableDemo:process.env.ENABLE_DEMO==='1',trustProxy:process.env.RENDER==='true'?1:false,logging:true});
  await app.listen({port,host:'0.0.0.0'});
  console.log('Warehouse ready on port '+port);
  const cleanup=setInterval(()=>cleanExpired(db).catch(error=>console.warn('Cleanup delayed',error.code||error.name)),30*60000);
  cleanup.unref();
  cleanExpired(db).catch(error=>console.warn('Cleanup delayed',error.code||error.name));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{
    clearInterval(cleanup);
    await app.close();
    await db.end();
  });
}
