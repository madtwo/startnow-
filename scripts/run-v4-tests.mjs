#!/usr/bin/env node
// Cross-platform Node test runner: no shell globs, paths normalized on Windows.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'tests');
const files=fs.readdirSync(dir).filter(n=>(n==='copy-v4.test.cjs'||n==='persona-migration.test.cjs'||
  /^tech-.*\.test\.(?:cjs|mjs)$/.test(n)||/^followup-.*\.test\.(?:cjs|mjs)$/.test(n)));
if(files.length<4){console.error('未发现足够 v4 测试文件，未运行');process.exit(2);}
// Some existing .mjs tests import .ts sources directly. Node 22+ requires
// explicit strip-types; CommonJS tests keep using their original tech-loader.
const [major,minor]=process.versions.node.split('.').map(Number);
const canStrip=major>22 || (major===22 && minor>=6);
const args=[...(canStrip?['--experimental-strip-types']:[]),'--test',
  ...files.map(n=>path.join('tests',n).replace(/\\/g,'/'))];
const out=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env});
if(out.error){console.error(out.error.message);process.exit(2);}
process.exit(out.status??1);
