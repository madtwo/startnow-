import { containsCrisis } from './submissionGuard';

/** Voluntarily uploaded notices remain unverified until the user checks and accepts the text. */
export interface NoticeFields {
  item: string;
  date: string;
  location: string;
  submission: string;
  excerpt: string;
}

const NONE = '[未提及]';
const UNKNOWN = '[看不清]';
/** Only an explicitly labelled field counts; do not guess facts from free-form prose. */
export function parseNoticeFields(text: string): NoticeFields {
  const normalized = text.replace(/\r\n/g, '\n').replace(/；/g, ';');
  const read = (labels: string[], limit = 250): string => {
    const names = labels.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const match = normalized.match(new RegExp(`(?:^|[;\\n])\\s*(?:${names})\\s*[：:]\\s*([^;\\n]*)`, 'm'))?.[1]?.trim();
    return match ? match.slice(0, limit) : NONE;
  };
  return {
    item: read(['事项']),
    date: read(['日期或DDL', '日期', 'DDL']),
    location: read(['地点']),
    submission: read(['提交方式']),
    excerpt: read(['原文摘录'], 500),
  };
}

export const isNoticeValue = (value: string) => Boolean(value.trim()) &&
  value.trim() !== NONE && value.trim() !== UNKNOWN;
/** Item plus at least one other structured field must exist before we call it a field result. */
export function hasUsableNoticeFields(fields: NoticeFields): boolean {
  return isNoticeValue(fields.item) &&
    [fields.item, fields.date, fields.location, fields.submission].filter(isNoticeValue).length >= 2;
}

export type NoticeInput =
  | { format: 'fields'; fields: NoticeFields }
  | { format: 'raw'; raw: string };
export type NoticeAppend = { ok: true; text: string; added: string } | { ok: false; message: string };
/** Does not truncate existing user words, silently promote dates, or modify goal storage. */
export function buildNoticeAppend(current: string, recognized: NoticeInput, maxLength = 2000): NoticeAppend {
  let added: string;
  if (recognized.format === 'fields') {
    const fields = recognized.fields;
    if (!isNoticeValue(fields.item)) return { ok: false, message: '请先核对并填写通知事项' };
    const clip = (value: string) => value.trim().slice(0, 250) || NONE;
    added = `【通知识别（需核对，日期不是已确认的真实 DDL）】事项：${clip(fields.item)}；日期（建议排期）：${clip(fields.date)}；地点：${clip(fields.location)}；提交：${clip(fields.submission)}`;
  } else {
    const raw = recognized.raw.trim();
    if (!raw || raw.length > 2800) return { ok: false, message: '识别原文为空或超过 2800 字，请先修改' };
    added = `【识别原文（请核对，不是确认的截止日）】${raw}`;
  }
  if (containsCrisis([added])) return { ok: false, message: '识别文字包含需要单独处理的高风险内容' };
  const text = [current.trim(), added].filter(Boolean).join('\n');
  if (text.length > maxLength) return { ok: false, message: `目标输入最多 ${maxLength} 字，请先精简识别文字（不会覆盖原来的内容）` };
  return { ok: true, text, added };
}
