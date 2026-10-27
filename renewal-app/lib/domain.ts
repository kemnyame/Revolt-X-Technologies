export const HEADERS=['SN','Software/Hardware/Service','Vendor','License Type','Department/Asset Owner/Users','Purchase Date / Last Renewal Date','Expiry / Renewal Date','Quantity Purchased','License / Seat Count','Quantity in Use','Status','Last Payment Date','Last Payment Amount (GHS)','ICDD Follow-up / Notes'] as const;
export const DEFAULT_LEAD_DAYS=[30,14,7,1,0];
export const DEFAULT_LEAD_MONTHS=2;
export type LicenseInput={sn:string;name:string;vendor:string;licenseType:string;department:string;purchaseDate:string|null;expiryDate:string|null;quantityPurchased:number|null;seatCount:number|null;quantityInUse:number|null;status:string;lastPaymentDate:string|null;lastPaymentMinor:number|null;notes:string};
export type License=LicenseInput&{id:string;createdAt:string;updatedAt:string;archivedAt:string|null};
export type Settings={senderName:string;senderEmail:string;replyTo:string;recipients:string[];leadDays:number[];leadMonths:number;overdueInterval:number;enabled:boolean;apiKeySet:boolean;jobLastChecked:string|null;jobLastResult:string|null;scheduleRegistered:boolean};
export class InputError extends Error{status=400;constructor(message:string){super(message);this.name='InputError'}}
const clean=(v:unknown,max:number)=>{const s=String(v??'').trim();if(s.length>max)throw new InputError(`A field exceeds ${max} characters.`);return s};
export const normalKey=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export const matchKey=(v:LicenseInput)=>[v.name,v.vendor,v.licenseType,v.department].map(normalKey).join('|');
export const todayUTC=(now:Date=new Date())=>now.toISOString().slice(0,10);
export function parseDate(value:unknown,label='Date'):string|null{
 if(value==null||value==='')return null;
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw new InputError(`${label} is not a valid date.`);return value.toISOString().slice(0,10)}
 if(typeof value==='number'){if(!Number.isFinite(value)||value<1||value>2958465||Math.floor(value)===60)throw new InputError(`${label} is not a valid Excel date.`);return new Date(Date.UTC(1899,11,value<60?31:30)+Math.floor(value)*86400000).toISOString().slice(0,10)}
 const s=String(value).trim();let y:number,m:number,d:number;const iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/),gb=s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
 if(iso){y=+iso[1];m=+iso[2];d=+iso[3]}else if(gb){d=+gb[1];m=+gb[2];y=+gb[3]}else throw new InputError(`${label}: use YYYY-MM-DD or DD/MM/YYYY.`);
 const date=new Date(Date.UTC(y,m-1,d));if(y<1900||y>9999||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw new InputError(`${label} is not a valid calendar date.`);
 return date.toISOString().slice(0,10);
}
export function moneyMinor(value:unknown):number|null{
 if(value==null||String(value).trim()==='')return null;
 const s=String(value).trim().replace(/^(GHS|GH₵|₵)\s*/i,'');
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))throw new InputError('Payment amount must be a positive GHS amount with up to two decimal places.');
 const [whole,decimal='']=s.replaceAll(',','').split('.');const n=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(!Number.isSafeInteger(n)||n>100000000000)throw new InputError('Payment amount is too large.');return n;
}
function quantity(value:unknown,label:string,max=1000000000){if(value==null||String(value).trim()==='')return null;const s=String(value).trim(),n=Number(s.replaceAll(',',''));if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)||!Number.isSafeInteger(n)||n<0||n>max)throw new InputError(`${label} must be a whole number of zero or more.`);return n}
export function validateLicense(raw:Record<string,unknown>):LicenseInput{
 const name=clean(raw.name,240);if(!name)throw new InputError('Software, hardware or service name is required.');
 const licenseType=clean(raw.licenseType,100),expiryDate=parseDate(raw.expiryDate,'Expiry / Renewal Date');
 if(!expiryDate&&!/perpetual|non[ -]?expiring|no expiry/i.test(licenseType))throw new InputError('Expiry / Renewal Date is required. Use license type Perpetual for an item without expiry.');
 return {sn:clean(raw.sn,40),name,vendor:clean(raw.vendor,200),licenseType,department:clean(raw.department,240),purchaseDate:parseDate(raw.purchaseDate,'Purchase / Last Renewal Date'),expiryDate,quantityPurchased:quantity(raw.quantityPurchased,'Quantity purchased'),seatCount:quantity(raw.seatCount,'Seat count'),quantityInUse:quantity(raw.quantityInUse,'Quantity in use'),status:clean(raw.status,80)||'Active',lastPaymentDate:parseDate(raw.lastPaymentDate,'Last Payment Date'),lastPaymentMinor:raw.lastPaymentMinor!==undefined?(raw.lastPaymentMinor==null?null:quantity(raw.lastPaymentMinor,'Payment amount',100000000000)):moneyMinor(raw.lastPaymentAmount),notes:clean(raw.notes,5000)};
}
export function daysUntil(date:string,now:Date=new Date()){return Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(todayUTC(now)+'T00:00:00Z'))/86400000)}
export function dormant(item:Pick<License,'status'|'archivedAt'>){return !!item.archivedAt||/^(retired|cancelled|canceled|inactive|suspended)$/i.test(item.status)}
export function renewalState(item:License,now:Date=new Date()):{label:string;tone:string;days:number|null}{
 if(item.archivedAt)return {label:'Archived',tone:'neutral',days:null};if(dormant(item))return {label:item.status,tone:'neutral',days:null};if(!item.expiryDate)return {label:'No expiry',tone:'neutral',days:null};const d=daysUntil(item.expiryDate,now);
 return {label:d<0?'Expired':d===0?'Due today':d<=7?'Due within 7 days':d<=30?'Due within 30 days':d<=90?'Upcoming':'Active',tone:d<0?'danger':d<=7?'warning':d<=30?'amber':d<=90?'violet':'success',days:d};
}
export function monthsBefore(date:string,months:number){const [y,m,d]=date.split('-').map(Number),target=new Date(Date.UTC(y,m-1-months,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();return new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(d,last))).toISOString().slice(0,10)}
export function reminderBucket(item:License,leadDays:number[],overdueInterval:number,now:Date=new Date(),leadMonths=DEFAULT_LEAD_MONTHS):string|null{
 if(dormant(item)||!item.expiryDate)return null;const d=daysUntil(item.expiryDate,now);
 if(d<0)return overdueInterval>0?'overdue:'+Math.floor((-d-1)/overdueInterval):null;
 if(leadMonths>0&&todayUTC(now)<monthsBefore(item.expiryDate,leadMonths))return null;
 const bucket=[...leadDays].sort((a,b)=>a-b).find(day=>day>=d);return bucket!==undefined?'before:'+bucket:leadMonths>0?'months:'+leadMonths:null;
}
export function leadDaysInput(value:unknown):number[]{const parts=Array.isArray(value)?value:String(value??'').split(',');const nums=[...new Set(parts.map(v=>Number(String(v).trim())))];if(!parts.length||parts.some(v=>String(v).trim()==='')||!nums.length||nums.length>15||nums.some(n=>!Number.isInteger(n)||n<0||n>365))throw new InputError('Reminder days must be whole numbers between 0 and 365.');return nums.sort((a,b)=>b-a)}
export const emailValid=(value:string)=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)&&value.length<=254;
export function recipientsInput(value:unknown):string[]{const values=Array.isArray(value)?value:String(value??'').split(/[,;\n]/);const emails=[...new Set(values.map(v=>String(v).trim().toLowerCase()).filter(Boolean))];if(emails.length>10||emails.some(s=>!emailValid(s)))throw new InputError('Enter up to 10 valid recipient email addresses.');return emails}
export const displayDate=(date:string|null)=>date?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z')):'—';
export const displayMoney=(minor:number|null)=>minor==null?'—':'GHS '+(minor/100).toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2});
export const dateLabel=(d:number|null)=>d==null?'No expiry':d===0?'Today':d===1?'Tomorrow':d>0?`In ${d} days`:`${-d} day${d===-1?'':'s'} overdue`;
export function csvRows(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
 text=text.replace(/^\uFEFF/,'');for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else if(quoted||field==='')quoted=!quoted;else field+=c}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field=''}else field+=c}
 if(quoted)throw new InputError('A quoted CSV field is not closed.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
const headerKey=(v:unknown)=>String(v??'').replace(/&nbsp;|&#x20;/gi,' ').normalize('NFKC').toLowerCase().replace(/\s+/g,'').trim();
export type ImportRow={row:number;data:LicenseInput|null;errors:string[];duplicate:boolean;existingId?:string};
export function previewRows(rows:unknown[][],existing:License[]=[]):ImportRow[]{
 if(rows.length<1)throw new InputError('The spreadsheet is empty.');const headings=rows[0].map(headerKey),indices=HEADERS.map(h=>headings.indexOf(headerKey(h)));const missing=HEADERS.filter((_,i)=>indices[i]<0);if(missing.length)throw new InputError('Missing template columns: '+missing.join(', '));
 if(rows.length>1001)throw new InputError('Import up to 1,000 records at a time.');const seen=new Set<string>(),known=new Map(existing.map(x=>[matchKey(x),x.id]));
 return rows.slice(1).map((row,index):ImportRow|null=>{const cells=indices.map(i=>row[i]??'');if(!cells.some(v=>String(v).trim()))return null;try{
 const data=validateLicense({sn:cells[0],name:cells[1],vendor:cells[2],licenseType:cells[3],department:cells[4],purchaseDate:cells[5],expiryDate:cells[6],quantityPurchased:cells[7],seatCount:cells[8],quantityInUse:cells[9],status:cells[10],lastPaymentDate:cells[11],lastPaymentAmount:cells[12],notes:cells[13]});const key=matchKey(data),duplicate=seen.has(key);seen.add(key);return {row:index+2,data,errors:duplicate?['Duplicate item within this file. Keep one row for each software, vendor, licence type and owner combination.']:[],duplicate,existingId:known.get(key)};
 }catch(error){return {row:index+2,data:null,errors:[error instanceof Error?error.message:'This row could not be read.'],duplicate:false}}}).filter((x):x is ImportRow=>x!==null);
}
export function templateValues(item:LicenseInput):unknown[]{return [item.sn,item.name,item.vendor,item.licenseType,item.department,item.purchaseDate??'',item.expiryDate??'',item.quantityPurchased??'',item.seatCount??'',item.quantityInUse??'',item.status,item.lastPaymentDate??'',item.lastPaymentMinor==null?'':(item.lastPaymentMinor/100).toFixed(2),item.notes]}
export function csvExport(items:LicenseInput[]){const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};return '\uFEFF'+[HEADERS,...items.map(templateValues)].map(row=>row.map(cell).join(',')).join('\r\n')}
