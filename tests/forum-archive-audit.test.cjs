'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { repairForumComments, repairForumPending, repairForumPlan } = lib('forumArchive');
const { orderThreadComments } = lib('threading');
const now = 1800000000000;
const p = (id, extra={}) => ({ id, text:'这是合成评论，正文应原样保留。', at:now,
  authorId:'me', authorKind:'player', ...extra });
const npc = (id, extra={}) => p(id, { authorKind:'persona', authorId:'shenmo', ...extra });
const allowed = new Set(['shenmo','weini','custom-local']);

test('missing and duplicate comment ids do not collapse distinct archived texts', () => {
  const raw = [p(undefined,{text:'第一段正文'}),p(undefined,{text:'第二段正文'}),p('same'),p('same'),npc('r',{replyTo:'same'})];
  const copy=JSON.stringify(raw);
  const {comments,ambiguousIds}=repairForumComments(raw,now);
  assert.equal(comments.length,5);
  assert.equal(orderThreadComments(comments).length,5);
  assert.equal(new Set(comments.map(x=>x.id)).size,5);
  assert.equal(comments[4].replyTo,undefined);
  assert.equal(ambiguousIds.has('same'),true);
  assert.deepEqual(comments.map(x=>x.text),raw.map(x=>x.text));
  assert.equal(JSON.stringify(raw),copy);
});

test('cross-card, self and cyclic thread links are detached; valid chains survive', () => {
  const {comments}=repairForumComments([p('a',{replyTo:'b'}),npc('b',{replyTo:'a'}),p('c',{replyTo:'other-card-comment'}),p('d',{replyTo:'d'}),p('root'),npc('valid',{replyTo:'root'})],now);
  assert.ok(comments.slice(0,4).every(c=>c.replyTo===undefined));
  assert.equal(comments[5].replyTo,'root');
  assert.equal(orderThreadComments(comments).length,6);
});

test('player reply targeting follows actual persona parent instead of forged peer', () => {
  const {comments}=repairForumComments([npc('parent'),p('child',{replyTo:'parent',peer:'weini'})],now);
  assert.equal(comments[1].peer,'shenmo');
});

test('invalid comment timestamps are repaired without editing text or valid timestamps', () => {
  const {comments}=repairForumComments([p('a',{at:NaN}),p('b',{at:'yesterday'}),p('c',{at:now-3})],now);
  assert.deepEqual(comments.map(x=>x.at),[now,now,now-3]);
});

test('malformed, cross-card, persona-source, ambiguous and misaddressed jobs are rejected', () => {
  const comments=[p('user',{peer:'shenmo'}),npc('npc')];
  const base={personaId:'shenmo',at:now,phase:'reply'};
  const raw=[{...base,phase:'invented'}, {...base,phase:['reply']}, {...base,sourceCommentId:[]}, {...base,sourceCommentId:'outside'}, {...base,sourceCommentId:'npc'}, {...base,sourceCommentId:'ambiguous'}, {...base,sourceCommentId:'user',personaId:'weini'}, {...base,personaId:'forged'}, {...base,at:Infinity}, null];
  assert.deepEqual(repairForumPending(raw,comments,new Set(['ambiguous']),allowed),[]);
});

test('distinct valid jobs and unscoped legacy jobs survive, duplicates are removed', () => {
  const comments=[p('a'),p('b')];
  const base={personaId:'shenmo',at:now,phase:'reply'};
  const raw=[{...base,sourceCommentId:'a'},{...base,sourceCommentId:'a'},{...base,sourceCommentId:'b'},base,{...base,personaId:'custom-local'}];
  const rows=repairForumPending(raw,comments,new Set(),allowed);
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(x=>x.sourceCommentId),['a','b',undefined,undefined]);
});

test('arrival plans enforce identities, bounded retry metadata and known phase without fabricating peers', () => {
  const base={personaId:'shenmo',at:now,phase:'arrival'};
  const rows=repairForumPlan([base,base,{...base,personaId:'forged'},{...base,personaId:'weini',phase:'reply'},{personaId:'custom-local',at:now,attempt:Infinity}],allowed);
  assert.deepEqual(rows.map(x=>x.personaId),['shenmo','custom-local']);
  assert.equal(rows[1].attempt,undefined);
});

test('a deep persisted chain uses iterative cycle detection and renders every message once', () => {
  const raw=Array.from({length:4000},(_,i)=>p(`c${i}`,i?{replyTo:`c${i-1}`} : {}));
  const {comments}=repairForumComments(raw,now);
  const rows=orderThreadComments(comments);
  assert.equal(rows.length,4000);
  assert.equal(rows.at(-1).depth,3999);
  assert.equal(rows.at(-1).visualDepth,2);
});


test('explicit no-reply peer sentinel survives persistence and prevents pending replay', () => {
  const {comments,ambiguousIds}=repairForumComments([npc('parent'),p('silent',{replyTo:'parent',peer:''})],now);
  assert.equal(comments[1].peer,'');
  assert.deepEqual(repairForumPending([{personaId:'shenmo',at:now,phase:'reply',sourceCommentId:'silent'}],comments,ambiguousIds,allowed),[]);
});
