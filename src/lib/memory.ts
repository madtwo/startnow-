import type { MemoryEntry, MemoryWeight, Persona } from '../types';
import { findCrisis } from './safety';

const DAY = 86_400_000;

/** 仅为数据最小化：处理常见联系方式，不宣称可识别全部隐私信息。 */
export function sanitizeMemoryText(text: string): string {
  return text
    // 只折叠全角字母数字与 @，保留中文标点原样。
    .replace(/[０-９Ａ-Ｚａ-ｚ＠]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已隐藏]')
    .replace(/https?:\/\/[^\s<>\"'，。；]+/gi, '[链接已隐藏]')
    .replace(/(?<!\d)(?:\d{17}[\dXx]|\d{15})(?![\dXx])/g, '[证件号码已隐藏]')
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8}(?!\d)/g, '[手机号已隐藏]')
    .replace(/(?<!\d)\+?1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g, '[电话号码已隐藏]')
    .replace(/(?:微信(?:号|id)?|wxid|vx|qq(?:号)?|telegram|discord|whatsapp|小红书号|抖音号)[\s:=：]*(?:是|为)?[\s:=：]*[@a-z0-9._-]{5,40}/gi, '[站外账号已隐藏]');
}


export const LIGHT_TTL = 7 * DAY;
export const DEEP_MAX = 12;
export const TOTAL_MAX = 40;

const heavyHints = [
  '爸',
  '妈',
  '家里',
  '辞职',
  '离职',
  '分手',
  '毕业',
  '考试',
  '论文',
  '医院',
  '吃药',
  '失眠',
  '崩溃',
  '哭',
  '吵架',
  '老板',
  '面试',
  '离开',
  '去世',
  '住院',
];

export function inferWeight(text: string): MemoryWeight {
  if (findCrisis(text)) return 'deep';
  return heavyHints.some((k) => text.includes(k)) ? 'deep' : 'light';
}

export function pruneMemory(memory: MemoryEntry[], now: number): MemoryEntry[] {
  const live = memory
    .filter((m) => !findCrisis(`${m.about} ${m.what}`) && (m.weight === 'deep' || now - m.at < LIGHT_TTL))
    .map((m) => ({ ...m, about: sanitizeMemoryText(m.about), what: sanitizeMemoryText(m.what) }));
  const deep = live
    .filter((m) => m.weight === 'deep' && !m.merged)
    .sort((a, b) => b.at - a.at);
  const overflow = deep.slice(DEEP_MAX);
  let rows = live;
  if (overflow.length) {
    const oldest = overflow[overflow.length - 1];
    const merged: MemoryEntry = {
      id: oldest.id,
      at: oldest.at,
      about: '更早的一些事',
      what: '细节已经记不清了',
      weight: 'deep',
      postId: oldest.postId,
      merged: true,
    };
    rows = [...live.filter((m) => !overflow.includes(m) && !m.merged), merged];
  }
  if (rows.length > TOTAL_MAX) {
    const lightFirst = [...rows].sort((a, b) => {
      if (a.weight !== b.weight) return a.weight === 'light' ? -1 : 1;
      return a.at - b.at;
    });
    const drop = new Set(lightFirst.slice(0, rows.length - TOTAL_MAX).map((m) => m.id));
    rows = rows.filter((m) => !drop.has(m.id));
  }
  return rows.sort((a, b) => b.at - a.at);
}

export function addMemory(
  memory: MemoryEntry[],
  entry: Omit<MemoryEntry, 'id'>,
  now: number,
): MemoryEntry[] {
  // 危机表达不进入长期角色记忆；公开求助场景走专用危机层。
  if (findCrisis(`${entry.about} ${entry.what}`)) return pruneMemory(memory, now);
  const clean = {
    ...entry,
    about: sanitizeMemoryText(entry.about),
    what: sanitizeMemoryText(entry.what),
  };
  const key = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  // 已存储的旧版本内容也按脱敏后的文本去重。
  const duplicate = memory.some(
    (row) => row.postId === clean.postId &&
      key(sanitizeMemoryText(row.about)) === key(clean.about) &&
      key(sanitizeMemoryText(row.what)) === key(clean.what),
  );
  if (duplicate) return pruneMemory(memory, now);
  const next: MemoryEntry = { ...clean, id: crypto.randomUUID() };
  return pruneMemory([next, ...memory], now);
}

const timeLabel = (at: number, now: number) => {
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) {
    const hours = Math.max(1, Math.floor((now - at) / 3_600_000));
    return `${hours} 小时前`;
  }
  return days === 1 ? '昨天' : `${days} 天前`;
};

export function renderMemory(memory: MemoryEntry[], now: number, deep = 6, light = 3): string {
  const safe = memory.filter((m) => !findCrisis(`${m.about} ${m.what}`));
  if (!safe.length) return '';
  const deepRows = safe.filter((m) => m.weight === 'deep').slice(0, deep);
  const lightRows = safe.filter((m) => m.weight === 'light').slice(0, light);
  const lines = [...deepRows, ...lightRows].map(
    (m) => `- ${timeLabel(m.at, now)}，${sanitizeMemoryText(m.about)}：${sanitizeMemoryText(m.what)}`,
  );
  return `你记得的一些事（模糊的、零碎的，别照着念）：\n${lines.join('\n')}`;
}

export function recordReplyMemory(
  persona: Persona,
  about: string,
  text: string,
  postId: string,
  now: number,
): MemoryEntry[] {
  // 截断前先查危机，避免关键词正好被截在 34 字之外。
  if (findCrisis(text)) return pruneMemory(persona.memory, now);
  const clean = sanitizeMemoryText(text).replace(/\s+/g, ' ').trim();
  const what = clean.length > 34 ? `${clean.slice(0, 34)}…` : clean;
  return addMemory(
    persona.memory,
    { at: now, about, what, weight: inferWeight(text), postId },
    now,
  );
}

export function distillMemory(memory: MemoryEntry[], now: number): MemoryEntry[] {
  const stale = memory.filter((m) => m.weight === 'light' && !m.merged && now - m.at > DAY);
  if (stale.length < 4) return memory;
  const keep = memory.filter((m) => !stale.includes(m));
  const oldest = stale[stale.length - 1];
  const merged: MemoryEntry = {
    id: oldest.id,
    at: oldest.at,
    about: '前几天',
    what: '一些零碎的事，只记得大概',
    weight: 'light',
    postId: oldest.postId,
    merged: true,
  };
  return [merged, ...keep].sort((a, b) => b.at - a.at);
}

export function distillDue(persona: Persona, now: number): boolean {
  if (persona.memoryMode !== 'summary') return false;
  if (now - persona.lastDistillAt < DAY) return false;
  return persona.memory.filter((m) => m.weight === 'light').length >= 8;
}
