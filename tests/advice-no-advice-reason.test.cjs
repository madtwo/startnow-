/** Offline diagnostic for the two no-advice reasons; no API call. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./_ts-loader.cjs');
const { askForAdvice } = require('../src/lib/cards.ts');
const { defaultPersonas } = require('../src/lib/personas.ts');
const { defaultSettings } = require('../src/lib/store.ts');

const now = 1795000000000;
const settings = { ...defaultSettings, maxCallsPerTick: 3 };
const config = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };
const persona = defaultPersonas().find((row) => row.id === 'weini');

function card(overrides = {}) {
  return {
    id: 'target', authorId: 'me', authorName: '小安', authorKind: 'player', kind: 'worry',
    text: '', createdAt: now - 60_000, status: 'stuck', arrivals: ['weini'],
    plan: [], pending: [], comments: [], ...overrides,
  };
}
function prior(id, actionId) {
  return card({
    id, text: '过去的一张合成卡',
    advice: { text: '旧建议', actionId, fromPersonaId: 'weini', accepted: false, at: now - 1_000 },
  });
}

test('missing preset is logged separately from 24h cooldown', async () => {
  const target = card({
    id: 'missing-preset',
    text: '导师在群里点名让我下周汇报，我一想到要讲就手心出汗。',
  });
  const out = await askForAdvice({
    cards: [target], personas: defaultPersonas(), settings, config, now,
    cardId: target.id, personaId: 'weini',
  });
  assert.ok(out.logs.includes('no_advice_reason=no_matching_preset'), out.logs.join('\n'));
  assert.ok(out.cards[0].comments.at(-1).text.includes('没找到更贴合'));
});

test('all matching presets used by 24h history gets its own reason', async () => {
  const target = card({
    id: 'cooled-down',
    text: '室友总是凌晨打游戏，说了两次还是那样，我今晚又没睡着。',
  });
  const cards = [
    target,
    prior('old-clarify', 'peer-clarify-2'),
    prior('old-topic', 'peer-topic-2'),
    prior('old-boundary', 'peer-boundary-2'),
  ];
  const out = await askForAdvice({
    cards, personas: defaultPersonas(), settings, config, now,
    cardId: target.id, personaId: 'weini',
  });
  assert.ok(out.logs.includes('no_advice_reason=all_matching_used_24h'), out.logs.join('\n'));
  assert.ok(out.cards[0].comments.at(-1).text.includes('没找到更贴合'));
});
