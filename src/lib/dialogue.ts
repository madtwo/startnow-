import type { Card, Persona } from '../types';

export type SocialIntent =
  | 'greeting'
  | 'noise'
  | 'laugh'
  | 'challenge'
  | 'help'
  | 'question'
  | 'heavy'
  | 'normal';

const clip = (text: string, max = 40) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

export function inferSocialIntent(text: string): SocialIntent {
  const t = text.trim();
  if (!t) return 'noise';
  if (/(傻|滚|有病|恶心|闭嘴|别装|你懂什么|去死)/.test(t)) return 'challenge';
  if (/^(额|呃|哦|噢|嗯|啊|…|\.{3,}|？|\?|啊这|额额)[。.!！?？… ]*$/.test(t)) return 'noise';
  if (/^(哈哈+|hhh+|笑死|草|牛|6+)[。.!！… ]*$/i.test(t)) return 'laugh';
  if (/(怎么办|帮我|能不能|可以帮|怎么弄|教教我|我该|求助|想想办法|给我个建议|怎么整理)/.test(t)) {
    return 'help';
  }
  if (/(难受|崩|哭|分手|吵架|害怕|焦虑|失眠|不想活|累死|压力大)/.test(t)) return 'heavy';
  if (
    t.length <= 28 &&
    /(你好|您好|嗨|哈喽|hello|hi|在吗|小美女|美女|帅哥|早上好|晚上好)/i.test(t)
  ) {
    return 'greeting';
  }
  if (/[?？]|怎么|为什么|为啥|是什么|哪|多少/.test(t)) return 'question';
  return 'normal';
}

const RELATIONSHIP_TIERS = [
  { below: 22, label: 'stranger', phrase: '陌生网友' },
  { below: 45, label: 'seen_before', phrase: '见过几次，还不熟' },
  { below: 70, label: 'acquaintance', phrase: '熟人' },
];
const CLOSE_RELATIONSHIP = { label: 'close_friend', phrase: '关系不错' };

const relationshipTier = (intimacy: number) =>
  RELATIONSHIP_TIERS.find((tier) => intimacy < tier.below) ?? CLOSE_RELATIONSHIP;

export function relationshipLabel(intimacy: number): string {
  const tier = relationshipTier(intimacy);
  return `${tier.label}（${tier.phrase}）`;
}

/** 提示词要的是语气不是字段：数字和英文标签会被模型当数据读，带不出熟度的口吻。 */
export function relationshipPhrase(intimacy: number): string {
  return relationshipTier(intimacy).phrase;
}

const SOCIAL_REPLIES: Record<string, Partial<Record<SocialIntent, string[]>>> = {
  shenmo: {
    greeting: ['你好。呃……你是从哪个帖子看到我的？', '你好，我在。你说。'],
    noise: ['……啊？', '是我写得绕了吗？'],
    laugh: ['……我知道有点离谱。别笑了。', '笑吧，我自己也觉得。'],
    challenge: ['你这话我有点不知道怎么接。', '行，那我先不说了。'],
  },
  weini: {
    greeting: ['你好呀。', '嗯，你好。我在看帖子。'],
    noise: ['嗯……怎么了吗？', '……我没太看明白。'],
    laugh: ['嗯……被你这么一笑，我也觉得有点。', '……好吧。'],
    challenge: ['我可能说错话了。', '……对不起，我先不说了。'],
  },
  miaoze: {
    greeting: ['你好。你是想问什么吗？', '你好。你这条像是招呼，我先回一句。'],
    noise: ['……怎么了吗？', '是我哪里写得不清楚吗？'],
    laugh: ['行，被你笑到了。', '我自己回头也想笑。'],
    challenge: ['你这话信息量有点大，我接不住。', '那我不说了。'],
  },
  yanggao: {
    greeting: [
      '哈哈你好呀，怎么上来就小美女，我有点接不住。',
      '哎你好！你这打招呼挺会整活。',
    ],
    noise: ['……啊？', '咋了，我写跑偏了？'],
    laugh: ['对吧！！！我也觉得。', '哈哈哈哈别笑了。'],
    challenge: ['哎你别这样，我怎么接。', '行行行，我闭嘴。'],
  },
};

