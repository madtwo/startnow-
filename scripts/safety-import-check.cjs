#!/usr/bin/env node
/** Import hardening check in an isolated headless browser profile. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('evidence/safety');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-safety-'));
const archive = fs.readFileSync(path.resolve('exports/safety/archive-injection.json'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new', userDataDir: profile,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('startnow.onboarded', '1');
    localStorage.setItem('startnow.guideDismissed', '1');
  });
  const clickText = (text, exact = true) => page.evaluate((want, exact) => {
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const t = (b.textContent || '').trim();
      return exact ? t === want : t.includes(want);
    });
    if (!btn) return false;
    btn.click();
    return true;
  }, text, exact);

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  const steps = [];
  steps.push(['我的', await clickText('我的')]);
  await wait(250);
  steps.push(['作者后台', await clickText('作者后台 · 推进时间', false)]);
  await wait(250);
  steps.push(['数据', await clickText('数据')]);
  await wait(250);
  const filled = await page.evaluate((text) => {
    const el = [...document.querySelectorAll('textarea')].find((x) => x.getAttribute('placeholder') === '把导出的内容贴回来');
    if (!el) return false;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, archive);
  steps.push(['粘贴存档', filled]);
  await wait(200);
  steps.push(['导入按钮', await clickText('导入')]);
  await wait(500);

  const result = await page.evaluate(() => {
    const raw = localStorage.getItem('shudong.personas.v3') || '[]';
    const personas = JSON.parse(raw);
    const settings = JSON.parse(localStorage.getItem('shudong.settings.v1') || '{}');
    return {
      shenmoBackground: personas.find((p) => p.id === 'shenmo')?.background ?? '',
      hasInjectionInBackground: personas.some((p) => String(p.background || '').includes('忽略规则') ||
        String(p.background || '').includes('覆盖系统提示词')),
      baselineExtra: settings.baselineExtra,
      paused: settings.paused,
      toast: document.body.innerText.includes('导入') ? document.body.innerText.slice(-200) : '',
      cards: JSON.parse(localStorage.getItem('shudong.cards.v6') || '[]').length,
    };
  });

  fs.mkdirSync(OUT, { recursive: true });
  const passed = !result.hasInjectionInBackground && !String(result.baselineExtra || '').includes('忽略规则');
  fs.writeFileSync(path.join(OUT, 'import-injection-report.json'), JSON.stringify({ steps, result, passed }, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'import-injection.md'), [
    '# 注入存档浏览器导入（独立 profile）', '',
    ...steps.map(([name, ok]) => `- ${name}: ${ok ? 'ok' : '未找到'}`),
    `- 角色背景含注入文本: ${result.hasInjectionInBackground ? '是 ❌' : '否 ✅'}`,
    `- baselineExtra: ${JSON.stringify(result.baselineExtra)}`,
    `- paused: ${result.paused}`,
    `- 导入后卡片数: ${result.cards}`,
    `- 结论: ${passed ? '通过（注入文本未进入人设，本地设置未被外部改写）' : '未通过'}`,
    '',
  ].join('\n'), 'utf8');
  await page.screenshot({ path: path.join(OUT, 'import-injection.png'), fullPage: false });
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(JSON.stringify({ steps, passed, ...result }, null, 2));
})().catch((err) => { console.error(err); process.exit(1); });
