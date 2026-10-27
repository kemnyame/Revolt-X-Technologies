import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
const url=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!url)throw new Error('A database connection is required.');
const uri=new URL(url);uri.searchParams.delete('sslmode');uri.searchParams.delete('channel_binding');const pool=new pg.Pool({connectionString:uri.toString(),connectionTimeoutMillis:12000,max:1,ssl:{rejectUnauthorized:true}});
try{await migrate(drizzle(pool),{migrationsFolder:'./drizzle'});console.log('Database migrations applied.')}catch(error){console.error('Migration failed:',error instanceof Error?error.name:'Unknown error',(error as any).code||(error as any).cause?.code||'',(error as any).cause?.name||'');process.exitCode=1}finally{await pool.end()}
