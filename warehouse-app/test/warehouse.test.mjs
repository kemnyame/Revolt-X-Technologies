import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {appFor} from '../server.mjs';
import {schema} from '../db.mjs';
import {randomUUID} from 'node:crypto';

const origin='http://localhost:3000';
const date=new Date().toISOString().slice(0,10);
const credential='Fixture-password-2026!';
let db, app, demo;
before(async()=>{
  db=new PGlite({parsers:{20:value=>value,1082:value=>value}});
  await db.exec(schema);
  app=await appFor(db,{appOrigin:origin,secure:false,inviteKey:'warehouse-local-tests-signing-key',enableDemo:true,allowSignup:true});
  await app.ready();
  const created=await call('POST','/api/auth/demo',{});
  assert.equal(created.statusCode,200,created.body);
  demo=cookie(created);
});
after(async()=>{await app?.close();await db?.close()});
function cookie(response){return String(response.headers['set-cookie']||'').split(';')[0]}
function call(method,url,payload,session,key=randomUUID()){
  const headers={origin,'idempotency-key':key};
  if(payload!==undefined)headers['content-type']='application/json';
  if(session)headers.cookie=session;
  return app.inject({method,url,headers,payload});
}
async function json(method,url,payload,session,key){
  const response=await call(method,url,payload,session,key);
  assert.equal(response.statusCode,200,response.body);
  return response.json();
}
async function signUp(name,email){
  const response=await call('POST','/api/auth/signup',{business:name,name,email,password:credential,currency:'GHS',timezone:'Africa/Accra'});
  assert.equal(response.statusCode,200,response.body);
  return {...response.json(),session:cookie(response)};
}
const products=()=>json('GET','/api/inventory',undefined,demo);
const item=(sku,extras={})=>({sku,name:'Fixture '+sku,category:'Testing',unit:'pcs',location:'T-01',reorderPoint:2,costMinor:200,priceMinor:500,...extras});
const row=async productId=>(await products()).rows.find(product=>product.id===productId);

