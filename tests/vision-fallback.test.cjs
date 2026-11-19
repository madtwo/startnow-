const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, filename) => {
  const res = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  mod._compile(res.outputText, filename);
};
const root = path.resolve(__dirname, '../src');
const { recognizeNotice, testVisionConnection } = require(path.join(root,'lib/decompose.ts'));
const { parseNoticeFields, hasUsableNoticeFields, buildNoticeAppend } = require(path.join(root,'lib/noticeFields.ts'));
const IMAGE='data:image/png;base64,AA==';
const config={providerId:'compatible',model:'general-model',visionModel:'image-model',baseUrl:'https://example.com/v1',apiKey:'not-a-real-key'};
const good='事项：提交实验报告；日期或DDL：周五；地点：材料楼302；提交方式：PDF；原文摘录：请周五交报告';
const prose='老师说周五前交实验报告，直接发到课程网站。';
const response=(status,content)=>new Response(status===200 ? JSON.stringify({choices:[{message:{content}}]}) :
    JSON.stringify(typeof content==='string' ? {error:{message:content}} : content),
  {status,headers:{'content-type':'application/json'}});
const mockFetch = async (handler, testBody) => {
  const before = global.fetch;
  const count=[];
  global.fetch=async(_url,opts)=>{ count.push(opts); return handler(count.length,opts); };
  try { await testBody(count); } finally { global.fetch=before; }
};

