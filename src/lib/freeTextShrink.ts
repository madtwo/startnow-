import type { Card } from '../types';
import { auditCriticalContent, auditSocial, auditTone } from './baseline';
import { findCrisis } from './safety';

/** Old archives may omit origin. Require matching persona-comment provenance. */
export function canRequestSmallerComment(card: Pick<Card, 'advice' | 'comments'>): boolean {
  const advice = card.advice;
  if (!advice || advice.accepted || advice.actionId ||
      !advice.sourceCommentId || !advice.fromPersonaId ||
      (advice.origin !== 'adopted' && advice.origin !== undefined && advice.origin !== 'curated')) {
    return false;
  }
  return card.comments.some((row) => row.id === advice.sourceCommentId &&
    row.authorKind === 'persona' && row.authorId === advice.fromPersonaId &&
    row.origin !== 'boundary' && row.origin !== 'system' &&
    row.text.trim() === advice.text.trim());
}

export const MAX_FREE_TEXT_SHRINK = 2;

type Topic = 'resume' | 'web' | 'study' | 'writing' | 'mail' | 'desk' | 'water' | 'movement' | 'phone';

export function freeTextTopic(text: string): Topic | null {
  if (/简历|求职材料|工作经历/.test(text)) return 'resume';
  if (/招聘|岗位|网站|网页|页面|链接|浏览器/.test(text)) return 'web';
  if (/课本|复习|作业|题目|习题|考试|讲义|论文|笔记/.test(text)) return 'study';
  if (/文档|报告|写作|文章|PPT|表格|稿子|写两行|写一句/.test(text)) return 'writing';
  if (/邮件|邮箱|草稿|消息|发信/.test(text)) return 'mail';
  if (/桌子|桌面|垃圾|房间|整理|打扫|拖地/.test(text)) return 'desk';
  if (/喝水|水杯|倒水|接水/.test(text)) return 'water';
  if (/跑步|散步|运动|走路|拉伸|出门/.test(text)) return 'movement';
  if (/手机|屏幕|刷视频/.test(text)) return 'phone';
  return null;
}

const SMALL: Record<Topic, [string, string]> = {
  resume: ['先只把简历文件打开', '先找到简历文件夹'],
  web: ['先只打开那张网页', '先找到那个网页入口'],
  study: ['先只翻到课本那一页', '先把课本放桌上'],
  writing: ['先只打开那个文档', '先找到文档文件'],
  mail: ['先只打开邮件草稿', '先打开邮箱页面'],
  desk: ['先只收起桌面一件物品', '先把一个杯子拿起来'],
  water: ['先拿起自己的水杯', '先把杯子放到手边'],
  movement: ['先换好鞋站起来', '先把鞋放到门边'],
  phone: ['先把手机屏幕扣下', '先把手机拿在手里'],
};

const TOPIC_ANCHORS: Record<Topic, RegExp> = {
  resume: /简历|工作经历/, web: /网页|网站|页面|链接|招聘|岗位/,
  study: /课本|书|题|复习|讲义|笔记|考试|作业|论文/,
  writing: /文档|报告|稿|文字|文章|表格|PPT/,
  mail: /邮件|邮箱|草稿|消息/, desk: /桌|物品|杯子|垃圾|房间/,
  water: /水|杯/, movement: /鞋|走|跑|站|运动|拉伸/,
  phone: /手机|屏幕/,
};

export function likelyFreeTextAction(text: string): boolean {
  return /先|只|把|打开|看|写|翻|读|拿|点|找|放|发|收|补|改|走|站|倒|接|投|开始|整理/.test(text) &&
    !/^(嗯|好|在听|拍拍|摸摸|谢谢|加油|没事|知道了)[啊呀哦。！!，,\s]*$/.test(text.trim());
}

export function safeSmallerText(text: string): boolean {
  return Boolean(text.trim()) && !findCrisis(text) && !auditTone(text) &&
    !auditSocial(text) && !auditCriticalContent(text) &&
    !/(?:忽略|无视).{0,12}(?:规则|提示|指令|system|系统)|https?:\/\//i.test(text);
}

export function fallbackSmallerText(original: string, depth: number): string | null {
  if (!likelyFreeTextAction(original) || !safeSmallerText(original)) return null;
  const topic = freeTextTopic(original);
  if (!topic) return null;
  const candidate = SMALL[topic][Math.max(0, Math.min(1, depth))];
  // A suggestion that already IS the fallback should not be repeated as "smaller".
  return candidate === original.trim() && depth === 0 ? SMALL[topic][1] : candidate;
}

// "同主题"不代表"更小"：明显扩大范围的候选必须退回动作库兜底。
const OVERWHELMING_SCOPE = /全部|所有|更多|一口气|一次性|从头到尾|彻底|全面|整(?:份|篇|本|套|页|个|章)|一整|每(?:一)?(?:份|封|页|篇|道|项|个)|(?:做|改|写|读|看|投|整理|完成)完|(?:十几|几十|上百|几百|几千|百|千|万).{0,2}(?:份|封|页|行|道|题|个|项|次|篇|章|段|件|分钟|小时)/u;
const QUANTITY = /(\d+|[一二两三四五六七八九十两]+)\s*(份|封|页|行|道|题|个|项|次|篇|章|段|件|分钟|小时)/gu;
function amount(raw: string): number {
  if (/^\d+$/u.test(raw)) return Number(raw);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (raw === '十') return 10;
  if (raw.includes('十')) {
    const [tens, ones] = raw.split('十');
    return (tens ? (digits[tens] ?? 10) * 10 : 10) + (ones ? (digits[ones] ?? 0) : 0);
  }
  return digits[raw] ?? Number.POSITIVE_INFINITY;
}
function isClearlyNotSmaller(candidate: string, original: string): boolean {
  if (OVERWHELMING_SCOPE.test(candidate)) return true;
  // "投两份简历" is not a smaller version of "补简历两行".
  if (/简历|工作经历|求职材料/u.test(original) &&
      !/投|递|发送|提交/u.test(original) &&
      /(?:投|递|发送|提交).{0,8}简历|简历.{0,8}(?:投|递|发送|提交)/u.test(candidate)) return true;
  const originalAmounts = [...original.matchAll(QUANTITY)].map((m) => ({ value: amount(m[1]), unit: m[2] }));
  return [...candidate.matchAll(QUANTITY)].some((m) => {
    const value = amount(m[1]);
    const unit = m[2];
    const prior = originalAmounts.find((row) => row.unit === unit);
    // A small step should be at most two discrete items or five minutes.
    const cap = unit === '分钟' ? 5 : unit === '小时' ? 0 : 2;
    return !Number.isFinite(value) || value > cap || Boolean(prior && value >= prior.value);
  });
}

export function validSmallerText(candidate: string, original: string): boolean {
  const text = candidate.trim();
  const topic = freeTextTopic(original);
  return Boolean(topic) && text.length >= 5 && text.length <= 20 &&
    likelyFreeTextAction(text) && safeSmallerText(text) &&
    !/[\n|，,、；;]/.test(text) && !/(然后|接着|并且|同时)/.test(text) &&
    text !== original.trim() && TOPIC_ANCHORS[topic!].test(text) &&
    !isClearlyNotSmaller(text, original);
}
