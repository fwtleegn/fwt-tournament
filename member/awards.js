'use strict';
(() => {
 const $=id=>document.getElementById(id);
 let client,user,members=[],generation=0,ownGeneration=0;
 const ranks={champion:'🏆 우승',runner_up:'🥈 준우승',semifinalist:'🌟 4강 입상'};
 function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
 function cards(rows){return rows.map(row=>{
  const a=node('a');a.className='history-card';a.dataset.award=row.award;
  a.href='../tournament.html?id='+encodeURIComponent(row.tournament_id);
  a.append(node('strong',ranks[row.award]||'입상'),node('p',row.tournament_name),node('p',`${row.tournament_date||'날짜 미등록'} · ${row.division_name}`));
  const pair=node('div');pair.className='history-players';
  for(const name of row.players||[])pair.append(node('span',name));
  a.append(pair,node('p','대회 결과 보기 →'));return a;
 });}
 async function history(memberId,listId,noticeId,current){
  $(listId).replaceChildren();$(noticeId).textContent='입상 이력을 확인하고 있습니다.';
  try{
   const {data,error}=await client.rpc('fwt_member_awards',{p_member:memberId});
   if(!current())return;if(error)throw error;
   $(listId).replaceChildren(...cards(data||[]));
   $(noticeId).textContent=data?.length?'': '표시할 입상 기록이 없습니다. 기존 대회에 참가했다면 관리자에게 선수 연결을 요청해주세요.';
  }catch(error){if(current())$(noticeId).textContent='입상 이력을 불러오지 못했습니다. 잠시 후 새로고침해주세요.';}
 }
 function renderMembers(){
  const term=$('directory-search').value.trim().toLocaleLowerCase('ko');
  const found=members.filter(m=>m.nickname.toLocaleLowerCase('ko').includes(term));
  $('directory-list').replaceChildren(...found.map(m=>{
   const b=node('button',m.nickname);b.type='button';b.setAttribute('aria-pressed','false');
   b.onclick=()=>{
    const version=++generation;
    $('directory-list').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    $('directory-profile').hidden=false;$('directory-name').textContent=m.nickname;
    $('directory-tennis').textContent=`테니스 시작 · ${m.tennis_since?.slice(0,7)||'미등록'}`;
    history(m.id,'directory-awards','directory-notice',()=>generation===version);
   };return b;
  }));
  if(!found.length)$('directory-list').append(node('p','검색 결과가 없습니다.'));
 }
 async function refreshOwn(){const version=++ownGeneration;await history(user.id,'awards-list','awards-notice',()=>version===ownGeneration);}
 async function ready(runtime){
  client=runtime.client;user=runtime.user;refreshOwn();
  try{
   // Explicit allowlist: never request email or birth date for the directory.
   const {data,error}=await client.from('member_profiles').select('id,nickname,tennis_since').eq('directory_consent',true).order('nickname');
   if(error)throw error;members=data||[];renderMembers();
  }catch(e){$('directory-list').replaceChildren(node('p','회원 명단을 불러오지 못했습니다. 다시 로그인해주세요.'));}
 }
 $('refresh-awards').onclick=()=>refreshOwn();$('directory-search').oninput=renderMembers;
 window.addEventListener('fwt-member-ready',e=>ready(e.detail));
 if(window.FWT_MEMBER_RUNTIME)ready(window.FWT_MEMBER_RUNTIME);
})();
