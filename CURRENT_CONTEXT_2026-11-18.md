# StartNow 当前上下文（2026-11-19 更新）

给接手的 AI / 未来的自己。所有结论以这个文件所在仓库的实际状态为准。

## 1. 项目与仓库

- 代码目录：`D:\shenye-shudong`（React 18 + TS + Vite 6 原型）
- Git：本地 `HEAD 1c0effa`；`origin/main` 已到 `2fe4bec`（队友前端）
- **所有改动都在未提交工作区**，`HEAD` 没有前进。不要在没有用户同意时提交或推送。
- 测试：`npm run test:all` = **446/446**（2026-11-19 下一轮补丁应用后）；`tsc`、`npm run build` 通过，`dist-h5` 已重建。
- 开发服务：`http://127.0.0.1:5173/` 是当前代码；`http://127.0.0.1:8080/` 仍指旧交付包 `startnow-h5-2026-11-17/`，验收别用它。
- 下一轮需求包：`startnow-ai-goals-requirements-2026-11-19.zip`（自包含：CONTEXT/REQUIREMENTS/DECISIONS/ACCEPTANCE + 源码快照）。

## 2. 已合入的内容

### 队友前端（2fe4bec，三方合并）
- 新主题、首页、五步引导、群聊并入主站（`setView('room')`）、RoomView / StepPanel / Onboarding。
- `room.html` 改为跳转 `/?room=1`。
- 保留我们移植的"原话再小一步"逻辑（StepBoard 的 `onRequestSmaller`）。

### 后端/逻辑（我们的）
- 专家补丁：代理白名单、跨站拦截、密钥脱敏、SSE 收尾、导入夹紧、Web Locks、Retry-After 等。
- 长时段：演示文案 6h 后允许复用；烦恼卡按 `24h/额度` 摊开（默认额度 8 → 约 3h 一张）。
- 安全：危机词变体、记忆脱敏、用药建议拦截、第三方情感叙述不再误拦。
- 对话：答错对象守卫（玩家点谁就谁回）、完成回应只回一次、模糊安慰建议不排炫耀、上下文默认摘要压缩、正在输入占位、同卡最多 2 路并行到场。
- 自我介绍：四人写出"学校·专业·年级·MBTI"；卡下只打招呼。
  - 沈默 ISFJ / 定京医科大学 临床医学 大三
  - 魏霓 INFJ / 水华木大学 金融学 大四
  - 苗泽 INTP / 钱塘大学 材料科学与工程 大三
  - 杨槔 ESFP / 临南学院 风景园林学 大一
- 完成回应锚定：对象词、动作词、跨句、同义、字符兜底；疑问/假设/自称守卫。

## 3. 模型结论

- Hy4 Free 不适合主用：可用正文率约 52–66%，三分之一输出被推理吃光。
- **DeepSeek V4.1 Flash 建议作主力**：可用正文 95–96%，P50 4–4.6s；60 链约 $0.11。
- 备用建议 GLM-5.3-Flash 或 Qwen3.8 Flash（未实测，先跑 10 链小样本）。
- 浏览器里保存的配置不一定是 DS4.1（测试台用 URL 参数临时覆盖，未改保存值）。

## 4. 最新验收（E5，DS4.1 主，60 链，seed 20261124）

| 指标 | 结果 |
| --- | --- |
| 完成回应模型采用 | **16/16，0 兜底** |
| 建议覆盖率 | 48/60（12 次诚实弃选） |
| 24 条盲评 | 贴题 6 / 一般 10 / **错配 8** |
| 答错对象 | 0 |
| 可用正文率 | 95.1%（剔除注入故障 97.0%） |
| 完整流 P50 / P95 | 4.62s / 7.31s |
| 费用 | $0.109 |

**结论：完成回应达标；建议错配未达 ≤1/20，暂缓 8–10 人试玩。**

## 5. 当前最大问题："不回答"（2026-11-18 已修：advice 600 / shrink 300 / brag 400；q1 非故障空正文 0.33%）

> 下面这段保留作历史成因，数值以 q1 为准。

- 空正文集中在**下一步选择**（`cards.ts:1684`，`maxTokens: 200`）：E5 49 次里 8 次为空，全部是 `finish_reason=length`。
- 自由文本缩小更小：110 token（`cards.ts:342`）。
- 普通评论 1200、新卡 1200、完成回应 200（E5 为 0 空）。
- 用户侧：60 链约 4–5 次系统提示，0 次整卡无人回。
- 已出回执包，建议先把 advice 200→600、shrink 110→300，再复测。

