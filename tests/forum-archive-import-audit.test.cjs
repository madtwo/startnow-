'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { normalizeCardRows, importBundle } = lib('store');
const { orderThreadComments } = lib('threading');
const now = Date.now();
const p=(id,extra={})=>({id,authorId:'me',authorKind:'player',text:'合成玩家评论正文。',at:now,...extra});
const card=(extra={})=>({id:'card',authorId:'shenmo',authorName:'沈默',authorKind:'persona',text:'合成卡片，今天读了半页书。',createdAt:now,status:'talking',plan:[],pending:[],arrivals:[],comments:[],...extra});
const people=['shenmo','weini'];
const storage=new Map();
global.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,val)=>storage.set(key,String(val)),removeItem:key=>storage.delete(key)};

test('imported comments missing ids remain separately visible and keep exact text',()=>{
 const raw=[p(undefined,{text:'第一条原文'}),p(undefined,{text:'第二条原文'})];
 const result=normalizeCardRows([card({comments:raw})],people)[0];
 assert.equal(orderThreadComments(result.comments).length,2);
 assert.deepEqual(result.comments.map(x=>x.text),['第一条原文','第二条原文']);
 assert.equal(new Set(result.comments.map(x=>x.id)).size,2);
});

test('duplicate card ids no longer address two conversations with one UI key',()=>{
 const result=normalizeCardRows([card({text:'合成卡甲'}),card({text:'合成卡乙'}),card({id:'brag',sourceCardId:'card'})],people);
 assert.equal(new Set(result.map(x=>x.id)).size,3);
 assert.deepEqual(result.map(x=>x.text),['合成卡甲','合成卡乙','合成卡片，今天读了半页书。']);
 assert.equal(result[2].sourceCardId,undefined);
});

test('invalid pending phase/source/persona and duplicate arrivals cannot survive restoration',()=>{
 const job={personaId:'shenmo',at:now,phase:'reply',sourceCommentId:'u1'};
 const result=normalizeCardRows([card({comments:[p('u1')],arrivals:['shenmo','shenmo','forged'],plan:[{personaId:'forged',at:now}],pending:[job,job,{...job,phase:'arbitrary'},{...job,sourceCommentId:'another-card'},{...job,personaId:'forged'}]})],people)[0];
 assert.equal(result.pending.length,1);
 assert.deepEqual(result.arrivals,['shenmo']);
 assert.deepEqual(result.plan,[]);
});

test('same-card reply provenance is repaired while historical prose remains byte-for-byte',()=>{
 const result=normalizeCardRows([card({comments:[p('a',{authorKind:'persona',authorId:'shenmo'}),p('b',{replyTo:'a',peer:'weini'}),p('c',{replyTo:'outside'})]})],people)[0];
 assert.equal(result.comments[1].peer,'shenmo');
 assert.equal(result.comments[2].replyTo,undefined);
 assert.ok(result.comments.every(x=>x.text==='合成玩家评论正文。'));
});

test('foreign archive imports never schedule nonexistent custom persona jobs',()=>{
 const result=importBundle(JSON.stringify({version:3,cards:[card({pending:[{personaId:'custom-forged',phase:'reply',at:now}],plan:[{personaId:'custom-forged',at:now}],arrivals:['custom-forged']})]}));
 assert.ok(result);
 assert.deepEqual(result.cards[0].pending,[]);
 assert.deepEqual(result.cards[0].plan,[]);
 assert.deepEqual(result.cards[0].arrivals,[]);
});

test('valid reply and adopted advice references remain stable after reload',()=>{
 const result=normalizeCardRows([card({comments:[p('u1'),p('a1',{authorId:'shenmo',authorKind:'persona',replyTo:'u1',kind:'advice'})],advice:{text:'打开书。',sourceCommentId:'a1',fromPersonaId:'shenmo',at:now,accepted:true},pending:[{personaId:'shenmo',at:now,phase:'reply',sourceCommentId:'u1'}]})],people)[0];
 assert.deepEqual(result.comments.map(x=>x.id),['u1','a1']);
 assert.equal(result.comments[1].replyTo,'u1');
 assert.equal(result.advice.sourceCommentId,'a1');
 assert.equal(result.pending[0].sourceCommentId,'u1');
});
