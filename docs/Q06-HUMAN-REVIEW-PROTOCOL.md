# Q06 advice alias · 独立双人盲评协议（候选工具，2026-11-23）

> **当前状态：NO-GO。** 本文件是**协调员**使用的执行说明，不是已完成的人类验收。请勿用 AI 模拟回答、自动测试分数或前一次 Q01 的答卷代替真人签核。

## 这个 Q06 与 `DELIVERABLES` 里的「Q06」不是同一件事

- 这里的 **Q06**：advice alias 的动作范围与可执行性盲评，检查 **9 条正向候选建议**（8 条 `AL01–AL08` + `C10`）和 **1 条反例 `C04`**。`C04` 必须拒绝；`C10` 必须明确批准。
- `DELIVERABLES/startnow-真人评审-单格版-2026-11-21.csv` 的「Q06」只是 20 行小问卷里的一行**完成归属表述题**，不能充当 advice alias 的 Q06 门禁。
- Q01 的 98 条合成完成归属句另用 `scripts/q01-human-review-gate.cjs`；两套样本、答案、评审记录不得混用。

## 协调员准备（完全离线，Node 内置模块）

从源码根目录执行：

```bash
node scripts/q06-human-review-gate.cjs prepare --out /secure/local/q06-review-run-1
```

终端会打印 `manifest_sha256=...`，协调员须**另外留存**这个 64 位十六进制校验值，复核时使用。生成三个文件：

- `manifest.json`：**仅协调员保存**，包含原始标签、冻结 SHA、双份匿名 token。**不可发给评审员**。
- `packet-a.jsonl`：发给评审员 A。
- `packet-b.jsonl`：发给另一名评审员 B。

请只把对应的 `packet-*.jsonl` 单独发送给评审员。不要把 `SOURCE`、`tests/fixtures`、`manifest.json`、其他评审员答案一起发送；这些会泄露冻结标签，破坏盲评。输出目录已存在时脚本拒绝覆盖。

## 评审员逐份填写

每份 JSONL 第一行 `header` 需填写：

```json
{"reviewer_id":"team-alias-01","reviewed_at":"2026-11-23T08:00:00.000Z","independent_review":true}
```

上面只是**字段格式示例，不是真实评审记录**；只能填写实际完成时间和团队内部非敏感代号。保留其余原有头部字段。

每条 `case` 根据 `actionLabel`、`context`、`candidateLine` 独立判断，只填写 `verdict`：

- `accept`：这句能作为指定动作的**一小步可执行表达**，没有偷偷增加“发送、答应、去找人”等额外动作。
- `reject`：动作不对应、增加步骤、越界/不安全、缺少能照做的一小步。
- `unsure`：确有歧义，需要进一步人工仲裁。

可补 `note`（至多 300 字符），不要包含真人姓名、联系方式、学校或真实用户内容。不得修改其他字段。两人不能讨论答案，也不能共享已填答卷。

## 协调员校验

拿到**实际两个人类**独立完成的答案后，将 prepare 时单独保留的摘要填入 `TRUSTED_Q06_MANIFEST_SHA256` 环境变量，然后执行：

```bash
node scripts/q06-human-review-gate.cjs check \
  --run /secure/local/q06-review-run-1 \
  --a /secure/private/answers-a.jsonl \
  --b /secure/private/answers-b.jsonl \
  --manifest-sha256 "$TRUSTED_Q06_MANIFEST_SHA256" \
  --report /secure/local/q06-result-1.json
```

校验器要求 10/10 完整作答；两人标注代号不同、自行声明独立、时间晚于发包；先验证另外留存的 manifest SHA，再验证原始样本文字和匿名 token 与清单完全一致；`unsure`、任意冲突、与冻结结论冲突均 BLOCKED（exit 1）；元数据错误、篡改或文件损坏 exit 2。`--report` 只能写不存在的新路径。输出统计不包含样本原文或评审备注。

冻结样本 SHA 只容忍 Git/ZIP 传输中的 LF ↔ CRLF 换行差异（归一化为最初冻结的 LF 内容）；任何样本文字、标签、空格、附加内容更改仍拒绝。运行时代码的 SHA 仍按源文件字节精确校验，不做归一化或自动重新冻结。

它还会检查 `src/lib/adviceLine.ts`、`src/lib/actions.ts` 和冻结样本的 SHA；源码改变必须重新冻结评审版本，不能混用旧回执。`ALxx` 是本协议私有协调编号，不保证对应历史审查中的原编号。

## 即便工具返回 READY，发布仍然 NO-GO

`READY_FOR_EXTERNAL_SIGNOFF` 只表示**填写格式和两个自述独立答卷与冻结门禁一致**。脚本不能验证评审员确实是真人、两人确实独立、评分质量或正式签名；报告始终 `release_go=false`、`score_locked=false`。需要团队受控记录真人签名及复核，另外完成 Q01、真实模型和浏览器验收，才可按正式流程考虑 `score-locked`/发布。

不要将真实作答、`manifest.json`、模型原始日志、API Key、评审人的个人信息提交仓库或加入公开 ZIP。本工具单元测试使用的 `synthetic-reviewer-*` 是**模拟数据**，不构成任何真实评审。
