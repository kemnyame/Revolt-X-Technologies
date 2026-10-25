'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {importRecords,exportContent,parseGrid,pdfTextRows,detectExtension,STAFF_HEADERS,PENDING_HEADERS,toCSV} = require('../file-formats');

const row=['STF-021','Akosua Mensah','0241234567','25/10/1990','Finance','Accounts Officer','akosua@example.com'];
test('detect supported extensions and reject other uploads',()=>{
  assert.deepEqual(['xls','xlsx','pdf','csv'].map(x=>detectExtension('records.'+x)),['xls','xlsx','pdf','csv']);
  assert.throws(()=>detectExtension('script.exe'),/Unsupported format/);
});
test('CSV exports and imports preserve Ghanaian phone numbers and complex names',async()=>{
  const data=[row,['STF-022','Nana, Kwame Osei','+233 201 234 567','25/10','Operations','Senior "Officer"','nana@example.com']];
  const out=await exportContent('csv',STAFF_HEADERS,data,'all');
  assert.equal(out.mime,'text/csv; charset=utf-8');
  const records=await importRecords(out.buffer,'birthdays.csv');
  assert.equal(records.length,2);
  assert.equal(records[0].number,'0241234567');
  assert.equal(records[1].name,'Nana, Kwame Osei');
  assert.equal(records[1].number,'+233 201 234 567');
  assert.equal(records[1].birthday,'25/10');
  assert.equal(records[1].job_title,'Senior "Officer"');
});
test('XLS export is a real Excel 97-2003 file that imports again',async()=>{
  const out=await exportContent('xls',STAFF_HEADERS,[row],'all');
  assert.equal(out.mime,'application/vnd.ms-excel');
  assert.ok(out.buffer.length>1000);
  const records=await importRecords(out.buffer,'team.xls');
  assert.equal(records.length,1);
  assert.equal(records[0].staff_code,'STF-021');
  assert.equal(records[0].name,'Akosua Mensah');
  assert.equal(records[0].number,'0241234567');
});
test('PDF export is a real readable PDF and its table can be imported',async()=>{
  const out=await exportContent('pdf',STAFF_HEADERS,[row],'all');
  assert.equal(out.mime,'application/pdf');
  assert.equal(out.buffer.subarray(0,4).toString('utf8'),'%PDF');
  const records=await importRecords(out.buffer,'birthdays.pdf');
  assert.equal(records.length,1);
  assert.equal(records[0].name,'Akosua Mensah');
});
test('Pending birthday reports preserve actionable date and countdown columns',async()=>{
  const rows=[row.concat(['2026-10-28','In 3 days'])];
  const csv=await exportContent('csv',PENDING_HEADERS,rows,'pending');
  const text=csv.buffer.toString('utf8');
  assert.ok(text.includes('Upcoming Birthday Date'));
  assert.ok(text.includes('Birthday Reminder'));
  assert.ok(text.includes('In 3 days'));
  const records=await importRecords(csv.buffer,'pending.csv');
  assert.equal(records.length,1);
  assert.equal(records[0].staff_code,'STF-021');
});
test('Reports reject invalid column definitions',()=>{
  assert.throws(()=>parseGrid([['Name','Birthday'],['Ama Mensah','25/10']]),/Missing column/);
  assert.deepEqual(pdfTextRows('Staff ID | Name | Number | Birthday | Department | Job Title | Email\nSTF-021 | Akosua Mensah | 0241234567 | 25/10/1990 | Finance | Officer | a@example.com').length,2);
});
test('CSV protects spreadsheet clients against formula injection',()=>{
  const output=toCSV(STAFF_HEADERS,[['STF-001','=2+2','01234','01/01/1990','Finance','Analyst','a@example.com']]);
  assert.ok(output.includes("\"'=2+2\""));
});
