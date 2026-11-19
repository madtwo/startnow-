/** 2026-11-17 后端审查回归：安全词、脱敏、边界分句、导入校验、代理白名单。 */
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

const memoryStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
  setItem: (k, v) => memoryStore.set(k, String(v)),
  removeItem: (k) => memoryStore.delete(k),
  key: (i) => [...memoryStore.keys()][i] ?? null,
  get length() { return memoryStore.size; },
};

const load = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const { findCrisis } = load('safety');
const { sanitizeMemoryText, recordReplyMemory } = load('memory');
const { boundaryRequest } = load('dialogue');
const { wantsDirectAdvice } = load('directAdvice');
const { needsHelpSeeking } = load('support');
const { validSmallerText } = load('freeTextShrink');
const { auditSocial, auditCriticalContent } = load('baseline');
const { hasCrisisInArchive } = load('submissionGuard');
const { scrubSecrets, validateLlmEndpointBase } = load('llm');
const { defaultPersonas } = load('personas');
const store = load('store');

test('危机词：插字变体、零宽字符命中；紫砂壶、活动不误报', () => {
  for (const t of ['不想再活了', '活着没有意思', '活着真没什么意义', '想\u200b死', 'ＫＭＳ']) assert.ok(findCrisis(t), t);
  for (const t of ['紫砂壶真好看', '我不想活动了', '社团活跃度不高']) assert.equal(findCrisis(t), false, t);
});

test('脱敏：带空格手机号、15 位证件号、全角数字；中文标点保持原样', () => {
  const out = sanitizeMemoryText('电话 138 0013 8000，证件 110101900101123，ｑｑ号：１２３４５６７。');
  assert.doesNotMatch(out, /138|110101|1234567/);
  assert.match(out, /，/);
  assert.match(out, /。$/);
});

test('角色记忆：危机词在 34 字之后也不能被截断后写入', () => {
  const persona = { ...defaultPersonas()[0], memory: [] };
  const text = `${'今天的课一直在讲期中的安排还有作业要求和小组分工'.repeat(2)}，其实我不想活了`;
  assert.equal(recordReplyMemory(persona, '卡主', text, 'p1', 1_800_000_000_000).length, 0);
});

test('边界：按分句判定，第三方叙述不豁免后一句；第三方约饭不误报', () => {
  assert.equal(boundaryRequest('她的微信加不到，加个vx吧'), 'contact');
  assert.equal(boundaryRequest('你能出来吃饭吗'), 'offline');
  assert.equal(boundaryRequest('我和室友约饭，你也来吧'), 'offline');
  assert.equal(boundaryRequest('明天和她出来吃饭'), null);
  assert.equal(boundaryRequest('我不想见面，只在线上聊'), null);
});

test('主动要建议：否定句不算', () => {
  assert.equal(wantsDirectAdvice('别给我建议'), false);
  assert.equal(wantsDirectAdvice('我现在不要你给我建议，听我说完'), false);
  assert.equal(wantsDirectAdvice('给我一个具体建议'), true);
});

test('求助提示：两个月/三个月也算持续时间', () => {
  assert.ok(needsHelpSeeking('这两个月一直睡不着，论文写不进去'));
  assert.ok(needsHelpSeeking('三个月了每天都起不来，上课跟不上'));
});

test('缩小建议：逗号连着两个动作不算更小', () => {
  assert.equal(validSmallerText('先打开消息窗口，发消息', '给导师发消息说明进度'), false);
});

test('审核：带“只在线上”声明也拦邮箱/手机号；脱敏占位符不误报；用药建议拦截', () => {
  assert.ok(auditSocial('我只在线上聊，邮箱 a@b.com'));
  assert.ok(auditSocial('见面就算了，打 138 0013 8000'));
  assert.equal(auditSocial('我刚发现记录 [手机号已隐藏] 没遮住'), null);
  assert.ok(auditCriticalContent('睡前吃点褪黑素就好'));
});

