'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (mod, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    });
    mod._compile(output.outputText, filename);
  };
}
Module._extensions['.css'] = (mod) => mod._compile('', mod.filename);
const root = path.resolve(__dirname, '../src');
const jobs = require(path.join(root, 'lib/decomposeJob.ts'));
const oldLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react/jsx-runtime') return {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  };
  return oldLoad.apply(this, arguments);
};
const Orb = require(path.join(root, 'components/DecomposeOrb.tsx')).default;
Module._load = oldLoad;
const { updateDecomposeJob: next, emptyDecomposeJob: idle, acknowledgeDecomposeJob: ack,
  isDecomposeOrbVisible: visible } = jobs;
const running = (goal = '复习', stage = 'requesting', newTask = false) => ({ status: 'running', goal, stage, newTask });
const ready = (goal = '复习', seen = false) => ({ status: 'ready', goal, title: '学习计划', seen });
const failed = (goal = '复习', seen = false) => ({ status: 'failed', goal, error: '请重试', seen });
const traverse = (node, predicate) => {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const item of node) { const v = traverse(item, predicate); if (v) return v; } return null; }
  return predicate(node) ? node : traverse(node.props?.children, predicate);
};
const buttonOf = (node) => traverse(node, item => item.type === 'button');

test('R1: one page-local state tracks running -> ready -> acknowledgement -> idle', () => {
  let state = next(idle(), running('目标A', 'loadingQuestions', true), 10);
  assert.equal(state.status, 'running'); assert.equal(state.startedAt, 10);
  state = next(state, running('目标A', 'questions'), 20);
  assert.equal(state.startedAt, 10); assert.equal(state.stage, 'questions');
  state = next(state, running('目标A'), 30);
  state = next(state, ready('目标A'), 40);
  assert.equal(state.finishedAt, 40); assert.equal(state.title, '学习计划');
  assert.equal(visible(state, false), true);
  state = ack(state);
  assert.equal(visible(state, false), false);
  assert.equal(visible(state, true), false);
  assert.deepEqual(next(state, { status: 'idle' }), idle());
});

test('R1/R2: new run removes old ready/failed/acknowledged information', () => {
  let state = next(next(idle(), ready('旧目标')), running('新目标', 'requesting', true), 50);
  assert.equal(state.title, undefined); assert.equal(state.goal, '新目标');
  assert.equal(state.acknowledged, undefined);
  state = next(state, failed('新目标'), 51);
  assert.equal(state.status, 'failed'); assert.equal(visible(state, false), true);
  state = next(state, running('新目标', 'requesting', true), 52);
  assert.equal(state.error, undefined); assert.equal(state.finishedAt, undefined);
  assert.equal(state.startedAt, 52);
});

test('R2: visible only while sheet closed; unread failure and success; running reappears', () => {
  for (const state of [idle(), next(idle(), running()), next(idle(), ready()), next(idle(), failed())]) {
    assert.equal(visible(state, true), false);
  }
  assert.equal(visible(idle(), false), false);
  assert.equal(visible(next(idle(), running()), false), true);
  assert.equal(visible(ack(next(idle(), running())), false), true);
  assert.equal(visible(next(idle(), ready(undefined, true)), false), false);
  assert.equal(visible(ack(next(idle(), failed())), false), false);
});

test('R4: ball states have keyboard-native button and accurate labels, no save side effects', () => {
  let opens = 0;
  const onOpen = () => { opens++; };
  assert.equal(Orb({job:idle(),sheetOpen:false,onOpen}), null);
  for (const [job, caption, phrase] of [
    [next(idle(), running()), '拆解中', '目标拆解中'],
    [next(idle(), running('复习', 'questions')), '待回答', '问题待回答'],
    [next(idle(), ready()), '已拆好', '目标拆好了'],
    [next(idle(), failed()), '查看原因', '目标拆解未完成'],
  ]) {
    const tree = Orb({job,sheetOpen:false,onOpen,hasToast:true});
    assert.match(tree.props.className, /--toast/);
    const button = buttonOf(tree);
    assert.equal(button.props.type, 'button');
    assert.match(button.props['aria-label'], new RegExp(phrase));
    assert.equal(button.props.onClick, onOpen);
    const status = traverse(tree, n => n.props?.['aria-live'] === 'polite');
    assert.ok(status); assert.equal(status.props.children, caption);
    button.props.onClick();
    assert.equal(Orb({job,sheetOpen:true,onOpen}), null);
  }
  assert.equal(opens, 4);
});

test('R4/A5: responsive styles include safe area, size, reduced motion and focus', () => {
  const css=fs.readFileSync(path.join(root,'components/DecomposeOrb.css'),'utf8');
  assert.match(css,/position:\s*fixed/);
  assert.match(css,/max-width:\s*calc\(100vw/);
  assert.match(css,/min-(?:width|height):\s*56px/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/focus-visible/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);
  assert.match(css,/animation:\s*none/);
});

test('R3/A3: App has one job status, retained sheet, route-independent orb and guarded epoch', () => {
  const app=fs.readFileSync(path.join(root,'App.tsx'),'utf8');
  assert.match(app,/useState\(emptyDecomposeJob\)/);
  assert.match(app,/key=\{decomposeEpoch\}[\s\S]*?open=\{decomposeOpen\}/);
  assert.match(app,/decomposeEpochRef\.current !== decomposeEpoch/);
  assert.match(app,/onBackgroundState=\{\(event\) =>/);
  assert.match(app,/<DecomposeOrb job=\{decomposeJob\}/);
  assert.match(app,/onOpen=\{openDecompose\}/);
  assert.match(app,/onClose=\{\(\) => setDecomposeOpen\(false\)\}/);
  assert.match(app,/onClick=\{\(\) => setView\('room'\)\}/);
  const sheet=fs.readFileSync(path.join(root,'components/DecomposeSheet.tsx'),'utf8');
  assert.match(sheet,/if \(!open\) return null/);
  assert.match(sheet,/const closeSheet = \(\) => \{ openRef\.current = false; onClose\(\); \}/);
  assert.doesNotMatch(sheet,/const closeSheet = \(\) =>[^\n]*stopCurrent/);
  assert.match(sheet,/reportJob\(\{status:'idle'\}\)/);
  assert.match(sheet,/ticket !== operationId\.current/);
  assert.doesNotMatch(app,/localStorage\.setItem\(.*decomposeJob/);
});

test('R6: page-local status has no storage and new code does not depend on room internals', () => {
  const status=fs.readFileSync(path.join(root,'lib/decomposeJob.ts'),'utf8');
  assert.doesNotMatch(status,/localStorage|sessionStorage|fetch\(/);
  const orb=fs.readFileSync(path.join(root,'components/DecomposeOrb.tsx'),'utf8');
  assert.doesNotMatch(status+'\n'+orb,/from ['"](?:\.\.\/)*room\//);
});

test('R6 privacy: floating controls never expose the private goal, title, error or API key', () => {
  const privateText='不应公开：家人姓名身份证123456';
  const job=next(idle(),{ status:'failed', goal: privateText, error:privateText, seen:false });
  const tree=Orb({job,sheetOpen:false,onOpen:()=>{}});
  assert.doesNotMatch(JSON.stringify(tree), /家人姓名|身份证|123456/);
  const done=Orb({job:next(idle(),{status:'ready',goal:privateText,title:privateText}),sheetOpen:false,onOpen:()=>{}});
  assert.doesNotMatch(JSON.stringify(done), /家人姓名|身份证|123456/);
});
