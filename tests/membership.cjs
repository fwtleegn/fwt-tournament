const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=readFileSync(__dirname+'/../member/member.js','utf8');
const testUser={id:'u',email:'member@example.com',email_confirmed_at:'2026-01-01',user_metadata:{}};
function harness({enabled=true,session=null,otpError=null,profile=null,saveError=null,verifyUser=null,hash=''}={}) {
 const elements=new Map(),calls=[];let saved=profile;
 function el(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,dataset:{},textContent:'',options:[],querySelectorAll:()=>[],setAttribute(){},replaceChildren(){},focus(){}});return elements.get(id);}
 const auth={getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user||verifyUser}}),onAuthStateChange(fn){auth.callback=fn;},signUp:async args=>{calls.push(['signup',args]);return {data:{},error:otpError};},signInWithPassword:async args=>{calls.push(['login',args]);return {error:otpError};},resetPasswordForEmail:async(...args)=>{calls.push(['reset',...args]);return {};},resend:async args=>{calls.push(['resend',args]);return {};},updateUser:async args=>{calls.push(['password',args]);return {};},signInWithOtp:async args=>{calls.push(['otp',args]);return {error:otpError};},verifyOtp:async args=>{calls.push(['verify',args]);return {error:verifyUser?null:{code:'otp_expired'}};},signOut:async()=>({})};
 const client={auth,from(){throw new Error('Profiles must use the private RPC');},async rpc(name,args){calls.push(['rpc',name,args]);if(name==='fwt_member_profile')return {data:saved};if(name==='fwt_save_member_profile'){if(saveError)return {error:saveError};saved={id:testUser.id,nickname:args.p_nickname,birth_date:args.p_birth_date,tennis_since:args.p_tennis_since};return {data:saved};}throw new Error('Unexpected RPC');}};
 el('password').value=el('password-confirm').value='Synthetic-test-123!';el('profile').hidden=true;el('email').value='member@example.com';el('nickname').value='테니스친구';el('birth-date').value='1990-05-10';el('tennis-since').value='2020-01';
 vm.runInNewContext(source,{document:{getElementById:el,querySelector:()=>el('tabs')},window:{FWT_MEMBER_CONFIG:{enabled,url:'https://example.test',key:'public'},supabase:{createClient:()=>client},dispatchEvent(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},history:{replaceState(){}},URLSearchParams,location:{hash,search:'',href:'https://example.test/member/index.html',replace:path=>calls.push(['redirect',path])},Date,URL,TypeError,console});
 return {el,calls,auth,submit:async id=>{el(id).onsubmit({preventDefault(){},currentTarget:el(id)});await settle();},saves:()=>calls.filter(c=>c[0]==='rpc'&&c[1]==='fwt_save_member_profile')};
}
async function settle(){for(let i=0;i<24;i++)await Promise.resolve();}
(async()=>{
 let h=harness({enabled:false});await h.submit('request-form');assert.equal(h.calls.length,0);assert.equal(h.el('fields').disabled,true);
 h=harness();h.el('password').value=h.el('password-confirm').value='Synthetic-test-123!';await h.submit('request-form');assert.equal(h.calls[0][0],'signup');assert.equal(h.calls[0][1].password,'Synthetic-test-123!');assert.equal(h.calls[0][1].options.data,undefined);assert.equal(h.el('password').value,'');assert.equal(h.el('verify-form').hidden,false);
 h=harness({verifyUser:testUser});h.el('login-tab').onclick();h.el('password').value='Synthetic-test-123!';await h.submit('request-form');assert.equal(h.calls[0][0],'login');assert.equal(h.el('signup-fields').hidden,false);
 h=harness();h.el('password').value='Synthetic-test-123!';h.el('password-confirm').value='mismatch';await h.submit('request-form');assert.equal(h.calls.length,0);assert.match(h.el('notice').textContent,/일치/);
 h=harness();h.el('forgot-button').onclick();await h.submit('request-form');assert.equal(h.calls[0][0],'reset');assert.equal(h.calls[0][2].redirectTo,'https://example.test/member/index.html');
 h=harness({session:{user:testUser}});await settle();h.auth.callback('PASSWORD_RECOVERY');assert.equal(h.el('password-form').hidden,false);h.el('new-password').value=h.el('new-password-confirm').value='Synthetic-new-123!';await h.submit('password-form');assert.equal(h.calls.find(c=>c[0]==='password')[1].password,'Synthetic-new-123!');assert.equal(h.el('new-password').value,'');
 h=harness({session:{user:testUser}});await settle();h.el('tennis-since').value='2999-01';await h.submit('request-form');assert.equal(h.saves().length,0);assert.match(h.el('notice').textContent,/연월/);
 h=harness({otpError:{status:429}});h.el('password').value=h.el('password-confirm').value='Synthetic-test-123!';await h.submit('request-form');assert.match(h.el('notice').textContent,/요청이 많/);assert.equal(h.el('request-form').dataset.busy,undefined);
 h=harness({session:{user:testUser}});await settle();await h.submit('request-form');assert.equal(h.saves().length,1);assert.equal(h.saves()[0][2].p_birth_date,'1990-05-10');assert.equal(h.saves()[0][2].p_user,undefined);assert.equal(h.el('profile').hidden,false);
 const complete={id:'u',nickname:'선수',birth_date:'1990-05-10',tennis_since:'2020-01-01'};
 h=harness({session:{user:testUser},profile:complete,saveError:{code:'23505'}});await settle();await h.submit('profile-form');assert.match(h.el('notice').textContent,/이미 사용/);
 for(const bad of ['2999-01-01','2025-02-29','']){h=harness({session:{user:testUser}});await settle();h.el('birth-date').value=bad;await h.submit('request-form');assert.equal(h.saves().length,0);assert.match(h.el('notice').textContent,/생년월일/);}
 h=harness({session:{user:testUser}});await settle();h.el('birth-date').value='2000-02-29';await h.submit('request-form');assert.equal(h.saves()[0][2].p_birth_date,'2000-02-29');assert.equal(h.el('edit-birth-date').value,'2000-02-29');
 h=harness({session:{user:testUser},profile:{id:'u',nickname:'기존회원',birth_date:null,tennis_since:'2020-01-01'}});await settle();assert.equal(h.el('nickname').value,'기존회원');assert.equal(h.el('birth-date').value,'');assert.equal(h.el('signup-fields').hidden,false);assert.equal(h.el('profile').hidden,true);
 h=harness({session:{user:testUser},profile:complete,hash:'#type=recovery&access_token=synthetic'});await settle();assert.equal(h.el('password-form').hidden,false);assert.equal(h.el('profile').hidden,true);
 h=harness({otpError:{code:'invalid_credentials'}});h.el('login-tab').onclick();h.el('password').value='Synthetic-test-123!';await h.submit('request-form');assert.match(h.el('notice').textContent,/올바르지/);assert.equal(h.el('password').value,'');
 h=harness({otpError:{code:'email_not_confirmed'}});h.el('login-tab').onclick();h.el('password').value='Synthetic-test-123!';await h.submit('request-form');assert.match(h.el('notice').textContent,/인증 이메일/);
 console.log('PASS: password signup/login/recovery, mismatch, rate limit, private birth-date/profile regression scenarios');
})().catch(e=>{console.error(e);process.exitCode=1;});