## 6. 下一步（待用户决定）

> 2026-11-19 起以下步骤已被 `startnow-ai-goals-requirements-2026-11-19.zip` 取代：R1–R4 论坛收尾、R5 60 链+盲评、R6 安全 4 链路、R7 375px。先看那份包。

1. 会议补丁已合入（人工移植）：目标拆解（文字/自由/AI 追问）、日程（日历+列表）、目标分享与打气、今日总结、先问清后建议、第三方情感豁免。群聊随机人设 / AI 自主目标 / 移动端 / 识图真实验收 **未完成**。
2. 真实 API 验收：5 张截图识图、10 组拆解、60 链回归；确认视觉模型支持。
3. 修建议错配（q1：7/24），建"卡面→期望动作"对照表。
4. 完成后再决定 8–10 人试玩。

## 6.5 会议补丁（2026-11-18 晚）

- 由于补丁基线较旧，采用"加法式"人工合并：
  - 新增 `goals/schedule/goalStorage/decompose/summary/clarify` 与 `ScheduleView/DecomposeSheet/GoalDetail`；
  - types 增加 Goal/Schedule/DailySummary；store 增加三个 key 与严格导入校验；
  - App 增加日程 tab（试试→日程→论坛→发一张卡→我的）、目标/日程视图、分享/打气、今日总结；
  - StepBoard 增加拆解入口与目标列表；CardRow/CardDetail 支持目标卡与打气；
  - 保留 room/群聊与队友 UI，Tab 从 6 项减为 5 项。
- 测试：364/364；浏览器验证：自由拆解→保存→日程列表→分享→AI 打气（模拟）→玩家打气→今日总结均可用。
- 群聊随机人设、AI 自主每日目标、截图识图真实调用、移动端 375px 仍未验收。

## 6.7 2026-11-19 下一轮补丁已应用（AI 目标接 tick/UI + 今日总结模型版）

- 应用 `D:\下载\startnow-next-round-delivery-2026-11-19.zip`：新增 `personaGoals/personaGoalSchedule/personaGoalTemplates` 与 4 个测试；App 接入 60s 本地检查、tick 后联动、revision/快照守卫；论坛显示 AI 目标卡与打气；今日总结接模型一句话（失败回退本地）。
- 本地修正：`completeCard` 守卫从 `authorId+authorKind` 收窄为 `authorId !== 'me'`（兼容旧存档），并把 review 测试改为玩家卡状态机 + AI 卡不可完成断言。
- 验证：**446/446**、tsc、build、H5、action-fit 60/60；浏览器确认四张 AI 目标卡出现、打气 +1、无 console 错误。
- 仍未做：真实 60 链 + 24 条盲评、浏览器安全 4 链路、375px（交付包内只是模板）。
- 人设审查稿：`exports/persona-review-2026-11-19.md/.json/.zip`。
- **2026-11-19 人设学习主线（第一赛道）**：四位固定角色新增 `academicFocus`，权重转为学习/未来为主，演示帖 16 学习 : 4 生活（80/20），AI 每日目标全部学习化；群聊保留（比赛版只隐藏入口）。分支 `backend/forum-core-2026-11-19` 已到 `0dc41b7`。需求包 `startnow-track1-persona-requirements-2026-11-19.zip`（含动作库补链 R4、比例测试、演示存档）。
- **2026-11-19 R6 增量补丁**：应用 `round3-r6-portable.patch`（`curatedUsage.ts`，同动作 24h ≤2 卡，第 2 张 alternateLine，第 3 张澄清）；**474/474**；24 链 nr24e：19 建议/17 动作/最多复用 2 次/0 次强制澄清，成本 $0.0513、P95 6.74s；建议评审 **1/24**（AI，仍非人类）。
- **2026-11-19 收尾状态**：474/474；四轮 AI 建议评审 1/24、5/24、2/24、4/24（文案型问题已修，AI 评审波动大，**人类盲评是唯一剩余硬门槛**）；最终回执 `startnow-round3-receipt-2026-11-19.zip`（4MB，含 4 轮数据/证据）。人设迁移已实现并经浏览器实测（v1→v2，记忆/熟度保留）；安全 4/4 浏览器验证（第 4 条在隔离 profile）；375px 用独立无头 Edge 实测 7 页无横向溢出（部分按钮 <44px，仍过 WCAG 24px）；30 链新人设+新预算：163 调用、$0.0636、非故障可用正文 98.11%、完成 7/7、模型重复 0；24 条独立评审 5/24 指向“光秃秃 UI 动作”，已把缩小文案改为内容型并跑复评。最终回执包 `startnow-round3-receipt-2026-11-19.zip`；第三轮需求包 `startnow-round3-requirements-2026-11-19.zip`。
- **2026-11-19 真实 60 链（nr60a，DS4.1）**：312 调用 / $0.115 / 非故障可用正文 99.67% / 完成 16/16 模型采用 / 模型回复重复 0 / 链路异常 0 / 分享·玩家打气·AI 打气各 12 次；24 条建议 AI 初评错配 1（「写一个动词」），3 条诚实澄清——**需独立人工盲评确认**。包 `startnow-next-round-acceptance-2026-11-19.zip`；数据 `data/nr60a/`。
- **2026-11-19 人设 v2 + 预算试验**：应用 `startnow-forum-personas-v2`（`forumPersonaMind.ts` 行为层 + prompt 插入 + 4 条测试），并按编辑稿细化四位固定角色措辞；群聊副本同步。对话预算整体 +50%（advice 900 / shrink 450 / brag 600 / 评论·新卡 1800 / 完成 300·hy4 1200 / 目标打气 330 / 总结 240）。**450/450**、tsc/build/H5 通过。第三轮需求包 `startnow-round3-requirements-2026-11-19/`（人设迁移、烦恼卡节奏、独立盲评、注入导入/375px、预算阈值、curated 去重、AI 目标模板）。
- **重要坑**：已保存的 `shudong.personas.v3` 不会自动更新，浏览器仍用旧人设（管理员后台可见旧文案）；新人设对话效果尚未真实验证。需要做“人设版本迁移”或重置/新访客。
- 安全浏览器验证 3/4：新卡危机、评论危机、危机存档导入均通过；注入存档导入仅单元测试；375px 未验证。

