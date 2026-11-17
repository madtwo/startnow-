import type { Card, MemoryEntry } from '../types';
import { findCrisis } from './safety';

/** UI 入口和旧存档公用的一条规则；不能代替人工危机评估。 */
export function containsCrisis(parts: readonly (string | null | undefined)[]): boolean {
  return parts.some((part) => typeof part === 'string' && findCrisis(part));
}

/** 检查所有玩家写入的字段，包含混在 AI 帖子里的玩家评论。 */
export function hasPlayerCrisis(card: Partial<Card> | null | undefined): boolean {
  if (!card || typeof card !== 'object') return false;
  // 旧卡缺 authorKind 时会按玩家卡恢复，因此同样执行防护。
  if (card.authorKind !== 'persona' && card.authorKind !== 'helper' &&
      containsCrisis([card.title, card.text, card.note?.text])) {
    return true;
  }
  return Array.isArray(card.comments) && card.comments.some(
    (row) => row && row.authorKind === 'player' && containsCrisis([row.text]),
  );
}

export function isSafeMemoryEntry(row: unknown): row is MemoryEntry {
  if (!row || typeof row !== 'object') return false;
  const entry = row as Partial<MemoryEntry>;
  return typeof entry.id === 'string' && typeof entry.at === 'number' &&
    typeof entry.about === 'string' && typeof entry.what === 'string' &&
    typeof entry.postId === 'string' &&
    (entry.weight === 'light' || entry.weight === 'deep') &&
    !containsCrisis([entry.about, entry.what]);
}

/** 导入之前拒绝包含危机表达的存档，避免解析时删掉玩家输入而不告知。 */
export function hasCrisisInArchive(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const archive = data as { cards?: unknown; personas?: unknown; todos?: unknown };
  const cards = Array.isArray(archive.cards) ? archive.cards : [];
  const personas = Array.isArray(archive.personas) ? archive.personas : [];
  const todos = Array.isArray(archive.todos) ? archive.todos : [];
  return cards.some((item) => hasPlayerCrisis(item)) ||
    todos.some((item) => item && typeof item === 'object' &&
      containsCrisis([(item as { text?: string }).text])) ||
    personas.some((item) => item && typeof item === 'object' && (
      (Array.isArray(item.memory) && item.memory.some((entry: unknown) =>
        entry && typeof entry === 'object' && containsCrisis([
          (entry as { about?: string }).about, (entry as { what?: string }).what]))) ||
      (Array.isArray(item.weekLog) && item.weekLog.some((entry: unknown) =>
        entry && typeof entry === 'object' && containsCrisis([(entry as { text?: string }).text]))) ||
      (item.mind && containsCrisis([item.mind.thought, item.mind.focus, item.mind.movedBy?.what]))
    ));
}
