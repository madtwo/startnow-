# Q01 双评协调员执行与高风险样本（仅协调员）

**不要把本文件发送给盲评人。** 标注员只收到各自的 `packet-a.jsonl` / `packet-b.jsonl` 和 rubric 的评分规则章节。这里列出了有标签暗示的原始样本编号。

## 来源

- v1.8 applied receipt（2026-11-21）源码 SHA：`21db764e500e077a486e310450c5bc146ee54b0171e4636bf45e9f2710d6e7f8`。
- 冻结 20 条：`308e78639dc794747c935a51a9cbf09ea206bfb03404683282498810daf8e3d1`。
- 对抗 20 条：`ef2303096e1f6aa4355d89d7b457cf55a77b09898095d4d8f9242665298e4bc4`。
- 扩展 58 条：`24924f912b9a6ad5a343eff069175757fafebb4403e8f510eb66277d2c481b9b`。

## 标签争议高风险项（先盲评，再仲裁）

- `A18`：无明确“你”，但“问题写下来了，我只是看着”，现有标签为玩家完成；需核实场景是否足以推出玩家为执行者。
- `E27`：他**觉得**你把简历打开了：有他人信念≠执行已被客观确认；当前 synthetic `expected=true`。应重点审查是否属于“未经证实却宣称完成”。
- `E34`：`你也已经写下来了` 没有问题对象，现有 `expected=false`；确认标签区分对象约束和动作施事的边界。
- `E48`：`简历已经被我打开了`，角色自述不应充当玩家行为；确保人称/被动覆盖。
- `P04`、`P06`、`P08`：隐式主语“简历打开了”“那个问题写下来了”，现有标签为完成，需明确基于完成回应上下文的归属假设。
- `A03`、`E53`：`他/你的朋友帮你写下来了`，当前按他人执行拒绝；如产品规格允许代理执行，应重审 rubric，而非直接修改标签。

以上为**审查关注点**，不是人工裁决。两名独立评审员未盲评前，不因这里的猜测修改 fixtures。

## 二级仲裁记录（模板）

每个冲突只记录脱敏元数据：`case_id`、`fixture_sha256`、`rubric_version`、`reviewer_a_id`、`reviewer_b_id`、`a_verdict`、`b_verdict`、`reason_code`、`adjudicator_id`、`adjudicated_at`、`disposition`。完整评审文本保存在受控目录；不要复制进 Git/日志。

推荐 `reason_code`：`implicit_actor`、`reported_belief`、`delegate_action`、`observer`、`shared_actor`、`object_missing`、`other`。

若两人一致反对冻结 expected，生成新 fixture 版本并重新审计，不悄悄覆盖旧 SHA。自动 gate 故意 BLOCKED，等待正式裁决。

## 与其他门禁隔离

- Q01 是“玩家是否完成了 anchor”，Q06 是“alias 行为是否应被识别”；不能复用标签或 reviewer 评分。
- Q06：9 条 advice alias 和 C04、C10 分开做冻结 JSONL + 两个人类盲评；C04 必须拒绝，C10 必须明确通过，随后按现有流程 `score-locked`。
- Q04/Q05：已有 baseline 测试确认 `missing_action` 与 24h cooldown 分开记录；尚未在 16 链真实回放证明 3 条无建议是哪一种原因。后续只输出 action_id/reason/count，无玩家原句。
- 发布总状态继续 `NO-GO`，不得根据本脚本 `READY_FOR_EXTERNAL_SIGNOFF` 声明已获人类批准。
