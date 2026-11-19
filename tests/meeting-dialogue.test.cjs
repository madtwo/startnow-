const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
Module._extensions['.ts']=(mod,name)=>mod._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,name);
const {clarificationFor}=require('../src/lib/clarify.ts');
const {boundaryRequest}=require('../src/lib/dialogue.ts');
const {wantsDirectAdvice}=require('../src/lib/directAdvice.ts');
test('R10: 模糊求助先问一个关键问题，不直接推荐不相关动作',()=>{
 const vague=['学习搞不下去，怎么办','最近不知道该干什么好','课程太多，我卡住了','作业好难，不知道怎么开始',
 '考试我没思路','论文我不会写了','报告完全没头绪','简历怎么弄我不会','找实习不知道从哪开始',
 '我和室友的问题不知道怎么办','父母跟我关系有点乱，我不知道怎么办','暗恋让我好迷茫',
 '最近事情好多，理不清','我真的很迷茫','没头绪，能帮我吗','我想开始可是不知道先弄什么',
 '我和同学之间的事我做不来','求职完全没头绪','我实在不知道怎么办','家里太复杂，不知道怎么办'];
 assert.ok(vague.filter((x)=>clarificationFor(x)).length>=16);
 for(const x of vague) {const q=clarificationFor(x);if(q) assert.equal((q.match(/[?？]/g)||[]).length,1);}
});
test('R10: 明确直接要建议不会被澄清分支误拦',()=>{
 const direct=['给我一个下一步','现在直接给我一个具体建议','帮我想一个行动下一步','别问了，直接给我一个下一步', '告诉我下一步做什么'];
 direct.forEach((line)=>assert.equal(clarificationFor(line),null,line));
 assert.equal(wantsDirectAdvice('给我一个下一步'),true);
});
test('R11: 第三方感情问题与向 AI 要私下联系分开',()=>{
 const thirdParty=['我想加一个女生微信，怎么自然点','我跟我喜欢的人吵架了，怎么开口','她昨天没回复我，我是不是说错话了'];
 thirdParty.forEach((line)=>assert.equal(boundaryRequest(line),null,line));
 assert.equal(boundaryRequest('请把你的微信号给我'),'contact');
});
