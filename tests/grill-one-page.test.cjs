const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','src','components','DecomposeSheet.tsx'),'utf8');
test('个性化定制：模型主路径、分轮继续、随时立即拆解、一行输入和快捷回答',()=>{
  assert.match(src,/requestPersonalizedQuestions/);
  assert.match(src,/q\.chips\.map/);
  assert.match(src,/setGrillRounds\(\(prev\)=>\[\.\.\.prev,added\]\)/);
  assert.match(src,/>继续<\/button>/);
  assert.match(src,/>立刻拆解<\/button>/);
  assert.match(src,/type="text" maxLength=\{180\}/);
  assert.doesNotMatch(src,/grillPrompts\.map|一次填完|用这些答案拆解|再问一轮|\/grill-me · 问清楚/);
});

test('导入或重置必须中止旧账户拆解，普通关闭不卸载；群聊仍可打开',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','src','App.tsx'),'utf8');
  assert.match(app,/key=\{decomposeEpoch\}/);
  assert.match(app,/decomposeEpochRef\.current \+= 1/);
  assert.match(app,/setDecomposeEpoch\(decomposeEpochRef\.current\)/);
  assert.match(app,/localStorage\.removeItem\(DECOMPOSE_DRAFT_KEY\)/);
  assert.match(app,/view === 'room'/);
  assert.match(app,/RoomView identity=\{identity\}/);
  assert.match(src,/closeSheet = \(\) => \{ openRef\.current = false; onClose\(\); \}/);
});
