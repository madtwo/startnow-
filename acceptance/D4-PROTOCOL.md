# D4 真实图片/真实 API 验收（尚未执行）

仅用 `fixtures/tech-material-cases.json` 的 25 个唯一 `id` 做实际图像运行并人工评审；其中 `fixtures/images/` 仅附 5 个代表图。需要人工准备或获取另外 20 张真实测试图，不能将文本样例或同一张图片重复调用冒充 25 张不同材料。不要上传包含个人隐私的真实学籍材料。

每张图片完成端到端后，只写一行 **JSONL 元数据** 到 `acceptance/real-d4.jsonl`，示例：

```json
{"id":"assignment-01","source":"real-api","anchored":true,"actionable5m":true,"latencyMs":3200,"costUsd":0.003,"fallback":false,"requestCount":2}
```

* `anchored`：人工对照图片原文，生成第一步包含可见、非伪造的具体片段。
* `actionable5m`：审核人确认无需更多信息，五分钟内能动手完成。
* `latencyMs`：从点击识别到材料建议显示完毕的实测毫秒数；如果分两段记录，也应将两段合计。
* `costUsd`：按实际提供方响应的 usage 和当时单价计算的本张图片完整链成本，格式重试也必须计入。无法得到 usage/单价则 **不通过**，不能假设为 0。
* `fallback`：结构化抽取或建议使用了模板/澄清回退；`requestCount`：包括格式重试及建议重试的总计费尝试次数。

禁止记录图片 base64、整段 OCR、原始 prompt、原始回复、密钥和联系方式。工具拒绝出现任何额外字段。

完成后运行：

```bash
node scripts/verify-material-d4.mjs acceptance/real-d4.jsonl
```

通过标准：≥20/25 图片锚定、≥20/25 五分钟可做、P95 ≤15 秒、任一完整链费用 ≤$0.01、回退 ≤5/25。必须再从浏览器原图与回复人工抽查 5 张，并做网络请求、localStorage、页面刷新及 375px 的可用性检查。静态源码测试与文本 fixture 测试不能代替本门禁。
