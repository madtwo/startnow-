const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, filename) => {
  const res = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(res.outputText, filename);
};
const lib = (name) => require(path.resolve(__dirname, '../src/lib', name + '.ts'));
const goal = lib('decompose');
const draft = lib('decomposeDraft');
const usage = lib('decomposeUsage');
const notice = lib('noticeFields');
const llm = lib('llm');
const config = { providerId: 'compatible', model: 'test-model', visionModel: '', baseUrl: 'https://example.com/v1', apiKey: 'test' };
const date = '2026-11-20';
const now = new Date(2026, 10, 18, 8).getTime();
const good = JSON.stringify({ title:'Do not trust model title', assumptions:['自设截止日', '截止日另设为星期六', '用户还没有进展'], steps:[
  {text:'列出异常数据', minutes:20, due:date},
  {text:'写实验方法段', minutes:40},
  {text:'核对实验结果', minutes:30},
] });
const input = {goalText:'三天内整理实验报告', answers:{}, skipped:true, now};
const makeStore=()=>{ const m=new Map();return { getItem:(k)=>m.get(k)??null, setItem:(k,v)=>m.set(k,v),removeItem:(k)=>m.delete(k)}; };

test('R3: assumptions at most four, each <=60 and not duplicated by model',()=>{
 const plan=goal.parseDecomposition(good,input);
 assert.equal(plan.steps.length,3);
 assert.ok(plan.assumptions.length<=4);
 assert.ok(plan.assumptions.every(s=>s.length<=60));
 assert.equal(plan.assumptions.filter(s=>/截止日/.test(s)).length,0); // goal states three-day deadline
 const answered={deadline:'周五',deliverable:'实验报告',constraint:'仅周末',done:'能提交',progress:'已做了一半'};
 assert.deepEqual(goal.normalizeAssumptions(['截止日期默认后天'],answered,true),[]);
 assert.deepEqual(goal.defaultAssumptions(answered),[]);
});
test('R3: skipped goal without answers has no invented teacher deadline and <=4 defaults',()=>{
 const plan=goal.parseDecomposition(good,{...input,goalText:'整理内容'});
 assert.ok(plan.assumptions.length<=4);
 assert.match(plan.assumptions.join(' '),/不是真实 DDL/);
});
test('R4: daily work estimate uses local calendar days, conservatively rounds up',()=>{
 const steps=[{text:'写',minutes:100},{text:'读',minutes:80}];
 assert.deepEqual(goal.estimateDailyEffort(steps,undefined,now),
  {totalMinutes:180,days:3,dailyMinutes:60,heavy:false,isDeadlineConfirmed:false});
 assert.equal(goal.estimateDailyEffort([{text:'写',minutes:121},{text:'读',minutes:121}],undefined,now).heavy,false);
 const tomorrow = new Date(2026,10,19).getTime();
 assert.equal(goal.estimateDailyEffort(steps,tomorrow,now).dailyMinutes,90);
 assert.equal(goal.estimateDailyEffort(steps,new Date(2026,10,18).getTime(),now).heavy,true);
});
test('R5: invalid JSON automatically retries once if quota is available',async()=>{
 const orig=llm.streamChat;
 let attempts=0,reservations=0,retries=[];
 llm.streamChat=async ()=> (++attempts===1?'not json':good);
 try {const out=await goal.decomposeViaApi(config,{...input,onRetryAttempt:()=>reservations++,onRetry:code=>retries.push(code)});
   assert.equal(out.steps.length,3);assert.equal(attempts,2);assert.equal(reservations,1);assert.deepEqual(retries,['json_invalid']);
 } finally {llm.streamChat=orig;}
});
test('R5: twice-invalid output stops after one retry',async()=>{
 const orig=llm.streamChat;let calls=0;
 llm.streamChat=async()=>{calls++;return '{}';};
 try {await assert.rejects(()=>goal.decomposeViaApi(config,{...input,onRetryAttempt:()=>{}}),/步骤|格式|步骤结构/);
  assert.equal(calls,2);
 } finally {llm.streamChat=orig;}
});
test('R5: no remaining quota means zero retry requests',async()=>{
 const orig=llm.streamChat;let calls=0;
 llm.streamChat=async()=>{calls++;return 'invalid';};
 try {await assert.rejects(()=>goal.decomposeViaApi(config,{...input,onRetryAttempt:()=>{throw new Error('quota')}}),/额度不足/);
  assert.equal(calls,1);
 } finally {llm.streamChat=orig;}
});
test('R5: step crisis never triggers automatic retry',async()=>{
 const orig=llm.streamChat;let calls=0;
 llm.streamChat=async()=>{calls++;return JSON.stringify({steps:[{text:'去自杀',minutes:2},{text:'写报告',minutes:2},{text:'读论文',minutes:2}]});};
 try {await assert.rejects(()=>goal.decomposeViaApi(config,{...input,onRetryAttempt:()=>{throw new Error('should not retry')}}));
  assert.equal(calls,1);
 } finally {llm.streamChat=orig;}
});
test('R2: user abort before request does not call API',async()=>{
 const orig=llm.streamChat;let calls=0;
 llm.streamChat=async()=>{calls++;return good};
 const ctrl=new AbortController();ctrl.abort();
 try {await assert.rejects(()=>goal.decomposeViaApi(config,{...input,signal:ctrl.signal}),/取消/);
  assert.equal(calls,0);
 } finally {llm.streamChat=orig;}
});
test('R2: mid-flight abort prevents result',async()=>{
 const orig=llm.streamChat;const ctrl=new AbortController();
 llm.streamChat=async({signal})=>{await new Promise(resolve=>setTimeout(resolve,10));assert.equal(signal.aborted,true);return good;};
 try {const pending=goal.decomposeViaApi(config,{...input,signal:ctrl.signal});ctrl.abort();
  await assert.rejects(pending,/取消/);
 } finally {llm.streamChat=orig;}
});
test('R1: no vision model never reaches fetch',async()=>{
 const orig=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw new Error('unexpected')};
 try {const result=await goal.recognizeNotice(config,'data:image/png;base64,AA==');assert.equal(result.ok,false);assert.equal(result.code,'vision_unsupported');assert.equal(calls,0);}
 finally {global.fetch=orig;}
});
test('R1: opted-in vision model is used instead of text model',async()=>{
 const orig=global.fetch;let payload;
 global.fetch=async(_url,opts)=>{payload=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:'事项：交报告；日期或DDL：[看不清]；地点：教三201；提交方式：[未提及]'}}]})};};
 try {const result=await goal.recognizeNotice({...config,visionModel:'my-vision'},'data:image/png;base64,AA==');
  assert.equal(payload.model,'my-vision');assert.equal(result.ok,true);assert.equal(result.format,'fields');assert.match(result.raw,/看不清/);
 } finally {global.fetch=orig;}
});
test('R6: draft keeps answers, mode and confirmed deadline for seven days',()=>{
 const storage=makeStore();const data={goal:'写报告',manualSteps:'第一步',answers:{deadline:'周五',done:'写完方法'},mode:'grill',confirmedDeadline:'2026-11-20'};
 draft.saveDecomposeDraft(storage,data,now);
 assert.deepEqual(draft.readDecomposeDraft(storage,now+500),data);
 assert.equal(draft.readDecomposeDraft(storage,now+8*86400000).goal,'');
});
test('R6: previous draft shape is not lost',()=>{
 const storage=makeStore();storage.setItem(draft.DECOMPOSE_DRAFT_KEY,JSON.stringify({goal:'旧目标',steps:'旧步骤',at:now}));
 const d=draft.readDecomposeDraft(storage,now+100);
 assert.equal(d.manualSteps,'旧步骤');assert.deepEqual(d.answers,{});
});
test('R7: counters distinguish decompositions/retries from vision and reset at midnight',()=>{
 const storage=makeStore();usage.recordDecomposeAttempt(storage,'decompose',now);
 usage.recordDecomposeAttempt(storage,'decompose',now);
 usage.recordDecomposeAttempt(storage,'vision',now);
 assert.equal(usage.readDecomposeUsage(storage,now).decompose,2);
 assert.equal(usage.readDecomposeUsage(storage,now).vision,1);
 assert.equal(usage.readDecomposeUsage(storage,now+86400000).vision,0);
});
test('R2/R6: UI shows cancellable stages and retains answer draft',()=>{
 const ui=fs.readFileSync(path.resolve(__dirname,'../src/components/DecomposeSheet.tsx'),'utf8');
 assert.match(ui,/activeController\.current\?\.abort/);
 assert.match(ui,/取消拆解（保留输入）/);
 assert.match(ui,/elapsed >= 8/);
 assert.match(ui,/elapsed >= 20/);
 assert.match(ui,/confirmedDeadline: deadline/);
 assert.match(ui,/disabled=\{busy \|\| !config\.visionModel/);
});

test('R1: visual field parser preserves explicit unreadable and unmentioned values',()=>{
 const fields=notice.parseNoticeFields('事项：提交实验报告；日期或DDL：[看不清]；地点：[未提及]；提交方式：学习通');
 assert.deepEqual(fields,{item:'提交实验报告',date:'[看不清]',location:'[未提及]',submission:'学习通',excerpt:'[未提及]'});
});
test('R8: goals harness has explicit mode, retry, metrics and manual visual accuracy boundary',()=>{
 const h=fs.readFileSync(path.resolve(__dirname,'../src/soak/harness.ts'),'utf8');
 assert.match(h,/goalCount/);assert.match(h,/assumptionCount/);assert.match(h,/dailyMinutes/);
 assert.match(h,/retryCount/);assert.match(h,/visionRawFallback/);assert.match(h,/requires_manual_review/);
 assert.match(h,/local-fault/);
});
test('R2: decompose call uses 60s end-to-end timeout budget',async()=>{
 const orig=llm.streamChat, oldTimeout=global.setTimeout, oldClear=global.clearTimeout;
 const delays=[];
 llm.streamChat=async()=>good;
 global.setTimeout=(cb,ms,...args)=>{delays.push(ms);return oldTimeout(cb,ms,...args)};
 try {await goal.decomposeViaApi(config,input);assert.ok(delays.includes(60000));}
 finally {global.setTimeout=oldTimeout;global.clearTimeout=oldClear;llm.streamChat=orig;}
});
test('R5: invalid past date is rejected without wasting retry allowance',async()=>{
 const orig=llm.streamChat;let calls=0;
 llm.streamChat=async()=>{calls++;return JSON.stringify({steps:[
  {text:'核对数据',minutes:10,due:'2020-01-01'},
  {text:'整理资料',minutes:20},{text:'修改文稿',minutes:20},
 ]});};
 try {await assert.rejects(()=>goal.decomposeViaApi(config,{...input,onRetryAttempt:()=>{throw new Error('should not retry')}}),/日期/);
 assert.equal(calls,1);} finally {llm.streamChat=orig;}
});
test('R1: vision rejects unsupported HTTP error and does not hallucinate fields',async()=>{
 const orig=global.fetch;
 global.fetch=async()=>({ok:false,status:400,text:async()=> 'unsupported image_url'});
 try {const result=await goal.recognizeNotice({...config,visionModel:'image-model'},'data:image/png;base64,AA==');assert.equal(result.ok,false);assert.equal(result.code,'vision_unsupported');}
 finally {global.fetch=orig;}
});
test('R7: settings and full reset handle optional vision model and local counts',()=>{
 const settings=fs.readFileSync(path.resolve(__dirname,'../src/components/SettingsDialog.tsx'),'utf8');
 const store=fs.readFileSync(path.resolve(__dirname,'../src/lib/store.ts'),'utf8');
 const app=fs.readFileSync(path.resolve(__dirname,'../src/App.tsx'),'utf8');
 assert.match(settings,/视觉模型（可选）/);
 assert.match(store,/visionModel:/);assert.match(store,/shudong\.decomposeUsage\.v1/);
 assert.match(app,/recordDecomposeAttempt\(localStorage, kind\)/);
});

test('R1: 识图请求必须带 x-opencode-session，否则网关会 400 MissingSessionID', async () => {
  const before = global.fetch;
  let seenHeader = '';
  let seenModel = '';
  global.fetch = async (_url, init) => {
    seenHeader = String(init.headers['x-opencode-session'] ?? '');
    seenModel = JSON.parse(String(init.body)).model;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '事项：提交实验报告；日期或DDL：11月20日；地点：教三201；提交方式：学习通；原文摘录：提交实验报告' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await goal.recognizeNotice(
      { ...config, visionModel: 'deepseek-v4.1-flash' },
      'data:image/png;base64,iVBORw0KGgo=',
    );
    assert.equal(result.ok, true);
    assert.ok(result.ok && (result.format === 'fields' || result.format === 'raw'));
    assert.match(result.ok ? result.raw : '', /事项/);
    assert.equal(seenModel, 'deepseek-v4.1-flash');
    assert.ok(seenHeader.length > 0, '必须携带 x-opencode-session');
  } finally { global.fetch = before; }
});
