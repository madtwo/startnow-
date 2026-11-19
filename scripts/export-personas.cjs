#!/usr/bin/env node
/** Export persona lives for external review. Read-only; writes exports/ and a zip. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(result.outputText, filename);
};
const lib = (name) => require(path.join(root, 'src', 'lib', `${name}.ts`));
const { defaultPersonas, EXTRA_SEEDS, TROUBLE_LABEL, buildPersonaPrompt } = lib('personas');
const { FORUM_PERSONA_MINDS } = lib('forumPersonaMind');
const { buildSeedCards } = lib('seed');

const strip = (p) => ({
  id: p.id, archetype: p.archetype, name: p.name, handle: p.handle, tagline: p.tagline,
  gender: p.gender, age: p.age, school: p.school, major: p.major, cohort: p.cohort,
  mbti: p.mbti, background: p.background, voice: p.voice, personality: p.personality,
  speech: p.speech, approach: p.approach, weights: p.weights,
  followUp: p.followUp, intimacy: p.intimacy, replyDesire: p.replyDesire,
  color: p.color, avatarKey: p.avatarKey,
});

const personas = defaultPersonas().map(strip);
const extras = EXTRA_SEEDS.map((s) => ({
  id: s.key, archetype: s.archetype, name: s.name, handle: s.handle, tagline: s.tagline,
  gender: s.gender, age: s.age, school: s.school, major: s.major, cohort: s.cohort,
  background: s.background, voice: s.voice, personality: s.personality, speech: s.speech,
  approach: s.approach, weights: s.weights, replyDesire: s.replyDesire,
  color: s.color, avatarKey: s.avatarKey,
}));

// Mock cards are module-private; read them from source.
const src = fs.readFileSync(path.join(root, 'src', 'lib', 'personas.ts'), 'utf8');
const mockCards = {};
for (const id of ['shenmo', 'weini', 'miaoze', 'yanggao']) {
  const block = src.match(new RegExp(`\\n  ${id}: \\[([\\s\\S]*?)\\n  \\],`));
  if (!block) continue;
  mockCards[id] = [...block[1].matchAll(/text: '((?:[^'\\]|\\.)*)'/g)].map((row) =>
    row[1].replace(/\\n/g, '\n').replace(/\\'/g, "'"));
}

const introCards = buildSeedCards(1_800_000_000_000).filter((c) => c.intro)
  .map((c) => ({ authorId: c.authorId, authorName: c.authorName, title: c.title, text: c.text }));

const secondary = [
  { name: '韩东', role: '沈默的高中同学/暗恋对象；杨槔的高中师姐', school: '汉东体育大学（短跑队）',
    traits: '性格冷、训练忙、回消息短（「嗯」「在练」）；对沈默是熟人/朋友边界，不是情侣；不是恶意冷落，但确实让沈默内耗。' },
  { name: '杨枫', role: '杨槔的哥哥，大她五岁', job: '本地汽修',
    traits: '本性不坏、嘴硬；因母亲复查、陪床、钱怎么花与父亲吵到拍桌子；会在妹妹生活费见底时偷偷转两百，并说「别跟爸说」。' },
  { name: '杨文', role: '杨槔的父亲', traits: '撑学费和家里开销；咬死「你必须把书读好」；什么都自己扛，不跟家里商量，因此和儿子冲突。' },
  { name: '曾温', role: '杨槔的母亲', traits: '长期接受治疗；会问女儿最近开不开心。' },
  { name: '苏归人', role: '魏霓的母亲', traits: '控制欲强，总打电话问她和谁出去、为什么不多参加活动；魏霓回「知道了」后会觉得胸口堵。' },
  { name: '沈默的室友', role: '背景', traits: '不吵架但也不算熟；喊他开黑，他总说等背完这章。' },
];

const promptSample = buildPersonaPrompt(defaultPersonas().find((p) => p.id === 'shenmo'));
const bragTone = (fs.readFileSync(path.join(root, 'src', 'lib', 'prompts.ts'), 'utf8')
  .match(/- 和你的性格、人设保持一致。[^\n]+/) ?? [''])[0];

const data = {
  meta: {
    product: '先动一下（StartNow）· 共进小组论坛',
    generatedAt: new Date().toISOString(),
    note: '四位固定角色来自 src/lib/personas.ts 的 defaultPersonas；EXTRA_SEEDS 是群聊可替换 cast。韩东/杨枫等为背景人物，不是论坛成员，不会发帖。',
    files: ['src/lib/personas.ts', 'src/lib/seed.ts', 'src/lib/prompts.ts', 'room/src/lib/personas.ts（群聊副本）'],
  },
  troubleLabels: TROUBLE_LABEL,
  personas,
  forumMinds: FORUM_PERSONA_MINDS,
  extraSeeds: extras,
  secondaryCharacters: secondary,
  introCards,
  mockCards,
  promptRules: { personaPromptSample: promptSample, bragToneLine: bragTone },
};

const outDir = path.join(root, 'exports');
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'persona-review-2026-11-19.json');
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');

const top = (weights) => Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, 2)
  .map(([k, v]) => `${TROUBLE_LABEL[k]} ${v}`).join(' / ');
const profile = (p) => [
  `### ${p.name}（${p.id}）${p.mbti ? ` · ${p.mbti}` : ''}`,
  '',
  `- **一句话**：${p.tagline}`,
  `- **基本信息**：${p.gender === 'female' ? '女' : '男'}，${p.age} 岁；${p.school}${p.major ? ` · ${p.major}` : ''}${p.cohort ? ` · ${p.cohort}` : ''}`,
  `- **背景（人生）**：${p.background}`,
  `- **口吻样例**：${p.voice}`,
  `- **性格**：${p.personality}`,
  `- **说话习惯**：${p.speech}`,
  `- **面对别人的方式**：${p.approach}`,
  `- **困境权重**：${top(p.weights)}（study ${p.weights.study} / people ${p.weights.people} / love ${p.weights.love} / family ${p.weights.family} / self ${p.weights.self} / future ${p.weights.future}）`,
  p.followUp ? `- **跟进欲**：${p.followUp} · 初始熟度 ${p.intimacy}/100 · 回帖欲 ${p.replyDesire}/100` : `- **回帖欲**：${p.replyDesire}/100`,
  FORUM_PERSONA_MINDS[p.id] ? [`- **论坛思维**：注意「${FORUM_PERSONA_MINDS[p.id].notices}」；易看偏「${FORUM_PERSONA_MINDS[p.id].blindSpot}」；回应「${FORUM_PERSONA_MINDS[p.id].responds}」；避免「${FORUM_PERSONA_MINDS[p.id].avoid}」。`] : [],
  '',
  '演示帖：',
  ...(mockCards[p.id] ?? []).map((text, i) => `${i + 1}. ${text.replace(/\n+/g, ' / ')}`),
  '',
].join('\n');

const md = [
  '# 先动一下 · 角色人设审查稿（2026-11-19）',
  '',
  '## 0. 给审查 AI 的说明',
  '',
  '这是一份**虚构角色**设定稿，用于产品和叙事审查，不是心理咨询产品，也不代表真实人物。四位固定角色是论坛里的 AI 同学，另外八位是群聊可替换 cast；韩东、杨枫、杨文、曾温、苏归人是背景人物，不会作为 AI 发帖。',
  '',
  '请重点看：',
  '1. 四位固定角色是否**彼此可区分**（口吻、关注点、处理问题的方式），有没有四个人的台词可以互换。',
  '2. 沈默的“恋爱脑 + 被冷落内耗 + 拖垮学习”是否成立、是否过度贬低任何一方；韩东的冷淡是否被写成“坏”。',
  '3. 苗泽是否还会显得像机器人；理性是否体现在思考而不是口头禅。',
  '4. 杨槔一家的冲突是否真实、有没有把疾病/贫困当卖点；杨枫是否“可恨又可信”。',
  '5. 是否有对性别、家庭、心理状态的刻板印象或污名化；有没有不适合大学生年龄段的表达。',
  '6. 是否违反边界：不诊断、不承诺疗效、不发展恋爱、不约线下、不交换联系方式。',
  '',
  '输出建议时请按：`问题 / 证据（引用原文） / 改法（给出替换文案） / 风险等级`。',
  '',
  `> 生成时间：${data.meta.generatedAt}；来源：${data.meta.files.join('、')}。`,
  '',
  '## 1. 角色总表',
  '',
  '| 角色 | 定位 | 基本信息 | 主要困境 | 回帖欲 |',
  '| --- | --- | --- | --- | --- |',
  ...[...personas, ...extras].map((p) => `| ${p.name} | ${p.archetype} | ${p.age} 岁 · ${p.school}${p.major ? ` · ${p.major}` : ''} | ${top(p.weights)} | ${p.replyDesire} |`),
  '',
  '## 2. 四位固定角色（卡片论坛）',
  '',
  ...personas.map(profile),
  '## 3. 关系与背景人物（不发帖）',
  '',
  ...secondary.map((s) => `- **${s.name}**（${s.role}${s.school ? ` · ${s.school}` : ''}${s.job ? ` · ${s.job}` : ''}）：${s.traits}`),
  '',
  '## 4. 八位可替换群友（群聊 cast）',
  '',
  ...extras.map(profile),
  '## 5. 开场自我介绍卡',
  '',
  ...introCards.map((c) => `- **${c.authorName}**：${c.text}`),
  '',
  '## 6. 人设如何进入提示词',
  '',
  '- 每位角色的 system prompt 由 `buildPersonaPrompt` 拼接（背景 / 口吻 / 性格 / 说话 / 方式 / 困境权重 / 熟度门控）。',
  '- 熟度门控：0–20 只聊眼前；20–40 可以说专业/宿舍；40–60 可以说家里大致情况；60+ 才提感情细节和最重的事。不要把背景一次全倒出来。',
  `- 炫耀卡语气约束：${bragTone}`,
  '',
  '### 沈默的提示词样例（完整输出，便于判断人设是否被正确消费）',
  '',
  '```text',
  promptSample,
  '```',
  '',
  '## 7. 审查清单（可直接逐条回答）',
  '',
  '- [ ] 四人台词互换测试：把任意两句台词换给另一个人，是否明显违和？哪几句可以互换？',
  '- [ ] 沈默是否只剩“舔狗”一个维度？他帮别人时的清醒是否足够？',
  '- [ ] 韩东是否被写成了工具人/坏人？她的冷淡有没有自己的合理性？',
  '- [ ] 苗泽还有没有“机器人味”？请指出具体句子。',
  '- [ ] 杨枫与父亲的冲突是否可信？有没有把母亲的病当情节工具？',
  '- [ ] 是否出现诊断、疗效承诺、鼓励线下见面或交换联系方式？',
  '- [ ] 是否有性别/家庭/心理状态的刻板印象？给出替换文案。',
  '',
].join('\n');

const mdPath = path.join(outDir, 'persona-review-2026-11-19.md');
fs.writeFileSync(mdPath, md, 'utf8');

const zipPath = path.join(outDir, 'persona-review-2026-11-19.zip');
fs.rmSync(zipPath, { force: true });
execFileSync('python', ['-c',
  'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED); ' +
  '[z.write(p, __import__("os").path.basename(p)) for p in sys.argv[2:]]; z.close()',
  zipPath, mdPath, jsonPath], { stdio: 'inherit' });

console.log(JSON.stringify({
  markdown: path.relative(root, mdPath),
  json: path.relative(root, jsonPath),
  zip: path.relative(root, zipPath),
  personas: personas.length,
  extraSeeds: extras.length,
  introCards: introCards.length,
}, null, 2));
