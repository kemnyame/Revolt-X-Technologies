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

test('cosmetics pack quantities convert to units and posted receipts retain their original pack size',async()=>{
  const spray=(await products()).rows.find(product=>product.sku==='FR-1001');
  assert.match(spray.name,/Body Spray/);
  assert.equal(spray.units_per_box,12);
  assert.equal(spray.boxes_per_carton,6);
  const inventory=await json('GET','/api/reports/inventory?q=FR-1001',undefined,demo);
  assert.equal(inventory.rows[0].quantity,183);
  assert.equal(inventory.rows[0].cartons,2);
  assert.equal(inventory.rows[0].boxes,3);
  assert.equal(inventory.rows[0].loose,3);

  const {id}=await json('POST','/api/inventory',item('QA-BOX',{unitsPerBox:12,boxesPerCarton:6}),demo);
  const receipt=await json('POST','/api/inbound',{supplier:'Cosmetics supplier',date,
    lines:[{productId:id,quantity:5,boxes:2,cartons:1,costMinor:200}]},demo);
  assert.equal((await row(id)).quantity,101);
  const receiptPath='/api/inbound/'+receipt.id;
  const before=await json('GET',receiptPath,undefined,demo);
  assert.equal(Number(before.total_minor),20200);
  assert.equal(before.lines[0].units_per_box,12);
  const sale=await json('POST','/api/sales',{customer:'Cosmetics shop',date,method:'cash',
    lines:[{productId:id,quantity:2,boxes:1,priceMinor:500}]},demo);
  const saleRecord=await json('GET','/api/sales/'+sale.id,undefined,demo);
  assert.equal(saleRecord.lines[0].quantity,14);
  assert.equal(Number(saleRecord.total_minor),7000);
  assert.match(saleRecord.payments[0].receipt_number,/^PAY-[A-F0-9]{12}$/);
  assert.equal((await row(id)).quantity,87);

  await json('PUT','/api/inventory/'+id,item('QA-BOX',{unitsPerBox:10,boxesPerCarton:5,archived:false}),demo);
  assert.equal((await row(id)).quantity,87);
  assert.equal((await json('GET',receiptPath,undefined,demo)).lines[0].units_per_box,12);
  const stale=await call('POST','/api/inbound',{supplier:'Cosmetics supplier',date,
    lines:[{productId:id,quantity:0,boxes:1,costMinor:200,pack:{unitsPerBox:12,boxesPerCarton:6}}]},demo);
  assert.equal(stale.statusCode,409);
  const invalid=await call('POST','/api/inventory',item('QA-INVALID-BOX',{boxesPerCarton:6}),demo);
  assert.equal(invalid.statusCode,400);
  assert.equal((await row(id)).quantity,87);
});

test('all reports and CSV exports use workspace-scoped data and controlled access',async()=>{
  const supported=await json('GET','/api/reports',undefined,demo);
  assert.equal(supported.length,12);
  const from=new Date(Date.parse(date)-14*86400000).toISOString().slice(0,10);
  for(const {key} of supported){
    const report=await json('GET','/api/reports/'+key+'?from='+from,undefined,demo);
    assert.ok(report.columns.length>1,key);
    assert.ok(report.rows.length>0,key);
    const csv=await call('GET','/api/reports/'+key+'/export?from='+from,undefined,demo);
    assert.equal(csv.statusCode,200,csv.body);
    assert.match(csv.headers['content-type'],/text\/csv/);
  }
  assert.equal((await call('GET','/api/reports/inventory')).statusCode,401);
  assert.equal((await call('GET','/api/reports/sales?from=2000-01-01&to='+date,undefined,demo)).statusCode,400);

  const owner=await signUp('Report Permissions','report-owner@example.test');
  const {id}=await json('POST','/api/inventory',item('REPORT-ONLY'),owner.session);
  assert.equal((await json('GET','/api/reports/inventory?q=FR-1001',undefined,owner.session)).records,0);
  const invite=await json('POST','/api/users',{name:'Warehouse Viewer',email:'report-viewer@example.test',role:'viewer'},owner.session);
  const token=new URLSearchParams(new URL(invite.invitationUrl).hash.slice(1)).get('invite');
  const accepted=await call('POST','/api/auth/accept',{token,password:credential});
  const viewer=cookie(accepted);
  const shared=await json('GET','/api/reports/inventory',undefined,viewer);
  assert.equal(shared.rows[0].sku,'REPORT-ONLY');
  assert.ok(shared.columns.every(col=>!col.key.includes('cost')&&col.key!=='stock_value_minor'));
  assert.equal((await call('GET','/api/reports/collections',undefined,viewer)).statusCode,403);
  assert.equal((await call('GET','/api/end-of-day',undefined,viewer)).statusCode,403);
  assert.ok(id);
});

