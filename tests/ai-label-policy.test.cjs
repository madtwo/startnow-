const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('normal cards and comments do not repeat AI/model/simulation provenance labels',()=>{
  for(const file of ['src/components/CardRow.tsx','src/components/CardDeck.tsx','src/components/CardDetail.tsx']){
    const src=read(file);
    assert.doesNotMatch(src,/AI 虚构剧情|AI 模拟结果|模型回复|模拟情节|预置回复/,file);
    assert.doesNotMatch(src,/thread-badge\">AI<\/span>/,file);
  }
  assert.doesNotMatch(read('src/lib/goals.ts'),/AI 虚构剧情|AI 模拟结果/);
  assert.doesNotMatch(read('src/lib/agentVulnerability.ts'),/AI 虚构剧情/);
});
test('opening and safety disclosures remain',()=>{
  assert.match(read('src/components/Onboarding.tsx'),/AI/);
  assert.match(read('src/components/CrisisCard.tsx'),/12356|HOTLINE/);
});
test('fallback note is tied to real fallback reasons and never demo',()=>{
  const detail=read('src/components/CardDetail.tsx');
  assert.match(detail,/fallbackReason/);
  assert.match(detail,/网络没接上，这条是预设回复/);
  assert.match(detail,/fallbackReason !== 'demo'/);
});
test('app no longer appends AI-fiction to toasts or footer demo lines',()=>{
  const app=read('src/App.tsx');
  assert.doesNotMatch(app,/AI 虚构剧情|AI 剧情模拟|演示模式：同伴回复由本地脚本生成/);
  assert.match(app,/发了今天的结果/);
});
// Node 22 does not natively require TypeScript files. Use the same loader as
// the other CommonJS tests instead of relying on the runtime's TS support.
const { lib } = require('./_ts-loader.cjs');
const {stripAiProvenance}=lib('displayText');
test('old archived fictional prefixes are stripped without touching user words',()=>{
  assert.equal(stripAiProvenance('【AI 虚构剧情】病理第三章只背一页'),'病理第三章只背一页');
  assert.equal(stripAiProvenance('【AI 虚构剧情·模拟结果】今天没做完原来的计划。'),'今天没做完原来的计划。');
  assert.equal(stripAiProvenance('【AI 虚构剧情·方向碎念】文献综述越看越不知道自己想问什么。'),'文献综述越看越不知道自己想问什么。');
  assert.equal(stripAiProvenance('我自己写的一句'),'我自己写的一句');
});
