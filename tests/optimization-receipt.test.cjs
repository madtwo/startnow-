/** Receipt-driven regression tests; deterministic, local, no API key or network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, file) => {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(js.outputText, file);
};
const lib = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const { PRESETS } = require(path.join(__dirname, '..', 'src', 'config', 'providers.ts'));
const { ACTIONS, actionMap, actionLineOptions, inferTrouble, pickActions, recentActionUses, selectActionLine } = lib('actions');
const { askForAdvice, createPlayerCard, tickCards } = lib('cards');
const { summarizeCompletions } = lib('completionStats');
const { defaultSettings } = lib('store');
const { defaultPersonas } = lib('personas');
const { findCrisis } = lib('safety');
const { auditSocial, auditCriticalContent } = lib('baseline');
const now = 1_800_000_000_000;
const mock = { providerId: 'mock', baseUrl: '', model: 'demo', apiKey: '' };
const settings = { ...defaultSettings, aiCardLimit: 0, paused: false, maxCallsPerTick: 2 };
const personas = defaultPersonas();
const makeCard = (id, text, extra = {}) => ({
  id, text, kind:'worry', authorId: 'me', authorName:'测试用户', authorKind:'player',
  status:'talking', createdAt:now-120_000, comments:[], arrivals:['shenmo'], plan:[], pending:[],
  ...extra,
});

const examples = [
  ['study','实验数据异常','study-lab'],
  ['study','论文第一段写不出来','study-writing'],
  ['study','期末考试复习范围太多','study-exam'],
  ['people','跟室友说话卡住','people'],
  ['love','跟喜欢的人聊天不知道说什么','love'],
  ['family','家里爸妈最近老吵架','family'],
  ['future','简历投递找实习','future-job'],
  ['future','考研出国方向不知道怎么选','future-plan'],
  ['self','睡不着又熬夜','self-sleep'],
  ['self','最近总焦虑不想动','self'],
];

test('Go 新配置使用 DeepSeek V4.1 Flash 主模型、GLM 作异名备用；按量付费预设未改变', () => {
  const go = PRESETS.find((row) => row.id === 'opencode-go');
  const pay = PRESETS.find((row) => row.id === 'opencode');
  assert.equal(go.model, 'deepseek-v4.1-flash');
  assert.equal(go.fallbackModel, 'glm-5.3-flash');
  assert.notEqual(go.model, go.fallbackModel);
  assert.equal(pay.model, 'glm-5.3-flash');
});

test('扩池动作 ID 唯一、每个可推荐动作有更小的一步、两种文案且均不超过15分钟', () => {
  assert.equal(new Set(ACTIONS.map((a) => a.id)).size, ACTIONS.length);
  const recommendations = ACTIONS.filter((row) => !ACTIONS.some((x) => x.smaller === row.id));
  assert.ok(recommendations.length >= 80);
  for (const action of recommendations) {
    assert.ok(action.minutes > 0 && action.minutes <= 15, action.id);
    assert.equal(actionLineOptions(action).length, 2, action.id);
    assert.notEqual(...actionLineOptions(action));
    const lower = actionMap[action.smaller];
    assert.ok(lower, `无更小一步：${action.id}`);
    assert.ok(lower.minutes <= action.minutes);
  }
});

test('七个领域的细分主题都能推荐贴合的动作，不拿实验数据去做数学例题', () => {
  for (const [trouble, phrase, category] of examples) {
    assert.equal(inferTrouble(phrase), trouble, phrase);
    const options = pickActions(15, 3, trouble, phrase);
    assert.equal(options.length, 3, phrase);
    for (const action of options) {
      assert.ok(action.topics.includes(trouble), phrase);
      if (category.startsWith('study-') || category === 'self-sleep' || category.startsWith('future-')) {
        assert.equal(action.variant, category, `错配 ${phrase} -> ${action.id}`);
      }
    }
  }
});

test('新扩池动作文案不包含明显危机、线下邀约与联系方式内容', () => {
  for (const action of ACTIONS.filter((row) => row.alternateLine)) {
    for (const phrase of [action.line, action.alternateLine]) {
      assert.equal(findCrisis(phrase), false, phrase);
      assert.equal(Boolean(auditSocial(phrase)), false, phrase);
      assert.equal(Boolean(auditCriticalContent(phrase)), false, phrase);
    }
  }
});

test('直接评论和置顶 advice 都进入 24 小时去重，旧评论超过一天后失效', () => {
  const old = makeCard('old','论文要交了',{ comments:[
    { id:'x', authorId:'shenmo', authorKind:'persona', origin:'curated', text:'先做这个：打开简历，只改第一行。别管后面。', at:now-1000 },
    { id:'y', authorId:'shenmo', authorKind:'persona', origin:'curated', text:'很久以前的回复', at:now-90_000_000 },
  ], advice:{text:'先核对一列数据', actionId:'lab-unit-2', at:now-2000, fromPersonaId:'shenmo', accepted:false}});
  const recent = recentActionUses([old],now);
  assert.equal(recent.length,2);
  assert.ok(!pickActions(13,12,'study','实验数据异常',recent).some((row)=>row.id==='lab-unit-2'));
  const fresh = pickActions(13,12,'future','简历要改',recent);
  assert.ok(!fresh.some((row)=>row.id==='resume-3'));
});

test('同主题连续采纳不重复；候选用尽则留明确说明、不会虚构动作 ID', async () => {
  let cards = [];
  const ids = [];
  const text = '失眠，晚上总睡不着';
  for (let n = 0; n < 12; n++) {
    const current = makeCard(`sleep-${n}`, text, { createdAt: now + n });
    cards.push(current);
    const response = await askForAdvice({ cards, personas, settings, config:mock, now:now + n + 30, cardId:current.id, personaId:'shenmo' });
    cards = response.cards;
    const saved = cards.find((row)=>row.id===current.id);
    if (saved.advice) {
      assert.ok(!ids.includes(saved.advice.actionId));
      ids.push(saved.advice.actionId);
    } else {
      assert.ok(saved.comments.some((row)=>row.text.includes('不硬塞一个')));
      assert.equal(saved.status,'talking');
    }
  }
  assert.equal(ids.length,8, '睡眠专属动作池应有8种根动作');
});

test('预置下一步可重复选择不同表达，但同一个根动作身份不变', () => {
  const candidate = actionMap['lab-unit-2'];
  const lines = [selectActionLine(candidate,'a'),selectActionLine(candidate,'b'), selectActionLine(candidate,'c')];
  assert.ok(lines.every((line)=>actionLineOptions(candidate).includes(line)));
  assert.equal(actionMap[candidate.id].smaller,'lab-unit-1');
});

test('论坛小助手只兜底：同一 tick 中有已到期角色回复时不抢楼', async () => {
  const card = makeCard('with-role','课程复习卡住了', {
    status:'stuck', helperAt:now-1, arrivals:[], plan:[{personaId:'shenmo',at:now-1}],
  });
  const result = await tickCards({ cards:[card], personas, settings, config:mock, now });
  const comments = result.cards.find((c)=>c.id==='with-role').comments;
  assert.ok(comments.some((c)=>c.authorKind==='persona'));
  assert.ok(!comments.some((c)=>c.authorId==='helper'));
});

test('小助手没有角色回复时只出现一次，不会承诺一定有人来', async () => {
  const card = makeCard('no-role','最近有点烦', {status:'stuck',helperAt:now-1,arrivals:[],plan:[]});
  const first = await tickCards({cards:[card],personas,settings,config:mock,now});
  const second = await tickCards({cards:first.cards,personas,settings,config:mock,now:now+10_000});
  const replies = second.cards.find((c)=>c.id==='no-role').comments.filter((c)=>c.authorId==='helper');
  assert.equal(replies.length,1);
  assert.match(replies[0].text,/暂时还没有新的同伴回复/);
});

test('边界回复后不会插入通用小助手', async () => {
  const card = makeCard('boundary','我想知道你微信号', {status:'talking',helperAt:now-1, comments:[
    {id:'b',authorId:'shenmo',authorKind:'persona',text:'我们只在线上交流',origin:'boundary',at:now-1000},
  ]});
  const out = await tickCards({cards:[card],personas,settings,config:mock,now});
  assert.equal(out.cards[0].comments.length,1);
});

test('本机完成回应指标以完成事件为单位，分清模型、兜底、未回复及重复', () => {
  const completed = makeCard('complete','简历问题',{ comments:[
    {id:'c1',authorId:'me',authorKind:'player',text:'做到了：打开简历',at:now-4000},
    {id:'r1',authorId:'shenmo',authorKind:'persona',replyTo:'c1',text:'简历打开了',origin:'model',at:now-3000},
    {id:'r2',authorId:'weini',authorKind:'persona',replyTo:'c1',text:'真好',origin:'simulated',at:now-2900},
    {id:'c2',authorId:'me',authorKind:'player',text:'做到了：关掉屏幕',at:now-2000},
    {id:'r3',authorId:'shenmo',authorKind:'persona',replyTo:'c2',text:'屏幕关了',origin:'simulated',fallbackReason:'invalid_action',at:now-1500},
    {id:'c3',authorId:'me',authorKind:'player',text:'做到了：整理桌子',at:now-1000},
  ]});
  const stats = summarizeCompletions([completed],now);
  assert.deepEqual(stats,{events:3,replied:2,model:1,simulated:1,missing:1,duplicate:1,reasons:{invalid_action:1}});
});

test('预设默认不修改当前用户设置：加载方只能在用户选中预设时应用', () => {
  const persisted = { providerId:'opencode-go',model:'hy4-flash-free',fallbackModel:'deepseek-v4.1-flash',apiKey:'test' };
  assert.equal(persisted.model,'hy4-flash-free');
  assert.equal(PRESETS.find((p)=>p.id==='opencode-go').model,'deepseek-v4.1-flash');
});

test('60 次合成预置下一步抽样：分别统计贴题建议覆盖率与安全弃选，24 小时不重复', async () => {
  let cards = [];
  const texts = [];
  const actions = [];
  let abstained = 0;
  for (let n = 0; n < 60; n++) {
    const [topic, description] = examples[n % examples.length];
    const card = makeCard(`flow-${n}`, description, { createdAt: now + n });
    cards.push(card);
    const result = await askForAdvice({cards,personas,settings,config:mock,now:now+n+100,cardId:card.id,personaId:'shenmo'});
    cards = result.cards;
    const saved = cards.find((c) => c.id === card.id);
    if (!saved.advice) {
      abstained++;
      assert.ok(saved.comments.some((row)=>/不硬塞一个|具体卡点/.test(row.text)));
      continue;
    }
    const advice = saved.advice;
    assert.ok(actionMap[advice.actionId].topics.includes(topic) || /跟室友/.test(description), description);
    actions.push(advice.actionId);
    texts.push(advice.text);
  }
  // Low confidence and exhausted pools must abstain rather than fabricate a
  // fresh action. Report coverage separately; it is NOT a quality pass rate.
  assert.ok(actions.length >= 30, `覆盖率偏低：${actions.length}/60`);
  assert.equal(actions.length + abstained, 60);
  assert.equal(new Set(actions).size,actions.length);
  const extraDuplicated = texts.length - new Set(texts).size;
  assert.ok(extraDuplicated/texts.length < 0.05,`同一句文案重复 ${extraDuplicated}/${texts.length}`);
  console.log(`E2 synthetic coverage=${actions.length}/60 abstained=${abstained}/60 exact_duplicate=${extraDuplicated}`);
});

test('角色直接回复「给我一个下一步」也检查此前其他卡中的预置回复', async () => {
  const used = actionMap['lab-unit-2'];
  const prior = makeCard('previous','实验数据异常',{status:'handled',comments:[
    {id:'a',authorId:'shenmo',authorKind:'persona',origin:'curated',text:`先做这个：${used.label}。别管后面。`,at:now-2000},
  ]});
  const current = makeCard('direct','实验数据异常',{comments:[
    {id:'request',authorId:'me',authorKind:'player',text:'给我一个下一步',peer:'shenmo',at:now-1000},
  ],pending:[{phase:'reply',personaId:'shenmo',at:now-1,sourceCommentId:'request'}]});
  const out = await tickCards({cards:[prior,current],personas,config:mock,settings,now});
  const reply = out.cards.find((c)=>c.id==='direct').comments.find((c)=>c.replyTo==='request');
  assert.ok(reply && reply.origin==='curated');
  assert.ok(!reply.text.includes(used.label));
});

test('直接求下一步但睡眠动作8种都用过时，明确说明而不硬塞其它主题', async () => {
  const sleep = ACTIONS.filter((a)=>a.variant==='self-sleep' && a.id.endsWith('-2'));
  assert.equal(sleep.length,8);
  const previous = sleep.map((action,i)=>makeCard(`prev-${i}`,'失眠睡不着',{status:'handled',comments:[
    {id:`comment-${i}`,authorId:'weini',authorKind:'persona',origin:'curated',text:`先做这个：${action.label}。别管后面。`,at:now-3000},
  ]}));
  const current = makeCard('current','最近失眠睡不着',{comments:[
    {id:'request',authorId:'me',authorKind:'player',text:'给我一个下一步',peer:'shenmo',at:now-1000},
  ],pending:[{phase:'reply',personaId:'shenmo',at:now-1,sourceCommentId:'request'}]});
  const out=await tickCards({cards:[...previous,current],personas,settings,config:mock,now});
  const reply=out.cards.find((c)=>c.id==='current').comments.find((c)=>c.replyTo==='request');
  assert.match(reply?.text??'',/不硬塞一个/);
  assert.equal(reply.origin,'curated');
});
