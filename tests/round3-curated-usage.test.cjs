/** Local, deterministic R6 checks; no browser, model, key, or full repo needed. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
};
const { chooseCuratedActionLine, curatedActionUsesAcrossCards } = require('../src/lib/curatedUsage.ts');
const { actionMap, recentActionUses } = require('../src/lib/actions.ts');
const now = 1_800_000_000_000;
const action = actionMap['exam-scope-2'];
const card = (id, text, origin='curated', actionId=action.id, at=now) => ({
  id,
  comments: [{ id:`comment-${id}`, actionId, authorKind:'persona', origin, text, at }],
  advice: { actionId, text, at, origin },
});

test('R6: across three cards same action appears at most twice; second uses authored alternate', () => {
  assert.ok(action && action.alternateLine);
  const first = chooseCuratedActionLine(action, [], now, 'a', action.line);
  assert.equal(first.text, action.line);
  const one = [card('a', first.text)];
  const second = chooseCuratedActionLine(action, one, now+1, 'b', action.line);
  assert.equal(second.text, action.alternateLine);
  assert.equal(second.useAlternate, true);
  const two = [...one, card('b', second.text, 'curated', action.id, now+1)];
  assert.equal(curatedActionUsesAcrossCards(two, action.id, now+2, 'c'), 2);
  assert.equal(chooseCuratedActionLine(action, two, now+2, 'c'), null);
});

test('R6: advice + mirrored comment in same card counts once', () => {
  assert.equal(curatedActionUsesAcrossCards([card('a', 'test')], action.id, now, 'z'), 1);
});

test('R6: model text and demo are not counted as curated even if they coincide', () => {
  const unrelated = [card('a', action.line, 'model'), card('b', action.line, 'demo')];
  assert.equal(curatedActionUsesAcrossCards(unrelated, action.id, now, 'c'), 0);
  assert.equal(chooseCuratedActionLine(action, unrelated, now, 'c').text, action.line);
});

test('R6: legacy no-origin actionId is counted but never re-labeled in stored object', () => {
  const previous = card('a', action.line);
  previous.comments[0].origin = undefined;
  previous.advice.origin = undefined;
  const before = JSON.stringify(previous);
  assert.equal(curatedActionUsesAcrossCards([previous], action.id, now, 'b'), 1);
  assert.equal(JSON.stringify(previous), before);
});

test('R6: rolling 24h window expires and unrelated actions do not count', () => {
  const stale = card('a', action.line, 'curated', action.id, now - 86_400_001);
  const different = card('b', 'other text', 'curated', 'not-the-same', now);
  assert.equal(curatedActionUsesAcrossCards([stale,different], action.id, now, 'c'), 0);
});

test('R6: missing authored alternate must abstain rather than fake a new action', () => {
  const simple = { id:action.id, line:action.line };
  assert.equal(chooseCuratedActionLine(simple,[card('a', action.line)],now,'b'), null);
});

test('R6: recent curated comments carry IDs for action matching; model replies excluded', () => {
  const normal=card('a',action.line);
  const model=card('b','same', 'model');
  delete model.advice; // model prose cannot create a pinned local action
  const recent=recentActionUses([normal,model],now);
  assert.ok(recent.some((row)=>row.id === action.id));
  assert.equal(recent.filter((row)=>row.text==='same').length,0);
});

test('R6: all action IDs and authored alternates remain unchanged', () => {
  const { ACTIONS, actionLineOptions } = require('../src/lib/actions.ts');
  assert.ok(ACTIONS.length >= 80);
  for (const row of ACTIONS) {
    assert.equal(actionLineOptions(row)[0], row.line);
    if (row.alternateLine) assert.equal(actionLineOptions(row)[1], row.alternateLine);
  }
});
