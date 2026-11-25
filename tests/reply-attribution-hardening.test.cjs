'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { replyAttributionProblem: guard, replyContextForAuthor } = lib('replyAttribution');

// Expectations are explicit text evidence, not a claim of real-world identity.
// Keep all existing guard tests; these cases exercise uncovered boundaries.
const field = 'unsupported_user_field';
const behavior = 'unsupported_user_behavior';
const agency = 'false_agency';
const focus = 'self_focus_replaces_topic';
const cases = [
  ['multiple fields', '你金融方向的简历，另外你临床专业也要投吗', '我是金融专业的', field],
  ['multiple fields reversed', '你临床专业的课程和你金融方向的简历都要准备', '我是金融专业的', field],
  ['supported field', '你金融方向的简历现在卡在哪', '我是金融专业的，简历还没写好。', null],
  ['field with modifiers', '你现在是金融专业的吧', '还没想好投什么岗位', field],
  ['field with uncertainty', '你可能是临床专业的吧', '开题很难写', field],
  ['explicit learner', '你金融专业的简历还没改好', '我是金融专业的学生。', null],
  ['explicit subject', '你计算机方向的简历还要改吗', '我学的是计算机专业。', null],
  ['third-party mention', '你金融专业的简历要投什么', '我朋友学金融专业', field],
  ['third-party possessive', '你金融专业的简历要投什么', '我学金融的朋友最近在求职', field],
  ['negative field', '你金融专业的简历要投什么', '我不是金融专业', field],
  ['quoted denial', '你金融专业的简历要投什么', '我「不是」金融专业', field],
  ['future field', '你金融专业的简历要投什么', '我考虑学金融专业', field],
  ['conditional field', '你金融专业的简历要投什么', '如果我是金融专业的，应该选哪类实习', field],
  ['reported speech', '你金融专业的简历要投什么', '同学说，我是金融专业的', field],
  ['quoted multiline', '你金融专业的简历要投什么', '朋友说：“我在找工作。我是金融专业的。”', field],
  ['positive before reporting', '你金融专业的简历要投什么', '我是金融专业的，导师说下周交作业', null],
  ['neutral field question', '你是金融专业的吗？', '简历改了三版', null],
  ['question plus claim', '你是金融专业的吗？你临床专业的实习怎么办', '简历改了三版', field],
  ['tag question not neutral', '你金融专业的吧？', '简历改了三版', field],
  ['same grade', '你大一了，慢慢熟悉就好', '我大一', null],
  ['wrong grade', '你研三了吧', '我大一', field],
  ['wrong grade with modifier', '你应该是大四了吧', '我大一', field],
  ['multiple grades', '你大一的课和你研三的课都排满了', '我大一', field],
  ['grade of friend', '你研三了吧', '我同学研三', field],
  ['negative grade', '你大四了吧', '我不是大四', field],
  ['grade question', '你大四吗？', '简历还没写好', null],
  ['grade question not evidence', '你大四了吧', '我大四吗？', field],
  ['grade of third party in reply', '你朋友研三了，难怪时间不一样', '我朋友研三了，最近很忙', null],
  ['unsupported behavior', '你一直刷题', '我没刷题', behavior],
  ['planned behavior', '你一直刷题', '我准备刷题', behavior],
  ['other persons behavior', '你一直刷题', '室友一直刷题', behavior],
  ['neutral behavior question', '你一直刷题吗？', '听力跟不上', null],
  ['behavior question not evidence', '你一直刷题', '我刷题吗？', behavior],
  ['supported behavior', '比你硬刷新题管用点', '我一直在刷题，但听力没变化', null],
  ['compound agency', '我可以帮你联系导师', '导师催进度', agency],
  ['past agency', '我已经替你联系了导师', '导师催进度', agency],
  ['future agency', '我这就代你给室友发消息', '室友沟通', agency],
  ['agency by recipient', '我来给你导师发消息', '导师催进度', agency],
  ['past contact', '我刚刚联系了你导师', '导师催进度', agency],
  ['agency direct helper', '我替你去联系组员', '小组分工', agency],
  ['draft instead of contact', '我可以帮你拟一句发给导师的话', '导师催进度', null],
  ['own thought instead of contact', '我帮你想想怎么联系导师', '导师催进度', null],
  ['honest capability limit', '我没法替你联系导师', '导师催进度', null],
  ['comparison of views not agency', '我跟你导师的看法不一样', '导师催进度', null],
  ['listener empathy', '这事看得我都心疼，回寝室前确实难熬。', '宿舍关系有点僵', null],
  ['listener empathy then personal story', '我听着也觉得难熬，我自己上个月也是这样', '生活费不够用', focus],
  ['self focus preserved', '我这几天也是翻外卖记录', '生活费不够用', focus],
];
for (const [name, reply, context, expected] of cases) {
  test(name, () => assert.equal(guard(reply, context), expected));
}
for (const ch of ['\u200B', '\u2060', '\u2061', '\u00AD', '\u034F']) {
  test('zero-width variant U+' + ch.codePointAt(0).toString(16), () => {
    assert.equal(guard('我可以帮你联' + ch + '系导师', '导师催进度'), agency);
    assert.equal(guard('你金' + ch + '融专业的吧', '我不是金融专业'), field);
    assert.equal(guard('你研' + ch + '三吧', '我大一'), field);
  });
}

