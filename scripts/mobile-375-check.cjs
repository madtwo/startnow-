#!/usr/bin/env node
/** Real 375px viewport check in an isolated headless Edge instance.
 * Never touches the user's browser profile or running app tab.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve('evidence/mobile-375');
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'startnow-mobile-'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    userDataDir: profile,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('startnow.onboarded', '1');
    localStorage.setItem('startnow.guideDismissed', '1');
  });
  const findings = [];
  const clickText = async (text, exact = true) => page.evaluate((want, exact) => {
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const t = (b.textContent || '').trim();
      return exact ? t === want : t.includes(want);
    });
    if (!btn) return false;
    btn.click();
    return true;
  }, text, exact);
  const closeOverlays = async () => {
    for (const label of ['知道了', '关闭提示', '关闭', '跳过']) {
      await page.evaluate((want) => {
        const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === want);
        if (btn) btn.click();
      }, label);
    }
    await wait(150);
  };
  const inspect = async (name) => {
    await wait(350);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const wide = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.right > vw + 1;
      }).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
      const small = [...document.querySelectorAll('button')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.width < 44 || r.height < 44);
      }).slice(0, 6).map((el) => `${(el.textContent || '').trim().slice(0, 12)}|${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
      return {
        viewport: vw,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
        wideElements: wide,
        smallTargets: small,
        title: document.title,
        textHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120),
      };
    });
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    findings.push({ name, ...m });
    return m;
  };

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await closeOverlays();
  await inspect('home');
  if (await clickText('发一张卡')) { await closeOverlays(); await inspect('post-form'); }
  if (await clickText('日程')) { await closeOverlays(); await inspect('schedule'); }
  if (await clickText('论坛')) { await closeOverlays(); await inspect('forum'); }
  const opened = await page.evaluate(() => {
    const card = document.querySelector('article');
    if (!card) return false;
    card.click();
    return true;
  });
  if (opened) { await closeOverlays(); await inspect('card-detail'); await clickText('← 返回', false); }
  if (await clickText('试试')) {
    await closeOverlays();
    if (await clickText('拆解一个目标')) { await closeOverlays(); await inspect('decompose'); await clickText('取消'); }
    const goal = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /查看详情/.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    if (goal) { await closeOverlays(); await inspect('goal-detail'); }
  }
  if (await clickText('我的')) {
    await closeOverlays(); await inspect('profile');
    if (await clickText('生成今日总结')) { await wait(600); await inspect('daily-summary'); }
  }

  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  const bad = findings.filter((f) => f.horizontalOverflow);
  const small = findings.filter((f) => f.smallTargets.length);
  const md = [
    '# 375px 真实视口检查（独立无头 Edge）', '',
    `- URL: ${URL}`,
    `- viewport: 375 × 812（isMobile/hasTouch，deviceScaleFactor 2）`,
    `- 页面: ${findings.length}（${findings.map((f) => f.name).join('、')}）`,
    `- 横向溢出: ${bad.length ? bad.map((f) => f.name).join('、') : '无'}`,
    `- 小于 44px 的按钮: ${small.length ? small.map((f) => `${f.name}(${f.smallTargets.join(', ')})`).join('；') : '无'}`,
    '', '## 逐页', '',
    ...findings.flatMap((f) => [
      `### ${f.name}`,
      `- scrollWidth ${f.scrollWidth} / viewport ${f.viewport}${f.horizontalOverflow ? ' ❌ 溢出' : ''}`,
      f.wideElements.length ? `- 超宽元素: ${f.wideElements.join(', ')}` : '- 无超宽元素',
      f.smallTargets.length ? `- 小按钮: ${f.smallTargets.join(', ')}` : '- 按钮尺寸达标',
      `- 首屏文字: ${f.textHead}`,
      '',
    ]),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), md, 'utf8');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(findings, null, 2), 'utf8');
  console.log(JSON.stringify({ pages: findings.length, overflow: bad.map((f) => f.name), small: small.map((f) => f.name) }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
