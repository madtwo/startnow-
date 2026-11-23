# Patch 4 增量交接（基于 2026-11-23 的 `20de4cb` 源码快照）

> 本节是本次交付状态；后面的 Patch 3、2026-11-22 条目属于历史说明，不代表当前 HEAD 或最新测试结果。本次工作未在用户 Git 仓库创建提交，也未推送或部署。

- **修复范围**：仅双人盲评工具对跨平台文本换行的严格冻结 SHA 校验；`scripts/q06-human-review-gate.cjs` 在对照不变的 LF SHA 前只折叠 CRLF，`scripts/q01-human-review-gate.cjs` 在对照不变的 CRLF SHA 前只统一换行。样本正文、期望标签、冻结值、运行时 SHA、评审仲裁规则均未修改；新增独立格式和篡改回归。
- **原因**：当前 ZIP 的 Q06 fixture 为 CRLF；原工具持有上一版 LF 原文字节 SHA，导致 Q06 全部 11 项工具测试假失败，而原始文本完全一致。运行时 `src/lib/adviceLine.ts`、`src/lib/actions.ts` 的 SHA 与原 pin 精确相同。
- **Q01 仍是硬阻塞**：当前 `src/lib/completionReaction.ts` 的 SHA 是 `7d589bf946e937089e355aa1ef1416d576c5c5896c068ce9378080de4d717d18`，不同于 Q01 v1.8 锁定的 `21db764e500e077a486e310450c5bc146ee54b0171e4636bf45e9f2710d6e7f8`。Q01 `prepare` 按设计退出 2；需要协调员先审查/重新冻结**当前运行时代码**，本补丁不自动更新 pin，更不生成真人评审结果。
- **数据与验收**：新需求包记录真实模型 50 条为 49 pass / 0 fail / 1 blocked（历史证据，不是本补丁重新调用）；Q01/Q06 真人独立双评和人工最终走查仍未完成，整体仍 NO-GO。详见随包 `PATCH4-EXECUTION-REPORT.md`。
- **作用边界**：`src/*` 产品运行时代码、`room/*`、冻结 fixtures、API Key、用户历史数据均未改动。不能用自动测试替代真人签核。

# 最新增量交接（2026-11-23 · Q06 人类验收工具补丁）

> **本段优先于下文历史版本说明。** 下文仍保留 2026-11-22 的 UI 历史交接记录，其中 `main`、628 项等信息已过时；当前源码来自用户提供的 `380cc64` 跟踪快照（无 `.git`），本轮**没有 Git 提交、推送或部署**。

- **本轮改动**：增加 `scripts/q06-human-review-gate.cjs`、冻结的 10 条合成 alias 样本、`docs/Q06-HUMAN-REVIEW-PROTOCOL.md`、11 项回归测试；`tests/room.test.cjs` 的下午时间改为本地时间构造，解决跨时区测试假失败。`room/*` 目录与产品运行时代码保持不变。
- **Q06 工具**：离线随机生成独立 packet A/B，协调员私存 manifest 和输出的 SHA；验证签署代号、独立声明、原始数据未被修改、10/10 标签、一致性以及 C04 拒绝、C10 批准。只给 `READY_FOR_EXTERNAL_SIGNOFF`，**永不**自行签署或产生发布 GO。命令见 `docs/Q06-HUMAN-REVIEW-PROTOCOL.md`。
- **当前复测（环境补丁后）**：UTC 下 `npm run test:baseline` 785 项（784 通过、1 按旧约定跳过）、`npm run test:v4` 127/127；`room.test.cjs` 在 UTC/Los Angeles/Shanghai 各 22/22。执行环境 npm 仓库不可达，`npm ci` 未完成，`npm run build` 由于缺 `vite/client` 类型不能成功执行；这不等于构建通过或源码构建失败。原包报告的 build pass 属于之前的环境与版本，不当作本轮重新验收。
- **当前阻塞**：Q01/Q06 仍需要真实双人盲评及外部签名；50 条真实模型扩展探针需要用户凭据、受控浏览器与真实调用；公开站人工复验未在本环境执行（DNS 无法访问）；短确认句池、旧数据迁移和浮层 history 产品决策仍待确认。**整体继续 NO-GO**。

