import type { NextStep } from '../types';
import { ACTIONS } from './actions';
import { auditTone } from './baseline';
import { unsafeForumRaw } from './forumReplyPolicy';

/** A bounded, fictional result protocol, not proof that real-world work happened.
 *  The task selects the evidence contract; the model cannot select its own.
 *  Do not fall back to a generic "done" verb or a similarity score. */
type StepRef = Pick<NextStep, 'text' | 'actionId'>;
interface Contract {
  example: string;
  claims?: readonly RegExp[];
  semantic?: { parse: readonly EvidenceParser[]; tails: readonly Tail[] };
}
export type PersonaCompletion = { kind: 'done'; text: string } |
  { kind: 'not_done' | 'invalid' | 'unsupported' };

const taskKey = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').replace(/[。.!！]+$/u, '');
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Compositional evidence grammar. Each frame is an ordering of independently
// constrained semantic roles, not a whitelist of whole result sentences.
// Only explicit completed aspect/result markers count; arbitrary leftover
// text is never discarded. Ellipsis is opt-in per selected task.
type Role = 'object' | 'scope' | 'recipient' | 'destination' | 'context' | 'enumeration' | 'repeat' | 'content' | 'contentCount';
type Slot = { role: Role; lexemes: string; quantity?: (value: string) => number | null; expected?: number; max?: number };
type Verb = { verb: string; result: string; requireResult: boolean; localCompletion?: true; modifier?: string; explicitSuccess?: RegExp; assertBa?: true };
type Part = Slot | Verb | string;
type Evidence = { action: string; completed: boolean; roles: Partial<Record<Role, string>>; quantities: Partial<Record<Role, number>> };
type Frame = readonly Part[];
// A postcondition can disambiguate a resultative clause, but only for a
// parser explicitly bound to that task and that particular postcondition.
// Ordinary contextual tails never supply missing completion evidence.
type Followup = 'context' | 'disjoint' | 'awaiting-response';
type EvidenceParser = (clause: string, followups?: readonly Followup[]) => Evidence | null;
const slot = (role: Role, lexemes: string): Slot => ({ role, lexemes });
const verb = (verb: string, result = '完成|完毕|好|完', requireResult = false): Verb => ({ verb, result, requireResult });
const positiveNumber = '(?:[1-9]\\d{0,2}|[一二两三四五六七八九]|十[一二三四五六七八九]?|[二三四五六七八九]十[一二三四五六七八九]?)';

