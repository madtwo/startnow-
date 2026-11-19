/** Round 4: grounded completion reactions and isolated author brag demo. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, file) => {
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
};
const load = (file) => require(path.join(__dirname, '..', 'src', 'lib', `${file}.ts`));
const { completeCard, tickCards } = load('cards');
const { defaultPersonas } = load('personas');
const { defaultSettings, exportBundle, importBundle } = load('store');
const { scheduleAcceptedBrag, triggerNextBrag } = load('brag');
const { createOperationGate } = load('operationGate');
const {
  completedActionAnchor, isGroundedCompletionReaction,
  fallbackCompletionReaction, unsafeCompletionReaction,
} = load('completionReaction');

const now = Date.now() - 600_000;
const mock = { providerId: 'mock', model: 'demo', apiKey: '', baseUrl: '' };
const live = { providerId: 'compatible', model: 'local-test', apiKey: 'sample', baseUrl: 'https://example.test/v1' };
const settings = { ...defaultSettings, aiCardLimit: 0, dailyCalls: 10, maxCallsPerTick: 2, speed: 6 };
const people = defaultPersonas();
const who = (id) => people.find((p) => p.id === id);

const cardWithNote = (personaId='shenmo', action='打开简历文件', actionId) => ({
  id: `mine-${personaId}`, authorId: 'me', authorName: '用户', authorKind: 'player', kind: 'worry',
  text: '我一直不敢碰简历，今天打算先打开文件。', createdAt: now - 15_000,
  status: 'noted', arrivals: [personaId], plan: [], pending: [],
  comments: [{ id: 'original-reply', authorId: personaId, authorKind: 'persona', text: '先看一眼文件', at: now - 5000 }],
  advice: { text: action, actionId, fromPersonaId: personaId, accepted: true, at: now - 1000 },
  note: { text: action, actionId, fromPersonaId: personaId, at: now - 1000, dueAt: now + 86_400_000 },
});

const runReaction = async (card, config=mock) => {
  const at = Math.max(now + 1000, ...card.pending.map((row) => row.at + 1000));
  return tickCards({ cards: [card], personas: people, settings, config, now: at });
};
const modelResult = (content) => new Response(JSON.stringify({choices:[{message:{content}}]}),
  {status:200, headers:{'content-type':'application/json'}});

for (const p of people.slice(0,4)) {
  test(`演示兜底明确锚定玩家刚做的动作，且 ${p.name} 有独立语气`, async () => {
    const done = completeCard(cardWithNote(p.id), now);
    assert.equal(done.status, 'done');
    assert.equal(done.pending.length, 1, '同一完成事件只安排一条主回应');
    const completion = done.comments.find((c) => c.text.startsWith('做到了：'));
    const out = await runReaction(done);
    const response = out.cards[0].comments.at(-1);
    assert.equal(response.authorId, p.id);
    assert.equal(response.origin, 'simulated');
    assert.match(response.text, /打开简历/);
    assert.equal(response.replyTo, completion.id);
    assert.equal(out.calls, 0);
    assert.equal(out.cards[0].pending.length, 0);
    const again = await tickCards({cards: out.cards, personas: out.personas, settings, config:mock, now:now+20_000});
    assert.equal(again.cards[0].comments.length, out.cards[0].comments.length, '重复 tick 不产生第二条完成反应');
  });
}

test('两个不同动作的回退必须有不同的具体内容，不能是换个形容词', () => {
  const a = fallbackCompletionReaction(who('shenmo'), completedActionAnchor(cardWithNote('shenmo', '打开简历文件').note));
  const b = fallbackCompletionReaction(who('shenmo'), completedActionAnchor(cardWithNote('shenmo', '倒一杯水').note));
  assert.match(a, /简历/);
  assert.match(b, /水/);
  assert.notEqual(a, b);
  assert.equal(unsafeCompletionReaction(a), false);
  assert.equal(unsafeCompletionReaction(b), false);
});

test('预置动作采用 actionId 对应的动作标签，而非建议中的整段口头话', () => {
  const note = { text: '我复习不进去就把书翻开，不用看完。', actionId: 'book-2', fromPersonaId:'shenmo', at:now, dueAt:now+10000 };
  assert.match(completedActionAnchor(note), /只把书翻开/);
  assert.doesNotMatch(completedActionAnchor(note), /我复习不进去/);
});

test('模型正常：一次短调用、具体锚点、不额外强制小任务', async () => {
  const prev = global.fetch;
  let n = 0, payload;
  global.fetch = async (_url, opts) => {
    n++; payload=JSON.parse(opts.body);
    return modelResult('简历打开了。我的病理第三章还在等我，今天不催你再改了。');
  };
  try {
    const done = completeCard(cardWithNote(), now);
    const out = await runReaction(done, live);
    assert.equal(n, 1);
    assert.equal(out.calls, 1);
    assert.equal(out.cards[0].status, 'done');
    assert.equal(out.cards[0].comments.at(-1).origin, 'model');
    assert.match(out.cards[0].comments.at(-1).text, /简历打开/);
    assert.match(JSON.stringify(payload.messages), /打开简历/);
    assert.ok(payload.max_tokens <= 300, '短模型调用节省令牌');
    const again = await tickCards({cards:out.cards, personas:out.personas, settings, config:live, now:now+300000});
    assert.equal(again.cards[0].comments.length, out.cards[0].comments.length);
  } finally { global.fetch = prev; }
});

test('模型无锚点、模板赞美、越界内容均不进入评论，保留完成状态', async () => {
  const prev = global.fetch;
  try {
    for (const content of ['真棒，挺好的，继续加油。', '我在你宿舍楼下等你一起去操场。', '我保证明天肯定会好起来。']) {
      global.fetch = async () => modelResult(content);
      const out = await runReaction(completeCard(cardWithNote(), now), live);
      assert.equal(out.calls, 1);
      assert.equal(out.cards[0].status, 'done');
      const last = out.cards[0].comments.at(-1);
      assert.equal(last.origin, 'simulated');
      assert.match(last.text, /简历/);
      assert.equal(unsafeCompletionReaction(last.text), false);
    }
  } finally { global.fetch = prev; }
});

test('网络故障不回滚完成、不重试轰炸，也不把网络报错当角色台词', async () => {
  const prev=global.fetch;
  let n=0;
  global.fetch=async()=>{n++;throw new TypeError('offline')};
  try {
    const done=completeCard(cardWithNote(),now);
    const out=await runReaction(done,live);
    assert.equal(n,1);
    assert.equal(out.cards[0].status,'done');
    assert.equal(out.cards[0].comments.at(-1).origin,'simulated');
    assert.doesNotMatch(out.cards[0].comments.at(-1).text,/offline|错误|网络/);
    assert.equal(out.cards[0].pending.length,0);
    assert.match(out.logs.join(' '),/模型不可用/);
  } finally {global.fetch=prev;}
});

test('重复点击我做到了没有第二条完成事件、不会再安排第二次反应', () => {
  const one=completeCard(cardWithNote(),now);
  assert.equal(completeCard(one,now+100),one);
  assert.equal(one.comments.filter((c)=>c.text.startsWith('做到了：')).length,1);
  assert.equal(one.pending.length,1);
});

test('动作锚定器不允许无锚点或带安全红线的文本冒充模型成功', () => {
  assert.equal(isGroundedCompletionReaction('嗯，挺好的。', '打开简历'),false);
  assert.equal(isGroundedCompletionReaction('简历打开了，我还在想病理第三章。', '打开简历'),true);
  assert.equal(isGroundedCompletionReaction('简历打开了，我在你学校楼下。', '打开简历'),false);
  assert.equal(isGroundedCompletionReaction('简历打开了，你只需要我。', '打开简历'),false);
  assert.equal(completedActionAnchor({text:'加我微信号',fromPersonaId:'yanggao',at:now,dueAt:now+10000}), '刚才那件小事');
});


test('角色排序：原建议人先到，只回应一次，玩家完成不新建炫耀卡', async () => {
  const c=cardWithNote('weini');
  c.arrivals=['yanggao','shenmo','miaoze'];
  const done=completeCard(c,now);
  assert.equal(done.status,'done');
  // 一次完成事件只排一条主回应，且绑定完成评论，便于去重。
  assert.deepEqual(done.pending.map((p)=>p.personaId),['weini']);
  const completionId=done.comments.at(-1).id;
  assert.equal(done.comments.at(-1).text.startsWith('做到了：'),true);
  assert.equal(done.pending[0].sourceCommentId,completionId);
  const first=await tickCards({cards:[done],personas:people,settings,config:mock,now:done.pending[0].at+1});
  const after=first.cards[0];
  assert.equal(after.comments.at(-1).authorId,'weini');
  assert.equal(after.comments.filter((x)=>x.replyTo===completionId).length,1);
  assert.equal(after.pending.length,0);
  assert.ok(first.cards.every((x)=>x.kind!=='brag'));
  const last=await tickCards({cards:first.cards,personas:first.personas,settings,config:mock,now:now+60000});
  // 模拟模式只给一条模拟兜底，不应出现第二条完成回应。
  assert.equal(last.cards[0].comments.filter((x)=>x.origin==='simulated').length,1);
  assert.ok(last.cards.every((x)=>x.kind!=='brag'));
});

test('回执修复：命令式原便签不能被包装成已完成动作', () => {
  const note = {text:'你应该先把简历改完',fromPersonaId:'shenmo',at:now,dueAt:now+10000};
  assert.equal(completedActionAnchor(note), '刚才那件小事');
  assert.doesNotMatch(fallbackCompletionReaction(who('shenmo'), completedActionAnchor(note)), /你应该|改完/);
});

test('回执修复：只提到物件、否定完成或假设完成都不能冒充成功', () => {
  const anchor = '打开简历';
  for (const line of [
    '简历还是没打开，我一点也不想想它。',
    '你还没打开简历，别着急继续做其他的。',
    '我刚刚打开了简历，你就先休息一会儿。',
    '如果你已经打开简历，那就可以继续修改了。',
    '你可以把简历打开了，今天就不必再继续改。',
    '先把简历打开了就好，其他的不用急。',
    '简历已经改完了，你可以继续休息了。',
    '简历还没打开。简历打开了，我没在催你。',
    '简历这事我还没有开始做，明天再说吧。',
  ]) assert.equal(isGroundedCompletionReaction(line, anchor), false, line);
  for (const line of [
    '你已经把简历打开了，今天先停在这里就好。',
    '简历打开了。我的病理第三章还在等我。',
  ]) assert.equal(isGroundedCompletionReaction(line, anchor), true, line);
  assert.equal(isGroundedCompletionReaction('水倒好了，今天这一步已经算数了。', '倒一杯水'), true);
  assert.equal(isGroundedCompletionReaction('这句话写下来了，已经算做过这一步。', '写一句话'), true);
});

test('回执修复：真实模型说没做完时保留 done 并走模拟兜底', async () => {
  const prev = global.fetch;
  global.fetch = async () => modelResult('简历还是没打开，今天先不要碰它了。');
  try {
    const done = completeCard(cardWithNote(), now);
    const out = await runReaction(done, live);
    assert.equal(out.cards[0].status, 'done');
    assert.equal(out.cards[0].comments.at(-1).origin, 'simulated');
    assert.match(out.cards[0].comments.at(-1).text, /简历/);
  } finally { global.fetch = prev; }
});