---

# StartNow 前端交接包

> 每次 push 前更新本文件的「交付状态」「本次变更」「已知问题」，与代码放在同一个提交里。
> 目标是让接手的人不看聊天记录，也能在 10 分钟内跑起来、看懂改动、知道下一步。

## 1. 交付状态

| 项 | 值 |
| --- | --- |
| 分支 | `main` |
| 本次提交 | 与前端改动一起提交（父提交 `ac81d22`） |
| 同步时间 | 2026-11-22 |
| 技术栈 | React 18 + TypeScript 5 + Vite 6，无路由库、无 UI 框架 |
| 运行 | `npm install && npm run dev` → http://127.0.0.1:5173/ |
| 构建 | `npm run build`（先 `tsc --noEmit`，再 Vite 打包） |
| 回归 | `npm run test:all`：628 项（627 通过、1 跳过）+ 127 项，0 失败 |
| 产物体积 | JS 约 644 KB（gzip 228 KB），CSS 约 174 KB（gzip 31.5 KB） |

默认演示模式，不需要 API Key；真实模型在「我的 → API 设置」切换，Key 只存本机。

## 2. 本轮变更

- **顶栏「我的」改为「日程」**
  - 第 4 个平级入口现在跳到 `ScheduleView`；比赛模式下仍回退为「我的」，避免日程被隐藏后点到空白。
  - 「我的」仍可从右侧头像、左侧栏「我的」和手机底栏进入。
- **日程页按设计稿重做（列表 + 月历两套视图）**
  - 新增 `src/components/ScheduleView.tsx` 与 `src/schedule.css`（约 1,119 行），使用独立 `sch-*` 类名，避免与旧 `.meeting-*` 冲突。
  - 列表：随手记录表单（标题 / 日期 / 时间）、按日分组时间线、勾选完成、压力标签、目标来源链接、空态拆解入口。
  - 月历：42 格月视图、月份切换、日程圆点、今日/选中态；右栏为当天安排、特色首卡、快捷记录尾卡。
  - 时间留空显示「全天」；日期/时间原生图标透明覆盖，避免出现两个图标。
- **日程空态气泡位置修正**
  - 「我陪你慢慢安排」从卡片外的绝对定位改为卡片内右下角，不再悬空在框外。
  - 装饰气泡禁用文本选择与鼠标事件，避免被拖选后看起来像紫色高亮。
- **「试试」页上下顺序调整**
  - 今日一步主卡片（`step-hero`）置顶；「拆解一个目标」移到主卡片下方、三张信息卡上方。
- **头像改为本地上传**
  - 移除 6 个预设头像选择按钮及对应样式。
  - 「我的」页新增「上传头像」：JPG / PNG，≤ 5MB，居中裁剪为 160×160，压缩成 JPEG 后存 localStorage。
  - 上传后显示「更换头像 / 恢复默认」；新头像同步到顶栏、侧栏、我的页、论坛卡片和卡片详情。
  - 图片只存本机，不上传服务器。

涉及文件：`src/App.tsx`、`src/components/ScheduleView.tsx`、`src/schedule.css`、`src/components/StepBoard.tsx`、`src/components/Avatar.tsx`、`src/components/CardRow.tsx`、`src/components/CardDetail.tsx`、`src/lib/store.ts`、`src/types.ts`、`src/main.tsx`、`src/theme-v2.css`、`src/theme.css`。

## 3. 页面与组件地图

没有路由库，`App.tsx` 用 `view` 状态切换；试试与论坛共用 `home` 视图，由 `homeTab` 区分：

