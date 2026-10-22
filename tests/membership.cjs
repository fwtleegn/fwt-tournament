const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=readFileSync(__dirname+'/../member/member.js','utf8');
const testUser={id:'u',email:'member@example.com',email_confirmed_at:'2026-01-01',user_metadata:{}};
function harness({enabled=true,session=null,otpError=null,profile=null,saveError=null,verifyUser=null}={}) {
 const elements=new Map(),calls=[];let saved=profile;
 function el(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,dataset:{},textContent:'',options:[],querySelectorAll:()=>[],setAttribute(){},replaceChildren(){},focus(){}});return elements.get(id);}
 const auth={getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session?.user||verifyUser}}),onAuthStateChange(){},signInWithOtp:async args=>{calls.push(['otp',args]);return {error:otpError};},verifyOtp:async args=>{calls.push(['verify',args]);return {error:verifyUser?null:{code:'otp_expired'}};},signOut:async()=>({})};
 const client={auth,from(){throw new Error('Profiles must use the private RPC');},async rpc(name,args){calls.push(['rpc',name,args]);if(name==='fwt_member_profile')return {data:saved};if(name==='fwt_save_member_profile'){if(saveError)return {error:saveError};saved={id:testUser.id,nickname:args.p_nickname,birth_date:args.p_birth_date,tennis_since:args.p_tennis_since};return {data:saved};}throw new Error('Unexpected RPC');}};
 el('profile').hidden=true;el('email').value='member@example.com';el('nickname').value='테니스친구';el('birth-date').value='1990-05-10';el('tennis-since').value='2020-01';
 vm.runInNewContext(source,{document:{getElementById:el,querySelector:()=>el('tabs')},window:{FWT_MEMBER_CONFIG:{enabled,url:'https://example.test',key:'public'},supabase:{createClient:()=>client},dispatchEvent(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},location:{href:'https://example.test/member/index.html',replace:path=>calls.push(['redirect',path])},Date,URL,TypeError,console});
 return {el,calls,submit:async id=>{el(id).onsubmit({preventDefault(){},currentTarget:el(id)});await settle();},saves:()=>calls.filter(c=>c[0]==='rpc'&&c[1]==='fwt_save_member_profile')};
}
async function settle(){for(let i=0;i<24;i++)await Promise.resolve();}
(async()=>{
 let h=harness({enabled:false});await h.submit('request-form');assert.equal(h.calls.length,0);assert.equal(h.el('fields').disabled,true);
 h=harness();await h.submit('request-form');assert.equal(h.calls[0][1].options.shouldCreateUser,true);assert.equal(h.calls[0][1].options.data,undefined);assert.equal(h.el('signup-fields').hidden,true);
 h=harness();h.el('login-tab').onclick();await h.submit('request-form');assert.equal(h.calls[0][1].options.shouldCreateUser,false);
 h=harness({session:{user:testUser}});await settle();h.el('tennis-since').value='2999-01';await h.submit('request-form');assert.equal(h.saves().length,0);assert.match(h.el('notice').textContent,/연월/);
 h=harness({otpError:{status:429}});await h.submit('request-form');assert.match(h.el('notice').textContent,/요청이 많/);assert.equal(h.el('request-form').dataset.busy,undefined);
 h=harness();await h.submit('request-form');h.el('token').value='123456';await h.submit('verify-form');assert.match(h.el('notice').textContent,/만료/);assert.equal(h.saves().length,0);
 h=harness({verifyUser:testUser});await h.submit('request-form');h.el('token').value='123456';await h.submit('verify-form');assert.equal(h.el('request-form').hidden,false);assert.equal(h.el('verify-form').hidden,true);
 h=harness({session:{user:testUser}});await settle();await h.submit('request-form');assert.equal(h.saves().length,1);assert.equal(h.saves()[0][2].p_birth_date,'1990-05-10');assert.equal(h.saves()[0][2].p_user,undefined);assert.equal(h.el('profile').hidden,false);
 const complete={id:'u',nickname:'선수',birth_date:'1990-05-10',tennis_since:'2020-01-01'};
 h=harness({session:{user:testUser},profile:complete,saveError:{code:'23505'}});await settle();await h.submit('profile-form');assert.match(h.el('notice').textContent,/이미 사용/);
 for(const bad of ['2999-01-01','2025-02-29','']){h=harness({session:{user:testUser}});await settle();h.el('birth-date').value=bad;await h.submit('request-form');assert.equal(h.saves().length,0);assert.match(h.el('notice').textContent,/생년월일/);}
 h=harness({session:{user:testUser}});await settle();h.el('birth-date').value='2000-02-29';await h.submit('request-form');assert.equal(h.saves()[0][2].p_birth_date,'2000-02-29');assert.equal(h.el('edit-birth-date').value,'2000-02-29');
 h=harness({session:{user:testUser},profile:{id:'u',nickname:'기존회원',birth_date:null,tennis_since:'2020-01-01'}});await settle();assert.equal(h.el('nickname').value,'기존회원');assert.equal(h.el('birth-date').value,'');assert.equal(h.el('signup-fields').hidden,false);assert.equal(h.el('profile').hidden,true);
 console.log('PASS: 14 membership scenarios, including future/invalid/missing birthdays, leap dates, private RPC writes and legacy profile completion');
})().catch(e=>{console.error(e);process.exitCode=1;});
