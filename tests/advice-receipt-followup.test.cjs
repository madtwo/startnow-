/** Regression guard for the player-facing, hand-reviewed curated copy overlay. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const source = path.join(__dirname, '..', 'src', 'lib');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
// Some dependencies are absent only in this uploaded partial snapshot.
if (!fs.existsSync(path.join(source, 'baseline.ts'))) {
  const load = Module._load;
  Module._load = function (name, parent, isMain) {
    if (parent?.filename?.endsWith('/adviceLine.ts')) {
      if (name === './baseline') return {
        auditCriticalContent: () => null, auditSocial: () => null, auditTone: () => null,
      };
      if (name === './safety') return { findCrisis: () => false };
    }
    return load.call(this, name, parent, isMain);
  };
}
const { ACTIONS, actionMap } = require('../src/lib/actions.ts');
const { ADVICE_PLAYER_COPY, playerFacingAdviceAction, playerFacingPreferredLine } = require('../src/lib/adviceFallbackCopy.ts');
const { chooseAdviceCopy, validateAdviceLine } = require('../src/lib/adviceLine.ts');
const now = 1800000000000;
const firstPersonStart = /^\s*[“”"'「『（(]*\s*(?:我会先|我会|我可以|我打算|我先|我卡住|我复习|我卡着)/u;
const anyFirstPerson = /(?:我会先|我会|我先|我卡住|我复习|我卡着)/u;

test('every reviewed override is for a live action and for a valid wording field', () => {
  assert.ok(Object.keys(ADVICE_PLAYER_COPY).length >= 80);
  for (const [id, edit] of Object.entries(ADVICE_PLAYER_COPY)) {
    assert.ok(actionMap[id], id);
    assert.ok(Object.keys(edit).length > 0, id);
    for (const [field, wording] of Object.entries(edit)) {
      assert.ok(['line', 'alternateLine'].includes(field), id);
      assert.equal(typeof actionMap[id][field], 'string', id);
      assert.equal(typeof wording, 'string', id);
      assert.ok(Array.from(wording).length <= 90 && Array.from(wording).length >= 8, id);
      assert.ok(!firstPersonStart.test(wording) && !anyFirstPerson.test(wording), id);
      assert.notEqual(wording, actionMap[id][field], id);
    }
  }
});

test('all action lines with unsolicited first-person plans get a player-facing replacement', () => {
  const uncovered = [];
    for (const action of ACTIONS) {
    const output = playerFacingAdviceAction(action);
    for (const field of ['line', 'alternateLine']) {
      const original = action[field];
      if (typeof original !== 'string') continue;
      if (anyFirstPerson.test(original) && anyFirstPerson.test(output[field])) {
        uncovered.push(action.id + ':' + field);
      }
    }
  }
  assert.deepEqual(uncovered, []);
});

test('copy overlay changes wording only: original action objects are not mutated', () => {
  for (const action of ACTIONS) {
    const old = structuredClone(action);
    const edited = playerFacingAdviceAction(action);
    for (const field of ['id','label','minutes','category','topics','variant','lateNight','smaller']) {
      assert.deepEqual(edited[field], old[field], action.id + ':' + field);
    }
    assert.deepEqual(action, old, action.id);
  }
});

test('legacy first-person primary line now falls back to player-facing primary copy', () => {
  for (const id of ['desk-3','notes-3','draft-3','lab-unit-2','write-heading-2','sleep-screen-2']) {
    const action = actionMap[id];
    const result = chooseAdviceCopy(action, [], now, 'new', null, action.line);
    assert.ok(result && result.lineSource === 'curated', id);
    assert.equal(result.text, ADVICE_PLAYER_COPY[id].line, id);
  }
});

test('legacy first-person alternate line gets rewritten on first and second card', () => {
  for (const id of ['exam-keyword-2','proposal-ref-2','family-time-2','job-title-2','self-step-2']) {
    const action = actionMap[id];
    const first = chooseAdviceCopy(action, [], now, 'new', null, action.alternateLine);
    assert.ok(first && first.lineSource === 'curated', id);
    assert.equal(first.text, ADVICE_PLAYER_COPY[id].alternateLine, id);
    const prior = [{id:'prior',advice:{actionId:id,origin:'curated',at:now-1200},
      comments:[{actionId:id,authorKind:'persona',origin:'curated',at:now-1200,text:action.line}]}];
    const next = chooseAdviceCopy(action, prior, now, 'new', null, action.line);
    assert.ok(next && next.lineSource === 'curated', id);
    assert.equal(next.text, ADVICE_PLAYER_COPY[id].alternateLine, id);
    const third = chooseAdviceCopy(action, [...prior,{...prior[0],id:'prior2'}],now,'new',null,action.line);
    assert.equal(third, null, id);
  }
});

test('unrecognized preferred text is rejected in favor of the reviewed primary line', () => {
  const action = actionMap['peer-topic-2'];
  const prefer = playerFacingPreferredLine(action, '我会先给角色塞一个未经审核的句子。');
  assert.equal(prefer, playerFacingAdviceAction(action).line);
});

test('accepted model line remains unchanged and is not rewritten as curated', () => {
  const action=actionMap['lab-unit-2'];
  const line='先核对实验数据表里那一列单位，对完就停。';
  assert.deepEqual(validateAdviceLine(line,action,'实验数据异常，我在检查单位'),{ok:true});
  const chosen=chooseAdviceCopy(action,[],now,'new',line);
  assert.ok(chosen && chosen.lineSource==='model');
  assert.equal(chosen.text,line);
});

test('do not relax no_anchor: unrelated but plausible action stays rejected', () => {
  const action=actionMap['lab-unit-2'];
  for(const offTopic of [
    '先打开手机找几个好玩的短视频看一看。',
    '先把简历里最近那段实习经历改成一段话。',
  ]) assert.deepEqual(validateAdviceLine(offTopic,action,'实验数据异常需要核对单位'),{ok:false,reason:'no_anchor'});
});

test('log describes a selected next step without claiming it was preset', () => {
  const text=fs.readFileSync(path.join(source,'cards.ts'),'utf8');
  assert.match(text, /给了一个\$\{seekingHelp \? '求助起点' : '下一步'\}/u);
  assert.doesNotMatch(text,/给了一个\$\{seekingHelp \? '求助起点' : '预置下一步'\}/u);
});
