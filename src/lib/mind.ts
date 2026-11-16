import type { Mood, Persona, PersonaMind } from '../types';

export const MOOD_LABEL: Record<Mood, string> = {
  calm: '平静',
  low: '有点低',
  tense: '绷着',
  warm: '松了一点',
  restless: '坐不住',
};

const HOUR = 3_600_000;

const clip = (text: string, max = 34) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

const templates: Record<string, Omit<PersonaMind, 'lastAct' | 'lastActAt'>> = {
  shenmo: {
    mood: 'tense',
    thought: '病理小测还没背完，手机亮一下就想摸过去。',
    focus: '今晚把病理第三章过一遍',
  },
  weini: {
    mood: 'low',
    thought: '汇报的第一句还没念顺，妈妈又发消息问我在干嘛。',
    focus: '把汇报开头练顺',
  },
  miaoze: {
    mood: 'restless',
    thought: '校招群又有人发面经，我收藏了一堆却没投。',
    focus: '挑一个最不重要的岗位先投',
  },
  yanggao: {
    mood: 'warm',
    thought: '助学金还没去问，但今天食堂的鸡腿真不错。',
    focus: '去资助窗口问一句',
  },
};

export function ensureMind(persona: Persona, now = Date.now()): PersonaMind {
  const fallback = templates[persona.id] ?? {
    mood: 'calm' as const,
    thought: persona.weekLog[0]?.text ?? persona.tagline,
    focus: '先把今天过完',
  };
  const base = persona.mind ?? { ...fallback, lastAct: 'lurk' as const, lastActAt: now };
  let mind: PersonaMind = {
    ...base,
    lastActAt: base.lastActAt || now,
  };
  if (mind.movedBy && now - mind.movedBy.at > 6 * HOUR) {
    mind = { ...mind, movedBy: undefined };
  }
  if (now - mind.lastActAt > 12 * HOUR) {
    mind = { ...mind, mood: mind.mood === 'low' ? 'low' : 'calm', thought: mind.focus };
  }
  return mind;
}

export function ensureMinds(personas: Persona[], now = Date.now()): Persona[] {
  return personas.map((p) => ({ ...p, mind: ensureMind(p, now) }));
}

export function mindPrompt(mind: PersonaMind): string {
  const moved = mind.movedBy
    ? `\n刚才 ${mind.movedBy.by} 在你的卡下说：「${mind.movedBy.what}」，你还没完全消化。`
    : '';
  return `你现在有自己的心事。不要直接向对方说明，只让它影响你的语气和选择：
心情：${MOOD_LABEL[mind.mood]}
脑子里在想：${mind.thought}
最近惦记：${mind.focus}${moved}`;
}

export function mindAfterPost(persona: Persona, text: string, now = Date.now()): PersonaMind {
  const mood: Mood = /难受|哭|崩|怕|失眠|睡不着/.test(text)
    ? 'low'
    : /考试|论文|面试|截止|ddl|投|绩点/.test(text)
      ? 'tense'
      : 'restless';
  return {
    ...ensureMind(persona, now),
    mood,
    thought: '刚把这件事发出去，不知道会不会有人回。',
    focus: clip(text, 30),
    lastAct: 'post',
    lastActAt: now,
  };
}

export function mindAfterReply(persona: Persona, toName: string, now = Date.now()): PersonaMind {
  return {
    ...ensureMind(persona, now),
    thought: `刚在${toName}的卡下说了一句，不知道有没有说重。`,
    lastAct: 'reply',
    lastActAt: now,
  };
}

export function mindAfterPeer(
  persona: Persona,
  byName: string,
  text: string,
  now = Date.now(),
): PersonaMind {
  const mood: Mood = /哈哈|离谱|你又|不是吧|别装|笑死|你这/.test(text)
    ? 'restless'
    : /我也是|我懂|在的|别急|抱抱|辛苦|没事|慢慢/.test(text)
      ? 'warm'
      : 'tense';
  return {
    ...ensureMind(persona, now),
    mood,
    thought: `${byName}刚在我卡下说「${clip(text, 20)}」，我还没想好怎么接。`,
    movedBy: { by: byName, what: clip(text, 30), at: now },
    lastActAt: now,
  };
}

export function mindAfterStep(persona: Persona, now = Date.now()): PersonaMind {
  return {
    ...ensureMind(persona, now),
    mood: 'warm',
    thought: '照着别人给的小步做了一次，没想象中那么难。',
    focus: '今晚先不逼自己了',
    lastAct: 'step',
    lastActAt: now,
  };
}
