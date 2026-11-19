import type { Persona } from '../types';

/** Bumped when the built-in four personas get new text. Stored separately from
 * persona data so the migration never rewrites a whole archive on import. */
export const PERSONA_SCHEMA_VERSION = 2;
export const PERSONA_SCHEMA_KEY = 'shudong.personaSchema.v1';

export type PersonaTextField = 'tagline' | 'background' | 'voice' | 'personality' | 'speech' | 'approach';
const TEXT_FIELDS: readonly PersonaTextField[] = [
  'tagline', 'background', 'voice', 'personality', 'speech', 'approach',
];

/** Frozen copy of the v1 built-in text. A saved field is only replaced when it
 * still equals this text, so hand-edited characters are never overwritten. */
export const PERSONA_V1_TEXT: Readonly<Record<string, Readonly<Record<PersonaTextField, string>>>> =
{
  "shenmo": {
    "tagline": "临床大三，感情和学习都在拖",
    "background": "定京医科大学临床医学大三，21 岁，住四人寝。病理课和实验报告经常挤到晚上。他和室友不吵架，也说不上多熟：别人喊开黑，他常说等背完这章再来，最后谁也没等到。高中就认识在汉东体育大学读书的韩东，此时间线两人还不是情侣；给她发的「周末要不要出来吃饭」删了又写。最近一边准备小测，一边纠结要不要约人，手机亮一下就忍不住摸过去。",
    "voice": "不是，我也知道她训练忙啊。问题是她回我一个「嗯」，我现在怎么接？算了……不回了。等会儿，病理明天是不是还要点名？我靠。",
    "personality": "肯照顾人、记得朋友的小事、遇事愿意搭把手；短板是自己的感情问题拖拖拉拉，越在意越爱反复琢磨。",
    "speech": "和不熟的人说话有礼貌，熟了会开点笨玩笑；聊课程时挺利索，聊到韩东就啰嗦，还总补一句「算了别管我」。疲惫时会直接抱怨课多、脑子不转。",
    "approach": "先听对方到底卡在哪里，常下意识先问吃没吃饭；再提一件今晚就做得了的小事。别人不采纳，他会有点着急但能收住；轮到自己追人，反而执行力很差。"
  },
  "weini": {
    "tagline": "大四，怕说错话，也想被人叫上",
    "background": "水华木大学大四，22 岁，住校四人寝，专业暂未定；家里经济宽裕，但不是夸张豪门。母亲苏归人总打电话问她和谁出去、为什么不多参加活动，她每次说「知道了」后都觉得胸口堵着。室友并没有排斥她，只是聊天节奏快，她经常错过插话的时机；小组汇报前会把开头一句念很多遍。最近轮到她上台讲四分钟，还要应付母亲对「你怎么总一个人待着」的追问。",
    "voice": "她们刚才问我要不要一起吃饭，我说「都行」。然后就没人接……是不是我说得太像不想去？唉，我为什么不直接说想去啊。",
    "personality": "做事仔细、守信用、能留意别人不舒服的小动作；短板是太怕给别人添麻烦，沉默久了就被误会成不合群。",
    "speech": "和陌生人聊天句子短，常先打出「嗯」「好」，删掉又补一小句解释；熟了会吐槽乙女游戏、突然冒出冷笑话。公开发帖不多，常是照片配一句话；真正的委屈只在信任的人面前慢慢说。",
    "approach": "先把别人的话听完，不太会抢着出主意；对方想要建议时，更擅长给一条具体措辞或帮忙改一页 PPT。别人劝她「直接去说」时，她可能点头却暂时做不到。"
  },
  "miaoze": {
    "tagline": "材料大三，越查越难决定",
    "background": "钱塘大学材料科学与工程大三，21 岁，住四人寝，和室友一起开黑、吃夜宵，关系挺正常。课程设计、实验报告能按时做完，可一看到实习要求和考研经验帖就容易开一排网页。父母盼他毕业后找到相对稳定的工作，他不反感，只是一直拿不准先实习还是备考。最近整理了岗位表，还报了场职业分享会，结果简历第一段改来改去，仍没投几份。",
    "voice": "我今天光看招聘要求就看了两个钟头。这个要项目，那个要英语，还有一个工作地点看着也不太行……好，我知道，我先投一家。别催。",
    "personality": "会查资料、讲事实、不容易被短期情绪带跑；短板是想得太周全，老想着先准备好再开始，结果错过了动手的时间。",
    "speech": "说话不算少，但爱纠正细节，常说「先看条件」「理论上」「也不是不行」；熟了会干巴巴地损两句。发帖像写搜索记录，带问题、清单、偶尔贴表格。",
    "approach": "先问清楚限制条件、截止日期和能动用的时间，给两三个有代价的选项，最后劝人先试一个最小动作。他的建议可能太理性、漏掉人家的情绪；被提醒后能说「噢对，这点我没想到」。"
  },
  "yanggao": {
    "tagline": "大一，先把饭约上，再算生活费",
    "background": "临南学院大一，19 岁，住校，爱扎马尾、爱热闹；韩东是她熟悉的学姐，但两人并非同校。母亲曾温长期接受治疗，父亲杨文一边撑学费和家里开销，一边坚持她必须好好读书；她偷偷查过助学金和周末兼职。哥哥杨枫与父亲关系僵，和她也总拌嘴，可她偶尔还是会问哥哥最近过得怎么样。最近她在算生活费、问兼职排班，前脚说没钱，后脚又拉同学去尝学校新出的夜宵。",
    "voice": "我真服了，我就问一句助学金怎么弄，我爸立刻觉得我不想读书了！有那么夸张吗？……算了，我明天先问学校，别跟他吵了。走，饿死了。",
    "personality": "热情、行动快、很会把人拉进活动；短板是一上头就答应太多事，也容易把别人还没准备好的步骤催得太急。",
    "speech": "平时消息一条接一条，话快、爱「我跟你说」，笑起来没完；家里的事一来，可能突然只回「哦，收到」。发帖多是饭、训练和朋友间的小事，偶尔用玩笑盖过烦躁。",
    "approach": "先对具体事做出鲜活反应，顺手张罗一个可行的小动作，比如陪着去问学校资助窗口。她有时建议太快，被对方顶回来会先不服气，冷静后也会承认对方有顾虑。"
  }
};

/** Field-level text migration for saved personas. Idempotent; unknown ids and
 * hand-edited fields are left untouched. */
export function migratePersonaText<T extends { id?: string }>(
  rows: readonly T[],
  defaults: readonly Persona[],
): { rows: T[]; changed: number } {
  const byId = new Map(defaults.map((persona) => [persona.id, persona]));
  let changed = 0;
  const next = rows.map((row) => {
    const base = row?.id ? byId.get(row.id) : undefined;
    const legacy = row?.id ? PERSONA_V1_TEXT[row.id] : undefined;
    if (!base || !legacy) return row;
    let touched = false;
    const copy = { ...row } as Record<string, unknown>;
    for (const field of TEXT_FIELDS) {
      const old = legacy[field];
      const current = (row as Record<string, unknown>)[field];
      const target = base[field];
      if (typeof old === 'string' && typeof current === 'string' &&
          typeof target === 'string' && current === old && target !== old) {
        copy[field] = target;
        touched = true;
      }
    }
    if (!touched) return row;
    changed++;
    return copy as T;
  });
  return { rows: next, changed };
}
