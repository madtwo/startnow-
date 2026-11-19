const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','src','components','DecomposeSheet.tsx'),'utf8');
test('image upload and vision review are available in all three decomposition modes',()=>{
  assert.match(src,/三种拆解方式都可上传/);
  assert.doesNotMatch(src,/mode==='ai' && <label className="field"><span className="field-label">老师通知/);
  assert.doesNotMatch(src,/mode==='ai' && visionResult/);
  assert.match(src,/\{visionResult && <section/);
  assert.match(src,/type="file"/);
});
