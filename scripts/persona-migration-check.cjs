#!/usr/bin/env node
/** Browser-level check: a saved v1 persona archive upgrades on app load. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('evidence/persona-migration');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-migrate-'));
const legacy = fs.readFileSync(path.resolve('exports/safety/legacy-personas-v1.json'), 'utf8');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new', userDataDir: profile,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate((raw) => {
    localStorage.setItem('startnow.onboarded', '1');
    localStorage.setItem('startnow.guideDismissed', '1');
    localStorage.setItem('shudong.personas.v3', raw);
    localStorage.removeItem('shudong.personaSchema.v1');
  }, legacy);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const result = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('shudong.personas.v3') || '[]');
    const shenmo = rows.find((p) => p.id === 'shenmo');
    return {
      shenmoTagline: shenmo?.tagline,
      shenmoBackground: shenmo?.background?.slice(0, 60),
      weiniApproach: rows.find((p) => p.id === 'weini')?.approach?.slice(0, 50),
      intimacy: shenmo?.intimacy,
      hasOldMemory: Boolean(shenmo?.memory?.some((m) => m.what === '旧记忆一句')),
      schemaVersion: localStorage.getItem('shudong.personaSchema.v1'),
      oldTextLeft: rows.some((p) => p.tagline === '临床大三，感情和学习都在拖'),
    };
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), [
    '# 人设 v1 → v2 浏览器迁移检查', '',
    `- 旧 tagline 仍存在: ${result.oldTextLeft ? '是 ❌' : '否 ✅'}`,
    `- 沈默 tagline: ${result.shenmoTagline}`,
    `- 沈默 background: ${result.shenmoBackground}…`,
    `- 魏霓 approach: ${result.weiniApproach}…`,
    `- 记忆保留: ${result.hasOldMemory ? '是 ✅' : '否 ❌'}`,
    `- 熟度保留: ${result.intimacy}`,
    `- schema: ${result.schemaVersion}`,
    '',
  ].join('\n'), 'utf8');
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => { console.error(err); process.exit(1); });
