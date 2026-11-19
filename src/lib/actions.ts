import type { Card, TroubleKind } from '../types';

export type ActionCategory = 'body' | 'room' | 'self' | 'move' | 'people' | 'study' | 'future';

export interface ActionItem {
  id: string;
  label: string;
  minutes: number;
  category: ActionCategory;
  topics: TroubleKind[];
  variant?: 'study-exam' | 'study-writing' | 'study-lab' | 'future-job' | 'future-plan' | 'self-sleep';
  /** Safe alternate phrasing for the same executable action. */
  alternateLine?: string;
  lateNight: boolean;
  smaller?: string;
  line: string;
}

const UNIVERSAL: TroubleKind[] = ['study', 'people', 'love', 'family', 'self', 'future'];

const chain = (
  prefix: string,
  topics: TroubleKind[],
  rows: { label: string; minutes: number; lateNight: boolean; line: string }[],
  variant?: ActionItem['variant'],
): ActionItem[] =>
  rows.map((row, i) => ({
    id: `${prefix}-${rows.length - i}`,
    label: row.label,
    minutes: row.minutes,
    category: 'self' as ActionCategory,
    topics,
    variant,
    lateNight: row.lateNight,
    smaller: i < rows.length - 1 ? `${prefix}-${rows.length - i - 1}` : undefined,
    line: row.line,
  }));

const withCategory = (rows: ActionItem[], category: ActionCategory) =>
  rows.map((row) => ({ ...row, category }));

// Theme-specific, low-pressure options. Each root has a genuinely smaller child
// and two independently authored phrasings; no new package or model required.
type ExpansionRow = readonly [id: string, label: string, minutes: number, line: string, alternate: string, smaller: string];

const expandActions = (
  topics: TroubleKind[], category: ActionCategory, rows: readonly ExpansionRow[], variant?: ActionItem['variant'],
): ActionItem[] => rows.flatMap(([id, label, minutes, line, alternate, smaller]) => [
  {
    id: `${id}-2`, label, minutes, category, topics, variant, lateNight: true,
    smaller: `${id}-1`, line, alternateLine: alternate,
  },
  {
    id: `${id}-1`, label: smaller, minutes: 1, category, topics, variant, lateNight: true,
    line: `那先${smaller}，做到这儿就停。`,
    alternateLine: `先只做一件事：${smaller}。`,
  },
]);