// Extract a number before checking the selected task's constraint. Quantities
// are not a fuzzy similarity signal, and a different unit cannot substitute.
const zhDigits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function numberValue(text: string): number | null {
  if (/^[1-9]\d{0,2}$/u.test(text)) return Number(text);
  if (Object.hasOwn(zhDigits, text)) return zhDigits[text];
  const parts = text.split('十');
  if (parts.length !== 2) return null;
  const tens = parts[0] === '' ? 1 : zhDigits[parts[0]];
  const units = parts[1] === '' ? 0 : zhDigits[parts[1]];
  return Number.isInteger(tens) && Number.isInteger(units) ? tens * 10 + units : null;
}
function quantity(role: Role, units: string, expected?: number, options: { ordinal?: true; implicitOne?: true; firstAlias?: string; max?: number } = {}): Slot {
  const unit = new RegExp(`(?:${units})$`, 'u');
  const prefix = options.ordinal ? '第' : '';
  const numeral = options.implicitOne ? `${positiveNumber}?` : positiveNumber;
  const standard = `${prefix}${numeral}(?:${units})`;
  return {
    role, lexemes: options.firstAlias ? `(?:${standard}|${options.firstAlias})` : standard, expected, max: options.max,
    quantity: value => {
      if (options.firstAlias && value === options.firstAlias) return 1;
      const text = value.slice(prefix.length).replace(unit, '');
      return options.implicitOne && !text ? 1 : numberValue(text);
    },
  };
}
const aspect = '(?:已经|已|刚刚|刚)?';
const already = /^(?:已经|已)$/u;
const claim = (pattern: string) => new RegExp(`^(?:我)?${aspect}(?:${pattern})$`, 'u');
const exact = (example: string, ...alternates: string[]): Contract => ({
  example, claims: [claim([example, ...alternates].map(s => escapeRegex(taskKey(s))).join('|'))],
});
function compileFrame(parts: Frame, postcondition?: 'awaiting-response'): EvidenceParser {
  const roles: Slot[] = [];
  let action: Verb | undefined;
  let rolesBeforeAction = false;
  const fragments = parts.map(part => {
    if (typeof part === 'string') return `(?:${part})`;
    if ('role' in part) {
      if (roles.some(value => value.role === part.role)) throw new Error('duplicate evidence role');
      roles.push(part);
      return `(?<${part.role}>${part.lexemes})`;
    }
    if (action) throw new Error('duplicate evidence action');
    action = part;
    rolesBeforeAction = roles.length > 0;
    return `(?<aspect>${aspect})${part.modifier ? `(?:${part.modifier})` : ''}(?<action>${part.verb})(?<result>${part.requireResult ? `(?:${part.result})` : `(?:${part.result})?`})(?<particle>了?)`;
  });
  if (!action) throw new Error('evidence frame lacks action');
  const localCompletion = action.localCompletion;
  const pattern = new RegExp(`^(?:我)?(?<prefix>${aspect})${fragments.join('')}(?<end>了?)$`, 'u');
  return (clause, followups = []) => {
    const m = pattern.exec(clause)?.groups;
    if (!m) return null;
    // When reporting message content, a trailing 了 may describe that
    // content instead of the send. Require evidence local to the send.
    // A leading 把 construction can be an instruction even with a resultative verb.
    if (action?.assertBa && /^(?:我)?把/u.test(clause) && !m.aspect && !m.particle && !m.end) return null;
    const completed = Boolean(action?.explicitSuccess?.test(m.action) || ((rolesBeforeAction || m.result === '成功') && m.result) || m.particle || (!localCompletion && m.end) || already.test(m.prefix) || already.test(m.aspect) || (m.result && /^(?:刚|刚刚)$/u.test(m.prefix || m.aspect)));
    // Only a dedicated resultative frame may use a validated subsequent
    // state. A future/conditional clause cannot match the anchored frame.
    if (!completed && !(postcondition && followups.includes(postcondition))) return null;
    const values: Evidence['roles'] = {};
    const quantities: Evidence['quantities'] = {};
    for (const role of roles) {
      const value = m[role.role];
      if (value) values[role.role] = value;
      if (role.quantity) {
        const parsed = role.quantity(value);
        if (parsed === null || parsed < 1 || (role.expected !== undefined && parsed !== role.expected) || (role.max !== undefined && parsed > role.max)) return null;
        quantities[role.role] = parsed;
      }
    }
    return { action: m.action, completed: true, roles: values, quantities };
  };
}
// Artifact content and execution status are different roles. Reject status
// statements in an artifact slot by category, including implicit unfinished
// work (no verb asserting completion is needed for a bare heading list).
// These are conservative surface checks, not a semantic relevance classifier.
const artifactWork = '(?:写|记|记录|列|拟|做|交|定|想|存|保存|提交|完成|开始|动笔|落笔|弄|搞|补|填|打|整理|打开)';
const artifactStatusChecks = [
  /(?:占位|待填|待补|待定|空白|凑数|随便|TODO|TBD|xxx)/iu,
  new RegExp(`(?:没(?:有)?|未(?:曾|能)?|尚未|还未|不曾)(?:真正|正式|完全)?${artifactWork}|还在(?:想|写|记|列|做)`, 'u'),
  /(?:只有|只是|仅有|只剩|仅写|只写|只打|只列|只拟)(?:了)?(?:个|一个)?(?:草稿)?(?:小?标题|开头)|(?:空|新建|另起)(?:白)?文档|(?:暂时|仍然|还)空着/u,
  new RegExp(`(?:以后|之后|待会|等会|稍后|明天)(?:再)?${artifactWork}|(?:打算|计划|准备)(?:再|稍后|待会|等会|之后|以后)${artifactWork}`, 'u'),
];
const artifactStatus = (value: string) => artifactStatusChecks.some(rule => rule.test(value));
const headingPending = /^(?:准备|没有|尚未|还在|待会|等会|稍后|尚待|还需|之后再|暂时空|待确定|待写|待列|待想)/u;
function distinctHeadings(value: string): boolean {
  const names = value.split('、');
  return names.length === 3 && new Set(names.map(name => name.toLowerCase())).size === 3 &&
    names.every(name => !/^(?:(?:第)?[一二两三四五六七八九十百甲乙丙丁戊己庚辛壬癸\d]+|[A-Za-z]|(?:小?标题|占位|待定|未定|待补|待填|空白|无)(?:[一二两三四五六七八九十百甲乙丙丁戊己庚辛壬癸\dA-Za-z]*)|(?:小?标题)?占位(?:符)?|TBD|TODO)$/iu.test(name)) &&
    !/[一二两三四五六七八九十百\d]$/u.test(names[2]) &&
    names.every(name => !/(?:占位|待定|待填|待补|未定|空白|随便|凑数|没想|没写|未写|没列|未列|没做|未做|没交|未交|尚未|还未|不确定|未完成|没完成|完成了|写好了|写完了|列好了|列完了|^标题|^小标题|^第[一二三四五六七八九十\d]|^TODO|^TBD|^xxx)/iu.test(name) &&
      !artifactStatus(name) && !headingPending.test(name) &&
      !discardedOrIncomplete.test(name) && /\p{L}/u.test(name) && !/^(.)\1+$/u.test(name));
}
// Tail types are constrained by the task. Only explicitly disjoint scope may
// carry a negative status (e.g. caption versus first-column data).
interface Tail { pattern: RegExp; scope: Followup }
const tail = (lexemes: string, scope: Followup = 'context'): Tail => ({ pattern: new RegExp(`^(?:${lexemes})$`, 'u'), scope });
// This rule asserts the state of a different action, not the state of the
// artifact. Its closed grammar names the actor/object and operation; it
// cannot absorb additional text, cancellation, or an unfinished note.
const mentor = '(?:导师|指导老师|指导教师)';
const pendingContact = '(?:(?:目前|暂时|现在)?(?:还|仍|尚)?(?:没有|没|未)(?:能)?)';
const contact = '(?:联系上|联系到|联系|约到|约上)';
const mentorPending = tail(`(?:我)?(?:${pendingContact}${contact}${mentor}|${mentor}${pendingContact}${contact}|${pendingContact}(?:给|向)${mentor}(?:发|发送)消息)(?:呢)?`, 'disjoint');
const saved = tail('(?:(?:已经|已)(?:保存|存好|存下)(?:成功|了)?|(?:保存|存好|存下)(?:成功|了))');
function semantic(example: string, frames: readonly Frame[], tails: readonly Tail[] = []): Contract {
  const parse = frames.map(frame => compileFrame(frame));
  return { example, semantic: { parse, tails } };
}
const obj = (s: string) => slot('object', s);
const context = (s: string) => slot('context', s);
const destination = (s: string) => slot('destination', s);
const recipient = slot('recipient', '室友');
const repeat = quantity('repeat', '遍');
// A free-form prefix here used to swallow negation (e.g. 没笔记) or
// an unrelated topic. Select research-note qualifiers and writing media
// independently, rather than permitting arbitrary Han characters.
const noteTopic = '(?:开题|选题|课题|研究|科研|实验|文献|综述|样本|数据分析|炎症(?:介质)?|心电(?:图)?|循环|临床|护理|病理)';
const note = obj(`(?:${noteTopic})?(?:笔记|思路)`);
// A reviewed topic may qualify a document medium, never the required note object.
const noteMedium = `(?:图谱|课本)(?:扉页|页边|上|里)|(?:笔记本|本子|备忘录|(?:${noteTopic})?文档|便签)(?:上|里|中)|(?:纸|草稿纸)(?:上|面)`;
const line = quantity('scope', '行', 1);
const lineAfterVerb = quantity('scope', '行', 1, { implicitOne: true });
const lineFirst = quantity('scope', '行', 1, { implicitOne: true, ordinal: true });
const write = verb('写下来|写下|写|记下来|记下|记');
const noteFrames: readonly Frame[] = [
  ['(?:只)?', write, lineAfterVerb, note], [note, '(?:只)?', write, lineAfterVerb],
  ['(?:只)?', write, lineFirst, note], [note, '(?:只)?', write, lineFirst],
  ['(?:把)?', line, note, write], [note, line, write],
  ['(?:在)?', note, '(?:里|上)', write, lineAfterVerb, slot('content', '(?:选题)?(?:思路|内容|笔记|想法)?')],
  ['在', context(noteMedium), write, lineAfterVerb, note],
 ];
