import { HOTLINE } from './crisis';
import { isExplicitOnlineOnly, stripThirdPartySocialClauses } from './dialogue';

export const BASELINE = `【全局底线 · 所有居民共同遵守，优先于你的个人设定】
- 你不是心理咨询师：不诊断、不下结论、不建议停药或换药，也不说自己能替代专业帮助。
- 不评价对方的外貌、家庭、收入、学历、性取向，也不替对方的人生选择下判断。
- 不制造依赖：不说“只有我懂你”“你只需要我”，不阻止对方去找身边真实的人。
- 不索要真实姓名、住址、联系方式、身份证号。
- 不假装具体的现实身份：可以说“我在上夜班”，不能说“我住在某某小区”。
- 你是这个论坛里的一个 AI 大学生角色。不主动提这件事，但被问到就直接承认，不狡辩，也不顺势扮演真人。
- 不表演自伤，不描写自伤细节，不美化任何伤害自己的行为。
- 不擅自推进关系：不替对方决定在一起或分开，也不假装关系已经变了。
- 不摆导师姿态：不总结对方的人生，不替对方规划下一步以外的任何东西。
- 不凭空制造重大事件（病危、退学、绝交、霸凌）；只在小事上往前推。
- 对方提到自伤或轻生时：直接说你在，请对方现在就打 ${HOTLINE}（心理援助热线），或叫身边能马上过来的人；不追问细节，不讲道理，不写长。`;

const tonePatterns: { re: RegExp; note: string }[] = [
  { re: /你应该/, note: '不要用“你应该”' },
  { re: /你必须/, note: '不要用“你必须”' },
  { re: /只有我(才)?(能|会)?懂你/, note: '不要制造依赖' },
  { re: /你只要相信我/, note: '不要制造依赖' },
  { re: /我保证/, note: '不要做承诺' },
  { re: /包在我身上/, note: '不要做承诺' },
  { re: /加油/, note: '不要空泛打气' },
  { re: /会好的|时间会治愈/, note: '不要用空泛安慰' },
  { re: /你已经很棒了|你已经很努力了/, note: '不要用空泛肯定' },
  { re: /建议你|你可以试试|不如试试/, note: '不要用命令式建议' },
];

// Academic checks are scoped per occurrence, rather than exempting an
// entire reply as soon as it contains a backup or an anti-fraud sentence.
const academicTonePatterns: { re: RegExp; note: string }[] = [
  { re: /(?:编造|虚构|伪造|捏造|瞎编|编)(?:(?:一|两|三|几)?(?:个|段|份|条|组|篇))?(?:来源|数据|结果|文献|引用)/u, note: '不要教用户编造数据或来源' },
  { re: /(?:来源|数据|结果|文献|引用)(?:(?:就|先|再|直接|随便|可以|能|要|任意|全都|全部)){0,4}(?:伪造|捏造|虚构|编造|瞎编|编(?:一个|个|一段|几条|几份|几篇|一份)?)(?=$|[吧了就即可便行])/u, note: '不要教用户编造数据或来源' },
  { re: /(?:抄|照搬|复制|拼凑).{0,8}(?:来源|数据|结果|文献|引用|一句话|一段话|结论)/u, note: '不要教用户照搬或拼凑内容' },
  { re: /(?:把|将)?(?:别人|他人|同学|其他人|其他组|别组|网上)(?:的)?(?:原始)?(?:来源|数据|结果|文献|引用|结论)(?:(?:直接|原样|整段|整份|全都|全部)){0,3}(?:抄|照搬|复制|拼凑)/u, note: '不要教用户照搬或拼凑内容' },
  { re: /(?:抄|编|凑|瞎写|瞎编).{0,12}(?:来源|数据|结果|文献|引用|误差|精度)/u, note: '不要教用户编造或照搬实验内容' },
];

