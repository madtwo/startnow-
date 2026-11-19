# StartNow 优化回执后续补丁（2026-11-18）

## 目标与基线

适用于 `startnow-optimization-receipt-2026-11-18.zip` 中 `code/` 文件的**原始字节快照**（不是初始仓库 `HEAD 1c0effa` 的纯提交）。用户回执注明本地是 `HEAD 1c0effa` + 未提交工作区和后续补丁。请勿直接在旧 `HEAD` 或编译后的 H5 文件上强制应用。

这是一份局部源码补丁；回执只提供相关源文件，不包含完整 `src/App.tsx`、`src/types.ts`、`src/lib/llm.ts`、package-lock 和依赖。因此不保证在未上传的最新完整主分支上零冲突。

## 已实现

1. **P0-1 · OpenCode Go 新预设**：新选择 Go 时，主模型 `deepseek-v4.1-flash`、备用 `glm-5.3-flash`。`opencode` 按量付费的默认模型保持不变，`defaultConfig` 演示模式不变。**现有浏览器 localStorage 配置不会被静默迁移**；需要用户在「我的 → API 设置」手动切换。新的模型可用性还需预检。
2. **P1-3 · 预置动作贴题 + 去重**：保留全部旧 action ID、原缩小链；新增 80 个根动作及更小子动作，细分为考试、论文写作、实验、同学人际、感情、家庭、实习求职、未来方向、睡眠和普通自我关照。新增每个根动作有两种人工编写的可见句式、1–5 分钟执行时长。根据真实卡点选择细分主题；同时采集其他卡片的 `advice` 和角色直给的 `curated` 评论作 24 小时去重。动作池耗尽时生成 **明确标注的预置说明评论**，不伪造 actionId、不替换原建议、不硬塞其他主题。
3. **P1-6 · 论坛小助手去噪**：玩家普通卡的小助手从 4 秒延后至 90 秒（按原 `speed` 缩放），并放到同一 tick 的到场、回复之后决策；有真人设角色评论（含边界回复）或已有小助手提示时不再添加通用评论。无回复时仍保留一次系统状态提示，文案不承诺一定有人出现；危机路径继续拦截。
4. **P1-7 · 作者完成回应指标**：作者后台「圈子」页通过已保存的本机卡片展示最近 24 小时完成事件、主回复数、`model` 比例、模拟兜底及原因、待回复和重复回复数。只显示聚合数值，不复制玩家原文到新日志，也不请求 API。实时性受本地存档刷新影响。
5. **P2-11 · 老存档发卡频率提示**：保留旧设置，不暗中把 2/4 改成 8；作者后台明确显示当前额度，并提示可手工改为 8 以接近每 3 小时一张。

## 回执中仍需由完整项目执行/验证的事项

- **P0-2**：真实 `deepseek-v4.1-flash` 60 链路 `soak`；本轮未获得凭证，也没有调用收费 API。不能声称 `≥95%` 正文率已在新补丁上再次实现。
- **P1-4**：4 张自我介绍卡 × 2 个模型共 8 次真实模型生成；原 Prompt/本地种子测试已存在，本轮未做付费验证。
- **P1-5**：危机内容、评论、危机存档、提示注入存档共 4 个真实链路的端到端验证；本轮未关闭这项安全验收。
- **P2-8/9/10**：跨调用 Token 汇总、8–24 小时真实浏览器挂机及多标签页、群聊版 20 条链路，均需完整仓库环境。没有引入大规模新架构或增加并行路数。
- **P1-3 人工盲评**：本轮本地模拟可以检查规则型重复率，但主题的自然性与贴合度仍需至少 20 条人工评价；目标错配 ≤1/20。

## 验证

- `node --test tests/optimization-receipt.test.cjs`：离线专项测试（无 API）。
- `git apply --check` + `git apply`：应先在用户回执提供的对应工作区快照上运行。
- `npm run test:all && npm run build`：需要完整项目与 node_modules，在回执提交所在仓库运行。
- 本轮审查中使用旧全量源码补齐回执未提供的文件，作为兼容测试副本；旧版 `review.test` 与回执的新开场文案、角色 weekLog 测试有基线冲突。不能将其等同于用户报告的 `312/312` 主分支结果。

### 开发者本地验收命令

```bash
# 先在项目根目录备份未提交文件
 git status --short
 git apply --check /path/to/startnow-optimization-followup-2026-11-18.patch
 git apply /path/to/startnow-optimization-followup-2026-11-18.patch
 node --test tests/optimization-receipt.test.cjs
 npm run test:all
 npm run build
```

### 真实 API 复测

根据回执任务清单，在本地代理、密钥与供应商预算已确认的条件下：

```text
/soak.html?scenario=preflight
/soak.html?scenario=main&chains=60&seed=20261121&run=e1&model=deepseek-v4.1-flash&fallback=&maxCalls=700&maxUsd=0.6
```

注意：URL 参数 `fallback=` 对测试场景是**主动关闭**备用，以便单独观察主模型；不等于产品默认备用配置。`maxUsd` 为本地估算保护，建议同时设置供应商侧消费上限。测试日志保留脱敏的调用指标与兜底原因，不保留用户隐私或 API Key。
