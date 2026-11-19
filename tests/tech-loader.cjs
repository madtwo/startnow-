'use strict';
// Isolated test harness: the uploaded source snapshot omits several unchanged modules.
// Only these absent modules are test doubled; delivered production patch never imports this helper.
const Module=require('node:module');
const ts=require('typescript');
let installed=false;
const state={isMock:true,streamReply:'',streamCalls:0};
function install(){
  if(installed)return state;
  installed=true;
  require.extensions['.ts']=(mod,filename)=>{
    const source=require('node:fs').readFileSync(filename,'utf8');
    const code=ts.transpileModule(source,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    mod._compile(code,filename);
  };
  const original=Module._load;
  Module._load=function(request,parent,isMain){
    const parentFile = String(parent?.filename || '').replace(/\\/g, '/');
    if(parentFile.includes('/src/lib/')){
      if(request==='../config/providers')return {isMock:()=>state.isMock,isReady:()=>true,PRESETS:[],defaultConfig:{providerId:'mock',baseUrl:'',model:'',apiKey:''}};
      if(request==='./llm')return {
        scopedOpenCodeSessionId:()=> 'tech-test-session',
        validateLlmEndpointBase:(u)=>{if(!/^https:\/\/[\w.-]+/i.test(u))throw Error('bad endpoint');},
        streamChat:async(opts)=>{state.streamCalls++;if(typeof state.streamReply==='function')return state.streamReply(opts);return state.streamReply;},
      };
      if(request==='./submissionGuard')return {
        containsCrisis:(rows)=>rows.some(t=>/(?:我要自杀|想自杀|结束生命|自残)/.test(String(t))),
        hasPlayerCrisis:()=>false,hasCrisisInArchive:()=>false,isSafeMemoryEntry:()=>true,
      };
      if(request==='./baseline')return {auditCriticalContent:(s)=>/(?:自杀|自残|治愈)/.test(s),auditSocial:(s)=>/(?:微信|QQ号|加好友|线下见面)/i.test(s),auditTone:(s)=>/(?:滚开|傻逼)/.test(s)};
      if(request==='./personas')return {defaultPersonas:()=>[],buildPersonaPrompt:()=> '角色原有设定'};
      if(request==='./personaMigration')return {migratePersonaText:rows=>({rows,changed:false}),PERSONA_SCHEMA_KEY:'test',PERSONA_SCHEMA_VERSION:1};
      if(request==='./seed')return {buildSeedCards:()=>[]};
      if(request==='./memory')return {sanitizeMemoryText:(s)=>String(s),renderMemory:()=>''};
      if(request==='./dialogue')return {isOfflineInvite:()=>false,relationshipLabel:()=>''};
      if(request==='./mind')return {mindPrompt:()=>''};
      if(request==='./safety')return {findCrisis:(s)=>/(?:我要自杀|自残)/.test(String(s))};
      if(request==='./brag')return {normalizePendingBrag:()=>undefined,unsafeBragContent:()=>false};
      if(request==='./goalStorage')return {parseGoals:(v)=>Array.isArray(v)?v:null,
        parseSchedule:(v)=>Array.isArray(v)?v:null,parseSummaries:(v)=>Array.isArray(v)?v:null};
      if(request==='./schedule')return {dateKeyLocal:(ms)=>{
        const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }};
      if(request==='./personaGoalTemplates')return {PERSONA_GOAL_TEMPLATES:Object.fromEntries(
        ['shenmo','weini','miaoze','yanggao'].map(id=>[id,[{title:'学习十分钟',steps:['写下第一行']}]]))};
      if(request==='./goals')return {
        makePersonaGoal:({persona,title,steps,now})=>({id:`goal-${persona.id}-${now}`,title,steps,
          source:'ai',ownerId:persona.id,createdAt:now,postPlan:{outcome:'missed',dueAt:now+3600_000}}),
        publishPersonaGoal:(goal,name,now)=>({goal,card:{id:`goal-card-${goal.id}`,goalId:goal.id,
          authorId:goal.ownerId,authorName:name,authorKind:'persona',kind:'goal',origin:'simulated',text:goal.title,
          createdAt:now,status:'talking',arrivals:[],plan:[],pending:[],comments:[]}}),
        resultCardForGoal:(goal,cards,name,now)=>{
          if(!goal.postPlan || goal.postPlan.dueAt>now || goal.postPlan.publishedAt)return null;
          const next={...goal,postPlan:{...goal.postPlan,publishedAt:now}};
          return {goal:next,card:{id:`result-${goal.id}`,goalId:goal.id,authorId:goal.ownerId,authorName:name,
            authorKind:'persona',kind:goal.postPlan.outcome==='done'?'brag':'worry',origin:'simulated',
            text:'【AI 虚构剧情·模拟结果】今天没做完原来的计划。还没做：第一行。',createdAt:now,
            status:'talking',arrivals:[],plan:[],pending:[],comments:[]}};
        },
      };
    }
    return original.apply(this,arguments);
  };
  return state;
}
module.exports={install,state};
