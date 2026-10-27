import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,parameters} from '../lib/database.ts';
import {validateLicense,monthsBefore,reminderBucket,renewalState,HEADERS,previewRows,csvRows,csvExport,parseDate,moneyMinor} from '../lib/domain.ts';
import type {License} from '../lib/domain.ts';
import {mutateRecords,getState,updateSettings,manageMember,one,all,initialize} from '../lib/store.ts';
import {runReminders,testEmail} from '../lib/email.ts';
import {resolveAccess,emailAllowed,requireAccess} from '../lib/access.ts';
import type {Viewer} from '../lib/access.ts';
import {encryptSecret,decryptSecret} from '../lib/secrets.ts';
const input=(extra:Record<string,unknown>={})=>validateLicense({name:'QA software',vendor:'Test vendor',licenseType:'Subscription',department:'QA only',expiryDate:'2026-12-27',lastPaymentAmount:'12345.67',seatCount:'10',quantityInUse:'8',notes:'Internal note excluded from emails',...extra});
const license=(extra:Record<string,unknown>={})=>({...input(extra),id:'test',archivedAt:null,createdAt:'',updatedAt:''}) as License;
test('two calendar months are calculated exactly, including month ends and leap years',()=>{
 assert.equal(monthsBefore('2026-12-27',2),'2026-10-27');
 assert.equal(monthsBefore('2027-04-30',2),'2027-02-28');
 assert.equal(monthsBefore('2028-04-30',2),'2028-02-29');
 assert.equal(monthsBefore('2027-01-31',2),'2026-11-30');
 assert.equal(reminderBucket(license(),[30,14,7,1,0],7,new Date('2026-10-26T23:59:59Z'),2),null);
 assert.equal(reminderBucket(license(),[30,14,7,1,0],7,new Date('2026-10-27T00:00:00Z'),2),'months:2');
 assert.equal(reminderBucket(license(),[30,14,7,1,0],7,new Date('2026-12-20'),2),'before:7');
 assert.equal(reminderBucket(license(),[30,14,7,1,0],7,new Date('2026-12-27'),2),'before:0');
 assert.equal(reminderBucket(license(),[30,14,7,1,0],7,new Date('2026-12-28'),2),'overdue:0');
 assert.equal(reminderBucket(license({status:'Retired'}),[30],7,new Date('2026-12-01'),2),null);
});
test('dates and exact GHS values reject invalid entries',()=>{
 assert.equal(parseDate('29/02/2024'),'2024-02-29');assert.throws(()=>parseDate('29/02/2025'));
 assert.equal(moneyMinor('GHS 1,234.56'),123456);assert.throws(()=>moneyMinor('12.345'));assert.throws(()=>moneyMinor('-1'));
 assert.equal(validateLicense(input({lastPaymentAmount:'12345678.91'})).lastPaymentMinor,1234567891);
 assert.equal(renewalState(license(),new Date('2026-12-27T23:00:00Z')).label,'Due today');
});
test('all 14 template columns round-trip through CSV and invalid import rows are identified',()=>{
 const original=input({notes:'A comma, a newline\nand "quotes"'});const rows=csvRows(csvExport([original]));
 assert.equal(HEADERS.length,14);assert.deepEqual(rows[0],[...HEADERS]);assert.deepEqual(previewRows(rows)[0].data,original);
 assert.equal(previewRows([rows[0],rows[1],rows[1]])[1].duplicate,true);
 const invalid=[...rows[1]];invalid[6]='31/02/2026';assert.equal(previewRows([rows[0],invalid])[0].errors.length,1);
 assert.match(csvExport([input({name:'=SUM(1,2)'})]),/"'=SUM/);
});
test('Postgres parameters do not replace question marks inside quoted strings or identifiers',()=>{
 assert.equal(parameters("SELECT ?, '?', 'it''s ?', \"a?\", ?"),"SELECT $1, '?', 'it''s ?', \"a?\", $2");
});
test('saved credentials use authenticated encryption',async()=>{const key='ab'.repeat(32),cipher=await encryptSecret('re_test_secret_12345678',key);assert.ok(!cipher.includes('re_test_secret'));assert.equal(await decryptSecret(cipher,key),'re_test_secret_12345678');await assert.rejects(decryptSecret(cipher,'cd'.repeat(32)))});
test('real PostgreSQL: imports, transactions, renewal history, workspace access and two-month email deduplication',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {db,close}=createDatabase(process.env.TEST_DATABASE_URL!);const viewer:Viewer={userId:'icdd-development-qa',email:'qa@example.test',displayName:'QA only',role:'owner'},request=(action:string,data:Record<string,unknown>={})=>({action,requestId:crypto.randomUUID(),...data}),suffix=crypto.randomUUID().slice(0,8),key='ab'.repeat(32);
 try{
 await initialize(db,viewer);
 const action=request('create',{record:input({name:'QA Office '+suffix,sn:'ABC-1'})});const created=await mutateRecords(db,viewer,action) as any;assert.deepEqual(await mutateRecords(db,viewer,action),created);
 await assert.rejects(mutateRecords(db,viewer,request('create',{record:input({name:'QA Office '+suffix})})),/matching/);
 const before=(await getState(db,viewer)).licenses.length;
 await assert.rejects(mutateRecords(db,viewer,request('import',{records:[input({name:'QA invalid import '+suffix}),{name:'Missing expiry'}]})),/Import row 2/);
 assert.equal((await getState(db,viewer)).licenses.length,before);
 const skipped=await mutateRecords(db,viewer,request('import',{records:[input({name:'QA Office '+suffix})],mode:'skip'})) as any;assert.equal(skipped.skipped,1);
 const updated=await mutateRecords(db,viewer,request('import',{records:[input({name:'QA Office '+suffix,quantityInUse:9})],mode:'update'})) as any;assert.equal(updated.updated,1);
 await mutateRecords(db,viewer,request('renew',{id:created.id,nextExpiry:'2027-12-27',paymentDate:'2026-10-27',paymentAmount:'999.99',notes:'QA renewal'}));
 let state=await getState(db,viewer);const item=state.licenses.find(i=>i.id===created.id)!;assert.equal(item.expiryDate,'2027-12-27');assert.equal(item.lastPaymentMinor,99999);assert.equal(state.renewals.find(r=>r.license_id===created.id)!.previous_expiry,'2026-12-27');
 assert.equal(JSON.parse(state.activity.find(a=>a.action==='renew'&&a.license_id===created.id)!.details).previousPaymentMinor,1234567);
 await mutateRecords(db,viewer,request('archive',{id:created.id}));assert.ok((await getState(db,viewer)).licenses.find(i=>i.id===created.id)!.archivedAt);await mutateRecords(db,viewer,request('restore',{id:created.id}));
 const count=(await one(db,'SELECT COUNT(*) AS n FROM activity'))!.n;
 await assert.rejects(db.batch([db.prepare('INSERT INTO activity(id,action,summary,details,actor,created_at) VALUES(?,?,?,?,?,?)').bind('qa-rollback-'+suffix,'test','Test','{}','qa','now'),db.prepare('INSERT INTO activity(id,action,summary,details,actor,created_at) VALUES(?,?,?,?,?,?)').bind('qa-rollback-'+suffix,'test','Test','{}','qa','now')]));
 assert.equal((await one(db,'SELECT COUNT(*) AS n FROM activity'))!.n,count);
 const readonly:Viewer={...viewer,role:'viewer'},editor:Viewer={...viewer,role:'editor'};
 await assert.rejects(mutateRecords(db,readonly,request('create',{record:input()})),/view-only/);
 await assert.rejects(updateSettings(db,editor,{},key),/admin/);
 await assert.rejects(manageMember(db,editor,request('addUser')),/admin/);
 assert.throws(()=>requireAccess(readonly,'manage'),/admin/);
 const oldOwners=process.env.ADMIN_EMAILS;process.env.ADMIN_EMAILS='qa@example.test';
 try{
  const ownerIdentity={id:viewer.userId,email:viewer.email,name:'QA only',emailVerified:true};
  assert.equal((await resolveAccess(db,ownerIdentity)).role,'owner');
  const memberEmail='qa-member-'+suffix+'@example.test';
  await manageMember(db,viewer,request('addUser',{email:memberEmail,name:'QA member',role:'viewer'}));
  assert.equal(await emailAllowed(db,memberEmail.toUpperCase()),true);
  assert.equal(await emailAllowed(db,'unlisted@example.test'),false);
  const identity={id:'qa-member-'+suffix,email:memberEmail,emailVerified:true},member=await resolveAccess(db,identity);
  assert.equal(member.role,'viewer');assert.equal((await getState(db,member)).members.length,0);
  await assert.rejects(resolveAccess(db,{...identity,emailVerified:false}),/Verify/);
  const row=(await one(db,'SELECT id FROM workspace_users WHERE email=?',memberEmail))!;
  await manageMember(db,viewer,request('updateUser',{id:row.id,name:'QA member',role:'editor',status:'active'}));
  const editing=await resolveAccess(db,identity);assert.equal(editing.role,'editor');
  await mutateRecords(db,editing,request('create',{record:input({name:'QA editor '+suffix,expiryDate:'2028-12-27'})}));
  await manageMember(db,viewer,request('updateUser',{id:row.id,name:'QA member',role:'admin',status:'active'}));
  const admin=await resolveAccess(db,identity);
  await manageMember(db,admin,request('addUser',{email:'qa-other-'+suffix+'@example.test',name:'QA other',role:'viewer'}));
  const ownerRow=(await one(db,'SELECT id FROM workspace_users WHERE email=?',viewer.email))!;
  await assert.rejects(manageMember(db,admin,request('updateUser',{id:ownerRow.id,name:'QA owner',role:'viewer'})),/owner/);
  await assert.rejects(manageMember(db,admin,request('updateUser',{id:row.id,name:'QA member',role:'viewer'})),/own access/);
  await manageMember(db,viewer,request('updateUser',{id:row.id,name:'QA member',role:'admin',status:'suspended'}));
  assert.equal(await emailAllowed(db,memberEmail),false);await assert.rejects(resolveAccess(db,identity),/does not have access/);
 }finally{if(oldOwners===undefined)delete process.env.ADMIN_EMAILS;else process.env.ADMIN_EMAILS=oldOwners}

 const mailItem=await mutateRecords(db,viewer,request('create',{record:input({name:'QA email '+suffix})})) as any;
 await updateSettings(db,viewer,{senderEmail:'test@example.test',recipients:['qa@example.test'],leadMonths:2,leadDays:[30,14,7,1,0],overdueInterval:7,enabled:true,apiKey:'re_fake_test_key_123456789'},key);
 state=await getState(db,viewer);assert.equal(state.settings.leadMonths,2);assert.ok(!JSON.stringify(state).includes('re_fake_test_key_123456789'));
 let sent=0;const ids:string[]=[],fetcher=async(_url:string,init:RequestInit)=>{sent++;const payload=JSON.parse(init.body as string);assert.deepEqual(payload.to,['qa@example.test']);assert.ok(!payload.text.includes('Internal note'));assert.ok(!payload.text.includes('12,345.67'));ids.push(new Headers(init.headers).get('Idempotency-Key')!);return new Response(JSON.stringify({id:'provider-test-'+sent}),{status:200})},config={encryptionKey:key,origin:'https://example.test'};
 await runReminders(db,config,{now:new Date('2026-10-26'),fetcher});assert.equal(sent,0);
 assert.equal((await runReminders(db,config,{now:new Date('2026-10-27'),fetcher})).accepted,1);await runReminders(db,config,{now:new Date('2026-10-27'),fetcher});assert.equal(sent,1);
 await mutateRecords(db,viewer,request('renew',{id:mailItem.id,nextExpiry:'2026-12-28',paymentAmount:'100'}));await runReminders(db,config,{now:new Date('2026-10-28'),fetcher});assert.equal(sent,2);assert.notEqual(ids[0],ids[1]);
 await db.prepare('UPDATE settings SET enabled=0 WHERE id=1').run();assert.equal((await runReminders(db,config,{now:new Date('2026-10-28'),fetcher})).state,'paused');assert.equal(sent,2);
 let testSends=0;const testId=crypto.randomUUID(),external='outside-workspace@example.test',testFetcher=async(_url:string,init:RequestInit)=>{testSends++;assert.deepEqual(JSON.parse(init.body as string).to,[external]);return new Response(JSON.stringify({id:'test-external-'+suffix}),{status:200})};
 await testEmail(db,config,testId,testFetcher,external);await testEmail(db,config,testId,testFetcher,external);assert.equal(testSends,1);
 await assert.rejects(testEmail(db,config,testId,testFetcher,'different@example.test'),/new test/);
 await assert.rejects(testEmail(db,config,crypto.randomUUID(),testFetcher,'invalid'),/valid email/);
 assert.deepEqual(JSON.parse((await one(db,'SELECT recipients FROM settings WHERE id=1'))!.recipients),['qa@example.test']);
 console.log('Only synthetic records in the isolated development branch were used. No real email was sent.');
 }finally{await db.prepare("UPDATE licenses SET archived_at=? WHERE department='QA only' AND archived_at IS NULL").bind(new Date().toISOString()).run();await db.prepare('UPDATE settings SET enabled=0 WHERE id=1').run();await db.prepare("UPDATE workspace_users SET status='suspended' WHERE email LIKE 'qa-%@example.test'").run();await close()}
});
