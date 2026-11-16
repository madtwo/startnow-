/**
 * 非诊断性的“求助起点”提示：仅识别有明确持续性、日常功能受影响的自述。
 * 这是本地动作选择提示，不记录额外心理标签，也不代替危机识别。
 * 假阳性/假阴性需要结合真实模型与人工审核持续验证。
 */
export function needsHelpSeeking(text: string): boolean {
  const t = text.normalize('NFKC').replace(/\s+/g, '');
  // 讨论别人、课程或科研内容时，不能直接当作用户本人的心理状态。
  const thirdPartyOnly = /^(?:我(?:的)?(?:朋友|室友|同学|家人|老师)|朋友|室友|同学|他|她|他们|她们).{0,16}(?:抑郁|低落|睡不着|起不来)/.test(t) &&
    !/(?:我也|我自己|我最近|我这阵|我已经|我觉得自己)/.test(t);
  if (!t || thirdPartyOnly) return false;

  const duration = /(?:两|俩|2|三|3|四|4)(?:个)?(?:星期|礼拜|周)|半个?月|(?:一个|1个|两|2个|好几个|几个)月|十几天|(?:连续|持续|已经|一直|很久|好久).{0,10}(?:低落|起不来|睡不着|提不起劲|不想出门|难受)/.test(t);
  const symptoms = /(?:提不起劲|没什么动力|什么都不想做|不想起床|起不来|起不了床|睡不着|失眠|没食欲|吃不下|情绪低落|心情低落|睡不醒|很难过|很难受|一直想哭|觉得自己(?:很|挺)?没用|觉得自己(?:很|挺)?废)/.test(t);
  const impact = /(?:起不来|起不了床|不想起床|出不了门|不敢出门|(?:论文|作业|学习|工作|上课|考试|课).{0,12}(?:写不进|做不下|干不下|无法|没法|做不动|进行不下|跟不上)|(?:生活|学习|工作|上课).{0,8}(?:受到影响|受影响|做不了)|(?:影响|耽误).{0,6}(?:生活|学习|工作|上课)|没食欲|吃不下|睡不着)/.test(t);
  const diagnosisQuestion = /(?:我(?:这样)?(?:算不算|是不是|会不会|怀疑|怕是)|(?:这样)?(?:算不算|是不是))(?:得了|有)?(?:抑郁|焦虑症)|(?:我(?:可能|怀疑))(?:得了|有)?(?:抑郁|焦虑症)/.test(t);
  // “论文主题是抑郁”不应该触发求助动作；这里要求“自身症状 + 持续/受影响”或“自身症状 + 求诊疑问”。
  return (duration && symptoms && impact) || (diagnosisQuestion && (symptoms || impact));
}

export interface SupportAction {
  id: string;
  label: string;
  line: string;
  minutes: number;
}

/** 三步保持同一个目标：找到真人专业帮助入口；不会把求助缩小为开窗喝水。 */
export const HELP_SEEKING_ACTIONS: readonly SupportAction[] = [
  {
    id: 'help-3', minutes: 3,
    label: '打开学校心理中心或正规医院的官方预约页面，看看预约方式',
    line: '我先打开学校心理中心或正规医院的官方预约页面，看看怎么约一次咨询或评估。',
  },
  {
    id: 'help-2', minutes: 2,
    label: '搜索学校心理中心或正规医院的官方预约入口，不急着预约',
    line: '我先找学校心理中心或正规医院的官方入口，今天不一定要马上预约。',
  },
  {
    id: 'help-1', minutes: 1,
    label: '在备忘录写下“想找人聊聊/预约一次评估”，暂时不用发送',
    line: '我先在备忘录写一句“想找人聊聊，了解怎么预约评估”，先写下来就好。',
  },
];

export function nextSmallerHelpAction(id: string): SupportAction | null {
  const index = HELP_SEEKING_ACTIONS.findIndex((action) => action.id === id);
  return index >= 0 ? HELP_SEEKING_ACTIONS[index + 1] ?? null : null;
}

export function isHelpSeekingAction(id?: string): boolean {
  return Boolean(id && HELP_SEEKING_ACTIONS.some((a) => a.id === id));
}
