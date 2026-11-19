import type {
  Archetype,
  Gender,
  Persona,
  PersonaSituation,
  TroubleKind,
} from '../types';

/* ------------------------------------------------------------------ *
 * 随机人设：名字、学校、专业、年级、性格都是现拼的，不是从固定池里抽。
 * 处境由「专业 × 年级 × 当下时间」推算，按天刷新。
 * ------------------------------------------------------------------ */

const SURNAMES = [
  '陈', '林', '黄', '张', '李', '王', '吴', '周', '徐', '孙',
  '马', '朱', '胡', '郭', '何', '高', '罗', '郑', '梁', '谢',
  '宋', '唐', '许', '韩', '冯', '邓', '曹', '彭', '曾', '萧',
];

const GIVEN_MALE = [
  '一鸣', '子航', '嘉树', '思远', '文轩', '亦然', '知远', '明澈', '行舟', '照野',
  '临安', '牧之', '清和', '言川', '少游', '见山', '怀瑾', '南星', '伯庸', '景行',
  '砚舟', '听澜', '归鹤', '长风', '斯年', '之遥', '容与', '拾光', '寻溪', '峤',
];

const GIVEN_FEMALE = [
  '晚星', '云舒', '知夏', '若初', '疏影', '阿棠', '雨眠', '语冰', '听雪', '暮云',
  '南乔', '小满', '朝颜', '忘忧', '栖迟', '清圆', '砚青', '令仪', '幼薇', '宛央',
  '星野', '眠眠', '素心', '临溪', '予安', '青梧', '浅予', '未晞', '照水', '迟月',
];

const PLACES = [
  '临南', '白鹭', '云溪', '钱塘', '青川', '东澜', '岭西', '沧南', '南屿', '水华',
  '定京', '河洛', '汉东', '江照', '归德', '陇西', '湘北', '淮安', '南陵', '望川',
];

const SCHOOL_SUFFIX = ['大学', '学院'];
const COHORTS = ['大一', '大二', '大三', '大四'];

const W = (
  study: number,
  people: number,
  love: number,
  family: number,
  self: number,
  future: number,
): Record<TroubleKind, number> => ({ study, people, love, family, self, future });

interface MajorSpec {
  name: string;
  short: string;
  kinds: string[];
  courses: string[];
  workForms: string[];
  terms: string[];
  worries: string[];
  /** 大一 → 大四 */
  gradeTasks: [string, string, string, string];
  weights: Record<TroubleKind, number>;
}

