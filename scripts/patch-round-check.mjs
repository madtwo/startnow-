#!/usr/bin/env node
/**
 * One patch round: dry-run patches, run the full gate, write a receipt.
 * Usage:
 *   node scripts/patch-round-check.mjs "D:\下载\some-patch-kit.zip" [--apply]
 *   node scripts/patch-round-check.mjs ./path/to/kit-dir      [--apply] [--skip-full]
 * --apply    apply patches that passed --check (never commits)
 * --skip-full skip npm run test:all (only targeted checks)
 * Never touches API keys; never commits or pushes.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
const apply = process.argv.includes('--apply');
const skipFull = process.argv.includes('--skip-full');
if (!input) {
  console.error('usage: node scripts/patch-round-check.mjs <zip|dir> [--apply] [--skip-full]');
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const outRoot = join(root, 'patch-round-receipts', stamp);
mkdirSync(outRoot, { recursive: true });

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: opts.timeout ?? 900_000, shell: false });
  const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { code: res.status ?? -1, text, error: res.error?.message };
};
const write = (name, text) => writeFileSync(join(outRoot, name), text, 'utf8');

// 1) Unpack when needed.
const absInput = resolve(input);
let kitDir = absInput;
if (statSync(absInput).isFile()) {
  kitDir = join(tmpdir(), `startnow-kit-${Date.now()}`);
  mkdirSync(kitDir, { recursive: true });
  const untar = run('tar', ['-xf', absInput, '-C', kitDir]);
  if (untar.code !== 0) {
    const py = run('python', ['-c',
      'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', absInput, kitDir]);
    if (py.code !== 0) {
      write('summary.md', `# Patch round\n\n- input: ${absInput}\n- FAILED to unpack\n\n\`\`\`\n${untar.text}\n${py.text}\n\`\`\`\n`);
      console.error('cannot unpack input');
      process.exit(1);
    }
  }
}

// 2) Dry-run every patch file.
const findPatches = (dir, depth = 0) => {
  const out = [];
  if (depth > 3) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...findPatches(path, depth + 1));
    else if (name.endsWith('.patch') || name.endsWith('.diff')) out.push(path);
  }
  return out;
};
const patches = findPatches(kitDir);
const checks = patches.map((patch) => ({ patch, res: run('git', ['apply', '--check', '--stat', patch]) }));
const applyResults = [];
if (apply) {
  for (const row of checks.filter((r) => r.res.code === 0)) {
    applyResults.push({ patch: row.patch, res: run('git', ['apply', row.patch]) });
  }
}
write('patch-check.txt', checks.map((r) =>
  `## ${basename(r.patch)}\nexit=${r.res.code}\n${r.res.text}`).join('\n'));

// 3) Gate.
const gates = [];
const gate = (name, cmd, args, opts) => {
  const res = run(cmd, args, opts);
  gates.push({ name, res });
  write(`${name}.log`, res.text);
  return res;
};
// npm/npx are .cmd shims on Windows and need a shell; spawning them directly fails with EINVAL.
const npmRun = (script) => process.platform === 'win32'
  ? ['cmd.exe', ['/c', 'npm', 'run', script]]
  : ['npm', ['run', script]];
if (!skipFull) gate('test-all', ...npmRun('test:all'));
gate('tsc', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
gate('build', ...npmRun('build'));
gate('action-fit', process.execPath, ['--no-warnings', '--experimental-strip-types', 'scripts/check-action-fit.mjs']);

// 4) Receipt.
const passOf = (text) => (text.match(/^ℹ pass (\d+)/m) ?? [])[1] ?? '?';
const failOf = (text) => (text.match(/^ℹ fail (\d+)/m) ?? [])[1] ?? '?';
const failed = checks.filter((r) => r.res.code !== 0).length +
  (apply ? applyResults.filter((r) => r.res.code !== 0).length : 0) +
  gates.filter((g) => g.res.code !== 0).length;
const testGate = gates.find((g) => g.name === 'test-all');
const lines = [
  '# Patch round receipt', '',
  `- time: ${new Date().toISOString()}`,
  `- input: ${absInput}`,
  `- kit: ${kitDir}`,
  `- patches: ${patches.length}（check 失败 ${checks.filter((r) => r.res.code !== 0).length}）`,
  `- applied: ${apply ? applyResults.filter((r) => r.res.code === 0).length : 'no（dry-run only）'}`,
  testGate ? `- tests: pass ${passOf(testGate.res.text)} / fail ${failOf(testGate.res.text)}` : '- tests: skipped',
  ...gates.map((g) => `- ${g.name}: exit ${g.res.code}`),
  `- verdict: ${failed === 0 ? 'PASS' : 'FAIL'}`,
  '', '## Patch check', '', '```', checks.map((r) => `${basename(r.patch)} exit=${r.res.code}`).join('\n') || '(none)', '```',
  '', '## Notes', '',
  '- 未提交、未推送。真实 API / 浏览器 / 375px 不在本脚本范围，需另跑。',
  '- 若 patch check 失败，先看 patch-check.txt 与对应 hunk；不要强推。',
];
write('summary.md', lines.join('\n'));
console.log(lines.join('\n'));
process.exit(failed === 0 ? 0 : 1);
