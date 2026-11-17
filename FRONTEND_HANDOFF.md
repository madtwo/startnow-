# StartNow 前端交接包

> 每次 push 前更新本文件的「交付状态」「本次变更」「已知问题」，与代码放在同一个提交里。
> 目标是让接手的人不看聊天记录，也能在 10 分钟内跑起来、看懂改动、知道下一步。

## 1. 交付状态

| 项 | 值 |
| --- | --- |
| 分支 | `optimize/front-performance` |
| 最新代码提交 | `ebc6a2e`（本文件随后续同步提交更新） |
| 基线 | `002b361`（旧 main；push 前先 fetch 确认远端 main 状态） |
| 同步时间 | 2026-11-18 |
| 技术栈 | React 18 + TypeScript 5 + Vite 6，无路由库、无 UI 框架 |
| 运行 | `npm install && npm run dev` → http://127.0.0.1:5173/ |
| 构建 | `npm run build`（先 `tsc --noEmit`，再 Vite 打包） |
| 回归 | `npm run test:all`，当前 203 项全过 |
| 产物体积 | JS 约 366 KB（gzip 126 KB），CSS 约 152 KB（gzip 27 KB） |

默认演示模式，不需要 API Key；真实模型在「我的 → API 设置」切换，Key 只存本机。

## 2. 本轮交付内容（6 个提交）

- `4f36886` 群聊页统一为淡香芋紫主题
  - 群聊不再沿用旧的独立视觉，与主站的紫色 token 对齐
- `bae7a34` 顶部导航与手机底栏加入群聊入口
- `5471952` 群聊并入主站视图，与试试/论坛平级切换
  - `App.tsx` 新增 `room` 视图；`room.html` 仅保留跳转，落到 `/?room=1`
  - 卡片、论坛、群聊共享 API 配置和匿名身份，数据分键存储
- `d6d84c1` 顶栏图标按钮统一规格，加号与设置向通知铃对齐
- `10f6a6a` 新手指引改为五步全屏引导
  - 新增 `Onboarding.tsx` 与 `onboarding.css`，替换原来的 `Tour`
- `ebc6a2e` 新手引导贴合真实论坛与我的页
  - 引导内「同伴广场」按真实论坛结构重排：标题、搜索、分类、帖子卡、AI 同伴怎么看
  - 增加 AI 同伴群聊浮层，体现同伴会在群里发言
  - 「我的」示意改为真实栏目：我的任务 / 我的卡片 / 我帮过的人
  - 第 1 步保留「开始体验 + 先逛逛」，第 2–4 步只保留「继续」，第 5 步只保留「进入 Start Now」
  - 去掉「额外功能」入口和数字圆圈，页脚只留 `n / 5`
  - 引导只在首次打开自动出现；关闭后写入 `startnow.onboarded`，之后不重复弹
  - 真实「我的」页同步引导稿的淡紫头部、真实统计和头像选择

更早的视觉、可访问性、窄屏修复仍在分支历史里，关键提交为 `90e498c`、`40a2ed8`、`18142ce`、`4f6efe7`、`31dff29`。

## 3. 页面与组件地图

没有路由库，`App.tsx` 用 `view` 状态切换；试试与论坛共用 `home` 视图，由 `homeTab` 区分：

| 视图 | 入口 | 主要组件 |
| --- | --- | --- |
| 试试 | 顶栏/底栏「试试」 | `StepBoard.tsx`（下一步、统计、小事） |
| 论坛 | 顶栏/底栏「论坛」 | `CardRow.tsx`（列表），搜索与分类在 `App.tsx` 内联 |
| 卡详情 | 点任意卡片 | `CardDetail.tsx` |
| 群聊 | 顶栏/底栏「群聊」 | `RoomView.tsx`（懒加载），内部 `RoomPanel.tsx`、`ChatRoom.tsx` |
| 发一张卡 | 底栏/首页入口 | `PostForm.tsx` |
| 我的 | 顶栏/底栏「我的」 | `App.tsx` 内联：身份、头像、统计、我的任务/卡片、我帮过的人 |
| 我的卡 | 「我的」页入口 | `App.tsx` 内联，复用 `CardRow` |
| 便签 | 右侧浮标/底栏「便签」 | `NoteDrawer.tsx` |
| 设置 | 顶栏设置图标/我的 → API 设置 | `SettingsDialog.tsx`（懒加载） |
| 作者后台 | 我的 → 作者后台 | `AdminPanel.tsx`（懒加载），含 `ArchivePanel` |
| 新手引导 | 首次打开；我的 → 怎么玩 | `Onboarding.tsx`（五步全屏） |
| 危机卡 | 命中危机词 | `CrisisCard.tsx` |

公共件：`Avatar.tsx`（有 `name` 时显示名字首字，否则显示预置图形）、`GuideCard.tsx`、`MemoryManager.tsx`。

顶栏平级入口为「试试 / 论坛 / 群聊 / 我的」，右侧是加号、设置、通知、头像。手机底栏为「试试 / 论坛 / 群聊 / 发一张卡 / 我的 / 便签」。

## 4. 样式与断点

