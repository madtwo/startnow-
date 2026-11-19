# StartNow 真实 API 长流程测试台：A3 计量与预算复核

基于用户提供的 A2 长流程测试台改造。**尚未重新发起真实 API 调用**，并不将 A2 历史数据中未采集的指标推算为已验证。

## 使用

本补丁按项目源码布局更新 `src/soak/harness.ts` 和 `scripts/analyze-soak.mjs`。需要确保现有 `soak.html` 的入口正确，并在 Vite 配置中仅对**本机开发服务器**启用 soak sink（生产构建不得包含测试入口）；如果尚未安装 sink，可参考交付 ZIP 内的 `vite.config.soak-snippet.ts`。

```bash
npm run dev
# 测试台预检
# http://127.0.0.1:5173/soak.html?scenario=preflight&run=a3-preflight
# 相同提示词、不同输出预算的诊断，最多 samples×caps 次真实主模型请求（不调备用模型）：
# http://127.0.0.1:5173/soak.html?scenario=budget-ab&run=a3-budget&samples=4&caps=170,600,1200&faults=off&maxCalls=16&maxUsd=0.1
# 长流程
# http://127.0.0.1:5173/soak.html?scenario=main&chains=60&seed=20261118&run=a3-main&maxCalls=700&maxUsd=0.4
node scripts/analyze-soak.mjs a3-main
```

测试页依然读取浏览器**本地配置的 API Key**；请求来自本机代理，不会保存密钥或完整 prompt。测试之前必须检查模型目录价格、账单、费用上限，以及后端代理的回环地址限制；按量付费账户应另设供应商侧额度限制。`maxUsd` 是**本地保守估算+在途预留**，不是供应商侧的绝对计费硬上限。

## 实际计量口径

- **HTTP**：`status/ok` 只是 HTTP 层，不等于成功生成正文。
- **流式内容**：分别记录响应头 `headersMs`、第一块正文流 `ttfbMs`、流完整结束 `streamCompleteMs`、末帧 `finishReason`、可见文字数 `visibleTextChars`、是否出现 `[DONE]`。`latencyMs` 已调整为请求发出至流完成的历史兼容别名。缺少终止标记的兼容网关需单独分析。
- **逻辑操作**：`operationId` 将同一次卡片 tick / 建议生成的主模型和备用模型归组；`operations.completeP50/P95` 是这组请求从最早开始到最晚结束的近似时长，`fallbackOverheadMs` 为粗略差值。后处理和 UI 绘制时延不在内，不能写成精确的端到端用户感知时延。
- **Token**：优先使用 API usage，拿不到时使用估算；记录 `maxTokens`、`completionTokens`、`reasoningTokens`。**没有**自动注入 `stream_options.include_usage`：A2 实测该网关此参数会污染正文流。若运行在其他网关，应单独验证参数兼容性。
- **有效可见正文**：`usableText` 要求本次 HTTP 成功、流读取完成、正文非空且未由 `finishReason=length` 截断。这只是 provider 层初筛，不代表通过 StartNow 语义与安全审核；产品采纳率应以最终卡片 `origin=model` 另行统计。
- **计费**：按目录标价折算美元，非账单实付。**未知模型价格时立即停止**，不默认为免费；`maxCalls` 和 `maxUsd` 阻止新请求，在途请求先预留最高请求输出预算，缺少 usage 时保守按预留成本计数。提供商可能对请求计算额外费用，请以官方账单核对。
- **历史数据**：A2 老日志仅采了请求头耗时，分析脚本将“完整流时延 / 有效正文率 / finishReason”显示为**未采集**，不制造数据。

## 输出

- `.soak-data/<run>-calls-final.json`：每次 HTTP 调用的 token、费用估计、模型、finishReason、streamCompleteMs、operationId，不含完整 prompt、响应正文、Key。
- `.soak-data/<run>-scenarios.jsonl`：链路阶段与 `operation_done` 用时。
- `.soak-data/<run>-cards.json`：仅使用虚构测试数据；可能含模拟用户话语，不上传真实用户导出的存档。
- `scripts/analyze-soak.mjs`：汇总 HTTP 成功与可见正文成功、流时延、完成回复次数和 fallbackReason；旧日志缺失的指标显示未采集。
- `scenario=budget-ab` 会写 `<run>-budget-ab.json`；同一虚构提示词分别使用多档预算，并关闭备用模型，排查推理 Token 耗尽。

## 注意

这是开发测试与诊断工具，**不是**浏览器关闭后的后台服务，也不能替代真实手机和多标签页验收。流式 `finishReason`、成本、usage 在 OpenAI 兼容供应商间可能有差异，不要无对照就直接增大正式运行的模型预算。
