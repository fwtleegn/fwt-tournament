const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=readFileSync(__dirname+'/../member/member.js','utf8');
function harness({enabled=true,session=null,otpError=null,profile=null,saveError=null,verifyUser=null}={}) {
  const elements=new Map(); const calls=[];
  function el(id){ if(!elements.has(id)) elements.set(id,{value:'',hidden:false,disabled:false,dataset:{},textContent:'',options:[],querySelectorAll:()=>[],setAttribute(){},replaceChildren(){},focus(){}});return elements.get(id); }
  const auth={getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user || verifyUser}}),onAuthStateChange(){},signInWithOtp:async args=>{calls.push(['otp',args]);return {error:otpError}},verifyOtp:async args=>{calls.push(['verify',args]);return {error:verifyUser ? null : {code:'otp_expired'}}},signOut:async()=>({})};
  const client={auth,from(table){calls.push(['table',table]);return {select(){return this},eq(){return this},maybeSingle:async()=>({data:profile}),insert:async data=>{calls.push(['insert',data]);return {error:saveError}},update(data){calls.push(['update',data]);return this},single:async()=>({data:saveError?null:{id:'u'},error:saveError})}}};
  el('email').value='member@example.com';el('nickname').value='테니스친구';el('age-band').value='30s';el('tennis-since').value='2020-01';
  vm.runInNewContext(source,{document:{getElementById:el,querySelector:()=>el('tabs')},window:{FWT_MEMBER_CONFIG:{enabled,url:'https://example.test',key:'public'},supabase:{createClient:()=>client},dispatchEvent(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail}},location:{href:'https://example.test/member/index.html',replace:path=>calls.push(['redirect',path])},Date,URL,TypeError,console});
  return {el,calls,submit:async id=>{el(id).onsubmit({preventDefault(){},currentTarget:el(id)});await settle();}};
}
async function settle(){for(let i=0;i<15;i++)await Promise.resolve();}
(async()=>{
  let h=harness({enabled:false});await h.submit('request-form');assert.equal(h.calls.length,0);assert.equal(h.el('fields').disabled,true);
  h=harness();await h.submit('request-form');assert.equal(h.calls[0][1].options.shouldCreateUser,true);assert.equal(h.calls[0][1].options.data,undefined);assert.equal(h.el('verify-form').hidden,false);assert.equal(h.el('signup-fields').hidden,true);
  h=harness();h.el('login-tab').onclick();await h.submit('request-form');assert.equal(h.calls[0][1].options.shouldCreateUser,false);assert.equal(h.calls[0][1].options.data,undefined);
  h=harness({session:{user:{id:'u',email:'member@example.com',email_confirmed_at:'2026-01-01',user_metadata:{}}}});await settle();h.el('tennis-since').value='2999-01';await h.submit('request-form');assert.equal(h.calls.some(x=>x[0]==='insert'),false);assert.match(h.el('notice').textContent,/연월/);
  h=harness({otpError:{status:429}});await h.submit('request-form');assert.match(h.el('notice').textContent,/요청이 많/);assert.equal(h.el('request-form').dataset.busy,undefined);
  h=harness();await h.submit('request-form');h.el('token').value='123456';await h.submit('verify-form');assert.match(h.el('notice').textContent,/만료/);assert.equal(h.calls.some(c=>c[0]==='insert'),false);
  const session={user:{id:'u',email:'member@example.com',email_confirmed_at:'2026-01-01',user_metadata:{}}};
  h=harness({verifyUser:session.user});await h.submit('request-form');h.el('token').value='123456';await h.submit('verify-form');assert.equal(h.el('request-form').hidden,false);assert.equal(h.el('verify-form').hidden,true);assert.equal(h.el('send-button').textContent,'프로필 완성하기');
  h=harness({session});await settle();assert.equal(h.el('send-button').textContent,'프로필 완성하기');await h.submit('request-form');assert.equal(h.calls.filter(c=>c[0]==='insert').length,1);assert.equal(h.calls.find(c=>c[0]==='insert')[1].id,'u');
  h=harness({session,profile:{nickname:'선수',age_band:'30s',tennis_since:'2020-01-01'},saveError:{code:'23505'}});await settle();await h.submit('profile-form');assert.match(h.el('notice').textContent,/이미 사용/);
  console.log('PASS: 9 membership scenarios (release gate, signup/login, future date, rate limit, expired OTP, OTP success, verified profile completion, duplicate nickname)');
})().catch(e=>{console.error(e);process.exitCode=1});

