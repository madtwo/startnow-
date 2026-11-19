'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  module._compile(code, filename);
};
const {ACTIONS,actionMap,smallerAction,matchActionIntent,pickActions,inferTrouble} = require('../src/lib/actions.ts');
const {PERSONA_GOAL_TEMPLATES} = require('../src/lib/personaGoalTemplates.ts');
const read = (rel) => readFileSync(path.join(__dirname,'..',rel),'utf8');
const requested = [
  'lit-abstract','lit-list','lit-question','proposal-heading','proposal-ref','resume-one',
  'data-column','data-outlier','data-unit','portfolio-pick','portfolio-page','draw-frame',
  'assign-q','calendar-deadline',
];

test('COPY-DECK contains 14 unique live actions, 14 real smaller children, safe alternate text',()=>{
  assert.equal(new Set(ACTIONS.map(a=>a.id)).size,ACTIONS.length,'duplicate action ID');
  for(const id of requested){
    const action=actionMap[`${id}-2`],child=smallerAction(`${id}-2`);
    assert.ok(action,id); assert.ok(child,id+' smaller');
    assert.equal(child.id,`${id}-1`);
    for(const field of ['label','line','alternateLine']){
      assert.ok(typeof action[field]==='string' && action[field].trim(),`${id} ${field}`);
    }
    assert.ok(action.minutes<=5,`${id} should stay micro`);
    assert.ok(child.minutes<=action.minutes,`${id} smaller should not expand work`);
    assert.equal(action.topics.length,1);
    assert.match(action.category,/^(study|future)$/);
    assert.doesNotMatch([action.label,action.line,action.alternateLine,child.label].join(' '),
      /只有你|你不回我|加我微信|见个面|治好|停药|别离开/);
  }
});

test('academic intent routing keeps tasks anchored to the real object',()=>{
  const cases=[
    ['材料科学的文献综述还没读','literature','lit-abstract-2'],
    ['开题报告的引用忘了补','proposal','proposal-ref-2'],
    ['开题报告第一节小标题没写','proposal','proposal-heading-2'],
    ['XRD实验数据的单位对不上','datasheet','data-unit-2'],
    ['Excel表格第一列一直没粘','datasheet','data-column-2'],
    ['数据表有一个异常值没标出来','datasheet','data-outlier-2'],
    ['作品集还没挑三张旧作业','portfolio','portfolio-pick-2'],
    ['作品集第一页的主图没有排版','portfolio','portfolio-page-2'],
    ['CAD制图连外框都没画','drawing','draw-frame-2'],
    ['作业要求写着第2题要回答两部分','assignment-second','assign-q-2'],
    ['课程作业周五截止还没记','assignment-deadline','calendar-deadline-2'],
    ['简历投了五家都没回音','internship-resume','resume-3'],
  ];
  for(const [message,id,first] of cases){
    const intent=matchActionIntent(message);
    assert.equal(intent?.id,id,message);
    assert.equal(pickActions(14,3,'study',message)[0]?.id,first,message);
  }
});

test('no invented question number, fabricated deadline, or irrelevant portfolio selection',()=>{
  assert.equal(matchActionIntent('作业要求看不懂')?.id,'assignment-unspecified');
  assert.deepEqual(pickActions(14,3,'study','作业要求看不懂'),[]);
  assert.deepEqual(pickActions(14,3,'study','CAD外框没画').map(a=>a.id),['draw-frame-2']);
  assert.ok(!pickActions(14,3,'study','课程作业周五截止').some(a=>a.id==='assign-q-2'));
  assert.ok(!pickActions(14,3,'study','刚上大学心里有点烦').some(a=>a.id.startsWith('portfolio-')));
});

test('existing high-priority scenes are not overridden',()=>{
  const cases=[['小组作业没人分工','group-work'],['室友半夜打游戏','roommate-sleep'],
    ['简历字号不对齐','resume-format'],['开题汇报上台特别紧张','presentation'],
    ['开题报告页码对不上','document-format']];
  for(const [input,id] of cases) assert.equal(matchActionIntent(input)?.id,id,input);
});

test('four forum roles have concrete academic focus, and exactly 16 study / 4 life demo posts',()=>{
  const text=read('src/lib/personas.ts');
  for(const word of ['病理期中','毕业论文开题','文献综述','制图课作业'])assert.ok(text.includes(word));
  assert.ok(text.includes('论坛里你更常发学业/科研'));
  const block=text.split('const mockCards:')[1].split('const generic')[0];
  assert.equal((block.match(/topic: 'study', text:/g)||[]).length,16);
  assert.equal((block.match(/topic: 'life', text:/g)||[]).length,4);
  for(const id of ['shenmo','weini','miaoze','yanggao']){
    const row=block.match(new RegExp(`  ${id}: \\[([\\s\\S]*?)\\n  \\],`));
    assert.ok(row,id);
    assert.equal((row[1].match(/topic: '(study|life)', text:/g)||[]).length,5,id);
    assert.equal((row[1].match(/topic: 'life', text:/g)||[]).length,1,id);
  }
});

test('28 learning goal templates, micro steps, and no romantic goals',()=>{
  const ids=['shenmo','weini','miaoze','yanggao'];
  assert.equal(ids.reduce((sum,id)=>sum+PERSONA_GOAL_TEMPLATES[id].length,0),28);
  for(const id of ids)for(const g of PERSONA_GOAL_TEMPLATES[id]){
    assert.ok(g.title.length>0 && g.title.length<=60);
    assert.ok(g.steps.length>=2 && g.steps.length<=3);
    for(const s of g.steps) assert.ok(s.length>0 && s.length<=80);
    assert.doesNotMatch([g.title,...g.steps].join('|'),/韩东|喜欢|约会|恋爱|表白|微信|恋人|治好/);
  }
});

test('persona disclosure gate respects public profile and private information',()=>{
  const text=read('src/lib/personas.ts');
  assert.match(text,/熟度只控制主动私下透露的深度/);
  assert.match(text,/已公开的身份信息可以如实回答/);
  assert.match(text,/60–100/);
  const prompts=read('src/lib/prompts.ts');
  assert.match(prompts,/以本次学习\/科研动作的结果为主/);
});


test('twenty forum demo texts are 30–80 characters, with no coercive phrases',()=>{
  const source=ts.createSourceFile('personas.ts',read('src/lib/personas.ts'),ts.ScriptTarget.Latest,true);
  const actual=[];
  const propValue=(obj,key)=>obj.properties.find(item=>ts.isPropertyAssignment(item)&&item.name.getText(source)===key)?.initializer;
  function visit(node){
    if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='mockCards'&&ts.isObjectLiteralExpression(node.initializer)){
      for(const person of node.initializer.properties){
        if(!ts.isPropertyAssignment(person)||!ts.isArrayLiteralExpression(person.initializer))continue;
        for(const item of person.initializer.elements){
          const text=propValue(item,'text')?.text;
          const topic=propValue(item,'topic')?.text;
          assert.ok(typeof text==='string'&&['study','life'].includes(topic));
          const length=Array.from(text.replace(/\s+/gu,'')).length;
          assert.ok(length>=30 && length<=80,`${person.name.getText(source)}: ${length} chars`);
          assert.doesNotMatch(text,/舔狗|备胎|只有你|别离开|你不回我|都怪你|我这么惨|没有你我不行|求求你留下来|停药|加微信/);
          actual.push({name:person.name.getText(source),topic});
        }
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  assert.equal(actual.length,20);
  assert.equal(actual.filter(item=>item.topic==='study').length,16);
});
