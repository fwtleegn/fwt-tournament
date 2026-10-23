'use strict';
(() => {
 const $=id=>document.getElementById(id);let client,players=[],members=[],links=[],loading=false;
 function n(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
 function fail(e){const msg=e?.message||'';$('admin-notice').textContent=msg.includes('FWT_MATCH_CHANGED')?'경기 상태가 변경되어 승인하지 않았습니다. 제출을 반려한 뒤 참가자에게 다시 제출하도록 안내하세요.':msg.includes('FWT_PLAYER_ALREADY_LINKED')?'이미 다른 회원에게 연결된 선수입니다. 기존 연결을 확인하세요.':'처리하지 못했습니다. 권한 또는 최신 경기 상태를 확인해주세요.';}
 function options(){
  const q=$('player-search').value.trim().toLocaleLowerCase();const own=new Map(links.map(l=>[l.player_id,l.user_id]));
  $('player-select').replaceChildren(new Option('선수를 선택해주세요',''),...players.filter(p=>p.hasParticipation&&!own.has(p.id)&&p.label.toLocaleLowerCase().includes(q)).map(p=>new Option(p.label,p.id)));
 }
 async function load(){if(loading)return;loading=true;$('refresh-reviews').disabled=true;
  try{
   const results=await Promise.all([client.from('member_profiles').select('id,nickname').order('nickname'),client.from('players').select('id,name,nickname').order('created_at'),client.from('player_accounts').select('player_id,user_id'),client.from('entry_members').select('player_id,entry_id'),client.from('entries').select('id,division_id,display_name'),client.from('divisions').select('id,tournament_id,name'),client.from('tournaments').select('id,name'),client.from('score_submissions').select('id,match_id,submitted_by,score1,score2,submitted_at').eq('status','submitted').order('submitted_at'),client.from('matches').select('id,division_id,entry1_id,entry2_id,status')]);
   for(const r of results)if(r.error)throw r.error;
   members=results[0].data;players=results[1].data;links=results[2].data;const em=results[3].data,es=new Map(results[4].data.map(x=>[x.id,x])),ds=new Map(results[5].data.map(x=>[x.id,x])),ts=new Map(results[6].data.map(x=>[x.id,x.name])),ms=new Map(results[8].data.map(x=>[x.id,x])),names=new Map(members.map(x=>[x.id,x.nickname]));
   const participatingPlayers=new Set(em.filter(x=>ts.has(ds.get(es.get(x.entry_id)?.division_id)?.tournament_id)).map(x=>x.player_id));
   players=players.map(p=>({...p,hasParticipation:participatingPlayers.has(p.id)}));
   const oldMember=$('member-select').value;$('member-select').replaceChildren(new Option('회원을 선택해주세요',''),...members.map(m=>new Option(m.nickname,m.id)));$('member-select').value=oldMember;
   players=players.map(p=>({...p,label:`${p.nickname||p.name} (${p.name}) · ${[...new Set(em.filter(x=>x.player_id===p.id).map(x=>ts.get(ds.get(es.get(x.entry_id)?.division_id)?.tournament_id)).filter(Boolean))].join(', ')||'출전 기록 없음'} · ${p.id.slice(0,8)}`}));options();
   $('linked-list').replaceChildren(...links.map(link=>n('p',`${names.get(link.user_id)||'회원'} ← ${players.find(p=>p.id===link.player_id)?.label||link.player_id}`)));
   $('review-list').replaceChildren(...results[7].data.map(s=>{const m=ms.get(s.match_id),d=ds.get(m?.division_id);const card=n('article',undefined,'match-card');card.append(n('p',`${ts.get(d?.tournament_id)||'대회'} · ${d?.name||''}`,'eyebrow'),n('h3',`${es.get(m?.entry1_id)?.display_name||'미정'} vs ${es.get(m?.entry2_id)?.display_name||'미정'}`),n('p',`제출 점수 ${s.score1} : ${s.score2} · 제출자 ${names.get(s.submitted_by)||'회원'}`));
    const noteLabel=n('label','반려 사유 또는 운영 메모'),note=n('input');note.maxLength=500;noteLabel.append(note);card.append(noteLabel);const approve=n('button','승인하고 공식 결과 반영','primary'),reject=n('button','반려','text-button');approve.type=reject.type='button';
    async function review(yes){if(!yes&&!note.value.trim()){$('admin-notice').textContent='반려 사유를 입력해주세요.';return;}if(!confirm(yes?`${s.score1} : ${s.score2} 점수를 확정하고 다음 대진에 반영할까요?`:'제출 점수를 반려할까요?'))return;approve.disabled=reject.disabled=true;try{const r=await client.rpc('fwt_review_score',{p_submission:s.id,p_approve:yes,p_note:note.value.trim()});if(r.error)throw r.error;await load();$('admin-notice').textContent=yes?'공식 결과에 반영했습니다.':'반려했습니다. 참가자는 점수를 다시 제출할 수 있습니다.';}catch(e){fail(e);approve.disabled=reject.disabled=false;}}
    approve.onclick=()=>review(true);reject.onclick=()=>review(false);card.append(approve,reject);return card;}));
   if(!results[7].data.length)$('review-list').append(n('p','승인 대기 중인 제출이 없습니다.'));
   $('admin-body').hidden=false;$('admin-notice').textContent='회원 연결과 점수 승인은 관리자만 처리할 수 있습니다.';
  }catch(e){fail(e);}finally{loading=false;$('refresh-reviews').disabled=false;}
 }
 $('player-search').oninput=options;$('refresh-reviews').onclick=load;
 $('link-form').onsubmit=async e=>{e.preventDefault();const p=$('player-select').value,u=$('member-select').value;if(!p||!u)return;if(!confirm(`${members.find(m=>m.id===u)?.nickname} 회원에게\n${players.find(x=>x.id===p)?.label}\n기록을 연결할까요?`))return;const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;try{const r=await client.rpc('fwt_link_player',{p_user:u,p_player:p});if(r.error)throw r.error;await load();$('admin-notice').textContent='회원과 선수 기록을 연결했습니다.';}catch(error){fail(error);}finally{button.disabled=false;}};
 async function start(){if(!window.supabase){$('admin-notice').textContent='연결을 확인하고 새로고침해주세요.';return;}const c=window.FWT_MEMBER_CONFIG;client=window.supabase.createClient(c.url,c.key);try{const {data,error}=await client.auth.getUser();if(error||!data.user){$('admin-notice').textContent='기존 관리자 계정으로 먼저 로그인해주세요.';return;}const r=await client.rpc('is_fwt_admin');if(r.error||!r.data){$('admin-notice').textContent='관리자만 접근할 수 있습니다.';return;}await load();}catch(e){fail(e);}}
 start();
})();
