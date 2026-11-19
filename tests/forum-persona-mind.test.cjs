const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  mod._compile(compiled, filename);
};

const { defaultPersonas, buildPersonaPrompt, EXTRA_SEEDS } = require('../src/lib/personas.ts');
const { FORUM_PERSONA_MINDS, forumPersonaMindPrompt } = require('../src/lib/forumPersonaMind.ts');
const ids = ['shenmo', 'weini', 'miaoze', 'yanggao'];

// This test is about preserved character settings, not the exact biography
// wording (which editors are allowed to refine independently).
test('only four fixed forum characters receive add-on cognitive profiles', () => {
  assert.deepEqual(Object.keys(FORUM_PERSONA_MINDS).sort(), [...ids].sort());
  for (const seed of EXTRA_SEEDS) {
    if (!ids.includes(seed.key)) assert.equal(forumPersonaMindPrompt(seed.key), '');
  }
});

test('each forum profile supplies five distinct, nonempty behavioral lenses', () => {
  for (const id of ids) {
    const p = FORUM_PERSONA_MINDS[id];
    assert.equal(Object.keys(p).length, 5);
    for (const value of Object.values(p)) assert.ok(value.length >= 12, `${id}: ${value}`);
  }
  assert.equal(new Set(ids.map((id) => FORUM_PERSONA_MINDS[id].notices)).size, 4);
  assert.equal(new Set(ids.map((id) => FORUM_PERSONA_MINDS[id].responds)).size, 4);
});

test('model prompts include exactly the intended forum guide while keeping canonical identity and gate', () => {
  const original = defaultPersonas();
  for (const p of original) {
    assert.ok(ids.includes(p.id));
    const system = buildPersonaPrompt(p);
    assert.ok(system.includes(`${p.name}（${p.handle}）`));
    assert.ok(system.includes(p.background));
    assert.ok(system.includes(`你和对方熟到什么程度：${p.intimacy}/100`));
    assert.ok(system.includes(FORUM_PERSONA_MINDS[p.id].notices));
    assert.equal((system.match(/论坛里你理解别人和接话的习惯/g) || []).length, 1);
    assert.ok(!/你必须先写出分析步骤|展示思维链/.test(system));
  }
  assert.deepEqual(original.map((p) => [p.id, p.intimacy, p.replyDesire, p.followUp]), [
    ['shenmo', 16, 70, 'sometimes'],
    ['weini', 12, 52, 'rare'],
    ['miaoze', 18, 66, 'sometimes'],
    ['yanggao', 20, 86, 'often'],
  ]);
});

test('guides explicitly discourage stereotyped repetition and offline invitations', () => {
  assert.match(FORUM_PERSONA_MINDS.shenmo.avoid, /暗恋|韩东/);
  assert.match(FORUM_PERSONA_MINDS.weini.avoid, /社交失败/);
  assert.match(FORUM_PERSONA_MINDS.miaoze.avoid, /答题器/);
  assert.match(FORUM_PERSONA_MINDS.yanggao.avoid, /线下/);
  for (const id of ids) assert.match(forumPersonaMindPrompt(id), /不必强行给出行动/);
});
