/** Deterministic, no live API. Validates the same helper used by askForAdvice. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const src = path.join(__dirname, '..', 'src');

Module._extensions['.ts'] = (mod, file) => {
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(out.outputText, file);
};

// The portable requirements ZIP contains only selected source files. Supply
// conservative test doubles ONLY when these two existing production modules
// are absent. A real repository always loads its actual baseline/safety code.
const partialSnapshot = !fs.existsSync(path.join(src, 'lib', 'baseline.ts'));
if (partialSnapshot) {
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent?.filename?.endsWith('/adviceLine.ts') || parent?.filename?.endsWith('\\adviceLine.ts')) {
      if (request === './baseline') return {
        auditCriticalContent: (s) => /确诊|停药|疗效|治疗/u.test(s) ? 'unsafe' : null,
        auditSocial: (s) => /线下见|见个面|微信号|联系方式/u.test(s) ? 'unsafe' : null,
        auditTone: () => null,
      };
      if (request === './safety') return { findCrisis: (s) => /自杀|自残/u.test(s) };
    }
    return original.apply(this, arguments);
  };
}
const { actionMap } = require('../src/lib/actions.ts');
const { curatedActionUsesAcrossCards } = require('../src/lib/curatedUsage.ts');
const { parseAdviceChoice, validateAdviceLine, chooseAdviceCopy, sanitizeCardLineSources } = require('../src/lib/adviceLine.ts');
const { playerFacingAdviceAction } = require('../src/lib/adviceFallbackCopy.ts');
const action = actionMap['lab-unit-2'];
const context = '实验数据异常，我要核对表里那一列单位，室友说先别动别的';
const good = '先只核对表里那一列单位，对完就停，别顺手改别的。';
const now = 1_800_000_000_000;

for (const raw of [
  JSON.stringify({actionId:'lab-unit-2',line:good}),
  '```json\n'+JSON.stringify({actionId:'lab-unit-2',line:good})+'\n```',
  '\n  '+JSON.stringify({actionId:'lab-unit-2',line:good})+'  \n',
]) {
  test('JSON/code-fence response parses exact candidate and line', () => {
    assert.deepEqual(parseAdviceChoice(raw,['lab-unit-2']),
      {kind:'choice',actionId:'lab-unit-2',line:good,legacy:false});
  });
}
test('NONE and null abstain; legacy only accepts a standalone candidate ID', () => {
  for (const text of ['NONE','none','null',' null ','```json\nnull\n```']) {
    assert.equal(parseAdviceChoice(text,['lab-unit-2']).kind,'none');
  }
  assert.deepEqual(parseAdviceChoice('lab-unit-2',['lab-unit-2']),
    {kind:'choice',actionId:'lab-unit-2',line:null,legacy:true});
  assert.deepEqual(parseAdviceChoice('动作ID: lab-unit-2',['lab-unit-2']),
    {kind:'choice',actionId:'lab-unit-2',line:null,legacy:true});
  assert.deepEqual(parseAdviceChoice('{"actionId":"lab-unit-2"}',['lab-unit-2']),
    {kind:'choice',actionId:'lab-unit-2',line:null,legacy:false});
  assert.equal(parseAdviceChoice('我建议你先用 lab-unit-2',['lab-unit-2']).kind,'invalid');
});
test('cannot invent IDs, choose a random candidate, or accept malformed output', () => {
  for (const raw of [
    '{"actionId":"not-in-options","line":"先核对单位。"}',
    'another-candidate',
  ]) assert.deepEqual(parseAdviceChoice(raw,['lab-unit-2']), {kind:'invalid',reason:'action_mismatch'});
  for (const raw of ['','{}','["lab-unit-2"]','{"actionId":42}', '{"actionId":"lab-unit-2"', '选一条吧']) {
    assert.equal(parseAdviceChoice(raw,['lab-unit-2']).kind,'invalid');
  }
});
test('accepts an anchored, specific conversational micro-action', () => {
  assert.deepEqual(validateAdviceLine(good,action,context),{ok:true});
  assert.deepEqual(validateAdviceLine('要不先只圈出今天要复习的一个考点，三分钟就够。',actionMap['exam-scope-2'],'考试考点很多，今晚只复习一点'),{ok:true});
  assert.deepEqual(validateAdviceLine('你可以先跟室友说清楚是键盘声，不用把整件事都摊开。',actionMap['peer-clarify-2'],'室友敲键盘声太响，我不敢开口'),{ok:true});
});
const badCases = [
  ['','missing'], ['把简历打开','no_anchor'],
  ['我会先把实验数据单位核对一下。','perspective'],
  ['“我打算先核对实验数据单位，再看看问题。”','perspective'],
  ['建议你先核对实验数据单位，然后就可以继续了。','counselor'],
  ['你已经很棒了！','too_short'],
  ['你已经做得很好了，慢慢来就好。','pure_comfort'],
  ['你觉得呢？','too_short'],
  ['你是不是觉得这样不太好呢？','pure_question'],
  ['先打开手机，去查点自己喜欢的短视频就行了。','no_anchor'],
  ['先核对实验数据单位，沈默也会这样做。','persona_name'],
  ['让AI模型帮你核对实验数据单位，然后继续。','model_name'],
  ['先核对单位，再加我微信号给你发资料。','unsafe'],
  ['先核对单位，然后线下见个面一起改。','unsafe'],
  ['先核对单位，医生可以给你确诊抑郁症。','unsafe'],
  ['先核对单位，再联系 test@example.com。','unsafe'],
  ['先核对单位。再把整张表全部修改。第三步写报告。','too_many_sentences'],
  ['先核对数据单位，'.repeat(12)+'就好。','too_long'],
];
for (const [text,reason] of badCases) {
  test('invalid model wording falls back: '+reason+' / '+text.slice(0,15), () => {
    const result=validateAdviceLine(text,action,context);
    if (text==='把简历打开') assert.equal(result.ok,false); // a label/off-topic
    else assert.deepEqual(result,{ok:false,reason});
  });
}
test('exact action labels and direct-send instead of draft are rejected', () => {
  const peer=actionMap['peer-clarify-2'];
  const label=validateAdviceLine(peer.label,peer,'跟室友说话想澄清');
  assert.equal(label.ok,false);
  assert.equal(validateAdviceLine('现在就发送那句澄清给室友，别等了。',peer,'室友让我难受').ok,false);
});
const priorCard = (id, at, line=good) => ({
  id, advice:{actionId:action.id, origin:'curated',at,text:line},
  comments:[{authorKind:'persona',origin:'curated',actionId:action.id,text:line,at}],
});
test('first action uses model wording while action origin stays curated', () => {
  const resolved=chooseAdviceCopy(action,[],now,'new',good);
  assert.equal(resolved.text,good);
  assert.equal(resolved.lineSource,'model');
  assert.equal(resolved.priorCards,0);
});
test('second card can use a fresh model line; third card abstains within 24h', () => {
  const previous=[priorCard('old1',now-3000)];
  const newLine='先核对实验数据中的那一列单位，三分钟后停下来。';
  assert.deepEqual(validateAdviceLine(newLine,action,context),{ok:true});
  const second=chooseAdviceCopy(action,previous,now,'new',newLine);
  assert.equal(second.lineSource,'model');
  assert.equal(second.text,newLine);
  const two=[...previous,priorCard('old2',now-1000,newLine)];
  assert.equal(curatedActionUsesAcrossCards(two,action.id,now,'new'),2);
  assert.equal(chooseAdviceCopy(action,two,now,'new','换一句话先核对实验数据单位。'),null);
  assert.ok(chooseAdviceCopy(action,previous,now+86_400_100,'new',newLine));
});
test('same model text on second card must use alternate or abstain, never repeat', () => {
  const previous=[priorCard('old',now-1000)];
  const result=chooseAdviceCopy(action,previous,now,'second',good);
  assert.equal(result.lineSource,'curated');
  assert.notEqual(result.text,good);
  assert.equal(result.fallbackReason,'repeated');
  const noAlt={...action,alternateLine:undefined};
  assert.equal(chooseAdviceCopy(noAlt,previous,now,'second',good),null);
});
test('legacy ID and invalid model line stay curated; action ID preserved', () => {
  const legacy=parseAdviceChoice('lab-unit-2',[action.id]);
  const fallback=chooseAdviceCopy(action,[],now,'new',legacy.line);
  assert.equal(fallback.lineSource,'curated');
  assert.equal(fallback.text,playerFacingAdviceAction(action).line);
});
test('shrinkAdvice preserves actionId chain and marks smaller copy curated (source contract)', () => {
  const source=fs.readFileSync(path.join(src,'lib','cards.ts'),'utf8');
  assert.match(source,/const smallerText = helpSeeking \? smaller\.label : smaller\.line;/u);
  assert.match(source,/text: smallerText, actionId: smaller\.id, at: now, lineSource: 'curated'/u);
  assert.match(source,/text: smallerText,\s*actionId: smaller\.id,\s*at: now,\s*lineSource: 'curated'/u);
});
test('import sanitization drops only illegal lineSource and preserves old records', () => {
  const card={ id:'x', comments:[{at:now,text:good,lineSource:'forged',kind:'advice'},
    {at:now+1,text:'ok',lineSource:'model'}], advice:{ text:good,actionId:action.id,lineSource:'forged'} };
  const clean=sanitizeCardLineSources(card);
  assert.equal(clean.advice.lineSource,undefined);
  assert.equal(clean.advice.actionId,action.id);
  assert.equal(clean.comments[0].lineSource,undefined);
  assert.equal(clean.comments[1].lineSource,'model');
  assert.equal(card.advice.lineSource,'forged');
  const old={id:'legacy',comments:[]};
  assert.equal(sanitizeCardLineSources(old),old);
});
test('reviewed fallback wording contains no P0 old lines and keeps stable IDs', () => {
  const source=fs.readFileSync(path.join(src,'lib','actions.ts'),'utf8');
  for (const old of [
    '我会先弄清楚自己要守住哪条界限。',
    '我会先记下一个还没想明白的点。',
    '我会先在草稿里写一句平实的澄清。',
    '那就先把简历文件打开，别的不管。',
    '我会先留一句草稿，发不发以后再定。',
  ]) assert.ok(!source.includes(old),old);
  for (const id of ['love-one-2','love-need-2','love-draft-2','love-fact-2','love-silence-2','love-pattern-2','love-limit-2']) {
    assert.ok(actionMap[id],id);
    assert.doesNotMatch(actionMap[id].alternateLine??'',/^我会/u,id);
  }
  for (const id of ['peer-boundary-2','peer-clarify-2','plan-note-2','resume-2','write-reference-1']) {
    assert.ok(actionMap[id],id);
    assert.ok(Array.from(actionMap[id].line).length>=8,id);
  }
  assert.match(actionMap['resume-2'].line,/简历文件/);
  assert.match(actionMap['write-reference-1'].line,/文献列表/);
  assert.equal(actionMap['resume-3'].smaller,'resume-2');
});
test('advice source contract preserves one model call and all special-case branches', () => {
  const cards=fs.readFileSync(path.join(src,'lib','cards.ts'),'utf8');
  assert.match(cards,/maxTokens: SHORT_TASK_TOKEN_BUDGETS\.advice/u);
  assert.match(cards,/lowEffort: true/u);
  assert.match(cards,/withUntrustedHistory\(`卡片：\$\{contextText\}/u);
  assert.match(cards,/parseAdviceChoice\(raw, options\.map/u);
  assert.match(cards,/validateAdviceLine\(choice\.line, action, contextText\)/u);
  assert.match(cards,/lineSource/u);
  assert.match(cards,/materialFirstStep\(/u);
  assert.match(cards,/needsHelpSeeking\(context\)/u);
  assert.match(cards,/hasPlayerCrisisInput\(card\)/u);
  assert.match(cards,/if \(!seekingHelp && !isMock\(input\.config\) && modelAllowed\)/u);
});

const completeRepo = !partialSnapshot && fs.existsSync(path.join(src,'lib','store.ts'));
if (completeRepo) {
  const { askForAdvice, shrinkAdvice } = require('../src/lib/cards.ts');
  const { defaultPersonas } = require('../src/lib/personas.ts');
  const { defaultSettings } = require('../src/lib/store.ts');
  const { modelFailureNotice } = require('../src/lib/modelStatus.ts');
  const people=defaultPersonas();
  const settings={...defaultSettings,paused:false,aiCardLimit:0};
  const config={providerId:'compatible',baseUrl:'https://example.test/v1',apiKey:'fixture-only',model:'fixture'};
  const card = (id, text, extra={})=>({id,text,authorId:'me',authorName:'测试',authorKind:'player',
    kind:'worry',status:'talking',createdAt:now-1000,arrivals:['shenmo'],plan:[],pending:[],comments:[],...extra});
  const json = (content, finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content}}]}),
    {status:200,headers:{'content-type':'application/json'}});
  async function simulate(id,text,makeReply,extra={}) {
    const before=card(id,text,extra); const bodies=[];const original=global.fetch;
    global.fetch=async(_url,opts)=>{const body=JSON.parse(opts.body);bodies.push(body);return json(makeReply(body));};
    try {return {out:await askForAdvice({cards:[before],personas:people,settings,config,now,cardId:id,personaId:'shenmo'}),bodies};}
    finally {global.fetch=original;}
  }
  test('real askForAdvice: JSON line is saved once with model wording metadata and budget', async()=>{
    const {out,bodies}=await simulate('line-valid','实验数据异常，我要核对一列单位',body=>{
      const m=body.messages[1].content.match(/^([a-z0-9-]+) \|/m);assert.ok(m);
      assert.match(body.messages[1].content,/只返回 JSON/);
      assert.doesNotMatch(body.messages[1].content,/楼主后续补充/);
      return JSON.stringify({actionId:m[1],line:'要不先核对实验数据里的那一列单位，确认后就停。'});
    });
    assert.equal(bodies.length,1);
    assert.equal(bodies[0].max_tokens,900);
    assert.equal(bodies[0].reasoning_effort,'low');
    assert.equal(out.calls,1);
    assert.equal(out.cards[0].advice.lineSource,'model');
    assert.equal(out.cards[0].advice.origin,'curated');
    assert.equal(out.cards[0].comments.at(-1).lineSource,'model');
    assert.equal(out.cards[0].advice.text,out.cards[0].comments.at(-1).text);
    assert.match(out.logs.join(' '),/advice_line=model/);
    assert.doesNotMatch(out.logs.join(' '),/fixture-only|实验数据异常/);
  });
  test('real askForAdvice: supplementary player comment is present in prompt',async()=>{
    const {out,bodies}=await simulate('line-context','实验数据异常',body=>{
      assert.match(body.messages[1].content,/我补充一句/);
      return body.messages[1].content.match(/^([a-z0-9-]+) \|/m)[1];
    },{comments:[{id:'player-1',authorKind:'player',authorId:'me',at:now-10,text:'我补充一句，单位在第二列'}]});
    assert.equal(bodies.length,1);
    assert.equal(out.cards[0].advice.lineSource,'curated');
  });
  test('real askForAdvice: invalid line falls back, invalid ID/NONE abstain',async()=>{
    for(const bad of ['我会先核对一列实验数据单位。','你已经很棒了！','加我微信号来核对实验数据单位吧。']){
      const {out,bodies}=await simulate('bad-'+bad,'实验数据异常，我要核对一列单位',body=>{
        const id=body.messages[1].content.match(/^([a-z0-9-]+) \|/m)[1];
        return JSON.stringify({actionId:id,line:bad});
      });
      assert.equal(bodies.length,1);
      assert.equal(out.cards[0].advice.lineSource,'curated');
      assert.match(out.logs.join(' '),/advice_line=fallback:/);
      assert.doesNotMatch(out.logs.join(' '),/微信号|实验数据异常/);
    }
    for (const bad of ['NONE','{"actionId":"not-candidate","line":"先核对单位。"}']){
      const {out}=await simulate('none-'+bad,'实验数据异常，我要核对一列单位',()=>bad);
      assert.equal(out.cards[0].advice,undefined);
      assert.match(out.logs.join(' '),/advice_choice=none/);
    }
  });
  test('real shrinkAdvice: model line becomes curated smaller step',async()=>{
    const fixture={...card('shrink','实验数据异常'),status:'advised',
      advice:{text:good,actionId:action.id,origin:'curated',lineSource:'model',fromPersonaId:'shenmo',accepted:false,at:now}};
    const next=shrinkAdvice(fixture,now+1);
    assert.equal(next.advice.lineSource,'curated');
    assert.equal(next.advice.actionId,action.smaller);
    assert.equal(next.advice.text,actionMap[action.smaller].line);
    assert.equal(next.comments.at(-1).lineSource,'curated');
  });
  test('real shrinkAdvice: help-seeking keeps the neutral label', ()=>{
    const fixture={...card('help-shrink','最近总是提不起劲'),status:'advised',
      advice:{text:'先找到学校心理中心或正规医院的官方渠道，再看看预约方式',actionId:'help-3',origin:'curated',lineSource:'curated',fromPersonaId:'shenmo',accepted:false,at:now}};
    const next=shrinkAdvice(fixture,now+1);
    assert.equal(next.advice.actionId,'help-2');
    assert.match(next.advice.text,/搜索学校心理中心或正规医院/u);
    assert.equal(next.advice.lineSource,'curated');
  });
  test('real model failure keeps the user-facing fallback notice without provider details',async()=>{
    const original=global.fetch;
    global.fetch=async()=>{throw Error('provider secret body');};
    try {
      const out=await askForAdvice({cards:[card('failure','实验数据异常，我要核对一列单位')],
        personas:people,settings,config,now,cardId:'failure',personaId:'shenmo'});
      assert.match(out.logs.join(' '),/模型挑选下一步失败/u);
      assert.doesNotMatch(out.logs.join(' '),/provider secret body/u);
      assert.ok(modelFailureNotice(out.logs));
    } finally {global.fetch=original;}
  });
  test('real mock: no network call; advice origin and lineSource demo',async()=>{
    const original=global.fetch;
    global.fetch=()=>{throw Error('mock called fetch unexpectedly');};
    try {
      const out=await askForAdvice({cards:[card('mock','实验数据异常，我要核对一列单位')],
        personas:people,settings,config:{providerId:'mock',model:'demo',baseUrl:'',apiKey:''},now,cardId:'mock',personaId:'shenmo'});
      assert.equal(out.calls,0);assert.equal(out.cards[0].advice.origin,'demo');
      assert.equal(out.cards[0].advice.lineSource,'demo');
    } finally {global.fetch=original;}
  });
} else {
  test('full cards.ts network integration requires full project; ZIP supplies partial source',
    {skip:'src/lib/store.ts / baseline.ts and other production dependencies are not in this requirements ZIP'},()=>{});
}
