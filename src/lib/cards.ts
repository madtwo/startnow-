import type { Card, LlmConfig, Persona, PendingReply, WorldSettings } from '../types';
import { isMock } from '../config/providers';
import { auditTone } from './baseline';
import { findCrisis, isHeavyShare } from './safety';
import { addMemory, inferWeight, renderMemory } from './memory';
import { streamChat } from './llm';
import { actionLabel, pickActions, smallerAction } from './actions';
import { mockCardText } from './personas';
import {
  ADVICE_DECIDE_RULES,
  CARD_RULES,
  cardPrompt,
  cleanLine,
  COMMENT_RULES,
  commentPrompt,
  decidePrompt,
  systemFor,
} from './prompts';

const DAY = 86_400_000;
const MIN = 60_000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const uid = () => crypto.randomUUID();
const scale = (settings: WorldSettings) => Math.max(1, settings.speed);

const allowedWeight = (intimacy: number): 1 | 2 | 3 =>
  intimacy < 30 ? 1 : intimacy < 60 ? 2 : 3;

export function notePlayerShare(personas: Persona[], text: string): Persona[] {
  if (!isHeavyShare(text)) return personas;
  return personas.map((p) => ({
    ...p,
    intimacy: Math.min(100, p.intimacy + 6),
    shareBoost: 1,
  }));
}

export function pickArrivals(personas: Persona[], count: number): Persona[] {
  const rest = [...personas];
  const out: Persona[] = [];
  while (out.length < count && rest.length) {
    const total = rest.reduce((sum, p) => sum + Math.max(2, p.replyDesire), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < rest.length - 1; idx++) {
      r -= Math.max(2, rest[idx].replyDesire);
      if (r <= 0) break;
    }
    out.push(rest.splice(idx, 1)[0]);
  }
  return out;
}

export function createPlayerCard(
  text: string,
  identityName: string,
  personas: Persona[],
  settings: WorldSettings,
  title?: string,
  now = Date.now(),
  kind: 'worry' | 'brag' = 'worry',
): Card {
  const cap = Math.max(1, settings.maxArrivals);
  const n = Math.min(cap, 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0));
  const chosen = pickArrivals(personas, Math.max(1, n));
  const plan = chosen.map((p, i) => ({
    personaId: p.id,
    at:
      now +
      ((i === 0 ? rand(20, 60) : i === 1 ? rand(70, 180) : rand(180, 360)) * 1000) / scale(settings),
  }));
  return {
    id: uid(),
    authorId: 'me',
    authorName: identityName,
    authorKind: 'player',
    title: title?.trim() || undefined,
    kind,
    likes: 0,
    likedByMe: false,
    helperAt: now + (kind === 'brag' ? 6000 : 4000) / scale(settings),
    text,
    createdAt: now,
    status: 'stuck',
    arrivals: [],
    plan,
    pending: [],
    comments: [],
  };
}

export function personaCard(persona: Persona, now = Date.now()): Card {
  const weight = allowedWeight(persona.intimacy);
  return {
    id: uid(),
    authorId: persona.id,
    authorName: persona.name,
    authorKind: 'persona',
    text: mockCardText(persona, weight),
    weight,
    createdAt: now,
    status: 'stuck',
    arrivals: [],
    plan: [],
    pending: [],
    comments: [],
    topic: '',
  };
}

export function addPlayerComment(
  card: Card,
  text: string,
  now = Date.now(),
  speed = 6,
  kind: 'comment' | 'advice' = 'comment',
  peer?: string,
): Card {
  const comments = [
    ...card.comments,
    { id: uid(), authorId: 'me', authorKind: 'player' as const, text, at: now, kind, peer },
  ];
  const pending = [...card.pending];
  const target =
    peer ?? (card.authorKind === 'persona' ? card.authorId : undefined);
  if (!target) {
    return { ...card, comments, status: card.status === 'stuck' ? 'talking' : card.status };
  }
  if (kind === 'advice') {
    pending.push({ personaId: target, at: now + (rand(4, 10) * 1000) / speed, phase: 'decide' });
    return { ...card, comments, pending, status: card.status === 'stuck' ? 'talking' : card.status };
  }
  if (pending.length < 3) {
    pending.push({ personaId: target, at: now + (rand(8, 35) * 1000) / speed, phase: 'reply' });
  }
  return {
    ...card,
    comments,
    pending,
    status: card.status === 'stuck' ? 'talking' : card.status,
  };
}

