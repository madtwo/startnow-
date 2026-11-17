/** 2026-11-17 card forum regression: pure domain/geometry, no external browser dependency. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(output.outputText, filename);
};
const load = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const { orderThreadComments, latestCommentId } = load('threading');
const { scrollDeltaForComment, isCommentInView, keyboardLift } = load('threadViewport');
const { adoptCommentAdvice, advicePersonaFor, askForAdvice, shrinkAdvice, acceptAdvice } = load('cards');
const { wantsDirectAdvice } = load('directAdvice');
const { defaultPersonas } = load('personas');
const config = { providerId:'mock', baseUrl:'', model:'', apiKey:'' };
const settings = { paused:false, maxArrivals:2, aiCardLimit:0, dailyCalls:20, maxCallsPerTick:2, speed:6, baselineExtra:'' };
const people = defaultPersonas();
const makeComment = (id, authorId='yanggao', text='先问对方能不能商量固定周末两天到岗') => ({
  id, authorKind: authorId === 'me' ? 'player' : 'persona', authorId, at:Date.now(), text,
});
const card = (comments=[makeComment('yang')]) => ({
  id:'a', authorKind:'player', authorId:'me', authorName:'卡主', kind:'worry',
  text:'简历投出去，想找周末的实习', createdAt:Date.now(), status:'talking',
  arrivals:['shenmo','yanggao'], plan:[], pending:[], comments,
});

test('六层 replyTo 不会继续增加视觉缩进，原始引用不变', () => {
  const chain = Array.from({length:7},(_,i) => ({
    ...makeComment(`r${i}`,i % 2 ? 'me':'yanggao'),
    replyTo:i ? `r${i-1}` : undefined,
  }));
  const rows = orderThreadComments(chain);
  assert.equal(rows.length,7);
  assert.deepEqual(rows.map(r=>r.depth),[0,1,2,3,4,5,6]);
  assert.deepEqual(rows.map(r=>r.visualDepth),[0,1,2,2,2,2,2]);
  assert.equal(rows[6].parent.id,'r5');
  assert.equal(chain[6].replyTo,'r5');
});

test('旧评论无 replyTo、孤儿引用可显示为根楼层', () => {
  const rows=orderThreadComments([makeComment('old'),{...makeComment('orphan'),replyTo:'gone'}]);
  assert.deepEqual(rows.map(r=>r.visualDepth),[0,0]);
  assert.equal(rows[1].parent,undefined);
});

test('异常导入中的循环不能隐藏消息或无限递归', () => {
  const rows=orderThreadComments([
    {...makeComment('x'),replyTo:'y'},
    {...makeComment('y'),replyTo:'x'},
    {...makeComment('z'),replyTo:'z'},
  ]);
  assert.deepEqual(new Set(rows.map(r=>r.comment.id)),new Set(['x','y','z']));
  assert.equal(rows.length,3);
});

test('最新评论使用追加顺序，不因其回复旧楼层而定位错', () => {
  const rows=[makeComment('a'),makeComment('b'),{...makeComment('c'),replyTo:'a'}];
  assert.equal(latestCommentId(rows),'c');
  assert.deepEqual(orderThreadComments(rows).map(r=>r.comment.id),['a','c','b']);
});

test('点中杨槔，正式下一步不再默默落到先到场的沈默', async () => {
  const current=card([makeComment('shen','shenmo','你先整理几个招聘信息'),makeComment('yang')]);
  assert.equal(advicePersonaFor(current,people,'yanggao')?.id,'yanggao');
  const out=await askForAdvice({cards:[current],cardId:'a',personas:people,settings,config,personaId:'yanggao'});
  assert.equal(out.cards[0].advice?.fromPersonaId,'yanggao');
  assert.equal(out.cards[0].comments.at(-1).authorId,'yanggao');
});

test('无选中人物时取最后实际发言角色，而非 arrival[0]', async () => {
  const current=card([makeComment('shen','shenmo'),makeComment('yang')]);
  assert.equal(advicePersonaFor(current,people)?.id,'yanggao');
  const out=await askForAdvice({cards:[current],cardId:'a',personas:people,settings,config});
  assert.equal(out.cards[0].advice?.fromPersonaId,'yanggao');
});

test('显式点中未参与角色不偷换成其他人，也不记忆或调用模型', async () => {
  const current=card();
  const out=await askForAdvice({cards:[current],cardId:'a',personas:people,settings,config,personaId:'weini'});
  assert.equal(out.cards[0],current);
  assert.equal(out.calls,0);
  assert.match(out.logs.join(' '),/未更换/);
});

test('评论原文直接采用，保持角色/评论来源，无 actionId，便签完整继承', () => {
  const current=card();
  const selected=adoptCommentAdvice(current,'yang',people,1700000000000);
  assert.equal(selected.error,undefined);
  assert.equal(selected.card.advice.text,current.comments[0].text);
  assert.equal(selected.card.advice.fromPersonaId,'yanggao');
  assert.equal(selected.card.advice.sourceCommentId,'yang');
  assert.equal(selected.card.advice.actionId,undefined);
  assert.equal(selected.card.advice.origin,'adopted');
  assert.equal(selected.card.status,'advised');
  assert.equal(shrinkAdvice(selected.card),selected.card);
  const accepted=acceptAdvice(selected.card);
  assert.equal(accepted.status,'noted');
  assert.equal(accepted.note?.sourceCommentId,'yang');
  assert.equal(accepted.note?.fromPersonaId,'yanggao');
  assert.equal(accepted.note?.text,current.comments[0].text);
  assert.equal(adoptCommentAdvice(accepted,'yang',people).card,accepted);
});

test('原有未贴便签的预置下一步可以用角色原话替换；贴上便签后不覆盖', () => {
  const current={...card(),status:'advised',advice:{text:'先看一眼',fromPersonaId:'shenmo',at:1,actionId:'act-1',accepted:false}};
  const next=adoptCommentAdvice(current,'yang',people).card;
  assert.notEqual(next,current);
  assert.equal(next.advice.fromPersonaId,'yanggao');
  assert.equal(next.advice.actionId,undefined);
  const stuck=adoptCommentAdvice({...current, status:'noted', advice:{...current.advice,accepted:true}},'yang',people);
  assert.ok(stuck.error);
});

test('采用入口阻断系统提示、伪评论、玩家评论、未知角色', () => {
  const badComments=[
    {...makeComment('sys'),origin:'system'},
    {...makeComment('boundary'),origin:'boundary'},
    makeComment('me','me'),
    makeComment('unknown','not-an-actual-persona'),
  ];
  for (const row of badComments) {
    const current=card([row]);
    assert.equal(adoptCommentAdvice(current,row.id,people).card,current,row.id);
  }
  assert.ok(adoptCommentAdvice(card(),'missing',people).error);
});

test('采用前二次安全审查：见面、联系方式、诊断、用药、依赖、危机', () => {
  const unsafe=[
    '明天和我一起下楼喝咖啡',
    '私聊加我微信吧',
    '你就是抑郁症',
    '先停药再行动',
    '只有我懂你，不用找别人',
    '不想活了就算了',
  ];
  for (const text of unsafe) {
    const current=card([makeComment('yang','yanggao',text)]);
    const out=adoptCommentAdvice(current,'yang',people);
    assert.equal(out.card,current,text);
    assert.ok(out.error,text);
  }
});

test('求助步骤不能被普通角色评论取代（包括原有 help-3）', () => {
  const suffering=card([makeComment('yang')]);
  suffering.text='我持续两个月低落，起不来，上课跟不上';
  assert.equal(adoptCommentAdvice(suffering,'yang',people).card,suffering);
  const helpCard=card();
  helpCard.status='advised';
  helpCard.advice={text:'搜索学校心理中心官方入口',actionId:'help-3',fromPersonaId:'shenmo',at:1,accepted:false};
  assert.equal(adoptCommentAdvice(helpCard,'yang',people).card,helpCard);
});

test('位置计算：长消息上对齐；短消息在固定输入栏上方完整可见', () => {
  assert.equal(scrollDeltaForComment({top:900,bottom:970},100,500),470);
  assert.equal(scrollDeltaForComment({top:900,bottom:1500},100,500),800);
  assert.equal(isCommentInView({top:430,bottom:490},100,500),true);
  assert.equal(isCommentInView({top:490,bottom:540},100,500),false);
});

test('键盘只在输入框聚焦且可视视口明显缩水时补偿', () => {
  assert.equal(keyboardLift(812,500,true),312);
  assert.equal(keyboardLift(812,750,true),0);
  assert.equal(keyboardLift(812,500,false),0);
});

test('新版主动要下一步识别准确，不将普通聊天全部分流为预置动作', () => {
  assert.equal(wantsDirectAdvice('直接给我一个下一步吧'),true);
  assert.equal(wantsDirectAdvice('下一步该做什么？'),true);
  assert.equal(wantsDirectAdvice('我正在跟她聊投简历的事'),false);
  assert.equal(wantsDirectAdvice('不要给我下一步'),false);
});

test('便签来源字段经过本地存档写入与重载仍然保留', () => {
  const { saveCards, loadCards } = load('store');
  const saved = global.localStorage;
  const data = new Map();
  global.localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  try {
    const adopted = adoptCommentAdvice(card(), 'yang', people).card;
    saveCards([acceptAdvice(adopted)]);
    const roundtrip = loadCards();
    assert.equal(roundtrip.length, 1);
    assert.equal(roundtrip[0].note?.sourceCommentId, 'yang');
    assert.equal(roundtrip[0].note?.fromPersonaId, 'yanggao');
    assert.equal(roundtrip[0].note?.text, card().comments[0].text);
    assert.equal(roundtrip[0].advice?.origin, 'adopted');
  } finally {
    if (saved === undefined) delete global.localStorage;
    else global.localStorage = saved;
  }
});

test('关键 TSX 文件无语法错误或重复 peerName 声明', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const detail = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'CardDetail.tsx'), 'utf8');
  for (const [name, content] of [['App.tsx', app], ['CardDetail.tsx', detail]]) {
    const source = ts.createSourceFile(name, content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    assert.equal(source.parseDiagnostics.length, 0, name);
  }
  assert.equal((detail.match(/const peerName =/g) ?? []).length, 1);
  assert.match(app, /<CardDetail\s+key=\{detailCard\.id\}/);
});

test('UI 选择、来源追溯和两级缩进保持连接，不再渲染无限 forum-replies', () => {
  const detail = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'CardDetail.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(detail, /onAdoptAdvice\(comment\.id\)/);
  assert.match(detail, /scrollToComment\(card\.advice\?\.sourceCommentId\)/);
  assert.match(detail, /onAdvice\(targetId \|\| undefined\)/);
  assert.match(detail, /data-comment-id=\{comment\.id\}/);
  assert.doesNotMatch(detail, /className="forum-replies"/);
  assert.match(css, /\.forum-thread\.forum-depth-2/);
  assert.doesNotMatch(css, /\.forum-replies\s*\{/);
});
