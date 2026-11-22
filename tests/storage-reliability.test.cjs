/** StartNow storage disaster-recovery regressions. Run via npm run test:baseline. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, file) => {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  mod._compile(js, file);
};
const store = require(path.join(__dirname, '..', 'src', 'lib', 'store.ts'));

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
  };
}
function sampleCard() {
  return {
    id: 'sample', authorId: 'me', authorName: '我', authorKind: 'player',
    text: '打开文档写下标题', createdAt: Date.now(), status: 'stuck',
    comments: [], arrivals: [], plan: [], pending: [],
  };
}

test('损坏卡片 JSON 原样保留、阻止自动覆盖，可下载原文后明确丢弃', () => {
  const original = '[{"private":"未闭合"';
  global.localStorage = fakeStorage({ 'shudong.cards.v6': original });
  assert.deepEqual(store.loadCards(), []);
  assert.deepEqual(store.listCorruptStorageKeys(), ['shudong.cards.v6']);
  store.saveCards([sampleCard()]); // mount autosave must NOT destroy original bytes
  assert.equal(global.localStorage.getItem('shudong.cards.v6'), original);
  const rescue = JSON.parse(store.exportCorruptStorage());
  assert.equal(rescue.format, 'startnow-corrupt-local-storage-v1');
  assert.deepEqual(rescue.entries, [{ key: 'shudong.cards.v6', raw: original }]);
  assert.deepEqual(store.discardCorruptStorage(), { removed: ['shudong.cards.v6'], failed: [] });
  store.saveCards([sampleCard()]);
  assert.equal(JSON.parse(global.localStorage.getItem('shudong.cards.v6')).length, 1);
  assert.deepEqual(store.listCorruptStorageKeys(), []);
});

test('损坏条目若被其他标签页更新，恢复操作拒绝删除新值', () => {
  const raw = '{bad';
  global.localStorage = fakeStorage({ 'shudong.goals.v1': raw });
  assert.deepEqual(store.loadGoals(), []);
  global.localStorage.setItem('shudong.goals.v1', JSON.stringify([]));
  assert.deepEqual(store.discardCorruptStorage(), { removed: [], failed: ['shudong.goals.v1'] });
  assert.equal(global.localStorage.getItem('shudong.goals.v1'), '[]');
  // Return original for cleanup, so no module-global state leaks into later tests.
  global.localStorage.setItem('shudong.goals.v1', raw);
  assert.deepEqual(store.discardCorruptStorage().failed, []);
});

test('合法 JSON 但根结构明显错误的存档也必须防止被静默覆盖', () => {
  const invalid = '{"not":"an array"}';
  global.localStorage = fakeStorage({ 'shudong.todos.v1': invalid });
  assert.deepEqual(store.loadTodos(), []);
  store.saveTodos([]);
  assert.equal(global.localStorage.getItem('shudong.todos.v1'), invalid);
  assert.deepEqual(store.discardCorruptStorage(), { removed: ['shudong.todos.v1'], failed: [] });
});

test('跨标签页变更一旦被发现，旧页面保存和清空都不会覆盖新数据', () => {
  global.localStorage = fakeStorage({
    'shudong.todos.v1': '[]',
    'shudong.config.v1': '{"providerId":"mock"}',
    'shudong.room.v1': '{"id":"room"}',
  });
  store.setStorageReadOnly(true);
  try {
    store.saveTodos([{ id: 't1', text: '搬动一本书', at: Date.now() }]);
    store.saveConfig({ providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' });
    store.saveRoom({ id: 'other-room' });
    assert.equal(global.localStorage.getItem('shudong.todos.v1'), '[]');
    assert.equal(global.localStorage.getItem('shudong.config.v1'), '{"providerId":"mock"}');
    assert.equal(global.localStorage.getItem('shudong.room.v1'), '{"id":"room"}');
    store.clearAll();
    assert.equal(global.localStorage.getItem('shudong.todos.v1'), '[]');
  } finally {
    store.setStorageReadOnly(false);
  }
  store.saveTodos([]);
  assert.equal(global.localStorage.getItem('shudong.todos.v1'), '[]');
});

test('隐私模式禁止存储时，首次打开仍能生成本地默认数据并记录持续警告', () => {
  global.localStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  assert.equal(store.isFirstRun(), true);
  assert.doesNotThrow(() => store.loadIdentity());
  let errorKey = '';
  store.setStorageErrorHandler((key) => { errorKey = key; });
  try {
    store.saveCards([sampleCard()]);
    assert.equal(errorKey, 'shudong.cards.v6');
    assert.ok(store.listFailedStorageKeys().includes('shudong.cards.v6'));
  } finally {
    store.setStorageErrorHandler(null);
  }
});

test('App 对本地数据错误使用持续可见备份入口，跨标签页改为阻断交互', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'storage-reliability.css'), 'utf8');
  assert.match(app, /setStorageReadOnly\(true\)/);
  assert.match(app, /summaries\|room\|archives\|roomsettings\|config/);
  assert.match(app, /otherTabWarning && \([\s\S]*?role="alertdialog" aria-modal="true"/);
  assert.match(app, /exportCorruptStorage\(\)/);
  assert.match(app, /discardCorruptStorage\(\)/);
  assert.match(app, /storageFailed && !otherTabWarning/);
  assert.match(css, /\.storage-conflict-backdrop\s*\{[\s\S]*?position:\s*fixed/);
  const entry = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');
  assert.match(entry, /downloadRawStorageBackup/);
  assert.match(entry, /confirm\('确定永久清空/);
});

test('日程视图与拆解成功后的草稿清理不因禁用 localStorage 而崩溃', () => {
  const schedule = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ScheduleView.tsx'), 'utf8');
  const sheet = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DecomposeSheet.tsx'), 'utf8');
  assert.match(schedule, /try\s*\{\s*return localStorage\.getItem\(MODE_KEY\)/);
  assert.match(schedule, /try\s*\{\s*localStorage\.setItem\(MODE_KEY, next\);\s*\}\s*catch/);
  assert.match(sheet, /onSave\([\s\S]*?try \{ localStorage\.removeItem\(DECOMPOSE_DRAFT_KEY\); \} catch/);
});