export const MAJORS: MajorSpec[] = [
  {
    name: '临床医学',
    short: '临床',
    kinds: ['医科'],
    courses: ['系统解剖学', '生理学', '病理学', '诊断学'],
    workForms: ['实验报告', '图谱', '临床见习'],
    terms: ['心电图', '病理切片', '问诊流程'],
    worries: ['图谱背了就忘', '实验报告堆着没写', '见习站一天回来只想躺着', '小测连着来'],
    gradeTasks: ['解剖学就跟不上', '病理和生理一起压过来', '开始想考研还是规培', '实习轮转，还要写论文'],
    weights: W(44, 8, 6, 10, 10, 22),
  },
  {
    name: '计算机科学与技术',
    short: '计算机',
    kinds: ['理工', '综合'],
    courses: ['数据结构', '操作系统', '计算机网络'],
    workForms: ['课程设计', 'debug', '组队项目'],
    terms: ['复杂度', '指针', '调参'],
    worries: ['课设跑不通', '组队总有一个人不干活', '实习面试的算法题刷不动'],
    gradeTasks: ['C 语言就劝退了一半人', '数据结构和课设撞在一起', '一边刷题一边找实习', '毕设还没开题'],
    weights: W(32, 8, 4, 6, 12, 38),
  },
  {
    name: '汉语言文学',
    short: '汉语言',
    kinds: ['师范', '综合'],
    courses: ['古代文学', '现当代文学', '文学理论'],
    workForms: ['论文', '读书笔记', '课堂展示'],
    terms: ['文本细读', '意象', '流派'],
    worries: ['论文写不出新意', '读书笔记堆了十几本', '上台讲怕讲砸'],
    gradeTasks: ['书单永远读不完', '开始写小论文', '考研还是考教资', '毕业论文开题'],
    weights: W(38, 10, 8, 10, 16, 18),
  },
  {
    name: '会计学',
    short: '会计',
    kinds: ['财经'],
    courses: ['中级财务会计', '审计学', '税法'],
    workForms: ['做账', '报表', '考证'],
    terms: ['借贷', '折旧', '增值税'],
    worries: ['初级会计又没过', '报表怎么都对不平', '实习就是天天贴凭证'],
    gradeTasks: ['基础会计还没打通', '中级财务会计很难', '一边考证一边找实习', '论文和求职一起来'],
    weights: W(42, 8, 4, 8, 8, 30),
  },
  {
    name: '材料科学与工程',
    short: '材料',
    kinds: ['理工'],
    courses: ['材料力学', '物理化学', '材料成型'],
    workForms: ['实验报告', '课程设计', '数据处理'],
    terms: ['屈服强度', '退火', 'SEM'],
    worries: ['实验数据对不上', '报告写不完', '读研还是直接工作'],
    gradeTasks: ['高数和化学先劝退', '实验课一下变多', '纠结考研还是就业', '毕设加投简历'],
    weights: W(38, 8, 4, 6, 10, 34),
  },
  {
    name: '法学',
    short: '法学',
    kinds: ['政法', '综合'],
    courses: ['民法', '刑法', '民事诉讼法'],
    workForms: ['案例分析', '模拟法庭', '背诵'],
    terms: ['构成要件', '举证责任', '法条'],
    worries: ['法条背了就忘', '模拟法庭一开口就紧张', '法考要不要现在开始'],
    gradeTasks: ['一堆要背的东西', '案例写不完', '法考和实习一起', '论文加求职'],
    weights: W(40, 14, 5, 10, 9, 22),
  },
  {
    name: '视觉传达设计',
    short: '设计',
    kinds: ['艺术', '综合'],
    courses: ['平面构成', '字体设计', '品牌设计'],
    workForms: ['画图', '改稿', '评图'],
    terms: ['版式', '配色', '出血'],
    worries: ['第七版还是被退', '评图怕被说没想法', '接的单子和作业撞了'],
    gradeTasks: ['软件都还没摸熟', '天天改稿', '作品集和接单', '毕设加找工作'],
    weights: W(30, 10, 6, 6, 22, 26),
  },
  {
    name: '学前教育',
    short: '学前',
    kinds: ['师范'],
    courses: ['学前心理学', '琴法', '幼儿游戏'],
    workForms: ['试讲', '琴法练习', '观察记录'],
    terms: ['敏感期', '五大领域', '环创'],
    worries: ['琴法课要在全班面前弹', '试讲怕镇不住小朋友', '观察记录不知道写什么'],
    gradeTasks: ['第一次离家住校', '试讲和琴法一起', '见习加考证', '实习加考编'],
    weights: W(28, 38, 6, 14, 10, 14),
  },
];

const GENERIC_WORRIES = ['这几天什么都没干成', '有点提不起劲', '事情堆在一起不知道先做哪个'];

/** 专业决定「此刻在哪、在干什么」，不然四个人的日程会长得一模一样。 */
const ACTIVITIES: Record<string, string[]> = {
  临床医学: ['在解剖室对着标本认结构', '在图书馆背图谱', '在医院跟着查房', '在抄诊断学的笔记'],
  计算机科学与技术: ['在改课设最后一个 bug', '在宿舍开组会分工', '在刷算法题', '在给项目搭环境'],
  汉语言文学: ['在图书馆翻必读书', '在改小论文的第三稿', '在准备课堂展示', '在整理读书笔记'],
  会计学: ['在对着做不平的报表', '在刷初会的题', '在实习岗上贴凭证', '在算折旧'],
  材料科学与工程: ['在实验室等一组数据', '在写实验报告', '在改课程设计的图', '在查文献找参数'],
  法学: ['在背民法条文', '在写案例分析', '在准备模拟法庭的稿子', '在整理法条笔记'],
  视觉传达设计: ['在改第七版图', '在教室等评图', '在整理作品集', '在调配色'],
  学前教育: ['在琴房练琴', '在写观察记录', '在准备试讲', '在做环创的手工'],
};

