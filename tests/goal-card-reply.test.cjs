const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const lib=(n)=>require(path.join(__dirname,'..','src','lib',n+'.ts'));
const {addPlayerComment,tickCards}=lib('cards');
const {defaultPersonas}=lib('personas');
const {defaultSettings}=lib('store');
const now=1_800_000_000_000;
const mock={providerId:'mock',baseUrl:'',model:'demo',apiKey:''};
const settings={...defaultSettings,aiCardLimit:0,maxCallsPerTick:3,speed:6};
const goalCard=(over={})=>({id:'goal-card',authorId:'shenmo',authorName:'沈默',authorKind:'persona',
  kind:'goal',goalId:'goal-1',origin:'simulated',title:'沈默 · 今天想做的小事',
  text:'【AI 虚构剧情】病理第三章只背「炎症介质」一页\n计划：翻到那一页。',
  createdAt:now-60_000,status:'talking',arrivals:[],plan:[],pending:[],comments:[],...over});
test('player comment on an AI goal card gets the author reply, not another persona or helper',async()=>{
  const withComment=addPlayerComment(goalCard(),'楼主背完了吗',now,6);
  assert.equal(withComment.pending.length,1);
  assert.equal(withComment.pending[0].personaId,'shenmo');
  const out=await tickCards({cards:[withComment],personas:defaultPersonas(),settings,config:mock,now:now+20_000});
  const card=out.cards[0];
  assert.equal(card.arrivals.length,0);
  assert.equal(card.plan.length,0);
  assert.equal(card.helperAt,undefined);
  const replies=card.comments.filter((c)=>c.authorKind==='persona');
  assert.equal(replies.length,1);
  assert.equal(replies[0].authorId,'shenmo');
  assert.ok(replies[0].text.length>0);
});
test('an AI goal card without player comment stays silent (no auto arrival/reply)',async()=>{
  const out=await tickCards({cards:[goalCard()],personas:defaultPersonas(),settings,config:mock,now:now+20_000});
  const card=out.cards[0];
  assert.equal(card.comments.length,0);
  assert.equal(card.arrivals.length,0);
  assert.equal(card.plan.length,0);
  assert.equal(card.pending.length,0);
});

test('old goal-card comment with lost queue is repaired once',async()=>{
  const comment={id:'old-1',authorId:'me',authorKind:'player',text:'楼主背完了吗',at:now-60_000,kind:'comment'};
  const first=await tickCards({cards:[goalCard({comments:[comment]})],personas:defaultPersonas(),settings,config:mock,now:now+30_000});
  assert.equal(first.cards[0].goalReplyBackfillAt,now+30_000);
  const out=await tickCards({cards:first.cards,personas:defaultPersonas(),settings,config:mock,now:now+35_000});
  const card=out.cards[0];
  assert.ok(card.comments.some((c)=>c.authorKind==='persona' && c.authorId==='shenmo'));
});
test('backfill does not loop after it has run',async()=>{
  const comment={id:'old-1',authorId:'me',authorKind:'player',text:'楼主背完了吗',at:now-60_000,kind:'comment'};
  const card=goalCard({comments:[comment],goalReplyBackfillAt:now-10_000});
  const out=await tickCards({cards:[card],personas:defaultPersonas(),settings,config:mock,now:now+30_000});
  assert.equal(out.cards[0].pending.length,0);
  assert.equal(out.cards[0].comments.filter((c)=>c.authorKind==='persona').length,0);
});