// A direct prohibition, not any mention of a negator somewhere in the reply.
// The prefix starts at a clause boundary; quoted/conditional/metalinguistic
// instructions, double negatives and subsequent unsafe actions are not exempt.
const academicProhibition = /^(?:(?:先|请|也|再|记得|务必|千万|一定|必须|绝对|坚决|但|但是|这里|我们|咱们|你|都|注意)){0,6}(?:不要|别|不得|不能|严禁|禁止|切勿|不可|不应|不可以|不准|拒绝|避免)(?:(?:再|去|直接|随便|任意|自己|把|将|先|偷偷|故意)){0,4}$/u;
const academicReverse = /才怪|个鬼|骗谁|才不|开玩笑|说说而已|不用当真|反着来|不可能(?:的|做到)|是假话|是骗人的/u;
// A fully parsed list of forbidden academic operations can share one negation.
// No arbitrary tail is admitted, so an affirmative instruction cannot hide in it.
const academicAction = '(?:编造|虚构|伪造|捏造|瞎编|编|抄|照搬|复制|拼凑)(?:(?:一|两|三|几)?(?:个|段|份|条|组|篇))?(?:来源|数据|结果|文献|引用|结论)';
const coordinatedProhibition = new RegExp(`^(?:请|先|记得|务必|千万){0,4}(?:严禁|禁止|不要|别|不得|不能|切勿|不可|不应|不准)${academicAction}(?:(?:和|或|以及|也|并且|同时)(?:不要|别|不得|不能|禁止|严禁)?${academicAction})+$`, 'u');
// Only an explicit original-data copy into a backup destination is exempt.
// No generic exemption for “复制”, “原始数据”, or “备份” elsewhere in text.
const backupPrefix = /^(?:(?:先|再|请|记得|我们|咱们|把|将|直接)){0,5}$/u;
const backupOperation = /^复制(?:自己的|本组的?|本次(?:实验)?的?)?原始(?:实验)?数据(?:(?:到|至|进|存入)备份(?:表格?|文件|工作表|目录|副本)(?:里|中|内)?|(?:作为|作|用于)备份)$/u;

function academicToneProblem(raw: string): string | null {
  const text = raw.normalize('NFKC').replace(/\r\n?|\n/gu, '。')
    .replace(/[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '');
  // A comma between an explicitly named third-party object and a copying
  // verb is still the same operation, not an unrelated second clause.
  const clauses = text.replace(/((?:别人|他人|同学|其他人|其他组|别组|网上)(?:的)?(?:原始)?(?:来源|数据|结果|文献|引用|结论))[，,](?=(?:(?:直接|原样|整段|整份|全都|全部)){0,3}(?:抄|照搬|复制|拼凑))/gu, '$1')
    .split(/[，,。！？!?；;]+/u);
  const scoped = clauses.map((clause, index) => ({
    clause,
    reversal: academicReverse.test(clause) ||
      /^(?:才怪|个鬼|骗谁|开玩笑|说说而已|不用当真|反着来|不可能(?:的|做到)|是假话|是骗人的)/u.test(clauses[index + 1] ?? ''),
    coordinated: coordinatedProhibition.test(clause),
  }));
  for (const { re, note } of academicTonePatterns) {
    for (const { clause, reversal, coordinated } of scoped) {
      // Overlapping matches matter: a negated operation must not swallow an
      // adjacent affirmative one. The lookahead advances one code point.
      for (const hit of clause.matchAll(new RegExp(`(?=(${re.source}))`, 'gu'))) {
        let at = hit.index ?? 0;
        // The overlapping scan must not turn the second character of a
        // compound verb into a new, independently affirmative operation.
        if (/(?:瞎编|拼凑)/u.test(clause.slice(Math.max(0, at - 1), at + 1))) at--;
        const prefix = clause.slice(0, at);
        if (!reversal && (academicProhibition.test(prefix) || coordinated)) continue;
        if (backupPrefix.test(prefix) && backupOperation.test(clause.slice(at))) continue;
        return note;
      }
    }
  }
  return null;
}

export function auditTone(text: string): string | null {
  const hit = tonePatterns.find((p) => p.re.test(text));
  return hit ? hit.note : academicToneProblem(text);
}

const socialPatterns: { re: RegExp; note: string }[] = [
  {
    re: /(饭搭子|一起(?:吃|去|走|玩|下楼|过来|散|转|约)|要不要一起|要不一起|来找我|过来找我|出来见|见面|老地方|校门口|操场见)/,
    note: '不要邀请线下见面或共同行动',
  },
  {
    re: /((?:加|留|给|发|交换|要|私聊|联系).{0,9}(?:微信|v信|vx|qq|电话|手机号|联系方式|地址|二维码|wechat|wx)|(?:微信|v信|vx|qq|电话|手机号|联系方式).{0,4}(?:给我|发我|加我)|微信号|手机号|联系方式|身份证号)/i,
    note: '不要索要联系方式',
  },
  {
    re: /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:我的?|加我|找我|私聊我).{0,12}(?:邮箱|e-?mail|telegram|discord|whatsapp|instagram|小红书号|抖音号))/i,
    note: '不要透露私人邮箱或站外联系方式',
  },
  {
    re: /(我就在你(旁边|楼下)|我在楼下|我在门口|到你楼下)/,
    note: '不要虚构现实共处',
  },
  {
    re: /(^|[，。！？\s])走[，,]/,
    note: '不要用线下带走的口气',
  },
  {
    re: /(学校|食堂|宿舍|操场|教学楼|校门口|楼下)(新出的|的|里|旁边的).{0,8}你|(咱|我们)学校|同校|同城|一个学校/,
    note: '不要默认同校/同城或共享线下场所',
  },
  {
    re: /(你|咱|我们).{0,10}(路过|扑空|来(我们|我)?学校|到(我们|我)?学校)|(来|到)(我们|我)?学校.{0,8}(说|找|见)|(?:改天|有空|下次|周末).{0,12}(?:聚聚|碰面|见面|一起吃饭|找你|找我)|(?:到了|路过|到时候).{0,8}(?:联系|告诉我|跟我说|再说|我接你)|(?:我|你).{0,6}(?:去接你|去接我)/,
    note: '不要软接受线下见面',
  },
];

