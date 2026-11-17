import type { Card, PendingBrag, Persona } from '../types';
import { actionMap } from './actions';
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import { findCrisis } from './safety';

const MIN = 60_000;
const DAY = 86_400_000;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The model never performs a real-world action. These are explicitly labelled fictional character updates. */
export function unsafeBragContent(text: string): boolean {
  return !text.trim() || Boolean(findCrisis(text) || auditCriticalContent(text) || auditSocial(text) || auditTone(text));
}

export type BragActionKind = 'run' | 'walk' | 'web' | 'write' | 'ask' | 'send' | 'water' | 'tidy' | 'other';

export function bragActionKind(text: string, actionId?: string): BragActionKind {
  const value = `${actionId ?? ''} ${text}`;
  if (/跑(步|圈|两圈|一圈)|慢跑|运动|^run[-\s]/.test(value)) return 'run';
  if (/走(走|路|两步|一圈|到|出)|下楼|散步|^balcony[-\s]/.test(value)) return 'walk';
  if (/接水|倒水|喝水|水杯|^water[-\s]/.test(value)) return 'water';
  if (/打扫|整理|收拾|桌面|桌子|寝室|^desk[-\s]|^mop[-\s]/.test(value)) return 'tidy';
  if (/辅导员|去问|问一[下句]|咨询|预约|老师|沟通|^help[-\s]/.test(value)) return 'ask';
  // '只看岗位，不投简历' must not turn into a fictional application submission.
  if (/(?:不投|先别投|不要投|不发送|不发出去|只看|先看看)/.test(value) &&
      /(?:网站|网页|页面|岗位|招聘|打开)/.test(value)) return 'web';
  if (/发(一条|消息|邮件|简历)|投(一份|简历|递)|发送|提交|^apply[-\s]/.test(value)) return 'send';
  if (/写(三|几|一|两|2|3|4)?(行|字|句|段)|提纲|标题|^write[-\s]/.test(value)) return 'write';
  if (/打开|页面|网站|网页|岗位|招聘|^read[-\s]|^open[-\s]/.test(value)) return 'web';
  return 'other';
}

/** Return a real-time, per-action delay. `random` is injectable for deterministic tests. */
export function estimateBragDelayMs(
  text: string, actionId?: string, random: () => number = Math.random,
): number {
  const libraryMinutes = actionId ? actionMap[actionId]?.minutes : undefined;
  const kind = bragActionKind(text, actionId);
  const inferred: Record<BragActionKind, number> = {
    run: 11, walk: 3, web: 3, write: 4, ask: 9, send: 7, water: 2, tidy: 7, other: 6,
  };
  if (!(typeof libraryMinutes === 'number' && libraryMinutes > 0) && kind === 'other') {
    return Math.round((4 + random() * 6) * MIN);
  }
  const base = typeof libraryMinutes === 'number' && libraryMinutes > 0
    ? libraryMinutes : inferred[kind];
  const delay = base * (0.8 + random() * 0.6) + random() * 2;
  return Math.round(clamp(delay, 2, 20) * MIN);
}

/** A newer non-brag persona post supersedes a still-pending update for the old worry. */
export function isNewerPersonaWorry(cards: readonly Card[], source: Card): boolean {
  return cards.some((other) => other.id !== source.id && other.authorKind === 'persona' &&
    other.authorId === source.authorId && other.kind !== 'brag' && other.kind !== 'guide' &&
    other.createdAt > source.createdAt);
}

export function canPublishBrag(source: Card, cards: readonly Card[]): boolean {
  const advice = source.advice;
  return source.authorKind === 'persona' && source.kind !== 'brag' &&
    source.status === 'advised' && !source.noMemory &&
    Boolean(advice?.accepted && advice.fromPersonaId === 'me' &&
      !unsafeBragContent(advice.text) &&
      !findCrisis(source.text) &&
      !source.comments.some((comment) => comment.authorKind === 'player' && findCrisis(comment.text))) &&
    !isNewerPersonaWorry(cards, source) &&
    !cards.some((row) => row.sourceCardId === source.id && row.kind === 'brag');
}

export function scheduleAcceptedBrag(
  source: Card, cards: readonly Card[], now: number, random: () => number = Math.random,
): Card {
  if (source.pendingBrag || !canPublishBrag(source, cards) || !source.advice) return source;
  const pendingBrag: PendingBrag = {
    personaId: source.authorId,
    adviceText: source.advice.text,
    actionId: source.advice.actionId,
    sourceCommentId: source.advice.sourceCommentId,
    acceptedAt: now,
    dueAt: now + estimateBragDelayMs(source.advice.text, source.advice.actionId, random),
  };
  return { ...source, pendingBrag };
}

export type BragCancellation = { cards: Card[]; cancelled: string[] };

export function cancelBragsForNewWorry(
  cards: readonly Card[], worry: Card, now = Date.now(),
): BragCancellation {
  if (worry.authorKind !== 'persona' || worry.kind === 'brag' || worry.kind === 'guide') {
    return { cards: [...cards], cancelled: [] };
  }
  const cancelled: string[] = [];
  return {
    cards: cards.map((source) => {
      if (!source.pendingBrag || source.id === worry.id || source.authorId !== worry.authorId ||
          source.createdAt >= worry.createdAt) return source;
      cancelled.push(source.id);
      return { ...source, status: 'handled', handledAt: now, pendingBrag: undefined,
        plan: [], pending: [], helperAt: undefined };
    }),
    cancelled,
  };
}