/** 性格原型：决定话多话少、作息、口癖和常用色。 */
const ARCH: Record<
  Archetype,
  {
    chattiness: number;
    awake: [number, number];
    colors: string[];
    avatars: string[];
    personality: string[];
    speech: string[];
    approach: string[];
    bias: Partial<Record<TroubleKind, number>>;
    tail: string[];
  }
> = {
  quiet: {
    chattiness: 0.5,
    awake: [19, 1],
    colors: ['#5f7f66', '#57707d', '#6b7f72', '#4f6b8a'],
    avatars: ['leaf', 'pebble', 'moon', 'lamp'],
    personality: [
      '肯动手、坐得住、答应的事一定做到；短板是不太会说自己的难处',
      '话少但可靠，能陪人把一件事做完；不太会安慰人',
      '习惯自己扛，不太主动开口要帮忙；别人开口他会接',
    ],
    speech: ['短句居多，常说「嗯」「还行」「差不多」', '说话平，一次说一两句就停', '不太用感叹号，语气偏淡'],
    approach: ['先看对方具体卡在哪一步，给一个十分钟内能动手的动作', '不追问，先陪着做一点；安慰的话说不出几句', '习惯先问「你现在能做哪一个」，再谈别的'],
    bias: { study: 6, self: 6, people: -3 },
    tail: ['算了，先放着吧。', '晚点再说。', '先这样。'],
  },
  shy: {
    chattiness: 0.6,
    awake: [15, 24],
    colors: ['#8a6f82', '#727c8f', '#8a7480', '#6d6a8a'],
    avatars: ['window', 'petal', 'cup', 'moon'],
    personality: [
      '细心、能记住别人的小事；总担心自己占地方',
      '怕说错话，但很愿意听；熟了之后会突然冒出冷笑话',
      '温和、不抢话；被拒绝会先笑着说没事',
    ],
    speech: ['句子短，常先打「嗯」「好」，再补一句解释', '说话会停一下，冒出认真话之后马上补「我随便说的」', '语气偏软，常带「那个」「就是……」'],
    approach: ['先接住情绪，很少给建议；被问怎么办才给一条自己试过的', '会帮对方把话说顺，不替对方决定', '先问「你是不是不太想说这个」'],
    bias: { people: 8, family: 6, future: -4 },
    tail: ['……我是不是说得太多了。', '可能我想多了。', '算了，当我没说。'],
  },
  rational: {
    chattiness: 0.7,
    awake: [8, 24],
    colors: ['#5a6f8c', '#6d7f6a', '#5d7086', '#6a7284'],
    avatars: ['spiral', 'waves', 'cup', 'pebble'],
    personality: [
      '会查资料、讲事实；容易漏掉别人的情绪，被提醒会承认',
      '想得周全，但常常卡在「再准备一下」',
      '条理清楚，能拆问题；对不确定的事不太敢下判断',
    ],
    speech: ['常说「先看条件」「理论上」「也不是不行」', '说话有结构，偶尔纠正细节', '句子偏长，喜欢把前提说清楚'],
    approach: ['先问清截止时间和可用时间，给两三个有代价的选项', '会拆成两步，但可能忽略对方现在的心情', '先算一遍时间，再劝人做最小的那一步'],
    bias: { future: 8, study: 4, self: -2 },
    tail: ['大概就这样。', '先试最小的一步。', '别的都是后话。'],
  },
  warm: {
    chattiness: 1,
    awake: [10, 1],
    colors: ['#c08a4e', '#b06a52', '#c08a3e', '#a86b45'],
    avatars: ['kite', 'leaf', 'cup', 'petal'],
    personality: [
      '热情、会张罗，记得别人爱吃啥；被拒绝会先笑着说没事',
      '行动快，容易替人揽事；上头时会答应太多',
      '话多、爱起哄；真遇上事反而会沉下来',
    ],
    speech: ['话快，爱说「我跟你说」「走啊」', '语速快，感叹号多', '爱开玩笑，情绪上来会突然变短句'],
    approach: ['先给一个特别具体的小邀约或小动作', '先接一句玩笑，再认真问一句', '习惯张罗一件能马上做的事，有时太快'],
    bias: { people: 10, family: 4, study: -4 },
    tail: ['走不走？', '饿死了，先去吃饭。', '别闷着啊。'],
  },
};

