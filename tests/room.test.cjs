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

// The scheduling test models a local afternoon. A fixed +08:00 instant becomes
// early morning in other timezones and can legitimately suppress peer replies.
const NOW = new Date(2026, 10, 19, 15, 30, 0).getTime();
const ME = { id: 'me', name: '我', avatarKey: 'petal', bio: '' };
const SETTINGS = { liveliness: 0.5, timeFlow: false, dailyMessages: 400 };
const MOCK = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };

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

test('普通聊天：只会有人以「对群里说」的方式接，最多两条', () => {
  const sent = room.postPlayerMessage(freshRoom(), '今天食堂的鸡腿不错', ME, [], undefined, NOW, 0.5);
  assert.ok(sent.scheduled.every((s) => s.intent === 'reply'));
  assert.ok(sent.scheduled.length <= 2);
  // 没被 @ 的话，不应该定向挂在玩家那句下面
  assert.ok(sent.scheduled.every((s) => s.replyTo === undefined));
});

test('每个人的反应阈值、语速、爱说话的时段都不一样', () => {
  const cast = generateCast(4, NOW);
  for (const p of cast) {
    assert.ok((p.reactivity ?? 0) > 0 && (p.reactivity ?? 0) <= 1, `${p.name} 缺反应阈值`);
    assert.equal((p.pace ?? []).length, 2);
    assert.equal((p.peak ?? []).length, 2);
  }
  assert.equal(new Set(cast.map((p) => (p.reactivity ?? 0).toFixed(3))).size, 4, '阈值不该一样');
  assert.equal(new Set(cast.map((p) => (p.pace ?? []).join('-'))).size > 1, true, '语速不该一样');
});