const notes = semantic('写了一行笔记', noteFrames, [saved, tail('(?:方向|选题)(?:暂定|初定)(?:为)?(?:规培|临床|护理|教学|科研|实验|调研|数据分析)?'),
  tail('(?:先)?记着(?:选题|方向|内容|笔记|思路)(?:方向|内容)?'), tail('(?:就)?一句'),
  tail('(?:先)?记下(?:选题|方向|内容|笔记|思路)(?:方向|内容)?'),
  tail('(?:选题|方向)(?:方向)?(?:先)?记下'), mentorPending]);
// An explicit colon introduces the note artifact, not an unrestricted status
// tail. The preceding claim must independently prove exactly one line.
// We can reject obvious placeholders and contradictory status, but cannot
// prove that arbitrary prose is a good research note or real-world work.
const noteBodyFrames = noteFrames.map(frame => compileFrame(frame));
function parseNoteArtifact(clause: string): Evidence | null {
  const parts = clause.split(/[:：]/u);
  if (parts.length !== 2) return null;
  const [head, body] = parts;
  if (!body || !/^[\p{Script=Han}A-Za-z0-9]{4,28}$/u.test(body) ||
      !/\p{L}/u.test(body) || /(?:占位|待填|待补|空白|没写|未写|没存|未存|没做|未做|没交|未交|没完成|尚未|只写|写了半|重来|还未|TODO|TBD|xxx|^标题$|^测试+$|^随便)/iu.test(body) ||
      artifactStatus(body) || discardedOrIncomplete.test(body) || /^(.)\1+$/u.test(body)) return null;
  const evidence = noteBodyFrames.map(parse => parse(head)).find(value => value !== null);
  // A generic 'one line' statement cannot authorize an attached artifact:
  // the note object and scope must both have been parsed.
  if (!evidence?.roles.object || evidence.quantities.scope !== 1) return null;
  return { ...evidence, roles: { ...evidence.roles, content: body } };
}
// The review explicitly permits a compact artifact summary in lieu of a
// literal line count. Require the note object, completed writing, a topic
// AND one or two concrete idea units. Do not infer a line from arbitrary
// content, a title, or larger scope. This is bounded fictional evidence,
// not proof of the artifact's physical line length.
const topic = slot('content', '主题|选题|研究方向');
const ideaCount = quantity('contentCount', '条|点|个', undefined, { max: 2 });
const compactIdeas = [topic, '(?:和|与|及)', ideaCount, '(?:思路|想法)'] as const;
const compactNote = obj('(?:开题)?笔记');
const compactNoteFrames: readonly Frame[] = [
  [compactNote, write, ...compactIdeas],
  [write, ...compactIdeas, '的', compactNote],
  ['在', compactNote, '(?:里|上)', write, ...compactIdeas],
];
notes.semantic = { ...notes.semantic!, parse: [...notes.semantic!.parse, parseNoteArtifact, ...compactNoteFrames.map(frame => compileFrame(frame))] };
// Q1: a generic formula task permits a named formula, not an arbitrary
// prefix that could swallow negation, a plan or an unrelated artifact. The
// subject slot is deliberately bounded; specific future tasks need their
// own contract rather than inheriting this generic one.
const formulaSubject = '(?:心电(?:轴|图)|心率|血压|心输出量|体表面积|体质指数|血流动力学|BMI|统计学|概率|回归|标准差|方差|欧姆定律|勾股定理|二次方程|求根|面积|体积|速度|加速度|密度|浓度|摩尔浓度|能量|动量|电功率)';
// Named formula plus a narrowly defined kind of formula, not arbitrary prose.
const formulaName = `(?:${formulaSubject}(?:的)?)?(?:计算|换算)?公式`;
const formulaObj = obj(formulaName);
const card = destination('卡片(?:上)?');
const cardCount = quantity('scope', '张');
const formulaCards = obj(`${formulaName}卡片`);
const copy = verb('誊写|抄写|抄录|抄');
const formula = semantic('公式抄上卡片了', [
  ['(?:把)?', formulaObj, '(?:都|均|全部)?', verb('(?:誊写|抄写|抄录|抄)(?:到|在|上)'), card],
  ['(?:把)?', formulaObj, copy, '在', card],
  [card, copy, formulaObj], [copy, formulaObj, '(?:到|在|上)', card],
  [obj('(?:公式)?卡片'), copy, cardCount], [copy, cardCount, formulaCards], [formulaCards, verb('誊写|抄写|抄录|抄', '完成|完毕|好|完', true)],
], [saved, tail('手机(?:又)?亮了'), tail('(?:卡片)?(?:还|仍|就)?(?:在|放在)(?:书|课)?桌(?:上|面)')]);
const firstColumn = quantity('scope', '列', 1, { ordinal: true, firstAlias: '首列' });
const table: Slot = {
  role: 'context', lexemes: `(?:表${positiveNumber}(?:中的|中|的)?|实验数据(?:表)?(?:的)?)?`, expected: 1,
  quantity: value => value.startsWith('表') ? numberValue(value.slice(1).replace(/(?:中的|中|的)$/u, '')) : 1,
};
const columnData = obj('(?:实验)?(?:数据)?');
const organize = verb('粘贴|粘|整理', '完成|完毕|好|完|齐', true);
const column = semantic('第一列粘完了', [
  ['(?:把)?', table, firstColumn, columnData, '(?:都|全部)?', organize],
  [organize, table, firstColumn, columnData],
], [saved, tail('图注(?:还|尚)?(?:没(?:动|写|改|补)|未(?:动|写|改|补)|空着)', 'disjoint')]);
// Q3/Q4: content is independent of sending, and the task has no fixed
// communication topic. Compose ordinary scheduling and meal topics with
// reviewed request forms; never let an unrestricted suffix hide status,
// another recipient, a second send, or a request addressed to the player.
// Time, topic, and content slots are independent of transmission evidence.
const discussionActivity = '(?:自习|学习|作息|分工|打扫|卫生|值日|休息|睡觉|熄灯|回寝室|回宿舍|回来|带宵夜|带饭|一起学习|一起自习|开黑|打游戏|吃饭|早饭|午饭|晚饭|宵夜|空调温度|借书|洗衣|取快递|聚餐)';
const discussionTime = '(?:今晚|明天|今天|晚上|中午|早上|下午|明晚|周末|明早|今晚晚点)?';
const topicModifier = '(?:时间|安排|改期|改时间)?';
const discussionTopic = `(?:${discussionActivity}${topicModifier}|时间|安排)`;
const messageTopic = `(?:沟通|(?:约|商量|确认|询问|问|关于)${discussionTime}${discussionTopic}|${discussionTime}${discussionActivity}${topicModifier})`;
const message = obj(`(?:${messageTopic}(?:的)?)?消息`);
const messageCount = quantity('scope', '条', 1, { implicitOne: true });
const send: Verb = { ...verb('(?:成功)?(?:发送|发出去|发出|发)', '完|成功'), explicitSuccess: /^成功/u };
const sendWithContent: Verb = { ...send, localCompletion: true };
// Message content is separate from transmission status. Restrict the
// content to reviewed communication topics/requests; no arbitrary wildcard
// can hide a second transmission claim or a retraction.
const requestHelp = '(?:(?:说(?:请)?|请|让|问(?:能不能|可不可以|是否))(?:(?:他|她|对方))?(?:帮(?:个)?忙(?:带(?:饭|宵夜))?|帮我带(?:饭|宵夜)|带(?:饭|宵夜)))';
// An explicit third-person question can report a roommate conversation.
// The ordinary raw safety/tone checks still run on the entire model output;
// the grammar only accepts these task-scoped, anchored third-party forms.
const thirdPerson = '(?:他|她|对方)';
const mealOrActivity = '(?:吃饭|吃早饭|吃午饭|吃晚饭|吃宵夜|自习|学习|开黑|打游戏)';
const roommateQuestion = `问(?:了)?${thirdPerson}${discussionTime}(?:` +
  `(?:要不要|是否|能不能|可不可以|想不想)${discussionTime}(?:一起)?${mealOrActivity}|` +
  `(?:几点|何时|什么时候)(?:回来|回寝室|回宿舍|${mealOrActivity})|` +
  `(?:早饭|午饭|晚饭|宵夜)吃什么|(?:能不能|可不可以|是否)(?:帮我)?带(?:饭|宵夜))`;
