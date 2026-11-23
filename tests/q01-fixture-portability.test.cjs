/** Synthetic fixture transport checks only. Never a human Q01 signoff. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gate = require('../scripts/q01-human-review-gate.cjs');

for (const [filename, expectedSha] of gate.FIXTURES) {
  test(`Q01 pinned ${filename} survives LF/CRLF transport without changing content`, () => {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', filename));
    const lf = Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    const crlf = Buffer.from(lf.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    assert.equal(gate.pinnedFixtureSha(lf), expectedSha);
    assert.equal(gate.pinnedFixtureSha(crlf), expectedSha);
    assert.notEqual(gate.pinnedFixtureSha(Buffer.concat([lf, Buffer.from(' ')])), expectedSha);
    assert.notEqual(gate.pinnedFixtureSha(Buffer.from(lf.toString('utf8').replace('"expected"', '"guess"'))), expectedSha);
    assert.notEqual(gate.pinnedFixtureSha(Buffer.from(lf.toString('utf8').replace(/\n/g, '\r'))), expectedSha);
  });
}

test('Q01 frozen SHA verification stays strict and separate from its runtime pin', () => {
  const all = gate.loadFixtures(path.join(__dirname, 'fixtures'));
  assert.equal(all.all.length, 98);
  assert.equal(Object.keys(all.hashes).length, 3);
  for (const [filename, expectedSha] of gate.FIXTURES) {
    assert.equal(all.hashes[filename], expectedSha);
  }
  // Runtime pin is NOT updated here. Coordinator rebaseline is separate.
});
