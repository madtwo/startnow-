/** P0 completion response quality: deterministic provider stubs, no paid API. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, file) => {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mod._compile(code, file);
};
const lib = (name) => require(path.join(__dirname, '..', 'src', 'lib', name + '.ts'));
const { completeCard, tickCards } = lib('cards');
const { defaultSettings } = lib('store');
const { defaultPersonas } = lib('personas');
const { isGroundedCompletionReaction } = lib('completionReaction');
const { completionReactionPrompt } = lib('prompts');
const { followupTextFor, completionFixtures } = require(path.join(__dirname, '..', 'src', 'soak', 'scenarioFixtures.ts'));
const config = { providerId: 'compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'secret-is-test-only', model: 'deepseek-v4.1-flash', fallbackModel: '' };
const safe = '简历打开了。你刚才卡着没想碰的就是这一步，我病理那章也还停着。';
const sse = (line) => new Response([
  { choices: [{ delta: { content: line }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
].map((x) => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n', {
  headers: { 'content-type': 'text/event-stream' },
});
function prepared(now = Date.now(), extraHistory = true) {
  return {
    id: 'completion-test', authorId: 'me', authorKind: 'player', authorName: '测试用户',
    text: '室友昨晚玩游戏，我还没开始处理简历。', createdAt: now - 3600000,
    status: 'noted', kind: 'worry', arrivals: ['shenmo'], plan: [], pending: [],
    comments: extraHistory ? [{ id: 'old-1', authorId: 'me', authorKind: 'player', text: '我上回写汇报开头，卡在第一句。', at: now - 120000 }] : [],
    note: { text: '打开简历文件', fromPersonaId: 'shenmo', at: now - 30000, dueAt: now + 86400000 },
    advice: { text: '打开简历文件', fromPersonaId: 'shenmo', accepted: true, at: now - 30000 },
  };
}
async function runWithReplies(replies, { maxCallsPerTick = 3, history = true } = {}) {
  let count = 0;
  const requests = [];
  const orig = global.fetch;
  global.fetch = async (_, options) => {
    requests.push(JSON.parse(options.body));
    const answer = replies[Math.min(count++, replies.length - 1)];
    return answer instanceof Error ? Promise.reject(answer) : sse(answer);
  };
  try {
    const now = Date.now();
    const done = completeCard(prepared(now, history), now, 1);
    const output = await tickCards({ cards: [done], personas: defaultPersonas(), config,
      settings: { ...defaultSettings, aiCardLimit: 0, maxCallsPerTick, speed: 1 }, now: now + 120000 });
    const card = output.cards.find((c) => c.id === done.id);
    const replies = card.comments.filter((c) => c.authorKind === 'persona' && c.replyTo === done.comments.at(-1).id);
    return { done, card, replies, requests, logs: output.logs, calls: output.calls };
  } finally { global.fetch = orig; }
}

test('完成状态立即保存、模型准确承认动作，仅回复一次', async () => {
  const res = await runWithReplies([safe]);
  assert.equal(res.done.status, 'done');
  assert.equal(res.replies.length, 1);
  assert.equal(res.replies[0].origin, 'model');
  assert.equal(res.replies[0].authorId, 'shenmo');
  assert.equal(res.requests.length, 1);
  assert.equal(res.requests[0].max_tokens, 300);
});

test('完成回应 prompt 不传入过时周记/评论，仍保留角色背景和动作事实', async () => {
  const res = await runWithReplies([safe]);
  const content = res.requests[0].messages.map((row) => row.content).join('\n');
  assert.match(content, /简历文件/);
  assert.match(content, /沈默/);
  assert.doesNotMatch(content, /室友昨晚玩游戏|我上回写汇报开头|卡在第一句/);
  assert.match(content, /唯一需要回应的最新事实/);
});

test('安全但跑题的第一次生成有界重试，第二次通过即可采用模型', async () => {
  const res = await runWithReplies(['写汇报开头确实很难，我也很怕开口念。', safe]);
  assert.equal(res.requests.length, 2);
  assert.equal(res.replies[0].origin, 'model');
  assert.match(res.requests[1].messages[0].content, /独立重写/);
  assert.ok(res.logs.some((r) => /completion_retry=accepted/.test(r)));
  assert.equal(res.calls, 2);
});

test('不超过 tick API 调用配额：maxCallsPerTick=1 禁止二次尝试', async () => {
  const res = await runWithReplies(['汇报第一句我还在反复练，开头确实难。', safe], { maxCallsPerTick: 1 });
  assert.equal(res.requests.length, 1);
  assert.equal(res.replies.length, 1);
  assert.equal(res.replies[0].origin, 'simulated');
  assert.equal(res.replies[0].fallbackReason, 'invalid_action');
});

test('危险模型输出立即进入安全兜底，不重试越界回复', async () => {
  const res = await runWithReplies(['简历打开了，我们明天到你学校楼下见面，我去接你。', safe]);
  assert.equal(res.requests.length, 1);
  assert.equal(res.replies[0].origin, 'simulated');
  assert.equal(res.replies[0].fallbackReason, 'invalid_action');
});

test('拒绝把未完成/问句/指令识别成玩家已做的事', async () => {
  for (const line of ['简历还没打开，我知道你不好受。', '简历打开了吗？你想说说么。',
    '你可以先打开简历，别给自己压力。']) {
    assert.equal(isGroundedCompletionReaction(line, '打开简历'), false, line);
  }
  assert.equal(isGroundedCompletionReaction(safe, '打开简历'), true);
});

test('两次安全但偏题都失败时仍只有一条动作相关兜底', async () => {
  const res = await runWithReplies(['那个汇报开头我也会卡，别催自己。', '先把室友的事情缓一缓。']);
  assert.equal(res.requests.length, 2);
  assert.equal(res.replies.length, 1);
  assert.equal(res.replies[0].origin, 'simulated');
  assert.equal(res.replies[0].fallbackReason, 'invalid_action');
  assert.match(res.replies[0].text, /简历/);
});

test('断网后用户完成事实不撤销，保留单一兜底及原因', async () => {
  const res = await runWithReplies([new Error('connection gone')]);
  assert.equal(res.done.status, 'done');
  assert.equal(res.replies.length, 1);
  assert.equal(res.replies[0].origin, 'simulated');
  assert.ok(['network','model_error'].includes(res.replies[0].fallbackReason));
});

test('每种测试场景的追问对应自身主题，配对样本是明确虚构的动作', () => {
  assert.match(followupTextFor(7), /实验|异常值/);
  assert.match(followupTextFor(3), /简历/);
  assert.match(followupTextFor(2), /室友|耳塞/);
  assert.match(followupTextFor(15), /早课/);
  assert.ok(completionFixtures.length >= 4);
  assert.ok(completionFixtures.every((row) => row.id && row.action && row.personaId && row.trouble));
  assert.notEqual(followupTextFor(0), followupTextFor(1));
});

test('完成 prompt 同一动作、无论旧评论如何变化都保持相同内容', () => {
  const p = completionReactionPrompt('打开简历文件', '打开简历文件');
  assert.match(p, /已完成/);
  assert.doesNotMatch(p, /室友|汇报开头/);
});

test('实验记录类动作按对象与完成动作判定，不要求字面复述“写一行”', () => {
  const anchor = '写一行实验记录';
  for (const line of [
    '实验记录写好一行了，手心松了一点。',
    '这一行实验记录写下来了。',
    '把记录本翻开写了一行。',
  ]) assert.equal(isGroundedCompletionReaction(line, anchor), true, line);
  for (const line of [
    '实验记录还没写。',
    '记录一下今天的事。',
    '今天实验数据异常，你要不要先看看？',
  ]) assert.equal(isGroundedCompletionReaction(line, anchor), false, line);
});

test('新动作文案的完成回应：允许自然改写，不要求字面复述', () => {
  const ok = [
    ['草稿页打开了，先写了两行。', '打开草稿页'],
    ['规划笔记已经摊开了。', '打开规划笔记'],
    ['那个还没确定的问题写下来了。', '先写下一个还没确定的问题'],
    ['教材第一小段翻出来了。', '把教材的第一小段翻出来'],
    ['手机放到另一张桌子上了。', '先把手机放到够不着的地方'],
    ['在纸上写了一个词。', '在纸上写一个词'],
  ];
  for (const [text, anchor] of ok) assert.equal(isGroundedCompletionReaction(text, anchor), true, `${anchor} => ${text}`);
  const bad = [
    ['还没来得及写。', '在纸上写一个词'],
    ['实验记录还没写。', '写一行实验记录'],
    ['今天天气不错。', '打开草稿页'],
    ['简历还没打开。', '打开简历'],
    ['还没确定要不要打开。', '打开草稿页'],
  ];
  for (const [text, anchor] of bad) assert.equal(isGroundedCompletionReaction(text, anchor), false, `${anchor} => ${text}`);
});

test('E3 真实拒绝样本：同义改写与跨句对象也要判为完成', () => {
  const ok = [
    ['那处空白找出来了。行，空着的地方一显出来，后面填起来就没那么吓人——我这边病理还摊着没动。', '找到文档里空着的一处'],
    ['空着的那处找到了。我也该把挤到晚上的报告往里填两句了。', '找到文档里空着的一处'],
    ['那个还没想明白的问题，写下来了。行，先让它待在那儿，不用现在就急着弄懂。', '写出一个尚未确定的问题'],
    ['那个待补的括号已经标上去了，写不动的时候知道先空出来，这一步算是踩稳了。', '用括号标记一个待补内容'],
    ['那句想说的话打出来了，没发出去。这一步挺不容易的，先让它停在那里也没关系。', '拟一句想说的话但先不发送'],
  ];
  for (const [text, anchor] of ok) assert.equal(isGroundedCompletionReaction(text, anchor), true, `${anchor} => ${text}`);
  assert.equal(isGroundedCompletionReaction('简历还没打开，我先去睡了。', '打开简历'), false);
});