## 6.6 2026-11-19 剩余工作包（P0 + P1A 已合，群聊 P1B 暂缓）

- 用户指示：「群聊的先放放 我们把论坛弄好先」。
- P0：`actions.ts` 16 个场景 intent + 无匹配弃选；`fixtures/action-fit.json`（60 条）；`scripts/check-action-fit.mjs`；24 条空白盲评表；harness `scenario=safety` 与分享/打气阶段。
- P1A：`goals.ts` 的 AI 每日目标纯函数（每人每天 ≤1、全站 ≤4、结果 2–6h 后最多一条、done→brag / partial·missed→worry）、`goalStorage.ts` 严格校验 `postPlan`、`summary.ts` 事实版总结 + 可选一句模型衔接；`types.ts` 加 `Goal.postPlan/resultCardId`。
- 本地适配（必须保留）：三条通用规则 `send-message/peer-conversation/self-overwhelm` 垫底补回；`family-call-priority`（只认催/争执/吵架/沟通/回话）在 `future-decision` 前；`romance-message` 在 `writing-start` 前；新测试的 tsc 用 `process.execPath + node_modules/typescript/bin/tsc`。
- 验证：action-fit 60/60、56/60 覆盖、0 失败；**415/415**、tsc、build、H5。
- 仍未做：AI 目标接 tick/UI（R1–R3）、今日总结 UI 接模型（R4）、真实 60 链 + 24 条盲评（R5）、浏览器安全 4 链路（R6）、375px（R7）。详见需求包。
- 旧「提问包」已按用户要求清理：`startnow-local-question-package-2026-11-16.zip`、`startnow-backend-review-questions-2026-11-17.zip(+目录)`、`startnow-ui-threading-question-package-2026-11-17.zip`。

## 7. 交付物（均在仓库根）

- `startnow-conversation-quality-receipt-2026-11-18.zip`（最新：不回答成因 + 质量/稳定性方案）
- `startnow-acceptance-e5-2026-11-18.zip`（E5 验收）
- `startnow-optimization-receipt-2026-11-18.zip`（动作选择/去重/诊断需求包）
- `startnow-realapi-longrun-2026-11-18.zip`（a2/a3/d1 长流程报告与全量对话数据）
- `startnow-soak-receipt-2026-11-18.zip`（早期长时段压测）
- H5：`startnow-h5-2026-11-17.zip`

## 8. 约束

- API Key 只在浏览器 localStorage，**绝不写进聊天、日志、代码或交付包**。
- 不要关闭用户的浏览器；测试只用独立页面/独立数据。
- 不提交、不推送，除非用户明确说 OK。
- 前端 owner 是队友；改 UI 前先确认。
