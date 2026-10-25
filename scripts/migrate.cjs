const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');
(async()=>{
 const value=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
 if(!value)throw Error('Set DATABASE_URL_UNPOOLED to a direct PostgreSQL connection.');
 const url=new URL(value);
 if(url.hostname.includes('-pooler.'))throw Error('Use a direct connection for schema migrations.');
 const neon=url.hostname.endsWith('.neon.tech');
 if(neon)url.searchParams.set('sslmode','verify-full');
 const client=new Client({connectionString:url.toString(),ssl:neon||process.env.NODE_ENV==='production'?{rejectUnauthorized:true}:false,connectionTimeoutMillis:15000});
 await client.connect();
 try{
  const folder=path.join(__dirname,'../db/migrations');
  for(const file of fs.readdirSync(folder).filter(file=>file.endsWith('.sql')).sort()){
   await client.query('BEGIN');
   try{await client.query(fs.readFileSync(path.join(folder,file),'utf8'));await client.query('COMMIT');console.log('Applied '+file)}catch(error){await client.query('ROLLBACK');throw error}
  }
 }finally{await client.end()}
})().catch(error=>{console.error('Migration failed:',error.code||error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1});