test('attribution context is tied to the addressee, not the entire room', () => {
  assert.equal(typeof replyContextForAuthor, 'function');
  const player = { authorId: 'me', authorKind: 'player', text: '简历还没写好' };
  const other = { authorId: 'p1', authorKind: 'persona', text: '我是金融专业的' };
  const previous = { ...player, text: '我大一' };
  const context = replyContextForAuthor(player, [other, previous]);
  assert.equal(guard('你金融专业的简历还没写好', context), field);
  assert.equal(guard('你研三了吧', context), field);
  assert.equal(guard('你大一了', context), null);
  assert.equal(guard('你金融专业的简历还没写好', replyContextForAuthor(other, [player])), null);
  assert.equal(replyContextForAuthor(undefined, [other]), '');
  assert.equal(replyContextForAuthor({authorId:'system', authorKind:'system',text:'我是金融专业的'}, [other]), '');
  const collision = {...other, authorId: 'me'};
  assert.equal(guard('你金融专业的简历还没写好', replyContextForAuthor(player, [collision])), field);
});

// Second-round holdout: written and run after the candidate was frozen.
const f = field, b = behavior, a = agency, s = focus;
const holdoutCases=[
['你是学金融专业的吧','我没想好求职方向',f],
['你现在读软件专业啊','我是计算机专业的',f],
['你法学方向的课很难吗','我本科是法学专业的',null],
['你学的是护理专业吗？','想找实习',null],
['你肯定是大三吧','我今年大四了',f],
['你才大一啊','我研二',f],
['你是研二的吗？','还在学校',null],
['你们大四的是不是都这样','我刚毕业',f],
['你大四的课怎么排','我大四了，朋友研一',null],
['你临床专业的报告怎么写','例如，我是临床专业的',f],
['你临床专业的报告怎么写','老师说：“我是临床专业的。”',f],
['你一直刷新题','我想开始刷题',b],
['你一直刷题','我一直刷题才怪',b],
['你最近在刷题吗','听力练了几天',null],
['我马上帮你联系室友','室友沟通',a],
['我刚替你联系组员','分工不均',a],
['我去跟你室友说一声','室友打游戏',a],
['我可以帮你想一句怎么和室友说','室友打游戏',null],
['听得我都心疼，和家里沟通确实磨人','家里催进度',null],
['听得我都心疼，我月底也没钱','生活费不足',s],
];
for (const [i,[reply,context,want]] of holdoutCases.entries()) test('fresh boundary '+(i+1),()=>assert.equal(guard(reply,context),want));