const EXPANDED_ACTIONS: ActionItem[] = [
  ...expandActions(['study'], 'study', [
    ['exam-scope', '圈出今天要复习的一个考点', 3, '我会先圈出一个考点，别一下想着整门课。', '先从考试范围里找一个小考点，圈起来就好。', '打开考试范围那一页'],
    ['exam-date', '把考试时间写在便签顶上', 1, '我会先把考试几点写在纸上，别的先不想。', '先把考试时间记下来，至少不用反复猜日期。', '找到考试通知'],
    ['exam-keyword', '从一页笔记里找出两个关键词', 3, '先看一页笔记，划两个关键词就停。', '我会只标出两个词，不要求现在背下来。', '打开一页笔记'],
    ['exam-question', '看一道题的第一行条件', 2, '先读一道题的第一行条件，不急着解。', '我会先弄清楚题目开头写了什么。', '找到一道题'],
    ['exam-error', '翻到以前错过的一道题', 2, '先找到一道旧错题，看一眼错在哪儿。', '我会翻到以前做错的那页，今天先别重做。', '打开旧错题本'],
    ['exam-map', '写下今天最想弄懂的一个概念', 3, '先把最模糊的那个概念写成几个字。', '不用列所有知识点，只记下最想弄明白的一个。', '拿出一张空纸'],
    ['exam-slide', '看课件中的一张图', 2, '我先看课件里一张图，别整套往下翻。', '先找到一张图读明白标题就行。', '打开课件文件'],
    ['exam-page', '读教材的一小段', 3, '先只读教材一小段，读完就算。', '我会翻到一段文字，看看它到底在讲什么。', '翻开教材到任意一页'],
  ], 'study-exam'),
  ...expandActions(['study'], 'study', [
    ['write-title', '给文档写一个临时标题', 2, '先给文档写个很普通的临时标题。', '标题可以很难看，我会先写上去再说。', '打开要写的文档'],
    ['write-claim', '写一句这段想表达什么', 4, '先写一句「这一段想说什么」，不用像论文。', '我会用大白话写一句这一段的意思。', '找到要写的那个小节'],
    ['write-reference', '在文献列表标出一篇能用的', 3, '文献不用全看，先标出一篇相关的。', '先挑出一篇看起来用得上的来源。', '打开文献列表'],
    ['write-heading', '把一个小节标题改得更具体', 3, '我会先把一个小标题写清楚一点。', '别改整篇，只改一个小节的名字。', '找到一个小节标题'],
    ['write-evidence', '为一个观点找一条笔记证据', 5, '先给一个观点找一条笔记就够。', '我会把能支持这一句的资料圈出来。', '打开已有的笔记'],
    ['write-placeholder', '用括号标记一个待补内容', 1, '写不动时我会先留个「待补」标记。', '先用括号写清楚这里缺什么，不用马上补。', '找到文档里空着的一处'],
    ['write-order', '给两段文字排一下顺序', 4, '我先决定这两段谁放前面，不润色。', '试着把两段顺序换一下看看。', '找到要调整的一段'],
    ['write-end', '写一句这一节准备怎么收尾', 4, '先写一句很粗糙的收尾话。', '我会先留一句结尾草稿，不急着写漂亮。', '找到这一节最后一行'],
  ], 'study-writing'),
  ...expandActions(['study'], 'study', [
    ['lab-unit', '核对一列实验数据的单位', 3, '我会先检查一列数据的单位有没有写错。', '先看单位是否一致，暂时不重做实验。', '打开数据表找到单位列'],
    ['lab-plot', '打开上次的数据图只看坐标', 3, '先看图的横纵坐标写了什么。', '我会先确认图轴，别急着解释异常值。', '找到那张数据图'],
    ['lab-sample', '标记一个异常样本的编号', 2, '先记下一个异常样本的编号。', '我会先把那条异常数据定位出来。', '打开样本编号列表'],
    ['lab-date', '查一条实验记录的日期', 2, '先找到那次实验是哪天做的。', '只核对一次记录的日期，不要翻全部。', '打开实验记录索引'],
    ['lab-condition', '对照一次实验的温度或时间条件', 4, '先比对一次实验条件，不需要立刻找原因。', '我会先看那次实验的温度或时间字段。', '找到那次实验条件表'],
    ['lab-version', '核对两份数据文件的版本名', 3, '先看看两份数据是不是同一版本。', '我会先读文件名里的版本信息。', '找到两份数据文件'],
    ['lab-log', '在实验记录里写一条观察', 4, '先写一句你确实看到的现象，不用解释。', '我会把一个观察结果记下来，先不推结论。', '在实验记录里写一句观察'],
    ['lab-step', '找到流程中最不确定的那一步', 3, '先把实验流程里不确定的一步圈出来。', '我会只标记一处需要核查的步骤。', '在流程文档里圈出不确定的一步'],
  ], 'study-lab'),
  ...expandActions(['people'], 'people', [
    ['peer-fact', '把一件让你别扭的事写成一句事实', 3, '先写一句发生了什么，不猜别人用意。', '我会只记下一件已经发生的事。', '在备忘录写一句发生了什么'],
    ['peer-feeling', '给自己的感受取一个准确的词', 2, '先找一个词说说自己到底哪里不舒服。', '我会在纸上写一个最接近的感受词。', '在纸上写一个感受词（如「累」）'],
    ['peer-chat', '看一眼那段对话的原文', 3, '先看聊天里那一句原话，不推测语气。', '我会先把对话翻到那句话，看清楚写了什么。', '找到那段对话'],
    ['peer-boundary', '写一句自己不想答应的事', 3, '可以先写下一个你不愿意做的点。', '我会先弄清楚自己要守住哪条界限。', '写下自己不想答应的一件事'],
    ['peer-clarify', '拟一句不带责备的澄清话', 4, '先打一句想核实事实的话，暂时不发送。', '我会先在草稿里写一句平实的澄清。', '在草稿框写一句想核实的话'],
    ['peer-topic', '给想聊的事拟一个话题', 3, '先想好一句开头，不必马上说出口。', '我会先把想谈的主题写成五六个字。', '写下想聊的关键词'],
    ['peer-choose', '从两件烦心事里选一件先说', 3, '不用一次讲完两件事，先挑一件。', '我会先圈出最需要说清的一件。', '列出两件事的名字'],
    ['peer-pause', '让聊天框暂时停在草稿状态', 1, '先把想说的留在草稿里，不用现在发送。', '我会先让消息停在输入框里。', '在草稿框写一句想核实的话'],
  ]),
  ...expandActions(['love'], 'people', [
    ['love-one', '写下一件关系里确实发生的事', 3, '先写一件真实发生的事，暂时别推结论。', '我会先把那件事本身记下来。', '在备忘录写一件发生过的事'],
    ['love-need', '写下自己此刻最在意的一个点', 3, '先找出现在最在意的一件小事。', '我会只写一个自己在乎的点。', '在纸上写一个最在意的点'],
    ['love-draft', '拟一句想说的话但先不发送', 4, '先把话打出来，不用急着发。', '我会先留一句草稿，发不发以后再定。', '在草稿框写一句想核实的话'],
    ['love-fact', '给一个猜测打上问号', 2, '先区分一件事是事实还是猜测。', '我会在一个没证据的想法后面写问号。', '找到一个让你反复想的猜测'],
    ['love-silence', '把一个想追问的问题写在纸上', 3, '先把想问的那件事记下来。', '我会先写问题，不急着要求回复。', '在纸上写下想问的那句'],
    ['love-pattern', '回忆最近一次具体的互动', 3, '先回忆最近一次真正发生的对话。', '我会只看一段实际的互动内容。', '找到最近一段对话'],
    ['love-limit', '写一句关系里自己的边界', 3, '先替自己写一句不愿意接受的事。', '我会先把自己能接受的范围想清楚。', '写下边界的一个关键词'],
    ['love-next', '给自己想说的事写一个短标题', 2, '先给这件事起个小标题，别想整段话。', '我会先用五个字写清楚要谈什么。', '在备忘录写五个字的小标题'],
  ]),
  ...expandActions(['family'], 'people', [
    ['family-fact', '写下这次家里争执的一个具体事实', 3, '先记下争执里确实发生的一句话。', '我会先写事实，不替谁推测动机。', '在备忘录写一件发生过的事'],
    ['family-feel', '圈出自己最难受的那个点', 3, '不用把整件家事讲完，先圈出一处难受。', '我会先写下这次最难受的一个词。', '写下这次最难受的一个词'],
    ['family-topic', '写一句想跟家人谈的主题', 3, '先把想谈的主题写清楚，不急着开口。', '我会先写一句「我想说的是……」。', '在草稿写一句「我想说的是…」'],
    ['family-budget', '核对一项生活费支出的数字', 3, '如果卡在钱上，我会先核对一笔账。', '先看一个明确的金额，别一下算整个月。', '打开收支记录'],
    ['family-time', '挑一个自己相对从容的沟通时间', 2, '先想想自己什么时间比较能说清话。', '我会先写下一个不太赶的时段。', '看一眼自己的日程'],
    ['family-phrase', '把一句容易吵起来的话改得平实', 4, '我会先改一句容易让人误会的话。', '先把一句想说的话写得具体一点。', '打开那句草稿'],
    ['family-question', '写下一个还不清楚的问题', 3, '先把没弄清的地方写成一个问题。', '我会先留一个问号，之后再决定要不要问。', '写下一个疑问词'],
    ['family-pause', '给尚未发送的话留一个草稿', 1, '先存一句没想好的话，不必马上解释。', '我会把想说的留在备忘录里。', '打开草稿页'],
  ]),
  ...expandActions(['future'], 'future', [
    ['job-highlight', '划出一个岗位描述的必要条件', 3, '先看一个岗位的必要条件，划出其中一条。', '我会只标记岗位要求里的一个词。', '打开那份岗位描述'],
    ['job-skill', '对照简历找到一项相关经历', 4, '先找出简历里能对应这份岗位的一项经历。', '我会只核对一项经历，不重写简历。', '打开自己的简历'],
    ['job-title', '把一个感兴趣岗位的名称记下来', 2, '先记下一个岗位名字，今天不必申请。', '我会先只留一个岗位标题。', '打开招聘页面'],
    ['job-task', '看一条岗位日常职责', 3, '先读一条岗位职责，别一口气刷十个岗位。', '我会只看这份工作的一项具体任务。', '打开岗位职责部分'],
    ['job-file', '确认简历文件的最新修改日期', 2, '先看看简历上次是什么时候改的。', '我会只核对简历文件的日期。', '找到简历文件'],
    ['job-portfolio', '找到一个能展示的作品标题', 3, '先从作品里找一个标题，不急着做整套展示。', '我会先确认一个作品的名字。', '打开自己的作品列表'],
    ['job-question', '写一个想了解岗位的问题', 3, '先写一句想了解岗位的地方，不用发出去。', '我会先列出一个看不明白的要求。', '在纸上写一个问题'],
    ['job-compare', '只对比两个岗位的一项条件', 5, '先选一项条件比较两个岗位。', '我会先比一下两个岗位的工作地点或时间。', '打开其中一份岗位描述'],
  ], 'future-job'),
  ...expandActions(['future'], 'future', [
    ['plan-option', '写下一个未来方向的名字', 2, '先写下一个想考虑的方向，不用决定。', '我会先给那个方向起个具体名字。', '在便签写下一个方向的名字'],
    ['plan-date', '查清一个申请节点的日期', 3, '先确认一个重要截止日期，暂时不排整张计划。', '我会先把那个申请节点的日期核实。', '找到对应通知'],
    ['plan-require', '只读一条官方申请要求', 3, '先读一条申请要求，不必看完全部。', '我会先找出官方说明中的一个条件。', '打开官方要求页面'],
    ['plan-note', '写出一个尚未确定的问题', 3, '先把不确定的地方写成一句问题。', '我会先记下一个还没想明白的点。', '在规划笔记里写一句没想明白的点'],
    ['plan-source', '找一份可信的申请信息来源', 4, '先找到一个官方页面或学校通知。', '我会先核实信息来自哪里，不急着行动。', '打开学校或官方入口'],
    ['plan-compare', '列出两个方向的一项差别', 4, '先写下两个方向最明显的一处不同。', '我会只比较一个维度，别一下做最终选择。', '写下两个方向名称'],
    ['plan-concern', '写下一件自己担心的具体事情', 3, '先把担心的事写清楚成一句话。', '我会先记录一个具体顾虑。', '在便签写下一个担心的词'],
    ['plan-stage', '把计划拆成最近一周的一件小事', 5, '先想清楚这周能查哪一个信息。', '我会只写一个这周可开始的小问题。', '打开日历看本周'],
  ], 'future-plan'),
  ...expandActions(['self'], 'self', [
    ['sleep-screen', '把屏幕亮度调低一档', 1, '我会先把屏幕亮度调暗一格。', '先让手机不那么亮，别要求自己立刻睡着。', '把亮度调低一格'],
    ['sleep-clock', '看一眼现在的时间', 1, '先确认现在几点，不给自己设必须睡着的期限。', '我会先看一下时钟再决定下一步。', '看一眼屏幕上的时间'],
    ['sleep-bag', '把明早要用的一个物品放好', 2, '先把明早要带的一个东西放到门口。', '我会先收好明早要用的一件物品。', '找到明早要用的一件物品'],
    ['sleep-notes', '在纸上记下一个明天再想的问题', 2, '先记下一个可以留给明天的问题。', '我会写一句明天再处理的事。', '在纸上写一句明天再处理的事'],
    ['sleep-alarm', '检查明早的闹钟是否已设置', 1, '只确认闹钟有没有设好。', '我会先检查闹钟，不再来回猜有没有开。', '看到明早的闹钟时间'],
    ['sleep-desk', '把床边一件杂物挪开', 1, '先把床边一个碍事的东西放好。', '我会只收走床边一件杂物。', '找到床边一件小物品'],
    ['sleep-tab', '关掉一个暂时不看的页面', 1, '我会先关掉一个不打算继续看的标签页。', '先少留一个页面，今晚不用清空全部。', '选中一个没在用的标签页'],
    ['sleep-room', '关掉一盏暂时不需要的灯', 1, '先关一盏不需要的灯就行。', '我会先让房间少一盏亮着的灯。', '走到灯的开关旁'],
  ], 'self-sleep'),
  ...expandActions(['self'], 'self', [
    ['self-word', '写下此刻最卡的一个词', 2, '先用一个词给这股难受起个名字。', '我会先记下一个最接近自己感受的词。', '在便签写下最接近的感受（如「累」）'],
    ['self-fact', '找出今天已经做过的一件小事', 2, '先回忆今天确实做过的一件小事。', '我会先写下一个已经发生的事实。', '写下今天做过的一件小事'],
    ['self-space', '腾出桌面上手掌大的一块地方', 3, '只收出手掌大的一块桌面。', '先留出一小块空处，不用整理整张桌子。', '挪开桌面上的一个东西'],
    ['self-list', '在纸上列出两个卡点', 3, '先写两个现在卡住的点，先别解决。', '我会先把脑子里打架的两件事列出来。', '在纸上写两个卡点'],
    ['self-step', '从两个卡点里选一个先处理', 3, '先挑一个最容易碰的卡点。', '我会先圈出一件最容易碰的事。', '把其中一个卡点圈出来'],
    ['self-window', '走到窗边看一眼外面的光', 2, '我会先离开座位看看窗外。', '先看看窗外是什么光线，别急着改变心情。', '站起来面向窗户'],
    ['self-timer', '设一个两分钟的休息提醒', 1, '先给自己设一个两分钟提醒。', '我会先设好两分钟，别给自己塞一串计划。', '打开计时器'],
    ['self-item', '把一个常用物品放回手边', 2, '先把自己要用的那一件东西摆好。', '我会先整理一个伸手就能碰到的物品。', '找到一个常用物品'],
  ]),
];