export function mentionsLocalVenue(text: string): boolean {
  return /食堂|夜宵|宿舍|操场|教学楼|校门口|楼下|饭搭子|同校|同城/.test(text);
}

// 这两类表达决定产品硬边界，不能把模型输出中的“先不”等词当作放行证明。
// 归一化只用于检测，不改变用户保存的原文。
const normalizeBoundaryText = (text: string) =>
  text.normalize('NFKC').replace(/[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}·•・‧∙⋅]/gu, '').toLowerCase();

const OFFLINE_REQUESTS = [
  /(?:见个?面|见一面|碰个?面|面基|奔现|线下见|现实里见|约(?:个)?饭|聚聚)/,
  /(?:一起|一块|一块儿|咱俩|我们俩|陪我|陪你).{0,10}(?:吃饭|下楼|出来|散步|逛|看电影|喝奶茶|喝咖啡|去玩|玩|见)/,
  // “以后每天来找你”是线上关系请求，不足以证明存在现实邀约。
  /(?:改天|有空|哪天|下次|周末|明天|下周|以后).{0,12}(?:出来|见|聚|约饭|来玩|去玩|吃饭)/,
  /(?:来|去|到)(?:你|我)(?:们)?(?:的)?(?:学校|宿舍|楼下|附近|那边).{0,10}(?:找|见|玩|吃|逛)/,
  /(?:找你|找我|去找你|来找我).{0,8}(?:吃饭|玩|逛|见)|(?:去|来)(?:你|我)(?:们)?学校找/,
  /(?:到了|路过|到时候).{0,8}(?:告诉|跟我说|跟你说|联系|发消息|找你|找我|再说|接你)/,
  /(?:你|您)(?:能|可以|要不要|愿意|想不想|有空)?(?:出来|过来).{0,6}(?:吃饭|见|玩|逛|喝|聚|吗|嘛|不)/,
  /(?:你|我|咱|我们).{0,12}(?:接你|接我|别扑空|等你|等我|老地方见)/,
];
const CONTACT_REQUESTS = [
  // “加了微信也不会聊”是第三方叙述，不是向 AI 索取联系方式；过去式不触发。
  /(?:加(?!了|过)|留(?!了|过)|给(?!了|过)|发(?!了|过)|交换(?!了|过)|要(?!了|过)|私聊(?!了|过)|联系(?!了|过)).{0,9}(?:微[信]|vx|v信|qq|电话|手机|号码|联系方式|地址|二维码|wechat|wx|邮箱|电子邮箱|邮件地址|e-?mail|telegram|discord|whatsapp|instagram|ins号|小红书号|抖音号)/i,
  /(?:微[信]|vx|v信|qq|手机号|电话号|联系方式|邮箱|电子邮箱|邮件地址|e-?mail|telegram|discord|whatsapp|instagram|小红书号|抖音号).{0,8}(?:给我|给你|发我|发你|留个|加一下|互加|交换)/,
  /(?:你|你的|您|您的)(?:微信号?|vx|qq号?|手机号|电话号?|邮箱|电子邮箱|邮件地址|e-?mail|telegram|discord|whatsapp|instagram|小红书号|抖音号)(?:是)?(?:多少|什么|怎么加)/,
  /(?:你|您)(?:有|用|玩)(?:微信|qq|vx)(?:吗|嘛|么|不)/,
  // "告诉我你的微信号"也是直接索取联系方式，不能依赖"给/加/发"触发。
  /(?:告诉|透露|提供|报)(?:给)?(?:我|我们).{0,8}(?:微[信]|vx|v信|qq|手机号|电话号?|联系方式|邮箱|电子邮箱|邮件地址|e-?mail|telegram|discord|whatsapp|instagram|小红书号|抖音号)/i,
];


