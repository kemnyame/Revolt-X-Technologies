(()=>{
 'use strict';
 document.documentElement.classList.add('js');
 const $=(selector,root=document)=>root.querySelector(selector);
 const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
 const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const nav=$('#primaryNav'),menuToggle=$('#menuToggle');
 const closeDropdowns=()=>$$('.nav-toggle').forEach(button=>{button.setAttribute('aria-expanded','false');$('#'+button.getAttribute('aria-controls')).hidden=true});
 function setMenu(open){if(!nav||!menuToggle)return;nav.classList.toggle('open',open);menuToggle.setAttribute('aria-expanded',String(open));document.body.classList.toggle('menu-open',open);if(!open)closeDropdowns()}
 menuToggle?.addEventListener('click',()=>setMenu(menuToggle.getAttribute('aria-expanded')!=='true'));
 $$('.nav-toggle').forEach(button=>button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';closeDropdowns();button.setAttribute('aria-expanded',String(open));$('#'+button.getAttribute('aria-controls')).hidden=!open}));
 document.addEventListener('click',event=>{if(!event.target.closest('.nav-group'))closeDropdowns()});
 document.addEventListener('focusin',event=>{if(!event.target.closest('.nav-group'))closeDropdowns();if(menuToggle?.getAttribute('aria-expanded')==='true'&&!nav.contains(event.target)&&!menuToggle.contains(event.target))setMenu(false)});
 $$('.primary-nav a').forEach(link=>link.addEventListener('click',()=>setMenu(false)));
 window.matchMedia('(min-width: 961px)').addEventListener('change',event=>{if(event.matches)setMenu(false)});

 // Motion is optional. The content also remains visible when scripts are unavailable.
 if('IntersectionObserver' in window&&!reducedMotion.matches){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.remove('waiting');entry.target.classList.add('visible');observer.unobserve(entry.target)}}),{threshold:.06,rootMargin:'0px 0px -18px'});
  $$('.reveal').forEach(element=>{element.classList.add('waiting');observer.observe(element)});
  reducedMotion.addEventListener('change',event=>{if(event.matches){$$('.reveal').forEach(element=>element.classList.remove('waiting'));observer.disconnect()}});
 }

 const tabs=$$('[data-tab]');
 function selectTab(button){$$('[data-platform-visual]').forEach(visual=>{visual.hidden=visual.dataset.platformVisual!==button.dataset.tab});tabs.forEach(tab=>{const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;const panel=$('#'+tab.dataset.tab);panel.hidden=!selected;if(selected&&!reducedMotion.matches)panel.animate([{opacity:.2,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:250,easing:'ease-out'})})}
 tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();selectTab(tabs[next]);tabs[next].focus()})});

 const search=$('#solutionSearch'),filters=$$('[data-filter]'),cards=$$('#solutionsGrid [data-category]');
 let selectedCategory='all';
 function filterSolutions(){const query=(search?.value||'').trim().toLocaleLowerCase();let visible=0;cards.forEach(card=>{const show=(selectedCategory==='all'||card.dataset.category===selectedCategory)&&card.dataset.search.toLocaleLowerCase().includes(query);card.hidden=!show;if(show)visible++});if($('#resultCount'))$('#resultCount').textContent=visible===1?'1 way we can help':visible+' ways we can help';if($('#noSolutions'))$('#noSolutions').hidden=visible!==0}
 filters.forEach(button=>button.addEventListener('click',()=>{selectedCategory=button.dataset.filter;filters.forEach(filter=>filter.setAttribute('aria-pressed',String(filter===button)));filterSolutions()}));
 search?.addEventListener('input',filterSolutions);

 async function postJSON(url,payload){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});let body;try{body=await response.json()}catch{throw new Error('We could not complete that just now. Please try again.')}if(!response.ok)throw new Error(body.message||body.error||'This service is temporarily unavailable. Please try again.');return body}finally{clearTimeout(timeout)}
 }
 function feedback(element,message,state){element.textContent=message;element.dataset.state=state}
 const demo=$('#demoForm');
 if(demo){
  const solution=new URLSearchParams(location.search).get('solution');const select=$('[name=solution]',demo);if(solution&&select){const option=[...select.options].find(option=>option.textContent===solution||option.value===solution);if(option)select.value=option.value}
  demo.addEventListener('submit',async event=>{
   event.preventDefault();const submit=$('button[type=submit]',demo),status=$('#demoStatus');submit.disabled=true;demo.setAttribute('aria-busy','true');feedback(status,'Sending your message…','loading');
   try{const result=await postJSON('/api/demo',Object.fromEntries(new FormData(demo)));if(result.ok!==true)throw new Error(result.message||'We could not save your message. Please try again.');demo.reset();feedback(status,result.message||'Thank you. Your message has been received.','success')}
   catch(error){feedback(status,error.name==='AbortError'?'This is taking longer than expected. Your entries are still here. Please try again or call +233 55 748 5233.':error.message,'error')}
   finally{submit.disabled=false;demo.removeAttribute('aria-busy')}
  });
 }
 const advisor=$('#advisorForm');
 advisor?.addEventListener('submit',async event=>{
  event.preventDefault();const submit=$('button[type=submit]',advisor),status=$('#advisorStatus'),out=$('#advisorResult');submit.disabled=true;out.replaceChildren();feedback(status,'Finding a useful starting point…','loading');
  try{const result=await postJSON('/api/advisor',{problem:$('#advisorProblem').value.trim()});const box=document.createElement('article');box.className='recommendation';const eyebrow=document.createElement('span');eyebrow.className='eyebrow';eyebrow.textContent='A starting point to discuss';const heading=document.createElement('h3');heading.textContent=result.solution;const paragraph=document.createElement('p');paragraph.textContent=result.reason;const link=document.createElement('a');link.className='button dark';link.href='/pages/demo.html?solution='+encodeURIComponent(result.solution);link.textContent='Talk about this solution →';box.append(eyebrow,heading,paragraph,link);out.appendChild(box);feedback(status,'Here is one option to explore.','success')}
  catch(error){feedback(status,error.name==='AbortError'?'This is taking longer than expected. Please try again.':error.message,'error')}
  finally{submit.disabled=false}
 });

 const toggle=$('#assistantToggle'),panel=$('#assistantPanel'),close=$('#assistantClose'),chat=$('#chatMessages'),form=$('#assistantForm'),input=$('#assistantInput');
 function setAssistant(open){if(!panel)return;panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open){setMenu(false);input.focus()}else toggle.focus()}
 toggle?.addEventListener('click',()=>setAssistant(panel.hidden));close?.addEventListener('click',()=>setAssistant(false));
 $$('[data-open-assistant]').forEach(button=>button.addEventListener('click',()=>setAssistant(true)));
 document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(panel&&!panel.hidden){setAssistant(false);return}if(menuToggle?.getAttribute('aria-expanded')==='true'){setMenu(false);menuToggle.focus();return}closeDropdowns()});
 function message(text,kind){const bubble=document.createElement('div');bubble.className='chat-message '+kind;bubble.textContent=text;chat.appendChild(bubble);chat.scrollTop=chat.scrollHeight;return bubble}
 $$('.chat-prompts button').forEach(button=>button.addEventListener('click',()=>{input.value=button.textContent;form.requestSubmit()}));
 form?.addEventListener('submit',async event=>{
  event.preventDefault();const question=input.value.trim(),submit=$('button[type=submit]',form);if(!question||submit.disabled)return;message(question,'user');input.value='';submit.disabled=true;form.setAttribute('aria-busy','true');const answer=message('Adriana is thinking…','bot');
  try{const result=await postJSON('/api/assistant',{question});answer.textContent=result.answer||'Tell me a little more about what you need.';if(result.source){const source=document.createElement('small');source.textContent=result.source;answer.appendChild(source)}}
  catch(error){answer.textContent=error.name==='AbortError'?'I am taking longer than expected. Please try again.':error.message}
  finally{submit.disabled=false;form.removeAttribute('aria-busy');chat.scrollTop=chat.scrollHeight;input.focus()}
 });
})();
