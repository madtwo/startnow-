/** Synthetic forum scheduling regressions. No real model, key, player data or network. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { addPlayerComment, tickCards } = lib('cards');
const { defaultPersonas } = lib('personas');
const NOW = 1_800_000_000_000;
const personas = () => defaultPersonas().map(p => ({...p, memory: [], weekLog: []}));
const mock = { providerId: 'mock', baseUrl: '', model: '', apiKey: '' };
const live = { providerId: 'compatible', baseUrl: 'https://example.test/v1', model: 'fixture', apiKey: 'synthetic-test-key' };
const settings = { paused:false, aiCardLimit:0, maxArrivals:2, maxCallsPerTick:2, speed:6, baselineExtra:'', dailyCalls:20 };
const card = (over={}) => ({ id:'forum-q', authorId:'shenmo', authorName:'沈默', authorKind:'persona',
  kind:'life', text:'窗边的绿萝今天长出了一片叶子。', createdAt:NOW-60_000, status:'talking',
  comments:[], pending:[], plan:[], arrivals:[], ...over });
const player = (id, over={}) => ({ id, authorId:'me', authorKind:'player', kind:'comment',
  text:'那片新叶的颜色还挺好看的。', at:NOW-1000, peer:'shenmo', ...over });
const reply = (id, source, author='shenmo') => ({id,authorId:author,authorKind:'persona',text:'嗯，是嫩绿色的。',at:NOW-500,replyTo:source,origin:'demo'});
const job = (source,over={}) => ({personaId:'shenmo',at:NOW-1,phase:'reply',sourceCommentId:source,...over});
const tick = (c,config=mock,extra={}) => tickCards({cards:[c],personas:personas(),settings,config,now:NOW,...extra});
const goal = (over={}) => card({goalId:'g1',origin:'simulated',kind:'worry',title:'今天没做完',
  text:'今天没做完。还没做：圈出一条自己符合的经历。',...over});
async function fetchFixture(run) {
  const previous=global.fetch; const requests=[];
  global.fetch=async (_url,options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'这片新长出来的叶子，颜色看起来很柔和。'}}]}),
      {status:200,headers:{'content-type':'application/json'}});
  };
  try {return {output:await run(),requests};} finally {global.fetch=previous;}
}

test('queue: persisted answer consumes a stale source-bound job without answering twice',async()=>{
  const out=await tick(card({comments:[player('u1'),reply('r1','u1')],pending:[job('u1')]}));
  assert.equal(out.cards[0].comments.filter(c=>c.authorKind==='persona').length,1);
  assert.equal(out.cards[0].pending.length,0);
});

test('queue: an older sourced pending job does not suppress a background peer for the latest turn',async()=>{
  const c=card({
    comments:[
      player('u0',{text:'更早的一条评论',peer:'weini',at:NOW-5000}),
      player('u1',{text:'这条是回给魏霓的',peer:'weini',at:NOW-1000}),
    ],
    pending:[
      {personaId:'miaoze',at:NOW-2,phase:'reply'},
      job('u0',{personaId:'weini',at:NOW-1}),
    ],
  });
  const out=await tick(c);
  const miaoze=out.cards[0].comments.filter(x=>x.authorId==='miaoze');
  assert.equal(miaoze.length,1);
  assert.ok(miaoze[0].text.length>0);
});

test('queue: a source-bound pending job for the latest directed turn still suppresses background peers',async()=>{
  const c=card({
    comments:[player('u1',{text:'这条是回给魏霓的',peer:'weini',at:NOW-1000})],
    pending:[
      {personaId:'miaoze',at:NOW-2,phase:'reply'},
      job('u1',{personaId:'weini',at:NOW-1}),
    ],
  });
  const out=await tick(c);
  assert.equal(out.cards[0].comments.filter(x=>x.authorId==='miaoze').length,0);
  assert.equal(out.cards[0].comments.filter(x=>x.authorId==='weini').length,1);
});

test('queue: reply and decide jobs for the same player turn yield at most one answer',async()=>{
  const c=card({kind:'worry',text:'实验报告空着一行。',comments:[player('u1',{kind:'advice',text:'先在报告里写一行实验记录。'})],
    pending:[job('u1',{phase:'decide',at:NOW-2000}),job('u1',{phase:'reply',at:NOW-1000})]});
  const out=await tick(c);
  assert.equal(out.cards[0].comments.filter(c=>c.authorKind==='persona').length,1);
  assert.equal(out.cards[0].pending.length,0);
});

test('queue: three unrelated pending jobs must not discard a newly accepted player turn',()=>{
  const pending=['a','b','c'].map((id,i)=>job(id,{personaId:['weini','miaoze','yanggao'][i]}));
  const out=addPlayerComment(card({pending}),'这片叶子是什么时候长出来的',NOW,6,'comment','shenmo');
  const added=out.comments.at(-1);
  assert.ok(out.pending.some(p=>p.sourceCommentId===added.id&&p.personaId==='shenmo'));
  assert.equal(out.pending.length,4);
});

test('queue: replying to an existing persona comment infers its recipient',()=>{
  const out=addPlayerComment(card({authorKind:'player',authorId:'me',comments:[reply('weini-r',undefined,'weini')]}),
    '这片叶子你也觉得挺好看吧',NOW,6,'comment',undefined,'weini-r');
  assert.equal(out.comments.at(-1).peer,'weini');
  assert.equal(out.pending[0]?.personaId,'weini');
});

test('queue: visible reply parent prevents mismatching peer from changing the recipient',()=>{
  const out=addPlayerComment(card({comments:[reply('weini-r',undefined,'weini')]}),
    '这片叶子你也觉得挺好看吧',NOW,6,'comment','miaoze','weini-r');
  assert.equal(out.comments.at(-1).peer,'weini');
  assert.equal(out.pending[0]?.personaId,'weini');
});

test('queue: stale or cross-card reply reference preserves text without scheduling a wrong recipient',()=>{
  const out=addPlayerComment(card(),'这是原本想回给那条评论的话',NOW,6,'comment','shenmo','other-card-comment');
  assert.equal(out.comments.at(-1).text,'这是原本想回给那条评论的话');
  assert.equal(out.comments.at(-1).replyTo,undefined);
  assert.equal(out.pending.length,0);
});

test('queue: explicit no-recipient comment does not cause goal author backfill',async()=>{
  const out=await tick(goal({comments:[player('u1',{peer:''})]}));
  assert.equal(out.cards[0].pending.length,0);
  assert.equal(out.cards[0].goalReplyBackfillAt,undefined);
});

test('queue: comment addressed to a result-card peer does not consume author backfill marker',async()=>{
  const out=await tick(goal({comments:[player('u1',{peer:'weini'})]}));
  assert.equal(out.cards[0].pending.length,0);
  assert.equal(out.cards[0].goalReplyBackfillAt,undefined);
});

test('queue: backfill cannot answer a player reply whose visible parent belongs to another persona',async()=>{
  const out=await tick(goal({comments:[reply('peer-r',undefined,'weini'),player('u1',{peer:undefined,replyTo:'peer-r'})]}));
  assert.equal(out.cards[0].pending.length,0);
  assert.equal(out.cards[0].goalReplyBackfillAt,undefined);
});

test('queue: a genuine addPlayerComment action renews an old still-open card',async()=>{
  const posted=addPlayerComment(card({createdAt:NOW-2*86_400_000}),
    '这片叶子今天长得怎么样了？',NOW,6,'comment','shenmo');
  const source=posted.comments.at(-1);
  assert.equal(posted.lastPlayerActivityAt,NOW);
  const out=await tick({...posted,pending:[job(source.id)]});
  assert.notEqual(out.cards[0].status,'handled');
  assert.ok(out.cards[0].comments.some(c=>c.authorKind==='persona'&&c.replyTo===source.id));
});

test('queue: old idle conversations still expire and future timestamps do not defeat expiry',async()=>{
  for (const at of [NOW-2*86_400_000,NOW+86_400_000]) {
    const out=await tick(card({createdAt:NOW-2*86_400_000,comments:[player('u1',{at})],pending:[job('u1')]}));
    assert.equal(out.cards[0].status,'handled');
    assert.equal(out.cards[0].pending.length,0);
  }
});

test('queue: a historical persona comment prevents an imported duplicate arrival',async()=>{
  const out=await tick(card({comments:[reply('r1',undefined)],plan:[{personaId:'shenmo',at:NOW-1}]}));
  assert.equal(out.cards[0].comments.filter(c=>c.authorKind==='persona').length,1);
});

test('queue: goal, brag and life advice remains conversational, never a decide job',()=>{
  for (const c of [goal(),card({kind:'brag'}),card(),card({kind:'goal'})]) {
    const out=addPlayerComment(c,'先写一行实验记录。',NOW,6,'advice');
    assert.equal(out.pending[0]?.phase,'reply');
  }
});

test('queue: imported decide on a result card cannot create advice or execute another action',async()=>{
  const out=await tick(goal({comments:[player('u1',{kind:'advice',text:'先在纸上写一行实验记录。'})],pending:[job('u1',{phase:'decide'})]}));
  assert.equal(out.cards[0].advice,undefined);
  assert.equal(out.cards[0].refused,undefined);
  assert.equal(out.cards[0].pendingBrag,undefined);
});

test('queue: automatic source-less peers react to the card, not another recipient player turn',async()=>{
  const source=player('u1',{peer:'weini',text:'PRIVATE_WEINI_SENTINEL 这句话只想问另一位同伴今天的心情。'});
  const {output,requests}=await fetchFixture(()=>tick(card({comments:[source],pending:[{personaId:'miaoze',at:NOW-1,phase:'reply'}]}),live));
  assert.equal(requests.length,1);
  assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_WEINI_SENTINEL/);
  const generated=output.cards[0].comments.find(c=>c.authorId==='miaoze');
  assert.ok(generated);
  assert.equal(generated.replyTo,undefined);
});

test('queue: automatic arrival does not steal a private targeted player turn',async()=>{
  const source=player('u1',{peer:'weini',text:'PRIVATE_WEINI_SENTINEL 这句话只想问另一位同伴今天的心情。'});
  const {requests}=await fetchFixture(()=>tick(card({comments:[source],plan:[{personaId:'miaoze',at:NOW-1}]}),live));
  assert.equal(requests.length,1);
  assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_WEINI_SENTINEL/);
});

test('queue: invalid persona, non-finite deadline and invalid source jobs cannot block valid work',async()=>{
  const out=await tick(card({comments:[player('u1')],pending:[job('u1',{personaId:'missing'}),job('u1',{at:NaN}),job('gone'),job('u1')]}));
  assert.equal(out.cards[0].comments.filter(c=>c.authorKind==='persona').length,1);
  assert.equal(out.cards[0].pending.length,0);
});

test('queue: independent source-bound turns and input snapshots remain intact',async()=>{
  const c=card({comments:[player('u1'),player('u2')],pending:[job('u1',{at:NOW-2}),job('u2')]});
  const before=structuredClone(c);
  const out=await tick(c);
  assert.equal(out.cards[0].comments.at(-1).replyTo,'u1');
  assert.equal(out.cards[0].pending[0].sourceCommentId,'u2');
  assert.deepEqual(c,before);
});

test('queue: legacy decide without a player source cannot adopt the latest unrelated comment',async()=>{
  const c=card({kind:'worry',text:'实验报告空着一行。',comments:[player('u1',{text:'先写一行实验记录。'})],
    pending:[{personaId:'shenmo',at:NOW-1,phase:'decide'}]});
  const out=await tick(c);
  assert.equal(out.cards[0].comments.filter(row=>row.authorKind==='persona').length,0);
  assert.equal(out.cards[0].advice,undefined);
  assert.equal(out.cards[0].pending.length,0);
});