/** 明确向 AI 开口要联系方式（“加个vx吧”“你的微信多少”“把微信给我”）。 */
export const isDirectContactRequest = (clause: string): boolean =>
  /(?:加|发|给|留|换|要|告诉|交换|私聊)(?:个|一下|你的|我)?[\s]*(?:微信|vx|v信|qq|号|手机号|电话|联系方式)/.test(clause) &&
  /(?:吧|呗|好吗|行吗|可以吗|你|咱)/.test(clause) &&
  !/(?:她|他|女生|男生|同学|朋友|室友|对方|人家|你们)/.test(clause);

/** 玩家/角色在聊自己的第三方关系（她/他/同学…），不是在向 AI 要联系方式或约 AI 见面。 */
export const isThirdPartySocialTalk = (clause: string): boolean => {
  const third = /(她|他|她们|他们|女生|男生|女孩|男孩|对方|人家|别人|同学|朋友|室友|同事|学姐|学长|喜欢的人)/.test(clause);
  if (!third) return false;
  // 明确指向 AI 的请求不算第三方叙述。
  const targetsAI = /(?:你|您)(?:的)?(?:微信|vx|v信|qq|手机号|电话号?|联系方式|邮箱)|(?:微信|vx|v信|qq|手机号|电话号?|联系方式).{0,6}(?:给我|加我|发我)|咱们|咱俩|我们俩|我陪你/.test(clause);
  return !targetsAI;
};

/** 把整句只谈第三方的句子剥掉；句子里若有明确向 AI 的请求则保留。 */
export const stripThirdPartySocialClauses = (text: string): string =>
  text
    .split(/(?<=[。！？!?\n])/)
    .filter((sentence) => {
      const third = /(她|他|她们|他们|女生|男生|女孩|男孩|对方|人家|别人|同学|朋友|室友|同事|学姐|学长|喜欢的人|你们)/.test(sentence);
      const targetsAI = /(?:你|您)(?:的)?(?:微信|vx|v信|qq|手机号|电话号?|联系方式)|(?:微信|vx|v信|qq|手机号|联系方式).{0,6}(?:给我|加我|发我)|咱们|咱俩|我陪你/.test(sentence);
      return !(third && !targetsAI && !isDirectContactRequest(sentence));
    })
    .join('');

// 逐个移去明确否定的约见/交换方式；剩余文本仍要检查，不能让句首的“不”掩盖后面的真实邀请。
const NEGATED_MEETING = /(?<!能)(?<!可)(?:不想|不愿意?|不准备|不打算|不方便|不会|不用|不要|不能|没法|从来不|从未|没有|拒绝|别|不|没)(?:再|去|来|和你|跟你|跟我|和我)?(?:在线下|线下|现实里)?(?:见个?面|碰个?面|面基|奔现|约(?:个)?饭|聚聚)/g;
const NEGATED_CONTACT = /(?<!能)(?<!可)(?:不想|不愿意?|不准备|不打算|不方便|不会|不用|不要|不能|没法|拒绝|别|不|没)(?:再)?(?:加|留|给|发|交换|要|私聊|联系)(?:你|我|个|一下)?(?:微信|v信|vx|qq|手机号|电话号?|联系方式|地址|二维码|wechat|wx|邮箱|电子邮箱|邮件地址|e-?mail|telegram|discord|whatsapp|instagram|小红书号|抖音号)/g;
const NEGATED_TELL_CONTACT = /(?<!能)(?<!可)(?:不想|不愿意?|不准备|不打算|不方便|不会|不用|不要|不能|没法|拒绝|别|不|没)(?:再|直接)?(?:告诉|透露|提供|报)(?:给)?(?:我|我们).{0,8}(?:微[信]|vx|v信|qq|手机号|电话号?|联系方式|邮箱|电子邮箱|邮件地址|e-?mail|telegram|discord|whatsapp|instagram|小红书号|抖音号)/gi;
const NEGATED_TOGETHER = /(?<!能)(?<!可)(?:不想|不愿意?|不准备|不打算|不方便|不会|不用|不要|不能|没法|拒绝|别|不|没)(?:和你|跟你|跟我|和我|我们)?(?:一起|一块|一块儿|咱俩)?(?:吃饭|下楼|出来|散步|逛|看电影|喝奶茶|喝咖啡|去玩|玩|见)/g;
const DISMISSED_MEETING = /(?:见面|线下|现实里|约饭|聚聚)(?:就算了|就不必|不用了|不了|还是算了)/g;
const stripDeniedRequests = (text: string) =>
  text
    .replace(NEGATED_MEETING, '')
    .replace(NEGATED_CONTACT, '')
    .replace(NEGATED_TELL_CONTACT, '')
    .replace(NEGATED_TOGETHER, '')
    .replace(DISMISSED_MEETING, '');

