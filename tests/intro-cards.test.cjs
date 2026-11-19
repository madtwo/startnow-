/** 2026-11-18：开场自我介绍卡必须写清 学校-专业-年级-MBTI；
 * 卡下的回复只打招呼，不按烦恼安慰，也不追问别人的具体信息。
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  mod._compile(result.outputText, filename);
};

const load = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const { buildSeedCards } = load('seed');
const { defaultPersonas } = load('personas');
const { defaultSettings } = load('store');
const { commentPrompt } = load('prompts');
const { tickCards } = load('cards');

const mock = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };
const now = 1_800_000_000_000;
const comfortWords = /辛苦|抱抱|心疼|会好的|加油|你已经很棒|别难受|慢慢来|我懂你|先别急/;
const greeting = /欢迎|你好|嗨|哈喽|眼熟|报到|打招呼/;
const question = /？|\?/;

test('四张自我介绍卡写清学校、专业、年级和 MBTI', () => {
  const cards = buildSeedCards(now).filter((c) => c.intro);
  assert.equal(cards.length, 4);
  for (const card of cards) {
    const persona = defaultPersonas().find((p) => p.id === card.authorId);
    assert.ok(persona, `缺少角色 ${card.authorId}`);
    assert.ok(persona.mbti && /^[EI][NS][TF][JP]$/.test(persona.mbti), `${persona.name} 的 MBTI 不合法`);
    for (const part of [persona.school, persona.major, persona.cohort, persona.mbti]) {
      assert.ok(card.text.includes(part), `${persona.name} 的自我介绍缺少「${part}」`);
    }
  }
});

test('开场回复只打招呼，不按烦恼安慰，也不追问具体信息', () => {
  for (const card of buildSeedCards(now).filter((c) => c.intro)) {
    assert.ok(card.comments.length >= 1, `${card.authorName} 的介绍卡没有回复`);
    for (const row of card.comments) {
      if (row.authorKind !== 'persona') continue;
      assert.ok(!comfortWords.test(row.text), `开场回复出现安慰口吻：${row.text}`);
      assert.ok(greeting.test(row.text), `开场回复不是打招呼：${row.text}`);
      assert.ok(!question.test(row.text), `开场回复在追问具体信息：${row.text}`);
    }
  }
});

test('真实模型提示词把介绍卡标成非求助，只打招呼不追问', () => {
  const card = buildSeedCards(now).find((c) => c.intro);
  const persona = defaultPersonas().find((p) => p.id !== card.authorId);
  const prompt = commentPrompt(card, persona);
  assert.match(prompt, /自我介绍卡/);
  assert.match(prompt, /不要安慰/);
  assert.match(prompt, /不要追问/);
  assert.match(prompt, /打招呼/);
});

test('演示模式对介绍卡也只打招呼', async () => {
  const base = buildSeedCards(now).find((c) => c.intro);
  const responder = defaultPersonas().find((p) => p.id !== base.authorId);
  const card = {
    ...base,
    pending: [{ personaId: responder.id, at: now - 1, phase: 'reply' }],
  };
  const out = await tickCards({
    cards: [card], personas: defaultPersonas(), settings: defaultSettings, config: mock, now,
  });
  const fresh = out.cards[0].comments.filter((x) => x.authorId === responder.id && x.at === now);
  assert.equal(fresh.length, 1, '介绍卡应收到一条新的同伴回复');
  const text = fresh[0].text;
  assert.ok(greeting.test(text), `演示回复不是打招呼：${text}`);
  assert.ok(!question.test(text), `演示回复在追问具体信息：${text}`);
  assert.ok(!comfortWords.test(text), `演示回复出现安慰口吻：${text}`);
});