| 视图 | 入口 | 主要组件 |
| --- | --- | --- |
| 试试 | 顶栏/底栏「试试」 | `StepBoard.tsx`（今日一步、拆解目标、统计、小事） |
| 论坛 | 顶栏/底栏「论坛」 | `CardRow.tsx`（列表），搜索与分类在 `App.tsx` 内联 |
| 卡详情 | 点任意卡片 | `CardDetail.tsx` |
| 群聊 | 顶栏/底栏「群聊」 | `RoomView.tsx`（懒加载），内部 `RoomPanel.tsx`、`ChatRoom.tsx` |
| 发一张卡 | 底栏/首页入口 | `PostForm.tsx` |
| 日程 | 顶栏/底栏「日程」 | `ScheduleView.tsx`（列表 / 日历），样式在 `schedule.css` |
| 我的 | 头像 / 左侧栏 / 底栏「我的」 | `App.tsx` 内联：身份、上传头像、统计、我的任务/卡片、我帮过的人 |
| 我的卡 | 「我的」页入口 | `App.tsx` 内联，复用 `CardRow` |
| 便签 | 右侧浮标/底栏「便签」 | `NoteDrawer.tsx` |
| 设置 | 顶栏设置图标/我的 → API 设置 | `SettingsDialog.tsx`（懒加载） |
| 作者后台 | 我的 → 作者后台 | `AdminPanel.tsx`（懒加载），含 `ArchivePanel` |
| 新手引导 | 首次打开；我的 → 怎么玩 | `Onboarding.tsx`（五步全屏） |
| 危机卡 | 命中危机词 | `CrisisCard.tsx` |

公共件：`Avatar.tsx`（`src` 优先显示上传头像，其次有 `name` 时显示首字，最后显示 `avatarKey` 图案）、`GuideCard.tsx`、`MemoryManager.tsx`。

顶栏平级入口为「试试 / 论坛 / 群聊 / 日程」，右侧是加号、设置、通知、头像。手机底栏为「试试 / 日程 / 论坛 / 发一张卡 / 我的 / 便签」。

## 4. 样式与断点

- 样式加载顺序写在 `src/main.tsx`：
  `styles.css` → `theme.css` → `theme-v2.css` → `schedule.css` → `room.css` → `onboarding.css`
- 主要文件：
  - `src/styles.css`（约 4,620 行，基础布局）
  - `src/theme.css`（约 2,463 行，旧主题层）
  - `src/theme-v2.css`（约 1,960 行，当前淡香芋紫主题）
  - `src/schedule.css`（约 1,119 行，日程页）
  - `src/room.css`（群聊视图）
  - `src/onboarding.css`（约 1,022 行，五步引导）
- 当前 token（`theme-v2.css`）：
  - 主色 `--v2-primary #a78bfa` / 深色 `--v2-primary-deep #6c5ce7`
  - 浅底 `--v2-primary-soft #efeaff` / `--v2-primary-wash #f6f3ff`
  - 正文 `--v2-ink #2b2837` / 分割线 `--v2-line #ece8f6`
  - 旧的 `--coral*` 已映射到紫色 v2 token，新增样式优先用 `--v2-*`
- 主要断点：
  - `> 960`：左侧 220px sticky 侧栏，内容最大 1200px
  - `≤ 960`：隐藏侧栏与便签浮标，显示固定底部页签
  - `≤ 640`：页头纵排、菜单单列、弹层与表单内边距收紧
  - `≤ 360`：底栏收窄；首页同伴区上下排布
  - `961–1239`：内容区右侧额外留白，给便签浮标让位
  - 日程页：`1180 / 1000 / 760 / 620 / 440`，`≤ 1000` 月历与右栏改为上下排布，`≤ 440` 隐藏卡片图标、按钮整行
  - 群聊另有 `≤ 720` 的聊天布局调整
  - 新手引导：`≤ 1080` 缩放示意；`≤ 860` 改为纵向卡片；`≤ 560` 收紧；`≤ 380` 隐藏第二条帖子和部分装饰
- 已知技术债：媒体查询分散在 6 个 CSS 文件，合并时注意层叠顺序；新增覆盖前先确认原规则来源。

## 5. 数据与状态

纯前端单机，无后端、无账号。主要 localStorage 键（`lib/store.ts`）：

```
shudong.config.v1        API 配置
shudong.cards.v6         卡片/评论/下一步/便签
shudong.personas.v3      同伴人设/记忆/心智
shudong.todos.v1         自己加的小事
shudong.world.v1         调用计数/时间/日志
shudong.settings.v1      节奏与上限
shudong.identity.v2      匿名身份、头像图案与上传头像
shudong.room.v1          群聊消息
shudong.roomsettings.v1  群聊设置
shudong.archives.v1      本地归档
shudong.goals.v1         长期目标与步骤
shudong.schedule.v1      日程
shudong.summaries.v1     每日总结
```