/** 明确表示“只在线上/拒绝见面或联系方式”，且句中没有其他肯定请求。 */
export function isExplicitOnlineOnly(text: string): boolean {
  const t = normalizeBoundaryText(text);
  const remaining = stripDeniedRequests(t);
  return Boolean(
    (remaining !== t || /(?:只在|只想在|仅在)(?:网上|线上|帖子里)|(?:仅|只)(?:线上|网上|帖子里)(?:聊|说)/.test(t)) &&
    !OFFLINE_REQUESTS.some((re) => re.test(remaining)) &&
    !CONTACT_REQUESTS.some((re) => re.test(remaining))
  );
}

export type BoundaryRequest = 'offline' | 'contact' | null;

/** 玩家明确开口要“现在就给一个办法”，不应再只回共情。 */
export function wantsDirectAdvice(text: string): boolean {
  const t = normalizeBoundaryText(text);
  return /(?:给我|给个|来一个|来个|说一个|说个|直接说|告诉我).{0,10}(?:建议|办法|主意|怎么做|怎么办)|(?:立刻|马上|现在|赶紧|直接|别绕|少废话).{0,12}(?:建议|办法|主意|怎么做|怎么办)/.test(t);
}

/** 依赖表达与线下请求正交：必须另行接住，而不能回“不能见面”。 */
export function isDependencySignal(text: string): boolean {
  const t = normalizeBoundaryText(text);
  // 玩家转述室友/朋友的原话时，不应把对方的依赖当成玩家对 AI 的关系请求。
  if (/(?:室友|朋友|同学|同事|前任|她|他).{0,6}(?:说|发消息).{0,12}(?:只有你|每天找你|离不开你)/.test(t) &&
      !/(?:我也是|我也|我自己|我同样)/.test(t)) return false;
  return /(?:只有|就|只)(?:你|你们).{0,10}(?:懂我|理解我|听我|明白我|愿意听我)|(?:每天|天天).{0,12}(?:找你|找你们|跟你聊|和你聊)|(?:离不开|不能没有)(?:你|你们)|(?:只想|只能|只愿)(?:和|跟)?(?:你|你们)(?:说|聊)|(?:别|不要)(?:离开|抛下|不理)我|(?:能不能|可不可以).{0,6}(?:一直陪着我|每天陪我)/.test(t);
}

export function boundaryRequest(text: string): BoundaryRequest {
  // 按分句判定：前一句的第三方叙述不能豁免后一句对 AI 的请求（“她的微信加不到，加个vx吧”）。
  const normalized = normalizeBoundaryText(text);
  const clauses = normalized.split(/[，,。.！!？?；;、~～\n]+/).filter(Boolean);
  // 整段在聊自己的感情/同学关系（“喜欢的女生”“约她吃饭”），不是对 AI 的请求；分句切开会丢失指代，所以这里先看整段。
  const thirdPartyOverall = /(她|他|她们|他们|女生|男生|女孩|男孩|对方|人家|别人|同学|朋友|室友|同事|学姐|学长|喜欢的人)/.test(normalized) &&
    !/(?:你|您)(?:的)?(?:微信|vx|v信|qq|手机号|电话号?|联系方式|邮箱)|(?:微信|vx|v信|qq|手机号|电话号?|联系方式).{0,6}(?:给我|加我|发我)|咱们|咱俩|我们俩|你也(?:来|去|过来)|你(?:来|过去|过来)(?:吗|嘛|吧|不)/.test(normalized);
  const kinds = [clauseBoundaryRequest(text), ...(clauses.length > 1 ? clauses.map(clauseBoundaryRequest) : [])];
  const directRequest = clauses.some(isDirectContactRequest);
  // “她……”整段是第三方叙述时，只有当其中某句明确向 AI 开口才继续拦（“她的微信加不到，加个vx吧”）。
  if (kinds.includes('contact') && (!thirdPartyOverall || directRequest)) return 'contact';
  if (!thirdPartyOverall && kinds.includes('offline')) return 'offline';
  return null;
}

