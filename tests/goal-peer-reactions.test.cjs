const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { planPeerReactions, peerReactionFallback, isSafePeerReaction, validPeerPlans,
  existingPeerCount, isGoalResultCard, settlePeerReactionsLocally } = lib('peerReactions');
const { tickPersonaGoals } = lib('personaGoals');
const { tickCards, addPlayerComment } = lib('cards');
const { makePersonaGoal, publishPersonaGoal } = lib('goals');
const { defaultPersonas } = lib('personas');
const people=defaultPersonas().filter(p=>['shenmo','weini','miaoze','yanggao'].includes(p.id));
const now=1_800_000_000_000;
const settings={paused:false,aiCardLimit:0,maxCallsPerTick:2,maxArrivals:2,speed:6,dailyCalls:60,baselineExtra:''};
const mock={providerId:'mock',baseUrl:'',model:'demo',apiKey:''};
const card=(kind='brag',extra={})=>({id:'r-100',authorId:'shenmo',authorName:'沈默',authorKind:'persona',
  kind,origin:'simulated',goalId:'goal-1',text:'【AI 虚构剧情】今天把病理一页复习完了。',
  createdAt:now,status:'talking',arrivals:[],plan:[],pending:[],comments:[],...extra});

const makeResult=(outcome='done')=>{
 const p=people[0];
 const g=makePersonaGoal({persona:p,title:'复习一页病理笔记',steps:[{text:'打开病理笔记'}],now:now-86_400_000});
 const published=publishPersonaGoal(g,p.name,g.createdAt);
 const due=now-1;
 const source={...published.goal,postPlan:{outcome,dueAt:due}};
 return tickPersonaGoals({goals:[source],cards:[published.card],personas:people,
   now,enabled:true,dailyCap:0,introActive:false,enableLost:false});
};

test('only simulated result cards get deterministic, delayed, non-author plans',()=>{
 const result=card();
 const a=planPeerReactions(result,people,now);
 const b=planPeerReactions(result,people,now);
 assert.deepEqual(a,b);
 assert.ok(a.length>=1 && a.length<=2);
 assert.equal(new Set(a.map(x=>x.personaId)).size,a.length);
 assert.ok(a.every(x=>x.personaId!=='shenmo' && x.phase==='arrival'));
 assert.ok(a.every(x=>x.at>=now+60_000 && x.at<=now+240_000));
 assert.deepEqual(planPeerReactions(card('goal'),people,now),[]);
 assert.deepEqual(planPeerReactions(card('progress'),people,now),[]);
 assert.deepEqual(planPeerReactions(card('brag',{origin:'model'}),people,now),[]);
 assert.deepEqual(planPeerReactions(card('brag',{goalId:undefined}),people,now),[]);
 assert.deepEqual(planPeerReactions(card('brag',{text:'我不想活了'}),people,now),[]);
});

test('done and missed outcomes publish one result with a persisted plan, never duplicate',()=>{
 for(const outcome of ['done','missed','partial']){
  const once=makeResult(outcome);
  assert.equal(once.publishedResults,1);
  const result=once.cards.find(c=>c.id===once.goals[0].resultCardId);
  assert.ok(result);
  assert.equal(result.kind,outcome==='done'?'brag':'worry');
  assert.ok(result.plan.length>=1 && result.plan.length<=2);
  assert.ok(result.plan.every(p=>p.personaId!==result.authorId));
  const twice=tickPersonaGoals({...once,personas:people,now:now+1,enabled:true,dailyCap:0,introActive:false,enableLost:false});
  assert.equal(twice.publishedResults,0);
  assert.equal(twice.cards.filter(c=>c.id===result.id).length,1);
 }
});

test('opening pause prevents any new goal or result, regardless of due plan',()=>{
 const result=makeResult();
 const second=tickPersonaGoals({goals:result.goals,cards:result.cards,personas:people,
   now:now+1000,enabled:true,introActive:true,enableLost:true});
 assert.equal(second.createdGoals,0);
 assert.equal(second.publishedResults,0);
 assert.deepEqual(second.cards,result.cards);
});

test('missed model fallback copy never pressures, lectures, or summons player',()=>{
 for(const person of people){
  const text=peerReactionFallback(card('worry'),person);
  assert.ok(isSafePeerReaction(card('worry'),text),`${person.id}: ${text}`);
  assert.doesNotMatch(text,/加油|下次一定|你应该|别难过|至少你|继续冲|再来一个/);
  assert.ok(isSafePeerReaction(card('brag'),peerReactionFallback(card('brag'),person)));
 }
});

