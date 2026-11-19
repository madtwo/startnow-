'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=(name)=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('group chat is visible in regular and competition navigation, menu, and route',()=>{
 const app=read('src/App.tsx');
 const nav=app.split('<nav className="top-nav"')[1].split('</nav>')[0];
 assert.match(nav,/onClick=\{\(\) => setView\('room'\)\}/);
 assert.match(nav,/>\s*群聊\s*<\/button>/);
 assert.doesNotMatch(nav,/!COMPETITION_MODE/);
 const menu=app.split('<b>群聊</b>')[0].slice(-600);
 assert.match(menu,/setView\('room'\)/);
 assert.doesNotMatch(menu,/!COMPETITION_MODE/);
 assert.match(app,/has\('room'\) \? 'room' : 'home'/);
 assert.match(app,/view === 'room' && \(/);
});

test('image recognition is cancellable without stuck scan and with visible privacy notice',()=>{
 const app=read('src/App.tsx'),detail=read('src/components/CardDetail.tsx'),post=read('src/components/PostForm.tsx');
 assert.match(app,/const cancelMaterial =/);
 assert.match(app,/controller\.abort\(\)/);
 assert.match(app,/materialError:'cancelled'/);
 assert.match(app,/materialError:'server'/);
 assert.match(app,/onCancelMaterial=\{/);
 assert.match(detail,/取消识别/);
 assert.match(detail,/识别中…/);
 assert.match(post,/姓名、学号/);
 assert.match(post,/拍一下卡住你的东西/);
});

test('lost fictional copy is aligned to academic roles without guilt or dependency',()=>{
 const content=read('src/lib/agentVulnerability.ts');
 assert.match(content,/文献综述越看越不知道自己想问什么/);
 assert.match(content,/作品集挑到第三张/);
 assert.match(content,/开题改到第三版/);
 assert.match(content,/病理背到一半/);
 const lines=content.match(/  (?:shenmo|weini|miaoze|yanggao):'(?:病理背到一半|开题改到第三版|文献综述越看|作品集挑到第三张)[^']*'/g)||[];
 assert.equal(lines.length,4);
 for(const line of lines)assert.doesNotMatch(line,/只有你|你不回我|都怪你|别离开|没有你我不行/);
});


test('share boost never publishes intimacy-60 private demo stories early',()=>{
  const cards=read('src/lib/cards.ts');
  assert.match(cards,/Math\.min\(persona\.intimacy < 60 \? 2 : 3, allowedWeight\(persona\.intimacy\) \+ boost\)/);
  const allowed=(intimacy)=>intimacy<30?1:intimacy<60?2:3;
  for(const intimacy of [0,16,29,30,50,59,60,80,100]){
    for(const boost of [0,1]){
      const weight=Math.min(intimacy<60?2:3,allowed(intimacy)+boost);
      assert.ok(intimacy>=60||weight<=2,`${intimacy} boosted should not reveal weight 3`);
    }
  }
});
