'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseBirthday,displayBirthday,splitName}=require('../birthday-fields');
test('accepts dd/mm/yyyy and dd/mm and ISO',()=>{
 assert.deepEqual(parseBirthday('25/10/1992'),{birth_day:25,birth_month:10,birth_year:1992});
 assert.deepEqual(parseBirthday('25/10'),{birth_day:25,birth_month:10,birth_year:null});
 assert.deepEqual(parseBirthday('1992-10-25'),{birth_day:25,birth_month:10,birth_year:1992});
});
test('accepts Excel cell dates and serial values',()=>{
 assert.deepEqual(parseBirthday(new Date('2001-08-18T00:00:00Z')),{birth_day:18,birth_month:8,birth_year:2001});
 assert.equal(parseBirthday(36801).birth_year,2000);
});
test('rejects impossible dates and ambiguous strings',()=>{
 for(const date of ['31/04/1990','29/02/2025','03/04/95','', '00/01/1998']){
  assert.throws(()=>parseBirthday(date));
 }
});
test('date rendering keeps unknown birth year unknown',()=>{
 assert.equal(displayBirthday({birth_day:7,birth_month:9,birth_year:null}),'07/09');
 assert.equal(displayBirthday({birth_day:7,birth_month:9,birth_year:1989}),'07/09/1989');
});
test('single and multi-part names preserved',()=>{
 assert.deepEqual(splitName('Akosua Boateng'),{first_name:'Akosua',last_name:'Boateng'});
 assert.deepEqual(splitName('Nana Yaw Mensah'),{first_name:'Nana Yaw',last_name:'Mensah'});
 assert.deepEqual(splitName('Madonna'),{first_name:'Madonna',last_name:''});
});
