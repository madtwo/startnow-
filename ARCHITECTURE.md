# StartNow 代码与 AI 交接

> ⚠️ **这一版已经改成群聊。** 现行架构看 `ROOM_ARCHITECTURE.md`。
> 下面这份描述的是旧版「卡片论坛」：`lib/cards.ts` 与相关组件还在，但没有接进主界面；
> 请把它当参考实现和内容资产读（提示词、心智、记忆、动作链、安全底线都还在用），
> 不要再照着这里的页面结构与状态机做新功能。

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

---

## 运行与构建

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc --noEmit && vite build，产物 dist/
```

环境：Windows，Node 24；项目在 `D:\shenye-shudong`。

演示模式：右上角「未接入 API」→「演示模式（不调用 API）」→ 保存。  
真实模型：OpenAI 兼容 `/chat/completions`，Key 只存本机浏览器。

---

## 目录地图

```
src/
  App.tsx                 壳、导航、状态提升、tick、时间推进、发卡/炫耀
  main.tsx                入口
  types.ts                全部数据类型（Card / Persona / PersonaMind / Comment / Todo / World）
  styles.css              全部样式（无 CSS 框架）
  config/providers.ts     服务商预设、isReady/isMock/configLabel
  lib/
    cards.ts              卡片状态机、到场、回帖、下一步、完成、时间追赶
    actions.ts            困扰主题判定、三档动作链、按主题选下一步
    dialogue.ts           社交意图（寒暄/语气词/玩笑/挑衅/求助）、关系标签、短回复
    mind.ts               独立心智：心情、念头、惦记、被谁影响、提示词
    personas.ts           四位同伴人设、权重、mock 卡池
    prompts.ts            系统提示词、评论/发卡/接受建议提示词
    baseline.ts           全局底线 + 语气审计
    safety.ts             危机关键词 + 重度分享判定
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
    Tour.tsx              10 步新手引导
    AdminPanel.tsx        作者后台：人设 / 心智 / 记忆 / 世界 / 数据
    SettingsDialog.tsx    API 设置
    CrisisCard.tsx        危机求助卡
    Avatar.tsx
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
- 真实模型：`commentPrompt` 传入 reply target、关系、原话和 `physical_copresence=false`，并由 `PUBLIC_RULES` 约束。
- 演示模型：`socialReplyForMock` 提供同等的短回复；只有最新发言来自玩家时才走这条判断。

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

---

## 下一步（actions.ts）

不要退回到“全库随机抽动作”。当前逻辑：

1. `inferTrouble(card.text)` → `study | future | people | love | family | self`
2. `pickActions(hour, 3, trouble)`：
   - 先取同主题的“第一档”动作
   - 再补同主题动作
   - 最后才补通用自我照顾动作
3. 动作链三档，`smallerAction()` 只在同一条链内缩：
   - 把书翻到要考的那一章 → 只把书翻开 → 把书从包里拿出来
   - 打开岗位描述读第一段 → 找出岗位描述 → 打开招聘软件
   - 在聊天框打一句想说的话 → 打开聊天框 → 找到头像
4. 演示模式取第一条；真实模型在 3 条候选里选并改写，优先最相关。

增加动作：在 `ACTIONS` 里加一条 `chain(prefix, topics, rows)`，确保有 `smaller` 链和 `lateNight`。

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
11. 数据默认留在本机；不要提交 API Key、真实姓名或学校。
12. 新增 UI 状态时，同时考虑空/等待/完成/过期四种情况。

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
- 改完用 `pickActions(14, 3, 'study')` 之类的方式抽查前三条是否相关。

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
- 没有自动化测试；改动后以 `npm run build` + 手工链路为准。

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
