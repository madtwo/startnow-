const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.join(__dirname,'..','src','lib');
const oldTs=Module._extensions['.ts'];
Module._extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(
  fs.readFileSync(filename,'utf8'),{fileName:filename,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
if(!fs.existsSync(path.join(root,'baseline.ts'))){
  const original=Module._load;
  Module._load=function(name,parent,isMain){
    if(parent?.filename.endsWith('adviceLine.ts')){
      if(name==='./baseline')return {auditCriticalContent:()=>null,auditSocial:()=>null,auditTone:()=>null};
      if(name==='./safety')return {findCrisis:()=>false};
      if(name==='./curatedUsage')return {chooseCuratedActionLine:()=>null,curatedActionUsesAcrossCards:()=>0};
    }
    return original.apply(this,arguments);
  };
}
const {actionMap}=require('../src/lib/actions.ts');
const {validateAdviceLine}=require('../src/lib/adviceLine.ts');
const {emitSyntheticAnchorRejection,syntheticAnchorTextIsSafe}=require('../src/lib/adviceAnchorDiagnostics.ts');
const fixtures=fs.readFileSync(path.join(__dirname,'fixtures','advice-anchor-synthetic.jsonl'),'utf8')
  .trim().split('\n').map(JSON.parse);

const sampleEvent=(row)=>({cardId:row.case_id,contextText:row.card,
  action:{id:row.actionId,label:row.actionLabel},rejectedLine:row.rejectedLine,
  reason:'no_anchor',topic:row.topic,model:row.model});
const sampleProbe=(row,receiver)=>({enabled:true,caseId:row.case_id,
  syntheticContext:row.card,seed:row.seed,onSample:receiver});

test('all eight deliberately synthetic examples are actually rejected as no_anchor',()=>{
  for(const row of fixtures){
    assert.deepEqual(validateAdviceLine(row.rejectedLine,actionMap[row.actionId],row.card),
      {ok:false,reason:'no_anchor'},row.case_id);
  }
});
test('explicit synthetic probe yields one immutable, bounded metadata sample',()=>{
  const row=fixtures[0],samples=[];
  assert.equal(emitSyntheticAnchorRejection(sampleProbe(row,x=>samples.push(x)),sampleEvent(row)),true);
  assert.equal(samples.length,1);
  assert.deepEqual(samples[0],row);
  assert.ok(Object.isFrozen(samples[0]));
});
test('opt-in is mandatory; no sample on id/context mismatch or unsupported topic',()=>{
  const row=fixtures[0],out=[];
  assert.equal(emitSyntheticAnchorRejection(undefined,sampleEvent(row)),false);
  assert.equal(emitSyntheticAnchorRejection({...sampleProbe(row,x=>out.push(x)),enabled:false},sampleEvent(row)),false);
  assert.equal(emitSyntheticAnchorRejection({...sampleProbe(row,x=>out.push(x)),caseId:'real-uuid'},sampleEvent(row)),false);
  assert.equal(emitSyntheticAnchorRejection({...sampleProbe(row,x=>out.push(x)),syntheticContext:'different'},sampleEvent(row)),false);
  assert.equal(emitSyntheticAnchorRejection(sampleProbe(row,x=>out.push(x)),{...sampleEvent(row),cardId:'real-uuid'}),false);
  assert.deepEqual(out,[]);
});
test('sensitive-looking, large, multiline or dangerous input never reaches callback',()=>{
  const row=fixtures[0],calls=[];
  for(const text of ['test@example.com','13912345678','sk-'+'a'.repeat(32),'2026-11-20',
    '\u5317\u4eac\u5927\u5b66','hello\nworld','A'.repeat(400),
    'https://example.invalid','@username2026','\u5fae\u4fe1\u53f7']){
    assert.equal(syntheticAnchorTextIsSafe(text),false,text);
    assert.equal(emitSyntheticAnchorRejection(sampleProbe(row,x=>calls.push(x)),
      {...sampleEvent(row),rejectedLine:text}),false,text);
  }
  assert.deepEqual(calls,[]);
});
test('remote browser host is blocked even with an enabled callback',()=>{
  const row=fixtures[0],out=[];
  const previous=global.window;
  global.window={location:{hostname:'public.example.com'}};
  try{assert.equal(emitSyntheticAnchorRejection(sampleProbe(row,x=>out.push(x)),sampleEvent(row)),false);}
  finally{if(previous===undefined)delete global.window;else global.window=previous;}
  assert.deepEqual(out,[]);
});
test('a diagnostic callback failure cannot affect advice',()=>{
  const row=fixtures[0];
  const result=emitSyntheticAnchorRejection(sampleProbe(row,()=>{throw Error('local only')}),sampleEvent(row));
  assert.equal(result,false);
});
test('invalid seed is null, no fabricated seed value',()=>{
  const row=fixtures[0],out=[];
  emitSyntheticAnchorRejection({...sampleProbe(row,x=>out.push(x)),seed:2147483648},sampleEvent(row));
  assert.equal(out[0].seed,null);
});
test('valid advice or off-topic never automatically enters a model capture path',()=>{
  const row=fixtures[0];
  const accepted='\u5148\u6838\u5bf9\u5b9e\u9a8c\u6570\u636e\u8868\u91cc\u90a3\u4e00\u5217\u5355\u4f4d\uff0c\u5bf9\u5b8c\u5c31\u505c\u3002';
  assert.deepEqual(validateAdviceLine(accepted,actionMap[row.actionId],row.card),{ok:true});
  assert.ok(!row.card.includes('example.com'));
});

test('real askForAdvice branch emits only for rejected no_anchor, not for model or curated',async()=>{
  const filename=path.join(root,'cards.ts');
  const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),
    ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
  const decl=source.statements.find((node)=>ts.isFunctionDeclaration(node)&&node.name?.text==='askForAdvice');
  assert.ok(decl);
  const body=ts.transpileModule(decl.getText(source),{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let calls=0;
  const row=fixtures[0];
  const makeCard=()=>({id:row.case_id,authorKind:'player',text:row.card,
    comments:[],status:'open',noMemory:true});
  const action=actionMap[row.actionId];
  let mockLine=row.rejectedLine;
  const dependencies={
    hasPlayerCrisisInput:()=>false,isClosed:()=>false,canUseNextStep:require('../src/lib/cardPolicy.ts').canUseNextStep,
    advicePersonaFor:(card,people)=>people[0],needsHelpSeeking:()=>false,
    adviceContextText:(card)=>card.text,inferTrouble:()=> 'study',
    recentActionUses:()=>[],pickActions:()=>[action],
    isMock:()=>false,
    systemFor:()=>'',withUntrustedHistory:()=>'',SHORT_TASK_TOKEN_BUDGETS:{advice:900},
    scopedOpenCodeSessionId:()=> 'synthetic',shortTaskTelemetry:()=>()=>{},
    streamChat:async(opts)=>{opts.onRequestAttempt?.();calls++;return JSON.stringify({actionId:action.id,line:mockLine})},
    parseAdviceChoice:require('../src/lib/adviceLine.ts').parseAdviceChoice,
    validateAdviceLine,emitSyntheticAnchorRejection,
    validActionReference:require('../src/lib/cardPolicy.ts').validActionReference,
    LlmError:require('../src/lib/llm.ts').LlmError,
    chooseAdviceCopy:()=>({text:'curated placeholder',lineSource:'curated',useAlternate:false}),
    selectActionLine:()=>action.line,uid:()=> 'sample-comment',
    mindAfterReply:()=>({}),safeName:()=> 'synthetic',rememberOnCard:(p)=>p,
  };
  const fn=new Function('d',`const exports={}; const {${Object.keys(dependencies).join(',')}}=d; ${body}; return exports.askForAdvice`)(dependencies);
  const seen=[];
  const input=()=>({cards:[makeCard()],cardId:row.case_id,personas:[{id:'p1',name:'fixture'}],
    config:{model:'fixture-model'},settings:{dailyCalls:5,paused:false},now:1800000000000,
    localAnchorProbe:sampleProbe(row,x=>seen.push(x))});
  const rejected=await fn(input());
  assert.equal(calls,1);
  assert.equal(seen.length,1);
  assert.equal(rejected.cards[0].advice.lineSource,'curated');
  assert.ok(rejected.logs.includes('advice_line=fallback:no_anchor'));
  mockLine='\u5148\u6838\u5bf9\u5b9e\u9a8c\u6570\u636e\u8868\u91cc\u90a3\u4e00\u5217\u5355\u4f4d\uff0c\u5bf9\u5b8c\u5c31\u505c\u3002';
  await fn(input());
  assert.equal(calls,2);
  assert.equal(seen.length,1);
  mockLine=row.rejectedLine;
  const noProbe=input();delete noProbe.localAnchorProbe;
  const noSample=await fn(noProbe);
  assert.equal(calls,3);
  assert.equal(seen.length,1);
  assert.equal(noSample.cards[0].advice.lineSource,'curated');
});
test('rejects a forged topic or model identifier even on a synthetic case',()=>{
  const row=fixtures[0],seen=[];
  const probe=sampleProbe(row,(x)=>seen.push(x));
  assert.equal(emitSyntheticAnchorRejection(probe,{...sampleEvent(row),topic:'other'}),false);
  assert.equal(emitSyntheticAnchorRejection(probe,{...sampleEvent(row),model:'sk-'+'a'.repeat(25)}),false);
  assert.equal(emitSyntheticAnchorRejection(probe,{...sampleEvent(row),model:'bad model\nsecret'}),false);
  assert.deepEqual(seen,[]);
});
