import pg from 'pg';
import type { PoolClient,QueryResultRow } from 'pg';
pg.types.setTypeParser(20,value=>Number(value));
export type Result<T>={results:T[];meta:{changes:number}};
export interface Statement{bind(...values:unknown[]):Statement;first<T=Record<string,unknown>>():Promise<T|null>;all<T=Record<string,unknown>>():Promise<Result<T>>;run():Promise<Result<Record<string,unknown>>>}
export interface Database{prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown[]>;transaction<T>(work:(db:Database)=>Promise<T>):Promise<T>}
// Convert bound placeholders only, never question marks inside quoted SQL.
export function parameters(sql:string){let result='',quoted=false,doubleQuoted=false,index=0;for(let i=0;i<sql.length;i++){const c=sql[i];if(c==="'"&&!doubleQuoted){if(quoted&&sql[i+1]==="'"){result+="''";i++;continue}quoted=!quoted}else if(c==='"'&&!quoted){if(doubleQuoted&&sql[i+1]==='"'){result+='""';i++;continue}doubleQuoted=!doubleQuoted}result+=c==='?'&&!quoted&&!doubleQuoted?'$'+(++index):c}return result}
export function createDatabase(connectionString:string){
 const uri=new URL(connectionString);uri.searchParams.delete('sslmode');uri.searchParams.delete('channel_binding');const pool=new pg.Pool({connectionString:uri.toString(),max:5,idleTimeoutMillis:20000,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true}});
 class Prepared implements Statement{
  readonly sql:string;readonly values:unknown[];readonly client?:PoolClient;
  constructor(sql:string,values:unknown[]=[],client?:PoolClient){this.sql=sql;this.values=values;this.client=client}
  bind(...values:unknown[]){return new Prepared(this.sql,values,this.client)}
  async execute(client?:PoolClient){const r=await (client||this.client||pool).query<QueryResultRow>(parameters(this.sql),this.values);return {results:r.rows,meta:{changes:r.rowCount||0}}}
  async first<T=Record<string,unknown>>(){return (await this.execute()).results[0] as T||null}
  async all<T=Record<string,unknown>>(){return await this.execute() as Result<T>}
  async run(){return await this.execute()}
 }
 const scoped=(client?:PoolClient):Database=>({prepare:sql=>new Prepared(sql,[],client),async batch(statements){if(client){const results=[];for(const statement of statements){if(!(statement instanceof Prepared))throw new Error('Invalid transaction statement');results.push(await statement.execute(client))}return results}return db.transaction(tx=>tx.batch(statements))},async transaction(work){if(client)return work(scoped(client));const connection=await pool.connect();try{await connection.query('BEGIN');const result=await work(scoped(connection));await connection.query('COMMIT');return result}catch(error){await connection.query('ROLLBACK');throw error}finally{connection.release()}}});
 const db:Database=scoped();
 return {db,pool,close:()=>pool.end()};
}
let runtime:ReturnType<typeof createDatabase>|undefined;
export function database(){if(!runtime){if(!process.env.DATABASE_URL)throw new Error('Database connection is not configured.');runtime=createDatabase(process.env.DATABASE_URL)}return runtime.db}