export const ACTIONS: ActionItem[] = [
  ...withCategory(
    chain('run', UNIVERSAL, [
      {
        label: '出门跑一圈',
        minutes: 15,
        lateNight: false,
        line: '我卡住的时候一般会出门跑一圈，跑完脑子会空一点。',
      },
      { label: '下楼走到路口', minutes: 5, lateNight: false, line: '跑不动就下楼走到路口，走到那儿再说。' },
      { label: '换上鞋站到门口', minutes: 1, lateNight: false, line: '实在不想动，就先换上鞋站到门口。' },
    ]),
    'body',
  ),
  ...withCategory(
    chain('stretch', UNIVERSAL, [
      {
        label: '做五分钟拉伸',
        minutes: 5,
        lateNight: true,
        line: '我会在书桌边随便拉两下，肩膀松了人就没那么拧。',
      },
      { label: '站起来转两下脖子', minutes: 1, lateNight: true, line: '先站起来转两下脖子，就两下。' },
      { label: '从椅子上站起来', minutes: 1, lateNight: true, line: '别的都别管，先从椅子上站起来。' },
    ]),
    'body',
  ),
  ...withCategory(
    chain('mop', UNIVERSAL, [
      {
        label: '把寝室地拖了',
        minutes: 15,
        lateNight: true,
        line: '我卡住的时候一般会去把地拖了，拖完反而想干别的。',
      },
      { label: '只拖桌子底下', minutes: 5, lateNight: true, line: '那就只拖桌子底下，一小块就行。' },
      { label: '把拖把拿出来', minutes: 1, lateNight: true, line: '那就先把拖把拿出来，放那儿也算。' },
    ]),
    'room',
  ),
  ...withCategory(
    chain('desk', UNIVERSAL, [
      {
        label: '把桌子收干净',
        minutes: 10,
        lateNight: true,
        line: '我会先把桌子收了，桌面一空，人就不那么堵。',
      },
      { label: '只把面前的杯子收走', minutes: 1, lateNight: true, line: '那就先收一个杯子，就一个。' },
      {
        label: '把一只手边的垃圾扔掉',
        minutes: 1,
        lateNight: true,
        line: '那就把一只手边的垃圾扔掉，别的不用管。',
      },
    ]),
    'room',
  ),
  ...withCategory(
    chain('phone', UNIVERSAL, [
      {
        label: '把手机放到另一个房间',
        minutes: 1,
        lateNight: true,
        line: '我会把手机放到另一个房间，看不见就好了。',
      },
      { label: '把手机放到桌子另一头', minutes: 1, lateNight: true, line: '那就把手机放桌子另一头，够不着就行。' },
      { label: '把手机屏幕扣过去', minutes: 1, lateNight: true, line: '那就先把手机扣过去，屏幕朝下。' },
    ]),
    'room',
  ),
  ...withCategory(
    chain('water', UNIVERSAL, [
      { label: '倒一杯水慢慢喝完', minutes: 5, lateNight: true, line: '我卡着的时候会先去倒杯水，慢慢喝完。' },
      { label: '去接一杯水', minutes: 1, lateNight: true, line: '那就去接一杯水，喝不喝都行。' },
      { label: '把水杯拿到手边', minutes: 1, lateNight: true, line: '那就把水杯拿到手边，先拿到就行。' },
    ]),
    'self',
  ),
  ...withCategory(
    chain('wash', UNIVERSAL, [
      { label: '去洗把脸', minutes: 5, lateNight: true, line: '我会去洗把脸，凉水一激，人就醒一点。' },
      { label: '用凉水冲一下手腕', minutes: 1, lateNight: true, line: '那就用凉水冲一下手腕，十秒。' },
      { label: '站起来走到洗手池前', minutes: 1, lateNight: true, line: '那就先走到洗手池前面，到了再说。' },
    ]),
    'self',
  ),
  ...withCategory(
    chain('window', UNIVERSAL, [
      { label: '开窗站一分钟', minutes: 1, lateNight: true, line: '我会开窗站一分钟，吹吹风。' },
      { label: '把窗户打开', minutes: 1, lateNight: true, line: '那就只把窗户打开。' },
      { label: '站起来走到窗边', minutes: 1, lateNight: true, line: '那就先站起来走到窗边。' },
    ]),
    'move',
  ),
  ...withCategory(
    chain('balcony', UNIVERSAL, [
      {
        label: '去阳台站一会儿',
        minutes: 5,
        lateNight: true,
        line: '我卡住的时候会去阳台站一会儿，看看楼下的灯。',
      },
      { label: '从这间屋子走出去', minutes: 1, lateNight: true, line: '那就先从这间屋子走出去。' },
      { label: '站起来走到门口', minutes: 1, lateNight: true, line: '那就先站起来，走到门口。' },
    ]),
    'move',
  ),
  ...withCategory(
    chain('friend', ['people'], [
      {
        label: '给好朋友发几个表情包',
        minutes: 1,
        lateNight: true,
        line: '我会给朋友发几个没意义的表情包，他回来骂我一句我就好点。',
      },
      { label: '在聊天框里打一个「在吗」', minutes: 1, lateNight: true, line: '那就先在聊天框里打一个「在吗」，发不发都行。' },
      { label: '打开聊天框', minutes: 1, lateNight: true, line: '那就先把聊天框打开。' },
    ]),
    'people',
  ),
  ...withCategory(
    chain('memo', ['people', 'love', 'family'], [
      {
        label: '把想说的话写在备忘录里，先不发',
        minutes: 1,
        lateNight: true,
        line: '我会先把想说的话写在备忘录里，发不发再说。',
      },
      { label: '在备忘录里写一句想说的话', minutes: 1, lateNight: true, line: '那就先在备忘录里写一句想说的话，写一半也行。' },
      { label: '解锁手机，打开备忘录', minutes: 1, lateNight: true, line: '那就先解锁手机，点开备忘录，写一句就行。' },
    ]),
    'people',
  ),
  ...withCategory(
    chain('message', ['people', 'love', 'family'], [
      {
        label: '在聊天框里打一句想说的话，先不发',
        minutes: 1,
        lateNight: true,
        line: '我会先把想说的话打在聊天框里，发不发再说。',
      },
      { label: '在聊天框里找到上次那句话', minutes: 1, lateNight: true, line: '那就先把那个人的聊天框翻到上次那句话，不用打字。' },
      { label: '看一眼那个人的头像，不打字', minutes: 1, lateNight: true, line: '那就先找到那个人的头像，点开看一眼，不打字。' },
    ]),
    'people',
  ),
  ...withCategory(
    chain('book', ['study'], [
      {
        label: '把书翻到明天要考的那一章',
        minutes: 5,
        lateNight: true,
        line: '我复习不进去的时候，会先把书翻到要考的那一章，别的不看。',
      },
      { label: '只把书翻开', minutes: 1, lateNight: true, line: '那就先只把书翻开，翻到哪页算哪页。' },
      { label: '把书从包里拿出来', minutes: 1, lateNight: true, line: '那就先把书从包里拿出来，放桌上。' },
    ], 'study-exam'),
    'study',
  ),
  ...withCategory(
    chain('notes', ['study'], [
      {
        label: '把明天要考的范围写在纸上',
        minutes: 5,
        lateNight: true,
        line: '我会先把要考的范围写在纸上，写不完整也没事。',
      },
      { label: '拿出一张纸', minutes: 1, lateNight: true, line: '那就先拿出一张纸，放在书旁边。' },
      { label: '把笔记本翻开', minutes: 1, lateNight: true, line: '那就先把笔记本翻开，空白的也行。' },
    ], 'study-exam'),
    'study',
  ),
  ...withCategory(
    chain('problem', ['study'], [
      {
        label: '只做一道最简单的例题',
        minutes: 5,
        lateNight: true,
        line: '我会先挑一道最简单的例题做，做完再看下一道。',
      },
      { label: '把例题的题干读一遍', minutes: 1, lateNight: true, line: '那先把例题的题干读一遍，不用做。' },
      { label: '翻开到例题那一页', minutes: 1, lateNight: true, line: '那就先翻到例题那页，看一行也行。' },
    ], 'study-exam'),
    'study',
  ),
  ...withCategory(
    chain('draft', ['study'], [
      {
        label: '把文档打开，只写标题和三个小标题',
        minutes: 5,
        lateNight: true,
        line: '我会先把文档打开，只写标题和三个小标题，正文先不管。',
      },
      { label: '只打开文档', minutes: 1, lateNight: true, line: '那就先只把文档打开，别的不管。' },
      { label: '找到那个文档', minutes: 1, lateNight: true, line: '那就先找到那个文档，放在桌面上。' },
    ], 'study-writing'),
    'study',
  ),
  ...withCategory(
    chain('sentence', ['study'], [
      {
        label: '只写第一段的第一句',
        minutes: 5,
        lateNight: true,
        line: '我会先写一句最丑的开头，写完再改。',
      },
      {
        label: '在文档里打一行字',
        minutes: 1,
        lateNight: true,
        line: '那就在文档里随便打一行字，写完再删也行。',
      },
      {
        label: '把光标放到正文第一行',
        minutes: 1,
        lateNight: true,
        line: '那就先把光标放到正文第一行。',
      },
    ], 'study-writing'),
    'study',
  ),
  ...withCategory(
    chain('lab', ['study'], [
      {
        label: '打开实验记录，只看一组异常数据',
        minutes: 5,
        lateNight: true,
        line: '先打开实验记录，只看一组异常数据，不要求立刻解决。',
      },
      { label: '只找到上次实验的数据文件', minutes: 1, lateNight: true, line: '先找到上次实验的数据文件，别急着重跑。' },
      { label: '把实验记录文件名写下来', minutes: 1, lateNight: true, line: '先记下实验记录的文件名，这一步就够。' },
    ], 'study-lab'),
    'study',
  ),
  ...withCategory(
    chain('jd', ['future'], [
      {
        label: '把收藏的岗位描述打开，只读第一段',
        minutes: 5,
        lateNight: true,
        line: '我会先把收藏的岗位描述打开，只读第一段，读完就关。',
      },
      { label: '只把那份岗位描述找出来', minutes: 1, lateNight: true, line: '那就先把那份岗位描述找出来，不用读。' },
      { label: '打开招聘软件', minutes: 1, lateNight: true, line: '那就先把招聘软件打开，看一眼就退。' },
    ], 'future-job'),
    'future',
  ),
  ...withCategory(
    chain('apply', ['future'], [
      {
        label: '打开一个岗位的申请页面，只看要求',
        minutes: 5,
        lateNight: true,
        line: '我会先打开一个岗位的申请页面，只看要求，不投。',
      },
      { label: '把想投的岗位收藏到一个文件夹', minutes: 1, lateNight: true, line: '那就先把想投的岗位收藏起来，不投也行。' },
      { label: '打开招聘软件', minutes: 1, lateNight: true, line: '那就先把招聘软件打开，看一眼就退。' },
    ], 'future-job'),
    'future',
  ),
  ...withCategory(
    chain('resume', ['future'], [
      {
        label: '打开简历，只改第一行',
        minutes: 5,
        lateNight: true,
        line: '我会把简历打开，只改第一行，改完就停。',
      },
      { label: '把简历文件打开', minutes: 1, lateNight: true, line: '那就先把简历文件打开，别的不管。' },
      { label: '找到简历文件', minutes: 1, lateNight: true, line: '那就先找到简历文件，放在桌面上。' },
    ], 'future-job'),
    'future',
  ),
  ...EXPANDED_ACTIONS,
];

