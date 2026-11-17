import type { Card, Persona } from '../types';

export interface MemoryChange { cards: Card[]; personas: Persona[] }

/**
 * 删除记忆后，将仍在本机的来源卡标记 noMemory，避免下一轮 AI 再次从这些卡学习。
 * 旧摘要只存一个 postId，无法推断摘要里其他来源；界面必须披露这一限制。
 */
function forgetSourceCards(cards: Card[], sourceIds: ReadonlySet<string>): Card[] {
  if (!sourceIds.size) return cards;
  return cards.map((card) => sourceIds.has(card.id) ? { ...card, noMemory: true } : card);
}

export function forgetOne(cards: Card[], personas: Persona[], personaId: string, entryId: string): MemoryChange {
  const selected = personas.find((p) => p.id === personaId)?.memory.find((m) => m.id === entryId);
  if (!selected) return { cards, personas };
  return {
    cards: forgetSourceCards(cards, new Set([selected.postId])),
    personas: personas.map((p) => p.id === personaId
      ? { ...p, memory: p.memory.filter((m) => m.id !== entryId), weekLog: [], mind: undefined } : p),
  };
}

export function forgetRole(cards: Card[], personas: Persona[], personaId: string): MemoryChange {
  const target = personas.find((p) => p.id === personaId);
  if (!target) return { cards, personas };
  return {
    cards: forgetSourceCards(cards, new Set(target.memory.map((m) => m.postId))),
    personas: personas.map((p) => p.id === personaId ? { ...p, memory: [], weekLog: [], mind: undefined } : p),
  };
}

export function forgetAll(cards: Card[], personas: Persona[]): MemoryChange {
  return {
    cards: cards.map((card) => card.noMemory ? card : { ...card, noMemory: true }),
    personas: personas.map((p) => ({ ...p, memory: [], weekLog: [], mind: undefined })),
  };
}
