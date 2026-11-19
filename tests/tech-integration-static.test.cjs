'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
test('photo posts invoke vision only on user action, never in persona tick',()=>{
  const app=read('src/App.tsx'),goals=read('src/lib/personaGoals.ts');
  assert.match(app,/if \(card\.image\) void scanMaterial\(card\.id,card\.image\)/);
  assert.match(app,/onReidentify=\{detailCard\.image/);
  assert.doesNotMatch(goals,/(?:extractMaterial|materialVision|scanMaterial)/);
});
test('competition keeps room visible in both top navigation and settings',()=>{
  const app=read('src/App.tsx');
  assert.match(app, /has\('room'\) \? 'room' : 'home'/);
  assert.doesNotMatch(app,/!COMPETITION_MODE\s*&&\s*<button[\s\S]{0,220}setView\('room'\)/);
  assert.equal((app.match(/setView\('room'\)/g)||[]).length,2);
  assert.match(app, /if \(COMPETITION_MODE\) \{setToast\(competitionSummary\(\)\);return;\}/);
});
test('material attribution and confirmed due date are explicit, no unsolicited goal creation',()=>{
  const app=read('src/App.tsx'),cards=read('src/lib/cards.ts');
  assert.match(cards,/origin:'material'/);
  assert.match(cards,/materialAnchorId:material\.anchorId/);
  assert.match(app,/confirmedDeadline\(localDateTime,now\)/);
  assert.match(app,/onConfirmDeadline=\{\(local\)=>confirmCardDeadline/);
});
test('academic copy extension preserves legacy action chains and seed wiring',()=>{
  const app=read('src/App.tsx');
  // The uploaded technical snapshot omits unchanged actions.ts; the integrated
  // copy v3 snapshot contains it. Check it when present, without inventing it.
  if (fs.existsSync(path.join(__dirname,'../src/lib/actions.ts'))) {
    const actions=read('src/lib/actions.ts');
    assert.match(actions,/chain\('run'/);
    assert.match(actions,/chain\('book'/);
    assert.match(actions,/\.\.\.EXPANDED_ACTIONS/);
    assert.match(actions,/actionMap/);
  }
  assert.match(app,/buildGuideCard, buildSeedCards, seedMemories/);
  assert.match(app,/openingReady/);
  assert.match(app,/openingStage/);
});

test('vision model can be selected when image exists and stored in configured endpoint',()=>{
  const app=read('src/App.tsx'),form=read('src/components/PostForm.tsx');
  assert.match(form,/image && \([\s\S]*?value=\{visionModel\}/);
  assert.match(form,/onVisionModelChange\(e\.target\.value\)/);
  assert.match(app,/visionModel=\{config\.visionModel \?\? ''\}/);
  assert.match(app,/saveConfig\(next\)/);
});
