import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const body=fs.readFileSync(path.join(root,'scripts/attach-v4-scripts.mjs'),'utf8');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v4-scripts-'));fs.mkdirSync(path.join(dir,'scripts'));
fs.writeFileSync(path.join(dir,'scripts/attach-v4-scripts.mjs'),body);
const file=path.join(dir,'package.json');
const run=(arg)=>spawnSync(process.execPath,[path.join(dir,'scripts/attach-v4-scripts.mjs'),...(arg?[arg]:[])],{encoding:'utf8'});
test('safe precheck does not modify existing package.json',()=>{
 const original={name:'app',scripts:{'test:all':'node --test tests/core.test.cjs',build:'vite build'}};
 fs.writeFileSync(file,JSON.stringify(original));
 assert.equal(run().status,0);assert.deepEqual(JSON.parse(fs.readFileSync(file)),original);
});
test('apply preserves prior baseline and unrelated scripts, is idempotent',()=>{
 assert.equal(run('--apply').status,0);const pkg=JSON.parse(fs.readFileSync(file));
 assert.equal(pkg.scripts['test:baseline'],'node --test tests/core.test.cjs');
 assert.equal(pkg.scripts['test:v4'],'node scripts/run-v4-tests.mjs');assert.equal(pkg.scripts.build,'vite build');
 assert.equal(run('--apply').status,0);assert.ok(fs.existsSync(path.join(dir,'package.json.before-v4-scripts.bak')));
});
test('mismatched existing test:v4 blocks apply',()=>{
 const pkg=JSON.parse(fs.readFileSync(file));pkg.scripts['test:v4']='node something-else';fs.writeFileSync(file,JSON.stringify(pkg));
 assert.equal(run('--apply').status,2);
});
