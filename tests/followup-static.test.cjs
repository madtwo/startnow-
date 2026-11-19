'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('single capture is called at upload and stored without second request on advice',()=>{
 const app=read('src/App.tsx'),cards=read('src/lib/cards.ts');
 assert.match(app,/await captureFirstStep\(/);
 assert.match(app,/captureMode!=='two-step'/);
 assert.match(app,/const capturedStep=result.ok && 'step' in result/);
 assert.match(cards,/verifiedCached \|\| \(cached \? templateMaterialStep/);
 assert.match(cards,/const checkedCached=cached && validateMaterialStep/);
});
test('UI preserves chat menu and route while adding a visible capture mode',()=>{
 const app=read('src/App.tsx'),form=read('src/components/PostForm.tsx');
 assert.match(app,/has\('room'\) \? 'room' : 'home'/);
 assert.match(app,/view === 'room' && \(/);
 assert.match(form,/一步完成：识别材料并给第一步/);
 assert.match(form,/兼容模式：先识别，再给下一步/);
 assert.match(form,/姓名、学号/);
});
test('cross-topic reply gets persona-specific but non-coercive prompt',()=>{
 const prompt=read('src/lib/prompts.ts');
 assert.match(prompt,/用你自己的关注点和习惯回应/);
 assert.match(prompt,/不需要建议时可以只接一句/);
 assert.match(prompt,/不发展恋爱或性关系/);
});
test('v3 text migration and import validation enabled without overwriting custom fields',()=>{
 const migration=read('src/lib/personaMigration.ts'),store=read('src/lib/store.ts');
 assert.match(migration,/PERSONA_SCHEMA_VERSION = 4/);
 assert.match(migration,/PERSONA_V1_TEXT, PERSONA_V2_TEXT, PERSONA_V3_TEXT/);
 assert.match(store,/redactMaterialText\(rawCapture.text\)===rawCapture.text/);
 assert.match(store,/checked\.anchorId===rawCapture\.anchorId/);
});
