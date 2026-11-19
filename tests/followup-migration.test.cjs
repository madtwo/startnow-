'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
require.extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(readFileSync(filename,'utf8'),{
 fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,filename);
const oldLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='./forumPersonaMind' && String(parent?.filename).replace(/\\/g,'/').includes('/src/lib/personas.ts'))
   return {forumPersonaMindPrompt:()=>''};
 return oldLoad.apply(this,arguments);
};
const baseline=JSON.parse(readFileSync(path.join(__dirname,'../fixtures/persona-v3-text.json'),'utf8'));
const {PERSONA_V2_TEXT,PERSONA_V3_TEXT,PERSONA_SCHEMA_VERSION,migratePersonaText}=require('../src/lib/personaMigration.ts');
const {defaultPersonas}=require('../src/lib/personas.ts');
const fields=['tagline','background','voice','personality','speech','approach','academicFocus'];
const ids=['shenmo','weini','miaoze','yanggao'];
const saved=()=>defaultPersonas().map(p=>({...p,...baseline[p.id],memory:[{id:'old',what:'保留旧记忆'}],intimacy:77,weekLog:[{at:1,text:'旧周记'}]}));
test('v3 frozen baseline matches the supplied fixture and schema is 4',()=>{
 assert.equal(PERSONA_SCHEMA_VERSION,4);assert.deepEqual(PERSONA_V3_TEXT,baseline);
 for(const id of ids)for(const field of fields)assert.equal(typeof baseline[id][field],'string',`${id}.${field}`);
});
test('supplied v3 fixture is already identical to CURRENT seven text fields; schema bump is still needed',()=>{
 const defaults=defaultPersonas();const original=saved();const out=migratePersonaText(original,defaults);
 assert.equal(out.changed,0);
 for(const row of out.rows){const target=defaults.find(p=>p.id===row.id);
   for(const field of fields)assert.equal(row[field],target[field],`${row.id}.${field}`);
   assert.equal(row.intimacy,77);assert.equal(row.memory[0].what,'保留旧记忆');assert.equal(row.weekLog[0].text,'旧周记');
 }
});
test('manual edits incl academicFocus remain untouched; v3 migration idempotent',()=>{
 const rows=saved();rows[0].tagline='独立修改的简介';rows[0].academicFocus='我自己的学术兴趣';
 rows[1].speech='自己写的语气';rows[2].approach='自己的处理方式';
 const out=migratePersonaText(rows,defaultPersonas());
 assert.equal(out.rows[0].tagline,'独立修改的简介');assert.equal(out.rows[0].academicFocus,'我自己的学术兴趣');
 assert.equal(out.rows[1].speech,'自己写的语气');assert.equal(out.rows[2].approach,'自己的处理方式');
 assert.equal(migratePersonaText(out.rows,defaultPersonas()).changed,0);
});
test('unknown ids and nonexistent fields are never manufactured',()=>{
 const rows=[{id:'unknown',tagline:'xxx'},{id:'weini',tagline:baseline.weini.tagline}];
 const out=migratePersonaText(rows,defaultPersonas());assert.equal(out.rows[0],rows[0]);
 assert.equal(out.rows[1].tagline,defaultPersonas().find(p=>p.id==='weini').tagline);
 assert.deepEqual(Object.keys(out.rows[1]),['id','tagline']);
});

test('older v2 text DOES upgrade to v4 while preserving unrelated runtime fields',()=>{
 const rows=defaultPersonas().map(p=>({...p,...PERSONA_V2_TEXT[p.id],intimacy:92}));
 const result=migratePersonaText(rows,defaultPersonas());
 assert.equal(result.changed,4);
 for(const p of result.rows) {
   const current=defaultPersonas().find(x=>x.id===p.id);
   for(const field of fields) if(typeof p[field]==='string' && typeof current[field]==='string')
     assert.equal(p[field],current[field],`${p.id}.${field}`);
   assert.equal(p.intimacy,92);
 }
});
