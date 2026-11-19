/** R1: built-in persona text upgrades from v1 to v2 without touching hand edits. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const memory = new Map();
global.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};
const lib = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const { migratePersonaText, PERSONA_V1_TEXT, PERSONA_SCHEMA_KEY, PERSONA_SCHEMA_VERSION } = lib('personaMigration');
const { defaultPersonas } = lib('personas');
const store = lib('store');

const base = () => defaultPersonas();
const legacyRow = (id) => {
  const row = base().find((p) => p.id === id);
  return { ...row, ...PERSONA_V1_TEXT[id], memory: [{ text: '旧记忆', weight: 'normal' }] };
};

test('v1 built-in text is upgraded to v2', () => {
  const rows = defaultPersonas().map((p) => legacyRow(p.id));
  const out = migratePersonaText(rows, base());
  assert.equal(out.changed, 4);
  const now = (id) => base().find((p) => p.id === id);
  const byId = new Map(out.rows.map((p) => [p.id, p]));
  assert.equal(byId.get('shenmo').tagline, now('shenmo').tagline);
  assert.equal(byId.get('weini').approach, now('weini').approach);
  assert.equal(byId.get('miaoze').speech, now('miaoze').speech);
  assert.equal(byId.get('yanggao').background, now('yanggao').background);
});

test('hand-edited fields and runtime state survive', () => {
  const rows = defaultPersonas().map((p) => legacyRow(p.id));
  rows[0] = { ...rows[0], speech: '我自己改过的说话习惯', intimacy: 88, weights: { ...rows[0].weights, study: 44 } };
  const out = migratePersonaText(rows, base());
  assert.equal(out.rows[0].speech, '我自己改过的说话习惯');
  assert.equal(out.rows[0].intimacy, 88);
  assert.equal(out.rows[0].weights.study, 44);
  assert.equal(out.rows[0].memory[0].text, '旧记忆');
  assert.notEqual(out.rows[0].background, PERSONA_V1_TEXT.shenmo.background);
});

test('migration is idempotent', () => {
  const first = migratePersonaText(defaultPersonas().map((p) => legacyRow(p.id)), base());
  const second = migratePersonaText(first.rows, base());
  assert.equal(second.changed, 0);
  assert.deepEqual(second.rows, first.rows);
});

test('partial legacy rows and unknown ids are safe', () => {
  const partial = [{ id: 'weini', tagline: PERSONA_V1_TEXT.weini.tagline }];
  const out = migratePersonaText([...partial, { id: 'custom', tagline: 'x' }], base());
  assert.equal(out.rows[0].tagline, base().find((p) => p.id === 'weini').tagline);
  assert.equal(out.rows[1].tagline, 'x');
});

test('loadPersonas migrates the saved archive and marks the schema', () => {
  memory.clear();
  const saved = defaultPersonas().map((p) => legacyRow(p.id));
  localStorage.setItem('shudong.personas.v3', JSON.stringify(saved));
  const loaded = store.loadPersonas();
  const shenmo = loaded.find((p) => p.id === 'shenmo');
  assert.equal(shenmo.background, base().find((p) => p.id === 'shenmo').background);
  assert.equal(localStorage.getItem(PERSONA_SCHEMA_KEY), String(PERSONA_SCHEMA_VERSION));
  const persisted = JSON.parse(localStorage.getItem('shudong.personas.v3'));
  assert.equal(persisted.find((p) => p.id === 'shenmo').background,
    base().find((p) => p.id === 'shenmo').background);
});

test('loadPersonas keeps a hand-edited saved background', () => {
  memory.clear();
  const saved = defaultPersonas().map((p) => legacyRow(p.id));
  saved[1] = { ...saved[1], background: '我自己写的魏霓背景，保留。' };
  localStorage.setItem('shudong.personas.v3', JSON.stringify(saved));
  const loaded = store.loadPersonas();
  assert.equal(loaded.find((p) => p.id === 'weini').background, '我自己写的魏霓背景，保留。');
});
