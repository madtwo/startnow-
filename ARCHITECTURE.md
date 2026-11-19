# StartNow 代码与 AI 交接

> 给接手代码的队友、外部 AI、未来的自己。
> 目标：读完这一份，能在不破坏产品语义的前提下继续开发。
> 先读本文件的「30 秒模型」和「不变量」，再读 `STARTNOW_PRODUCT_MANUAL.md`。

---

## 30 秒模型

StartNow 是一个单页应用。核心只有三件事：

1. **卡片**：一条“卡住了”的具体事，进入状态机。
2. **同伴**：四个有独立人设、记忆和心智状态的 AI，会到场、回帖、自己发卡、互相影响。
3. **下一步**：一个和卡片主题相关、可以再缩小一级的极小动作；贴到便签，做完进入「已完成」。

数据流：

```
localStorage
  ├─ cards      卡片 + 评论 + 下一步 + 便签 + 待处理计划
  ├─ personas   四个人设 + 记忆 + 熟悉度 + mind（独立心智）
  ├─ todos      玩家自己加的小事
  ├─ world      调用计数 / 时间 / 日志
  └─ settings   API / 节奏 / 每日上限
        │
        ▼
  App.tsx 每 4 秒 tickCards()
        │
        ├─ 处理到场计划 plan
        ├─ 处理待回复 pending
        ├─ 处理到期便签 / 过期卡片
        ├─ 可能生成一张 AI 新卡
        └─ 更新 personas.mind 与 memory
        │
        ▼
  React 视图：下一步 / 论坛 / 发一张 / 卡片详情 / 便签 / 我的 / 后台
```

群聊是**第二个视图**（`view === 'room'`），和上面这套并列但数据分开：

```
localStorage
  ├─ room          当前房间：消息 / 排期 / 下一步 / 群友 / 额度
  ├─ roomsettings  热闹度、时间不停止、每日条数
  └─ archives      旧群聊（可放回当下）
        │
        ▼
  RoomView 每 4 秒 tickRoom()（只在页面可见时跑）
        │
        ├─ 按天刷新处境、衰减熟悉度
        ├─ AI 自己那件小事到点 → 群里通报
        ├─ 落一条到期排期（每 tick 最多一条）
        └─ 没人说话 → 按打分选一个醒着的人开口
```

两套视图共享 API 配置和匿名身份，其余互不影响。细节见下面「群聊（第二个视图）」。

---

## 运行与构建

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc --noEmit && vite build，产物 dist/
```

环境：Windows，Node 24；项目在 `D:\shenye-shudong`。

默认演示模式，打开即用，不需要 API Key。  
真实模型：OpenAI 兼容 `/chat/completions`，在「我的 → API 设置」切换，Key 只存本机浏览器。  
OpenCode 两个网关依赖 `vite.config.ts` 里的同源代理，`dev` 和 `preview` 都已挂载；改代理配置后必须重启 dev server（Vite 热更新不会重载插件中间件）。静态部署需要在平台补 `/api/opencode*` 转发。

---

## 目录地图

```
src/
  App.tsx                 壳、导航、状态提升、tick、发卡/炫耀；时间推进只在作者后台
  main.tsx                入口
  types.ts                全部数据类型（Card / Persona / PersonaMind / Comment / Todo / World）
  styles.css              全部样式（无 CSS 框架）
  config/providers.ts     服务商预设、isReady/isMock/configLabel
  lib/
    cards.ts              卡片状态机、到场、回帖、下一步、完成、时间追赶
    castGen.ts            群聊人设现拼：姓名/学校/专业/年级/性格 + 处境推算
    tone.ts               群聊情绪判定（heavy / stuck / neutral）
    forumPersonaMind.ts   四位论坛同伴的「怎么听、怎么看、怎么接」行为视角
    room.ts               群聊调度：排期、熟悉度、两段式回复、旧群聊交换
    actions.ts            困扰主题判定、三档动作链、按主题选下一步
    dialogue.ts           社交意图（寒暄/语气词/玩笑/挑衅/求助）、关系标签、短回复
    mind.ts               独立心智：心情、念头、惦记、被谁影响、提示词
    personas.ts           四位同伴人设、权重、mock 卡池
    prompts.ts            系统提示词、评论/发卡/接受建议提示词
    baseline.ts           全局底线 + 语气审计
    safety.ts             危机关键词 + 重度分享判定
    crisis.ts             热线号码常量（12356 / 120 / 110）
    memory.ts             记忆衰减、合并、渲染
    llm.ts                OpenAI 兼容流式调用、错误描述
    seed.ts               开局说明卡、四张自我介绍卡、初始记忆
    store.ts              带版本号的 localStorage 读写、导入导出
    avatars.tsx           预制头像
    image.ts              图片压缩
  components/
    StepBoard.tsx         「下一步」页五种状态
    CardDetail.tsx        卡片详情、分人楼层、统一回复栏
    CardDeck.tsx          卡片模式
    CardRow.tsx           列表行
    GuideCard.tsx         置顶说明卡
    NoteDrawer.tsx        便签：未完成 / 自己加的 / 已完成
    PostForm.tsx          发卡
    Tour.tsx              3 步新手引导
    AdminPanel.tsx        作者后台：人设 / 心智 / 记忆 / 世界 / 数据
    SettingsDialog.tsx    API 设置
    CrisisCard.tsx        危机求助卡
    Avatar.tsx
    RoomView.tsx          群聊容器：状态、tick、补算、面板
    ChatRoom.tsx          群聊气泡流、引用、@、角落入口
    RoomPanel.tsx         群聊设置：热闹度、每日条数、时间不停止、换人
    StepPanel.tsx         群聊里的「下一步」面板
    ArchivePanel.tsx      旧群聊：放回当下 / 舍弃
