# 群聊版：代码交接

> 这一版把「卡片论坛」改成了「一个群聊房间」。
> `ARCHITECTURE.md` 里描述的是旧版卡片系统，仍然留着（`lib/cards.ts` 没删），但**已经不是主路径**。
> 先读这份，再读 `ARCHITECTURE.md` 的「不变量」。

## 30 秒模型

三件事：

1. **房间**：只有一个。4 个 AI 群友，玩家也在里面。没有卡片页、没有论坛列表。
2. **热闹度**：一个滑杆（0–1），同时决定「群里多久自己聊一句」和「你说话后几个人回」。
3. **下一步**：房间是唯一容器，但任务只活在「下一步」面板里。有「完成」按钮，一点就群里通报。

数据流：

```
localStorage
  ├─ shudong.room.v1           当前房间（消息 / 排期 / 下一步 / 群友 / 用量）
  ├─ shudong.archives.v1       旧群聊（只读）
  ├─ shudong.roomsettings.v1   热闹度 / 时间不停止 / 每日条数
  ├─ shudong.config.v1         API（没变）
  └─ shudong.identity.v2       你的名字和头像（没变）
        │
        ▼
  App.tsx 每 4 秒 tickRoom()
        │
        ├─ AI 自己那件小事到点了吗 → 群里通报「我做了」
        ├─ 偶尔让某个 AI 自己排一件小事
        ├─ 处理一条到期的排期消息（每 tick 最多一条）
        └─ 没人说话且超过间隔 → 有人主动开口
```

## 数据模型

```ts
Room {
  messages: Message[]          // 聊天记录，最多 400 条（localStorage 只有 5MB）
  scheduled: ScheduledMessage[] // 谁、什么时候、说什么类型
  steps: NextStep[]            // 你的 + AI 的
  cast: Persona[]              // 当前 4 位
  gone: Persona[]              // 已经离开的
  lastSeenAt / lastMessageAt
  usage: { day, messages }     // 今天的额度
}

Message {
  authorId, authorName, color, avatarKey   // ← 作者信息冗余一份
  text, at, kind: 'chat' | 'system'
  replyTo?: string             // 引用的是哪条
  mentions?: string[]          // @ 了谁
}

NextStep {
  text
  ownerId: 'me' | personaId
  origin: 'ai' | 'self' | 'persona'
  fromPersonaId / fromName     // AI 给的：谁给的
  group?                       // 目标，只是一行文字标签
  actionId?                    // 动作链 id，支持「做不到」再小一级
  doneAt?
}
```

### 为什么作者信息要冗余

刷新群友之后 `personaId` 就查不到了。只靠 `cast.find()` 反查，历史消息会变成一排空白头像。所以发消息时把名字、颜色、头像一起存进 `Message`。

### Card 去哪了

`Card` 状态机（`stuck → arrived → talking → advised → noted → done`）在群聊里没有对应物，**已退役**：

| 旧 | 新 |
|---|---|
| `Card.text` | 一条 `Message` |
| `Card.comments` | `Room.messages` |
| `Card.advice` / `note` | `NextStep` |
| `Card.plan` | `Room.scheduled` |
| `Card.status` | 没了，由 `NextStep.doneAt` 取代 |
| `Card.kind: 'guide'` | 房间里的 `system` 消息 |

`lib/cards.ts` **没删**，里面的 `generateComment` / `generateAiCard` / 心智与记忆更新函数是资产，`room.ts` 复用了同一套 prompt 组件。

## 热闹度：一个旋钮，三件事

```ts
// lib/room.ts
livelinessProfile(0..1)
  ambientGap  = 14s + 146s × (1−L)      // 主动开口的间隔
  peerChance  = 0.10 + 0.50 × L          // AI 之间接话概率
  extraReply  = [0.45L, 0.22L]           // 你说话后第 2、3 个人跟着回的概率
  chainMax    = round(1 + 2L)            // 追话最多几轮
  cooldown    = 8s + 20s × (1−L)         // 同一个人两次发言的最小间隔
```

两个刻意的设计：

1. **`n`（一次几个人回你）硬上限 3。** 热闹不靠「4 个人同时回你」（那是客服队列），靠**对话链更长**。
   所以 L 主要花在 `peerChance` 和 `chainMax` 上。
2. **主滑杆控体验，不控「AI 互聊走不走模型」。** 走的都是模型；成本由「每日条数」和滑杆共同约束。

`livelinessEstimate()` 会把当前档位换算成「约 N 条/分钟」，显示在群设置里——这是唯一能让用户感知花钱的地方。

## 一次 tick 的顺序（room.ts）

`App` 每 4 秒调用 `tickRoom`，只在页面可见时跑：

1. 克隆房间、跨天重置用量。
2. 额度用完了就直接返回（不报错，只是不动）。
3. `tickPersonaSteps`：AI 自己那件小事到点了 → 群里说一句「我做了」。
4. `maybePersonaStep`：小概率让某个 AI 自己排一件小事（之后会通报）。
5. 取一条到期的排期消息（按 `at` 排序，**每 tick 只落一条**，保证节奏），生成内容并写入。
6. 没有到期的排期、且距上一条消息超过间隔 → 按打分选一个人主动开口。
7. 生成后可能排一条 AI 之间的接话（受 `chainMax` 限制）。

**为什么每 tick 只落一条**：一次落 5 条像抽搐，不是人在打字。

## 现实时间

`tick` 用的就是真实时间戳（`scheduled[].at <= Date.now()`），所以「现实时间」是默认状态。要做的是：