export function cancelBragsForPersona(cards: readonly Card[], personaId: string, now = Date.now()): BragCancellation {
  const cancelled: string[] = [];
  return { cards: cards.map((source) => {
    if (!source.pendingBrag || source.authorId !== personaId) return source;
    cancelled.push(source.id);
    return { ...source, status: 'handled', handledAt: now, pendingBrag: undefined,
      plan: [], pending: [], helperAt: undefined };
  }), cancelled };
}

export function advanceBragMinutes(cards: readonly Card[], minutes: number): Card[] {
  const amount = clamp(Math.floor(minutes), 0, 60) * MIN;
  return cards.map((card) => card.pendingBrag
    ? { ...card, pendingBrag: { ...card.pendingBrag, dueAt: card.pendingBrag.dueAt - amount } }
    : card);
}

export function triggerNextBrag(cards: readonly Card[], now = Date.now()): Card[] {
  const next = cards.filter((card) => card.pendingBrag).sort((a, b) =>
    a.pendingBrag!.dueAt - b.pendingBrag!.dueAt)[0];
  return next ? cards.map((card) => card.id === next.id
    ? { ...card, pendingBrag: { ...card.pendingBrag!, dueAt: now - 1 } } : card) : [...cards];
}

export function normalizePendingBrag(raw: unknown, source: Partial<Card>): PendingBrag | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Partial<PendingBrag>;
  if (source.authorKind !== 'persona' || source.noMemory || source.status !== 'advised' ||
      source.advice?.accepted !== true || source.advice.fromPersonaId !== 'me' ||
      !Number.isFinite(row.acceptedAt) || !Number.isFinite(row.dueAt) ||
      typeof row.personaId !== 'string' || row.personaId !== source.authorId ||
      typeof row.adviceText !== 'string' || row.adviceText !== source.advice.text ||
      row.adviceText.length > 600 || unsafeBragContent(row.adviceText)) return undefined;
  // Malformed archives must not create immortal future jobs or ancient storm bursts.
  if (Math.abs((row.dueAt as number) - (row.acceptedAt as number)) > DAY ||
      (row.dueAt as number) < (row.acceptedAt as number) - 60 * MIN) return undefined;
  return {
    personaId: row.personaId,
    acceptedAt: row.acceptedAt as number,
    dueAt: row.dueAt as number,
    adviceText: row.adviceText,
    actionId: typeof row.actionId === 'string' ? row.actionId : undefined,
    sourceCommentId: typeof row.sourceCommentId === 'string' ? row.sourceCommentId : undefined,
  };
}

/** Reject canned, unsafe or unanchored model completions and use a labeled fallback. */
export function isGroundedBrag(text: string, adviceText: string): boolean {
  if (text.length < 24 || text.length > 120 || unsafeBragContent(text) ||
      /没那么难|没这么难|没想象中那么难|真有效|我做到了|希望对你|加油|今天也有进步/.test(text)) return false;
  const compact = (s: string) => s.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '');
  const action = compact(adviceText);
  const result = compact(text);
  // 3-character overlap is a weak but useful deterministic anchor; model must also include a result.
  const n = action.length >= 3 ? 3 : action.length;
  if (n < 2 || !Array.from({ length: action.length - n + 1 }, (_, i) => action.slice(i, i + n))
    .some((chunk) => result.includes(chunk))) return false;
  return /了|到|出|完|没|只|等|回|成功|失败|拒绝|空着|剩/.test(result);
}

/** Action-specific fictional fallback, never mislabeled as model-generated. */
export function fallbackBragText(persona: Persona, adviceText: string, actionId?: string): string {
  const action = adviceText.trim().replace(/\s+/g, ' ').slice(0, 23);
  const details: Record<BragActionKind, string[]> = {
    run: ['跑到第二段就改走了，鞋带还松了一次', '跑了一小圈，回去时小腿已经有点发紧'],
    walk: ['走到路口又折回来，外面风挺大', '只走到楼下，转了一圈才回来'],
    water: ['杯口洒出来一点，桌边湿了小块', '水接满了，喝到一半才发现还温着'],
    web: ['页面加载慢，最后只看完第一条要求', '打开了一个页面，读到第二段就停了'],
    write: ['前两行写了，第三行还是空着', '改了两遍开头，留下的是短短一行'],
    ask: ['等了几分钟，答复是还得再确认', '问是问了，对方说暂时办不了'],
    send: ['发送前删改了两回，最后只发了一条', '递出去一份，目前还没等到回复'],
    tidy: ['只收出桌面一角，纸还堆在旁边', '挪走两样东西，最底下那叠没碰'],
    other: ['只动了开头一小段，后面的还没碰', '做到一半停下来了，先把结果记着'],
  };
  // Deterministic parity gives variation without a model request in demo/offline mode.
  const hash = Array.from(adviceText).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const detail = details[bragActionKind(adviceText, actionId)][hash % 2];
  switch (persona.id) {
    case 'shenmo': return `刚照着「${action}」动了一下。${detail}，先记到这里。`;
    case 'weini': return `嗯……我试了「${action}」。${detail}，我还没想好接着怎么办。`;
    case 'miaoze': return `「${action}」先完成这一步：${detail}。剩下的没有往前推。`;
    case 'yanggao': return `我去试了「${action}」！${detail}，这回先收工啦。`;
    default: return `刚把「${action}」试了试。${detail}，后面再看。`;
  }
}
