const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { buildSeedCards } = lib('seed');
const {
  OPENING_GATE_KEY, openingStage, openingReadCount, openingIntroCards,
  openingReady, validPlayerIntroText, isPlayerIntro, persistOpeningStage, readOpeningGate,
  clearOpeningStage,
} = lib('openingGate');
const now = 1_800_000_000_000;
const fresh = () => buildSeedCards(now);
const mark = (cards, n) => {let i=0; return cards.map(c => c.intro ? {...c, seenAt: ++i <= n ? now : undefined } : c);};
const intro = (over = {}) => ({
  id:'my-intro',authorId:'me',authorKind:'player',authorName:'我',
  kind:'worry',playerIntro:true,text:'我最近写论文总开不了头，想在这里慢慢试着行动。',
  createdAt:now,status:'talking',arrivals:[],plan:[],pending:[],comments:[],...over,
});

test('fresh introductions are a soft welcome, not a read-time gate', () => {
  const cards = fresh();
  assert.equal(cards.filter(c=>c.intro).length, 4);
  assert.equal(openingReadCount(cards), 0);
  assert.equal(openingStage(cards,null), 'need-intro');
  assert.equal(openingReady(cards,null), false);
  assert.equal(openingStage(mark(cards, 3), null), 'need-intro');
  assert.equal(openingStage(mark(cards, 4), null), 'need-intro');
});

test('any first player card unlocks; persona/guide cards do not', () => {
  const read = mark(fresh(),4);
  const ordinary = intro({ playerIntro:false, text:'高数第三章开不了头，想先记一下。' });
  assert.equal(openingStage([...read, ordinary], null), 'ready');
  assert.equal(openingStage([...read, intro()], null), 'ready');
  assert.equal(openingStage([...read, intro({ kind:'brag', text:'今天把第一段写完了。' })], null), 'ready');
  assert.equal(openingStage([...fresh(), intro({ authorKind:'persona' })], null), 'need-intro');
  assert.equal(openingStage([...fresh(), { ...ordinary, authorId:'shenmo', authorKind:'persona' }], null), 'need-intro');
});

test('intro validation still rejects short/crisis text', () => {
  assert.equal(validPlayerIntroText('少于十个字'),false);
  assert.equal(validPlayerIntroText('正'.repeat(2001)),false);
  assert.equal(validPlayerIntroText('最近遇到了一个难题，想在这里试试办法。'),true);
  assert.equal(validPlayerIntroText('我有自杀的冲动，不想活了。'),false);
  assert.ok(isPlayerIntro(intro()));
  assert.equal(isPlayerIntro(intro({ text:'不想活了，我要自杀' })),false);
});

test('legacy saves without all four intros are ready; an old AI goal without key is ready', () => {
  const base=fresh();
  assert.equal(openingStage([],null),'ready');
  assert.equal(openingStage(base.filter(c=>c.authorId!=='miaoze'),null),'ready');
  const goal={...intro(),authorKind:'persona',authorId:'shenmo',playerIntro:undefined,kind:'goal',goalId:'old-goal'};
  assert.equal(openingStage([...base,goal],null),'ready');
  assert.equal(openingStage([...base,goal],'need-intro'),'need-intro');
});

test('opening localStorage key reads/writes and reset removes only its key', () => {
  const oldStorage=global.localStorage;
  const data=new Map();
  global.localStorage={getItem:(key)=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:(key)=>data.delete(key)};
  try {
    persistOpeningStage('need-intro');
    assert.equal(data.get(OPENING_GATE_KEY),'need-intro');
    assert.equal(readOpeningGate(),'need-intro');
    persistOpeningStage('ready');
    assert.equal(data.get(OPENING_GATE_KEY),'done');
    assert.equal(readOpeningGate(),'ready');
    clearOpeningStage();
    assert.equal(readOpeningGate(),null);
  } finally { global.localStorage=oldStorage; }
});

test('duplicate introductions cannot inflate the welcome state',()=>{
  const cards=fresh();
  const repeated=[cards[1],...cards,cards[2]];
  assert.equal(openingIntroCards(repeated).length,4);
  assert.equal(openingReadCount(repeated),0);
});

test('store import sanitizer retains only one valid self-introduction, no injected jobs',()=>{
  const {normalizeCardRows} = lib('store');
  const a=intro({id:'first',createdAt:now-1000,plan:[{personaId:'shenmo',at:now} ],pending:[{personaId:'miaoze',phase:'reply',at:now}],helperAt:now, arrivals:['weini'], noMemory:false, pendingBrag:{personaId:'shenmo',dueAt:now,acceptedAt:now,adviceText:'x'}});
  const b=intro({id:'second',createdAt:now});
  const fake=intro({id:'fake',authorId:'yanggao'});
  const invalid=intro({id:'bad',text:'不想活了'});
  const prefixShort=intro({id:'prefix-short',text:'【AI 虚构剧情】短'});
  const rows=normalizeCardRows([b,fake,a,invalid,prefixShort]);
  assert.equal(rows.filter(c=>c.playerIntro).length,1);
  assert.equal(rows.find(c=>c.playerIntro).id,'first');
  assert.equal(rows.find(c=>c.id==='first').plan.length,0);
  assert.equal(rows.find(c=>c.id==='first').pending.length,0);
  assert.equal(rows.find(c=>c.id==='first').helperAt,undefined);
  assert.equal(rows.find(c=>c.id==='first').pendingBrag,undefined);
  assert.deepEqual(rows.find(c=>c.id==='first').arrivals,[]);
  assert.equal(rows.find(c=>c.id==='first').noMemory,true);
  assert.equal(rows.some(c=>c.id==='fake' && c.playerIntro),false);
  assert.equal(rows.find(c=>c.id==='prefix-short').playerIntro,false);
});

test('App offers a first-card entry and an admin skip instead of a hard gate',()=>{
  const {readFileSync}=require('node:fs'); const {join}=require('node:path');
  const app=readFileSync(join(__dirname,'..','src','App.tsx'),'utf8');
  assert.match(app,/写第一张卡/);
  assert.match(app,/跳过开场/);
  assert.match(app,/onSkipOpening=\{skipOpening\}/);
  assert.doesNotMatch(app,/先点开四张同伴介绍卡/);
});
