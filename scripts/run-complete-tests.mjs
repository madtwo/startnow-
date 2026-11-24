#!/usr/bin/env node
// Discover each test file exactly once. Include human-review gates; never skip failures.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=fs.readdirSync(path.join(root,'tests')).filter(n=>/\.test\.(cjs|mjs)$/.test(n)).sort();
if(!files.length){console.error('No test files found.');process.exit(2);}
const [major,minor]=process.versions.node.split('.').map(Number);
const canStrip=major>22||(major===22&&minor>=6);
const args=[...(canStrip?['--experimental-strip-types']:[]),'--test','--test-concurrency=4',...files.map(n=>'tests/'+n)];
console.log(`Complete test discovery: ${files.length} files`);
const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env});
if(result.error){console.error(result.error.message);process.exit(2);}
process.exit(result.status??1);