const HOBBIES = [
  '桌上一直摊着没写完的笔记',
  '手机里存了一堆没看的网课',
  '喜欢在阳台站着发呆',
  '睡前习惯刷一会儿视频',
  '周末会去操场走两圈',
  '最近在学着自己煮面',
];

/** 真正的兴趣：刚认识时拿来找话题，熟了才可能约着一起做。 */
const INTERESTS = [
  '打球',
  '跑步',
  '看球',
  '打游戏',
  '看剧',
  '做饭',
  '拍照',
  '听歌',
  '爬山',
  '养猫',
  '拼模型',
  '剪视频',
  '逛展',
  '游泳',
];

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const pick = <T,>(rows: T[]): T => rows[Math.floor(Math.random() * rows.length)];
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const dayKey = (ts: number) => new Date(ts).toDateString();
const cohortIndex = (cohort: string) => Math.max(0, COHORTS.indexOf(cohort));

export const findMajor = (name: string): MajorSpec | undefined =>
  MAJORS.find((m) => m.name === name);

/* ------------------------------------------------------------------ *
 * 出路：实习 / 考研 / 保研
 * 这些不是专业内容，而是到了某个年级、某个季节，人人都要面对的岔路。
 * ------------------------------------------------------------------ */

type PathKind = 'intern' | 'kaoyan' | 'baoyan';

const GENERIC_PATH: Record<PathKind, string[]> = {
  intern: ['投了十几份实习，一份回音都没有', '实习和上课时间撞了，只能二选一'],
  kaoyan: ['考研复习到一半，突然不知道考它干什么', '择校一直定不下来，书都翻了两遍'],
  baoyan: ['保研条件差一点，卡在绩点上', '想保研，但手里没有任何能写上去的东西'],
};

const PATH_WORRIES: Record<string, Record<PathKind, string[]>> = {
  临床医学: {
    intern: ['实习要轮转，值完夜班第二天还有课', '见习排班和课表撞了', '带教让先把问诊流程背熟再上手'],
    kaoyan: ['西综真题错一半，第二轮还没开始', '想考本校，但导师一直没联系上', '规培和考研不知道走哪条'],
    baoyan: ['保研差一名，就差在绩点上', '想保研，但没进过实验室', '夏令营投了三家，都没回音'],
  },
  计算机科学与技术: {
    intern: ['投了二十份实习，只有两家回', '实习面试手撕代码那关过不去', '实习和课设时间撞了'],
    kaoyan: ['408 第二轮还没过完', '想考外校，又怕专业课压分', '一边实习一边复习，两头都没顾上'],
    baoyan: ['保研要竞赛，我手里一个奖都没有', '绩点卡在保研线边上', '给导师发邮件，回说名额满了'],
  },
  汉语言文学: {
    intern: ['想投媒体实习，但拿不出作品', '实习就是改稿和排版，学不到东西', '投了教育机构，面试要现场试讲'],
    kaoyan: ['文学理论背不下去', '想跨考新闻，专业课完全陌生', '择校定了一个月还没定下来'],
    baoyan: ['保研要看论文，我还没有', '成绩够，但没参加过任何项目'],
  },
  会计学: {
    intern: ['实习就是贴凭证，学不到东西', '四大网申过了，笔试没过', '实习和初会考试撞在一起'],
    kaoyan: ['管综数学一直提不上去', '想考会计专硕，又怕复试被刷'],
    baoyan: ['保研要六级和竞赛，我只有绩点', '夏令营面试问的全是专业前沿'],
  },
  材料科学与工程: {
    intern: ['想进厂实习，还得托关系', '实习岗位都在外地，住宿没着落', '投了研发岗，要求硕士起步'],
    kaoyan: ['数二和专业课一起压过来', '想考的方向只要 985', '复习到一半，突然想放弃'],
    baoyan: ['保研要看科研经历，我只有课程实验', '导师说名额已经给别人了'],
  },
  法学: {
    intern: ['实习去律所，天天整理卷宗', '法考和实习撞在一起', '法院实习要学校推荐，没轮到我'],
    kaoyan: ['法硕和法考一起准备，顾不过来', '想考学硕，又不敢碰'],
    baoyan: ['保研要排名前 10%，我卡在边上'],
  },
  视觉传达设计: {
    intern: ['实习要作品集，我还没整理', '接的私活不算实习经历', '面试让现场改图，我卡住了'],
    kaoyan: ['想考美院，英语拖后腿', '手绘和理论两头都想抓，都没抓住'],
    baoyan: ['保研要作品和奖项，我只有课程作业', '夏令营要现场做方案'],
  },
  学前教育: {
    intern: ['实习要带班，我镇不住', '实习和考编的时间撞了'],
    kaoyan: ['想考教育学，专业课要背的太多', '学前考研的方向不知道选哪个'],
    baoyan: ['保研看实践，我带班经验不够'],
  },
};

