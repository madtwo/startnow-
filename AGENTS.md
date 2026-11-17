# 先动一下（StartNow）— 给接手 AI 的入口

先用 5 分钟读这三份，再改代码：

1. `README.md`：怎么跑、仓库地址。
2. `ARCHITECTURE.md`：30 秒模型、tick 顺序、数据模型、独立心智、修改配方、**不变量**。
3. `STARTNOW_PRODUCT_MANUAL.md`：定位、五分钟体验、设计原则、安全边界、FAQ。

`research/agent-dialogue-pack/` 是独立智能体与自然对话的设计资料；索引看 `research/README.md`。

## 开发命令

```bash
npm install
npm run dev         # http://localhost:5173（默认绑定 127.0.0.1）
npm run build       # tsc --noEmit && vite build
npm run test:review # 53 项线下边界/来源/重试回归
```

默认就是演示模式，打开即用；真实模型在「我的 → API 设置」里切换。

## 交付约定

每次 push 前更新 `FRONTEND_HANDOFF.md`（交付状态、本次变更、已知问题、验收清单），与代码放在同一个提交里一起推送。只推目标分支，不动 main；截图和压缩包不进仓库。

## 先记住的约束

- 定位：四个虚构的 AI 同学的互助小圈子；你卡住时他们先听，再陪你缩出一个小动作；他们卡住时你也去拉一把。
- 不是心理诊所、不是打卡软件、不是人生导师；不发展恋爱或性关系。
- 同伴和用户不同校，只在论坛上聊；用户不需要为同伴的情绪负责。
- 下一步必须与卡片主题相关，并且能在 1–15 分钟内做一个物理动作；「做不到」只在同一动作链内缩小。
- 四位同伴各有独立人设、记忆、熟悉度和 `mind`；公共规则只读，不共享私人记忆。
- 论坛默认线上，双方不同处一地；不邀请陌生人下楼，不虚构见面。
- 短评可以短回、困惑或不回；被评论不等于被求助。
- 危机词命中时：不创建卡片、不召集同伴、不生成回帖，只展示热线。
- 不要把 API Key、真实姓名或学校写进仓库。

## 核心文件

- `src/lib/cards.ts`：卡片状态机、tick、AI 之间的影响
- `src/lib/actions.ts`：主题判定、三档动作链
- `src/lib/mind.ts`：独立心智
- `src/lib/dialogue.ts`：社交意图与短回复
- `src/lib/prompts.ts`：公共规则与提示词
- `src/components/CardDetail.tsx`：平铺回应与固定回复栏
- `src/components/StepBoard.tsx`：下一步页
- `src/components/NoteDrawer.tsx`：便签 / 已完成

## 验收

至少走一遍：发卡 → 到达 → 回复某条评论（输入栏变「回复：某某」）→ 要下一步 → 做不到 → 贴便签 → 我做到了 → 已完成 / 炫耀。