export function summonPersona(card: Card, personaId: string, now = Date.now()): Card {
  if (card.arrivals.includes(personaId)) return card;
  return {
    ...card,
    plan: [...card.plan.filter((p) => p.personaId !== personaId), { personaId, at: now - 1 }],
  };
}

export function shrinkAdvice(card: Card, now = Date.now()): Card {
  const advice = card.advice;
  if (!advice?.actionId) return card;
  const smaller = smallerAction(advice.actionId);
  if (!smaller) return card;
  return {
    ...card,
    advice: { ...advice, text: smaller.label, actionId: smaller.id, at: now },
    comments: [
      ...card.comments,
      {
        id: uid(),
        authorId: advice.fromPersonaId,
        authorKind: 'persona',
        text: smaller.line,
        at: now,
      },
    ],
  };
}

export function acceptAdvice(card: Card, now = Date.now()): Card {
  if (!card.advice) return card;
  return {
    ...card,
    status: 'noted',
    advice: { ...card.advice, accepted: true },
    note: {
      text: card.advice.text,
      actionId: card.advice.actionId,
      fromPersonaId: card.advice.fromPersonaId,
      at: now,
      dueAt: now + DAY,
    },
  };
}

export function closeCard(card: Card, now = Date.now()): Card {
  return { ...card, status: 'handled', handledAt: now };
}

export function completeCard(card: Card, now = Date.now(), speed = 6): Card {
  const label = card.note?.text ?? '那件小事';
  const pool = [
    ...new Set([card.advice?.fromPersonaId, ...card.arrivals].filter(Boolean) as string[]),
  ].slice(0, 2);
  const pending: PendingReply[] = pool.map((personaId, i) => ({
    personaId,
    at: now + ((i === 0 ? rand(10, 40) : rand(40, 110)) * 1000) / Math.max(1, speed),
    phase: 'reaction',
  }));
  return {
    ...card,
    status: 'done',
    doneAt: now,
    pending,
    comments: [
      ...card.comments,
      { id: uid(), authorId: 'me', authorKind: 'player', text: `做到了：${label}。`, at: now },
    ],
  };
}

interface Ctx {
  config: LlmConfig;
  settings: WorldSettings;
  calls: number;
  logs: string[];
}

function mockComment(persona: Persona, _card: Card, phase: 'arrival' | 'reply'): string {
  const pool: Record<string, { arrival: string[]; reply: string[] }> = {
    shenmo: {
      arrival: ['怎么了？你说，我听着。呃……要不要先吃饭？', '在的。我刚好背完一页，你说。'],
      reply: ['我也这样，等一条消息能等一晚上。', '我懂那种，明明没多大事，就是放不下。'],
    },
    weini: {
      arrival: ['嗯……我在。你要讲的话，我可以听。不会往外说的。', '那个……你先说，我不急。'],
      reply: ['我也有点怕说错话。', '嗯……听起来你不是不在意，是不知道怎么开口。'],
    },
    miaoze: {
      arrival: ['什么方面？要是能说清楚是哪一件，可能就好处理点。', '在的。先说说，不急着解决。'],
      reply: ['我这两天也这样，越想越乱。', '要不先拆成两件事看看？'],
    },
    yanggao: {
      arrival: ['哎你来了！谁惹你了？', '在在在，怎么了。'],
      reply: ['走，先下楼买瓶喝的，边走边说。', '别闷着，你说，我听着呢。'],
    },
  };
  const rows = pool[persona.id] ?? { arrival: ['我看到了。'], reply: ['嗯，我在听。'] };
  const list = rows[phase];
  return list[Math.floor(Math.random() * list.length)];
}

const tentative: Record<string, string[]> = {
  shenmo: ['呃……我也刚来，不太会回这个。你这是卡在什么事上？'],
  weini: ['嗯……我可能也不太会说话。你先说说？'],
  miaoze: ['我也说不准该怎么接……大概是哪件事卡住了？'],
  yanggao: ['哎，我其实也不太懂这儿怎么玩。不过你说，我听着。'],
};

function reactionLine(persona: Persona, label: string): string {
  const pool: Record<string, string[]> = {
    shenmo: [`${label}？可以啊。我这边还一个字没背。`, `${label}，那今晚能睡踏实点了。`],
    weini: [`${label}……挺好的。`, `嗯，${label}，我也想做点自己的事了。`],
    miaoze: [`${label}？真做了？那你今晚赢了。`, `可以啊${label}，我都替你高兴。`],
    yanggao: [`${label}？行啊你！走，庆祝一下。`, `我就说你能行。${label}，漂亮。`],
  };
  const list = pool[persona.id] ?? [`${label}，挺好啊。`];
  return list[Math.floor(Math.random() * list.length)];
}

