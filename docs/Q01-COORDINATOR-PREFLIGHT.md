# Q01 冻结基线差异：协调员预检（Patch5）

> **仅供受控协调员查看，不是给盲评人的材料；不是人类评审，也不代表上线批准。**

## 为什么增加这个工具

当前 `src/lib/completionReaction.ts` SHA-256 为：

```text
7d589bf946e937089e355aa1ef1416d576c5c5896c068ce9378080de4d717d18
```

Q01 v1.8 原冻结运行时 SHA-256 仍为：

```text
21db764e500e077a486e310450c5bc146ee54b0171e4636bf45e9f2710d6e7f8
```

两者**不一致**。`scripts/q01-human-review-gate.cjs prepare` 必须继续拒绝，不允许直接把新 SHA 写回 pin。已知变更包括针对坏便签的完成锚点防护；仍需协调员获取当初冻结的 v1.8 源码并做有证据的行为差异评审。

## 执行

在 `SOURCE/` 下：

```sh
# 只读取当前运行时代码及三份冻结 fixtures；stdout 是不含文本和标签的摘要。
npm run review:q01-preflight

# 可选：写入一个新的报告文件。已有文件一律拒绝覆盖。
node scripts/q01-coordinator-preflight.cjs --out ../EVIDENCE/Q01-review-preflight.json

# 验证预检工具逻辑（它不会生成真人投票）
npm run test:q01-preflight
```

在当前状态下，预检故意以**退出码 1**结束，返回 `BLOCKED_RUNTIME_BASELINE_DRIFT` 与 `release_go:false`。退出码 2 代表输入错误、固定样本哈希不匹配或输出文件已存在。`--out` 只支持新文件、按私有权限创建；报告包含哈希和数量，不包含样本正文、预设标签、评审身份或 Key。

## 协调员必须亲自完成

1. 从受控历史版本找出 SHA 为 `21db...e7f8` 的冻结 v1.8 原始运行时代码；确认真实 provenance，不能根据名称猜。
2. 对照当前 `7d58...7d18` 代码审阅改变了哪些完成归属判据，特别是 `docs/Q01-COORDINATOR-NOTES.md` 中的争议项目。形成可审计的人工裁决，决定是否建立 **新的、有版本号** 的运行时冻结基线及测试标签；不直接覆写旧证据。
3. 只有正式重新冻结后才修改 Q01 gate 使用的运行时 pin，并重跑原来的冻结 fixture 校验及全部回归。**这个工具不负责上述动作**。
4. 随后两名独立真人盲评 Q01；再按协议分别完成 Q06 人类双评和独立签收。单凭两份自声明 JSONL 也不能自动证明评审员真实身份。
5. 公开站及实机人工走查通过、负责人签核后才能决定 GO；本包继续标记 **NO-GO**。

## 保持不变的内容

- 冻结三份 fixture SHA 及 98 行的内容与 `expected` 一律不变。
- Q01 v1.8 `RUNTIME_SHA` 常量保持不变；本次只额外导出只读常量供预检调用。
- Q06 自己的固定样本、人类评审门禁和签核流程不受影响。
- 不执行在线模型、不写入 Key、不改 `room/*`、不部署或推送。