export const actionMap: Record<string, ActionItem> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a]),
);

export const actionLabel = (id: string) => actionMap[id]?.label ?? '一件小事';
export const actionMinutes = (id: string) => actionMap[id]?.minutes ?? 5;
export const smallerAction = (id: string) => {
  const next = actionMap[id]?.smaller;
  return next ? actionMap[next] : undefined;
};

const smallerIds = new Set(ACTIONS.map((a) => a.smaller).filter(Boolean) as string[]);

const RULES: [TroubleKind, RegExp][] = [
  [
    'future',
    /(简历|面试|校招|秋招|春招|实习|求职|招聘|投递|岗位|offer|考研|考公|保研|出国|申请|毕业|职业|规划|面经)/i,
  ],
  [
    'study',
    /(考试|小测|期末|期中|复习|背书|背不|论文|开题|报告|作业|实验|课程|上课|绩点|挂科|公式|题目|例题|高数|英语|四六级|ddl|截止|答辩|文献)/i,
  ],
  ['love', /(喜欢|表白|恋爱|分手|前任|暧昧|对象|男友|女友|约会|crush|感情|结婚|回消息|等消息)/i],
  [
    'family',
    /(家里|爸妈|父母|妈妈|爸爸|哥哥|弟弟|姐姐|妹妹|奶奶|爷爷|姥姥|姥爷|亲戚|回家|生活费|原生家庭)/i,
  ],
  [
    'people',
    /(室友|朋友|同学|宿舍|社交|社团|导师|老师|同事|孤立|尴尬|聊天|回复|人际|闹掰|冷战)/i,
  ],
  [
    'self',
    /(焦虑|难受|烦|崩|哭|累|睡不着|失眠|睡眠|熬夜|入睡|没力气|不想动|拖延|手机|刷|内耗|自卑|害怕|空|情绪)/i,
  ],
];