async function callOnce(ctx: Ctx, system: string, user: string, maxTokens: number) {
  ctx.calls++;
  return streamChat({
    config: ctx.config,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    signal: new AbortController().signal,
    sessionId: `ses_c_${Math.random().toString(36).slice(2, 10)}`,
    onDelta: () => {},
    maxTokens,
    lowEffort: true,
  });
}

async function generateComment(
  ctx: Ctx,
  persona: Persona,
  card: Card,
  phase: 'arrival' | 'reply',
): Promise<string> {
  if (isMock(ctx.config)) {
    if (persona.intimacy < 22 && card.comments.length === 0) {
      const pool = tentative[persona.id];
      if (pool) return pool[Math.floor(Math.random() * pool.length)];
    }
    return mockComment(persona, card, phase);
  }
  try {
    const text = await callOnce(
      ctx,
      systemFor(
        persona,
        renderMemory(persona.memory, Date.now()),
        `${COMMENT_RULES}${
          persona.intimacy < 22 && card.comments.length === 0
            ? ' 你和这个人还不熟，也不太确定这里该怎么说话：句子短一点，别用亲昵称呼，别急着给建议，可以说「我也说不好」。'
            : ''
        }${
          persona.shareBoost
            ? ' 你刚听对方说了一件挺重的事。这一句可以带一点你自己的类似经历，但不要比较、不要说教。'
            : ''
        }`,
        ctx.settings.baselineExtra,
      ),
      commentPrompt(card),
      200,
    );
    const line = cleanLine(text);
    if (line && !findCrisis(line) && !auditTone(line)) return line;
    ctx.logs.push(`${persona.name} 的那句被拦下了，换了一句`);
  } catch {
    ctx.logs.push(`${persona.name} 这次没说话`);
  }
  return mockComment(persona, card, phase);
}

function dailyQuota(personas: Persona[]) {
  return Math.min(6, 2 + Math.max(0, personas.length - 4));
}

async function generateAiCard(
  ctx: Ctx,
  persona: Persona,
  recent: string[],
  now: number,
  weight: 1 | 2 | 3,
): Promise<{ text: string; fact: string } | null> {
  if (isMock(ctx.config)) return { text: mockCardText(persona, weight), fact: '' };
  try {
    const text = await callOnce(
      ctx,
      systemFor(persona, renderMemory(persona.memory, now), CARD_RULES, ctx.settings.baselineExtra),
      cardPrompt(recent, new Date(now), weight, persona.intimacy),
      220,
    );
    const [body, fact] = text.split('|||');
    const card = cleanLine(body ?? text, 120);
    if (!card || findCrisis(card) || auditTone(card)) {
      ctx.logs.push(`${persona.name} 的卡被拦下了`);
      return null;
    }
    const cleanFact = fact && !/^无/.test(fact.trim()) ? cleanLine(fact, 60) : '';
    return { text: card, fact: cleanFact };
  } catch {
    ctx.logs.push(`${persona.name} 这次没发出来`);
    return null;
  }
}

export interface TickInput {
  cards: Card[];
  personas: Persona[];
  settings: WorldSettings;
  config: LlmConfig;
  now?: number;
}

export interface TickOutput {
  cards: Card[];
  personas: Persona[];
  calls: number;
  logs: string[];
}

