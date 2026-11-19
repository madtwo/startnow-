import {test} from 'node:test';
import assert from 'node:assert/strict';
import {competitionModeEnabled,competitionSummary,COMPETITION_MODE} from '../src/lib/competition.ts';
import {buildCompetitionSeedCards} from '../src/lib/competitionSeed.ts';
const ids=['shenmo','weini','miaoze','yanggao'];
const personas=ids.map(id=>({id,name:id,school:'学校',major:'专业',cohort:'大三',tagline:'正在学习'}));
const card=(id,extra={})=>({id,authorId:ids[0],authorKind:'persona',kind:'worry',text:'学习报告还没写完',createdAt:Date.now(),...extra});
test('env and storage flag are explicit opt-in with no data deletion',()=>{
  assert.equal(competitionModeEnabled('1',null),true);assert.equal(competitionModeEnabled('0','1'),true);
  assert.equal(competitionModeEnabled(undefined,null),false);assert.equal(typeof COMPETITION_MODE,'boolean');
  assert.equal(competitionSummary(),'今天动过了。');
});
test('clean competition seed has 4 intros, 2 study worries, 1 literature and fictional result',()=>{
  const raw=[card('guide',{kind:'guide'}),card('old',{kind:'goal'}),card('debug',{authorKind:'player',text:'调试卡'}),
    card('a',{text:'复习课程'}),card('b',{text:'考试学习'}),card('c',{text:'实验报告'})];
  const output=buildCompetitionSeedCards(raw,personas,Date.now());
  assert.equal(output.filter(c=>c.intro).length,4);
  assert.equal(output.filter(c=>c.id==='competition-miaoze-literature').length,1);
  assert.equal(output.filter(c=>c.kind==='brag').length,1);
  assert.equal(output.filter(c=>!c.intro&&c.kind==='worry').length,3);
  assert.ok(output.every(c=>!['goal','guide','progress'].includes(c.kind)));
  assert.equal(output.find(c=>c.kind==='brag').origin,'simulated');
});