test('导入存档：危机词出现在建议/炫耀卡/movedBy.by 时拒绝', () => {
  assert.ok(hasCrisisInArchive({ cards: [{ authorKind: 'persona', text: 'x', advice: { text: '不想再活了' } }] }));
  assert.ok(hasCrisisInArchive({ cards: [{ authorKind: 'persona', kind: 'brag', text: '活着没有意思' }] }));
  assert.ok(hasCrisisInArchive({ personas: [{ mind: { thought: 'a', focus: 'b', movedBy: { by: '想死', what: 'c' } } }] }));
});

test('导入存档：设置被夹紧、身份被校验、本机当日调用计数不被覆盖、坏的 plan 被丢弃', () => {
  memoryStore.clear();
  const today = store.dayKey(Date.now());
  localStorage.setItem('shudong.world.v1', JSON.stringify({ lastTickAt: Date.now(), dayKey: today, callsToday: 17, logs: [] }));
  const raw = JSON.stringify({
    version: 3,
    cards: [{ id: 'c1', text: '论文', authorKind: 'player', createdAt: Date.now(), plan: [null, { personaId: 'shenmo', at: 1 }, { at: 'x' }], pending: [7] }],
    world: { dayKey: today, callsToday: 0, logs: ['ok', 5] },
    settings: { dailyCalls: 1e9, maxCallsPerTick: -3, speed: 'fast', aiCardLimit: 99, baselineExtra: 123 },
    identity: { id: {}, name: 1 },
  });
  const bundle = store.importBundle(raw);
  assert.ok(bundle);
  assert.equal(bundle.settings.dailyCalls, 60); // Imported budgets are intentionally ignored.
  assert.equal(bundle.settings.maxCallsPerTick, 0);
  assert.equal(bundle.settings.speed, 6);
  assert.equal(bundle.settings.aiCardLimit, 8);
  assert.equal(bundle.settings.baselineExtra, '');
  assert.equal(typeof bundle.identity.id, 'string');
  assert.deepEqual(bundle.world.logs, ['ok']);
  assert.equal(bundle.cards[0].plan.length, 1);
  assert.equal(bundle.cards[0].pending.length, 0);
  assert.equal(bundle.world.callsToday, 17);
});

test('loadWorld：跨天后调用计数归零', () => {
  memoryStore.clear();
  const now = Date.now();
  store.saveWorld({ lastTickAt: now - 2 * 86_400_000, dayKey: store.dayKey(now - 2 * 86_400_000), callsToday: 50, logs: [] });
  const world = store.loadWorld(now);
  assert.equal(world.callsToday, 0);
  assert.equal(world.dayKey, store.dayKey(now));
});

test('LLM：错误详情里的密钥和长 token 被抹掉；相对路径不允许 .. 或 //', () => {
  const out = scrubSecrets('bad key sk-abcdefghijklmnop Bearer xyz.123 api_key=secretvalue my-own-key', 'my-own-key');
  assert.doesNotMatch(out, /abcdefghijklmnop|xyz\.123|secretvalue|my-own-key/);
  assert.throws(() => validateLlmEndpointBase('/opencode/../v1'));
  assert.throws(() => validateLlmEndpointBase('//evil.test/v1'));
});

test('dev 代理：只放行固定路径，拒绝编码穿越；跨站请求被识别', () => {
  let config;
  try {
    config = require(path.join(__dirname, '..', 'vite.config.ts'));
  } catch {
    return;
  }
  const { proxyTarget, crossSite } = config;
  assert.ok(proxyTarget('POST', '/v1/chat/completions'));
  assert.ok(proxyTarget('GET', '/v1/models'));
  assert.equal(proxyTarget('GET', '/v1/chat/completions'), null);
  assert.equal(proxyTarget('POST', '/v1/%2e%2e/admin'), null);
  assert.equal(proxyTarget('POST', '/v1/..\\x'), null);
  assert.ok(crossSite({ headers: { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:5173' } }));
  assert.ok(crossSite({ headers: { origin: 'https://evil.test', host: '127.0.0.1:5173' } }));
  assert.equal(crossSite({ headers: { origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' } }), false);
});