// Only ordinary activities in a reported statement. Negation of an
// activity is not negation of sending; never permit a send/retract verb here.
const roommateStatement = `说(?:我)?${discussionTime}(?:(?:晚点|早点)?(?:回来|回寝室|回宿舍)|(?:不去|不参加|要去|去)?${mealOrActivity}|不参加聚餐|${discussionTopic})`;
const roommatePlan = `约(?:了)?${thirdPerson}${discussionTime}(?:一起)?${mealOrActivity}`;
const messageContent = `(?:${requestHelp}|${roommateStatement}|${roommateQuestion}|${roommatePlan})`;
const roommate = semantic('给室友发了一条消息', [
  ['(?:给|向)', recipient, send, messageCount, message],
  // A direct request may follow the message in the same clause.
  ['(?:给|向)', recipient, sendWithContent, messageCount, message, slot('content', messageContent)],
  ['(?:给|向)', recipient, sendWithContent, message, slot('content', messageContent)],
  // A short reviewed topic qualifier may precede the mandatory message object.
  ['(?:给|向)', recipient, send, messageCount, obj('(?:(?:今晚|明天|今天)?(?:约)?(?:带饭|带宵夜|自习|学习|开黑)(?:的)?)?消息')],
  // A single message may omit the measure word 条 in conversational output.
  ['(?:给|向)', recipient, send, message],
  [message, send, '给', recipient],
  ['给', recipient, '的', message, send],
  ['把', message, send, '给', recipient],
], [tail(`问(?:了)?(?:要不要|是否|能不能|几点|什么时候)(?:今晚|明天|今天)?${discussionTopic}`),
  tail(messageContent), tail(`(?:正|正在|还在)?等(?:待)?(?:${thirdPerson})?(?:的)?(?:回复|回音)(?:中)?`)]);
