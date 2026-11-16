/**
 * 运行：npm install && npm run test:review
 * 使用项目已有的 typescript 开发依赖，无需额外测试框架。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(result.outputText, filename);
};
const load = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const dialogue = load('dialogue');
const { auditSocial, auditCriticalContent } = load('baseline');
const { addMemory } = load('memory');
const { defaultPersonas } = load('personas');
const { tickCards, addPlayerComment, askForAdvice, shrinkAdvice, notePlayerShare } = load('cards');
const { streamChat, testConnection } = load('llm');

const now = 1_800_000_000_000;
const personas = () => defaultPersonas().map((p) => ({ ...p, intimacy: 70, memory: [], weekLog: [] }));
const settings = () => ({
  paused: false, maxArrivals: 2, aiCardLimit: 4, dailyCalls: 20,
  maxCallsPerTick: 3, speed: 6, baselineExtra: '',
});
const mock = { providerId: 'mock', baseUrl: '', model: '', apiKey: '' };
const live = { providerId: 'compatible', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test-key' };
const seedCard = (id, authorId) => ({
  id, authorId, authorKind: 'persona', authorName: authorId,
  text: '论文要交了，我还没动。', createdAt: now,
  status: 'handled', arrivals: [], plan: [], pending: [], comments: [],
});
const filler = () => ['shenmo', 'weini', 'miaoze'].map((id, i) => seedCard(`f${i}`, id));
const jobCard = ({id='target', text='论文一个字写不出来', playerText='你好', kind='comment', phase='reply', source='u1', messages}={}) => ({
  id, authorId:'yanggao', authorName:'杨槔', authorKind:'persona', text,
  createdAt:now, status:'talking', arrivals:[],plan:[],
  comments: messages ?? [{id:source,authorId:'me',authorKind:'player',text:playerText,kind,at:now-2000}],
  pending:[{personaId:'yanggao', at:now-1000, phase, sourceCommentId:source}],
});
const runTick = (target, config=mock) => tickCards({cards:[target,...filler()], personas:personas(), settings:settings(), config, now});
const modelResult = (content) => new Response(JSON.stringify({choices:[{message:{content}}]}), {status:200,headers:{'content-type':'application/json'}});

const invitations = [
  '那周末一起吃饭吧？我请你', '下次我去你们学校找你吃饭吧', '我们都聊这么久了，周末见一面吧',
  '改天有空聚聚', '有机会来找我玩', '到了再说', '到时候联系我', '路过了先跟我说',
  '我们去校门口见面', '一起下楼', '有空出来喝咖啡', '加你微信吧', '给我个vx', '留个电话号码',
  '交换联系方式', '面基一下', '线下见吧', '你去我们学校找我',
];
const negatives = [
  '你好', '小美女，你好呀', '额', '？', '哈哈', '我周末去了学校食堂',
  '我们只是网上的吧友', '我只是想在网上聊，不见面', '我不想见面', '论文一个字写不出来',
  '室友约我一起吃饭，我没有去',
];

for (const text of invitations) {
  test(`识别线下或联系方式请求：${text}`, () => {
    assert.equal(dialogue.isOfflineInvite(text), true);
  });
}
for (const text of negatives) {
  test(`不误判正常文字：${text}`, () => {
    assert.equal(dialogue.isOfflineInvite(text), false);
  });
}

test('拒绝词不能被作为安全通行证', () => {
  assert.equal(dialogue.hasBoundaryCue('先不见面，不过到了以后联系我吧'), true);
  assert.ok(auditSocial('先不见面，不过到了以后联系我吧'));
});

test('四个人、各三档边界回复均明确拒绝，且不安排线下', () => {
  for (const p of personas()) for (const count of [1,2,3]) {
    for (const seed of [0,1]) {
      const reply = dialogue.mockBoundaryReply(p,count,seed);
      assert.ok(/(?:不能|不约|不安排|不了|没法|不行|不会|见不了|不再讨论|不往下聊|不成立)/.test(reply), `${p.name} ${count}: ${reply}`);
      assert.ok(/(?:线上|论坛|帖子里|AI)/.test(reply), reply);
      assert.ok(!/(?:到了(?:再|就)?(?:联系|跟我说)|先跟我说|来找我|来我学校|加个微信|微信号[:：]|(?:周末|下次)见)/.test(reply), reply);
    }
  }
});

test('重复施压时升级边界，不进入安排', async () => {
  const messages = [
    {id:'a',authorId:'me',authorKind:'player',text:'周末见一面吧',at:now-3000},
    {id:'b',authorId:'me',authorKind:'player',text:'我们都聊这么久了，改天聚聚',at:now-2000},
    {id:'c',authorId:'me',authorKind:'player',text:'真不能吗？下周约饭',at:now-1000},
  ];
  const result = await runTick(jobCard({source:'c',messages}));
  const reply = result.cards[0].comments.at(-1);
  assert.equal(reply.origin,'boundary');
  assert.match(reply.text,/不再|不会继续|不往下聊/);
  assert.equal(result.calls,0);
});

test('演示模式也必须硬拒绝，不调用模型', async () => {
  const result = await runTick(jobCard({playerText:'下次我去你们学校找你吃饭吧'}));
  const reply = result.cards[0].comments.at(-1);
  assert.equal(reply.origin,'boundary');
  assert.match(reply.text,/AI/);
  assert.equal(result.calls,0);
});

test('旧邀请不会把后来正常回复变成拒绝', async () => {
  const messages = [
    {id:'old',authorId:'me',authorKind:'player',text:'周末一起吃饭吧',at:now-2000},
    {id:'new',authorId:'me',authorKind:'player',text:'额',at:now-1000},
  ];
  const result = await runTick(jobCard({source:'new',messages}));
  const reply = result.cards[0].comments.at(-1);
  assert.equal(reply.origin,'demo');
  assert.doesNotMatch(reply.text,/线下|见面|联系方式/);
});

test('待回复任务绑定触发评论，新增评论不改变原任务的意图', async () => {
  const messages = [
    {id:'first',authorId:'me',authorKind:'player',text:'周末一起吃饭吧',at:now-2000},
    {id:'later',authorId:'me',authorKind:'player',text:'额',at:now-1000},
  ];
  const result = await runTick(jobCard({source:'first',messages}));
  assert.equal(result.cards[0].comments.at(-1).origin,'boundary');
});

test('底层直接加入危机评论时不能生成评论和待回复', () => {
  const before=jobCard({messages:[],source:'u1'});
  before.pending=[];
  const after=addPlayerComment(before,'我想自杀', now);
  assert.equal(after,before);
  assert.equal(after.comments.length,0);
  assert.equal(after.pending.length,0);
});

test('待回复项保存 sourceCommentId', () => {
  const before=jobCard({messages:[]});before.pending=[];
  const after=addPlayerComment(before,'论文写不出来',now,6,'comment','yanggao');
  assert.equal(after.pending[0].sourceCommentId,after.comments[0].id);
});

test('来源标识：真实模型安全回复被保留', async () => {
  const before=global.fetch;
  global.fetch=async()=>modelResult('嗯，论文第一段卡住确实难。你先说说哪句最难。');
  try {
    const result=await runTick(jobCard({playerText:'论文写不出来'}),live);
    const comment=result.cards[0].comments.at(-1);
    assert.equal(comment.origin,'model');
    assert.equal(result.calls,1);
  } finally {global.fetch=before;}
});

test('模型主动约线下会被后置审查拦截', async () => {
  const before=global.fetch;
  global.fetch=async()=>modelResult('改天有空我们聚聚吧，到了再联系我。');
  try {
    const result=await runTick(jobCard({playerText:'论文写不出来'}),live);
    const comment=result.cards[0].comments.at(-1);
    assert.equal(comment.origin,'boundary');
    assert.doesNotMatch(comment.text,/到了再联系/);
  } finally {global.fetch=before;}
});

test('模型诊断及用药建议被后置审查拦截', async () => {
  const before=global.fetch;
  global.fetch=async()=>modelResult('你得了抑郁症，别吃药了。');
  try {
    const result=await runTick(jobCard({playerText:'最近心情低落'}),live);
    const comment=result.cards[0].comments.at(-1);
    assert.equal(comment.origin,'curated');
    assert.doesNotMatch(comment.text,/抑郁症|吃药/);
    assert.ok(auditCriticalContent('你得了抑郁症'));
  } finally {global.fetch=before;}
});

test('线下邀请在真实模式也不调用 API', async () => {
  const before=global.fetch;let requests=0;
  global.fetch=async()=>{requests++;throw new Error('should never call')};
  try {
    const result=await runTick(jobCard({playerText:'改天有空聚聚'}),live);
    assert.equal(requests,0);
    assert.equal(result.cards[0].comments.at(-1).origin,'boundary');
  } finally {global.fetch=before;}
});

test('真实 API 故障不伪装为 persona 回复，也不更新到场/记忆', async () => {
  const before=global.fetch;
  global.fetch=async()=>{throw new TypeError('offline')};
  try {
    const card=jobCard({playerText:'论文开头卡了'});
    const result=await runTick(card,live);
    assert.equal(result.cards[0].comments.at(-1).origin,'system');
    assert.match(result.cards[0].comments.at(-1).text,/没有使用演示台词/);
    assert.equal(result.cards[0].comments.filter((c)=>c.authorKind==='persona').length,0);
    assert.equal(result.personas.find((p)=>p.id==='yanggao').memory.length,0);
  } finally {global.fetch=before;}
});

test('AI 必须拒绝玩家提议的现实见面，即使演示模式', async () => {
  const result=await runTick(jobCard({kind:'advice',phase:'decide',playerText:'你去我们学校找我，我们当面聊'}));
  const card=result.cards[0];
  assert.equal(card.comments.at(-1).origin,'boundary');
  assert.ok(!card.advice?.accepted);
});

test('AI 拒绝模型生成的危险建议决定', async () => {
  const before=global.fetch;
  global.fetch=async()=>modelResult('接受|我们线下见一面，到了联系我');
  try {
    const result=await runTick(jobCard({kind:'advice',phase:'decide',playerText:'把岗位描述打开读第一段'}),live);
    assert.equal(result.cards[0].comments.at(-1).origin,'boundary');
    assert.ok(!result.cards[0].advice?.accepted);
  } finally {global.fetch=before;}
});

test('动作编号被采用且缩小保持同一条链', async () => {
  const before=global.fetch;
  global.fetch=async()=>modelResult('draft-3');
  try {
    const card=jobCard({playerText:'论文开头卡了'});
    card.arrivals=['yanggao'];card.pending=[];
    const result=await askForAdvice({cardId:card.id,cards:[card],personas:personas(),settings:settings(),config:live,now});
    const advice=result.cards[0].advice;
    assert.equal(advice.actionId,'draft-3');
    assert.equal(advice.origin,'curated');
    assert.equal(advice.text,'我会先把文档打开，只写标题和三个小标题，正文先不管。');
    assert.equal(shrinkAdvice(result.cards[0],now+1).advice.actionId,'draft-2');
  } finally {global.fetch=before;}
});

test('同一帖子记忆去重，其它帖子内容可以保留', () => {
  let memory=[];
  const sample={at:now,about:'你',what:'论文 卡住',weight:'deep',postId:'same'};
  memory=addMemory(memory,sample,now);
  memory=addMemory(memory,{...sample,what:'论文  卡住'},now+1);
  assert.equal(memory.length,1);
  memory=addMemory(memory,{...sample,postId:'different'},now+2);
  assert.equal(memory.length,2);
});

test('SSE 支持跨 chunk 的 UTF-8 和最后一帧无换行', async () => {
  const before=global.fetch;
  const encoder=new TextEncoder();
  const payload=encoder.encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n' +
                               'data: {"choices":[{"delta":{"content":"，世界"}}]}');
  const chunks=[payload.slice(0,23),payload.slice(23,45),payload.slice(45,52),payload.slice(52)];
  global.fetch=async()=>new Response(new ReadableStream({start(c){for(const chunk of chunks)c.enqueue(chunk);c.close();}}),{headers:{'content-type':'text/event-stream'}});
  try {
    const result=await streamChat({config:live,messages:[{role:'user',content:'hi'}],signal:new AbortController().signal,onDelta:()=>{}});
    assert.equal(result,'你好，世界');
  } finally {global.fetch=before;}
});

test('空 content 不应被报告为连接成功', async () => {
  const before=global.fetch;
  global.fetch=async()=>modelResult('');
  try {
    await assert.rejects(()=>testConnection(live),/模型没有返回文字/);
  } finally {global.fetch=before;}
});


test('关系增量只作用于真正看见重度分享的同伴，旧调用不再全员加分', async () => {
  const residents = personas();
  const unchanged = notePlayerShare(residents, '我最近分手了，难过', []);
  assert.deepEqual(unchanged.map((p) => p.intimacy), residents.map((p) => p.intimacy));
  const onlyOne = notePlayerShare(residents, '我最近分手了，难过', ['shenmo']);
  assert.equal(onlyOne.find((p) => p.id === 'shenmo').intimacy, 76);
  assert.equal(onlyOne.find((p) => p.id === 'weini').intimacy, 70);

  const card = {
    ...jobCard({text:'我最近分手了，实在难过',messages:[]}),
    authorId:'me',authorKind:'player',authorName:'你',status:'stuck',
    plan:[{personaId:'shenmo',at:now-1}],pending:[],comments:[],arrivals:[],
  };
  const result=await runTick(card);
  assert.equal(result.personas.find((p)=>p.id==='shenmo').intimacy,76);
  assert.equal(result.personas.find((p)=>p.id==='weini').intimacy,70);
});

test('玩家主帖直接邀请线下，多个 AI 先后到场都必须走边界回复', async () => {
  const card={
    ...jobCard({text:'周末一起吃饭吧',messages:[]}),
    authorId:'me',authorKind:'player',authorName:'你',status:'stuck',
    plan:[{personaId:'shenmo',at:now-1},{personaId:'weini',at:now-1}],
    pending:[],comments:[],arrivals:[],
  };
  const result=await runTick(card);
  assert.equal(result.calls,0);
  assert.equal(result.cards[0].comments.filter((c)=>c.authorKind==='persona').length,2);
  assert.ok(result.cards[0].comments.filter((c)=>c.authorKind==='persona').every((c)=>c.origin==='boundary'));
});


test('模型失败后待回复任务保留并延迟重试，成功后不再重试', async () => {
  const before=global.fetch;
  let requests=0;
  global.fetch=async()=>{requests++; if(requests===1) throw new TypeError('offline');return modelResult('我在，先看看开头那一段。');};
  try {
    const first=await runTick(jobCard({playerText:'论文写不出来'}),live);
    assert.equal(first.cards[0].pending.length,1);
    assert.equal(first.cards[0].pending[0].attempt,1);
    assert.equal(first.cards[0].pending[0].at,now+30000);
    const second=await tickCards({cards:first.cards,personas:first.personas,settings:settings(),config:live,now:now+30001});
    assert.equal(second.cards[0].pending.length,0);
    assert.equal(second.cards[0].comments.at(-1).origin,'model');
    assert.equal(requests,2);
  } finally {global.fetch=before;}
});

test('模型持续失败最多重试两次，既不算到场也不重复加记忆', async () => {
  const before=global.fetch;
  let requests=0;
  global.fetch=async()=>{requests++;throw new TypeError('offline')};
  try {
    const card={
      ...jobCard({messages:[],source:'u1'}),
      authorId:'me',authorKind:'player',authorName:'你',status:'stuck',
      plan:[{personaId:'shenmo',at:now-1}],pending:[],comments:[],arrivals:[],
    };
    let state={cards:[card,...filler()],personas:personas(),settings:settings(),config:live,now};
    for (const [i,t] of [now,now+30001,now+120002].entries()) {
      const next=await tickCards({...state,now:t});
      const result=next.cards[0];
      assert.equal(result.arrivals.length,0);
      assert.equal(next.personas.find((p)=>p.id==='shenmo').memory.length,0);
      assert.equal(result.plan.length,i===2?0:1);
      state={...state,cards:next.cards,personas:next.personas};
    }
    assert.equal(requests>=3,true);
    assert.match(state.cards[0].comments.at(-1).text,/重试次数已用尽/);
  } finally {global.fetch=before;}
});


test('演示模式短回复严格对应触发评论而非最新加入的评论', async () => {
  const messages=[
    {id:'hello',authorId:'me',authorKind:'player',text:'你好',at:now-2000},
    {id:'noise',authorId:'me',authorKind:'player',text:'额',at:now-1000},
  ];
  const result=await runTick(jobCard({source:'hello',messages}));
  assert.equal(result.cards[0].comments.at(-1).origin,'demo');
  assert.match(result.cards[0].comments.at(-1).text,/你好/);
});