test('imported extra, duplicate, author or early arrivals are rejected; existing peer stops plan',()=>{
 const result=card(); const good=planPeerReactions(result,people,now)[0];
 const forged=card('brag',{plan:[good,good,{...good,personaId:'shenmo'},
   {...good,personaId:'not-a-persona'},{...good,personaId:'yanggao',at:now}]});
 assert.deepEqual(validPeerPlans(forged,people),[good]);
 assert.equal(validPeerPlans(card('brag',{plan:[good],comments:[{id:'x',authorKind:'persona',authorId:'weini',text:'说过了',at:now}]}),people).length,0);
 assert.equal(existingPeerCount(card('brag',{comments:[{id:'1',authorKind:'persona',authorId:'weini'},
 {id:'2',authorKind:'persona',authorId:'weini'}]})),1);
});

test('mock engine posts peer reaction once, no helper, no cascade; goal card remains silent',async()=>{
 const result=card('brag');result.plan=planPeerReactions(result,people,now);
 const maxDue=Math.max(...result.plan.map(x=>x.at));
 const out=await tickCards({cards:[result],personas:people,settings,config:mock,now:maxDue+10});
 const done=out.cards.find(c=>c.id===result.id);
 assert.ok(done.comments.length>=1 && done.comments.length<=2);
 assert.equal(done.comments.filter(c=>c.authorKind==='helper').length,0);
 assert.equal(done.comments.some(c=>c.authorId==='shenmo'),false);
 assert.equal(done.plan.length,0);
 assert.equal(done.pending.length,0);
 assert.equal(out.calls,0);
 const again=await tickCards({cards:out.cards,personas:out.personas,settings,config:mock,now:maxDue+50_000});
 assert.equal(again.cards[0].comments.length,done.comments.length);
 const originalGoal=card('goal',{plan:[{personaId:'weini',at:now-1}],createdAt:now-100_000});
 const goalOut=await tickCards({cards:[originalGoal],personas:people,settings,config:mock,now});
 assert.equal(goalOut.cards[0].comments.length,0);
 assert.equal(goalOut.cards[0].plan.length,0);
});

test('a completed result can still receive an author reply to a player comment after peer arrival',async()=>{
 const result=card('worry');result.plan=planPeerReactions(result,people,now);
 const done=await tickCards({cards:[result],personas:people,settings,config:mock,
   now:Math.max(...result.plan.map(x=>x.at))+1000});
 const received=done.cards[0];
 const next=addPlayerComment(received,'病理这段你后来再看了吗？',now+500_000,6);
 assert.equal(next.pending.length,1);
 const after=await tickCards({cards:[next],personas:people,settings,config:mock,now:now+510_000});
 const comments=after.cards[0].comments;
 assert.equal(comments.filter(c=>c.authorId==='shenmo' && c.authorKind==='persona').length,1);
 assert.ok(comments.some(c=>c.authorId!=='shenmo' && c.authorKind==='persona'));
 assert.equal(after.cards[0].pending.length,0);
});

test('real model rejection degrades to a local peer line, not a helper/error or follow-up',async()=>{
 const result=card('worry');result.plan=planPeerReactions(result,people,now);
 const nonMock={providerId:'openai',baseUrl:'',model:'unavailable',apiKey:'test-placeholder'};
 const out=await tickCards({cards:[result],personas:people,settings,config:nonMock,now:now+360_000});
 const replies=out.cards[0].comments;
 assert.equal(replies.length,1);
 assert.equal(replies[0].origin,'curated');
 assert.ok(isSafePeerReaction(result,replies[0].text));
 assert.equal(out.cards[0].plan.length,0);
 assert.equal(out.cards[0].pending.length,0);
 assert.equal(replies.filter(c=>c.authorKind==='helper').length,0);
 // Invalid configuration is rejected before fetch, so no HTTP attempt is charged.
 assert.equal(out.calls,0);
});

test('offline tick consumes due peer plan exactly once without a paid model',()=>{
 const result=card('worry');result.plan=planPeerReactions(result,people,now);
 const tooSoon=settlePeerReactionsLocally([result],people,now);
 assert.equal(tooSoon.settled,0);
 const next=settlePeerReactionsLocally([result],people,now+360_000);
 assert.equal(next.settled,1);
 assert.equal(next.cards[0].plan.length,0);
 const repeat=settlePeerReactionsLocally(next.cards,people,now+370_000);
 assert.equal(repeat.settled,0);
 assert.equal(repeat.cards[0].comments.length,1);
});
