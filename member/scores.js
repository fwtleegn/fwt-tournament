'use strict';
(() => {
 const $=id=>document.getElementById(id);
 let client,user,loading=false;
 function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
 const labels={playing:'경기 중 · 종료 점수 제출 가능',waiting:'대기 중',pending:'대진 확정 전',completed:'경기 완료',walkover:'기권승',bye:'부전승'};
 const reviewLabels={submitted:'관리자 확인 대기',approved:'승인 완료',rejected:'반려',withdrawn:'제출 취소'};
 function errorMessage(error){
  const m=error?.message||'';
  if(m.includes('FWT_SCORE_PENDING'))return '이미 제출된 점수가 있습니다. 새로고침하여 확인해주세요.';
  if(m.includes('FWT_MATCH_NOT_PLAYING')||m.includes('FWT_MATCH_CHANGED'))return '경기 상태가 변경되었습니다. 새로고침 후 확인해주세요.';
  if(error?.code==='42501')return '이 경기의 참가자만 점수를 제출할 수 있습니다. 참가 기록 연결을 확인해주세요.';
  return '처리하지 못했습니다. 새로고침 후 다시 시도해주세요.';
 }
 async function load(){
  if(!client||loading)return; loading=true;$('refresh-matches').disabled=true;$('score-notice').textContent='경기를 확인하고 있습니다.';
  try{
   const links=await client.from('player_accounts').select('player_id').eq('user_id',user.id);if(links.error)throw links.error;
   if(!links.data.length){$('match-list').replaceChildren();$('score-notice').textContent='아직 연결된 참가 기록이 없습니다. 운영자에게 별명과 참가 대회를 알려주세요.';return;}
   const memberships=await client.from('entry_members').select('entry_id').in('player_id',links.data.map(x=>x.player_id));if(memberships.error)throw memberships.error;
   const ids=[...new Set(memberships.data.map(x=>x.entry_id))];
   if(!ids.length){$('match-list').replaceChildren();$('score-notice').textContent='연결된 선수의 출전 기록이 아직 없습니다.';return;}
   const found=await client.from('matches').select('id,division_id,court_id,entry1_id,entry2_id,status,score1,score2,round_number,match_number,stage').or(`entry1_id.in.(${ids.join(',')}),entry2_id.in.(${ids.join(',')})`).order('created_at',{ascending:false}).limit(200);if(found.error)throw found.error;
   const matches=found.data;
   if(!matches.length){$('match-list').replaceChildren();$('score-notice').textContent='아직 편성된 경기가 없습니다.';return;}
   const [entries,divisions,courts,submitted]=await Promise.all([
    client.from('entries').select('id,display_name').in('id',[...new Set(matches.flatMap(m=>[m.entry1_id,m.entry2_id]).filter(Boolean))]),
    client.from('divisions').select('id,name,tournament_id').in('id',[...new Set(matches.map(m=>m.division_id))]),
    client.from('courts').select('id,name'),
    client.from('score_submissions').select('id,match_id,submitted_by,score1,score2,status,review_note,submitted_at').in('match_id',matches.map(m=>m.id)).order('submitted_at',{ascending:false})
   ]);for(const r of [entries,divisions,courts,submitted])if(r.error)throw r.error;
   const tournaments=await client.from('tournaments').select('id,name').in('id',[...new Set(divisions.data.map(d=>d.tournament_id))]);if(tournaments.error)throw tournaments.error;
   const names=new Map(entries.data.map(e=>[e.id,e.display_name]));const divs=new Map(divisions.data.map(d=>[d.id,d]));const ts=new Map(tournaments.data.map(t=>[t.id,t.name]));const cs=new Map(courts.data.map(c=>[c.id,c.name]));
   const cards=matches.sort((a,b)=>(a.status==='playing'?-1:1)-(b.status==='playing'?-1:1)).map(m=>{
    const card=node('article',undefined,'match-card');const d=divs.get(m.division_id);
    card.append(node('p',`${ts.get(d?.tournament_id)||'FWT 대회'} · ${d?.name||''}`,'eyebrow'));
    const n1=names.get(m.entry1_id)||'미정',n2=names.get(m.entry2_id)||'미정';card.append(node('h4',`${n1} vs ${n2}`));
    card.append(node('p',`${labels[m.status]||m.status}${m.court_id?' · '+(cs.get(m.court_id)||'코트 확인 중'):''}`));
    if(m.score1!==null&&m.score2!==null)card.append(node('p',`공식 점수 ${m.score1} : ${m.score2}`));
    const rows=submitted.data.filter(s=>s.match_id===m.id),pending=rows.find(s=>s.status==='submitted'),last=pending||rows[0];
    if(last){card.append(node('p',`제출 점수 ${last.score1} : ${last.score2} · ${reviewLabels[last.status]}`,'privacy'));if(last.review_note)card.append(node('p',`운영자 안내: ${last.review_note}`));}
    if(pending?.submitted_by===user.id){const cancel=node('button','제출 취소','text-button');cancel.type='button';cancel.onclick=async()=>{cancel.disabled=true;try{const r=await client.rpc('fwt_withdraw_score',{p_submission:pending.id});if(r.error)throw r.error;await load();}catch(e){$('score-notice').textContent=errorMessage(e);cancel.disabled=false;}};card.append(cancel);}
    if(m.status==='playing'&&!pending){
     const form=node('form');const row=node('div',undefined,'row');const inputs=[];
     for(const name of [n1,n2]){const label=node('label',`${name} 점수`),input=node('input');input.type='number';input.min='0';input.max='99';input.step='1';input.required=true;input.inputMode='numeric';label.append(input);row.append(label);inputs.push(input);}
     const send=node('button','종료 점수 제출','primary');send.type='submit';form.append(row,send);let requestId=null,requestScores='';
     form.onsubmit=async event=>{event.preventDefault();const scores=inputs.map(i=>Number(i.value));if(inputs.some(i=>i.value==='')||scores.some(s=>!Number.isInteger(s)||s<0||s>99)||scores[0]===scores[1]){$('score-notice').textContent='동점이 아닌 0~99의 정수 점수를 입력해주세요.';return;}
      const signature=scores.join(':');if(signature!==requestScores){requestId=crypto.randomUUID();requestScores=signature;}
      send.disabled=true;try{const r=await client.rpc('fwt_submit_score',{p_match:m.id,p_score1:scores[0],p_score2:scores[1],p_request:requestId});if(r.error)throw r.error;await load();$('score-notice').textContent='점수를 제출했습니다. 관리자 승인 후 공식 결과에 반영됩니다.';}catch(e){$('score-notice').textContent=errorMessage(e);send.disabled=false;}
     };card.append(form);
    }return card;
   });$('match-list').replaceChildren(...cards);$('score-notice').textContent=matches.length===200?'최근 200경기를 표시합니다.':'점수는 화면에 표시된 선수 순서대로 입력해주세요.';
  }catch(e){$('score-notice').textContent=errorMessage(e);}finally{loading=false;$('refresh-matches').disabled=false;}
 }
 function ready(runtime){client=runtime.client;user=runtime.user;load();}
 window.addEventListener('fwt-member-ready',e=>ready(e.detail));if(window.FWT_MEMBER_RUNTIME)ready(window.FWT_MEMBER_RUNTIME);
 $('refresh-matches').onclick=load;
})();