export async function tickCards(input: TickInput): Promise<TickOutput> {
  const now = input.now ?? Date.now();
  if (input.settings.paused) {
    return { cards: input.cards, personas: input.personas, calls: 0, logs: [] };
  }
  const ctx: Ctx = { config: input.config, settings: input.settings, calls: 0, logs: [] };
  let personas = input.personas.map((p) => ({
    ...p,
    memory: [...p.memory],
    weekLog: [...p.weekLog],
  }));
  const limit = isMock(input.config) ? 6 : Math.max(1, input.settings.maxCallsPerTick);
  const speed = scale(input.settings);

  const cards: Card[] = [];
  for (const original of input.cards) {
    let card: Card = {
      ...original,
      comments: [...original.comments],
      arrivals: [...original.arrivals],
      plan: [...original.plan],
      pending: [...original.pending],
    };

    if (
      card.helperAt &&
      now >= card.helperAt &&
      !card.comments.some((c) => c.authorId === 'helper')
    ) {
      card = {
        ...card,
        helperAt: undefined,
        comments: [
          ...card.comments,
          {
            id: uid(),
            authorId: 'helper',
            authorKind: 'helper',
            text:
              card.kind === 'brag'
                ? '记下了。做到了就是做到了，不用写得漂亮。'
                : '看到了。先不用急着讲清楚，坐一会儿，会有人陆续来。',
            at: now,
          },
        ],
      };
    }

    if (card.status === 'noted' && card.note && now > card.note.dueAt) {
      card = { ...card, status: 'handled', handledAt: now, note: undefined };
    }
    if (
      (card.status === 'talking' || card.status === 'advised') &&
      now - card.createdAt > DAY
    ) {
      card = { ...card, status: 'handled', handledAt: now };
    }

    for (const item of card.plan.filter((p) => p.at <= now)) {
      if (ctx.calls >= limit) break;
      const persona = personas.find((p) => p.id === item.personaId);
      card.plan = card.plan.filter((p) => p !== item);
      if (!persona) continue;
      const text = await generateComment(ctx, persona, card, 'arrival');
      card.comments.push({
        id: uid(),
        authorId: persona.id,
        authorKind: 'persona',
        text,
        at: item.at,
      });
      card.arrivals.push(persona.id);
      if (card.status === 'stuck') card.status = 'arrived';
      else if (card.status === 'arrived') card.status = 'talking';
      if (card.authorId === 'me') {
        personas = personas.map((p) =>
          p.id === persona.id
            ? {
                ...p,
                memory: addMemory(
                  p.memory,
                  {
                    at: item.at,
                    about: '你',
                    what: card.text.slice(0, 34),
                    weight: inferWeight(card.text),
                    postId: card.id,
                  },
                  now,
                ),
              }
            : p,
        );
      }
    }

    const ready = card.pending.filter((p) => p.at <= now).sort((a, b) => a.at - b.at)[0];
    if (ready && ctx.calls < limit) {
      const persona = personas.find((p) => p.id === ready.personaId);
      card.pending = card.pending.filter((p) => p !== ready);
      if (persona) {
        if (ready.phase === 'reaction') {
          const label = card.note?.text ?? '那件小事';
          card.comments.push({
            id: uid(),
            authorId: persona.id,
            authorKind: 'persona',
            text: reactionLine(persona, label),
            at: ready.at,
          });
        } else if (ready.phase === 'decide') {
          const adviceComment = [...card.comments].reverse().find((c) => c.kind === 'advice');
          const adviceText = adviceComment?.text ?? '';
          let accept = Math.random() < 0.7;
          let reply = accept
            ? '行，我试试。'
            : '这个我可能做不到，我连门都不想出。';
          if (!isMock(ctx.config) && adviceText) {
            try {
              const raw = await callOnce(
                ctx,
                systemFor(
                  persona,
                  renderMemory(persona.memory, now),
                  ADVICE_DECIDE_RULES,
                  input.settings.baselineExtra,
                ),
                decidePrompt(card, adviceText),
                140,
              );
              const [head, ...rest] = raw.split('|');
              const said = cleanLine(rest.join('|'), 60);
              if (/^接受/.test(head.trim()) && said) {
                accept = true;
                reply = said;
              } else if (/^拒绝/.test(head.trim()) && said) {
                accept = false;
                reply = said;
              }
            } catch {
              ctx.logs.push(`${persona.name} 没接住这句建议`);
            }
          }
          card.comments.push({
            id: uid(),
            authorId: persona.id,
            authorKind: 'persona',
            text: reply,
            at: ready.at,
          });
          if (accept) {
            card.advice = {
              text: adviceText,
              fromPersonaId: 'me',
              at: ready.at,
              accepted: true,
            };
            card.status = 'advised';
          } else {
            const refused = (card.refused ?? 0) + 1;
            card = { ...card, refused };
            if (refused >= 2) {
              card = { ...card, status: 'handled', handledAt: ready.at };
            }
          }
        } else {
          const text = await generateComment(ctx, persona, card, 'reply');
          card.comments.push({
            id: uid(),
            authorId: persona.id,
            authorKind: 'persona',
            text,
            at: ready.at,
          });
        }
      }
    }

    if (
      card.authorKind === 'persona' &&
      card.advice?.accepted &&
      card.status !== 'done' &&
      now - card.advice.at > 90_000 / speed
    ) {
      const label = card.advice.text;
      const outcome = isMock(input.config) ? '做了，感觉一般。' : '做了，比想的容易一点。';
      card = {
        ...card,
        status: 'done',
        doneAt: now,
        comments: [
          ...card.comments,
          {
            id: uid(),
            authorId: card.authorId,
            authorKind: 'persona',
            text: `${label}。我做了。${outcome}`,
            at: now,
          },
        ],
      };
      personas = personas.map((p) =>
        p.id === card.authorId
          ? {
              ...p,
              weekLog: [
                ...p.weekLog,
                { at: now, text: `照着别人说的「${label}」做了一次，${outcome}` },
              ].slice(-8),
            }
          : p,
      );
      ctx.logs.push(`${card.authorName} 做到了「${label}」`);
    }

    cards.push(card);
  }

  const todayCards = cards.filter(
    (c) => c.authorKind === 'persona' && now - c.createdAt < 24 * 60 * MIN,
  );
  const quota = dailyQuota(personas);
  if (todayCards.length < quota && ctx.calls < limit && personas.length) {
    const candidates = personas.filter((p) => !todayCards.some((c) => c.authorId === p.id));
    const pool = candidates.length ? candidates : personas;
    const persona = pool[Math.floor(Math.random() * pool.length)];
    const recent = cards.filter((c) => c.authorId === persona.id).slice(0, 3).map((c) => c.text);
    const boost = persona.shareBoost ? 1 : 0;
    const weight = Math.min(3, allowedWeight(persona.intimacy) + boost) as 1 | 2 | 3;
    const made = await generateAiCard(ctx, persona, recent, now, weight);
    if (made) {
      cards.push({
        id: uid(),
        authorId: persona.id,
        authorName: persona.name,
        authorKind: 'persona',
        text: made.text,
        weight,
        createdAt: now,
        status: 'stuck',
        arrivals: [],
        plan: [],
        pending: [],
        comments: [],
        topic: made.text.slice(0, 12),
      });
      personas = personas.map((p) =>
        p.id === persona.id
          ? {
              ...p,
              shareBoost: undefined,
              weekLog: made.fact
                ? [...p.weekLog, { at: now, text: made.fact }].slice(-8)
                : p.weekLog,
            }
          : p,
      );
    }
  }

  return { cards, personas, calls: ctx.calls, logs: ctx.logs };
}

