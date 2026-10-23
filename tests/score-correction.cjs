const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync(__dirname+'/../admin/knockout-control.html','utf8');
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const code=html.slice(html.indexOf('function scoreCorrectionPreview('),html.indexOf('async function restoreCompleted('));
async function run(scores,confirmResult=true,status='completed'){
 const writes=[],events=[],prompts=[];
 const match={id:'q',entry1_id:'a',entry2_id:'b',winner_entry_id:'a',score1:6,score2:2,status,stage:'quarterfinal',completed_at:'original'};
 const children=[{id:'s',stage:'semifinal',round_number:2,match_number:1,entry1_id:'a',entry2_id:'c',score1:6,score2:4,status:'completed',court_id:'court'},{id:'f',stage:'final',round_number:3,match_number:1,entry1_id:'a',entry2_id:'d',score1:6,score2:3,status:'completed'}];
 const before=JSON.stringify(children);
 const context={busy:false,selectedScoreMatchId:'q',scoreMode:'edit',getMatch:()=>match,getDescendants:()=>children,courts:[{id:'court',name:'1번코트'}],entryName:id=>({a:'선수 A',b:'선수 B',c:'선수 C',d:'선수 D'}[id]||'미정'),statusLabel:s=>s,document:{getElementById:id=>({value:String(scores[id==='score1'?0:1])})},confirm:m=>{prompts.push(m);return confirmResult},alert:m=>{throw Error(m)},setBusy:()=>{},updateMatch:async(id,data)=>writes.push({id,data}),resetDescendants:async id=>events.push('reset:'+id),repairPropagation:async()=>events.push('propagate'),closeScoreModal:()=>{},loadMatches:async()=>events.push('read'),renderAll:()=>events.push('render'),reloadAll:async()=>events.push('reload'),console};
 await vm.runInNewContext(code+';saveScore()',context);
 return {writes,events,prompts,match,children,before};
}
(async()=>{
 let r=await run([6,4]);assert.equal(r.writes.length,1);assert.deepEqual(JSON.parse(JSON.stringify(r.writes[0])),{id:'q',data:{score1:6,score2:4}});assert.equal(r.match.completed_at,'original');assert.equal(JSON.stringify(r.children),r.before);assert.ok(!r.events.some(x=>/reset|propagate|reload/.test(x)));assert.equal(r.prompts.length,0);
 r=await run([2,6],false);assert.equal(r.writes.length,0);assert.equal(r.events.length,0);assert.match(r.prompts[0],/4강 1경기: 선수 A vs 선수 C/);assert.match(r.prompts[0],/결승 1경기: 선수 A vs 선수 D/);assert.match(r.prompts[0],/점수 6 : 4/);assert.match(r.prompts[0],/1번코트/);assert.match(r.prompts[0],/선수 A → 선수 B/);
 r=await run([2,6],true);assert.deepEqual(r.events.slice(0,2),['reset:q','propagate']);assert.equal(r.writes[0].data.winner_entry_id,'b');
 r=await run([6,0],true,'walkover');assert.ok(!r.events.some(x=>/reset|propagate/.test(x)));assert.equal(r.writes[0].data.status,'completed');
 console.log('PASS: same winner changes scores only and preserves next rounds; winner-change preview, cancel without writes, confirmed reset, walkover conversion');
})();
