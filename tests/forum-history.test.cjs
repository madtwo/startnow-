const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib, root } = require('./_ts-loader.cjs');
const { isHistoryCard, splitForumCards } = lib('forumHistory');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const make=(id,kind,authorId,createdAt)=>({id,kind,authorId,
  authorKind:authorId==='me'?'player':'persona',text:id,createdAt,
  status:'talking',arrivals:[],plan:[],pending:[],comments:[]});

test('goal and progress are exclusively history; results and intros remain main',()=>{
 const all=[make('ai-goal','goal','shenmo',2),make('player-goal','goal','me',3),
  make('progress','progress','me',5),make('brag','brag','shenmo',6),
  make('missed','worry','weini',7),make('intro','worry','shenmo',1),make('guide','guide','helper',8)];
 const before=JSON.stringify(all);
 const {main,history}=splitForumCards(all);
 assert.deepEqual(history.map(c=>c.id),['progress','player-goal','ai-goal']);
 assert.deepEqual(main.map(c=>c.id),['missed','brag','intro']);
 assert.equal(main.some(isHistoryCard),false);
 assert.equal(history.every(isHistoryCard),true);
 assert.equal(JSON.stringify(all),before,'splitting must not alter stored cards');
 assert.equal(main.length+history.length,all.length-1);
});

test('history empty state and old goal references remain available',()=>{
 const old=make('old-goal','goal','shenmo',1);
 const {history}=splitForumCards([old]);
 assert.equal(history[0],old);
 assert.deepEqual(splitForumCards([make('x','worry','me',1)]).history,[]);
});

test('history UI reuses CardRow, onOpen and onCheer; filters stay scoped to main',()=>{
 const app=readFileSync(join(root,'src','App.tsx'),'utf8');
 assert.match(app,/setForumSection\('history'\)/);
 assert.match(app,/forumSection === 'history' \? historyFeed : forumFeed/);
 assert.match(app,/onClick=\{\(\) => openCard\(card\)\}/);
 assert.match(app,/onCheer=\{\(\) => cheer\(card\)\}/);
 assert.match(app,/还没有历史目标卡/);
 assert.match(app,/forumSection === 'main' && <div className="forum-chips" role="group" aria-label="论坛分类"/);
});

test('neither code nor tests change or hide room routes',()=>{
 const app=readFileSync(join(root,'src','App.tsx'),'utf8');
 assert.match(app,/\>\s*群聊\s*<\/button\>/);
 assert.match(app,/setView\('room'\)/);
});