test('fields successful, editable excerpt preserved, model and session header unchanged', async()=>{
  await mockFetch(async()=>response(200,good), async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
    assert.equal(result.ok,true);assert.equal(result.format,'fields');assert.equal(result.fields.item,'提交实验报告');
    assert.match(result.fields.excerpt,/周五交报告/);assert.equal(result.retried,false);
    assert.equal(calls.length,1);
    assert.equal(calls[0].headers['x-opencode-session'].startsWith('ses_'),true);
    assert.equal(JSON.parse(calls[0].body).model,'image-model');
    assert.equal(JSON.parse(calls[0].body).max_tokens,1800);
  });
});
test('unstructured prose is retried once, then returned as editable raw',async()=>{
  const retries=[]; let attempts=0;
  await mockFetch(async()=>response(200,prose),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>attempts++,onRetry:code=>retries.push(code)});
    assert.deepEqual([result.ok,result.format,result.reason,result.retried],[true,'raw','format_invalid',true]);
    assert.equal(result.raw,prose); assert.equal(calls.length,2);assert.equal(attempts,2);
    assert.deepEqual(retries,['format_invalid']);
    assert.match(JSON.parse(calls[1].body).messages[0].content[0].text,/五行/);
  });
});
test('malformed first response can be repaired to fields (one extra paid attempt)',async()=>{
  let attemptCount=0;
  await mockFetch(async n=>response(200,n===1?prose:good),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>attemptCount++});
    assert.equal(result.format,'fields');assert.equal(result.retried,true);
    assert.equal(attemptCount,2);assert.equal(calls.length,2);
  });
});
test('raw fallback preserved if formatting retry is denied by quota',async()=>{
  let attempts=0;
  await mockFetch(async()=>response(200,prose),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{if(++attempts>1) throw Error('no quota')}});
    assert.equal(result.ok,true);assert.equal(result.format,'raw');assert.equal(result.retried,false);
    assert.equal(calls.length,1);
  });
});
test('raw fallback preserved when second call receives 429',async()=>{
  await mockFetch(async n=>n===1?response(200,prose):response(429,'429'),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
    assert.equal(result.ok,true);assert.equal(result.format,'raw');assert.equal(result.retried,true);
    assert.equal(calls.length,2);
  });
});
test('MissingSessionID 400 classified separately, never tries to switch model',async()=>{
  await mockFetch(async()=>response(400,{type:'error',error:{type:'MissingSessionID'}}),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
    assert.equal(result.ok,false);assert.equal(result.code,'session_missing');assert.equal(calls.length,1);
    assert.doesNotMatch(result.message,/换模型|不支持图片/);
  });
});
test('400 image unsupported, 401 auth, 403 auth, 429 limit are distinct and never immediately retried',async()=>{
  for (const [status,body,code] of [[400,'unsupported image_url','vision_unsupported'],[401,'bad key','auth'],[403,'permission','auth'],[429,'too many','rate_limit']]) {
    await mockFetch(async()=>response(status,body),async calls=>{
      const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
      assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(calls.length,1);
    });
  }
});
test('503 and network errors retry once but no third request',async()=>{
  await mockFetch(async n=>n===1?response(503,'down'):response(200,good),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
    assert.equal(result.ok,true);assert.equal(result.format,'fields');assert.equal(result.retried,true);assert.equal(calls.length,2);
  });
  await mockFetch(async n=>{if(n===1) throw new Error('network');return response(503,'again');},async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
    assert.equal(result.ok,false);assert.equal(result.code,'server');assert.equal(result.retried,true);assert.equal(calls.length,2);
  });
});
test('per-attempt timeout retries once under the total cap',async()=>{
  await mockFetch(async n=>{if(n===1) throw new DOMException('mock timeout','TimeoutError');return response(200,good);},async calls=>{
    const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
    assert.equal(result.ok,true);assert.equal(result.retried,true);assert.equal(calls.length,2);
  });
});
test('empty, too long and crisis content are hard failures, never editable raw',async()=>{
  for (const [content,code] of [['','invalid_output'],['啊'.repeat(2801),'invalid_output'],['事项：我想自杀；日期或DDL：今晚','unsafe_output']]) {
    await mockFetch(async()=>response(200,content),async calls=>{
      const result=await recognizeNotice(config,IMAGE,{onModelAttempt:()=>{}});
      assert.equal(result.ok,false,content.slice(0,20));assert.equal(result.code,code);assert.equal(calls.length,1);
    });
  }
});
test('bad image and missing configured model never send data',async()=>{
  await mockFetch(async()=>{throw new Error('should not call fetch')},async calls=>{
    assert.equal((await recognizeNotice(config,'data:text/plain;base64,AA==')).code,'invalid_image');
    assert.equal((await recognizeNotice({...config,visionModel:''},IMAGE)).code,'vision_unsupported');
    assert.equal(calls.length,0);
  });
});
test('cancel before request, and cancel during pending request, never return usable result',async()=>{
  const already=new AbortController();already.abort();
  await mockFetch(async()=>{throw Error('never send')},async calls=>{
    assert.equal((await recognizeNotice(config,IMAGE,{signal:already.signal})).code,'cancelled');assert.equal(calls.length,0);
  });
  const controller=new AbortController();
  await mockFetch(async(_n,opts)=>new Promise((_resolve,reject)=>{
    opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    controller.abort();
  }),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{signal:controller.signal,onModelAttempt:()=>{}});
    assert.equal(result.ok,false);assert.equal(result.code,'cancelled');assert.equal(calls.length,1);
  });
});
test('field recognition requires item and one other explicitly labelled useful value',()=>{
  const one=parseNoticeFields('事项：考试安排');
  assert.equal(hasUsableNoticeFields(one),false);
  const none=parseNoticeFields(prose);
  assert.equal(hasUsableNoticeFields(none),false);
  const yes=parseNoticeFields('事项：实验报告；地点：材料楼');
  assert.equal(hasUsableNoticeFields(yes),true);
});
test('appending requires explicit user action, keeps existing text and never invents confirmed DDL',()=>{
  const fields=parseNoticeFields(good);
  const out=buildNoticeAppend('之前写下的目标',{format:'fields',fields});
  assert.equal(out.ok,true);assert.match(out.text,/^之前写下的目标/);assert.match(out.text,/不是已确认的真实 DDL/);
  const raw=buildNoticeAppend('旧目标',{format:'raw',raw:prose});
  assert.equal(raw.ok,true);assert.match(raw.text,/旧目标\n【识别原文/);
  assert.equal(buildNoticeAppend('旧目标',{format:'raw',raw:prose},3).ok,false);
  assert.equal(buildNoticeAppend('旧目标',{format:'raw',raw:'我想自杀'}).ok,false);
});
test('1x1 health check sends an image and classifies 200 as CONNECTIVITY ONLY',async()=>{
  await mockFetch(async()=>response(200,'纯色，无可见文字'),async calls=>{
    const result=await testVisionConnection(config,{onModelAttempt:()=>{}});
    assert.equal(result.ok,true);assert.match(result.message,/不代表通知字段识别准确/);
    assert.equal(calls.length,1);
    assert.match(JSON.stringify(JSON.parse(calls[0].body)),/image_url/);
    assert.ok(calls[0].headers['x-opencode-session']);
  });
});
test('health check returns session_missing on proxy 400 without saving error body',async()=>{
  await mockFetch(async()=>response(400,{error:{type:'MissingSessionID'}}),async calls=>{
    const result=await testVisionConnection(config,{onModelAttempt:()=>{}});
    assert.equal(result.ok,false);assert.equal(result.code,'session_missing');assert.equal(calls.length,1);
  });
});
test('UI contains editable review but no automatic goal write from model output',()=>{
  const ui=fs.readFileSync(path.join(root,'components/DecomposeSheet.tsx'),'utf8');
  assert.match(ui,/setVisionResult\(result\)/);
  assert.match(ui,/aria-label="识别原文（可编辑）"/);
  assert.match(ui,/onClick=\{appendVision\}/);
  assert.match(ui,/取消识图/);
  assert.doesNotMatch(ui,/setGoal\(\(prev\)=>\[prev\.trim\(\), extracted\]/);
});
test('harness explicitly counts fields/raw/error and contains injected vision cases',()=>{
  const harness=fs.readFileSync(path.join(root,'soak/harness.ts'),'utf8');
  for(const item of ['vision_raw','vision_empty','vision_session','vision_429','vision_timeout','visionFields','visionRawFallback','visionErrors','visionRetried','syntheticFixture']) assert.ok(harness.includes(item),item);
});
test('cancel after first raw response must never surface stale raw fallback',async()=>{
  const abort=new AbortController();
  await mockFetch(async()=>response(200,prose),async calls=>{
    const result=await recognizeNotice(config,IMAGE,{signal:abort.signal,onModelAttempt:()=>{},onRetry:()=>abort.abort()});
    assert.equal(result.ok,false);assert.equal(result.code,'cancelled');assert.equal(calls.length,1);
  });
});
test('source UI defers model usage reservation until the concrete HTTP attempt',()=>{
  const ui=fs.readFileSync(path.join(root,'components/DecomposeSheet.tsx'),'utf8');
  assert.match(ui,/onModelAttempt: \(\) => onModelAttempt\('vision'\)/);
  assert.doesNotMatch(ui,/onModelAttempt\('vision'\);\s*const extracted/);
});
