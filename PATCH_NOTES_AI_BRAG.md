# StartNow 第三轮：AI 接受建议后发布独立炫耀卡

日期：2026-11-17  
**核心补丁基线**：本次上传的 `startnow-ai-brag-requirements-2026-11-17.zip` 内 `code/` 文件（需求说明标识为 `main @ ecaade0`）。  
**作用域**：仅卡片论坛 `/`；不变更 `room.html`、群聊存储、群聊角色 NextStep。

## 补丁与基线

- `startnow-ai-brag-core-2026-11-17.patch`：**优先应用**。只触及本次包确实提供的源码、package.json，并新增独立领域库和测试；在附件提供的精确文件快照上做了 `git apply --check`、实际应用和字节一致性验证。以新版本源码为基线，不依赖上一轮旧版 ZIP。
- `startnow-ai-brag-admin-optional-2026-11-17.patch`：作者后台的可见按钮、排期表、日志 UI。**此文件是以前一轮完整源码中的 `src/components/AdminPanel.tsx` 为基线生成的**，本次附件没有提供最新版该文件。先 `git apply --check`；如冲突，只把补丁中的新增 props 和「炫耀卡 · 独立分钟级调试」部分手工合并，绝不能覆盖最新版整个组件。
- `startnow-ai-brag-overlay-2026-11-17.zip`：仅包含本轮新增/修改文件、两个补丁及说明的覆盖包，**不是完整主仓库备份，也不包含新版 room 源码**。优先应用 `.patch`，不要直接拿旧完整 ZIP 覆盖当前主仓库。

## 核心状态流

```text
玩家在 AI 自己的卡中发 advice
  -> AI decide「接受」 -> card.advice.accepted = true
  -> 新增 card.pendingBrag {personaId,acceptedAt,dueAt,adviceText,sourceCommentId,actionId?}
  -> 页面隐藏/刷新仍随 shudong.cards.v6 持久化
  -> 到期 tick：先检查新烦恼 / 已关闭 / 危机 / noMemory / 重复源
  -> 模型短调用：BRAG_CARD_RULES + systemFor + withUntrustedHistory
  -> 输出审查 + 动作锚点；不合格/模型失败 -> 动作相关模拟兜底
  -> 原卡设为 done 且不追加 FOLLOW_LINES 回复
  -> 新建独立 Card(kind='brag', authorKind='persona', origin='model'|'simulated')
  -> 新卡留 sourceCardId / sourceCommentId / sourceAdviceText；原卡留 bragCardId
```

### 延迟、时间顺序与幂等

- 有合法 `actionId`：使用 `ActionItem.minutes`。
- 没有 actionId：估算跑步约 11 分钟、走两步约 3 分钟、打开页面约 3 分钟、写三行约 4 分钟、询问约 9 分钟、投递约 7 分钟；未知动作 4–10 分钟。
- 延迟公式（有基础分钟数）：`clamp(base * U(0.8,1.4) + U(0,2), 2, 20)` 分钟，每条建议重新独立采样；**不再按原型 speed=6 压成 15 秒**。作者后台另有分钟级测试入口。
- 新烦恼守卫只看 **同一角色** 的后续非 brag 卡；排期时、产生新卡时及发卡前都检查。发现后移除待发并把旧源卡标为 handled，日志 `brag cancelled: newer worry`。
- 源卡关闭、危机、noMemory、拒绝建议、不安全文本均不安排/不发。刷新后从源卡里的 pendingBrag 恢复，发卡和完成源卡是一次 `setCards` 提交；`sourceCardId` 防重。`createdAt` 使用真正发卡时间，不回填旧时刻。
- 旧 v6 不含新字段时无需迁移；导入时校验任务结构并拒绝不安全内容。

### 文案与来源

- 模型生成 30–60 字左右，1–2 句，需要具体动作和一个可观察细节，四个角色口吻不同，允许没做完或结果不好。
- 拦截危机、联系方式、线下邀请、诊断、用药、依赖及空泛套话；模型输出未锚定动作时退回特定动作的模拟文案，`origin:'simulated'`，不伪装为模型。
- **这是角色虚构的「模拟执行」剧情，不是现实世界的行动或真实发出的简历。** 展示保留 AI 标记、模型/模拟来源；新卡详情提供「从你给的建议」与「查看原卡」。
- 由于每五小时的环境 brag 是与执行无关的固定文案，本轮在论坛 App 暂停自动插入该类卡（旧 `personaBrag` 函数不删除，方便后续产品决定是否恢复）。
- 玩家自己的 brag / note / completeCard / 评论叠楼逻辑未改。