export async function askForAdvice(
  input: TickInput & { cardId: string },
): Promise<{ cards: Card[]; calls: number; logs: string[] }> {
  const now = input.now ?? Date.now();
  const card = input.cards.find((c) => c.id === input.cardId);
  if (!card) return { cards: input.cards, calls: 0, logs: [] };
  const persona = input.personas.find((p) => card.arrivals.includes(p.id)) ?? input.personas[0];
  if (!persona) return { cards: input.cards, calls: 0, logs: [] };

  const options = pickActions(new Date(now).getHours(), 3);
  const action = options[0];
  let text = action.line;
  let calls = 0;

  if (!isMock(input.config)) {
    try {
      calls++;
      const raw = await streamChat({
        config: input.config,
        messages: [
          {
            role: 'system',
            content: systemFor(
              persona,
              renderMemory(persona.memory, now),
              '从下面三个办法里挑一个，用「我卡住的时候一般会……」的口气说出来，不超过 30 字。只输出一行：编号|你说的话',
              input.settings.baselineExtra,
            ),
          },
          {
            role: 'user',
            content: `卡片：${card.text}\n\n${options
              .map((o) => `${o.id} | ${o.label}（${o.minutes} 分钟）`)
              .join('\n')}`,
          },
        ],
        signal: new AbortController().signal,
        onDelta: () => {},
        maxTokens: 120,
        lowEffort: true,
      });
      const said = cleanLine(raw.split('|').slice(1).join('|'), 60);
      if (said && !auditTone(said) && !findCrisis(said)) text = said;
    } catch {
      text = action.line;
    }
  }

  const next: Card = {
    ...card,
    advice: { text, actionId: action.id, fromPersonaId: persona.id, at: now, accepted: false },
    status: 'advised',
    comments: [
      ...card.comments,
      { id: uid(), authorId: persona.id, authorKind: 'persona' as const, text, at: now },
    ],
  };
  return {
    cards: input.cards.map((c) => (c.id === card.id ? next : c)),
    calls,
    logs: [`${persona.name} 给了一个办法：${action.label}`],
  };
}

export function markSeen(card: Card, now = Date.now()): Card {
  return card.seenAt ? card : { ...card, seenAt: now };
}

export const actionMeta = (id?: string) => ({
  label: id ? actionLabel(id) : '',
  exists: Boolean(id),
});
