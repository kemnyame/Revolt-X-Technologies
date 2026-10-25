'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.join(__dirname,'..','public');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const css=fs.readFileSync(path.join(dir,'styles.css'),'utf8');
const js=fs.readFileSync(path.join(dir,'app.js'),'utf8');

test('branded favicon is configured for browser tabs and installable web views',()=>{
 assert.match(html,/rel="icon"[^>]*href="\/favicon\.svg"/);
 assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);
 assert.match(fs.readFileSync(path.join(dir,'favicon.svg'),'utf8'),/<svg[^>]+viewBox="0 0 64 64"/);
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.webmanifest'),'utf8'));
 assert.equal(manifest.start_url,'/');
 assert.ok(manifest.name.includes('Revolt'));
 assert.ok(manifest.icons.some(x=>x.src==='/favicon.svg'));
});
test('mobile menu can be opened and closed by backdrop and navigation',()=>{
 assert.match(html,/id="sidebarBackdrop"/);
 assert.match(html,/id="mobileMenuBtn"[^>]*aria-expanded="false"/);
 assert.match(js,/function setMobileMenu\(open\)/);
 assert.match(js,/sidebarBackdrop'\)\.addEventListener\('click'/);
 assert.match(css,/\.nav-open \.sidebar-backdrop\{display:block\}/);
 assert.match(css,/@media\(max-width:720px\)/);
});
test('tables include responsive per-field labels for all administrative pages',()=>{
 for(const label of ['Staff ID','Birthday','Name','Administrator','Last login','Recorded on']){
   assert.ok(js.includes('data-label="'+label+'"'),'Missing mobile field '+label);
 }
 assert.match(css,/content:attr\(data-label\)/);
});
test('no third-party chat widgets or chat links appear in the website',()=>{
 const displayMarkup=html+js;
 assert.doesNotMatch(displayMarkup,/(?:https?:\/\/)?(?:chatgpt\.com|chat\.openai\.com|t\.me\/|wa\.me\/)/i);
 assert.doesNotMatch(html,/<(?:iframe|a)[^>]+(?:chat|whatsapp)/i);
});