test('兜底：你说完话过了 10 条还没人接，下一个就强制回你', async () => {
  const base = freshRoom();
  const sent = room.postPlayerMessage(base, '有人吗', ME, [], undefined, NOW, 0.5);
  const mine = sent.messages[sent.messages.length - 1];
  // 群里在聊别的，10 条都没接你
  const chatter = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`,
    authorId: base.cast[0].id,
    authorKind: 'persona',
    authorName: base.cast[0].name,
    text: `随便说一句 ${i}`,
    at: NOW + 1000 + i * 1000,
    kind: 'chat',
  }));
  const busy = { ...sent, messages: [...sent.messages, ...chatter], scheduled: [] };
  const out = await room.tickRoom({ room: busy, settings: SETTINGS, config: MOCK, now: NOW + 20_000 });
  assert.ok(
    out.room.scheduled.some((s) => s.replyTo === mine.id) ||
      out.room.messages.some((m) => m.replyTo === mine.id),
    '过了 10 条应该有人被安排来回你',
  );
});

test('安慰会把关系拉近（不只是普通的 +1）', async () => {
  let current = room.postPlayerMessage(freshRoom(), '我好累，撑不住了', ME, [], undefined, NOW, 0.5);
  let cursor = NOW;
  for (let i = 0; i < 12 && current.scheduled.length > 0; i++) {
    cursor += 10_000;
    const out = await room.tickRoom({ room: current, settings: SETTINGS, config: MOCK, now: cursor });
    current = out.room;
  }
  const closest = Math.max(...current.cast.map((p) => p.relations?.me ?? 0));
  assert.ok(closest >= 2, `安慰过你的人应该更熟，实际最高 ${closest}`);
});

test('每个人有自己喜欢的事，刚认识时不吐苦水', () => {
  const cast = generateCast(4, NOW);
  for (const p of cast) {
    assert.equal((p.interests ?? []).length, 2, `${p.name} 缺兴趣`);
    assert.equal(new Set(p.interests).size, 2, `${p.name} 的兴趣重复了`);
  }
  const system = room.systemForRoom(cast[0], cast);
  assert.ok(system.includes(cast[0].interests[0]), '系统提示要带上他的兴趣');
  assert.ok(system.includes('不会一上来就吐苦水'), '刚认识阶段要禁止吐苦水');
  assert.ok(system.includes('喜欢什么'), '刚认识时可以用来找话题');
});

test('文风清洗：破折号、分号、AI 套话会被清掉', () => {
  assert.equal(room.polishLine('先做一点——就一点。'), '先做一点，就一点。');
  assert.equal(room.polishLine('分开写；别堆一起。'), '分开写，别堆一起。');
  assert.equal(room.polishLine('其实，我也卡这儿。'), '我也卡这儿。');
  assert.equal(room.polishLine('先翻开第一页。希望对你有帮助。'), '先翻开第一页。');
});

test('提示词里有正例和反例，不是只有禁令', () => {
  const cast = generateCast(2, NOW);
  const system = room.systemForRoom(cast[0], cast);
  assert.ok(system.includes('可以照这个感觉说'), '要有正例');
  assert.ok(system.includes('不要这样说'), '要有反例');
  assert.ok(system.includes('真人打字是这个味道'), '要说明真人打字的特征');
  assert.ok(system.includes('不要每句都收成一个金句'), '不许每句都写成金句');
  // 不许再要求「短句」：真人聊天是一口气说好几件事的
  assert.ok(!system.includes('最多两个逗号'), '不该限制句子长度');
});

test('每个人有自己的打字习惯，四个人不像同一个模型', () => {
  const cast = generateCast(4, NOW);
  for (const p of cast) {
    assert.equal((p.speechHabit ?? []).length, 2, `${p.name} 缺说话习惯`);
    const system = room.systemForRoom(p, cast);
    assert.ok(system.includes(p.speechHabit[0]), '说话习惯要进系统提示');
  }
  const all = new Set(cast.flatMap((p) => p.speechHabit ?? []));
  assert.ok(all.size >= 4, '四个人的口癖不该一样');
});

test('新房间只排一条「欢迎新人」，不是四个人先自己聊起来', () => {
  const fresh = room.newRoom(generateCast(4, NOW), NOW);
  assert.equal(fresh.scheduled.length, 1);
  assert.equal(fresh.scheduled[0].intent, 'welcome');
});

test('群名默认是「你 + 群友昵称」，改过之后不再自动生成', () => {
  const cast = generateCast(4, NOW);
  const title = room.defaultRoomTitle('小安', cast);
  assert.ok(title.startsWith('小安、'), `群名应该从你开始：${title}`);
  assert.ok(title.includes(cast[0].name) && title.includes(cast[1].name));
  assert.ok(title.includes('等 5 人'), `人多应该折叠：${title}`);

  const created = room.newRoom(cast, NOW, '小安');
  assert.equal(created.title, title);
  assert.ok(!created.titleEdited);

  const renamed = room.renameRoom(created, '  考研搭子  ');
  assert.equal(renamed.title, '考研搭子');
  assert.equal(renamed.titleEdited, true);
  assert.equal(room.ensureRoomTitle(renamed, '小安').title, '考研搭子', '改过的名字不该被覆盖');

  const legacy = { ...created, title: '晚自习后' };
  assert.equal(room.ensureRoomTitle(legacy, '小安').title, title, '旧的地点名应该被换成新写法');
});

test('你说话之后，排着的 AI 互聊要让位', () => {
  const base = freshRoom();
  const withPeer = {
    ...base,
    scheduled: [{ id: 'p1', personaId: base.cast[0].id, at: NOW + 5_000, intent: 'peer', depth: 1 }],
  };
  const sent = room.postPlayerMessage(withPeer, '大家好', ME, [], undefined, NOW, 0.5);
  assert.ok(!sent.scheduled.some((s) => s.intent === 'peer'), '不该继续排 AI 互聊');
  assert.ok(sent.scheduled.some((s) => s.intent === 'reply'), '应该有人回你');
});

test('打招呼时要求先回招呼、报自己是谁', () => {
  const cast = generateCast(2, NOW);
  const reply = roomPrompt(cast, [], { mode: 'reply', replyName: '我' });
  assert.ok(reply.includes('先把他这句话接住'), '回复要先接住对方那句');
  const welcome = roomPrompt(cast, [], { mode: 'welcome' });
  assert.ok(welcome.includes('名字、专业、年级'), '开场要自报家门');
});

test('接完玩家的招呼之后，不再立刻冒出 AI 互聊', async () => {
  const config = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };
  const settings = { liveliness: 0.9, timeFlow: false, dailyMessages: 400 };
  let current = room.postPlayerMessage(freshRoom(), '大家好', ME, [], undefined, NOW, 0.9);
  let cursor = NOW;
  for (let i = 0; i < 8 && current.scheduled.length > 0; i++) {
    cursor += 8_000;
    const out = await room.tickRoom({ room: current, settings, config, now: cursor });
    current = out.room;
    assert.ok(
      !current.scheduled.some((s) => s.intent === 'peer'),
      `第 ${i + 1} 次 tick 又排了 AI 互聊`,
    );
  }
  const spoken = current.messages.filter((m) => m.authorKind === 'persona');
  assert.ok(spoken.length >= 1, '至少要有人回你');
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