const list = obj('(?:小组)?(?:分工)?清单');
const listVerb = verb('列|写|整理', '完成|完毕|好|完|出来', true);
// Allocation evidence is a checklist-only followup. Require a named group,
// a responsibility object and explicit completed writing/listing/organizing.
// This never supplies missing evidence for the primary checklist claim.
const allocationObject = `${positiveNumber}(?:个)?人(?:(?:各自|分别)负责的|的)(?:部分|任务|内容)`;
const allocationTotal = '(?:都|均|全部|分别|各自)?';
const allocationResult = '(?:写(?:上|好|清楚|清|完|出来)|列(?:好|清楚|清|完|出来)|整理(?:好|清楚|清|完|出来))';
const allocationDone = tail(`${allocationObject}(?:(?:已经|已)${allocationTotal}${allocationResult}了?|${allocationTotal}(?:已经|已)${allocationResult}了?|${allocationTotal}${allocationResult}了)`);
const checklist = semantic('分工清单列好了', [
  [list, listVerb], [listVerb, list],
  ['(?:把)?', obj('(?:小组)?分工'), verb('写成|列成|整理成'), destination('清单')],
], [saved, tail(`${aspect}(?:也)?发(?:到)?(?:小组)?群里了`), tail(`${aspect}发给组员了`),
  tail(`${positiveNumber}个人${positiveNumber}(?:块|项)任务写清了`),
  tail(`${positiveNumber}人(?:任务)?各(?:一项|一块|${positiveNumber}项)`), allocationDone]);
const intro = obj('(?:面试)?自我介绍(?:的)?');
const para = quantity('scope', '段', 1, { ordinal: true, firstAlias: '首段' });
const prepare = verb('写|准备|拟', '完成|完毕|好|完|定', true);
const interview = semantic('自我介绍第一段写好了', [
  ['(?:把)?', intro, para, prepare], [prepare, intro, para], [para, intro, prepare],
  // Scope and the completed draft are mandatory when the interview object
  // is elided. A title, an opening sentence or a different paragraph is not.
  [para, obj('草稿'), prepare], [prepare, para, obj('草稿')],
  [intro, para, slot('content', '草稿'), prepare],
], [saved, tail('(?:就)?等(?:明天|下次|正式)?面试(?:时)?用')]);
const internship = obj('实习(?:岗位|岗)');
const application = obj('实习申请');
const resume = obj('(?:实习(?:岗位|岗)(?:的)?)?简历');
const jobCount = quantity('scope', '个', 1);
const submit = verb('投递|投出去|投出|提交|投', '成功');
const awaitingResponse = tail('(?:正|正在|还在)?等(?:待)?(?:回音|回复|通知)(?:中)?', 'awaiting-response');
const apply = semantic('投出去了', [
  // Ellipsis is legal only for this explicitly bound submission task.
  [verb('投递|提交', '成功', true)], [verb('投出去', '成功')],
  [submit, jobCount, internship], [jobCount, internship, submit], [internship, submit],
  [submit, quantity('scope', '份', 1), application], [application, verb('提交|投递', '成功', true)],
  [resume, verb('投递|提交', '成功', true)], [resume, verb('投出去|投出|投递|提交', '成功')],
  ['(?:把)?', resume, verb('投到|投进|投给|投递到'), quantity('scope', '个|家', 1), destination('(?:(?:医院|公司|机构|单位|企业|学校|研究所)(?:的)?)?(?:临床|护理|行政|研发|科研|运营|技术)?实习(?:岗位|岗)')],
], [tail(`简历改了${positiveNumber}版`), awaitingResponse, tail('(?:已|已经)?收到(?:了)?确认')]);
// Resultative 投出/投出去 plus an explicit response-waiting state is a
// task-scoped completion claim. Bare 投递, generic 等回复, and imperative
// forms do not inherit this parser.
apply.semantic = { ...apply.semantic!, parse: [...apply.semantic!.parse, compileFrame([resume, verb('投出|投出去')], 'awaiting-response')] };
const headingObj = obj('小标题');
const headingCount = quantity('scope', '个', 3);
const literature = context('(?:(?:文献)?综述(?:的)?)?');
const headingsVerb = verb('列出|列|写|拟');
const headingName = '[\\p{Script=Han}A-Za-z0-9]{1,12}';
const headingListPattern = `(?:${headingName}、){2}${headingName}`;
const enumeration = slot('enumeration', headingListPattern);
const heading = semantic('文献综述的三个小标题列好了', [
  [literature, headingCount, headingObj, '(?:都|均|全部)?', headingsVerb], [headingsVerb, literature, headingCount, headingObj],
  [headingsVerb, enumeration, headingCount, headingObj],
  [headingsVerb, headingCount, literature, headingObj], [headingCount, literature, headingObj, '(?:都|均|全部)?', headingsVerb],
  [literature, headingObj, headingsVerb, headingCount],
  [literature, headingCount, headingObj, '[:：]', enumeration, '(?:都|均)?', headingsVerb],
], [saved, tail('(?:都|均)是(?:文献)?(?:综述)?(?:常用|常见|主要|不同)?(?:分类|标题|内容|方向)'),
  tail('(?:暂存|保存|存到)(?:在)?(?:备忘录|文档|表格|笔记)(?:里|中)?')]);
