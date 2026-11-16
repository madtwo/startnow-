# StartNow — 给接手 AI 的入口

先用 5 分钟读这三份，再改代码：

1. `README.md`：怎么跑、目录索引。
2. `ROOM_ARCHITECTURE.md`：**现行架构（群聊版）** —— 数据模型、tick 顺序、热闹度、补算、换人、**不变量**。
3. `STARTNOW_PRODUCT_MANUAL.md`：产品语义（界面地图还是卡片版，语义仍然适用）。

`ARCHITECTURE.md` 描述的是旧版卡片论坛。`lib/cards.ts` 还在，但没接进主界面——把它当提示词、心智、记忆、动作链、安全底线的**内容资产**读，不要照着它的页面结构做新功能。

`research/agent-dialogue-pack/` 是独立智能体与自然对话的设计资料；索引看 `research/README.md`。

## 开发命令

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit && vite build
```

没有 API Key 时，右下角「未接入 API」→「演示模式（不调用 API）」即可完整体验（不花钱、不发请求）。

## 先记住的约束

- 这是一个群聊，不是心理诊所、不是打卡软件、不是人生导师。
- 下一步必须与群里在说的事相关，并且能在 1–15 分钟内做一个物理动作；「做不到」只在同一动作链内缩小。
- 四位群友各有独立人设、记忆、熟悉度和 `mind`；公共规则只读，不共享私人记忆。
- 默认线上交流，双方不同处一地；不邀请陌生人下楼，不虚构见面。
- 短评可以短回、困惑或不回；被评论不等于被求助。
- 「被看到」和「有人应声」是两件事：完成一步必须立刻有系统通报，AI 回不回由热闹度决定。
- 群聊不做完成率、不做连续天数；目标只是一行文字标签。
- 不要把 API Key、真实姓名或学校写进仓库。

## 核心文件

- `src/lib/room.ts`：房间调度、热闹度、生成、补算、换人 ← 新的核心
- `src/lib/personas.ts`：人设池（12）+ 原型 + `pickCast`
- `src/lib/actions.ts`：主题判定、三档动作链
- `src/lib/mind.ts`：独立心智（含原型兜底）
- `src/lib/prompts.ts`：公共规则、群聊提示词
- `src/lib/safety.ts` / `baseline.ts`：危机关键词、全局底线与语气审计
- `src/components/ChatRoom.tsx`：气泡流、输入、@、引用、角落入口
- `src/components/StepPanel.tsx`：下一步面板
- `src/components/RoomPanel.tsx`：群设置（热闹度、额度、时间不停止、换人）
- `src/App.tsx`：房间 + 面板 + tick + 补算

## 验收

至少走一遍：`群设置 → 热闹度调到「热闹」` → 发一句 → 等有人接话 → 点「下一步 → 让群里给一个下一步」或自己加一条 → 做不到（缩小一级）→ 完成 → 群里出现「你完成了：…」→ 有人应声 → `群设置 → 换一批人` → 旧群聊里能看不能回。

**最容易丢的一处**：`App.tsx` 的 `send` 里那句 `findCrisis(text)`。它挂在「用户输入 → 数据」的接缝上，不在领域层；重写输入流程时一定要搬过去。