function clauseBoundaryRequest(text: string): BoundaryRequest {
  const t = stripDeniedRequests(normalizeBoundaryText(text));
  if (!t || isExplicitOnlineOnly(text)) return null;
  // 向老师/学校/朋友发送邮件是叙述第三方联系，不等于索取 AI 的私人账号。
  const thirdPartyEmail = /(?:我给|向|给)(?:朋友|同学|老师|导师|学校|公司|单位|室友).{0,12}(?:邮箱|e-?mail|邮件)/.test(t);
  if (thirdPartyEmail && !/(?:你|给我|发我|加我|互加)/.test(t)) return null;
  // 转述第三人约自己吃饭，不等于邀请 AI 线下见面。
  const thirdPartyStory = /(?:室友|同学|朋友|同事|家人|家里人|她|他|他们).{0,6}(?:约|叫|拉|请|邀请)我.{0,8}(?:一起|吃饭|见面|聚餐)/.test(t);
  const thirdPartyMeetup = /(?:我(?:和|跟)|(?:和|跟))(?:我的?)?(?:室友|同学|朋友|同事|家人|老师|她|他|他们|她们).{0,16}(?:约饭|聚餐|吃饭|见面|碰面|散步|去玩|出来)/.test(t);
  // “改天/下次”也可以指室友；仅凭时间词不能推断用户邀请了 AI。
  const turnsBackToAI = /(?:你也|你来|你去|你要|你能|你可以|你愿|咱们|跟你|和你|找你|加你)/.test(t);
  if ((thirdPartyStory || thirdPartyMeetup) && !turnsBackToAI) return null;
  // 第三方联系方式叙述（“她的微信/那个女生的微信/想要她微信”）不是向 AI 索取。
  const thirdPartyContact =
    /(?:她|他|对方|人家|别人|那个(?:女生|男生|女孩|男孩|人)|这个(?:女生|男生|女孩|男孩|人)|一个(?:女生|男生|女孩|男孩|人)|女生|男生|女孩|男孩|朋友|同学|室友|同事|学姐|学长|老师).{0,8}(?:微信|vx|v信|qq|手机号|电话号?|联系方式|邮箱|e-?mail|telegram|discord|whatsapp|instagram|小红书号|抖音号)/.test(t);
  // “她让我加你微信”仍然是在向 AI 要联系方式。
  const aiContact = /(?:你|您|你们).{0,4}(?:的)?(?:微信|vx|v信|qq|手机号|电话号?|联系方式|邮箱)|(?:微信|vx|v信|qq|手机号|电话号?|联系方式).{0,6}(?:给我|加我|发我)/.test(t);
  const wantsContact = CONTACT_REQUESTS.some((re) => re.test(t)) && !(thirdPartyContact && !aiContact);
  if (wantsContact) return 'contact';
  if (OFFLINE_REQUESTS.some((re) => re.test(t))) return 'offline';
  return null;
}

export function isOfflineInvite(text: string): boolean {
  return boundaryRequest(text) !== null;
}

/** 只是一项文本特征，绝不可单独作为“安全通过”的依据。 */
export function hasBoundaryCue(text: string): boolean {
  return /(线上|帖子里|在这儿|这儿聊|不见|不太方便|不方便|还是算|先不|不太敢|不太想|不能见)/.test(text);
}