export function inferTrouble(text: string, fallback: TroubleKind = 'self'): TroubleKind {
  const hit = RULES.find(([, rule]) => rule.test(text));
  return hit?.[0] ?? fallback;
}

/** Normalize equivalent preset advice without conflating different actions. */
export const normalizeActionText = (text: string): string =>
  text.toLowerCase().replace(/[\s，。、！？；：“”‘’「」（）()!?,.;:·]/gu, '')
    .replace(/^(?:那就|我会|可以|你可以|先|只|就)/u, '');

export interface RecentAction { id?: string; text?: string }

/** Preserve the action identity: phrasings vary, but this is still one action. */
export function actionLineOptions(action: Pick<ActionItem, 'id' | 'label' | 'line'> & Partial<Pick<ActionItem, 'alternateLine'>>): readonly string[] {
  return [action.line, action.alternateLine ?? `先做${action.label}，做到这一步就够了。`];
}

/** Keep logs of prior curated *comments*, not only pinned advice. */
export function recentActionUses(
  cards: readonly Card[], now: number, exceptId?: string,
): RecentAction[] {
  const day = 86_400_000;
  return cards.flatMap((card) => {
    if (card.id === exceptId) return [];
    const rows: RecentAction[] = [];
    if (card.advice && card.advice.at >= now - day && card.advice.at <= now) {
      rows.push({ id: card.advice.actionId, text: card.advice.text });
    }
    for (const comment of card.comments) {
      if ((comment.origin === 'curated' || (!comment.origin && comment.actionId)) &&
          comment.at >= now - day && comment.at <= now) {
        rows.push({ id: comment.actionId, text: comment.text });
      }
    }
    return rows;
  });
}

