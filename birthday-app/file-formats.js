'use strict';
// File format adapter for the seven-column birthday directory and the
// nine-column pending-birthday report. No import is allowed to bypass
// server-side staff validation or the row-level transaction safeguards.
const ExcelJS = require('exceljs');
const XLSX = require('@stackline/xlsx');
const { parse: parseCSV } = require('csv-parse/sync');
const { PDFParse } = require('pdf-parse');
const PDFDocument = require('pdfkit');

const FORMATS = Object.freeze(['xlsx','xls','csv','pdf']);
const STAFF_HEADERS = Object.freeze(['Staff ID','Name','Number','Birthday','Department','Job Title','Email']);
const PENDING_HEADERS = Object.freeze([...STAFF_HEADERS,'Upcoming Birthday Date','Birthday Reminder']);
const normalize = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');

function detectExtension(filename){
  const ext=String(filename||'').split('.').at(-1).toLowerCase();
  if(!FORMATS.includes(ext))throw Error('Unsupported format. Upload .xls, .xlsx, .csv or a text-based .pdf table.');
  return ext;
}
function normalValue(value){
  if(value==null)return '';
  if(value instanceof Date)return value;
  if(typeof value==='object') {
    if('result' in value)return normalValue(value.result);
    if('text' in value)return normalValue(value.text);
    if(Array.isArray(value.richText))return value.richText.map(part=>part.text).join('');
    return '';
  }
  return String(value).trim();
}
function assertSize(buffer,maxBytes=5*1024*1024){
  if(!Buffer.isBuffer(buffer)||buffer.length===0)throw Error('The uploaded file is empty.');
  if(buffer.length>maxBytes)throw Error('Maximum upload size is 5 MB.');
}
function parseGrid(rows) {
  if(!Array.isArray(rows) || !rows.length)throw Error('The file contains no staff records.');
  if(rows.length>2100)throw Error('Import up to 2,000 staff records per file.');
  const nonEmpty=rows.filter(row=>Array.isArray(row)&&row.some(v=>String(v??'').trim()!==''));
  if(nonEmpty.length<2)throw Error('The file contains no staff records.');
  const names=nonEmpty[0].map(normalize);
  const header={};
  for(let i=0;i<names.length;i++)if(names[i])header[names[i]]=i;
  if(header.number===undefined)header.number=header.phonenumber??header.contactnumber;
  for(const key of ['staffid','name','birthday'])
    if(header[key]===undefined)throw Error('Missing column: '+key+'. Download the seven-column template.');
  const records=nonEmpty.slice(1);
  if(records.length>2000)throw Error('Import up to 2,000 staff records per file.');
  return records.map((row,index)=>{
    const get=key=>header[key]!==undefined ? normalValue(row[header[key]]) : '';
    // CSV spreadsheet clients may need a leading apostrophe to stop '+233...'
    // being treated as a formula. Remove it only from a validated phone string.
    const rawNumber=get('number');
    const number=/^'\+[\d\s().-]{5,35}$/.test(rawNumber) ? rawNumber.slice(1) : rawNumber;
    return {row:index+2,staff_code:get('staffid'),name:get('name'),number,
      birthday:get('birthday'),department:get('department'),job_title:get('jobtitle'),email:get('email')};
  });
}
function csvRows(buffer) {
  // Excel commonly saves CSV as UTF-8 with BOM. Keep all values as text to
  // preserve telephone numbers beginning with 0.
  return parseCSV(buffer.toString('utf8'),{
    bom:true,skip_empty_lines:true,relax_column_count:true,
    max_record_size:15000,skip_records_with_empty_values:false
  });
}
async function xlsxRows(buffer) {
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet=workbook.worksheets[0];
  if(!sheet)throw Error('Spreadsheet has no worksheets.');
  const result=[];
  sheet.eachRow((row)=>{
    const length=Math.min(32,Math.max(9,row.cellCount));
    const values=[];
    for(let i=1;i<=length;i++)values.push(normalValue(row.getCell(i).value));
    result.push(values);
  });
  return result;
}
function xlsRows(buffer) {
  const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  if(!sheet)throw Error('Spreadsheet has no worksheets.');
  return XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:false})
    .map(row=>row.map(normalValue));
}
function pdfTextRows(text){
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  // Generated PDF reports delimit their cells using " | ". Also accept a
  // similar plain-text table created in another PDF editor.
  const grid=[];
  for(const line of lines){
    if(!line.includes(' | '))continue;
    const cells=line.split(/\s+\|\s+/).map(x=>x.trim());
    if(cells.length>=7)grid.push(cells);
  }
  return grid;
}
async function pdfRows(buffer){
  const parser=new PDFParse({data:new Uint8Array(buffer)});
  try{
    const result=await parser.getText();
    let rows=pdfTextRows(result.text);
    if(rows.length<2){
      // Some digital PDFs contain real tables but no pipe separators.
      // Extract them when the PDF parser identifies tabular structures.
      const tableResult=await parser.getTable();
      const tables=(tableResult?.pages||[]).flatMap(page=>page.tables||[]);
      rows=tables.find(t=>Array.isArray(t)&&t.length>1&&t.some(row=>row.map(normalize).includes('staffid')))||[];
    }
    if(rows.length<2)throw Error('This PDF has no readable birthday table. Use a text-based PDF with the seven staff columns; scanned PDFs must be converted first.');
    return rows;
  }finally{await parser.destroy();}
}
async function importRecords(buffer,filename){
  assertSize(buffer);
  const extension=detectExtension(filename);
  try{
    const grid=extension==='xlsx' ? await xlsxRows(buffer)
      : extension==='xls' ? xlsRows(buffer)
      : extension==='csv' ? csvRows(buffer)
      : await pdfRows(buffer);
    return parseGrid(grid);
  }catch(error){
    if(/(Unsupported|Missing column|This PDF|contains no staff records|Import up to|Maximum upload|empty)/.test(error.message))throw error;
    throw Error('Could not read the '+extension.toUpperCase()+' file. Check that it contains a readable staff table with seven columns.');
  }
}
function safeCsvValue(value){
  let raw=value instanceof Date?value.toISOString().slice(0,10):String(value??'');
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(raw))raw="'"+raw;
  return '"'+raw.replace(/"/g,'""')+'"';
}
function toCSV(headers,rows){
  return '\ufeff'+[headers,...rows].map(row=>row.map(safeCsvValue).join(',')).join('\r\n')+'\r\n';
}
function toXLS(headers,rows){
  const workbook=XLSX.utils.book_new();
  const worksheet=XLSX.utils.aoa_to_sheet([headers,...rows.map(row=>row.map(v=>v instanceof Date?v.toISOString().slice(0,10):v))]);
  worksheet['!cols']=headers.map((_,i)=>({wch:[19,28,18,19,25,26,32,25,21][i]}));
  XLSX.utils.book_append_sheet(workbook,worksheet,'Staff Birthdays');
  return XLSX.write(workbook,{type:'buffer',bookType:'biff8'});
}
function toPDF(headers,rows,scope){
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A3',layout:'landscape',margin:35,bufferPages:true});
    const parts=[];doc.on('data',chunk=>parts.push(chunk));doc.on('end',()=>resolve(Buffer.concat(parts)));doc.on('error',reject);
    const usableWidth=doc.page.width-70;
    function heading(){
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#1d2635')
        .text('Revolt - Technologies | '+(scope==='pending'?'Pending Birthdays':'Staff Birthdays'),35,30,{lineBreak:false});
      doc.font('Helvetica').fontSize(9).fillColor('#66758c')
        .text('Generated '+new Date().toISOString().slice(0,10)+'   ·   Staff ID / Name / Number / Birthday / Department / Job Title / Email'+(scope==='pending'?' / Upcoming Birthday Date / Birthday Reminder':''),35,56,{lineBreak:false});
      doc.moveTo(35,75).lineTo(doc.page.width-35,75).lineWidth(1).strokeColor('#ed0036').stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#b1002c')
        .text(headers.join(' | '),35,85,{width:usableWidth,lineBreak:false,ellipsis:true});
      doc.moveTo(35,101).lineTo(doc.page.width-35,101).strokeColor('#dbe2ed').stroke();
    }
    heading();
    let y=108;
    for(let i=0;i<rows.length;i++){
      if(y>doc.page.height-48){doc.addPage();heading();y=108;}
      const columns=rows[i].map(v=>v instanceof Date?v.toISOString().slice(0,10):String(v??'').replace(/[\r\n|]/g,' ').trim());
      if(i%2===0)doc.rect(35,y-1,usableWidth,16).fill('#f6f8fb');
      doc.font('Helvetica').fontSize(8).fillColor('#28384a')
        .text(columns.join(' | '),39,y+2,{width:usableWidth-10,height:12,lineBreak:false,ellipsis:true});
      y+=17;
    }
    if(!rows.length){
      doc.font('Helvetica').fontSize(11).fillColor('#65758b').text('No matching records.',40,122);
    }
    const count=doc.bufferedPageRange().count;
    for(let p=0;p<count;p++){
      doc.switchToPage(p);
      doc.font('Helvetica').fontSize(8).fillColor('#7c8b9f').text('Page '+(p+1)+' of '+count,35,doc.page.height-29,{width:usableWidth,align:'right',lineBreak:false});
    }
    doc.end();
  });
}
async function exportContent(format,headers,rows,scope){
  if(!FORMATS.includes(format))throw Error('Choose XLS, XLSX, CSV or PDF.');
  if(format==='csv')return {buffer:Buffer.from(toCSV(headers,rows),'utf8'),mime:'text/csv; charset=utf-8'};
  if(format==='xls')return {buffer:toXLS(headers,rows),mime:'application/vnd.ms-excel'};
  if(format==='pdf')return {buffer:await toPDF(headers,rows,scope),mime:'application/pdf'};
  throw Error('XLSX export is handled by the existing styled Excel workbook writer.');
}
module.exports={FORMATS,STAFF_HEADERS,PENDING_HEADERS,detectExtension,parseGrid,pdfTextRows,importRecords,exportContent,toCSV};