- **删掉**「下 1 小时后」按钮和伪造时间的 `advance()`。
- 页面不可见时暂停生成（`visibilitychange`）。
- 回来时 `catchUpRoom()` 补算。

### 关于「时间不停止」

**网页关掉之后不可能继续运行。** Service Worker 会在几十秒后被浏览器杀掉，后台同步由浏览器决定何时跑（通常按小时），真正的后台推送需要服务器——这个项目没有服务器。

所以这个开关实现的是**补算**：

```
关闭（默认）：离开超过 3 分钟 → 不补，只把 lastSeenAt 推进到现在
打开：       离开超过 90 秒 → 最多补 4 条，按离开时长分散到时间轴上
             并在前面加一条「你离开了 X」的系统消息
```

效果是「房间不是死在过去」，成本有上限（最多 4 次生成）。UI 上也写明了这一点，不假装在后台跑。

### 静默时段

凌晨 2–6 点不主动开口。既真实（他们是学生，会睡），也省钱。

### 每个 AI 有自己的「可能醒着的时段」

`ACTIVE_HOURS` 按原型给一段窗口（可以跨零点）：

| 原型 | 可能醒着 |
|---|---|
| quiet | 19:00–02:00 |
| shy | 15:00–24:00 |
| rational | 08:00–24:00 |
| warm | 10:00–01:00 |

它在两处生效：

- **主动开口**：只有醒着（`awakeFactor ≥ 0.6`）的人才可能自己说话。
- **你说话之后**：睡着的不会秒回，但也不是完全不能回——`scoreFor` 里 `awake` 只占权重，
  所以凌晨三点你可能只等到一个人慢一点应声，而不是四个一起回。

补算时用的是「那条消息所在时刻」的小时数，所以补出来的对话也符合当时的作息。

## 下一步

- 面板只显示 `ownerId === 'me'` 的条目。AI 的下一步**只在群聊里通报，不进面板**（否则面板会被别人的待办弄脏）。
- **「被看到」和「有人应声」是分开的**：点完成立刻插入一条 `system` 消息「你完成了：…」，这条与热闹度无关；有没有 AI 应声才由热闹度决定。这样不会出现「做完了却像没发生」。
- 「做不到」只在同一条动作链里缩小（`shrinkStep` → `smallerAction`）。
- 「目标」只是一行文字标签，**不做进度、不做完成率**——一旦可追踪，产品就变成待办清单了。
- 面板只显示当前未完成的 + 最近 5 条已完成的，不做统计。

## 换一批群友

```
rerollRoom()：
  旧房间 → archives（消息只留最后 150 条），只读
  新房间 → 空消息 + 4 位新人 + 你今天已用的额度
  你自己加的下一步 → 留下
```

`pickCast()` 从 `personas.ts` 的池子里**每个原型抽一个**（quiet / shy / rational / warm），保证群里不是四个闷葫芦或四个话痨。

### 原型（archetype）是这次换人的关键

台词池、默认心智都按 `archetype` 取，不按人名取：

- `personas.ts` 的 `LINES`（在 `room.ts`）按原型分 reply / peer / ambient / react / step
- `mind.ts` 的 `archetypeMinds` 给新人一份默认心事

所以换人不需要重写任何内容，只需要给新人一个原型。池子里现在是 12 个人（4 个原有 + 8 个新写）。

## 文件

```
src/
  lib/room.ts          房间调度、热闹度、生成、补算、换人  ← 新的核心
  lib/personas.ts      人设池（12）+ 原型 + pickCast
  lib/prompts.ts       在原来的基础上加了 ROOM_RULES / roomPrompt
  lib/mind.ts          加了 archetypeMinds
  lib/store.ts         加了 room / archives / roomsettings 三个键
  components/ChatRoom.tsx     气泡流、输入、@、引用、角落入口
  components/StepPanel.tsx    下一步面板
  components/RoomPanel.tsx    群设置（热闹度、额度、时间不停止、换人）
  components/ArchivePanel.tsx 旧群聊（只读）
  App.tsx              房间 + 面板 + tick + 补算
  styles-chat.css      群聊样式（在 main.tsx 里 import）
```

不动的：`lib/llm.ts`、`config/providers.ts`（BYO-Key 那套完全保留）、`lib/safety.ts`、`lib/baseline.ts`、`lib/actions.ts`、`lib/memory.ts`。

## 仍然成立的不变量

1. 不诊断、不治疗、不替代专业帮助。
2. 不承诺长期、不设连续打卡、不做完成率。
3. AI 身份透明。
4. 下一步必须和话题相关，且能在 1–15 分钟内做一个物理动作。
5. 「做不到」只能在同一条动作链内缩小。
6. 先听再给一步。
7. 每位同伴的记忆与心智独立。
8. 论坛默认线上，不虚构见面。
9. 被评论不等于被求助；短语气词可以短回、可以不回。
10. 演示模式与真实模式不能有两条完全不同的产品语义。
11. **`findCrisis` 两处调用必须保留**：`App.tsx` 的 `send` 和评论入口。它挂在「用户输入 → 数据」的接缝上，不在领域层里；重写输入流程时最容易丢。
12. 数据默认留在本机。

## 已知限制

- **没有真正的后台运行**：关掉页面就停了，「时间不停止」只是回来时补算。
- 群聊记录会截断在 400 条（localStorage 5MB 的现实约束）。
- 群友刷新是「池子里抽」，不是模型现场生成；同一个原型的人见多了会眼熟。
- 没有导出 / 导入（旧版的导出是卡片格式，没迁过来）。
- 演示模式不起网络请求、不耗额度；真实模型下每条消息都是一次调用。
- 没有自动化测试；验收靠 `npm run build` + 手工链路。
