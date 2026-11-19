/**
 * 本地判断：玩家这句话是在情绪里，还是在迷茫，还是普通聊天。
 * 只用规则，不调模型——要便宜、要可测、要能解释。
 * 自伤/轻生这类内容由 findCrisis 先拦掉，不会走到这里。
 */

export type Tone = 'neutral' | 'stuck' | 'heavy';

// 「积累」不是情绪，「麻烦你了」也不是。所以用后顾断言把这类词排掉。
const HEAVY: RegExp[] = [
  /(?<!积)累/,
  /(?<!麻)烦/,
  /想哭|哭出来|哭了/,
  /撑不住|绷不住|扛不住|顶不住/,
  /没有?意义|没意思|没盼头/,
  /焦虑|心慌|发慌/,
  /睡不着|失眠/,
  /难受|委屈|心里堵/,
  /崩溃|崩了|垮了/,
  /没力气|没动力|提不起劲|不想动|起不来/,
  /内耗|自卑/,
  /喘不过气|透不过气/,
];

const STUCK: RegExp[] = [
  /不知道(该)?怎么办|怎么办/,
  /不知道该怎么|不知道该干|不知道选/,
  /选哪个|要不要|该不该/,
  /迷茫|没方向|找不到方向/,
  /卡住|卡在|无从下手/,
  /纠结|拿不定|下不了决心|做不了决定|决定不了/,
];

export function emotionalSignal(text: string): Tone {
  const t = text.replace(/\s+/g, '');
  if (!t) return 'neutral';
  if (HEAVY.some((re) => re.test(t))) return 'heavy';
  if (STUCK.some((re) => re.test(t))) return 'stuck';
  return 'neutral';
}

export const toneLabel: Record<Tone, string> = {
  neutral: '普通聊天',
  stuck: '有点迷茫',
  heavy: '情绪上来了',
};