const PATH_KNOWS: Record<PathKind, string[]> = {
  intern: ['简历怎么写', '面试会问什么'],
  kaoyan: ['怎么择校', '专业课怎么背'],
  baoyan: ['保研要准备什么', '夏令营怎么投'],
};

/** 到了某个年级、某个季节，才轮得到这条岔路。grade 是下标：0 大一 … 3 大四。 */
export const pathKindFor = (grade: number, month: number): PathKind | null => {
  const autumn = month === 9 || month === 10;
  const exam = month === 11 || month === 12;
  const spring = month >= 3 && month <= 5;
  if (grade >= 2) {
    // 大三、大四
    if (autumn) return Math.random() < 0.5 ? 'baoyan' : 'intern';
    if (exam) return 'kaoyan';
    if (spring) return 'intern';
    if (month === 6 || month === 7) return 'intern';
  }
  // 大二：找暑期实习
  if (grade === 1 && (spring || month === 9)) return 'intern';
  return null;
};

/* ------------------------------------------------------------------ *
 * 时间 → 处境
 * ------------------------------------------------------------------ */

interface Slot {
  label: string;
  busy: number;
  note: string;
}

const hourSlot = (hour: number): Slot => {
  if (hour < 6) return { label: '深夜', busy: 0.35, note: '还没睡' };
  if (hour < 9) return { label: '早上', busy: 1, note: '早八，人还没醒' };
  if (hour < 12) return { label: '上午', busy: 0.7, note: '在上课' };
  if (hour < 14) return { label: '中午', busy: 0.9, note: '刚吃完饭' };
  if (hour < 17) return { label: '下午', busy: 0.8, note: '下午还有课' };
  if (hour < 19) return { label: '傍晚', busy: 0.9, note: '刚下课' };
  if (hour < 22) return { label: '晚上', busy: 0.9, note: '在自习室' };
  return { label: '半夜', busy: 0.55, note: '熄灯了，在床上' };
};

interface Phase {
  label: string;
  busy: number;
  note: string;
}

const calendarPhase = (month: number, day: number): Phase => {
  if ((month === 2 && day >= 20) || month === 3)
    return { label: '刚开学', busy: 0.9, note: '新学期刚开，课表还没理顺' };
  if (month === 4 || (month === 5 && day <= 10))
    return { label: '期中', busy: 1.1, note: '期中了，作业和小测撞在一起' };
  if ((month === 5 && day > 10) || (month === 6 && day <= 25))
    return { label: '期末', busy: 1.2, note: '期末周，图书馆抢不到座位' };
  if ((month === 6 && day > 25) || month === 7 || (month === 8 && day <= 25))
    return { label: '暑假', busy: 0.6, note: '暑假，作息都乱了' };
  if ((month === 8 && day > 25) || month === 9)
    return { label: '开学', busy: 0.85, note: '刚开学，一直在搬东西、选课' };
  if (month === 10 || (month === 11 && day <= 15))
    return { label: '期中', busy: 1.1, note: '期中了，报告堆着' };
  if ((month === 11 && day > 15) || month === 12)
    return { label: '期末前', busy: 1.15, note: '离期末没几周，书还没翻完' };
  return { label: '寒假', busy: 0.55, note: '寒假在家，被问成绩' };
};