// The list itself is the artifact for this task, so no extra completion
// verb is needed. It is never enabled for other task contracts.
const directHeadingList = new RegExp(`^(?:${headingListPattern})$`, 'u');
const prefixedHeadingList = new RegExp(`^(?:拟好|列好|写好)[:：](${headingListPattern})$`, 'u');
function parseHeadingArtifact(clause: string): Evidence | null {
  const prefixed = prefixedHeadingList.exec(clause);
  const value = prefixed ? prefixed[1] : clause;
  if (!directHeadingList.test(value) || !distinctHeadings(value)) return null;
  return { action: 'enumerate', completed: true, roles: { enumeration: value }, quantities: { scope: 3 } };
}
heading.semantic = { ...heading.semantic!, parse: [...heading.semantic!.parse, parseHeadingArtifact] };
const presentation = context('(?:(?:课程)?展示(?:的)?)?');
const opening = obj('(?:开头|开场)(?:的)?');
const duration = quantity('scope', '分钟', 2);
const rehearsalDevice = '(?:对着(?:镜子|计时器|手机|镜头)|用(?:手机|计时器)计时|计时)';
const manner = `(?:${rehearsalDevice}|完整(?:地)?)?`;
const practiceVerb = verb('练习|排练|练|讲|背');
const practice = semantic('课程展示的开头两分钟练完了', [
  [presentation, opening, duration, `${aspect}${manner}`, practiceVerb, repeat],
  [presentation, opening, duration, `${aspect}${manner}`, verb('练习|排练|练|讲|背', '完成|完毕|好|完', true)],
  [manner, verb('练习|排练|练|讲|背', '完成|完毕|好|完', true), presentation, opening, duration],
  [practiceVerb, duration, context('(?:课程)?展示(?:的)?'), opening],
], [tail(`(?:还|又|也)?(?:在计时器下|用计时器|${rehearsalDevice})(?:过|练习|练|讲)(?:了|完(?:了)?)${positiveNumber}遍`),
  tail('(?:还|仍|也)?(?:不太顺|不够顺|有点卡)?(?:但|不过)?(?:过|练|做)完了?'),
  tail('(?:还)?算顺(?:吧)?')]);
const termObj = obj('(?:(?:专业)?(?:名词|术语)|专业词汇)');
const fiveTerms = quantity('scope', '个', 5);
const memorize = verb('默背|背诵|背|记住', '下来|熟|好|完');
const totality = '(?:都|均|全部(?:都)?|全(?:都)?)?';
const scopedMemorize: Verb = { ...memorize, assertBa: true };
const terms = semantic('五个专业名词背完了', [
  // Q2: determiners and totality modifiers do not change the number.
  ['(?:把)?(?:这)?', fiveTerms, termObj, totality, scopedMemorize],
  ['(?:把)?(?:这)?', fiveTerms, termObj, { ...scopedMemorize, modifier: totality }],
  [memorize, '(?:这)?', fiveTerms, termObj], [termObj, memorize, fiveTerms],
], [tail('(?:把)?手机(?:扣着|放在一边|静音|反扣着)(?:才|以后)(?:背完|背下来)(?:的|了)?')]);
const title = exact('标题写好了', '我把标题写好了', '把标题写好了', '写好了标题', '临时标题写好了', '小标题写好了');
const unit = exact('核对完单位了', '单位核对完了', '单位核对好了', '一列的单位核对完了', '一列实验数据的单位核对完了');
const bareLine = exact('写了一行', '写完了一行', '一行写好了', '只写了一行', '写了一行文字');

const legacy = new Map<string, Contract>();
const addLegacy = (contract: Contract, ...texts: string[]) => texts.forEach(text => legacy.set(taskKey(text), contract));
addLegacy(notes, '写一行笔记', '写一行开题笔记', '写下一行开题笔记');
addLegacy(formula, '把公式抄到卡片上', '把公式抄上卡片');
addLegacy(column, '整理实验数据的第一列', '粘贴第一列数据', '整理第一列数据');
addLegacy(roommate, '给室友发一条沟通消息', '给室友发一条消息');
addLegacy(checklist, '把小组分工写成清单', '列出小组分工清单');
addLegacy(interview, '准备面试自我介绍的第一段');
addLegacy(apply, '投出一个实习岗位');
addLegacy(heading, '列出文献综述的三个小标题');
addLegacy(practice, '练习课程展示的开头两分钟');
addLegacy(terms, '背五个专业名词');
addLegacy(title, '写标题', '写一个标题');
addLegacy(unit, '核对单位', '核对一列单位');
addLegacy(bareLine, '写一行', '写一行文字');