test('end-of-day separates sales, actual cash, pending cheques and immutable count snapshots',async()=>{
  const owner=await signUp('Cash Closing Fixture','cash-closing@example.test');
  const session=owner.session;
  const yesterday=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
  const {id}=await json('POST','/api/inventory',item('EOD-COSMETICS'),session);
  await json('POST','/api/inbound',{supplier:'Closing fixture',date:yesterday,lines:[{productId:id,quantity:100,costMinor:200}]},session);

  const sale=(method,soldOn,amount,extras={})=>json('POST','/api/sales',{customer:'Closing test customer',
    date:soldOn,method,lines:[{productId:id,quantity:1,priceMinor:amount}],...extras},session);
  const credit=await sale('credit',yesterday,10000,{dueOn:yesterday});
  await json('POST','/api/sales/'+credit.id+'/payments',{date,method:'cash',amountMinor:3000},session);
  await json('POST','/api/sales/'+credit.id+'/payments',{date,method:'cheque',amountMinor:2000,reference:'EOD-PENDING'},session);
  const clearedSale=await sale('cheque',yesterday,3200,{reference:'EOD-CLEARS'});
  const cheque=(await json('GET','/api/sales/'+clearedSale.id,undefined,session)).payments[0];
  await json('POST','/api/sales/'+clearedSale.id+'/payments/'+cheque.id+'/decision',{date,action:'clear'},session);
  await sale('cash',date,1000);
  await sale('momo',date,1500,{reference:'EOD-MOMO'});
  await sale('cheque',date,1300,{reference:'EOD-OTHER-PENDING'});
  const expense=(amountMinor,method='cash')=>json('POST','/api/expenses',{payee:'Closing fixture',category:'Packaging',
    description:'Cash check',date,method,amountMinor,reference:method==='transfer'?'EOD-BANK':undefined},session);
  await expense(700);
  await expense(1200,'transfer');

  const live=await json('GET','/api/end-of-day?date='+date,undefined,session);
  const {report}=live;
  assert.equal(report.cashIn,'4000');
  assert.equal(report.cashOut,'700');
  assert.equal(report.netCash,'3300');
  assert.equal(report.collections.find(r=>r.method==='cheque').amount,'3200');
  assert.equal(report.sales.find(r=>r.method==='cheque').amount,'1300');
  assert.equal(report.pending.amount,'3300');
  assert.equal(report.overdue.amount,'7000');
  assert.equal(report.movements.find(r=>r.kind==='sale').units,'-3');
  const historic=await json('GET','/api/end-of-day?date='+yesterday,undefined,session);
  assert.equal(historic.report.pending.amount,'3200');
  assert.equal(historic.report.cashIn,'0');

  const body={date,openingMinor:5000,countedMinor:8200,notes:'Counted while closing'};
  const key=randomUUID();
  const record=await json('POST','/api/end-of-day/reconcile',body,session,key);
  assert.deepEqual(await json('POST','/api/end-of-day/reconcile',body,session,key),record);
  assert.equal(record.expectedMinor,'8300');
  assert.equal(record.varianceMinor,'-100');
  await expense(100);
  const current=await json('GET','/api/end-of-day',undefined,session);
  assert.equal(current.report.netCash,'3200');
  assert.equal(current.reconciliations.length,1);
  const snapshot=await json('GET','/api/end-of-day/reconciliations/'+record.id,undefined,session);
  assert.equal(snapshot.snapshot.netCash,'3300');
  assert.equal(snapshot.notes,'Counted while closing');
  assert.equal((await call('GET','/api/end-of-day/reconciliations/'+record.id,undefined,demo)).statusCode,404);
  const csv=await call('GET','/api/end-of-day/export?id='+record.id,undefined,session);
  assert.equal(csv.statusCode,200,csv.body);
  assert.match(csv.body,/"Variance","-1.00"/);
});