export function deriveSituation(majorName: string, cohort: string, now = Date.now()): PersonaSituation {
  const spec = findMajor(majorName);
  const grade = cohortIndex(cohort);
  const date = new Date(now);
  const slot = hourSlot(date.getHours());
  const phase = calendarPhase(date.getMonth() + 1, date.getDate());
  const busy = clamp(phase.busy * slot.busy * (grade >= 3 ? 1.08 : 1), 0.3, 1.3);
  const gradeTask = spec?.gradeTasks[grade] ?? '这学期的事还没理顺';
  // 该找实习/考研/保研的年级和季节，说那条岔路；否则说专业里的具体事
  const pathKind = pathKindFor(grade, date.getMonth() + 1);
  const pathPool =
    (spec && PATH_WORRIES[spec.name]?.[pathKind as PathKind]) || (pathKind ? GENERIC_PATH[pathKind] : []);
  const worry = pathKind && pathPool.length
    ? pick(pathPool)
    : spec
      ? `${gradeTask}，${pick(spec.worries)}`
      : `${gradeTask}，${pick(GENERIC_WORRIES)}`;
  const baseKnows = spec
    ? [spec.courses[0], spec.terms[0], spec.workForms[0]]
    : ['怎么把一天过完'];
  const knows = pathKind ? [...baseKnows, ...PATH_KNOWS[pathKind]] : baseKnows;
  const activity = pick((spec && ACTIVITIES[spec.name]) || ['在忙自己的事']);
  // 期中/期末这种节点才值得说出来，平时不加
  const phaseLine = phase.busy >= 1.1 ? `；${phase.note}` : '';
  return {
    day: dayKey(now),
    agenda: `${slot.note}；${activity}${phaseLine}`,
    worry,
    knows,
    busy,
    busyLabel: busy > 1.05 ? '很忙，回得慢' : busy > 0.8 ? '一般忙' : '比较闲',
  };
}

/* ------------------------------------------------------------------ *
 * 造人
 * ------------------------------------------------------------------ */

const uniqueName = (gender: Gender, taken: Set<string>): string => {
  for (let i = 0; i < 40; i++) {
    const given = pick(gender === 'female' ? GIVEN_FEMALE : GIVEN_MALE);
    const name = `${pick(SURNAMES)}${given}`;
    if (!taken.has(name)) return name;
  }
  return `${pick(SURNAMES)}${pick(GIVEN_MALE)}${randInt(2, 9)}`;
};

