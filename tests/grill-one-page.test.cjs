const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','src','components','DecomposeSheet.tsx'),'utf8');
test('grill-me shows all prompts on one page with bulk actions',()=>{
  assert.match(src,/grillPrompts\.map/);
  assert.match(src,/一次填完/);
  assert.match(src,/用这些答案拆解/);
  assert.match(src,/跳过，直接拆解/);
  assert.doesNotMatch(src,/mode==='grill'\?5:3/);
});