## 作者后台调试

额外安装 `admin-optional` 补丁后，在「作者后台 → 圈子」可操作：

- +3 / +10 / +30 分钟：**仅移动 pendingBrag 到期时间**，不修改原帖 `createdAt`，不生成其他烦恼卡；调用专用 `tickCards({bragOnly:true})`。
- 触发下一条、取消该角色待发、模拟该角色发一张新烦恼，以及 pending 排期列表。
- 原有 +1/+3/+12 小时与速度滑杆继续保留；世界日志显示 `brag scheduled/fired/cancelled`，不记录 API Key。

## 验证范围与诚实边界

- 在本次附件提供的 **新版本 6 个源码文件 + package.json**，与上一轮未提供模块的测试副本合并后：**199 / 199 条 Node 离线回归通过（旧 183 + 新 16）**。
- 新增测试覆盖：估时抖动、accept -> pending -> 独立卡、未到期、48 小时离线恢复、重复 tick/存档刷新、关闭/拒绝/危机/noMemory、同角色新 worry 取消、自由文本安全拦截、4 角色 fallback、模型成功与网络失败、低信任记忆分层、bragOnly 隔离、TSX 语法。
- 核心 TypeScript 库通过 `tsc --strict --noUnusedLocals --noUnusedParameters`。由于本次附件**没有**新版 `src/config/providers.ts` 和新版 `AdminPanel`，类型检查中使用上一轮兼容测试副本的 `ProviderPreset.fallbackModel?: string`，**没有把此兼容占位改动放进生产核心补丁**。
- 当前环境 `npm ci` 返回 npm 内部 `Exit handler never called!`，无法完成完整 Vite 构建、完整 TSX 类型检查、375px 真机 UI 和真实 API 体验验证。旧版测试副本不包含新双模式 room 源码，因此不能据此声称当前主仓库的 `/room.html` 构建已验证。

## 在你的新版仓库应用

确保当前在 `D:\\shenye-shudong`，最好先提交或备份尚未提交的更改和本地浏览器存档。

```bash
git apply --check /path/to/startnow-ai-brag-core-2026-11-17.patch
git apply /path/to/startnow-ai-brag-core-2026-11-17.patch

git apply --check /path/to/startnow-ai-brag-admin-optional-2026-11-17.patch
# 上一步通过才执行：
git apply /path/to/startnow-ai-brag-admin-optional-2026-11-17.patch

npm ci
npm run test:all
npm run build
npm run dev
```

## 手工验收重点

1. AI 自己的卡 → 玩家用「给下一步」建议「打开招聘网站只看一个岗位，不投简历」→ 接受后查看作者后台 pending 的到期时间。
2. 使用作者后台 **只推进炫耀任务**。原卡不增加「没那么难」评论；新卡出现在「今天」，包含「看岗位」而非误写成「投出了简历」，有具体结果。
3. 点新卡可看到「AI 角色模拟执行 · 从你给的建议」与原卡链接；原卡可跳转到新卡；新卡可点赞评论。
4. 刷新后不重复；同角色先新发烦恼再快进时无旧 brag，日志 `cancelled: newer worry`。
5. 手动关闭/危机/拒绝/无记忆时不发；玩家自己发布 brag、便签流程、375px 长回复树和群聊 `/room.html` 均未破坏。

## 待产品最终确认的取舍（可先按当前默认试玩）

1. **环境炫耀**：本轮暂停无关联的定时环境 brag；以后是否以更低频率恢复并另标「环境模拟」？
2. **延迟和时间推进**：默认按现实分钟估算、2–20 分钟封顶，不受原型 speed 倍率压缩；评委演示是否需要一个显式「演示速度」开关？
3. **模拟动作真实性**：AI 不会真的完成线下或外部服务操作；是否统一把新炫耀标题改成「模拟试了这一步」，更突出虚构情节？
