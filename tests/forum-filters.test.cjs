const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const Module=require('node:module');
const fs=require('node:fs');
const ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {matchesForumView,FORUM_VIEWS}=require(path.join(__dirname,'..','src','lib','forumFilters.ts'));
const now=new Date(2026,10,19,12,0,0).getTime();
const card=(over={})=>({id:'c',authorId:'me',authorName:'我',authorKind:'player',kind:'worry',text:'卡住了',createdAt:now-1000,...over});
test('view list covers today, goals, failure, success, venting',()=>{
  assert.deepEqual([...FORUM_VIEWS],['全部','今天','目标','失败','成功','诉苦','生活趣事']);
});
test('today only includes local-day cards',()=>{
  assert.equal(matchesForumView(card(), '今天', now), true);
  assert.equal(matchesForumView(card({createdAt:now-2*86400000}), '今天', now), false);
});
test('goal includes goal and progress, not worry',()=>{
  assert.equal(matchesForumView(card({kind:'goal'}), '目标', now), true);
  assert.equal(matchesForumView(card({kind:'progress'}), '目标', now), true);
  assert.equal(matchesForumView(card({kind:'worry'}), '目标', now), false);
});
test('failure includes missed vulnerability and legacy missed result text',()=>{
  assert.equal(matchesForumView(card({kind:'worry',vulnerability:{kind:'missed',personaId:'miaoze',at:now}}), '失败', now), true);
  assert.equal(matchesForumView(card({kind:'worry',origin:'simulated',title:'苗泽 · 今天没做到'}), '失败', now), true);
  assert.equal(matchesForumView(card({kind:'worry',origin:'simulated',title:'苗泽 · 今天没做完'}), '失败', now), true);
});
test('success only brag; venting is worry excluding failure',()=>{
  assert.equal(matchesForumView(card({kind:'brag'}), '成功', now), true);
  assert.equal(matchesForumView(card({kind:'worry'}), '诉苦', now), true);
  assert.equal(matchesForumView(card({kind:'worry',vulnerability:{kind:'missed',personaId:'miaoze',at:now}}), '诉苦', now), false);
  assert.equal(matchesForumView(card({kind:'brag'}), '诉苦', now), false);
});
test('life view only includes life posts',()=>{
  assert.equal(matchesForumView(card({kind:'life'}), '生活趣事', now), true);
  assert.equal(matchesForumView(card({kind:'worry'}), '生活趣事', now), false);
});
test('all view does not filter',()=>{
  for(const kind of ['worry','goal','progress','brag']) assert.equal(matchesForumView(card({kind}), '全部', now), true);
});
