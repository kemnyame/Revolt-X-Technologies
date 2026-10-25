'use strict';
const { isValidBirthday } = require('./birthdays');

// Birthdays may be full dates or day/month without year. Never invent a birth year.
function parseBirthday(raw) {
  if(raw===undefined || raw===null || String(raw).trim()==='') throw Error('Birthday is required (DD/MM/YYYY or DD/MM).');
  let day, month, year=null;
  if(raw instanceof Date && !Number.isNaN(raw.getTime())){
    day=raw.getUTCDate();month=raw.getUTCMonth()+1;year=raw.getUTCFullYear();
  }else if(typeof raw === 'number' && Number.isFinite(raw) && raw>=1 && raw<=2958465){
    // Excel stores dates as serial days from 1899-12-30 in the 1900 date system.
    const date=new Date(Date.UTC(1899,11,30)+Math.trunc(raw)*86400000);
    day=date.getUTCDate();month=date.getUTCMonth()+1;year=date.getUTCFullYear();
  }else{
    const value=String(raw).trim();
    let match;
    if((match=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value))){
      year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);
    }else if((match=/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}))?$/.exec(value))){
      day=Number(match[1]);month=Number(match[2]);year=match[3]?Number(match[3]):null;
    }else{
      throw Error('Use DD/MM/YYYY, DD/MM or YYYY-MM-DD for Birthday.');
    }
  }
  if(!isValidBirthday(month,day))throw Error('Birthday is not a valid calendar date.');
  if(year!==null && (!Number.isInteger(year)||year<1900||year>new Date().getUTCFullYear()))throw Error('Birthday year is not valid.');
  // Feb 29 is accepted when birth year is unknown; with year, it must be a leap year.
  if(month===2&&day===29&&year!==null&&new Date(Date.UTC(year,1,29)).getUTCMonth()!==1)
    throw Error('29 February requires a leap year.');
  return {birth_day:day,birth_month:month,birth_year:year};
}
function displayBirthday(row){
  return String(row.birth_day).padStart(2,'0')+'/'+String(row.birth_month).padStart(2,'0')+
    (row.birth_year!==null&&row.birth_year!==undefined?'/'+row.birth_year:'');
}
function splitName(value){
  const name=String(value??'').trim().replace(/\s+/g,' ');
  if(!name||name.length>160)throw Error('Name is required and must be at most 160 characters.');
  const parts=name.split(' ');
  return {first_name:parts.length>1?parts.slice(0,-1).join(' '):parts[0],last_name:parts.length>1?parts.at(-1):''};
}
module.exports={parseBirthday,displayBirthday,splitName};
