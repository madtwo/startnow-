'use strict';const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {install}=require('./tech-loader.cjs');install();
const prompts=require('../src/lib/prompts.ts');
const src=fs.readFileSync(path.join(__dirname,'../src/lib/prompts.ts'),'utf8');
test('forum comment instruction no longer uses the failed general-advice constraint',()=>{
 assert.ok(!src.includes('不要变成对谁都适用的热心建议'));
 assert.ok(!src.includes('先接住具体细节，再决定要不要给办法'));
 assert.match(prompts.COMMENT_RULES,/先接住对方具体的一句/);
});
test('each of four established forum personas has two separate non-empty cross-topic reply examples',()=>{
 const ids=['shenmo','weini','miaoze','yanggao'];const texts=[];
 for(const id of ids){
  const examples=prompts.CROSS_TOPIC_REPLY_EXAMPLES[id];assert.equal(examples.length,2,id);
  for(const ex of examples){assert.match(ex,/对方：/);assert.match(ex,/回复：/);assert.ok(ex.length<180);texts.push(ex)}
 }
 assert.equal(new Set(texts).size,8);
});
test('only forum comments receive examples, other types (card, brag, goal) do not',()=>{
 const persona={id:'shenmo',name:'沈默',handle:'shenmo',tagline:'学习',gender:'male',age:21,
   school:'定京医科大学',major:'临床医学',cohort:'大三',background:'念病理',personality:'细心',speech:'克制',
   approach:'帮别人更清醒',weights:{study:26,people:7,love:52,family:3,self:0,future:12},
   memory:[],weekLog:[],intimacy:16};
 const comment=prompts.systemFor(persona,'',prompts.COMMENT_RULES);
 assert.match(comment,/跨主题回帖样例/);
 assert.match(comment,/小组|实验报告/);
 const card=prompts.systemFor(persona,'',prompts.CARD_RULES);
 assert.doesNotMatch(card,/跨主题回帖样例/);
});
