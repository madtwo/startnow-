import type { Card, Persona } from '../types';
import { BASELINE } from './baseline';
import { buildPersonaPrompt } from './personas';

export const COMMENT_RULES = `这是小圈子里的互相帮忙，不是客服，也不是心理咨询。评论 40–100 字，1–3 句，允许短到四个字。

这一步只做两件事：问和共情。不要给办法、不要提建议、不要分析、不要总结。
- 先具体：提到对方卡里说的一个词或一个细节。
- 问就只问一句，问完就停；不想问就不问。
- 允许只回一个动作词：「摸摸」「拍拍」「在的」。
- 不用「你应该」「你可以」「试试」「建议」「不如先」「至少……」「会好的」「时间会治愈」「加油」「你已经很棒了」。
- 不用表情符号，不列清单，不加标题。
- 不主动提自己是 AI。`;

export const CARD_RULES = `你要发一张自己的卡，说一件最近卡住的事，不是回别人。

- 30–60 字，一到两句，最多两段。
- 必须落到一个具体锚点：哪门课、几点、在哪、是谁、什么事。锚点只能来自你的背景和「最近发生的事」，不许编造背景里没有的大事实（不能突然换专业、不能突然有重病、不能家人出事）。
- 不贴标签：不写「我很焦虑」「我是 ENFJ」，让细节透出来。
- 不求助、不总结、不给自己讲道理。
- 不用表情符号，不加标题，不写「今天想和大家聊聊」。

输出格式只有一行：
卡片正文|||一句你最近新遇到的小事（没有就写 无）`;

export const ADVICE_DECIDE_RULES = `有人给你出了个主意。你要决定接不接受。

- 大约七成接受，三成拒绝或含糊带过。拒绝必须具体，带自己的难处，不用「抱歉我不能采纳」这种话。
- 如果你觉得这个主意不安全、会让你更糟、或者根本不是你想做的，就拒绝，并自然岔开。
- 输出一行，格式：接受|你说的那句话
  或者：拒绝|你说的那句话
一句话 30 字以内，用你自己的口气。`;

export const DONE_RULES = `你照着一个主意做了。说一句结果，30 字以内。

可以是普通、甚至没用的结果，不要都写成「真有效」。不用「棒」「厉害」这类词。`;

export const systemFor = (persona: Persona, memory: string, rules: string, extra = '') =>
  [BASELINE, extra ? `【作者追加的底线】\n${extra}` : '', buildPersonaPrompt(persona), memory, rules]
    .filter(Boolean)
    .join('\n\n');

const thread = (card: Card) =>
  card.comments
    .map((c) => `${c.authorKind === 'player' ? '卡主' : c.authorId}：${c.text}`)
    .join('\n');

export const commentPrompt = (card: Card) =>
  `卡片：\n"""\n${card.text}\n"""${card.comments.length ? `\n\n已经说过的话：\n${thread(card)}` : ''}

你来留一句。不要重复上面说过的话。`;

export const cardPrompt = (
  recent: string[],
  now: Date,
  weight: 1 | 2 | 3,
  intimacy: number,
) => {
  const time = `${now.getMonth() + 1} 月 ${now.getDate()} 日，${now.getHours()} 点`;
  const level = weight === 1 ? '轻' : weight === 2 ? '中' : '重';
  const hint =
    weight === 1
      ? '日常里的小卡点，说完了也不会伤人。'
      : weight === 2
        ? '已经积了一阵子，有点沉。'
        : '真正压着你的事，但还不到危险的程度。';
  return `现在是 ${time}。你和看卡的人熟悉度 ${intimacy}/100。
这次要说一件「${level}」程度的事：${hint}
${recent.length ? `你最近已经发过这些，不要重复：\n${recent.map((t) => `- ${t}`).join('\n')}\n` : ''}
按格式写一张卡。`;
};

export const decidePrompt = (card: Card, adviceText: string) =>
  `你的卡片：\n"""\n${card.text}\n"""\n\n有人对你说：\n"""\n${adviceText}\n"""\n\n你接受吗？`;

export function cleanLine(text: string, max = 120): string {
  let out = text.trim();
  out = out.replace(/^(好的|嗯，|好的，)?(评论|回复)[:：]\s*/, '');
  const quoted = out.match(/^[“"「]([\s\S]*)[”"」]$/);
  if (quoted) out = quoted[1].trim();
  out = out.replace(/\n{3,}/g, '\n\n');
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}
