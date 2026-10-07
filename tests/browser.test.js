const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const scheduler=require('../scheduler');
const roster=require('./planning-roster.json');
const root=path.resolve(__dirname,'..');
const members=roster.map((m,i)=>({...m,functions:m.functions.map(scheduler.canonical),role:i===11?'admin':'member',onboarding_complete:true,must_change_password:false}));
const user=members.find(m=>m.name==='Gabriel Serafim');
function mockSDK(){
 return `window.__db={profiles:${JSON.stringify(members)},events:[],event_assignments:[],unavailability:[],songs:[],notifications:[],event_songs:[]};window.__calls={assignmentInserts:0};
 let serial=0;
 class Query{
  constructor(table){this.table=table;this.filters=[];this.op='select';}
  select(){return this;}order(){return this;}limit(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}in(k,values){this.filters.push(r=>values.includes(r[k]));return this;}
  insert(values){this.op='insert';this.values=Array.isArray(values)?values:[values];return this;}update(values){this.op='update';this.values=values;return this;}delete(){this.op='delete';return this;}single(){this.one=true;return this;}
  then(resolve,reject){try{const table=window.__db[this.table];let data=table.filter(r=>this.filters.every(f=>f(r)));
   if(this.op==='insert'){
    if(this.table==='event_assignments'){window.__calls.assignmentInserts++;if(window.__failAssignmentInsert){window.__failAssignmentInsert=false;return Promise.resolve({data:null,error:{message:'Falha de gravação simulada'}}).then(resolve,reject);}}
    data=this.values.map(r=>({...r,id:r.id||'test-'+(++serial)}));table.push(...data);
   }else if(this.op==='delete'){window.__db[this.table]=table.filter(r=>!data.includes(r));}
   else if(this.op==='update'){data.forEach(r=>Object.assign(r,this.values));}
   return Promise.resolve({data:this.one?structuredClone(data[0]):structuredClone(data),error:null}).then(resolve,reject);
  }catch(error){return Promise.reject(error).then(resolve,reject);}}
 }
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:${JSON.stringify(user.id)},user_metadata:{name:'Gabriel Serafim'}}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:table=>new Query(table)})};`;
}
function clock(){const Original=Date;class Fixed extends Original{constructor(...args){super(...(args.length?args:['2026-10-07T13:30:00Z']));}static now(){return new Original('2026-10-07T13:30:00Z').getTime();}}window.Date=Fixed;}
test('app gera e exibe 24 escalas, repete sem duplicar, restringe manhã no mobile e recupera falha de gravação',async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,content)=>{if(error){res.writeHead(404).end();return;}const mime={'.html':'text/html','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(content);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({timezoneId:'America/Sao_Paulo',serviceWorkers:'block'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.addInitScript(clock);
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:mockSDK()}));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.__db.events.length===24&&window.__db.event_assignments.length===216,{},{timeout:20000});
  await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.__db.events.map(e=>e.event_date).sort().at(-1))),'2026-12-01');
  const morning=await page.evaluate(()=>window.__db.events.find(e=>e.event_date==='2026-10-11'&&e.event_type==='Domingo • Manhã').id);
  await page.locator('button[data-nav="calendar"]').first().click();
  await page.locator(`.event-pill[data-event="${morning}"]`).click();
  assert.equal(await page.locator('[data-manual-slot="Ministro"]').inputValue(),user.id);
  assert.deepEqual(await page.locator('[data-manual-slot="Ministro"] option').allTextContents(),['A definir','Gabriel Serafim','Nilma Vieira']);
  await page.setViewportSize({width:375,height:812});
  assert.equal(await page.locator('[data-manual-slot="Ministro"]').isVisible(),true);
  await page.locator('#closeModal').click();
  await page.setViewportSize({width:1280,height:900});
  const before=await page.evaluate(()=>({events:window.__db.events.length,assignments:window.__db.event_assignments.length,notifications:window.__db.notifications.length,inserts:window.__calls.assignmentInserts}));
  await page.locator('#generateSchedule').click();
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('escala(s) atualizada(s)'));
  const after=await page.evaluate(()=>({events:window.__db.events.length,assignments:window.__db.event_assignments.length,notifications:window.__db.notifications.length,inserts:window.__calls.assignmentInserts}));
  assert.deepEqual(after,before);
  // Force an actual change, then fail insertion: previous pending assignment must be restored.
  await page.locator(`.event-pill[data-event="${morning}"]`).click();
  const current=await page.locator('[data-manual-slot="Projeção"]').inputValue();
  const next=members.find(m=>m.functions.includes('Projeção')&&m.id!==current);
  await page.locator('[data-manual-slot="Projeção"]').selectOption(next.id);
  await page.waitForFunction(({event,id})=>window.__db.event_assignments.some(a=>a.event_id===event&&a.function_name==='Projeção'&&a.user_id===id),{event:morning,id:next.id});
  const snapshot=await page.evaluate(()=>window.__db.event_assignments.map(a=>({...a})).sort((a,b)=>a.id.localeCompare(b.id)));
  await page.locator('#closeModal').click();
  await page.evaluate(()=>{window.__failAssignmentInsert=true;});
  await page.locator('#generateSchedule').click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.toast')).some(e=>e.textContent.includes('As posições anteriores foram preservadas')));
  const restored=await page.evaluate(()=>window.__db.event_assignments.map(a=>({...a})).sort((a,b)=>a.id.localeCompare(b.id)));
  assert.deepEqual(restored,snapshot);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