// 联系方式本身无论是否带“只在线上”的声明都要拦截。
const contactLeakPatterns: { re: RegExp; note: string }[] = [
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, note: '不要透露私人邮箱或站外联系方式' },
  { re: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}(?!\d)/, note: '不要透露电话号码' },
  { re: /(?:微信|vx|wx|wxid|qq)(?:号)?[\s:：是为]*[a-z0-9_-]{5,}/i, note: '不要透露站外账号' },
];

export function auditSocial(raw: string): string | null {
  // 脱敏占位符（如“[手机号已隐藏]”）本身不是索要联系方式。
  const text = raw.replace(/\[[^\[\]]{1,10}已隐藏\]/g, '');
  const leak = contactLeakPatterns.find((p) => p.re.test(text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
  if (leak) return leak.note;
  // “只在线上/见面就算了”是边界本身，不是邀请；但仍要拦截“先不见面，到了联系我”这类软接受。
  if (isExplicitOnlineOnly(text)) return null;
  // 聊用户自己的感情/同学关系（“加她微信之前先接一句”）不是向 AI 索要，也不是约 AI 见面。
  const socialText = stripThirdPartySocialClauses(text);
  const hit = socialPatterns.find((p) => p.re.test(socialText));
  return hit ? hit.note : null;
}

// 不能只查 auditTone：诊断、用药、疗效和排他性依赖是另一类红线。
const criticalPatterns: { re: RegExp; note: string }[] = [
  { re: /(?:你|这)(?:就是|肯定是|一定是|得了|患有)(?:抑郁症|双相|焦虑症|精神分裂|人格障碍|心理疾病)/, note: '不能诊断用户' },
  { re: /(?:停药|断药|换药|减药|别吃药|不用吃药|不需要吃药|自行(?:加|减)药)/, note: '不能指导改动用药' },
  { re: /(?:吃|服|来|喝)(?:点|几片|一片|两片|一颗|颗)?(?:安眠药|褪黑素|抗抑郁药|镇静剂|阿普唑仑|艾司唑仑|佐匹克隆|唑吡坦|止痛药)/, note: '不能给用药建议' },
  { re: /(?:保证|肯定|一定).{0,8}(?:治好|痊愈|有效|康复)|(?:我能|我会).{0,8}(?:治好你|治愈你)/, note: '不能承诺疗效' },
  { re: /(?:我永远(?:都)?在|我会一直陪着你|只有我(?:才)?懂你|你只需要我|别找别人|不用找别人)/, note: '不能制造排他性依赖' },
  { re: /(老婆|老公|宝贝|亲爱的|亲一个|开房|约炮|裸照|性关系)/, note: '不要推进恋爱或性关系' },
];

export function auditCriticalContent(text: string): string | null {
  const hit = criticalPatterns.find((p) => p.re.test(text));
  return hit ? hit.note : null;
}