```

---

## 数据模型

### Card

```ts
status: 'stuck' | 'arrived' | 'talking' | 'advised' | 'noted' | 'done' | 'handled'
kind:   'worry' | 'brag' | 'guide'
```

关键字段：

- `arrivals`: 已经来过的同伴 id
- `plan`: 还没到场的 `{ personaId, at }`
- `pending`: 还没处理的回复 `{ personaId, at, phase: 'reply' | 'reaction' | 'decide' }`
- `advice`: `{ text, actionId, fromPersonaId, at, accepted }`
- `note`: `{ text, fromPersonaId, at, dueAt }`
- `comments`: 统一评论流；线程由 `authorId` / `peer` 决定

状态变化：

```
stuck → arrived → talking → advised → noted → done
                                        └→ handled（主动收起 / 过期）
```

### Persona

人设字段之外，新增两层：

- `memory: MemoryEntry[]`：轻记忆 7 天衰减；重记忆最多 12 条；会合并。
- `mind?: PersonaMind`：独立心智，描述“此刻”的状态：

```ts
PersonaMind {
  mood: 'calm' | 'low' | 'tense' | 'warm' | 'restless'
  thought: string       // 脑子里正在想什么
  focus: string         // 最近惦记的一件事
  lastAct: 'lurk' | 'post' | 'reply' | 'brag' | 'rest' | 'step'
  lastActAt: number
  movedBy?: { by: string; what: string; at: number }
}
```

`mind` 是可选字段，旧数据由 `ensureMinds()` 在启动时补齐。
`mind` 会进入系统提示词（`mindPrompt`），影响真实模型的语气与选择；后台可查看。

### Persona 独立性

每位同伴独立拥有：

- 人设、说话方式、权重、回复意愿
- 记忆（对玩家、对其他同伴）
- 熟悉度（0–100，决定披露深度）
- 心智状态（心情 / 念头 / 惦记 / 被谁影响）
- 自己的行动节奏（发卡、回帖、接受或拒绝建议）

没有共享的“全局人格”。不要把人设内容塞进全局提示词；一律走 `buildPersonaPrompt(persona)`。

### 公共规则与私人记忆

- 四位同伴共享一套**只读**的公共规则（`PUBLIC_RULES`）：线上交流、不虚构线下、评论不等于求助、短评可以短回、不替用户执行现实任务。
- 共享规则不是共享记忆。记忆、关系、心智状态都按 persona 独立存放。
- 原型里用 `pending` / 公开评论近似“谁看见了什么”；只有实际生成过互动的角色才更新心智和记忆。
- 真实后端还需要服务端鉴权、曝光记录、私聊隔离、删除链路；提示词不能替代权限。
- 详细规范、事件示例、模型评估样例与隔离测试在 `research/agent-dialogue-pack/`，索引见 `research/README.md`。

### 接话前先判断意图

`src/lib/dialogue.ts` 先把最新可见发言分为寒暄、语气词、玩笑、挑衅、求助、提问、重度情绪或正常聊天：

- 「小美女，你好呀」→ 先回招呼，必要时打趣边界，不能邀请对方下楼。
- 「额」「？」「哈哈」→ 短回、困惑或接梗，不写辅导报告。
- 真实模型：`commentPrompt` 传入 reply target、关系、原话和 `physical_copresence=false`，并由 `PUBLIC_RULES` 约束；输出还会经过 `auditSocial`，拦住饭搭子、约饭、下楼、同校/同城、索要联系方式等线下邀请，失败时回退到安全的短 mock。
- 如果最新玩家发言本身是线下邀请（`isOfflineInvite`），模型输出必须包含线上/不方便等边界；否则强制替换为 `mockBoundaryReply`，不讨论时间、地点或“到了再说”。
- 演示模型：`socialReplyForMock` 提供同等的短回复；只有最新发言来自玩家时才走这条判断。
- 即使 intimacy 很高，关系仍按网友处理；不要因为“熟了”就允许现实见面。

---

## 一次 tick 的顺序（cards.ts）

`App` 每 4 秒调用 `tickCards`。顺序很重要：

1. 克隆 cards 与 personas；`ensureMind`。
2. 对每张卡：
   - 小助手首次问候（`helperAt`）
   - 便签到期 / 卡片过期
   - 处理到场的 `plan`
   - 处理一个到期的 `pending`（每张卡每次最多一个）
   - 如果 AI 卡长时间没人理，可能追加一个同伴回复
   - AI 完成玩家给的下一步（90 秒后的 `done` 动作）
3. 如果今天 AI 卡数量低于配额，生成一张新 AI 卡：
   - 选题材 → 生成文本
   - 写入 `mindAfterPost`
   - 给其他 1–2 位同伴安排 `pending` 回复
4. 返回 cards / personas / calls / logs

### AI 之间的影响

当一条 `pending` 回复落到 AI 卡上：

- 回复者：`mindAfterReply`（刚回了谁）+ 记一条关于卡主的记忆
- 卡主：`mindAfterPeer`（心情与念头被这句改写）+ 记一条关于回复者的记忆

当 AI 卡主完成玩家给的下一步：

- `mindAfterStep`：心情转暖，惦记改写
- 周流水记录“照着别人给的小步做了一次”
- 玩家侧：卡片进入 `done`，下一步进入便签「已完成」

mock 模式下，`mockComment` 有 35% 概率接上一条其他同伴的话；真实模式在评论规则中要求“可以接同伴一句”。

### 真实模型失败与来源透明

- `Comment.origin`：`model` / `demo` / `boundary` / `curated` / `simulated` / `system`；UI 会在评论头部显示来源。
- 真实模型失败不伪装成人设回复：追加 `system` 提示，不更新到场、记忆和 mind；评论/待回复任务保留，按 30 秒、90 秒重试两次，之后终止，避免每 4 秒 tick 无限烧 API。
- `PendingReply.sourceCommentId` 绑定触发任务的玩家评论；后加入的评论不会改变旧任务的含义。
- `askForAdvice` 的付费模型只返回预置动作 ID，应用写入对应动作和缩小链；模型失败时标注为预置动作，不冒充模型建议。
- `llm.ts` 处理分块 UTF-8 SSE、末帧无换行、空 content、超时和异常流长度上限。
- dev/preview 默认监听 `127.0.0.1`；需要局域网/远程访问时明确配置受控入口，不要把带长期 Key 的代理暴露到公网。

---

## 下一步（actions.ts）

不要退回到“全库随机抽动作”。当前逻辑：

1. `inferTrouble(card.text)` → `study | future | people | love | family | self`
2. 学习类再区分考试/写作：`pickActions(hour, 3, trouble, text)` 会根据「论文/开题/报告/文档/写不出」选择 `study-writing`，否则选择 `study-exam`。
3. 先取同主题的“第一档”动作，再补同主题动作，最后才补通用自我照顾动作。
4. 动作链三档，`smallerAction()` 只在同一条链内缩：
   - 考试：把书翻到要考的那一章 → 只把书翻开 → 把书从包里拿出来
   - 写作：把文档打开，只写标题和三个小标题 → 只打开文档 → 找到那个文档
   - 求职：打开岗位描述读第一段 → 找出岗位描述 → 打开招聘软件
   - 人际：在聊天框打一句想说的话 → 打开聊天框 → 找到头像
5. 演示模式取第一条；真实模型在 3 条候选里选并改写，优先最相关。

增加动作：在 `ACTIONS` 里加一条 `chain(prefix, topics, rows, variant?)`，确保有 `smaller` 链和 `lateNight`。学习动作必须标注 `study-exam` 或 `study-writing`。

---

## UI 与语义

### 下一步页（StepBoard）

五种状态，每种只给一个主动作：

- 空：写一张卡 / 去论坛
- 等：打开我的卡 / 直接要一个下一步
- 有下一步：贴到便签 / 先看看上下文
- 今天的一步：我做到了 / 打开这张卡
- 做到了：发个炫耀 / 打开这张卡

不要在首页加进度条、连续天数、完成率。

### 卡片详情

- 回应流是**平铺的时间顺序**，不按作者分组；每个 `Comment` 保留 `authorId` 与 `peer`。
- UI 用作者色做头像、名字和左侧色条，既保留“每个人的美术框”，又保持论坛楼层结构。
- 点击一条同伴回应：设置 `targetId` 和 `targetComment`，固定输入栏变成「回复：某某」；默认目标是楼主（`targetId = card.authorId`）。
- 自己的卡默认不指定人；点击同伴回应后才指定。自己的回应和小助手回应不可选。
- 发送时把 `targetId` 作为 `peer` 传给 `addPlayerComment`；`peer === ''` 表示不指定人。
- 发出去的回复按时间平铺，并在头部显示「回复 某某」。
- 「给下一步」会创建 `pending: decide`；下一步区块只显示一个动作；`做不到` 走同链缩小。

### 便签

- 未完成：`status === 'noted'` 的卡片 + 开放 todo
- 已完成：`status === 'done'` 的卡片 note + 完成的 todo
- 已完成项可直接「发个炫耀」

---

## 群聊（第二个视图）

群聊和「试试 / 论坛 / 我的」平级，`view === 'room'` 时懒加载 `RoomView`。它和卡片是**两套数据、共享 API 与身份**：卡片读 `shudong.cards.*`，群聊读 `shudong.room.*`，互不覆盖。

### 数据

- `Room`：`messages` / `scheduled` / `steps` / `cast` / `gone` / `usage`；当前房间只有一个，换人或放回时会进存档。
- `Message`：冗余存 `authorName / color / avatarKey`——换一批群友之后，历史消息仍然有名字和头像。
- `ScheduledMessage.intent`：`reply | peer | ambient | react | comfort | advise`；`advise` 额外带 `adviceId`（这条建议绑的动作）和 `adviceVariant`（换句式用）。
- `Persona` 在群聊侧多三层：`relations`（对 'me' 和彼此，从 0 开始）、`situation`（此刻处境，按天刷新）、`chattiness` + `awake`（话量与作息）。

### 人设是现拼的（castGen.ts）

`pickCast()` 不再从固定池里抽，而是调 `generateCast()`：

- 姓名（姓池 × 男女名池）、学校（地名 × 类型 × 大学/学院，全部虚构）、专业（8 个专业表）、年级、性格（4 原型 × 3 套说法）当场组合；四个人的专业和年级都不重复。
- 处境 = `专业 × 年级 × 当下时间`：学期节奏（开学/期中/期末/暑假/寒假）× 时段（早八/上午/午休/晚自习/半夜）× 专业专属活动。
- `pathKindFor()` 决定有没有到岔路口：找实习（3–7 月，大二起）、保研/秋招（9–10 月，大三起）、考研（11–12 月，大三起）。没到季节就不提这些事。
- 处境**按天刷新**：`refreshSituations()` 在 tick 时比对 `situation.day`，所以昨天的心事今天会变。
- 台词池与默认心智按 `archetype` 取，不按人名取——换人不需要重写内容。

### 熟悉度从 0 开始

- `relations` 初始为空，`intimacy` 由 `relations.me` 投影；对同伴也各自记一份。
- 上涨：被回复 +1、对方说了重的事 +2、被同伴接话 +0.6、旁听 +0.15。
- 三天没聊开始衰减（最多 −6）——符合「他们会忘事」这条设定。
- 记忆只有两个来源：自身背景（静态，进 prompt）+ 聊天里发生的事；没有预设的共同经历。

### 一次 tick（room.ts）

`RoomView` 每 4 秒调一次 `tickRoom`，只在页面可见时跑：

1. `prepareCast`：按天刷新处境、衰减关系。
2. 当日额度用完就直接返回（不报错，只是不动）。
3. AI 自己那件小事到点 → 群里通报「我做了」。
4. 取一条到期的排期消息，**每 tick 最多落一条**，保证像人在打字。
5. 没人说话且超过间隔 → 按打分选一个人主动开口；只有醒着的人才可能开口。

### 情绪句：先陪伴，再给建议

- `tone.ts` 本地判定 `heavy | stuck | neutral`；自伤类内容先被 `findCrisis` 拦走，不进这条链路。
- `neutral` 走普通回复；`heavy` 排 2 条陪伴 + 2 条建议，`stuck` 排 1 + 2。
- 建议**不靠模型自觉**：先用 `pickActions` 选 3 个不同动作，两个 AI 各锁一个 `actionId`，再各用一套不同句式；「不一样」由动作 ID 保证。
- **不设单次条数上限**，只受每日额度和群友人数（4 人）约束。
- 陪伴与建议**不接龙**：一段安慰后面再跟两句闲扯，会把正事盖过去。

### 玩家关心 AI 时

`roomPrompt` 的 `focus`：当玩家这句是在关心或询问说话者本人（而不是求助）时，`reply / comfort / advise` 三种模式都要求「先回应关于你自己的事」，再继续原本的任务。判定在 `playerIsFocusingOnPersona()`，明确要建议的话不触发。

### 旧群聊

- 「放回当下」是**交换**：目标房间回到当下，当前房间进存档，谁都不丢；恢复时把排期推到未来，避免一恢复就补算一堆。
- 舍弃必须显式按下，不自动发生；存档上限 8，满了提示先舍弃一个，不再静默截断。

### 不要做

- 不要把 `buildPersonaPrompt` 改成群聊专用：卡片和群聊共用它，改了会污染卡片版；群聊的处境与关系在 `systemForRoom` 里另拼。
- 不要让 `comfort` / `advise` 触发 AI 互相接龙。
- 不要让 `ambient` 带建议：没人跟你说话时，只是随口说一句自己的事。
- **真实模型失败宁可不发**：`generateLine` 返回 `null` 就跳过这条，不拿本地台词顶替。和上下文无关的兜底话会把整段对话带偏（这是「群里聊得云里雾里」的主要来源）。
- **开场只排一条 `welcome`**：新房间不要先让四个人自顾自 ambient；新人该被招呼，而不是听一屋子人自言自语。
- **玩家说完话时先清掉排着的 `peer`**，并且刚回完玩家的 AI 不再立刻开启互聊：场子是留给用户的。

---

## 不变量（改动前先核对）

1. 不诊断、不治疗、不替代专业帮助。
2. 不承诺长期、不制造依赖、不设连续打卡。
3. AI 身份透明；不写“只有我懂你”“我永远都在”。
4. 下一步必须来自卡片主题，且能在 1–15 分钟内做一个物理动作。
5. 「做不到」只能在同一条动作链内缩小，不能跳到无关主题。
6. 先听再给一步；第一轮默认不做重度披露。
7. 每位同伴的记忆与心智独立，不共享“全局好感/全局记忆”。
8. 论坛默认线上，双方不同处一地；不邀请陌生人一起下楼，不虚构见面。
9. 被评论不等于被求助；短语气词可以短回、困惑或不回，不强行辅导。
10. 演示模式与真实模式不能有两条完全不同的产品语义；mock 也必须有上下文。
11. 危机词命中时：不创建卡片、不召集同伴、不生成回帖，只展示热线；不要把危机内容当普通重分享加熟悉度。
12. 数据默认留在本机；不要提交 API Key、真实姓名或学校。
13. 新增 UI 状态时，同时考虑空/等待/完成/过期四种情况。

---

## 常用修改配方

### 加一位同伴

1. `personas.ts` 的 `defaultPersonas()` 加对象（必须是虚构学校/专业）。
2. `mind.ts` 的 templates 加默认心智（或让它走 generic）。
3. 可选：`personas.ts` 的 mock 卡池加卡；`cards.ts` 的 `MOCK_LINES` 加主题回复。
4. 检查 `seed.ts` 的开场卡与小助手评论是否要加一句。
5. `buildPersonaPrompt` 会自动带上新人设；`ensureMinds` 会自动补心智。

### 改下一步

- 只改 `actions.ts`；保持 `chain` 的 id 稳定（旧卡片存了 actionId）。
- 新主题动作必须设置 `topics`，并写三档。
- 改完用 `pickActions(14, 3, 'study', '论文写不出来')` 和 `pickActions(14, 3, 'study', '明天小测')` 抽查前三条是否相关。

### 改回复节奏

- 到场/回复的时间在 `cards.ts` 的 `createPlayerCard`、`addPlayerComment`、`tickCards`。
- 演示模式有 `settings.speed`；不要写死真实秒数。
- 拉长节奏时，同时考虑「下 X 小时后」的 `catchUp`。

### 加一个持久化字段

1. `types.ts` 加可选字段。
2. `store.ts` 的版本键/迁移按需加；旧数据要能缺省。
3. 启动时用 `ensure*` 补默认值，避免 undefined 进入 UI。

---

## 本地存储键

```
shudong.cards.v6
shudong.personas.v3
shudong.todos.v1
shudong.world.v1
shudong.settings.v1
shudong.identity.v2
shudong.config.v1
shudong.room.v1            群聊当前房间（消息/排期/下一步/群友/额度）
shudong.roomsettings.v1    群聊旋钮：热闹度、时间不停止、每日条数
shudong.archives.v1        旧群聊（最多 8 个，可放回当下）
startnow.onboarded
startnow.mode
startnow.homeTab
```

改结构时优先加迁移，不要直接清空用户数据。`store.ts` 里有旧帖子/旧人设迁移逻辑。

---

## 验证

```bash
npm run build
```

手工验收最短链路：

1. 新数据 → 下一步页 → 写卡 → 放出去
2. 等/推进时间 → 打开卡 → 回复一个人
3. 「直接要一个下一步」→「做不到」→ 观察缩小是否同主题
4. 贴到便签 → 我做到了 → 发个炫耀
5. 便签 → 已完成 → 看到卡片和 todo
6. 论坛 → 打开一张 AI 卡 → 给下一步 → 等 AI 接受
7. 我的 → 我帮过的人
8. 作者后台 → 看心智是否随发帖/回帖变化

浏览器测试注意：不要按进程名关闭用户的浏览器；如需 headless，用独立 user-data-dir 并按 PID 结束测试实例。

---

## 已知限制

- 无账号、无云端、无多用户；所有共享依赖导出 JSON。
- 图片上传只有入口，未做存储与审核。
- 危机识别是关键词级，不能承担临床判断。
- 真实模型未做完整语气回归；mock 只用于展示交互。
- 群聊**没有真正的后台运行**：页面关掉就不跑，「时间不停止」只是回来时按离开时长补算（最多 4 条）。Service Worker 存活时间不够，也没有后端推送。
- 群聊消息截断在 400 条（localStorage 5MB 的现实约束），旧群聊存档保留最后 150 条。
- 群聊的处境按天刷新，不是每分钟；同一天里同一个人的生活是稳定的。
- 自动化测试覆盖卡片与群聊的纯逻辑（`npm run test:all`），但仍以 `npm run build` + 手工链路为最终验收。

---

## AI 接手的阅读顺序

1. 本文件「30 秒模型」与「不变量」
2. `STARTNOW_PRODUCT_MANUAL.md` 的「核心机制」
3. `src/types.ts`
4. `src/lib/cards.ts`（tick 顺序）
5. `src/lib/actions.ts` 与 `src/lib/mind.ts`
6. `src/components/StepBoard.tsx`、`CardDetail.tsx`、`NoteDrawer.tsx`
7. `src/App.tsx`

改动前先写清楚：改的是语义、节奏、内容，还是纯样式。不要在一次改动里同时重写状态机和人设。
