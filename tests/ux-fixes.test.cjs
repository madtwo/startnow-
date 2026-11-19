/** 2026-11-18 体验修复：默认摘要压缩、答错对象守卫、每 3 小时一张、模糊安慰建议不排炫耀。 */
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  mod._compile(result.outputText, filename);
};
const load = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));

const { tickCards } = load('cards');
const { defaultPersonas } = load('personas');
const { defaultSettings } = load('store');
const { isVagueComfortAdvice } = load('brag');

const mock = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };
const now = 1_800_000_000_000;
const HOUR = 3_600_000;
let seq = 0;
const cardBase = (over = {}) => ({
  id: `c${++seq}`, authorId: 'me', authorName: '你', authorKind: 'player', kind: 'worry',
  text: '论文写不出来', createdAt: now - 60_000, status: 'talking',
  arrivals: [], plan: [], pending: [], comments: [], ...over,
});

test('上下文压缩默认是摘要，不是截断', () => {
  for (const persona of defaultPersonas()) {
    assert.equal(persona.memoryMode, 'summary', `${persona.name} 默认应为摘要压缩`);
  }
});

test('回复给别人的话，其他同伴不抢答', async () => {
  const card = cardBase({
    comments: [
      { id: 'ask', authorId: 'me', authorKind: 'player', text: '是什么报告呀', peer: 'weini', at: now - 1000 },
    ],
    pending: [
      { personaId: 'miaoze', at: now - 1, phase: 'reply' },
      { personaId: 'weini', at: now - 1, phase: 'reply' },
    ],
  });
  const settings = { ...defaultSettings, aiCardLimit: 0 };
  const first = await tickCards({ cards: [card], personas: defaultPersonas(), settings, config: mock, now });
  const second = await tickCards({
    cards: first.cards, personas: first.personas, settings, config: mock, now: now + 1,
  });
  const box = second.cards[0];
  const miaoze = box.comments.filter((c) => c.authorId === 'miaoze');
  const weini = box.comments.filter((c) => c.authorId === 'weini');
  assert.equal(miaoze.length, 0, '苗泽不该回答点给魏霓的话');
  assert.equal(weini.length, 1, '魏霓应当回应点给自己的话');
});

test('默认额度 8：新烦恼卡约每 3 小时一张', async () => {
  const settings = { ...defaultSettings, aiCardLimit: 8 };
  let cards = [];
  let personas = defaultPersonas();
  const tick = async (at) => {
    const out = await tickCards({ cards, personas, settings, config: mock, now: at });
    cards = out.cards; personas = out.personas;
    return out;
  };
  await tick(now);
  const first = cards.filter((c) => c.authorKind === 'persona' && !c.intro && c.kind !== 'brag').length;
  assert.equal(first, 1);
  await tick(now + HOUR);
  assert.equal(cards.filter((c) => c.authorKind === 'persona' && !c.intro && c.kind !== 'brag').length, 1, '1 小时后不应再发');
  await tick(now + 3 * HOUR + 1000);
  assert.equal(cards.filter((c) => c.authorKind === 'persona' && !c.intro && c.kind !== 'brag').length, 2, '3 小时后应有新卡');
});

test('纯安慰类建议不会被当成可执行下一步，也不会排炫耀', async () => {
  assert.equal(isVagueComfortAdvice('摸摸楼主，先休息一下，陪朋友聊聊天吧'), true);
  assert.equal(isVagueComfortAdvice('先打开招聘页面，只看要求'), false);
  const card = cardBase({
    authorId: 'weini', authorName: '魏霓', authorKind: 'persona',
    text: '下周要讲四分钟汇报，我一想到就胃紧',
    status: 'talking',
    comments: [
      { id: 'a1', authorId: 'me', authorKind: 'player', kind: 'advice', text: '摸摸楼主，先休息一下，陪朋友聊聊天吧', at: now - 1000, peer: 'weini' },
    ],
    pending: [{ personaId: 'weini', at: now - 1, phase: 'decide', sourceCommentId: 'a1' }],
  });
  const out = await tickCards({
    cards: [card], personas: defaultPersonas(), settings: { ...defaultSettings, aiCardLimit: 0 }, config: mock, now,
  });
  const box = out.cards[0];
  assert.equal(box.advice?.accepted, undefined, '不应接受纯安慰建议');
  assert.equal(box.pendingBrag, undefined, '不应排炫耀');
  const last = box.comments.at(-1);
  assert.equal(last.authorId, 'weini');
  assert.match(last.text, /具体|动作/);
});
