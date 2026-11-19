/**
 * 群聊：随机人设 / 从零熟悉度 / 情绪两段式 / 旧群聊交换 / 提示词分支。
 * 这些行为只在 mock 或纯函数层面验证，不联网。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');

const { generateCast, deriveSituation, refreshSituations, pathKindFor } = lib('castGen');
const { emotionalSignal } = lib('tone');
const room = lib('room');
const { roomPrompt } = lib('prompts');

const NOW = new Date('2026-11-19T15:30:00+08:00').getTime();
const ME = { id: 'me', name: '我', avatarKey: 'petal', bio: '' };
const SETTINGS = { liveliness: 0.5, timeFlow: false, dailyMessages: 400 };

const freshRoom = () => {
  const base = room.newRoom(generateCast(4, NOW), NOW);
  return { ...base, messages: [], scheduled: [], lastMessageAt: NOW, lastSeenAt: NOW };
};

const intents = (r, kind) => r.scheduled.filter((s) => s.intent === kind);

test('随机人设：名字/专业/原型/年级都不重复，且从陌生人开始', () => {
  const cast = generateCast(4, NOW);
  assert.equal(cast.length, 4);
  assert.equal(new Set(cast.map((p) => p.name)).size, 4);
  assert.equal(new Set(cast.map((p) => p.major)).size, 4);
  assert.equal(new Set(cast.map((p) => p.archetype)).size, 4);
  assert.equal(new Set(cast.map((p) => p.cohort)).size, 4, '年级也要岔开，不然没人找实习/考研');
  for (const p of cast) {
    assert.equal(p.intimacy, 0, `${p.name} 应该从 0 开始`);
    assert.deepEqual(p.relations ?? {}, {});
    assert.match(p.school, /(大学|学院)$/);
    assert.ok(p.situation && p.situation.agenda && p.situation.worry, `${p.name} 缺处境`);
    assert.ok(p.situation.knows.length >= 1);
    assert.ok((p.chattiness ?? 0) > 0, `${p.name} 缺话量`);
    assert.equal((p.awake ?? []).length, 2);
  }
});

test('到了大三/大四的求职季，困境会落到实习或考研保研上', () => {
  // 11 月：大三、大四都在考研；大一还没轮到
  assert.equal(pathKindFor(3, 11), 'kaoyan');
  assert.equal(pathKindFor(4, 11), 'kaoyan');
  assert.equal(pathKindFor(1, 11), null);
  assert.equal(pathKindFor(2, 4), 'intern');
  assert.ok(['intern', 'baoyan'].includes(pathKindFor(4, 9)));

  const cast = generateCast(4, NOW);
  const career = cast.filter((p) =>
    p.situation.knows.some((k) => /简历|面试|择校|保研|夏令营|专业课/.test(k)),
  );
  assert.ok(career.length >= 2, `应该有至少两个人卡在出路上，实际：${cast.map((p) => p.cohort).join('/')}`);
  for (const p of career) {
    assert.ok(p.situation.worry.length > 0);
  }
});

test('处境跟着时间变：上午和半夜不是同一句', () => {
  const morning = deriveSituation('材料科学与工程', '大二', new Date('2026-11-19T09:00:00+08:00').getTime());
  const night = deriveSituation('材料科学与工程', '大二', new Date('2026-11-19T23:00:00+08:00').getTime());
  assert.notEqual(morning.agenda, night.agenda);
  assert.ok(morning.busy > 0 && night.busy > 0);
});

test('处境按天刷新', () => {
  const cast = generateCast(2, NOW);
  const stale = cast.map((p) => ({ ...p, situation: { ...p.situation, day: '很久以前' } }));
  const next = refreshSituations(stale, NOW);
  for (const p of next) assert.equal(p.situation.day, new Date(NOW).toDateString());
});

test('情绪判定：情绪 / 迷茫 / 普通，且不被「积累」「麻烦你了」骗到', () => {
  assert.equal(emotionalSignal('我今天好累'), 'heavy');
  assert.equal(emotionalSignal('真的好烦，什么都不想做'), 'heavy');
  assert.equal(emotionalSignal('不知道该怎么办'), 'stuck');
  assert.equal(emotionalSignal('我不知道要不要考研'), 'stuck');
  assert.equal(emotionalSignal('积累了一点经验'), 'neutral');
  assert.equal(emotionalSignal('麻烦你了'), 'neutral');
  assert.equal(emotionalSignal('今天食堂的鸡腿不错'), 'neutral');
});

test('情绪句：先陪伴、再至少两条不同的建议', () => {
  const sent = room.postPlayerMessage(
    freshRoom(),
    '我好累，也不知道要不要继续考了',
    ME,
    [],
    undefined,
    NOW,
    0.5,
  );
  const comfort = intents(sent, 'comfort');
  const advise = intents(sent, 'advise');
  assert.ok(comfort.length >= 1, '至少要有人先陪');
  assert.ok(advise.length >= 2, '至少要两条建议');
  assert.equal(new Set(advise.map((s) => s.adviceId)).size, advise.length, '两条建议不能是同一个动作');
  const lastComfort = Math.max(...comfort.map((s) => s.at));
  const firstAdvise = Math.min(...advise.map((s) => s.at));
  assert.ok(firstAdvise > lastComfort, '建议要晚于陪伴');
  const comforters = new Set(comfort.map((s) => s.personaId));
  assert.ok(advise.every((s) => !comforters.has(s.personaId)), '陪伴的人和给建议的人不要重叠');
});

test('普通聊天不触发两段式', () => {
  const sent = room.postPlayerMessage(freshRoom(), '今天食堂的鸡腿不错', ME, [], undefined, NOW, 0.5);
  assert.ok(sent.scheduled.every((s) => s.intent === 'reply'));
});

test('旧群聊：交换而不是覆盖，恢复后不会立刻补算一堆', () => {
  const a = { ...freshRoom(), id: 'room-a', title: '房间A' };
  const b = { ...freshRoom(), id: 'room-b', title: '房间B', archivedAt: NOW - 1000 };
  const out = room.restoreArchive(a, [b], 'room-b', NOW);
  assert.ok(out);
  assert.equal(out.room.id, 'room-b');
  assert.equal(out.archives[0].id, 'room-a');
  assert.equal(out.room.archivedAt, undefined);
  assert.ok(out.room.scheduled.every((s) => s.at > NOW));
  assert.equal(room.discardArchive(out.archives, 'room-a').length, 0);
  assert.equal(room.MAX_ARCHIVES, 8);
});

test('提示词分支：陪伴不给建议、建议带动作、自己开口也不给建议', () => {
  const cast = generateCast(2, NOW);
  assert.ok(!roomPrompt(cast, [], { mode: 'ambient' }).includes('给一个具体的小办法'));
  assert.ok(roomPrompt(cast, [], { mode: 'comfort', replyName: '我' }).includes('这一轮不给建议'));
  const advise = roomPrompt(cast, [], { mode: 'advise', advice: { label: '把书翻开', minutes: 5 } });
  assert.ok(advise.includes('把书翻开'));
  assert.ok(roomPrompt(cast, [], { mode: 'react' }).includes('应一声'));
});

test('玩家在关心 AI 时，先回应自己（陪伴和建议两种模式都要）', () => {
  const cast = generateCast(2, NOW);
  const base = {
    replyName: '我',
    selfName: '王景行',
    replyText: '你今天还好吗，是不是特别累',
    replyIsPlayer: true,
  };
  for (const mode of ['reply', 'comfort', 'advise']) {
    const text = roomPrompt(cast, [], { ...base, mode, advice: { label: '倒一杯水', minutes: 5 } });
    assert.ok(text.includes('回应关于你自己的事'), `${mode} 应该先回应自己`);
  }
  const asking = roomPrompt(cast, [], {
    ...base,
    replyText: '我明天考试什么都不会怎么办',
    mode: 'reply',
  });
  assert.ok(!asking.includes('回应关于你自己的事'), '玩家在求助时不该被当成关心');
});