test('demo is populated and unauthenticated requests cannot read stock',async()=>{
  assert.equal((await call('GET','/api/inventory')).statusCode,401);
  assert.equal((await products()).total,16);
  const dashboard=await json('GET','/api/dashboard',undefined,demo);
  assert.equal(dashboard.stock.skus,16);
  assert.ok(Number(dashboard.stock.units)>100);
  assert.ok(dashboard.paymentBreakdown.length>=2);
  assert.equal(dashboard.trend.length,7);
  assert.equal((await json('GET','/api/inbound',undefined,demo)).total,3);
  assert.equal((await json('GET','/api/expenses',undefined,demo)).total,6);
  assert.equal((await json('GET','/api/users',undefined,demo)).total,5);
});
test('receiving stock is idempotent and a failed sale changes neither balances nor the ledger',async()=>{
  const {id}=await json('POST','/api/inventory',item('QA-RECEIVE'),demo);
  const receipt={supplier:'Fixture supplier',shipment:'QA-IMPORT',date,lines:[{productId:id,quantity:12,costMinor:200}]};
  const key=randomUUID();
  const first=await json('POST','/api/inbound',receipt,demo,key);
  const retried=await json('POST','/api/inbound',receipt,demo,key);
  assert.deepEqual(retried,first);
  assert.equal((await row(id)).quantity,12);
  const altered=await call('POST','/api/inbound',{...receipt,shipment:'Another shipment'},demo,key);
  assert.equal(altered.statusCode,409);
  const prior=(await json('GET','/api/movements',undefined,demo)).total;
  const invalid=await call('POST','/api/sales',{customer:'Overdraw',date,method:'cash',lines:[{productId:id,quantity:13,priceMinor:500}]},demo);
  assert.equal(invalid.statusCode,409,invalid.body);
  assert.equal((await row(id)).quantity,12);
  assert.equal((await json('GET','/api/movements',undefined,demo)).total,prior);
  const cash=await json('POST','/api/sales',{customer:'Cash customer',date,method:'cash',lines:[{productId:id,quantity:5,priceMinor:500}]},demo);
  assert.equal((await row(id)).quantity,7);
  assert.equal((await call('POST','/api/inbound/'+first.id+'/reverse',{reason:'Test stock guard'},demo)).statusCode,409);
  await json('POST','/api/sales/'+cash.id+'/reverse',{reason:'Test reversal'},demo);
  assert.equal((await row(id)).quantity,12);
  await json('POST','/api/inbound/'+first.id+'/reverse',{reason:'Fixture cancellation'},demo);
  assert.equal((await row(id)).quantity,0);
  assert.equal((await json('GET','/api/sales/'+cash.id,undefined,demo)).status,'Reversed');
});
test('partial credit, pending cheques, rejected cheques and clearing are reflected in amount owing',async()=>{
  const product=(await products()).rows.find(p=>p.quantity>10);
  const sale=await json('POST','/api/sales',{customer:'Credit customer',date,method:'credit',dueOn:date,lines:[{productId:product.id,quantity:4,priceMinor:1000}]},demo);
  const path='/api/sales/'+sale.id;
  assert.equal(Number((await json('GET',path,undefined,demo)).balance_minor),4000);
  await json('POST',path+'/payments',{date,method:'cash',amountMinor:1000},demo);
  const cheque=await json('POST',path+'/payments',{date,method:'cheque',reference:'TEST-CHQ-1',amountMinor:3000},demo);
  let saved=await json('GET',path,undefined,demo);
  assert.equal(saved.status,'Cheque pending');
  assert.equal(Number(saved.balance_minor),3000);
  assert.equal(Number(saved.pending_minor),3000);
  assert.equal((await call('POST',path+'/payments',{date,method:'cash',amountMinor:1},demo)).statusCode,409);
  await json('POST',path+'/payments/'+cheque.id+'/decision',{date,action:'reject',reason:'Returned cheque'},demo);
  const replacement=await json('POST',path+'/payments',{date,method:'cheque',reference:'TEST-CHQ-2',amountMinor:3000},demo);
  await json('POST',path+'/payments/'+replacement.id+'/decision',{date,action:'clear'},demo);
  saved=await json('GET',path,undefined,demo);
  assert.equal(saved.status,'Paid');
  assert.equal(Number(saved.balance_minor),0);
  assert.equal(saved.payments.find(p=>p.id===cheque.id).status,'rejected');
});
test('Mobile Money references are unique and rejected duplicates roll back stock',async()=>{
  const p=(await products()).rows.find(p=>p.quantity>5);
  const form={customer:'MoMo customer',date,method:'momo',reference:'CASE-REF-QA',lines:[{productId:p.id,quantity:1,priceMinor:1000}]};
  await json('POST','/api/sales',form,demo);
  const duplicate=await call('POST','/api/sales',{...form,reference:'case-ref-qa'},demo);
  assert.equal(duplicate.statusCode,409,duplicate.body);
  assert.equal((await row(p.id)).quantity,p.quantity-1);
});
test('business data and roles remain isolated; an invite is single-use and access can be revoked',async()=>{
  const owner=await signUp('Fixture Warehouse','owner@example.test');
  assert.equal((await json('GET','/api/inventory',undefined,owner.session)).total,0);
  const demoProduct=(await products()).rows.find(p=>p.quantity>5);
  assert.equal((await call('POST','/api/inbound',{supplier:'Wrong workspace',date,lines:[{productId:demoProduct.id,quantity:1,costMinor:100}]},owner.session)).statusCode,400);
  await json('POST','/api/inventory',item('OWN-001'),owner.session);
  const invite=await json('POST','/api/users',{name:'Fixture Viewer',email:'viewer@example.test',role:'viewer'},owner.session);
  const token=new URLSearchParams(new URL(invite.invitationUrl).hash.slice(1)).get('invite');
  const accepted=await call('POST','/api/auth/accept',{token,password:credential});
  assert.equal(accepted.statusCode,200,accepted.body);
  assert.equal((await call('POST','/api/auth/accept',{token,password:credential})).statusCode,400);
  const viewer=cookie(accepted);
  const visible=await json('GET','/api/inventory',undefined,viewer);
  assert.equal(visible.total,1);
  assert.equal(visible.rows[0].cost_minor,undefined);
  assert.equal((await call('GET','/api/expenses',undefined,viewer)).statusCode,403);
  assert.equal((await call('POST','/api/inventory',item('BLOCKED'),viewer)).statusCode,403);
  const csv=await call('GET','/api/inventory/export',undefined,viewer);
  assert.equal(csv.statusCode,200,csv.body);
  assert.match(csv.body,/OWN-001/);
  assert.doesNotMatch(csv.body,/cost|EL-1001/);
  await json('PUT','/api/users/'+invite.id,{role:'viewer',status:'disabled'},owner.session);
  assert.equal((await call('GET','/api/session',undefined,viewer)).statusCode,401);
  const recovered=await json('POST','/api/auth/recover',{workspace:owner.workspace,email:'owner@example.test',recoveryCode:owner.recoveryCode,password:'New-fixture-password-2026!'});
  assert.notEqual(recovered.recoveryCode,owner.recoveryCode);
  assert.equal((await call('GET','/api/session',undefined,owner.session)).statusCode,401);
  assert.equal((await call('POST','/api/auth/login',{workspace:owner.workspace,email:'owner@example.test',password:'New-fixture-password-2026!'})).statusCode,200);
});
test('expense references are retained and cross-origin mutations are denied',async()=>{
  const bad=await app.inject({method:'POST',url:'/api/expenses',headers:{origin:'https://other.example.test','content-type':'application/json',cookie:demo},payload:{}});
  assert.equal(bad.statusCode,403);
  const expense=await json('POST','/api/expenses',{payee:'Fixture fuel supplier',category:'Transport',description:'Warehouse delivery',date,method:'transfer',reference:'BANK-QA-184',amountMinor:5000},demo);
  assert.equal((await json('GET','/api/expenses/'+expense.id,undefined,demo)).payment_reference,'BANK-QA-184');
  await json('POST','/api/expenses/'+expense.id+'/reverse',{reason:'Fixture reversal'},demo);
  assert.ok((await json('GET','/api/expenses/'+expense.id,undefined,demo)).voided_at);
});
