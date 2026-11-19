import { wantsDirectAdvice } from './directAdvice';

/**
 * A conservative question-only branch for the first reply to an underspecified
 * *request for help*. It must never turn ordinary greetings or a direct request
 * for one action into an interrogation. In particular, do not treat talk about
 * a third-party romantic relationship as a request to date the AI persona.
 */
export function clarificationFor(text: string): string | null {
  const t = text.normalize('NFKC').trim();
  if (!t || wantsDirectAdvice(t) || /(?:直接给|别问|不用问|不要问).{0,15}(?:建议|办法|下一步|行动)/.test(t)) return null;
  const request = /(?:怎么[办做]|咋办|怎么办|不知道|没头绪|没思路|卡住了|卡在哪|理不清|做不来|好难|帮我|求建议|给点意见|迷茫|想开始|不知从何)/.test(t);
  if (!request) return null;
  // Even an underspecified difficult moment needs one question, not a random action.
  if (/(?:报告|论文|作业|课题|实验|考试|复习|学习|课程|笔记)/.test(t)) {
    if (!/(?:数学|物理|病理|化学|英语|政治|数据|报告|论文|PPT|考试|实验|开题|方法段|具体章节)/i.test(t))
      return '你现在卡的是哪门课或哪件要交的东西？';
    if (!/(?:今晚|今天|明天|后天|周[一二三四五六日]|星期[一二三四五六日]|截止|DDL|多少字|第一段|哪一页|第一页|第一步|开头)/i.test(t))
      return '这件事最先要交出的是什么，什么时候要交？';
    return null;
  }
  if (/(?:实习|找工作|求职|简历|投递|面试)/.test(t)) {
    if (!/(?:简历|面试|投递|岗位|笔试|网申|公司|自我介绍)/.test(t))
      return '你眼下最卡的是找岗位、准备简历，还是提交申请？';
    return null;
  }
  if (/(?:室友|同学|朋友|父母|家里|妈妈|爸爸|喜欢的人|暗恋|分手|恋爱|表白)/.test(t)) {
    if (!/(?:他说|她说|他发|她发|吵架|冷战|回消息|加微信|表白|分手|拒绝|没回复|争执|当面)/.test(t))
      return '你愿意说说刚刚发生了什么具体的事吗？';
    return null;
  }
  return t.length < 70 ? '你最想先处理的是哪一件具体的事？' : null;
}
