/** 2026-11-18：区分“聊自己的感情/同学关系”和“向 AI 要联系方式/约 AI 见面”。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

Module._extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  mod._compile(result.outputText, filename);
};
const load = (name) => require(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`));
const { boundaryRequest } = load('dialogue');
const { auditSocial } = load('baseline');

test('聊自己的追求/同学关系，不算向 AI 要联系方式或约见面', () => {
  for (const text of [
    '对体育课上一个女生有好感，但是直接去要微信总觉得不礼貌',
    '我想加她微信但不知道怎么开口',
    '我想约她周末出来吃饭',
    '怎么和刚刚加上的女生聊天',
    '同学说要加我微信，我该怎么办',
  ]) assert.equal(boundaryRequest(text), null, text);
});

test('明确向 AI 要联系方式、约 AI 见面仍然拦', () => {
  assert.equal(boundaryRequest('能不能加个微信'), 'contact');
  assert.equal(boundaryRequest('她让我加你微信'), 'contact');
  assert.equal(boundaryRequest('你的微信是多少'), 'contact');
  assert.equal(boundaryRequest('把微信给我'), 'contact');
  assert.equal(boundaryRequest('她的微信加不到，加个vx吧'), 'contact');
  assert.equal(boundaryRequest('你出来吃饭吗'), 'offline');
});

test('AI 给用户的第三方社交建议不被当作索取联系方式', () => {
  for (const text of [
    '加她微信之前，先把上次聊到的课接一句。',
    '你可以先问她有没有兴趣一起做小组作业，别一上来就要微信。',
    '你们可以先从课程聊起，等熟一点再要联系方式。',
  ]) assert.equal(auditSocial(text), null, text);
});

test('AI 对用户索取或泄露联系方式仍拦', () => {
  assert.ok(auditSocial('把微信给我。'));
  assert.ok(auditSocial('加我微信：abc12345'));
  assert.ok(auditSocial('我的手机号是 13800138000'));
});
