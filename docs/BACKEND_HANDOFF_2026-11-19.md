# 论坛后端交接（2026-11-19）

给接手论坛后端的队友。自包含：读完这份 + 跑一遍命令，就能继续维护。

## 1. 分支与合并（先看这段）

- 分支：`backend/forum-core-2026-11-19`（从本地 `1c0effa` 的一个提交），包含 2026-11-16～19 的全部后端与论坛功能。
- 远端 `origin/main` 最新是 `2fe4bec`（你的前端提交）。本分支的工作区**已经手工并入过 2fe4bec 的前端内容**（主题、引导、群聊、RoomView 等），但 git 历史里没有这条祖先关系。
- 合并建议：
  ```bash
  git fetch origin
  git checkout backend/forum-core-2026-11-19
  git merge origin/main
  ```
  冲突时：`src/App.tsx`、`src/styles.css`、`src/components/*` 以前端为准；`src/lib/*`、`tests/*`、`scripts/*` 以后端分支为准。合并后必须重跑下面第 2 节的命令。
- 不要 `git reset --hard` 或整包覆盖；所有交付包里的 `*_REFERENCE` 补丁都只针对旧快照。

## 2. 本地验证（必须全绿）

```bash
npm install
npm run test:all        # 474 tests
npx tsc --noEmit
npm run build
npx vite build --base=./ --outDir dist-h5

# 场景路由（60 条标注）
node --no-warnings --experimental-strip-types scripts/check-action-fit.mjs
```

当前基线：**474/474**、tsc 干净、build/H5 通过、action-fit 60/60 主题、56/60 覆盖、0 失败。

## 3. 后端地图

| 区域 | 文件 | 说明 |
| --- | --- | --- |
| tick 引擎 | `src/lib/cards.ts` | 4s tick；到达/评论/建议/缩小/完成/炫耀/求助链；`TickInput/TickOutput` |
| 动作路由 | `src/lib/actions.ts` | 16 个场景 intent，具体优先、通用垫底；无动作时澄清；`ACTION` 文案与 `alternateLine` |
| 建议预算 | `src/lib/shortTaskBudgets.ts` | advice 900 / shrink 450 / brag 600；完成 300（hy4 1200） |
| 去重 | `src/lib/curatedUsage.ts` | 同动作 24h ≤2 卡；第 2 张用 alternateLine，第 3 张澄清 |
| 完成回应 | `src/lib/completionReaction.ts` | 动作锚定、否定/假设/自称/疑问守卫、安全兜底 |
| 安全 | `src/lib/submissionGuard.ts`、`baseline.ts`、`safety.ts`、`crisis.ts` | 危机提交/导入、注入剥离、边界与语气审查 |
| 人设 | `src/lib/personas.ts`、`forumPersonaMind.ts`、`personaMigration.ts` | 四位固定角色 + “论坛思维”行为层；v1→v2 文本迁移 |
| 目标/日程 | `goals.ts`、`schedule.ts`、`goalStorage.ts`、`personaGoals.ts` | 玩家目标、AI 虚构每日目标（tick 接入）、严格导入 |
| 总结 | `summary.ts` | 事实行本地生成；模型只加 ≤32 字衔接；每天 1 次 + 1 次刷新 |
| 存储/导入 | `store.ts` | localStorage keys；导入严格校验、注入剥离、profile 保留 |
| 模型 | `llm.ts`、`config/providers.ts` | 网关、流式、重试、fallback、usage |
| 测试台 | `soak.html`、`src/soak/harness.ts`、`vite.config.ts` | 真实 API 长流程；只本机；写 `.soak-data/` |
| 分析 | `scripts/analyze-soak.mjs`、`extract-run-suggestions.mjs`、`round3-*.mjs` | 指标、24 条抽样、盲评校验、预算 A/B |

## 4. 不能碰的线

1. `actions.ts` 规则顺序：
   - `family-call-priority`（只认催/争执/吵架/沟通/回话）在 `future-decision` 前；
   - `romance-message` 在 `writing-start` 前；
   - `send-message` / `peer-conversation` / `self-overwhelm` 垫底；
   - `if (text.trim() && !intent) return []` 保留。
2. `completeCard` 只处理 `authorId === 'me'` 的玩家卡；AI 卡不得进入完成/炫耀链。
3. 真实请求：必须带 `x-opencode-session`；**绝不注入** `stream_options.include_usage`（网关只回 usage 不回正文，会作废整轮数据）。
4. 危机：不建卡、不排队、不调用模型；导入含危机整包拒绝。
5. 人设迁移只替换“仍等于 v1 文本”的字段；不得覆盖手改。
6. 不把 Key、真实姓名/联系方式写进代码、测试、日志或交付包。
7. 前端 UI 结构归你；后端只做加法。提交前跑全量测试。

## 5. 当前关键指标（2026-11-19）

| 指标 | 值 |
| --- | --- |
| 全量测试 | 474/474 |
| 单链成本 | 约 $0.0021（DS4.1 Flash） |
| 非故障可用正文 | 98–100% |
| 完成采纳 | 7/7 或 16/16 |
| 模型回复重复 | 0 |
| 建议评审（AI） | 最近一轮 1/24 |
| 24 条人类盲评 | **未完成（唯一剩余硬门槛）** |
| 375px | 7 页无横向溢出；部分按钮 <44px（过 WCAG 24px） |

## 6. 接手后的优先事项

1. 人类盲评：用 `24.round5-r6.independent-ai.csv` 找未参与实现的人逐条核对。
2. 合并 `origin/main` 并解决前端冲突；合并后重跑 474。
3. 可选：44px 触控（header 图标、打气按钮）。
4. 群聊 P1B（随机人设/陌生开局/旧群只读）仍暂缓，等产品发话。
5. AI 目标模板不加恋爱线（已拍板）；烦恼卡不承诺固定频率（已改文案）。

## 7. 真实 API 与证据

- 长流程入口：`http://localhost:5173/soak.html?scenario=main&chains=24&seed=...&model=deepseek-v4.1-flash&run=<id>&maxUsd=0.1`
- 数据落在 `.soak-data/`（已 gitignore）；`scripts/analyze-soak.mjs <run>` 出 stats。
- 24 条建议：`node scripts/extract-run-suggestions.mjs <run> 24`。
- 盲评/预算脚本：`scripts/round3-blind-review.mjs`、`scripts/round3-budget-ab.mjs`。
- 历史回执与完整数据在仓库根 `startnow-round3-receipt-2026-11-19/`（未纳入 git，本地保留）。

## 8. 联系与约定

- 提交：不直接推 `main`；用分支/PR。合并后跑全量测试。
- 模型 Key 只在浏览器 localStorage 或本机环境，不入库。
- 前端 owner 是你；后端逻辑文件（`src/lib/*`、`scripts/*`、`tests/*`）由后端维护。
