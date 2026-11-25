// Actual tickRoom -> streamChat -> persisted domain state, replayed captured
// HTTP bodies and independent synthetic variants. No network / provider key.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {lib}=require('./_ts-loader.cjs');
const room=lib('room');
const people=lib('personas').defaultPersonas();
const now=new Date(2026,10,24,15,0).getTime();
const config={providerId:'compatible',baseUrl:'https://audit.invalid/v1',model:'replay',fallbackModel:'',apiKey:'synthetic-only'};
const settings={liveliness:0,timeFlow:false,dailyMessages:1};
const tasks=['写一行开题笔记','把公式抄到卡片上','整理实验数据的第一列','给室友发一条沟通消息','把小组分工写成清单','准备面试自我介绍的第一段','投出一个实习岗位','列出文献综述的三个小标题','练习课程展示的开头两分钟','背五个专业名词'];
async function verify(task,raw,expected,{actionId,attempts=1,status=200}={}){
 const r=room.newRoom(people.slice(0,4),now,'C01 scoped evidence replay');
 const step={id:'c01-step',text:task,ownerId:r.cast[0].id,ownerName:r.cast[0].name,origin:'persona',createdAt:now-10000,dueAt:now-1000,...(actionId===undefined?{}:{actionId})};
 const input={...r,messages:[],scheduled:[],steps:[step],usage:{day:new Date(now).toDateString(),messages:0},lastMessageAt:now,lastSeenAt:now};
 const oldFetch=global.fetch,oldRandom=Math.random;let calls=0;
 Math.random=()=>0.99;
 global.fetch=async url=>{assert.match(String(url),/^https:\/\/audit\.invalid\//);calls++;return new Response(JSON.stringify({choices:[{message:{content:raw},finish_reason:'stop'}]}),{status,headers:{'content-type':'application/json'}});};
 try{
  const out=await room.tickRoom({room:input,config,settings,now});const saved=out.room.steps.find(s=>s.id===step.id);
  assert.ok(saved);assert.equal(saved.text,task);assert.equal(saved.actionId,actionId);
  assert.equal(calls,attempts);assert.equal(out.calls,attempts);assert.equal(out.room.usage.messages,attempts);
  assert.equal(saved.doneAt,expected?now:undefined,`${task} / ${raw}`);
  if(expected){assert.equal(out.room.messages.length,1);assert.equal(out.room.messages[0].stepId,step.id);assert.equal(out.room.messages[0].text,raw.slice(5).trim());assert.equal(out.logs.length,0);}
  else{assert.equal(out.room.messages.length,0);assert.ok(saved.dueAt>=now+5*60000);assert.ok(out.logs.length);assert.ok(!out.logs.join(' ').includes(raw));}
 }finally{global.fetch=oldFetch;Math.random=oldRandom;}
}
// Feedback labels are preserved verbatim in the original REVIEW file; the
// machine fixture was cross-checked against each captured HTTP body.
const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','c01-fresh-semantic-50.json'),'utf8'));
assert.equal(rows.length,50);assert.equal(new Set(rows.map(r=>r.id)).size,50);assert.equal(rows.filter(r=>r.expected).length,25);
for(const row of rows)test(`fresh2 replay ${row.id} ${row.expected?'accept':'reject'}`,()=>verify(row.task,row.raw,row.expected,{status:row.status}));
// New combinations, not copied from the feedback. A positive is a plausible
// bounded fictional completion claim, not external proof of real work.
const pairs=[
 [0,'开题笔记记下了行','开题笔记记下了两行'],
 [0,'我写了行笔记:研究变量之间的联系','我写了行笔记:其实还没写'],
 [0,'笔记已记下1行：对照样本来源','笔记已记下2行：对照样本来源'],
 [0,'我写了行开题笔记:比较两种培养路径，已保存','我写了行开题笔记:比较两种培养路径，未保存'],
 [1,'公式全部抄录到卡片上了，卡片仍在书桌上','公式只抄录了一半，卡片仍在书桌上'],
 [1,'我把公式均抄写在卡片上了，卡片放在课桌上','我把公式均抄写在草稿纸上了，卡片放在课桌上'],
 [1,'公式已抄上卡片了，还在桌面','公式抄上卡片了，还在桌面，后来擦掉了'],
 [3,'向室友发送了条明天自习安排的消息','向老师发送了条明天自习安排的消息'],
 [3,'给室友发了1条确认开黑时间的消息','给室友发了2条确认开黑时间的消息'],
 [3,'我已给室友发了条约自习的消息','我已给室友写了条约自习的消息'],
 [3,'给室友的打游戏时间消息发送成功','给室友的打游戏时间消息发送失败'],
 [5,'首段草稿拟定了','第二段草稿拟定了'],
 [5,'我刚写完第1段草稿','我刚写完第1段标题'],
 [5,'自我介绍第一段草稿已写好，已保存','自我介绍第一段草稿已写好，未保存'],
 [6,'实习岗的简历已投递','实习岗的简历准备投递'],
 [6,'简历已经投出，正在等待通知','简历已经投出，通知说投递失败'],
 [6,'简历投进了1个护理实习岗，等回音中','简历投进了2个护理实习岗，等回音中'],
 [6,'实习岗位简历投出去了，等待回复','实习岗位简历投出去了，没投成功'],
 [7,'样本选择、实验设计、统计分析','样本选择、实验设计、实验设计'],
 [7,'细胞损伤、免疫应答、分子机制','细胞损伤、免疫应答、待定标题'],
 [7,'研究背景、临床意义、发展趋势，已保存','研究背景、临床意义、发展趋势，没保存'],
 [7,'血管炎症、氧化应激、缺血再灌注后的组织修复','血管炎症、氧化应激、缺血再灌注后的组织修复、血栓'],
];
for(const [i,good,bad] of pairs){
 test(`artifact/slot positive C${i+1} ${good}`,()=>verify(tasks[i],'DONE|'+good,true));
 test(`artifact/slot negative C${i+1} ${bad}`,()=>verify(tasks[i],'DONE|'+bad,false));
}
const seeds=[
 [0,'写了行开题笔记:比较样本来源'],[1,'公式都抄录到卡片上了，卡片在桌上'],[3,'向室友发了条自习安排的消息'],[5,'第一段草稿已经写好'],[6,'实习岗简历已投出，正在等通知'],[7,'病因机制、临床表现、预后评估'],
];
for(const [i,good] of seeds){
 test(`scoped seed C${i+1}`,()=>verify(tasks[i],'DONE|'+good,true));
 for(const [label,transform] of Object.entries({future:t=>'准备'+t,negated:t=>'没有'+t,rollback:t=>t+'，后来删掉了',partial:t=>t+'，实际只做了一半',unrelated:t=>t+'，今天又做了别的事情',hidden:t=>t+'\u2061',uncertain:t=>'可能'+t,extraLine:t=>t+'\nNOT_DONE|没完成'}))test(`scoped mutation C${i+1} ${label}`,()=>verify(tasks[i],'DONE|'+transform(good),false));
 test(`scoped NOT_DONE C${i+1}`,()=>verify(tasks[i],'NOT_DONE|'+good,false));
 test(`scoped cross-task C${i+1}`,()=>verify(tasks[(i+1)%10],'DONE|'+good,false));
}
for(const text of ['写了行笔记:', '写了行笔记:待补内容','写了行笔记:123456','写了行笔记:标题占位','写了行笔记:只有标题','写了行笔记:没有保存','写了行笔记:没记下来','写了行笔记:以后再写','写了行笔记:其实未记录','写了行笔记:我还没完成','写了行笔记:随便写写','写了行笔记:哈哈哈哈','写了行笔记:研究设计:样本量','写了行笔记:研究设计，后来清空','写了行笔记:研究设计，今天洗了脸'])test(`note artifact fail closed ${text}`,()=>verify(tasks[0],'DONE|'+text,false));
for(const text of ['炎症、血栓','炎症、血栓、循环、损伤','标题一、标题二、标题三','占位符、损伤、修复','炎症、炎症、损伤','A、B、C','研究、TBD、循环','待补充、未想好、先凑数','没写、未定、没做','还在想、没定、待会写','炎症、损伤、未提交','111、222、333','哈哈、呵呵、嘿嘿','炎症、损伤、研究，后来撤销了'])test(`direct heading list fail closed ${text}`,()=>verify(tasks[7],'DONE|'+text,false));
// No known action can inherit these artifacts merely by attaching its ID.
test('artifact cannot override action identity',()=>verify(tasks[7],'DONE|研究背景、实验设计、统计分析',false,{actionId:'data-column-2',attempts:0}));
test('unknown task stays pending without HTTP',()=>verify('列出文献综述的四个小标题','DONE|研究背景、实验设计、统计分析',false,{attempts:0}));

// Second independent self-review: status disguised as artifact text. These
// were missed by the first green run and are retained as named regressions.
for(const text of ['写了行开题笔记:没动笔呢','写了行开题笔记:实际未落笔','写了行开题笔记:只是草稿标题','写了行开题笔记:打算稍后再补','写了行开题笔记:另起空文档','写了行开题笔记:完全没开始','写了行开题笔记:只打了标题','行开题笔记写好了'])test(`self-review note artifact ${text}`,()=>verify(tasks[0],'DONE|'+text,false));
for(const text of ['未开始、没动笔、没弄完','炎症、循环、尚待确定','炎症、血栓、之后再补','炎症、血栓、暂时空着','炎症、循环、还需补充'])test(`self-review heading artifact ${text}`,()=>verify(tasks[7],'DONE|'+text,false));
// Not all planning content is execution status, and medical vocabulary can
// contain the character 未. Keep actual task artifacts working.
test('self-review note planning content',()=>verify(tasks[0],'DONE|我写了行开题笔记:需要确定样本量',true));
test('self-review heading medical vocabulary',()=>verify(tasks[7],'DONE|未分化细胞、免疫机制、组织损伤',true));

// Fresh 2026-11-25 scoped outputs that were still rejected by the previous
// candidate. Each remains task-bound and keeps the existing status guards.
const fresh=[
 [0,'DONE|开题笔记写了第一行：方向初步定在心电相关'],
 [8,'DONE|开头两分钟练了两遍，还不太顺但过完了'],
 [6,'DONE|把简历投给了一家医院实习岗，已收到确认'],
 [0,'DONE|在图谱扉页写了一行开题笔记'],
 [3,'DONE|给室友发了条今晚带饭的消息'],
 [0,'DONE|在笔记本上写了一行开题思路'],
 [3,'DONE|已给室友发了消息'],
 [0,'DONE|开题笔记写了一行，先记着选题方向'],
 [8,'DONE|开头两分钟练完，还算顺'],
 [0,'DONE|在图谱页边写了一行炎症介质笔记'],
 [7,'DONE|三个小标题列好了，暂存备忘录里'],
 [3,'DONE|给室友发了条消息让他帮忙带饭'],
 [4,'DONE|分工清单已列好，四人任务各一项'],
 [0,'DONE|在笔记本上写了一行开题思路，就一句'],
 [0,'DONE|开题笔记写了一行，选题方向先记下'],
 [0,'DONE|开题笔记写了一行，先记下选题方向'],
 [7,'DONE|拟好：概念界定、研究现状、争议与缺口'],
];
for(const [i,raw] of fresh)test(`fresh scoped positive C${i+1}: ${raw}`,()=>verify(tasks[i],raw,true));
test('fresh practice incomplete tail remains rejected',()=>verify(tasks[8],'DONE|开头两分钟练了两遍，但没练完',false));
test('fresh apply premature tail remains rejected',()=>verify(tasks[6],'DONE|把简历投给了一家医院实习岗，但没提交',false));
test('fresh note context without note object remains rejected',()=>verify(tasks[0],'DONE|在图谱扉页写了一行文字',false));
test('fresh room message without send completion remains rejected',()=>verify(tasks[3],'DONE|给室友发了消息，还没发出去',false));
