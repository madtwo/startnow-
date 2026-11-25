// Independent C-01 integration tests through the actual tickRoom -> LLM ->
// completion state update. All replies below are synthetic, no paid calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const room = lib('room');
const people = lib('personas').defaultPersonas();
const now = new Date(2026, 10, 24, 15, 0).getTime();
const settings = {liveliness:0,timeFlow:false,dailyMessages:1};
const config = {providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'synthetic',fallbackModel:'',apiKey:'synthetic-only'};
const response = (text, finish_reason='stop') => new Response(JSON.stringify({choices:[{message:{content:text},finish_reason}]}), {headers:{'content-type':'application/json'}});
const NOTES='写一行开题笔记', FORMULA='把公式抄到卡片上', COLUMN='整理实验数据的第一列', ROOMMATE='给室友发一条沟通消息', LIST='把小组分工写成清单', INTERVIEW='准备面试自我介绍的第一段', APPLY='投出一个实习岗位', HEADINGS='列出文献综述的三个小标题', PRACTICE='练习课程展示的开头两分钟', TERMS='背五个专业名词';

function due(task, actionId) {
  const r=room.newRoom(people.slice(0,4),now,'Synthetic audit');
  const step={id:'persona-step',text:task,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000,...(actionId===undefined?{}:{actionId})};
  return {...r,messages:[],scheduled:[],steps:[step],usage:{day:new Date(now).toDateString(),messages:0},lastMessageAt:now,lastSeenAt:now};
}
async function simulate(task, raw, {actionId,finish,networkError=false,roomInput}={}) {
  const before=roomInput??due(task,actionId); const oldFetch=global.fetch,oldRandom=Math.random;
  let attempts=0; const prompts=[];
  Math.random=()=>0.99;
  global.fetch=async(url,init)=>{
    attempts++; assert.match(String(url),/^https:\/\/audit\.invalid\//);
    prompts.push(JSON.parse(init.body).messages.at(-1).content);
    if(networkError) throw new Error('synthetic-provider-secret-do-not-display');
    return response(raw,finish);
  };
  try {
    const out=await room.tickRoom({room:before,settings,config,now});
    return {out,before,attempts,prompts,step:out.room.steps.find(s=>s.id==='persona-step')};
  } finally {global.fetch=oldFetch;Math.random=oldRandom;}
}
function check(result, accepted, raw, requests=1) {
  const {out,step,attempts,before}=result;
  assert.ok(step,'original pending step must not disappear');
  assert.equal(step.text,before.steps[0].text); assert.equal(step.actionId,before.steps[0].actionId);
  assert.equal(attempts,requests); assert.equal(out.calls,requests); assert.equal(out.room.usage.messages,requests);
  if(accepted) {
    assert.equal(step.doneAt,now); assert.equal(out.room.messages.length,1);
    assert.equal(out.room.messages[0].stepId,step.id);
    assert.equal(out.room.messages[0].text,raw.slice(5).trim()); assert.equal(out.logs.length,0);
  } else {
    assert.equal(step.doneAt,undefined); assert.equal(out.room.messages.length,0);
    assert.ok(step.dueAt>=now+5*60000,'pending step receives retry delay');
    assert.ok(out.logs.length,'visible failure feedback');
    assert.ok(!out.logs.join(' ').includes('synthetic-provider-secret-do-not-display'));
  }
}

const good=[
  [NOTES,'DONE|开题笔记写了一行'],[NOTES,'DONE|我写好了一行笔记。'],
  [FORMULA,'DONE|公式抄上卡片了'],[FORMULA,'DONE|卡片抄了六张，手机又亮了'],[FORMULA,'DONE|抄了两张公式卡片'],
  [COLUMN,'DONE|第一列粘完了'],[COLUMN,'DONE|实验数据的第一列整理好了'],
  [ROOMMATE,'DONE|给室友发了条消息，问要不要带宵夜'],[ROOMMATE,'DONE|消息发给室友了'],
  [LIST,'DONE|清单列好了'],[LIST,'DONE|分工清单列好了，发群里了'],[LIST,'DONE|把小组分工写成了清单'],
  [INTERVIEW,'DONE|面试自我介绍的第一段准备好了'],[INTERVIEW,'DONE|第一段自我介绍写好了'],
  [APPLY,'DONE|投出去了'],[APPLY,'DONE|投出去了，简历改了三版'],[APPLY,'DONE|投递成功了'],
  [HEADINGS,'DONE|列好了炎症、损伤修复、循环障碍三个小标题'],[HEADINGS,'DONE|我写了三个小标题'],[HEADINGS,'DONE|文献综述的3个小标题列好了'],
  [PRACTICE,'DONE|开头两分钟练完了'],[PRACTICE,'DONE|练了2分钟课程展示的开头'],
  [TERMS,'DONE|五个专业名词背完了'],[TERMS,'DONE|背了5个专业术语'],
  ['写一行笔记','DONE|我写了一行笔记。'],['写标题','DONE|我把标题写好了。'],['核对单位','DONE|我核对完单位了。'],
  ['写一行','DONE|只写了一行'],
];
for(const [task,raw] of good) test(`accept ${task} / ${raw}`,async()=>check(await simulate(task,raw),true,raw));

const bad=[
  [NOTES,'DONE|写了两句又全删了'],[NOTES,'DONE|只写了标题'],[NOTES,'DONE|写了一半'],[NOTES,'DONE|清空了'],[NOTES,'DONE|明天再写'],[NOTES,'DONE|还没开始'],
  [NOTES,'DONE|打开了空白文档'],[NOTES,'DONE|我把标题写好了。'],[NOTES,'DONE|我核对完单位了。'],[NOTES,'DONE|我完成了'],
  [NOTES,'DONE|写了一行笔记，后来没存'],[NOTES,'DONE|写了一行笔记又重写了'],[NOTES,'DONE|写了一行笔记但没保存'],[NOTES,'DONE|写了一行笔记，尚未提交'],
  [NOTES,'DONE|写了半行笔记'],[NOTES,'DONE|写了一行日记'],[NOTES,'DONE|我可能写了一行笔记'],[NOTES,'DONE|我写了一行笔记？'],
  [NOTES,'DONE|写了一行笔记\n还没完成'],[NOTES,'DONE|写了一行笔记|补充'],[NOTES,'DONE|写了一行笔记\u2028还没完成'],[NOTES,'DONE|写了一行笔记\u2060'],
  [NOTES,'DONE|写了一行笔记，给我你的微信号'],[NOTES,'DONE|写了一行笔记，'+('今天还没完成'.repeat(8))],
  [FORMULA,'DONE|公式抄了一半'],[FORMULA,'DONE|卡片抄了0张'],[FORMULA,'DONE|公式抄到卡片上'],[FORMULA,'DONE|公式抄上卡片了，又擦掉了'],[FORMULA,'DONE|笔记写好了一行'],
  [COLUMN,'DONE|第一列粘了一半'],[COLUMN,'DONE|第二列粘完了'],[COLUMN,'DONE|第一列粘了两格'],[COLUMN,'DONE|第一列粘完了，未保存'],
  [ROOMMATE,'DONE|给室友写了一条消息'],[ROOMMATE,'DONE|给老师发了一条消息'],[ROOMMATE,'DONE|给室友发了一条消息，问要不要撤回'],[ROOMMATE,'DONE|给室友发了一条消息，问能不能发出去但没发送'],
  [LIST,'DONE|把小组分工写成清单'],[LIST,'DONE|只写了清单标题'],[LIST,'DONE|分工清单列好了，又全删了'],
  [INTERVIEW,'DONE|自我介绍第一段只写了一句'],[INTERVIEW,'DONE|第二段自我介绍写好了'],[INTERVIEW,'DONE|自我介绍标题写好了'],
  [APPLY,'DONE|简历改好了'],[APPLY,'DONE|投出一个实习岗位'],[APPLY,'DONE|投递一个实习岗位'],[APPLY,'DONE|申请页面打开了'],[APPLY,'DONE|投出去了，没提交成功'],[APPLY,'DONE|投出去了一个篮球'],[APPLY,'DONE|投出去了，简历没保存'],
  [HEADINGS,'DONE|只写了标题'],[HEADINGS,'DONE|列好了两个小标题'],[HEADINGS,'DONE|列好了四个小标题'],[HEADINGS,'DONE|列好了炎症、炎症、炎症三个小标题'],[HEADINGS,'DONE|列好了炎症、损伤修复、循环障碍两三个小标题'],
  [PRACTICE,'DONE|开头一分钟练完了'],[PRACTICE,'DONE|开头背了两句'],[PRACTICE,'DONE|练习准备好了'],
  [TERMS,'DONE|背了俩专业名词'],[TERMS,'DONE|背了四个专业名词'],[TERMS,'DONE|五个专业名词抄完了'],
  [NOTES,'NOT_DONE|开着文档愣了会儿，一个字没写'],[FORMULA,'NOT_DONE|公式抄上卡片了'],[COLUMN,'NOT_DONE|第一列粘完了'],
  [NOTES,'DONE |写了一行开题笔记'],[NOTES,'DONE|'],[NOTES,'写了一行开题笔记'],[NOTES,'DONE|写了一行开题笔记\n'],
];
for(const [task,raw] of bad) test(`reject ${task} / ${JSON.stringify(raw)}`,async()=>check(await simulate(task,raw),false,raw));

test('invalid provider output and transport errors keep pending and report safely',async()=>{
  check(await simulate(NOTES,'DONE|写了一行开题笔记',{finish:'content_filter'}),false);
  check(await simulate(NOTES,'DONE|写了一行开题笔记',{networkError:true}),false);
});
test('failed result remains retryable and next valid result can complete same step',async()=>{
  const failed=await simulate(NOTES,'DONE|打开文档了');check(failed,false);
  const retry={...failed.out.room,usage:{day:new Date(now).toDateString(),messages:0},steps:[{...failed.step,dueAt:now-1}]};
  const raw='DONE|写了一行开题笔记';check(await simulate(NOTES,raw,{roomInput:retry}),true,raw);
});
test('unsupported imported task remains pending with no completion HTTP request',async()=>{
  check(await simulate('未知复合任务，先写然后发给别人','DONE|做完了'),false,undefined,0);
});
test('registered action ID cannot authorize a mismatched task',async()=>{
  check(await simulate(NOTES,'DONE|一列实验数据的单位核对完了',{actionId:'lab-unit-2'}),false,undefined,0);
});
test('registered action ID must exist in the completion catalog',async()=>{
  check(await simulate(NOTES,'DONE|写了一行开题笔记',{actionId:'__proto__'}),false,undefined,0);
});
test('control-separated imported task stays pending without new request',async()=>{
  check(await simulate('写一行\n开题笔记','DONE|写了一行开题笔记'),false,undefined,0);
});
test('bounded stage of a registered title task is not confused with full draft',async()=>{
  check(await simulate('开题报告只写一个小标题','DONE|开题报告的小标题写好了',{actionId:'proposal-heading-2'}),true,'DONE|开题报告的小标题写好了');
  check(await simulate('把文档打开，只写标题和三个小标题','DONE|标题写好了',{actionId:'draft-3'}),false);
});
test('prompt conveys the original task and conditional evidence without claiming completion',async()=>{
  const r=await simulate(TERMS,'NOT_DONE|只背了俩');
  assert.match(r.prompts[0],/背五个专业名词/u);
  assert.match(r.prompts[0],/五个专业名词背完了/u);
  assert.match(r.prompts[0],/不表示已经完成/u);
  check(r,false);
});