- 样式加载顺序写在 `src/main.tsx`：
  `styles.css` → `theme.css` → `theme-v2.css` → `room.css` → `onboarding.css`
- 主要文件：
  - `src/styles.css`（约 4,518 行，基础布局）
  - `src/theme.css`（约 2,495 行，旧主题层）
  - `src/theme-v2.css`（约 1,879 行，当前淡香芋紫主题）
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
  - 群聊另有 `≤ 720` 的聊天布局调整
  - 新手引导：`≤ 1080` 缩放示意；`≤ 860` 改为纵向卡片；`≤ 560` 收紧；`≤ 380` 隐藏第二条帖子和部分装饰，保证按钮在视口内
- 已知技术债：媒体查询分散在 5 个 CSS 文件，合并时注意层叠顺序；新增覆盖前先确认原规则来源。

## 5. 数据与状态

纯前端单机，无后端、无账号。主要 localStorage 键（`lib/store.ts`）：

```
shudong.config.v1        API 配置
shudong.cards.v6         卡片/评论/下一步/便签
shudong.personas.v3      同伴人设/记忆/心智
shudong.todos.v1         自己加的小事
shudong.world.v1         调用计数/时间/日志
shudong.settings.v1      节奏与上限
shudong.identity.v2      匿名身份与头像
shudong.room.v1          群聊消息
shudong.roomsettings.v1  群聊设置
shudong.archives.v1      本地归档
```

UI 状态：

```
startnow.onboarded       是否已看过五步引导（'1' 后不再自动弹）
startnow.homeTab         试试/论坛的当前页签
startnow.mode            旧入口模式兼容
```

`App.tsx` 每 4 秒调用一次 `tickCards()`；世界推进与预算闸门在 `lib/cards.ts`。演示模式由本地文案生成回复。
新手引导关闭即写入 `startnow.onboarded=1`；`?onboard=1` 不再强制弹出，需要重看时走「我的 → 怎么玩」。

## 6. 已验证的验收路径

1. 首次打开：五步引导依次出现；第 1 步有「开始体验 / 先逛逛」，第 2–4 步只有「继续」，第 5 步只有「进入 Start Now」；页脚只有 `n / 5`
2. 关闭引导后刷新页面：不再自动弹出；从「我的 → 怎么玩」可以手动重开
3. 顶栏在试试 / 论坛 / 群聊 / 我的之间平级切换；手机底栏 6 个入口均可用
4. 论坛：搜索、分类、帖子列表、AI 同伴怎么看、点开详情与回复
5. 群聊：进入即有开场提示，可发消息，AI 同伴按演示模式回话
6. 我的：改名字、换头像、真实统计（试着启动 / 坚持 / 完成）、我的任务、我的卡片、我帮过的人
7. 发一张卡 → 同伴到场 → 打开详情 → 回复/要下一步 → 贴到便签 → 完成 → 发个炫耀
8. 便签抽屉：自己加、勾选完成、打开来源卡
9. 设置、通知、作者后台：打开、Esc/遮罩关闭、焦点返回
10. 移动端 390×844 全部主页面与浮层；320×700 复核引导第 3 步，按钮仍在视口内

本轮截图复核规格：桌面 1440×1000、移动 390×844、窄屏 320×700。
截图和压缩包只存在本机 `.shots/ui-pack-2026-11-18/` 与 `.shots/startnow-ui-2026-11-18.zip`（均已 gitignore，不进仓库）。
更早一轮的 12 档宽度回归（1440 → 320）未在本轮全部重跑；合并最新 main 后需要重跑。

## 7. 已知问题与下一步

按优先级：

1. **与最新 main 对齐（P0）**
   远端 main 已前进，当前分支基线是 `002b361`。push 前先 `git fetch` 确认差异，用 merge 而非 rebase；预计冲突文件：`App.tsx`、`components/CardDetail.tsx`、`components/StepBoard.tsx`、`components/Onboarding.tsx`、`components/RoomView.tsx`。合并后必须重跑 `npm run build`、`npm run test:all` 与宽度回归。
2. **本地数据可靠性（P1）**
   `store.ts` 写入失败目前静默；建议做存储配额提示、损坏数据恢复、导出/导入入口、跨标签页同步。
3. **真实模型体验（P1）**
   加载/重试/取消、失败兜底、防重复发送、回复来源标识；弱网下避免看起来卡死。
4. **引导示意与真实界面同步（P2）**
   `Onboarding.tsx` 里的论坛、我的、群聊示意是本地复刻，真实页面改版时要同步维护，避免再次脱节；可考虑抽成共享的展示组件。
5. **工程收尾（P2）**
   收敛覆盖式 CSS；补一条 Playwright 冒烟路径；补 `focus-visible`、`prefers-reduced-motion`、iPhone 安全区。

## 8. Push 交付清单

push 前逐项确认：

- [ ] `npm run build` 通过
- [ ] `npm run test:all` 203 项全过
- [ ] 本文件「交付状态」「本次变更」「已知问题」已更新
- [ ] 已 fetch 并处理与远端 main 的差异
- [ ] `git status` 无截图、压缩包、API Key、真实姓名/学校
- [ ] 只推目标分支，不动 main