export function generatePersona(
  archetype: Archetype,
  now = Date.now(),
  taken: Set<string> = new Set(),
  usedMajors: Set<string> = new Set(),
  cohortOverride?: string,
): Persona {
  const spare = MAJORS.filter((m) => !usedMajors.has(m.name));
  const spec = pick(spare.length ? spare : MAJORS);
  usedMajors.add(spec.name);
  const gender: Gender = Math.random() < 0.5 ? 'female' : 'male';
  const name = uniqueName(gender, taken);
  taken.add(name);
  const school = `${pick(PLACES)}${pick(spec.kinds)}${pick(SCHOOL_SUFFIX)}`;
  const cohort = cohortOverride ?? pick(COHORTS);
  const grade = cohortIndex(cohort);
  const age = 18 + grade + (Math.random() < 0.35 ? 1 : 0);
  const situation = deriveSituation(spec.name, cohort, now);
  const arch = ARCH[archetype];
  const chattiness = clamp(arch.chattiness * (1.3 - situation.busy * 0.4), 0.25, 1.3);
  const replyDesire = Math.round(34 + chattiness * 46);
  const bias = arch.bias;
  const weights: Record<TroubleKind, number> = {
    study: Math.max(0, spec.weights.study + (bias.study ?? 0)),
    people: Math.max(0, spec.weights.people + (bias.people ?? 0)),
    love: Math.max(0, spec.weights.love + (bias.love ?? 0)),
    family: Math.max(0, spec.weights.family + (bias.family ?? 0)),
    self: Math.max(0, spec.weights.self + (bias.self ?? 0)),
    future: Math.max(0, spec.weights.future + (bias.future ?? 0)),
  };
  const awake: [number, number] = [
    (arch.awake[0] + randInt(-1, 1) + 24) % 24,
    (arch.awake[1] + randInt(-1, 1) + 24) % 24,
  ];
  // 插嘴概率：原型决定基准，再按话量抖动；快的人几秒就接，慢的人要等半分钟
  const reactivity = clamp(
    arch.chattiness * 0.7 + 0.15 + (Math.random() - 0.5) * 0.16,
    0.2,
    0.9,
  );
  const paceBase: Record<Archetype, [number, number]> = {
    quiet: [9, 26],
    shy: [8, 24],
    rational: [4, 14],
    warm: [3, 11],
  };
  const pace: [number, number] = [
    paceBase[archetype][0] + randInt(-1, 2),
    paceBase[archetype][1] + randInt(-2, 3),
  ];
  const peak: [number, number] = [
    (awake[0] + randInt(0, 2)) % 24,
    (awake[0] + 4 + randInt(0, 2)) % 24,
  ];
  const interestPool = [...INTERESTS].sort(() => Math.random() - 0.5);
  const interests = interestPool.slice(0, 2);
  const worryShort = situation.worry.split('，').slice(-1)[0];

  return {
    id: `p_${Math.random().toString(36).slice(2, 9)}`,
    archetype,
    name,
    handle: `@${name}`,
    tagline: `${spec.short}${cohort}，${worryShort}`,
    background: `${school}${spec.name}${cohort}，${age} 岁，住${randInt(4, 6)}人寝。${situation.worry}。${pick(HOBBIES)}。`,
    voice: `${situation.agenda.replace(/；/g, '，')}。${pick(arch.tail)}`,
    color: pick(arch.colors),
    avatarKey: pick(arch.avatars),
    gender,
    age,
    school,
    major: spec.name,
    cohort,
    personality: pick(arch.personality),
    speech: pick(arch.speech),
    approach: pick(arch.approach),
    weights,
    followUp: archetype === 'warm' ? 'often' : archetype === 'shy' ? 'rare' : 'sometimes',
    intimacy: 0,
    replyDesire,
    memoryMode: 'trim',
    memory: [],
    lastDistillAt: 0,
    weekLog: [],
    mind: undefined,
    relations: {},
    relationsAt: now,
    situation,
    chattiness,
    reactivity,
    pace,
    peak,
    interests,
    awake,
  };
}

/** 每个原型抽一个，年级也各抽一个——群里既要有大一，也要有正在找实习/考研的人。 */
export function generateCast(size = 4, now = Date.now()): Persona[] {
  const archetypes: Archetype[] = ['quiet', 'shy', 'rational', 'warm'];
  const order = [...archetypes].sort(() => Math.random() - 0.5).slice(0, size);
  const cohorts = [...COHORTS].sort(() => Math.random() - 0.5);
  const taken = new Set<string>();
  const majors = new Set<string>();
  return order.map((archetype, i) =>
    generatePersona(archetype, now, taken, majors, cohorts[i % cohorts.length]),
  );
}

/** 换了一天就把处境重算一遍：同样是这个人，今天想的事会变。 */
export function refreshSituations(personas: Persona[], now = Date.now()): Persona[] {
  const day = dayKey(now);
  let changed = false;
  const next = personas.map((persona) => {
    if (persona.situation?.day === day) return persona;
    changed = true;
    const situation = deriveSituation(persona.major, persona.cohort, now);
    const base = ARCH[persona.archetype ?? 'quiet'].chattiness;
    const chattiness = clamp(base * (1.3 - situation.busy * 0.4), 0.25, 1.3);
    return {
      ...persona,
      situation,
      chattiness,
      replyDesire: Math.round(34 + chattiness * 46),
    };
  });
  return changed ? next : personas;
}
