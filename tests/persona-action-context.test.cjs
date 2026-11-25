// R7 action context: the selected next step must use the player's actual
// message. Unknown concrete cards must not spend a request on a generic step.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const room = lib('room');
const { defaultPersonas } = lib('personas');
const now = new Date(2026, 10, 25, 15, 0).getTime();
const config = { providerId: 'compatible', baseUrl: 'https://audit.invalid/v1', model: 'replay', fallbackModel: '', apiKey: 'synthetic-only' };
const settings = { liveliness: 0, timeFlow: false, dailyMessages: 100 };

function makeRoom(text) {
  const r = room.newRoom(defaultPersonas().slice(0, 4), now, 'Action audit');
  return {
    ...r,
    messages: [{ id: 'action-message', authorId: 'me', authorKind: 'player', authorName: 'Audit', text, at: now, kind: 'chat' }],
    scheduled: [], steps: [],
    usage: { day: new Date(now).toDateString(), messages: 0 },
    lastMessageAt: now, lastSeenAt: now,
  };
}

function optionIds(prompt) {
  return [...prompt.matchAll(/^([A-Za-z0-9_-]+) \| /gm)].map(match => match[1]);
}

async function requestWithOption(text) {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (_url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages.at(-1).content;
    const ids = optionIds(prompt);
    assert.ok(ids.length >= 1, prompt);
    return new Response(JSON.stringify({ choices: [{ message: { content: `${ids[0]}|先做这个` }, finish_reason: 'stop' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const out = await room.requestStep(makeRoom(text), { config, settings, now });
    return { calls, out };
  } finally {
    global.fetch = original;
  }
}

for (const [text, expectedPrefixes, rejectedPrefixes] of [
  ['论文开题的研究意义写不出来。', ['draft-', 'write-'], ['exam-', 'notes-', 'problem-']],
  ['实验报告的数据处理不会写。', ['lab-'], ['exam-', 'notes-']],
  ['室友半夜打游戏很吵。', ['peer-'], ['friend-', 'exam-']],
  ['小组作业分工不均。', ['peer-'], ['exam-', 'problem-']],
  ['文献综述框架搭不起来。', ['lit-'], ['notes-', 'exam-']],
  ['作品集还没排完。', ['portfolio-'], ['exam-', 'notes-']],
]) {
  test(`action context ${text}`, async () => {
    const { calls, out } = await requestWithOption(text);
    assert.equal(calls, 1);
    assert.equal(out.room.steps.length, 1, out.logs.join(' '));
    const step = out.room.steps[0];
    assert.ok(step.actionId, `${text}: missing actionId`);
    assert.ok(expectedPrefixes.some(prefix => step.actionId.startsWith(prefix)), `${text}: ${step.actionId}`);
    assert.ok(rejectedPrefixes.every(prefix => !step.actionId.startsWith(prefix)), `${text}: ${step.actionId}`);
  });
}

for (const text of [
  '课程展示上台会紧张。',
  '六级听力跟不上。',
  '导师催进度但卡在第一步。',
  '交换申请材料清单看得头大。',
]) {
  test(`unknown concrete card does not spend on generic step: ${text}`, async () => {
    const original = global.fetch;
    let calls = 0;
    global.fetch = async () => { calls += 1; throw new Error('network must not be used'); };
    try {
      const out = await room.requestStep(makeRoom(text), { config, settings, now });
      assert.equal(calls, 0);
      assert.equal(out.calls, 0);
      assert.equal(out.room.steps.length, 0);
      assert.ok(out.logs.includes('其实我也不是很知道……要不换个说法，或者自己加一件小事？'), out.logs);
    } finally {
      global.fetch = original;
    }
  });
}