/** Deterministic per card; avoids a separate random call or persistent index. */
export function selectActionLine(action: Pick<ActionItem, 'id' | 'label' | 'line'> & Partial<Pick<ActionItem, 'alternateLine'>>, contextId = ''): string {
  // Do not rewrite the wording of existing persisted action IDs.
  if (!action.alternateLine) return action.line;
  const lines = actionLineOptions(action);
  let hash = 0;
  for (const char of `${contextId}:${action.id}`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return lines[(hash >>> 0) % lines.length];
}

const shuffle = <T,>(rows: T[]): T[] => {
  const rest = [...rows];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return rest;
};


/**
 * High-confidence micro-situation routing. The broad TroubleKind alone is not
 * enough: “roommate gaming all night” is not an exam exercise, and formatting
 * a report is not the same as drafting a paragraph.  Unsupported intents
 * deliberately abstain rather than guess. Do not feed this matcher model text
 * or trust it as a safety classifier: normal submission guards still apply.
 */
export type ActionTheme =
  | 'report' | 'presentation' | 'dorm-noise' | 'sleep' | 'group-work'
  | 'expense' | 'reference' | 'paper-start' | 'experiment' | 'exam'
  | 'internship' | 'future' | 'family-call' | 'romance-message'
  | 'club-hesitation' | 'early-class';

export interface ActionIntent {
  id: string;
  theme: ActionTheme;
  topic: TroubleKind;
  actionIds: readonly string[];
}

/** Public, stable evaluation labels; never inferred from a broad TroubleKind. */
const intentThemes: Record<string, ActionTheme> = {
  'report-format': 'report', 'document-format': 'report', 'report-content': 'report',
  'resume-format': 'internship', 'class-stage-fright': 'presentation',
  'presentation': 'presentation', 'competition-anxiety': 'future',
  'roommate-sleep': 'dorm-noise', sleep: 'sleep', 'group-work': 'group-work',
  budget: 'expense', lab: 'experiment', 'paper-references': 'reference',
  'writing-start': 'paper-start', exam: 'exam', 'internship-resume': 'internship',
  'future-decision': 'future', 'family-call': 'family-call', 'family-call-priority': 'family-call',
  'romance-message': 'romance-message', 'send-message': 'romance-message',
  'club-boundary': 'club-hesitation', 'early-class': 'early-class',
};

const actionIntentRules: ReadonlyArray<{
  id: string; topic: TroubleKind; matches: (text: string) => boolean; actionIds: readonly string[];
}> = [  // High-specificity conditions precede generic exam, future and social rules.
  { id: 'early-class', topic: 'self',
    matches: text => /(早八|早课|明早上课|早上.{0,12}上课|第一节课|赶课).{0,30}(起不来|怕迟到|来不及|爬不起来|睡过头|赶不上|闹钟)|(?:起不来|怕迟到|睡过头|闹钟).{0,30}(早八|早课|第一节课)/u.test(text),
    actionIds: ['sleep-alarm-2','sleep-bag-2','sleep-desk-2'] },
  { id: 'group-work', topic: 'people',
    matches: text => /(小组|同组|组员|队友|课程组队|组队|分组|组长|小组作业).{0,38}(不分工|没人|不干|拖累|分工|缺人|拉群|踢皮球|截止|作业|汇报|沟通|不回)|(?:分工|拉群|组队|小组作业).{0,38}(小组|组员|同学|截止|没人|进度|合作)/u.test(text),
    actionIds: ['peer-clarify-2','peer-fact-2','peer-topic-2','peer-boundary-2'] },
  { id: 'presentation', topic: 'study',
    matches: text => /(汇报|演讲|上台|展示|答辩|课堂发言|PPT|ppt|讲台).{0,45}(紧张|害怕|脑子.{0,8}空白|不会讲|不知道怎么说|卡壳|开口|准备|练习|发抖)|(?:紧张|害怕|发抖|开不了口|脑子空白).{0,35}(上台|汇报|演讲|答辩|课堂发言)/iu.test(text),
    actionIds: [] }, // No safe performance-specific preset yet: ask which part is hardest.
  { id: 'report-content', topic: 'study',
    matches: text => /(课程报告|实验报告|报告|汇报稿|结题报告).{0,35}(开头|正文|没写|写不出|第一段|草稿|摘要|结构)|(?:写不出|第一段|开头).{0,25}(报告|汇报稿)/u.test(text),
    actionIds: ['write-heading-2','write-claim-2','write-title-2','draft-3'] },
  // A call/conflict with family outranks the topic being discussed; a bare
  // "they asked whether I'll take the exam" is a future decision.
  { id: 'family-call-priority', topic: 'family',
    matches: text => /(妈妈|爸爸|爸妈|家人|家里人|父母|我妈|我爸).{0,50}(催|争执|吵架|沟通|回话)|(?:给妈妈|给爸爸|跟父母).{0,25}(打电话|回电话|发消息)/u.test(text),
    actionIds: ['family-topic-2','family-phrase-2','family-feel-2','family-question-2'] },
  { id: 'future-decision', topic: 'future',
    matches: text => /(考研|考公|保研|出国|转专业|未来方向|专业方向|职业规划|申请节点|选方向)/u.test(text),
    actionIds: ['plan-option-2','plan-note-2','plan-concern-2','plan-compare-2','plan-stage-2','plan-date-2'] },
  { id: 'document-format', topic: 'study',
    matches: text => /(课程设计|报告|论文|参考文献|文档).{0,35}(编号|字号|行距|页码|排版|格式|对不齐|顺序对不上)|(?:编号|字号|行距|页码|排版).{0,24}(报告|文档|论文|参考文献)/u.test(text),
    actionIds: [] }, // No format-repair action exists yet; ask instead.
  { id: 'resume-format', topic: 'future',
    matches: text => /简历.{0,35}(行距|字号|对齐|格式|排版|字体)|(?:行距|字号|对齐|排版).{0,25}简历/u.test(text),
    actionIds: [] },
  { id: 'class-stage-fright', topic: 'study',
    matches: text => /(?:被点名|点名|点到|上台|汇报|公开汇报).{0,50}(发抖|手抖|手.{0,3}抖|手心出汗|脑子.{0,8}空白|害怕|紧张)|(?:发抖|手抖|手心出汗).{0,35}(点名|汇报|上台)/u.test(text),
    actionIds: [] },
  { id: 'competition-anxiety', topic: 'future',
    matches: text => /(比赛|竞赛|报名).{0,35}(拖累|水平不够|害怕|不敢|怕自己)/u.test(text),
    actionIds: [] },
  { id: 'roommate-sleep', topic: 'people',
    matches: text => /(室友|宿舍|隔壁床).{0,55}(打游戏|外放|半夜|凌晨|吵|噪音|睡不着|键盘声|说话声)|(?:打游戏|外放|半夜|凌晨|噪音|键盘声).{0,40}(室友|宿舍|隔壁床)/u.test(text),
    actionIds: ['peer-clarify-2', 'peer-topic-2', 'peer-boundary-2'] },
  { id: 'sleep', topic: 'self',
    matches: text => /(睡不着|失眠|睡眠|熬夜|入睡|睡前.{0,35}(刷|手机)|凌晨.{0,12}才困|半夜.{0,12}醒)/u.test(text),
    actionIds: ['sleep-screen-2','sleep-notes-2','sleep-room-2','sleep-tab-2','sleep-clock-2','sleep-alarm-2','sleep-desk-2','sleep-bag-2'] },
  { id: 'group-work', topic: 'people',
    matches: text => /(小组|同组|组员|队友).{0,35}(作业|没人|不干|拖累|ddl|截止|分工)|(?:小组作业).{0,35}(周末|ddl)/iu.test(text),
    actionIds: ['peer-clarify-2','peer-topic-2','peer-boundary-2','peer-fact-2'] },
  { id: 'budget', topic: 'family',
    matches: text => /(生活费|饭钱|兼职|排班|收支|预算|钱不够)/u.test(text),
    actionIds: ['family-budget-2','family-question-2','family-fact-2'] },
  { id: 'lab', topic: 'study',
    matches: text => /(实验|异常值|实验数据|仪器|样本|测量|拟合|跑数据)/u.test(text),
    actionIds: ['lab-unit-2','lab-plot-2','lab-sample-2','lab-condition-2','lab-version-2','lab-log-2','lab-step-2'] },
  { id: 'paper-references', topic: 'study',
    matches: text => /(参考文献|引用来源|文献列表|文献笔记|(?:论文|文献|报告).{0,40}(文献|引用|资料没整理|资料还没整理)|(?:文献|引用).{0,30}(论文|整理|没看))/u.test(text),
    actionIds: ['write-reference-2','write-placeholder-2','write-evidence-2'] },
  // "想先写一句消息草稿" is about a person, not about paper writing.
  { id: 'romance-message', topic: 'love',
    matches: text => /(喜欢|恋爱|暧昧|前任|对象|已读不回|约会|表白|crush|感情)/iu.test(text),
    actionIds: ['love-draft-2','love-fact-2','love-silence-2','love-pattern-2','love-need-2'] },
  { id: 'writing-start', topic: 'study',
    matches: text => /(论文|报告|文档|开头|第一段|写不出来|一个字|稿)/u.test(text),
    actionIds: ['write-title-2','write-claim-2','write-placeholder-2','write-heading-2','draft-3','write-reference-2'] },
  { id: 'exam', topic: 'study',
    matches: text => /(考试|期末|期中|复习|病理|背书|背完|课堂|笔记|高数|例题|刷题|考点)/u.test(text),
    actionIds: ['exam-scope-2','exam-keyword-2','exam-question-2','exam-error-2','exam-map-2','exam-slide-2','exam-page-2','exam-date-2'] },
  { id: 'internship-resume', topic: 'future',
    matches: text => /(简历|实习|招聘|岗位|投递|面试|求职|找工作)/u.test(text),
    actionIds: ['resume-3','job-skill-2','job-file-2','job-title-2','job-task-2','job-question-2'] },
  { id: 'family-call', topic: 'family',
    matches: text => /(妈妈|爸爸|爸妈|家人|家里人|父母|家里).{0,35}(电话|问我|争执|吵架|说挺好|催|沟通)|(?:电话).{0,20}(妈妈|家里|爸妈)/u.test(text),
    actionIds: ['family-feel-2','family-topic-2','family-phrase-2','family-pause-2','family-question-2'] },
  { id: 'club-boundary', topic: 'people',
    matches: text => /(社团|活动).{0,35}(不想去|答应|不愿|借口|纠结|拒绝|不敢说|怕得罪)/u.test(text),
    actionIds: ['peer-boundary-2','peer-clarify-2','peer-topic-2','peer-fact-2'] },
  // Generic fallbacks stay last: they keep everyday cards from abstaining, but
  // never override the specific scenes above.
  { id: 'send-message', topic: 'people',
    matches: text => /(消息.{0,20}(打了又删|没发|想发|发不出去)|聊天框|想说的话.{0,20}(没发|写不出))/u.test(text),
    actionIds: ['peer-pause-2','peer-topic-2','peer-clarify-2','peer-fact-2'] },
  { id: 'peer-conversation', topic: 'people',
    matches: text => /(室友|同学|朋友|聊天|人际|关系|社交|社团|同事|和别人说话)/u.test(text),
    actionIds: ['peer-clarify-2','peer-topic-2','peer-fact-2','peer-boundary-2','peer-feeling-2'] },
  { id: 'self-overwhelm', topic: 'self',
    matches: text => /(焦虑|心烦|不想动|拖延|卡住|内耗|没有力气|没力气)/u.test(text),
    actionIds: ['self-word-2','self-fact-2','self-list-2','self-step-2','self-space-2','self-window-2'] },

];

export function matchActionIntent(text: string): ActionIntent | null {
  const normalized = text.replace(/\s+/g, ' ').slice(0, 450);
  if (!normalized.trim()) return null;
  const match = actionIntentRules.find(rule => rule.matches(normalized));
  return match ? { id: match.id, theme: intentThemes[match.id], topic: match.topic, actionIds: match.actionIds } : null;
}

/** Dice score of Chinese character bigrams; heuristic, not a semantic judge. */
export function actionTextSimilarity(left: string, right: string): number {
  const clean = (text: string) => normalizeActionText(text)
    .replace(/^(?:我会先|我会|先把|那就先|先|可以先|先做这个)/u, '')
    .replace(/(?:做到这一步就够了|做完再看下一步|别的先不想|别管后面|先不发)$/u, '');
  const a = [...clean(left)]; const b = [...clean(right)];
  if (a.length < 6 || b.length < 6) return 0;
  const bag = (chars: string[]) => {
    const out = new Map<string, number>();
    for (let i = 0; i < chars.length - 1; i++) {
      const pair = chars[i] + chars[i + 1];
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };
  const aa = bag(a), bb = bag(b);
  let common = 0;
  for (const [gram, qty] of aa) common += Math.min(qty, bb.get(gram) ?? 0);
  return (2 * common) / (a.length + b.length - 2);
}

export function pickActions(
  hour: number,
  count = 3,
  trouble?: TroubleKind,
  text = '',
  recentActions: readonly RecentAction[] = [],
): ActionItem[] {
  const night = hour >= 23 || hour < 6;
  const intent = matchActionIntent(text);
  // Unsupported concrete requests should lead to a clarification, never a
  // random preset from a broad category (e.g. formatting -> resume advice).
  if (text.trim() && !intent) return []; // Unknown specific card: ask instead of guessing.
  if (intent && !intent.actionIds.length) return [];
  const effectiveTrouble = intent?.topic ?? trouble;
  const allowed = intent ? new Set(intent.actionIds) : undefined;
  const lab = /实验数据|异常值|重跑|复测|仪器|样本|测量|拟合|代码|程序|跑数据|实验结果/.test(text);
  const writing = /论文|开题|报告|文档|写不出|写东西|一个字|稿/.test(text);
  const studyVariant: ActionItem['variant'] = lab ? 'study-lab' : writing ? 'study-writing' : 'study-exam';
  const sleeping = /睡不着|失眠|睡眠|熬夜|入睡|半夜|睡前|早醒/.test(text);
  const futureJob = !text.trim() || /简历|实习|校招|秋招|春招|求职|招聘|投递|岗位|面试|offer|工作|找工/.test(text);
  const usedIds = new Set(recentActions.map((row) => row.id).filter(Boolean));
  const usedText = recentActions.map((row) => normalizeActionText(row.text ?? '')).filter(Boolean);
  const alreadyUsed = (phrase: string) => {
    const normalized = normalizeActionText(phrase);
    // A direct-advice comment can wrap the same label with persona-specific text.
    return normalized.length > 3 && usedText.some((row) =>
      row === normalized || row.includes(normalized) ||
      actionTextSimilarity(row, phrase) >= 0.72);
  };
  const eligible = (a: ActionItem) =>
    !smallerIds.has(a.id) && (night ? a.lateNight : true) &&
    (!effectiveTrouble || a.topics.includes(effectiveTrouble)) &&
    (!allowed || allowed.has(a.id)) &&
    // Prefer a genuine topic match, not an unrelated generic suggestion.
    (!effectiveTrouble || a.topics.length < UNIVERSAL.length) &&
    (Boolean(allowed) || effectiveTrouble !== 'study' || a.variant === studyVariant) &&
    (Boolean(allowed) || effectiveTrouble !== 'self' || (sleeping ? a.variant === 'self-sleep' : a.variant !== 'self-sleep')) &&
    (Boolean(allowed) || effectiveTrouble !== 'future' || (futureJob
      ? a.variant !== 'future-plan'
      : a.variant === 'future-plan')) &&
    !usedIds.has(a.id) && !alreadyUsed(a.label) &&
    !actionLineOptions(a).some(alreadyUsed);
  const matching = ACTIONS.filter(eligible);
  // A concrete request about starting a paper has a known, proven next step.
  // Keep it available in the shortlist, then rotate everything else normally.
  const priority = trouble === 'study' && studyVariant === 'study-writing' &&
    /论文.*(?:开头|写不出|一个字)|开头.*卡/.test(text)
    ? matching.find((row) => row.id === 'draft-3') : undefined;
  const pool = priority ? matching.filter((row) => row.id !== priority.id) : matching;
  const ordered = allowed
    ? [...pool].sort((a, b) => (intent?.actionIds.indexOf(a.id) ?? 0) - (intent?.actionIds.indexOf(b.id) ?? 0))
    : shuffle(pool);
  return [...(priority ? [priority] : []), ...ordered].slice(0, Math.max(0, count));
}