`Identity.avatarUrl` 是可选字段：只接受 `data:image/` 开头、长度 ≤ 400,000 的字符串；上传时前端压缩为 160×160 JPEG，通常 2–8 KB。

UI 状态：

```
startnow.onboarded       是否已看过五步引导（'1' 后不再自动弹）
startnow.homeTab         试试/论坛的当前页签
startnow.calendarView    日程视图偏好（如已写入）
startnow.mode            旧入口模式兼容
```

`App.tsx` 每 4 秒调用一次 `tickCards()`；世界推进与预算闸门在 `lib/cards.ts`。演示模式由本地文案生成回复。
新手引导关闭即写入 `startnow.onboarded=1`；`?onboard=1` 不再强制弹出，需要重看时走「我的 → 怎么玩」。

## 6. 已验证的验收路径

1. 首次打开：五步引导依次出现；第 1 步有「开始体验 / 先逛逛」，第 2–4 步只有「继续」，第 5 步只有「进入 Start Now」；页脚只有 `n / 5`
2. 关闭引导后刷新页面：不再自动弹出；从「我的 → 怎么玩」可以手动重开
3. 顶栏在试试 / 论坛 / 群聊 / 日程之间平级切换；手机底栏 6 个入口均可用；头像可进入「我的」
4. 日程列表：新增日程、勾选完成、按日分组、空态「拆解一个目标」入口
5. 日程日历：切换月份与日期、右栏标题随选中变化、空态气泡位于卡片内、快捷记录切回列表并聚焦输入框
6. 试试：今日一步主卡在「拆解一个目标」上方；三张信息卡在拆解卡下方
7. 我的：上传头像 → 顶栏/侧栏/我的页/论坛卡片/卡详情同步显示；刷新后保留；可恢复默认；非图片或 > 5MB 有提示
8. 论坛：搜索、分类、帖子列表、AI 同伴怎么看、点开详情与回复
9. 群聊：进入即有开场提示，可发消息，AI 同伴按演示模式回话
10. 发一张卡 → 同伴到场 → 打开详情 → 回复/要下一步 → 贴到便签 → 完成 → 发个炫耀
11. 便签抽屉：自己加、勾选完成、打开来源卡
12. 设置、通知、作者后台：打开、Esc/遮罩关闭、焦点返回
13. 移动端 390×844：日程列表/日历、我的页上传头像行均无横向溢出

本轮截图复核规格：桌面 1440×1000、移动 390×844。截图仅为本机临时文件，不进仓库。
更早一轮的 12 档宽度回归（1440 → 320）未在本轮全部重跑；合并前建议补跑。

## 7. 已知问题与下一步

按优先级：

1. **本地数据可靠性（P1）**
   `store.ts` 写入失败目前静默；上传头像会增大 `shudong.identity.v2`，建议补存储配额提示、损坏数据恢复、导出/导入、跨标签页同步。
2. **真实模型体验（P1）**
   加载/重试/取消、失败兜底、防重复发送、回复来源标识；弱网下避免看起来卡死。
3. **构建体积（P2）**
   主 JS 约 644 KB，超过 Vite 500 KB 警告；可按路由/弹层拆分动态 import。
4. **群聊头像（P2）**
   己方消息不显示头像，上传头像不影响群聊；同伴头像仍使用预置图案，若产品要统一需扩消息 schema。
5. **引导示意与真实界面同步（P2）**
   `Onboarding.tsx` 里的论坛、我的、群聊示意是本地复刻，真实页面改版时要同步维护，避免再次脱节。
6. **工程收尾（P2）**
   收敛覆盖式 CSS；补一条 Playwright 冒烟路径；补 `focus-visible`、`prefers-reduced-motion`、iPhone 安全区。

## 8. Push 交付清单

push 前逐项确认：

- [x] `npm run build` 通过
- [x] `npm run test:all` 通过（628 项：627 通过、1 跳过；另 127 项全过）
- [x] 本文件「交付状态」「本轮变更」「已知问题」已更新
- [x] 已 `git fetch`，与远端 `main` 一致
- [x] `git status` 无截图、压缩包、API Key、真实姓名/学校