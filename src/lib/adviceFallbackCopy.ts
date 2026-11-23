import type { ActionItem } from './actions';

/**
 * Player-facing curated wording only. The original action library intentionally
 * contains some first-person examples for other forum paths; do not rewrite it.
 * Each entry was checked against its fixed action label, minutes and smaller
 * step. A missing override leaves the original authored text unchanged.
 * This table never changes action IDs, matching, cooldowns or deduplication.
 */
type Wording = Partial<Pick<ActionItem, 'line' | 'alternateLine'>>;
export const ADVICE_PLAYER_COPY: Readonly<Record<string, Readonly<Wording>>> = {
  // Standalone older chains (these have a single primary line).
  'run-3': { line: '要不先出去跑一小圈，回来再看刚才卡住的事。' },
  'stretch-3': { line: '先在书桌边做五分钟简单拉伸，别给自己太多要求。' },
  'mop-3': { line: '先把寝室的地拖一遍，做完再决定下一步。' },
  'desk-3': { line: '先收一收桌面，不用一次整理到完全干净。' },
  'phone-3': { line: '先把手机放到另一个房间，暂时离它远一点。' },
  'water-3': { line: '要不先去倒一杯水，慢慢喝完再说。' },
  'wash-3': { line: '先去洗把脸，回来再看看想做哪一件。' },
  'window-3': { line: '先把窗户打开，站一分钟看看外面。' },
  'balcony-3': { line: '如果阳台安全方便，可以先去站一小会儿。' },
  'friend-3': { line: '如果愿意，先给熟悉的朋友发一个表情包就好。' },
  'message-3': { line: '先把想说的话写进聊天框里，暂时不用发送。' },
  'book-3': { line: '先把书翻到要考的那一章，暂时不看别的。' },
  'notes-3': { line: '先把要考的范围写在纸上，没写全也没关系。' },
  'problem-3': { line: '先挑一道相对简单的例题做，做完再看下一道。' },
  'draft-3': { line: '先打开文档，写标题和三个小标题，正文先不碰。' },
  'sentence-3': { line: '先给第一段写一句很粗糙的开头，写完再改。' },
  'jd-3': { line: '先打开收藏的一份岗位描述，只读第一段。' },
  'apply-3': { line: '先打开一个岗位的申请页面，只看要求，不用投。' },

  // Two independently reviewed wording slots per expanded action.
  'lit-question-2': { alternateLine: '先写下综述最想回答的一个问题，不急着找答案。' },
  'proposal-ref-2': { alternateLine: '先在开题报告里补一条引用的作者和年份。' },
  'portfolio-page-2': { alternateLine: '先排一页作品集，只放一张主图和标题。' },
  'draw-frame-2': { alternateLine: '先画出图框和外轮廓，暂时别管细节。' },
  'calendar-deadline-2': { alternateLine: '先把确定的截止日期写进日历，不排整套计划。' },
  'data-column-2': { alternateLine: '先建一个空白表格，只粘第一列数据。' },
  'data-outlier-2': { alternateLine: '先在数据表里圈出一个异常值，暂时不解释。' },
  'resume-one-2': { alternateLine: '先只改简历里最近那段经历的第一行。' },
  'exam-keyword-2': { alternateLine: '先从一页笔记里标出两个词，不用马上背。' },
  'exam-question-2': { alternateLine: '先读清题干的第一行条件，暂时不用求解。' },
  'exam-error-2': { alternateLine: '先翻到一页旧错题，看清当时错在哪里。' },
  'exam-slide-2': { line: '先看课件里的单张图，读明白标题就行。' },
  'exam-page-2': { alternateLine: '先翻到教材的一小段文字，只读这一段。' },
  'write-title-2': { alternateLine: '先给文档写一个临时标题，写得普通也没关系。' },
  'write-claim-2': { alternateLine: '先用大白话写一句这段到底要说什么。' },
  'write-heading-2': { line: '先只改一个小节标题，让它更具体一点。' },
  'write-evidence-2': { alternateLine: '先从笔记里找出一条能支持这个观点的资料。' },
  'write-placeholder-2': { line: '写不动的地方先留一个「待补」标记，不用现在填。' },
  'write-order-2': { line: '先调整这两段的前后顺序，不着急润色。' },
  'write-end-2': { alternateLine: '先写一句粗糙的收尾草稿，不用写得漂亮。' },
  'lab-unit-2': { line: '先核对一列实验数据的单位，别急着重做实验。' },
  'lab-plot-2': { alternateLine: '先核对图表横纵坐标写了什么，不解释结果。' },
  'lab-condition-2': { alternateLine: '先看这次实验的温度或时间条件，挑一项核对。' },
  'lab-version-2': { alternateLine: '先核对两份数据文件名里的版本信息。' },
  'lab-log-2': { alternateLine: '先把观察到的一个现象记下来，不急着解释。' },
  'lab-step-2': { alternateLine: '先标出实验流程里最需要核查的一步。' },
  'peer-fact-2': { alternateLine: '先记下一件确实发生过的事，不猜对方意思。' },
  'peer-feeling-2': { alternateLine: '先在纸上写一个最贴近当下感受的词。' },
  'peer-chat-2': { alternateLine: '先把聊天记录翻到那句话，看清原文写的是什么。' },
  'peer-topic-2': { alternateLine: '先把想谈的主题写成五六个字，不急着说出口。' },
  'peer-choose-2': { alternateLine: '先圈出两件烦心事里更想说清楚的那一件。' },
  'peer-pause-2': { alternateLine: '先把想说的留在输入框里，不用立刻发出去。' },
  'love-next-2': { alternateLine: '先用五个字左右给想谈的事起个短标题。' },
  'family-fact-2': { alternateLine: '先写下家里争执中确实发生的一句话。' },
  'family-feel-2': { alternateLine: '先写一个最能说明这次难受的词。' },
  'family-topic-2': { alternateLine: '先用一句草稿写清想和家人谈的主题。' },
  'family-budget-2': { line: '如果卡在生活费上，先核对一项明确的支出。' },
  'family-time-2': { alternateLine: '先记下一个自己相对不赶的沟通时段。' },
  'family-phrase-2': { line: '先把一句容易让家人误会的话改得具体些。' },
  'family-question-2': { alternateLine: '先写下一个家里还没弄清的问题，之后再决定问不问。' },
  'family-pause-2': { alternateLine: '先把想解释的话留在备忘录里，不用发送。' },
  'job-highlight-2': { alternateLine: '先标出一条岗位描述里的必要条件。' },
  'job-skill-2': { alternateLine: '先核对简历里一项和岗位有关的经历，不用重写。' },
  'job-title-2': { alternateLine: '先只记下一个感兴趣的岗位名称。' },
  'job-task-2': { alternateLine: '先看这份工作的一条日常职责，别一次看太多。' },
  'job-file-2': { alternateLine: '先核对简历文件最后修改的日期。' },
  'job-portfolio-2': { alternateLine: '先确认一件想展示的作品叫什么。' },
  'job-question-2': { alternateLine: '先把一条看不懂的岗位要求写成问题。' },
  'job-compare-2': { alternateLine: '先只比较两个岗位的工作地点或时间。' },
  'plan-option-2': { alternateLine: '先给一个想考虑的未来方向写下具体名字。' },
  'plan-date-2': { alternateLine: '先查清一个申请节点的日期，别凭印象填。' },
  'plan-require-2': { alternateLine: '先从官方说明里找出一条申请条件。' },
  'plan-source-2': { alternateLine: '先核实申请信息的来源，再考虑下一步。' },
  'plan-compare-2': { alternateLine: '先只比两个方向的一项差别，不急着决定。' },
  'plan-concern-2': { alternateLine: '先写下一个具体顾虑，别急着解决。' },
  'plan-stage-2': { alternateLine: '先写一个这周能开始核对的小问题。' },
  'sleep-screen-2': { line: '先把屏幕亮度调低一格，不用马上逼自己睡着。' },
  'sleep-clock-2': { alternateLine: '先看看现在的时间，再决定要不要继续忙。' },
  'sleep-bag-2': { alternateLine: '先收好明早要用的一件物品。' },
  'sleep-notes-2': { alternateLine: '先在纸上留一句明天再处理的事。' },
  'sleep-alarm-2': { alternateLine: '先核对明早的闹钟有没有设置好。' },
  'sleep-desk-2': { alternateLine: '先把床边一件杂物收走，不用收拾整个房间。' },
  'sleep-tab-2': { line: '先关掉一个不打算继续看的标签页。' },
  'sleep-room-2': { alternateLine: '先关掉一盏暂时不需要的灯。' },
  'self-word-2': { alternateLine: '先记下一个最贴近此刻感受的词。' },
  'self-fact-2': { alternateLine: '先写下今天已经做过的一件小事。' },
  'self-list-2': { alternateLine: '先把现在卡住的两件事写在纸上。' },
  'self-step-2': { alternateLine: '先圈出两个卡点里相对容易碰的一件。' },
  'self-window-2': { line: '先离开座位，走到窗边看看外面。' },
  'self-timer-2': { alternateLine: '先设一个两分钟提醒，别额外排一串计划。' },
  'self-item-2': { alternateLine: '先把一件伸手就能用的东西放回手边。' },
};

export function playerFacingAdviceAction<T extends Pick<ActionItem, 'id' | 'line' | 'alternateLine'>>(action: T): T {
  const edited = ADVICE_PLAYER_COPY[action.id];
  return edited ? { ...action, ...edited } : action;
}

export function playerFacingPreferredLine(
  original: Pick<ActionItem, 'id' | 'line' | 'alternateLine'>,
  preferred: string,
): string {
  const edited = playerFacingAdviceAction(original);
  if (preferred === original.line) return edited.line;
  if (preferred === original.alternateLine) return edited.alternateLine || edited.line;
  // Unknown preference must not be allowed to circumvent the reviewed copy.
  return edited.line;
}
