(function(root){
  'use strict';
  const music = ['Violão','Guitarra','Baixo','Bateria','Teclado'];
  const technical = ['Mesa de Som','Projeção','Mídia'];
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
  const canonical = value => ({'Som':'Mesa de Som','Datashow':'Projeção','Letra':'Projeção','Back 1':'Back Vocal','Back 2':'Back Vocal','Vocal':'Back Vocal'}[value] || value);
  const functions = member => new Set((member.functions || []).map(canonical));
  const qualified = (member, slot) => member && member.active !== false && functions(member).has(canonical(slot));
  const key = member => String(member.id);
  const dateNumber = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
  const week = (date, pattern) => Math.floor((dateNumber(date) - dateNumber(pattern.anchor_date)) / 7);
  const mod = (n,m) => ((n % m) + m) % m;
  const slotOf = assignment => assignment.function_name || assignment.function;
  const locked = assignment => ['accepted','confirmed'].includes(assignment.confirmation_status);
  const isSunday = event => String(event.event_type || '').startsWith('Domingo') && new Date(`${event.event_date}T12:00:00Z`).getUTCDay() === 0;
  const isMorning = event => isSunday(event) && (normalize(event.event_type).includes('manha') || Number((event.time_start || '23:00').slice(0,2)) < 12);
  const interval = event => {
    const minute = value => {const [h,m] = String(value || '00:00').split(':').map(Number);return h * 60 + m;};
    const start = dateNumber(event.event_date) * 1440 + minute(event.time_start);
    let end = event.time_end ? dateNumber(event.event_date) * 1440 + minute(event.time_end) : start + 120;
    if(end <= start) end += 1440;
    return [start,end];
  };
  const overlaps = (a,b) => {const x=interval(a),y=interval(b);return x[0] < y[1] && y[0] < x[1];};

  function resolve(name, members, pattern){
    const names=[name,...(pattern.aliases?.[name] || [])].map(normalize);
    const exact=members.filter(m=>names.includes(normalize(m.name)) || names.includes(normalize(m.username)));
    return exact.length === 1 ? exact[0] : null;
  }

  function buildBands(members, pattern){
    const bands=[];
    for(const band of pattern.bands || []){
      const slots={};
      for(const [slot,name] of Object.entries(band.slots)){
        const member=resolve(name,members,pattern);
        if(qualified(member,slot)) slots[slot]=key(member);
      }
      if(Object.keys(slots).length === Object.keys(band.slots).length && new Set(Object.values(slots)).size === Object.keys(slots).length){
        bands.push({id:band.id,label:band.label,slots});
      }
    }
    // Members added later receive stable band variants; no roster is copied into profiles.
    const musicians=members.filter(m=>m.active!==false && music.some(f=>qualified(m,f))).sort((a,b)=>normalize(a.name).localeCompare(normalize(b.name)));
    const useCount=id=>bands.reduce((n,b)=>n+Number(Object.values(b.slots).includes(id)),0);
    function complete(fixed){
      const slots={...fixed}, used=new Set(Object.values(slots));
      const needs=[['Teclado'],['Guitarra','Violão'],['Baixo'],['Bateria']];
      function visit(i){
        if(i===needs.length) return {...slots};
        if(needs[i].some(f=>slots[f])) return visit(i+1);
        const choices=musicians.flatMap(m=>needs[i].filter(f=>qualified(m,f)).map(f=>({m,f})))
          .filter(x=>!used.has(key(x.m))).sort((a,b)=>useCount(key(a.m))-useCount(key(b.m)) || normalize(a.m.name).localeCompare(normalize(b.m.name)));
        for(const {m,f} of choices){slots[f]=key(m);used.add(key(m));const result=visit(i+1);if(result)return result;delete slots[f];used.delete(key(m));}
        return null;
      }
      return visit(0);
    }
    for(const member of musicians){
      if(useCount(key(member))) continue;
      const possible=music.filter(f=>qualified(member,f));
      for(const slot of possible){
        const slots=complete({[slot]:key(member)});
        if(slots){bands.push({id:`new-${key(member)}`,label:`Equipe de ${member.name}`,slots});break;}
      }
    }
    return bands;
  }

  function buildVocals(members, pattern){
    const teams=[];
    const ministers=members.filter(m=>qualified(m,'Ministro')).sort((a,b)=>normalize(a.name).localeCompare(normalize(b.name)));
    const backs=members.filter(m=>qualified(m,'Back Vocal')).sort((a,b)=>normalize(a.name).localeCompare(normalize(b.name)));
    const usage=id=>teams.reduce((n,t)=>n+t.backs.filter(b=>b===id).length,0);
    function pair(minister, preferred=[]){
      const ids=preferred.map(name=>resolve(name,members,pattern)).filter(m=>qualified(m,'Back Vocal') && key(m)!==key(minister)).map(key);
      const selected=[...new Set(ids)].slice(0,2);
      for(const m of [...backs].sort((a,b)=>usage(key(a))-usage(key(b)) || normalize(a.name).localeCompare(normalize(b.name)))){
        if(selected.length===2) break;
        if(key(m)!==key(minister) && !selected.includes(key(m))) selected.push(key(m));
      }
      return selected;
    }
    for(const definition of pattern.vocals || []){
      const minister=resolve(definition.minister,members,pattern);
      if(qualified(minister,'Ministro')) teams.push({id:`voice-${key(minister)}`,minister:key(minister),backs:pair(minister,definition.backs)});
    }
    for(const minister of ministers){
      if(!teams.some(t=>t.minister===key(minister))) teams.push({id:`voice-${key(minister)}`,minister:key(minister),backs:pair(minister)});
    }
    for(const back of backs){
      if(usage(key(back)) || !ministers.length) continue;
      const minister=[...ministers].sort((a,b)=>teams.filter(t=>t.minister===key(a)).length-teams.filter(t=>t.minister===key(b)).length || normalize(a.name).localeCompare(normalize(b.name))).find(m=>key(m)!==key(back));
      if(minister) teams.push({id:`voice-extra-${key(back)}`,minister:key(minister),backs:pair(minister,[back.name])});
    }
    return teams;
  }

  function planEvents({members, events, targets, unavailability=[], pattern}){
    const active=members.filter(m=>m.active!==false), byId=new Map(active.map(m=>[key(m),m]));
    const bands=buildBands(active,pattern), voices=buildVocals(active,pattern);
    const targetIds=new Set(targets.map(e=>String(e.id)));
    const working=events.map(e=>({...e,assignments:(e.assignments||[]).map(a=>({...a}))}));
    for(const event of working){if(targetIds.has(String(event.id))) event.assignments=event.assignments.filter(locked);}
    for(const target of targets){if(!working.some(e=>String(e.id)===String(target.id)))working.push({...target,assignments:(target.assignments||[]).filter(locked)});}
    const unavailable=(id,event)=>unavailability.some(u=>String(u.user_id)===id && event.event_date>=u.start_date && event.event_date<=u.end_date);
    const available=(id,event)=>byId.has(id) && !(targets.find(e=>String(e.id)===String(event.id))?.assignments || []).some(a=>String(a.user_id)===id && a.confirmation_status==='declined') && !unavailable(id,event) && !working.some(other=>String(other.id)!==String(event.id) && other.status!=='cancelled' && overlaps(event,other) && (other.assignments||[]).some(a=>String(a.user_id)===id));
    const count=(id,event,role=null)=>working.filter(e=>e.status!=='cancelled' && e.event_date.startsWith(event.event_date.slice(0,7)))
      .reduce((n,e)=>n+Number((e.assignments||[]).some(a=>String(a.user_id)===id && (!role || canonical(slotOf(a))===role))),0);
    const sourceOf=event=>(pattern.services||[]).find(s=>s.event_date===event.event_date && s.event_type===event.event_type);
    const morningIds=(pattern.morning_ministers || []).map(name=>resolve(name,active,pattern)).filter(m=>qualified(m,'Ministro')).map(key);
    const sundayBands=new Map();
    const results=[];
    for(const event of [...working.filter(e=>targetIds.has(String(e.id)))].sort((a,b)=>a.event_date.localeCompare(b.event_date)||(a.time_start||'').localeCompare(b.time_start||''))){
      const original=targets.find(e=>String(e.id)===String(event.id));
      const result=(event.assignments||[]).map(a=>({...a})), issues=[];
      const techReserved=new Set(result.filter(a=>technical.includes(canonical(slotOf(a)))).map(a=>String(a.user_id)));
      const requested=[...new Set((original.required_functions || []).map(f=>f==='Som'?'Mesa de Som':f==='Letra'?'Projeção':f))];
      const musicalLocks=result.filter(a=>music.includes(slotOf(a)));
      const siblings=isSunday(event)?working.filter(e=>e.event_date===event.event_date && isSunday(e) && e.status!=='cancelled'): [event];
      const groupFits=band=>siblings.every(e=>Object.entries(band.slots).every(([slot,id])=>available(id,e) && !(e.assignments||[]).some(a=>technical.includes(canonical(slotOf(a))) && String(a.user_id)===id)))
        && siblings.every(e=>(e.assignments||[]).filter(a=>music.includes(slotOf(a))).every(a=>band.slots[slotOf(a)]===String(a.user_id)));
      let band;
      if(isSunday(event) && sundayBands.has(event.event_date)) band=sundayBands.get(event.event_date);
      else{
        const preferred=mod(week(event.event_date,pattern)+(isSunday(event)?0:2),Math.max(1,bands.length));
        const order=bands.map((b,i)=>({band:b,index:i,cost:Object.values(b.slots).reduce((n,id)=>n+count(id,event),0)}));
        order.sort((a,b)=>isSunday(event) ? mod(a.index-preferred,bands.length)-mod(b.index-preferred,bands.length) : a.cost-b.cost || mod(a.index-preferred,bands.length)-mod(b.index-preferred,bands.length));
        band=order.find(x=>groupFits(x.band))?.band || null;
        if(isSunday(event)) sundayBands.set(event.event_date,band);
      }
      function assign(slot,id){
        const old=result.find(a=>slotOf(a)===slot);
        if(old){if(String(old.user_id)!==id)issues.push(`A confirmação de ${slot} precisa de revisão.`);return;}
        const previous=(original.assignments||[]).find(a=>slotOf(a)===slot && String(a.user_id)===id && a.confirmation_status!=='declined');
        result.push(previous?{...previous}:{event_id:event.id,user_id:id,function_name:slot,confirmation_status:'pending'});
      }
      if(band){for(const [slot,id] of Object.entries(band.slots))assign(slot,id);}
      else issues.push('Nenhuma equipe completa de instrumentistas está disponível para os dois cultos.');
      const usable=id=>available(id,event) && !techReserved.has(id) && !(original.assignments||[]).some(a=>String(a.user_id)===id && a.confirmation_status==='declined');
      const voiceFits=team=>usable(team.minister) && team.backs.every(usable) && result.filter(a=>['Ministro','Back 1','Back 2'].includes(slotOf(a))).every(a=>slotOf(a)==='Ministro'?String(a.user_id)===team.minister:team.backs.includes(String(a.user_id)));
      const fixedMinister=result.find(a=>slotOf(a)==='Ministro');
      let preferredMinister;
      if(isMorning(event)){
        const name=pattern.morning_ministers?.[mod(week(event.event_date,pattern),pattern.morning_ministers.length)];
        const candidate=resolve(name,active,pattern);
        preferredMinister=qualified(candidate,'Ministro') ? key(candidate) : null;
        if(fixedMinister && !morningIds.includes(String(fixedMinister.user_id))) issues.push('Ministro confirmado fora da regra da manhã: somente Gabriel ou Nilma.');
      }else{
        const sourceMinister=sourceOf(event)?.original_assignments?.find(a=>a.function_name==='Ministro');
        const sourceMember=sourceMinister && resolve(sourceMinister.name,active,pattern);
        if(sourceMember && sourceMinister.source_status==='check-circle')preferredMinister=key(sourceMember);
      }
      let candidates=voices.filter(t=>!fixedMinister || t.minister===String(fixedMinister.user_id));
      if(isMorning(event))candidates=candidates.filter(t=>morningIds.includes(t.minister));
      candidates.sort((a,b)=>Number(b.minister===preferredMinister)-Number(a.minister===preferredMinister) || count(a.minister,event,'Ministro')-count(b.minister,event,'Ministro') || a.backs.reduce((n,id)=>n+count(id,event),0)-b.backs.reduce((n,id)=>n+count(id,event),0) || a.id.localeCompare(b.id));
      let voice=candidates.find(voiceFits);
      if(isMorning(event) && preferredMinister && usable(preferredMinister)) voice=candidates.find(t=>t.minister===preferredMinister && voiceFits(t)) || candidates.find(t=>t.minister===preferredMinister);
      if(!voice)voice=candidates.find(t=>usable(t.minister));
      if(voice){
        if(usable(voice.minister))assign('Ministro',voice.minister);
        voice.backs.forEach((id,i)=>{if(usable(id))assign(`Back ${i+1}`,id);});
      }
      const used=new Set(result.map(a=>String(a.user_id)));
      const source=sourceOf(event);
      for(const slot of technical.filter(s=>requested.includes(s) || source?.original_assignments?.some(a=>canonical(a.function_name)===s))){
        if(result.some(a=>slotOf(a)===slot))continue;
        const sourcePerson=source?.original_assignments?.find(a=>canonical(a.function_name)===slot);
        const preferred=sourcePerson && resolve(sourcePerson.name,active,pattern);
        const candidates=active.filter(m=>qualified(m,slot) && !used.has(key(m)) && available(key(m),event))
          .sort((a,b)=>count(key(a),event)-count(key(b),event) || Number(key(b)===key(preferred || {}))-Number(key(a)===key(preferred || {})) || normalize(a.name).localeCompare(normalize(b.name)));
        if(candidates[0]){assign(slot,key(candidates[0]));used.add(key(candidates[0]));}
      }
      const required=[...(band?Object.keys(band.slots):music.filter(f=>f!=='Violão')), 'Ministro','Back 1','Back 2',...technical.filter(f=>requested.includes(f) || source?.original_assignments?.some(a=>canonical(a.function_name)===f))];
      const missing=required.filter(slot=>!result.some(a=>slotOf(a)===slot));
      for(const a of result){if(!qualified(byId.get(String(a.user_id)),slotOf(a)) || !available(String(a.user_id),event))issues.push(`${slotOf(a)} tem confirmação incompatível com função ou disponibilidade.`);}
      const minister=result.find(a=>slotOf(a)==='Ministro')?.user_id || null;
      event.assignments=result;
      results.push({event_id:event.id,result,missing,issues:[...new Set(issues)],required_functions:required,minister_id:minister,band_id:band?.id || null,voice_id:voice?.id || null});
    }
    return results;
  }
  const api={normalize,canonical,qualified,resolve,buildBands,buildVocals,planEvents,isMorning,overlaps,locked};
  if(typeof module === 'object' && module.exports)module.exports=api;
  else root.IMVScheduler=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
