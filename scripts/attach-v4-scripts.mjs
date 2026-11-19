#!/usr/bin/env node
/** Optional, conflict-safe package.json wiring: --check only by default.
 * Do not call --apply until the existing package scripts have been reviewed. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'package.json');
const apply=process.argv.includes('--apply');
if(!fs.existsSync(file)){console.error('当前目录没有 package.json；需到完整仓库运行');process.exit(2);}
let pkg;
try{pkg=JSON.parse(fs.readFileSync(file,'utf8'));}catch{console.error('package.json 无效');process.exit(2);}
const scripts=pkg.scripts||{};
const runner='node scripts/run-v4-tests.mjs';
const composite='npm run test:baseline && npm run test:v4';
if(!scripts['test:all']){console.error('没有旧 test:all，不能推断基线命令');process.exit(2);}
if(scripts['test:v4']&&scripts['test:v4']!==runner){console.error('已有不一致的 test:v4，拒绝覆盖');process.exit(2);}
if(scripts['test:baseline']&&scripts['test:all']!==composite){console.error('已有 test:baseline，无法安全判断来源；拒绝覆盖');process.exit(2);}
if(scripts['test:all']===composite){
 if(scripts['test:v4']!==runner){console.error('组合脚本已存在但 v4 runner 不一致');process.exit(2);}
 console.log('v4 已接入 test:all，未改动');process.exit(0);
}
if(/(?:test:v4|test:baseline)/.test(scripts['test:all'])){console.error('原 test:all 可能已包含 v4，需人工审查');process.exit(2);}
const next={...pkg,scripts:{...scripts,'test:baseline':scripts['test:all'],'test:v4':runner,'test:all':composite}};
console.log(`当前 test:all: ${scripts['test:all']}`);
console.log(`拟改为: ${composite}`);
if(!apply){console.log('仅预检：未修改 package.json。确认后使用 --apply');process.exit(0);}
const original=fs.readFileSync(file);
const backup=path.join(root,'package.json.before-v4-scripts.bak');
if(fs.existsSync(backup)){console.error('备份已存在，拒绝再次覆盖');process.exit(2);}
fs.writeFileSync(backup,original,{flag:'wx'});
fs.writeFileSync(file,JSON.stringify(next,null,2)+'\n');
console.log('已接入；原始 package.json 已备份。');
