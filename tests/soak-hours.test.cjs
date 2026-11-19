/** 2026-11-18 长时段仿真：模拟“关掉页面、几小时后回来”的多次会话。
 * 目的：确认隔几小时回来时，回信能补上、AI 能继续发卡、炫耀卡按规则出现，且不越额度。
 * 全部使用 mock 模型和固定随机种子，可重复运行；不触碰前端组件。
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
const cardsLib = load('cards');
const store = load('store');
const { defaultPersonas } = load('personas');

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const TICK_MS = 4000;
const mockConfig = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };

// 固定种子，保证失败可复现。
const seededRandom = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const uniqueIds = (list) => new Set(list).size === list.length;

function assertInvariants(cards, personas, settings, now, label) {
  const ids = cards.map((c) => c.id);
  assert.ok(uniqueIds(ids), `${label}: 卡片 id 重复`);
  for (const card of cards) {
    assert.ok(uniqueIds(card.comments.map((c) => c.id)), `${label}: 评论 id 重复 @${card.id}`);
    for (const item of card.plan) assert.ok(item.at >= card.createdAt - 1, `${label}: 到场计划早于卡片创建`);
    if (card.pendingBrag) {
      assert.equal(card.authorKind, 'persona', `${label}: 玩家卡不该有待发炫耀`);
      assert.ok(card.pendingBrag.dueAt >= card.pendingBrag.acceptedAt, `${label}: 炫耀排期早于接受时间`);
    }
    // 硬规则：新烦恼卡发布后，旧烦恼的炫耀卡不再出现（按角色）。
    if (card.kind === 'brag' && card.sourceCardId) {
      const source = cards.find((c) => c.id === card.sourceCardId);
      if (source) {
        const newer = cards.some((c) =>
          c.id !== source.id && c.authorId === source.authorId && c.kind !== 'brag' &&
          c.createdAt > source.createdAt && c.createdAt <= card.createdAt);
        assert.equal(newer, false, `${label}: ${card.authorName} 的新烦恼之后仍发了旧炫耀`);
      }
    }
  }
  // 滚动 24 小时额度：非自我介绍、非炫耀的 AI 卡，任意滑窗不超过配置上限。
  const quota = Math.max(0, Math.min(8, Math.floor(settings.aiCardLimit)));
  const worries = cards.filter((c) => c.authorKind === 'persona' && !c.intro && c.kind !== 'brag' && c.createdAt <= now);
  for (const anchor of worries) {
    const inWindow = worries.filter((c) => c.createdAt > anchor.createdAt - DAY && c.createdAt <= anchor.createdAt);
    assert.ok(inWindow.length <= quota || quota === 0, `${label}: 24 小时窗口内发了 ${inWindow.length} 张卡，超过 ${quota}`);
  }
  for (const persona of personas) {
    const own = worries.filter((c) => c.authorId === persona.id).sort((a, b) => a.createdAt - b.createdAt);
    // 演示模式文案池有限：只要求 6 小时内不复读（超过 6 小时允许复用旧文案）。
    for (let i = 1; i < own.length; i++) {
      const recent = own.slice(0, i).filter((c) => c.createdAt > own[i].createdAt - 6 * 60 * 60_000);
      assert.equal(recent.some((c) => c.text === own[i].text), false,
        `${label}: ${persona.name} 6 小时内发了重复卡`);
    }
  }
  // 额度按天摊开：相邻两张 AI 烦恼卡至少间隔 24h/额度。
  if (quota > 0) {
    const spread = 86_400_000 / quota;
    const sorted = [...worries].sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].createdAt - sorted[i - 1].createdAt >= spread - 1,
        `${label}: 两张 AI 卡只隔了 ${Math.round((sorted[i].createdAt - sorted[i - 1].createdAt) / 60_000)} 分钟，少于 ${spread / 3_600_000} 小时`);
    }
  }
}

test('长时段仿真：关掉几小时再回来，回信/发卡/炫耀都正常，且不越额度', async () => {
  const originalRandom = Math.random;
  Math.random = seededRandom(20261118);
  try {
    let now = new Date('2026-11-18T09:00:00+08:00').getTime();
    const settings = { ...store.defaultSettings, aiCardLimit: 4, maxCallsPerTick: 2, speed: 1, dailyCalls: 60 };
    let cards = [];
    let personas = defaultPersonas().map((p) => ({ ...p, memory: [], weekLog: [] }));

    const tickOnce = async (label) => {
      const out = await cardsLib.tickCards({ cards, personas, settings, config: mockConfig, now });
      assert.ok(out.calls <= 6, `${label}: 单次推进调用 ${out.calls} 次，超过 mock 上限`);
      cards = out.cards;
      personas = out.personas;
      now += TICK_MS;
      assertInvariants(cards, personas, settings, now, label);
      return out;
    };
    const session = async (label, ticks = 15) => {
      for (let i = 0; i < ticks; i++) await tickOnce(label);
      assertInvariants(cards, personas, settings, now, `${label} 结束`);
    };

    // 第一次打开：发完卡就关掉页面（只跑 3 次推进，模拟“发出去不用守着”）。
    let mine = cardsLib.createPlayerCard('开题报告写不出来，导师说明天要看', '小安', personas, settings, undefined, now);
    cards = [mine, ...cards];
    await session('首次打开', 3);
    const afterQuickLook = cards.find((c) => c.id === mine.id);

    // 关掉 3 小时再回来：排队中的到场和回复应补上。
    now += 3 * HOUR;
    const beforeComments = afterQuickLook.comments.length;
    await session('3 小时后', 15);
    const returned = cards.find((c) => c.id === mine.id);
    assert.ok(returned.comments.length > beforeComments, '3 小时后回来应补到新回复');
    assert.ok(returned.comments.some((c) => c.authorKind === 'persona'), '3 小时后回来应看到角色到场');
    assert.equal(returned.plan.length, 0, '过期到场计划应全部执行完');
    assert.ok(cards.some((c) => c.authorKind === 'persona' && !c.intro && c.kind !== 'brag'),
      '3 小时后回来，论坛里应有 AI 的新卡');

    // 用户回一句，线程继续。
    cards = cards.map((c) => c.id === mine.id
      ? cardsLib.addPlayerComment(c, '我试着列了三个点，但都不满意', now, settings.speed, 'comment', 'shenmo')
      : c);
    now += 2 * MIN;
    await session('回复后', 15);
    const thread = cards.find((c) => c.id === mine.id);
    assert.ok(thread.comments.some((c) => c.authorKind === 'player' && c.text.includes('三个点')), '玩家评论应保留');
    assert.ok(thread.comments.filter((c) => c.authorKind === 'persona').length >= 2, '应收到第二条回复');

    // 关键路径：给 AI 的卡提建议 → 角色决定 → 过一段时间发表演卡。
    now += 6 * HOUR;
    await session('12 小时点', 20);
    const target = cards.find((c) => c.authorKind === 'persona' && c.kind !== 'brag' && !c.intro &&
      c.status !== 'done' && c.status !== 'handled' && !c.advice);
    if (target) {
      cards = cards.map((c) => c.id === target.id
        ? cardsLib.addPlayerComment(c, '要不先只写一句标题？', now, settings.speed, 'advice', target.authorId)
        : c);
      now += MIN;
      await session('提交建议后', 20);
    }

    // 再隔几小时回来若干次，跨过两次“隔夜”。
    for (const [label, gap] of [['隔夜', 12], ['第二天', 24], ['第三天', 24]]) {
      now += gap * HOUR;
      await session(label, 20);
    }

    // 汇总断言
    const mineFinal = cards.find((c) => c.id === mine.id);
    assert.ok(['arrived', 'talking', 'advised', 'done', 'handled'].includes(mineFinal.status),
      `玩家卡状态异常：${mineFinal.status}`);

    const aiWorries = cards.filter((c) => c.authorKind === 'persona' && !c.intro && c.kind !== 'brag');
    assert.ok(aiWorries.length >= 4, `长时段内应持续出现 AI 烦恼卡，实际 ${aiWorries.length} 张`);
    // 每隔几小时回来，应该能看到“这几天里有新卡”，而不是全部挤在第一小时。
    const hours = aiWorries.map((c) => (c.createdAt - new Date('2026-11-18T09:00:00+08:00').getTime()) / HOUR);
    assert.ok(hours.some((h) => h >= 6), `新卡只出现在前 6 小时：${hours.map((h) => h.toFixed(1)).join(',')}`);

    const decisions = cards.flatMap((c) => c.comments.filter((x) => x.authorKind === 'persona' && x.replyTo));
    assert.ok(decisions.length >= 1, '给 AI 的建议应得到角色回应');

    const brags = cards.filter((c) => c.kind === 'brag');
    // 固定种子下 mock 接受率为 70%；这里断言不超过源卡数量，且每张源卡最多一张炫耀。
    const sources = brags.map((b) => b.sourceCardId);
    assert.ok(uniqueIds(sources), '同一张源卡不应发两张炫耀');
    for (const brag of brags) {
      const source = cards.find((c) => c.id === brag.sourceCardId);
      assert.ok(source, '炫耀卡必须能追溯到源卡');
      assert.ok(brag.createdAt >= source.createdAt, '炫耀卡不能早于源卡');
    }

    // 存档往返：JSON 序列化后继续推进不崩，id 不重复。
    const roundTrip = JSON.parse(JSON.stringify({ cards, personas }));
    cards = roundTrip.cards;
    personas = roundTrip.personas;
    now += 2 * HOUR;
    await session('存档往返后', 10);
  } finally {
    Math.random = originalRandom;
  }
});

test('长时段仿真：额度为 0 时只停新烦恼，既有排期炫耀仍会发', async () => {
  const originalRandom = Math.random;
  Math.random = seededRandom(777);
  try {
    let now = new Date('2026-11-18T20:00:00+08:00').getTime();
    const settings = { ...store.defaultSettings, aiCardLimit: 4, maxCallsPerTick: 2, speed: 6 };
    let personas = defaultPersonas().map((p) => ({ ...p, memory: [], weekLog: [] }));
    // 构造一张已经接受建议、排期到一小时后发布的卡。
    const author = personas[0];
    let card = {
      ...cardsLib.personaCard(author, now - 2 * HOUR),
      status: 'advised',
      advice: { text: '先打开文档写一行', fromPersonaId: 'me', at: now - HOUR, accepted: true },
      pendingBrag: { adviceText: '先打开文档写一行', acceptedAt: now - HOUR, dueAt: now + HOUR, sourceCommentId: 'c1' },
    };
    let cards = [card];
    const off = { ...settings, aiCardLimit: 0 };
    for (let i = 0; i < 20; i++) {
      const out = await cardsLib.tickCards({ cards, personas, settings: off, config: mockConfig, now });
      cards = out.cards; personas = out.personas; now += TICK_MS;
    }
    now += 2 * HOUR; // 关掉两小时后回来
    for (let i = 0; i < 20; i++) {
      const out = await cardsLib.tickCards({ cards, personas, settings: off, config: mockConfig, now });
      cards = out.cards; personas = out.personas; now += TICK_MS;
    }
    assert.equal(cards.filter((c) => c.authorKind === 'persona' && !c.intro && c.kind !== 'brag').length, 1,
      '额度为 0 时不应再发新烦恼');
    assert.equal(cards.filter((c) => c.kind === 'brag').length, 1, '既有排期炫耀应照常发布');
    assertInvariants(cards, personas, off, now, '额度为 0');
  } finally {
    Math.random = originalRandom;
  }
});
