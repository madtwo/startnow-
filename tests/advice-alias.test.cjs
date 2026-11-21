/** Candidate action-scoped aliases from the Claude synthetic review. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./_ts-loader.cjs');
const { actionMap } = require('../src/lib/actions.ts');
const { validateAdviceLine } = require('../src/lib/adviceLine.ts');

const boundary = '社团答应的活动很疲惫，想推掉，又怕被误解';
const roommate = '室友半夜打游戏很吵，说过两次还是这样。';
const group = '小组作业有人一直不干活，我想说清楚又怕吵起来。';
const colleague = '同事把锅甩给我，我想澄清但不想撕破脸。';
const friend = '朋友借钱没还，我想问又怕伤感情。';
const lab = '实验数据异常，需要核对单位';

const accepted = [
  ['peer-boundary-2', boundary, '先把那句「这次我不去了」写下来，不用发给谁，写完看看它有多难说出口。'],
  ['peer-clarify-2', roommate, '要不先别只说“吵”，把具体一点的话摆出来：十二点后戴耳机，我明早还得早起。不带火气，但说到点上。'],
  ['peer-clarify-2', roommate, '要不先把话说明白点：几点到几点、你第二天要几点起，只讲影响不翻旧账，比“吵”这个字好用。'],
  ['peer-clarify-2', roommate, '要不先拟一句：“不是要你戒游戏，十二点后戴个耳机行吗”，把要求说小一点，别带火气。'],
  ['peer-clarify-2', roommate, '说两次没变，可能是「吵」太笼统。要不把具体影响说明白一点，比如「我十二点后得睡，键盘声我睡不着」，不带火气。'],
  ['peer-clarify-2', colleague, '先拟一句只讲事实、不带情绪的澄清话，把时间线摆清楚就行。不用解释动机，也别加“我不是针对你”。'],
  ['peer-clarify-2', roommate, '要不先把想说的那句写下来，比如“我明早有课，十二点后能不能戴耳机”，不带情绪反而好开口。'],
  ['peer-clarify-2', roommate, '先把想说的那句话写下来，只说“我十二点后睡不着”，别带“你总是”这种开场。'],
];

test('Claude-approved peer-family aliases now pass', () => {
  for (const [id, context, line] of accepted) {
    assert.deepEqual(validateAdviceLine(line, actionMap[id], context), { ok: true }, line);
  }
});

test('C04 multi-step draft/send stays rejected', () => {
  const line = '先把想说的那句写下来，别带“你总是”这类词，只讲分工和进度，读一遍顺不顺再发。';
  assert.deepEqual(validateAdviceLine(line, actionMap['peer-clarify-2'], group),
    { ok: false, reason: 'action_mismatch' });
});

test('C10 love-draft is accepted per Claude review, while C20 still fails', () => {
  const line = '先把想催的话写下来别发，写完再看要不要改软一点——钱的事开口前，先看清自己最怕哪句。';
  assert.deepEqual(validateAdviceLine(line, actionMap['love-draft-2'], friend), { ok: true });
  assert.equal(validateAdviceLine('现在就把催债消息发出去，别留草稿。', actionMap['love-draft-2'], friend).ok, false);
});

test('all ten negative controls stay rejected', () => {
  const negatives = [
    ['lab-unit-2', lab, '先打开手机找几段好玩的短视频放松一下。'],
    ['lab-unit-2', lab, '先去把实习简历删掉重写一版。'],
    ['peer-clarify-2', roommate, '先把课程论文重新写一页，今晚先别想其他。'],
    ['peer-boundary-2', boundary, '先打开手机刷几条最新视频，不用想太多。'],
    ['peer-boundary-2', boundary, '先把社团报名表填完，再决定去不去。'],
    ['peer-boundary-2', '朋友约我周末帮忙搬家，我其实不想去，不知道怎么拒绝。', '先答应下来，周末再说。'],
    ['peer-clarify-2', roommate, '现在就去敲他房门，让他立刻关电脑。'],
    ['peer-clarify-2', group, '先把小组作业全部做完，别跟组员提分工。'],
    ['peer-clarify-2', colleague, '先在群里直接说是他干的，别留余地。'],
    ['love-draft-2', friend, '现在就把催债消息发出去，别留草稿。'],
  ];
  for (const [id, context, line] of negatives) {
    assert.equal(validateAdviceLine(line, actionMap[id], context).ok, false, line);
  }
});

test('a bare “你总是” without the non-blaming instruction is not enough', () => {
  assert.equal(validateAdviceLine('你总是说清楚一点。', actionMap['peer-clarify-2'], roommate).ok, false);
});

test('aliases do not leak to other actions', () => {
  const line = '先把那句「这次我不去了」写下来，不用发给谁。';
  assert.equal(validateAdviceLine(line, actionMap['lab-unit-2'], lab).ok, false);
});

test('alias phrases do not turn unrelated academic tasks into interpersonal advice', () => {
  for (const line of [
    '先把课程论文的内容说明白一点，今天就写完。',
    '先把实习简历的要求说清楚，再投递五家公司。',
    '先说清楚今天要看三小时短视频，这样效率更高。',
  ]) {
    assert.equal(validateAdviceLine(line, actionMap['peer-clarify-2'], roommate).ok, false, line);
  }
});

test('boundary aliases never approve agreeing or applying after refusing', () => {
  const lines = [
    '先写下「我不去了」，但还是直接答应下来吧。',
    '先把那句我不去了写下来，再去报名。',
  ];
  for (const line of lines) {
    assert.deepEqual(validateAdviceLine(line, actionMap['peer-boundary-2'], boundary),
      { ok: false, reason: 'action_mismatch' }, line);
  }
});

test('reviewed draft aliases reject sending now, including missing initial adverb', () => {
  for (const line of [
    '先把想催的话写下来，接着把这条消息直接发出去。',
    '先把想催的话写下来，然后就发给他。',
    '先写好想催的话，写完就发出去吧。',
  ]) {
    assert.deepEqual(validateAdviceLine(line, actionMap['love-draft-2'], friend),
      { ok: false, reason: 'action_mismatch' }, line);
  }
});

test('negated draft-only sends remain valid for C01 and C10', () => {
  assert.deepEqual(validateAdviceLine(accepted[0][2], actionMap['peer-boundary-2'], boundary), {ok:true});
  assert.deepEqual(validateAdviceLine('先把想催的话写下来别发，写完再看要不要改软一点——钱的事开口前，先看清自己最怕哪句。',
    actionMap['love-draft-2'], friend), {ok:true});
});

test('prototype keys cannot crash the action-scoped alias map', () => {
  const strange={ id: '__proto__', label: '做一个记录', line: '先记下一件事', alternateLine: '' };
  assert.doesNotThrow(() => validateAdviceLine('先写下一句事实，不用一下做完。',strange,group));
});
