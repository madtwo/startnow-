'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('decompose has explicit restart/clear controls and removes the saved draft', () => {
  const sheet = read('src/components/DecomposeSheet.tsx');
  assert.match(sheet, /const resetDecompose =/);
  assert.match(sheet, /重新拆解/);
  assert.match(sheet, /清空草稿/);
  assert.match(sheet, /localStorage\.removeItem\(DECOMPOSE_DRAFT_KEY\)/);
});

test('browser back/forward is wired to the app view state', () => {
  const app = read('src/App.tsx');
  assert.match(app, /window\.history\.pushState/);
  assert.match(app, /addEventListener\('popstate'/);
  assert.match(app, /onBack=\{\(\) => window\.history\.back\(\)\}/);
});