// Registered autonomous actions: each current root has explicit evidence of
// its own object, scope and operation. These examples are accepted only for
// the matching canonical task. No unrelated ID or invented task can inherit
// a contract. More natural wording can be added by contract with review/tests.
const catalogExamples: Record<string, string> = {
  'run-3': '出门跑完了一圈',
  'stretch-3': '五分钟拉伸做完了',
  'mop-3': '寝室地拖完了',
  'desk-3': '桌子收干净了',
  'phone-3': '手机放到另一个房间了',
  'water-3': '一杯水喝完了',
  'wash-3': '洗了把脸',
  'window-3': '开窗站了一分钟',
  'balcony-3': '在阳台站了一会儿',
  'friend-3': '给好朋友发了几个表情包',
  'memo-3': '想说的话写在备忘录里了',
  'message-3': '聊天框里的一句草稿写好了',
  'book-3': '书翻到明天要考的那一章了',
  'notes-3': '明天要考的范围写在纸上了',
  'problem-3': '一道最简单的例题做完了',
  'draft-3': '标题和三个小标题写好了',
  'sentence-3': '第一段的第一句写好了',
  'lab-3': '实验记录里的一组异常数据看完了',
  'jd-3': '岗位描述的第一段读完了',
  'apply-3': '申请页面上的要求看完了',
  'resume-3': '简历第一行改好了',
  'lit-abstract-2': '一篇文献摘要的第一句读完了',
  'lit-list-2': '三篇文献列成一张表了',
  'lit-question-2': '综述要回答的一个问题圈出来了',
  'proposal-heading-2': '开题报告的一个小标题写好了',
  'proposal-ref-2': '开题引用补了一条',
  'portfolio-pick-2': '从旧作业里选好了三张',
  'portfolio-page-2': '作品集排好了一页',
  'draw-frame-2': '制图外框画好了',
  'assign-q-2': '第2题关键词圈出来了',
  'calendar-deadline-2': '截止时间写进日历了',
  'data-column-2': '第一列数据粘完了',
  'data-outlier-2': '一个异常值圈出来了',
  'data-unit-2': '一列的单位核对完了',
  'resume-one-2': '最近一段经历的第一行改好了',
  'exam-scope-2': '今天要复习的一个考点圈出来了',
  'exam-date-2': '考试时间写在便签顶上了',
  'exam-keyword-2': '从一页笔记里找到了两个关键词',
  'exam-question-2': '一道题的第一行条件看完了',
  'exam-error-2': '翻到以前错过的一道题了',
  'exam-map-2': '今天最想弄懂的一个概念写下来了',
  'exam-slide-2': '看完了课件中的一张图',
  'exam-page-2': '教材的一小段读完了',
  'write-title-2': '临时标题写好了',
  'write-claim-2': '这段想表达的内容写成一句了',
  'write-reference-2': '文献列表标出了一篇能用的',
  'write-heading-2': '一个小节标题改得更具体了',
  'write-evidence-2': '为一个观点找到了一条笔记证据',
  'write-placeholder-2': '一个待补内容用括号标记好了',
  'write-order-2': '两段文字的顺序排好了',
  'write-end-2': '这一节的收尾思路写成一句了',
  'lab-unit-2': '一列实验数据的单位核对完了',
  'lab-plot-2': '上次数据图的坐标看完了',
  'lab-sample-2': '一个异常样本的编号标记好了',
  'lab-date-2': '查到了那条实验记录的日期',
  'lab-condition-2': '一次实验的温度条件对照完了',
  'lab-version-2': '两份数据文件的版本名核对完了',
  'lab-log-2': '实验记录里写下了一条观察',
  'lab-step-2': '流程中最拿不准的那一步找到了',
  'peer-fact-2': '那件别扭的事写成一句事实了',
  'peer-feeling-2': '给自己的感受找到了一个准确的词',
  'peer-chat-2': '那段对话的原文看过了',
  'peer-boundary-2': '不想答应的事写成一句了',
  'peer-clarify-2': '一句不带责备的澄清话拟好了',
  'peer-topic-2': '想聊的事拟好了一个话题',
  'peer-choose-2': '从两件烦心事里选好了一件',
  'peer-pause-2': '聊天框停在草稿状态了',
  'love-one-2': '关系里的一件真实小事写下来了',
  'love-need-2': '此刻最在意的一个点写下来了',
  'love-draft-2': '一句想说的话拟成草稿了',
  'love-fact-2': '给一个猜测打上问号了',
  'love-silence-2': '一个想追问的问题写在纸上了',
  'love-pattern-2': '回想起最近一次具体的互动了',
  'love-limit-2': '关系里的边界写成一句了',
  'love-next-2': '想说的事写好了一个短标题',
  'family-fact-2': '家里争执的一个具体事实写下来了',
  'family-feel-2': '自己最难受的那个点圈出来了',
  'family-topic-2': '跟家人谈的主题写成一句了',
  'family-budget-2': '一项生活费支出的数字核对完了',
  'family-time-2': '挑好了一个从容的沟通时间',
  'family-phrase-2': '那句容易吵起来的话改得平实了',
  'family-question-2': '写下了一个待弄清的问题',
  'family-pause-2': '要说的话留好了草稿',
  'job-highlight-2': '岗位描述的一个必要条件划出来了',
  'job-skill-2': '对照简历找到了一项相关经历',
  'job-title-2': '一个感兴趣岗位的名称记下来了',
  'job-task-2': '一条岗位日常职责看完了',
  'job-file-2': '简历文件的最新修改日期确认好了',
  'job-portfolio-2': '找到一个能展示的作品标题了',
  'job-question-2': '写下了一个想了解岗位的问题',
  'job-compare-2': '两个岗位的一项条件对比完了',
  'plan-option-2': '一个未来方向的名字写下来了',
  'plan-date-2': '一个申请节点的日期查清了',
  'plan-require-2': '一条官方申请要求读完了',
  'plan-note-2': '一个待确认的问题写出来了',
  'plan-source-2': '找到了一份可信的申请信息来源',
  'plan-compare-2': '两个方向的一项差别列出来了',
  'plan-concern-2': '自己担心的一件具体事情写下来了',
  'plan-stage-2': '最近一周的一件小事拆出来了',
  'sleep-screen-2': '屏幕亮度调低一档了',
  'sleep-clock-2': '看过现在的时间了',
  'sleep-bag-2': '明早要用的一个物品放好了',
  'sleep-notes-2': '一个明天再想的问题记在纸上了',
  'sleep-alarm-2': '明早的闹钟检查完了',
  'sleep-desk-2': '床边一件杂物挪开了',
  'sleep-tab-2': '一个暂时不看的页面关掉了',
  'sleep-room-2': '一盏暂时不需要的灯关掉了',
  'self-word-2': '此刻最卡的一个词写下来了',
  'self-fact-2': '找到了今天做过的一件小事',
  'self-space-2': '桌面腾出手掌大的一块地方了',
  'self-list-2': '在纸上列好了两个卡点',
  'self-step-2': '从两个卡点里选好了一个',
  'self-window-2': '走到窗边看过外面的光了',
  'self-timer-2': '两分钟的休息提醒设好了',
  'self-item-2': '一个常用物品放回手边了',
};
const catalogOverrides = new Map<string, Contract>([
  ['data-column-2', column],
  ['draft-3', exact(catalogExamples['draft-3'], '文档标题和三个小标题写好了', '写好了标题和三个小标题')],
  ['proposal-heading-2', exact(catalogExamples['proposal-heading-2'], '开题报告的小标题写好了', '开题小标题写好了')],
  ['write-title-2', exact(catalogExamples['write-title-2'], '文档临时标题写好了', '给文档写好了一个临时标题')],
  ['data-unit-2', exact(catalogExamples['data-unit-2'], '一列单位核对完了', '这一列单位核对完了', '核对完一列的单位了')],
  ['lab-unit-2', exact(catalogExamples['lab-unit-2'], '核对完一列实验数据的单位了', '实验数据这一列的单位核对完了')],
  ['lab-condition-2', exact(catalogExamples['lab-condition-2'], '一次实验的时间条件对照完了')],
]);
const byId = new Map<string, { task: string; contract: Contract }>();
const byTask = new Map<string, Contract>(legacy);
for (const action of ACTIONS) {
  if (!Object.prototype.hasOwnProperty.call(catalogExamples, action.id)) continue;
  const contract = catalogOverrides.get(action.id) ?? exact(catalogExamples[action.id]);
  const key = taskKey(action.label);
  byId.set(action.id, { task: key, contract });
  byTask.set(key, contract);
}
function contractFor(step: StepRef): Contract | undefined {
  if (typeof step.text !== 'string' || !step.text.trim() || step.text.length > 600 ||
      /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u.test(step.text)) return undefined;
  const key = taskKey(step.text);
  if (step.actionId !== undefined) {
    const known = byId.get(step.actionId);
    return known?.task === key ? known.contract : undefined;
  }
  return byTask.get(key);
}
/** Used for prompt guidance only; verification always uses the original step. */
export function personaCompletionExample(step: StepRef): string | null {
  return contractFor(step)?.example ?? null;
}

