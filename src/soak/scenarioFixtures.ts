/** Synthetic only. No real user data, personal records, or model-generated scripts. */
export const followupTexts = [
  '我已经把论文文档打开了，但文献列表还乱着。',
  '我把汇报第一页的标题写了，想到开口还是紧张。',
  '今晚戴了耳塞，但室友的键盘声还是吵。',
  '我把简历打开了，只改完最近的那段经历。',
  '我给家里回复了今天课多，还没想好考研。',
  '我去活动室门口看了一眼，还是没进去。',
  '我在聊天框写了两句，暂时还没发。',
  '我把实验仪器的设置记录翻出来了，异常值还在。',
  '我写下了下次被点名时的第一句话，但手还会发抖。',
  '我把两门课程的本周任务分开写到纸上了。',
  '我给妈妈回了消息，可有些事情还是不想说。',
  '我把小组作业分工写出来了，还不知道怎么发给组员。',
  '我把比赛要求第一段看完了，还没有报名。',
  '昨晚比前一天早关了手机，但睡意还是来得晚。',
  '我把想发的消息保存在备忘录里，没急着发送。',
  '我坐起来看了一眼早课时间，还是很难起床。',
] as const;

export const followupTextFor = (scenarioIndex: number): string =>
  followupTexts[((scenarioIndex % followupTexts.length) + followupTexts.length) % followupTexts.length];

/** Matched prompts: the same fixture/context is sent to each candidate model. */
export const completionFixtures = [
  { id: 'resume', personaId: 'shenmo', action: '打开简历文件', trouble: '简历一直不想碰，文件就放在桌面。' },
  { id: 'paper', personaId: 'weini', action: '打开论文文档', trouble: '论文的开头卡了好几天。' },
  { id: 'water', personaId: 'yanggao', action: '倒一杯水', trouble: '今天忙了一整天，连喝口水也拖着。' },
  { id: 'experiment', personaId: 'miaoze', action: '写一行实验记录', trouble: '实验异常值很多，记录本还空着。' },
  { id: 'job', personaId: 'miaoze', action: '打开招聘网页', trouble: '岗位收藏了一堆，还没开始看。' },
  { id: 'report', personaId: 'weini', action: '写一句报告开头', trouble: '汇报开头的第一句不敢写。' },
] as const;
