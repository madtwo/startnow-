'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./_ts-loader.cjs');
const { replyAttributionProblem } = lib('replyAttribution');

test('unsupported user field claims are rejected unless the current context names the field', () => {
  const context = '简历改了三版还是不放心，不知道投什么岗位。';
  assert.equal(replyAttributionProblem('不过你金融方向的话，简历上到底卡在哪块啊', context), 'unsupported_user_field');
  assert.equal(replyAttributionProblem('你们金融的岗位我就不太懂了', context), 'unsupported_user_field');
  assert.equal(replyAttributionProblem('你金融方向的话，简历卡在哪', '我是金融专业的，简历改了三版。'), null);
});

test('unsupported user behavior claims are rejected', () => {
  const context = '六级听力总是跟不上，练了几天没变化。';
  assert.equal(replyAttributionProblem('比你硬刷新题管用点', context), 'unsupported_user_behavior');
  assert.equal(replyAttributionProblem('比你硬刷新题管用点', '我一直在刷题，但听力没变化。'), null);
});

test('fatigue comparisons and invalidation are rejected', () => {
  const context = '实习通勤要一个多小时，想到就累。';
  assert.equal(replyAttributionProblem('那我早上八点的课都不好意思喊累了', context), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我这点累算什么，你才辛苦', context), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我光是从宿舍走到图书馆都想叹气', context), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我光是想到每天站着背图谱就有点发怵', context), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('白天没精神最难受，我这两天上课也老走神。', '最近作息乱了，晚上睡不着，白天没精神。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我也是，背两页看一次手机，越看越睡不着。', '最近作息乱了，晚上睡不着，白天没精神。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我也这几天睡得晚，白天脑袋昏昏的。', '最近作息乱了，晚上睡不着，白天没精神。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('白天没精神这感觉我也熟，看书看着看着就开始点头。', '最近作息乱了，晚上睡不着，白天没精神。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我光是想到早上赶地铁就头皮发麻。', '实习通勤要一个多小时，想到就累。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我光是背书背烦了都想瘫一会儿。', '实习通勤要一个多小时，想到就累。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('我也是那种，晚上躺下就开始刷手机，越刷越清醒。', '最近作息乱了，晚上睡不着，白天没精神。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('嗯，我也是，躺下之后刷着刷着就十二点了，白天上课眼皮一直打架。', '最近作息乱了，晚上睡不着，白天没精神。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('一个多小时是真的熬人，我想想都发怵。', '实习通勤要一个多小时，想到就累。'), null);
});

test('unstated medical topic and academic padding are rejected', () => {
  const research = '论文开题的研究意义写不出来，导师让下周交初稿。';
  assert.equal(replyAttributionProblem('硬套一句这病现在发病率多少就够了', research), 'unsupported_user_field');
  assert.equal(replyAttributionProblem('研究意义先按套话硬套一段', research), 'academic_padding');
  assert.equal(replyAttributionProblem('随机误差留到最后统一编……啊不是，统一算', '材料力学实验报告的误差分析不会写'), 'academic_padding');
  assert.equal(replyAttributionProblem('这病现在发病率多少', '研究某种罕见病的研究意义'), null);
});

test('claiming to contact someone on the user behalf is rejected', () => {
  const context = '小组作业分工不均，我要不要直接说。';
  assert.equal(replyAttributionProblem('我可以先私聊委婉点提，群里直接说也行', context), 'false_agency');
  assert.equal(replyAttributionProblem('你可以先私聊委婉点提，群里直接说也行', context), null);
});

test('sensitive relational or money topics reject self-only replies', () => {
  assert.equal(replyAttributionProblem('嗯，我懂那种感觉，我在自习室也是磨到快闭馆才走。', '宿舍关系有点僵，回宿舍前会有点不想说话。'), 'self_focus_replaces_topic');
  assert.equal(replyAttributionProblem('我也差不多，月底就开始翻外卖记录，看完该点还是点。', '生活费总是不够用，月底就开始算账。'), 'self_focus_replaces_topic');
  assert.equal(replyAttributionProblem('我也差不多，月底就开始翻外卖记录，你那边是固定支出还是零花先超？', '生活费总是不够用，月底就开始算账。'), null);
  assert.equal(replyAttributionProblem('我倒是没啥资格说，我自己导师都还没联系上。', '家里一直催我考公，但我还没想清楚。'), 'self_focus_replaces_topic');
  assert.equal(replyAttributionProblem('冷战几天确实挺熬人的，想开口又卡在那儿的感觉我懂。要不要先发个很轻的话试试。', '和朋友冷战了几天，想和好又不知道怎么开口。'), null);
});

test('unstated grade, sleep mirror, and minimizing reframe are rejected', () => {
  assert.equal(replyAttributionProblem('你们大四的是不是都这样', '简历改了三版还是不放心，不知道投什么岗位。'), 'unsupported_user_field');
  assert.equal(replyAttributionProblem('嗯，我也是，背着背着一到十二点反而精神了。', '最近作息乱了，晚上睡不着，白天没精神。'), 'invalidating_fatigue_comparison');
  assert.equal(replyAttributionProblem('别人说不定觉得还行。', '作品集还没排完，越看越觉得拿不出手。'), 'invalidating_reframe');
});
