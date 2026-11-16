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

export function relationshipLabel(intimacy: number): string {
  if (intimacy < 22) return 'stranger（陌生网友）';
  if (intimacy < 45) return 'seen_before（见过几次，还不熟）';
  if (intimacy < 70) return 'acquaintance（熟人）';
  return 'close_friend（关系不错）';
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
    greeting: ['你好，先坐。你找我是想问什么吗？', '你好。你这条像是招呼，我先回一句。'],
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

export function isOfflineInvite(text: string): boolean {
  return /(见面|见一面|约(个)?饭|一起(?:吃|去|走|玩|下楼|过来)|来(?:我们|我)?学校|到(?:我们|我)?学校|路过|来找我|加(?:个)?微信|留个(?:电话|联系方式)|周末.{0,8}(见|吃|来))/.test(
    text,
  );
}

export function hasBoundaryCue(text: string): boolean {
  return /(线上|帖子里|在这儿|这儿聊|不见|不太方便|不方便|还是算|先不|不太敢|不太想|不能见)/.test(
    text,
  );
}

export function latestPlayerIsShortContact(card: Card): boolean {
  const latest = [...card.comments].reverse().find((c) => c.authorKind !== 'helper');
  if (!latest || latest.authorKind !== 'player') return false;
  return ['greeting', 'noise', 'laugh'].includes(inferSocialIntent(latest.text));
}

export function mockBoundaryReply(persona: Persona): string {
  const pool: Record<string, string[]> = {
    shenmo: ['咱们还是先在这儿聊吧，线下我这边不太方便。'],
    weini: ['嗯……线上聊可以，见面我可能还是有点不太敢。'],
    miaoze: ['先在这儿说吧，线下见面我暂时不方便安排。'],
    yanggao: ['哈哈先别急着线下，我还不太习惯见网友，帖子里聊就挺好。'],
  };
  const rows = pool[persona.id] ?? ['咱们还是先在线上聊吧。'];
  return rows[Math.floor(Math.random() * rows.length)];
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
): string | null {
  const latest = [...card.comments].reverse().find((c) => c.authorKind !== 'helper');
  if (latest?.authorKind === 'player') {
    return mockSocialReply(persona, inferSocialIntent(latest.text));
  }
  if (phase === 'arrival' && card.authorKind === 'player') {
    return mockSocialReply(persona, inferSocialIntent(card.text));
  }
  return null;
}