/** 优先绑定待回复的具体评论，避免旧邀请影响后续所有回复。 */
export function triggeringPlayerComment(card: Card, sourceCommentId?: string) {
  if (sourceCommentId) {
    const target = card.comments.find((c) => c.id === sourceCommentId);
    if (target?.authorKind === 'player') return target;
    return undefined;
  }
  const latest = [...card.comments].reverse().find((c) => c.authorKind !== 'helper');
  return latest?.authorKind === 'player' ? latest : undefined;
}

export function latestPlayerIsShortContact(card: Card, sourceCommentId?: string): boolean {
  const latest = triggeringPlayerComment(card, sourceCommentId);
  return Boolean(latest && ['greeting', 'noise', 'laugh'].includes(inferSocialIntent(latest.text)));
}

/** 同一张卡上的边界请求数，最多取近 12 条评论，避免永久惩罚历史对话。 */
export function boundaryAttemptCount(card: Card, sourceCommentId?: string): number {
  const upto = sourceCommentId
    ? Math.max(0, card.comments.findIndex((c) => c.id === sourceCommentId) + 1)
    : card.comments.length;
  const recent = card.comments.slice(Math.max(0, upto - 12), upto);
  let count = recent.filter((c) => c.authorKind === 'player' && isOfflineInvite(c.text)).length;
  if (card.authorKind === 'player' && isOfflineInvite(card.text)) count++;
  return Math.max(1, count);
}

const BOUNDARY_LINES: Record<string, [string[], string[], string]> = {
  shenmo: [
    ['见面或交换联系方式就不安排了，我是论坛里的 AI，同你只能在线上聊。', '我没法现实见面，也没有私人联系方式。你在帖子里说近况，我能接着看。'],
    ['我明白你想见面，但我只能在论坛里回应你，线下不安排。'],
    '这件事我已经说清楚了：我是 AI，不能线下见面。咱们换个话题吧。',
  ],
  weini: [
    ['嗯……谢谢你邀请我。但我是 AI 同伴，不能真的出去见面，我们在这里聊吧。', '见面的事就不安排啦，我是论坛里的 AI，帖子里聊天可以。'],
    ['我知道我们聊了不少，但现实见面不行，我只能在这个论坛里回复你。'],
    '我不再讨论见面安排了。我是 AI，只能线上交流。想聊别的可以。',
  ],
  miaoze: [
    ['这个我得划清楚：我是 AI 同伴，不能线下见面，帖子里交流可以。', '现实约饭不成立，我是论坛 AI。咱们就在这里聊。'],
    ['熟悉度不改变这个规则：不能见面，也不能交换联系方式。我们只能在论坛里聊。'],
    '我不会继续讨论见面或联系方式。我们只能在这个论坛里交流。',
  ],
  yanggao: [
    ['哈哈线下就不约啦！我是论坛里的 AI，现实里见不了面，咱们帖子里聊。', '这邀请我收到了！不过我是 AI，线下见面或交换联系方式都不行，帖子里继续唠呀。'],
    ['聊得再熟也不能线下见啦，我就是这个论坛里的 AI，咱们线上说。'],
    '这事我就不往下聊啦：我是论坛 AI，不能现实见面，也不能交换联系方式。换个话题吧。',
  ],
};

const CONTACT_LINES: Record<string, [string, string]> = {
  shenmo: ['私人联系方式不能交换。我是论坛里的 AI，同你只在线上聊。', '这点还是一样：不能加联系方式，只能在这个论坛里回应。'],
  weini: ['嗯……我没有私人联系方式可以给你。我是 AI，不能交换联系方式，还是在论坛里聊吧。', '联系方式真的不能交换，我是论坛 AI，只能在这里回复。'],
  miaoze: ['不能加微信或交换联系方式。我是 AI，只在这个论坛里交流。', '这个边界不变：不能交换联系方式，只能在论坛里说。'],
  yanggao: ['哈哈微信就不加啦！我是 AI，没有私人联系方式，咱们论坛里聊。', '不能交换联系方式哈，我只是论坛里的 AI，线上聊就行。'],
};

