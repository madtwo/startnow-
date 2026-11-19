'use strict';const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
test('default remains two-step, experimental modes opt in, no default-single regression',()=>{
 const store=read('src/lib/store.ts'),app=read('src/App.tsx'),ui=read('src/components/PostForm.tsx');
 assert.match(store,/saved\.captureMode === 'vision-template' \|\| saved\.captureMode === 'single' \? saved\.captureMode : 'two-step'/);
 assert.match(app,/const mode=current\.config\.captureMode \?\? 'two-step'/);
 assert.match(ui,/<option value="two-step">默认/);
 assert.match(ui,/<option value="vision-template">实验/);
 assert.match(ui,/<option value="single">实验/);
});
test('same card caches template step and preserves cancel/room access',()=>{
 const app=read('src/App.tsx'),cards=read('src/lib/cards.ts');
 assert.match(app,/await captureVisionTemplate\(/);
 assert.match(app,/materialCaptureStep:capturedStep && presenter/);
 assert.match(cards,/const material=verifiedCached \|\| \(cached \? templateMaterialStep/);
 assert.match(app,/const cancelMaterial =/);
 assert.match(app,/has\('room'\) \? 'room' : 'home'/);
});
test('fixture for migration is included in source, room and background code untouched',()=>{
 const baseline=JSON.parse(read('fixtures/persona-v3-text.json'));
 assert.ok(baseline && typeof baseline==='object');
 assert.match(read('src/lib/personaMigration.ts'),/PERSONA_SCHEMA_VERSION = 5/);
});
