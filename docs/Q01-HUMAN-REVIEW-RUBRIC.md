> **当前 20de4cb 源码快照的 Q01 前置状态：BLOCKED（需协调员重新冻结）。** v1.8 锁定 `src/lib/completionReaction.ts` 的 SHA 与当前运行时代码不一致，`prepare` 会 fail-closed 退出 2。切勿仅为了跑通工具修改锁定 SHA；必须完成受控源码评估、重新冻结及相应人工签核后再发包。LF/CRLF fixture 兼容性修复仅限同一份冻结样本，不绕过此运行时门禁.

# Q01 双人盲评执行规范（v1.9 候选）

**目的**：对玩家是否实际执行完目标动作进行判定；不是评价文案是否“听起来像完成”。这份补丁不修改 runtime、不判定 Q06、不构成发布批准。

## 先排除标签暗示

- 评审员 A、B 只收到各自的 `packet-a.jsonl` / `packet-b.jsonl`。两份都有同样的 **98 条合成句**，但顺序和匿名 token 不同。
- 发包人**不得**提供 `manifest.json`、源码 fixtures、运行时预测、另一名评审员的答案或项目中的既有 expected。`P/N/A/E` 原始编号及 `expected` / `kind` 均不出现在评审包中。
- `manifest.json` 存在协调员的私有目录；其中**包含** expected，绝不能把整个 run 目录作为评审员附件。

## 评审员填写

每个 JSONL 文件的第一行把 `reviewer_id` 改成团队内部可识别的**非敏感代号**（至少 3 字符），`reviewed_at` 改成实际 UTC ISO 时间，确认真实独立作答后把 `independent_review` 设为 `true`。不填写时门禁拒绝，不要为了让工具通过而虚构身份或时间。

其余行仅修改：

- `verdict`: `"player"` / `"not_player"` / `"unsure"`；保持 `null` 等于未完成。
- `note`: 可选的简短判断理由（不要包含真实玩家内容）。

**不要改动** `token`、`anchor`、`text`、`slot`、`run_id`、`manifest_sha256`。不向不可信在线标注平台上传真实模型日志或玩家原句。

### 判断规则

1. `player`：文字清楚确认玩家（包括“你”或玩家与别人共同）完成了 anchor 对应的动作。允许“你帮他做了”，但“他帮你做了”通常不是玩家亲自执行。若 anchor 允许代理完成，应在裁决时显式确认，而不是自行扩展。
2. `not_player`：只有他人/角色完成；玩家只旁观、命令、猜测、准备、被要求做，或文案明确否认玩家完成。
3. `unsure`：隐含主语、“事情已经做了”但执行者不明、多个动作指代冲突、动作对象不明等真实歧义。**不要为了提高一致率强选**。

特别复核：`看着/看到` 的观察者、`帮/替` 的施事、`我/你一起`、被动句、物主不等于动作执行者，以及缺少目标对象的词面近似。

## 协调员运行

在真实仓库根目录（Node 内置库，不需要 npm 安装）：

```bash
node scripts/q01-human-review-gate.cjs prepare --out /secure/local/q01-review-run
# 把 packet-a.jsonl、packet-b.jsonl 分别发给两名独立评审员；不发送 manifest.json。
node scripts/q01-human-review-gate.cjs check \
  --run /secure/local/q01-review-run \
  --a /secure/private/answers-a.jsonl \
  --b /secure/private/answers-b.jsonl \
  --report /secure/local/q01-review-result.json
```

运行前若已有同名路径，`prepare` 会拒绝覆盖；`check` 的 `--report` 也只允许创建全新报告。再次运行请选新文件路径。

检查器会拒绝：fixture SHA 漂移、原始样本被改、匿名 token 重复/缺失、同一个 reviewer ID、未声明独立复核、时间格式不符、无效判定或 98 条不齐。`unsure`、两人意见冲突、两人一致但和冻结标签不一致，都返回 BLOCKED（exit 1）。脚本无法认证真人身份；真实签名和审阅记录应保存在团队受控流程中。

输出报告只含统计、案例原始 ID 和 SHA，不含句子或 reviewer note。即使全部通过，也只表示 `READY_FOR_EXTERNAL_SIGNOFF`，`release_go=false` / `score_locked=false`。

## Q06 独立阻塞

9 条 advice alias、C04、C10 必须在**另外的**冻结 JSONL 上由两名不同人类独立盲评并完成 `score-locked`；C04 必须拒绝，C10 必须明确批准。不可把 Q01 审阅结果复用为 Q06 签核。

## 停损

出现标签争议、误拒或误放行：保留原始评审意见与 SHA，先仲裁/保守冻结；不就地改固定标签再跑出漂亮分数。回滚仍以 v1.8 包内 `rollback.sh --check` / `--apply` 为准。除受控评审，不 commit / push。