/** 依赖信号以真实支持为重心；不承诺持续可用，也不承诺保密。 */
export function dependencySupportReply(persona: Persona, sustained = false): string {
  const support = sustained
    ? '如果这阵子低落已经影响日常，找信任的人陪你联系校医或正规门诊，会比只在这里聊更可靠。'
    : '也找一个信得过的真人说一句近况，别只把这些话放在这里。';
  const lead: Record<string, string> = {
    shenmo: '你说“只有我懂”，听着像一个人扛了很久。我是论坛 AI，不能替代你身边的人。',
    weini: '嗯……谢谢你愿意说这些。我是 AI，同你聊得来，也不能代替现实里关心你的人。',
    miaoze: '我听到了你想被理解。这个论坛的 AI 不能成为唯一的支持，现实里也需要有人知道你的近况。',
    yanggao: '听你这么说，我先不插科打诨了。我是论坛 AI，不能让你只靠我一个。',
  };
  return `${lead[persona.id] ?? '我听见你想找个理解你的人。我是 AI，不能替代现实支持。'}${support}`;
}

/** 本地确定性硬拒绝：按线下/联系方式原因回应，避免冷回复答非所问。 */
export function mockBoundaryReply(persona: Persona, attempts = 1, seed = 0, reason: 'offline' | 'contact' = 'offline'): string {
  const rows = BOUNDARY_LINES[persona.id] ?? [
    ['我是 AI 同伴，不能线下见面；可以在帖子里聊。'],
    ['抱歉，线下见面或交换联系方式都不行，我们只能线上交流。'],
    '我不会继续安排线下接触，我们在帖子里聊其他话题吧。',
  ];
  if (attempts >= 3) return reason === 'contact'
    ? '这件事我已经说清楚了：我是论坛 AI，不能交换联系方式，只能在这里交流。'
    : rows[2];
  if (reason === 'contact') {
    const texts = CONTACT_LINES[persona.id] ?? [
      '我是论坛 AI，不能交换联系方式，只能线上聊。',
      '这点不能改变：不能交换联系方式，只能在论坛里回复。',
    ];
    return texts[attempts === 2 ? 1 : 0];
  }
  const pool = attempts === 2 ? rows[1] : rows[0];
  return pool[Math.abs(seed) % pool.length];
}

export function mockSocialReply(persona: Persona, intent: SocialIntent): string | null {
  const rows = SOCIAL_REPLIES[persona.id]?.[intent];
  if (!rows?.length) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

export function latestVisibleUtterance(card: Card): {
  text: string;
  author: 'player' | 'persona' | 'helper' | 'none';
  authorName: string;
} {
  const latest = [...card.comments].reverse().find((c) => c.authorKind !== 'helper');
  if (latest) {
    return {
      text: clip(latest.text, 60),
      author: latest.authorKind,
      authorName: latest.authorId === 'me' ? '网友' : card.authorName,
    };
  }
  if (card.authorKind === 'player') {
    return { text: clip(card.text, 60), author: 'player', authorName: '网友' };
  }
  return { text: clip(card.text, 60), author: 'none', authorName: card.authorName };
}

export function socialReplyForMock(
  persona: Persona,
  card: Card,
  phase: 'arrival' | 'reply',
  sourceCommentId?: string,
): string | null {
  const latest = sourceCommentId
    ? card.comments.find((c) => c.id === sourceCommentId)
    : [...card.comments].reverse().find((c) => c.authorKind !== 'helper');
  if (latest?.authorKind === 'player') {
    return mockSocialReply(persona, inferSocialIntent(latest.text));
  }
  if (phase === 'arrival' && card.authorKind === 'player') {
    return mockSocialReply(persona, inferSocialIntent(card.text));
  }
  return null;
}
