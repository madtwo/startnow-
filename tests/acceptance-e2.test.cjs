/** StartNow E2 acceptance regressions. Pure + deterministic: no paid API. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'), { fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText, file);
const lib = name => require(path.join(__dirname,'..','src','lib',name+'.ts'));
const { pickActions, matchActionIntent, actionTextSimilarity, recentActionUses, actionMap } = lib('actions');
const { diagnosticExcerpt } = lib('completionDiagnostics');
const now = 1800000000000;
const cases = [
  ['课程设计报告写到第三稿，标题编号排到一半又把字号改了', 'document-format', []],
  ['病理明天点名，我笔记还空着三页没补', 'exam', ['exam-']],
  ['简历投出去前教育背景行距和实习栏对不上', 'resume-format', []],
  ['导师在群里点名让我下周汇报，我一想到就手心出汗', 'class-stage-fright', []],
  ['生活费不够，兼职排班没贴出来，饭钱得算', 'budget', ['family-budget-']],
  ['课程设计报告参考文献的编号顺序对不上', 'document-format', []],
  ['室友凌晨打游戏，我又没睡着', 'roommate-sleep', ['peer-']],
  ['课程论文写了标题，文献还没整理', 'paper-references', ['write-reference-']],
  ['投了六个实习没回，怀疑简历有问题', 'internship-resume', ['resume-', 'job-']],
  ['妈妈打电话说我还好吗，我说挺好的', 'family-call', ['family-']],
  ['想报名一个比赛，怕自己水平不够拖累队友', 'competition-anxiety', []],
  ['喜欢的人已读不回，我在想是不是说错话', 'romance-message', ['love-']],
  ['小组作业同组的人不干活，ddl 就在周末', 'group-work', ['peer-']],
  ['家里人问我考不考研，我没想清楚', 'future-decision', ['plan-']],
  ['凌晨两三点才困，白天上课听不进去', 'sleep', ['sleep-']],
  ['把想说的话在聊天框打了又删，最后没发', 'send-message', ['peer-']],
  ['今天上课被点到回答问题，坐下后手还在抖', 'class-stage-fright', []],
  ['明天交课程论文，文献还没整理', 'paper-references', ['write-reference-']],
  ['社团活动答应了要去，现在想找借口不去', 'club-boundary', ['peer-']],
  ['实验数据异常，我怀疑仪器校准记录有问题', 'lab', ['lab-']],
];

test('E2 20 种真实卡点：具体场景先于泛主题，无法贴题的场景明确弃选', () => {
  let abstained = 0;
  for (const [text, intent, prefixes] of cases) {
    const matched = matchActionIntent(text);
    assert.equal(matched?.id, intent, text);
    const options = pickActions(14, 6, undefined, text);
    if (!prefixes.length) { assert.equal(options.length,0, text); abstained++; continue; }
    assert.ok(options.length > 0, text);
    assert.ok(prefixes.some(prefix => options[0].id.startsWith(prefix)), `${text}: ${options.map(x=>x.id)}`);
    assert.ok(options.every(action => matched.actionIds.includes(action.id)));
  }
  assert.ok(abstained >= 4);
});

test('低置信度未知卡片不随机选择毫不相关动作', () => {
  assert.equal(matchActionIntent('课间在操场突然想到一个没说出口的困惑'), null);
  assert.deepEqual(pickActions(14,3,'study','课间在操场突然想到一个没说出口的困惑'), []);
});

test('同一微动作换说法的 bigram 相似度达阈值，跨主题不误认', () => {
  assert.ok(actionTextSimilarity('我会先把想说的留在备忘录里', '我会把想说的留在备忘录里') >= .72);
  assert.ok(actionTextSimilarity('我会先圈出一个考点', '检查简历文件的日期') < .72);
});

test('24 小时内语义重复预置建议被排除，过期可恢复', () => {
  const card = {
    id:'previous', advice:undefined,
    comments:[{ origin:'curated', at:now-1000, text:'我会把想说的留在备忘录里。', authorKind:'persona' }],
  };
  const recent=recentActionUses([card],now);
  const choices=pickActions(14,20,'family','妈妈打电话问我最近怎么样',recent);
  const used=actionMap['family-pause-2'];
  assert.ok(used && choices.every(x => x.id !== used.id), choices.map(x=>x.id).join(','));
  assert.equal(recentActionUses([card],now+90_000_000).length,0);
});

test('诊断截取 60 字且遮盖网址、手机号、邮箱与密钥，不写入正常存档', () => {
  const s = diagnosticExcerpt('你刚才已经打开简历了，发短信给13812345678，邮箱 aa@bb.com。https://example.com/x sk-1234567890abcdef');
  assert.ok([...s].length <= 60);
  assert.doesNotMatch(s,/13812345678|aa@bb\.com|example\.com|1234567890abcdef/);
  assert.match(s,/简历/);
});


test('测试台仅在 loopback 且显式开启时采集被拒片段，默认不记录', () => {
  const harness = fs.readFileSync(path.join(__dirname,'..','src','soak','harness.ts'),'utf8');
  assert.match(harness,/qs\.get\('captureRejected'\) === '1'/);
  assert.match(harness,/\['localhost', '127\.0\.0\.1', '::1'\]/);
  assert.match(harness,/onRejectedCompletion: completionDiagnostic/);
});

// Integration coverage uses the same mock route the product already uses.
let cards;
const fullIntegrationDeps = ['baseline.ts','freeTextShrink.ts'].every(name =>
  fs.existsSync(path.join(__dirname, '..', 'src', 'lib', name)));
if (fullIntegrationDeps) cards = lib('cards'); // Fail loudly on any real import error.
else console.warn('Sparse receipt: integration dependencies missing; run this suite again in the full StartNow repository.');
if (cards) {
  const { defaultSettings } = lib('store');
  const { defaultPersonas } = lib('personas');
  const mock = { providerId:'mock',baseUrl:'',apiKey:'',model:'demo' };
  const settings={ ...defaultSettings, paused:false, aiCardLimit:0, maxCallsPerTick:3, speed:1 };
  const make = (id,text) => ({ id, text, kind:'worry',authorId:'me',authorName:'测试',authorKind:'player',status:'talking', createdAt:now-1000,
    arrivals:['shenmo'], plan:[],pending:[],comments:[] });
  test('不支持的具体格式问题不制造 advice，转为一次澄清', async () => {
    const card=make('format-1','课程设计报告里的编号和字号都对不上');
    const result=await cards.askForAdvice({ cards:[card], personas:defaultPersonas(), settings, config:mock, now, cardId:card.id, personaId:'shenmo' });
    assert.equal(result.cards[0].advice,undefined);
    assert.equal(result.cards[0].comments.length,1);
    assert.match(result.cards[0].comments[0].text,/不硬塞一个|卡点/);
  });
  test('明确场景可继续采用与缩小，原建议 actionId 保持可追溯', async () => {
    const card=make('lab-1','实验数据异常，我要核查一列单位');
    const result=await cards.askForAdvice({ cards:[card], personas:defaultPersonas(), settings, config:mock, now, cardId:card.id, personaId:'shenmo' });
    const advice=result.cards[0].advice;
    assert.ok(advice && advice.actionId.startsWith('lab-'));
    const smaller=cards.shrinkAdvice(result.cards[0],now+1);
    assert.equal(smaller.advice.actionId, actionMap[advice.actionId].smaller);
  });
}

if (cards) {
  test('本地显式诊断能看到被拒候选及锚点（≤60字且脱敏），普通日志不含模型原文', async () => {
    const llm = lib('llm');
    const old = llm.streamChat;
    const seen = [];
    const { defaultSettings } = lib('store');
    const { defaultPersonas } = lib('personas');
    const note = { text:'打开简历文件',fromPersonaId:'shenmo',at:now-4000,dueAt:now+86_400_000 };
    const card = { id:'completion-debug',text:'我今天没心情整理简历',kind:'worry',authorKind:'player',authorId:'me',authorName:'测试',
      status:'noted',createdAt:now-10_000,arrivals:['shenmo'],plan:[],pending:[],comments:[],note,
      advice:{text:note.text,fromPersonaId:'shenmo',accepted:true,at:now-4000} };
    const done = cards.completeCard(card,now,1);
    const bad = '简历还没打开。请发邮件到 private@school.example，手机号13812345678，这样才算做到。';
    llm.streamChat = async () => bad;
    try {
      const out = await cards.tickCards({ cards:[done], personas:defaultPersonas(),
        settings:{ ...defaultSettings,paused:false,aiCardLimit:0,maxCallsPerTick:1,speed:1 },
        config:{providerId:'compatible',baseUrl:'https://example.invalid/v1',model:'deepseek-v4.1-flash',apiKey:'fake-key'},
        now:now+120_000, onRejectedCompletion: diagnostic=>seen.push(diagnostic) });
      assert.equal(seen.length,1);
      assert.equal(seen[0].attempt,1);
      assert.equal(seen[0].personaId,'shenmo');
      assert.equal(seen[0].anchorExcerpt,'打开简历文件');
      assert.ok([...seen[0].candidateExcerpt].length <= 60);
      assert.doesNotMatch(seen[0].candidateExcerpt,/private@school.example|13812345678/);
      assert.ok(out.logs.every(line=>!line.includes('private@school.example')));
      assert.equal(out.cards[0].status,'done');
      const reply=out.cards[0].comments.filter(row=>row.authorKind==='persona');
      assert.equal(reply.length,1);
      assert.equal(reply[0].origin,'simulated');
      assert.doesNotMatch(JSON.stringify(out.cards[0]), /private@school.example|13812345678/);
    } finally { llm.streamChat=old; }
  });
}
