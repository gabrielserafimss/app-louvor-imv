const test=require('node:test');
const assert=require('node:assert/strict');
const scheduler=require('../scheduler');
const pattern=require('../rotation-pattern');
const roster=require('./planning-roster.json');
function fixtures(){return pattern.services.map(s=>({...s,id:`${s.event_date}-${s.recurrence_key}`,status:'published',required_functions:['Ministro','Back 1','Back 2','Mesa de Som','Projeção'],assignments:[]}));}
function plan(events=fixtures(),options={}){return scheduler.planEvents({members:roster,events,targets:events,pattern,...options});}
function musical(p){return p.result.filter(a=>['Guitarra','Violão','Baixo','Bateria','Teclado'].includes(a.function_name)).map(a=>[a.function_name,a.user_id]).sort();}
function name(id){return roster.find(m=>m.id===id)?.name;}
test('24 cultos, até 1º de dezembro, com todas as posições preenchidas e qualificadas',()=>{
 const plans=plan();assert.equal(plans.length,24);assert.equal(pattern.services.at(-1).event_date,'2026-12-01');
 for(const p of plans){assert.deepEqual(p.missing,[]);assert.deepEqual(p.issues,[]);for(const a of p.result)assert.ok(scheduler.qualified(roster.find(m=>m.id===a.user_id),a.function_name));}
 const scheduled=new Set(plans.flatMap(p=>p.result.map(a=>a.user_id)));
 for(const m of roster.filter(m=>m.functions.length))assert.ok(scheduled.has(m.id),`${m.name} ficou fora do ciclo`);
});
test('Gabriel e Nilma alternam estritamente nas oito manhãs; nenhum outro ministro',()=>{
 const events=fixtures();const plans=plan(events).filter(p=>scheduler.isMorning(events.find(e=>e.id===p.event_id)));
 assert.deepEqual(plans.map(p=>name(p.minister_id)),['Gabriel Serafim','Nilma Vieira','Gabriel Serafim','Nilma Vieira','Gabriel Serafim','Nilma Vieira','Gabriel Serafim','Nilma Vieira']);
});
test('a banda é idêntica nos dois cultos de cada domingo e gira entre as quatro equipes',()=>{
 const events=fixtures(),plans=plan(events);const bands=[];
 for(const am of events.filter(scheduler.isMorning)){const pm=events.find(e=>e.event_date===am.event_date&&!scheduler.isMorning(e));const a=plans.find(p=>p.event_id===am.id),b=plans.find(p=>p.event_id===pm.id);assert.deepEqual(musical(a),musical(b));bands.push(a.band_id);}
 assert.deepEqual(bands,['A','B','C','D','A','B','C','D']);
});
test('indisponibilidade à noite troca a banda inteira também pela manhã',()=>{
 const blocked=roster.find(m=>m.name==='Marcos Zocateli');const events=fixtures(),plans=plan(events,{unavailability:[{user_id:blocked.id,start_date:'2026-10-11',end_date:'2026-10-11'}]});
 const sunday=plans.filter(p=>events.find(e=>e.id===p.event_id).event_date==='2026-10-11');assert.equal(sunday[0].band_id,sunday[1].band_id);assert.notEqual(sunday[0].band_id,'A');assert.ok(!sunday.some(p=>p.result.some(a=>a.user_id===blocked.id)));
});
test('ambos os ministros indisponíveis deixam manhã pendente, sem escalar Amanda ou Cleidiene',()=>{
 const unavailability=roster.filter(m=>['Gabriel Serafim','Nilma Vieira'].includes(m.name)).map(m=>({user_id:m.id,start_date:'2026-10-11',end_date:'2026-10-11'}));
 const p=plan(fixtures(),{unavailability})[0];assert.equal(p.minister_id,null);assert.ok(p.missing.includes('Ministro'));
});
test('ministros mantêm seus backs e funções técnicas não se acumulam com tocar/cantar',()=>{
 const teams=scheduler.buildVocals(roster,pattern);
 for(const p of plan()){const team=teams.find(t=>t.id===p.voice_id);assert.ok(team);assert.equal(p.minister_id,team.minister);assert.deepEqual(p.result.filter(a=>a.function_name.startsWith('Back ')).map(a=>a.user_id),team.backs);
 const tech=p.result.filter(a=>['Mesa de Som','Projeção','Mídia'].includes(a.function_name));for(const a of tech)assert.equal(p.result.filter(x=>x.user_id===a.user_id).length,1);}
});
test('membro sem função ou inativo nunca é escolhido; novos músicos entram no rodízio',()=>{
 const extra={id:'new-drummer',name:'Novo Baterista',functions:['Bateria'],active:true};
 const members=[...roster,extra,{id:'inactive',name:'Inativo',functions:['Bateria'],active:false}];
 const plans=plan(fixtures(),{members});assert.ok(plans.some(p=>p.result.some(a=>a.user_id===extra.id)));assert.ok(!plans.some(p=>p.result.some(a=>a.user_id==='inactive')));
});
test('confirmados conservam IDs e status, inclusive ao refazer domingo inteiro',()=>{
 const events=fixtures(),existing=plan(events)[0].result.find(a=>a.function_name==='Ministro');events[0].assignments=[{...existing,id:'confirmed-original',confirmation_status:'confirmed'}];
 const p=plan(events)[0];assert.deepEqual(p.result.find(a=>a.function_name==='Ministro'),events[0].assignments[0]);
});
test('regenerar o ciclo é determinístico e não perde posições existentes',()=>{
 const events=fixtures(),first=plan(events);for(const p of first)events.find(e=>e.id===p.event_id).assignments=p.result.map((a,i)=>({...a,id:`${p.event_id}-${i}`}));
 const again=plan(events);assert.deepEqual(again.map(p=>p.result.map(a=>[a.function_name,a.user_id])),first.map(p=>p.result.map(a=>[a.function_name,a.user_id])));assert.ok(again.every(p=>p.result.every(a=>a.id)));
});
test('dois cultos em horários diferentes são permitidos; sobreposição e virada da noite não',()=>{
 const a={event_date:'2026-10-11',time_start:'08:00'},b={event_date:'2026-10-11',time_start:'18:30'};assert.equal(scheduler.overlaps(a,b),false);assert.equal(scheduler.overlaps(a,{...a,time_start:'09:00'}),true);assert.equal(scheduler.overlaps({event_date:'2026-10-10',time_start:'23:00',time_end:'01:00'},{event_date:'2026-10-11',time_start:'00:30'}),true);
});
test('aliases só resolvem membros reais e não escolhem identidades ambíguas',()=>{
 assert.equal(scheduler.resolve('Gabriel Serafim',[{id:'real',name:'Gabriel'}],pattern).id,'real');assert.equal(scheduler.resolve('Gabriel Serafim',[{id:'one',name:'Gabriel'},{id:'two',name:'Gabriel Serafim'}],pattern),null);
});
test('padrão continua depois de dezembro e manhã segue limitada a Gabriel/Nilma',()=>{
 const dates=['2027-01-03','2027-01-10','2027-01-17'];const events=dates.flatMap((event_date,i)=>[{id:`am-${i}`,event_date,event_type:'Domingo • Manhã',time_start:'08:00',assignments:[]},{id:`pm-${i}`,event_date,event_type:'Domingo • Noite',time_start:'18:30',assignments:[]}]);
 const plans=plan(events);for(const am of events.filter(scheduler.isMorning)){const a=plans.find(p=>p.event_id===am.id),b=plans.find(p=>p.event_id===`pm-${am.id.slice(3)}`);assert.ok(['Gabriel Serafim','Nilma Vieira'].includes(name(a.minister_id)));assert.deepEqual(musical(a),musical(b));}
});
