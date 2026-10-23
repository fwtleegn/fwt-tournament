'use strict';
(async()=>{
 const config=window.FWT_MEMBER_CONFIG;
 if(!window.supabase||!config){document.getElementById('home-status').textContent='아래에서 이동할 화면을 선택해주세요.';return;}
 // Separate sessions are preserved; this router never logs either account out.
 const results=await Promise.allSettled(['fwt-member-session-v1','sb-opwuyqerisocqobbbisg-auth-token'].map(async storageKey=>{
  const client=window.supabase.createClient(config.url,config.key,{auth:{storageKey,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await client.auth.getSession();
  return !error&&!!data.session?.user?.email_confirmed_at;
 }));
 const signedIn=results.some(r=>r.status==='fulfilled'&&r.value);
 location.replace(signedIn?'index.html':'member/index.html?mode=login');
})();