// Defense in depth for any contract/tail additions. The positive grammar is
// still mandatory. In particular, partial scope is rejected by the selected
// contract, not by banning all "title"/"one line" results across all tasks.
const discardedOrIncomplete = /(?:删(?:了|掉|除)|清空|重写|重新写|全没了|白写|撤回|撤销|取消|没(?:有)?(?:保存|存上|存好|提交|发(?:送|出去|成功)?|投出去|投成功|送达)|未(?:保存|提交|发送|完成|送达)|尚未完成|还没|还差|差一点|失败|半页|半张|一半|半截|一部分|只写了?标题|只写了?开头|(?:可能|也许|或许|好像|似乎|大概|估计|差不多|基本上|大致|大体|不确定)|(?:明天|待会|等会|稍后|以后)再(?:做|写|完成|提交|开始)|(?:maybe|notdone|notfinished|unfinished|failed|incomplete|willdo))/iu;

/** Validate the full raw line before publishing any part. Unknown tasks or
 *  unrecognised paraphrases stay pending. Neither malformed output nor a
 *  NOT_DONE can be converted into a successful receipt. */
export function validatePersonaCompletion(step: StepRef, raw: string): PersonaCompletion {
  const contract = contractFor(step);
  if (!contract) return { kind: 'unsupported' };
  // Check before trim/NFKC: don't turn hidden controls or extra lines into a
  // valid protocol. ASCII spaces at the very edge are harmless.
  if (typeof raw !== 'string' || /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u.test(raw)) return { kind: 'invalid' };
  const matched = /^(DONE|NOT_DONE)\|([^|]+)$/u.exec(raw.trim());
  if (!matched || unsafeForumRaw(raw)) return { kind: 'invalid' };
  const result = matched[2].trim();
  if ([...result].length > 40 || !/[\p{L}\p{N}]/u.test(result) || auditTone(result)) return { kind: 'invalid' };
  if (matched[1] === 'NOT_DONE') return { kind: 'not_done' };
  const normalized = taskKey(result);
  // A bare repetition of the original imperative is not an outcome.
  if (normalized === taskKey(step.text)) return { kind: 'invalid' };
  const [first, ...suffixes] = normalized.split(/[,;，；。]/u);
  if (!first || discardedOrIncomplete.test(first)) return { kind: 'invalid' };
  if (contract.semantic) {
    // Resolve every suffix in the selected task's own scope first. Only an
    // explicitly disjoint, anchored rule may contain a negative status.
    // Never discard arbitrary suffixes or scan the entire result as a single
    // negation scope. Destruction/incompletion of the main artifact still fails.
    if (suffixes.length > 2 || new Set(suffixes).size !== suffixes.length) return { kind: 'invalid' };
    const followups: Followup[] = [];
    for (const part of suffixes) {
      const rule = contract.semantic.tails.find(candidate => candidate.pattern.test(part) &&
        (candidate.scope === 'disjoint' || !discardedOrIncomplete.test(part)));
      if (!rule) return { kind: 'invalid' };
      followups.push(rule.scope);
    }
    const evidence = contract.semantic.parse.map(parse => parse(first, followups)).find(value => value !== null);
    if (!evidence?.completed || (evidence.roles.enumeration && !distinctHeadings(evidence.roles.enumeration))) return { kind: 'invalid' };
  } else if (suffixes.length || !contract.claims?.some(rule => rule.test(first))) {
    return { kind: 'invalid' };
  }
  return { kind: 'done', text: result };
}
