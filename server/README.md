# StartNow 模型网关（阶段 1 原型）

本目录是后端阶段 1 的**本地原型**，不是生产服务。已存在默认关闭的 llm.ts 文本传输试接入，尚未覆盖全部模型入口。
它只验证决策包中 P0 的网关形状：匿名会话、BYOK、供应商白名单、原子额度、安全前置、有界 SSE 验证、脱敏日志。

边界（不要越过）：

- 只有 BYOK：Key 由请求头逐次携带，不落库、不写日志、不进仓库。
- 没有共享 Key、没有账号同步、没有服务端离线生成；前端文本接入默认关闭。
- 不是发布授权。Q01 仍 `BLOCKED_RUNTIME_BASELINE_DRIFT`，Q06 未评审，`release_go=false`。
- 安全检测只是**显式危机词**兜底，不是分类器，不替代客户端既有守卫。

## 运行

需要 Node 22+（使用内置 `node:sqlite`）。

```bash
node server/server.mjs
# 默认 http://127.0.0.1:8787，SQLite 在 server/data/gateway.db
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `GATEWAY_PORT` | `8787` | 监听端口 |
| `GATEWAY_DB` | `server/data/gateway.db` | SQLite 路径；`:memory:` 为内存库 |
| `GATEWAY_SESSION_SECRET` | 随机 | 不设置则每次启动会话全部失效 |
| `GATEWAY_PROVIDER_ALLOWLIST` | 空 | 逗号分隔的供应商 base URL；为空则拒绝一切供应商 |
| `GATEWAY_ALLOWED_ORIGIN` | `http://127.0.0.1:5173` | 唯一放行的 CORS 来源 |
| `GATEWAY_DAILY_LIMIT` | `60` | 每会话每日成功预占次数 |
| `GATEWAY_MINUTE_LIMIT` | `10` | 每会话每分钟请求次数 |
| `GATEWAY_CONCURRENCY_LIMIT` | `2` | 每会话并发上限 |
| `GATEWAY_GLOBAL_DAILY_LIMIT` | `600` | 同一 SQLite 库跨会话 UTC 日预占总上限（待批准工程默认值） |
| `GATEWAY_GLOBAL_CONCURRENCY_LIMIT` | `8` | 单进程全部会话并发上限 |
| `GATEWAY_SESSION_ISSUE_LIMIT` | `60` | 单进程每 UTC 分钟签发上限 |
| `GATEWAY_REQUEST_BODY_TIMEOUT_MS` | `10000` | Authenticated chat body total read deadline (ms); local prototype default |
| `GATEWAY_MAX_PENDING_UPLOADS` | `16` | Per-process authenticated chat uploads in progress, independent of upstream concurrency; 0 disables chat uploads |
| `GATEWAY_SHUTDOWN_TIMEOUT_MS` | `5000` | 停服等待在途连接的上限，超时强制断开 |

## 接口

- `GET /v1/health` — 公开，返回 `{ ok, phase, providers }`。
- `POST /v1/session` — 签发匿名会话 `{ token, expiresAt }`。
- `POST /v1/session/revoke` — 需 `Authorization: Bearer <token>`，撤销会话。
- `POST /v1/chat` — 需 Bearer token + `x-provider-key`：
  ```json
  {
    "providerBaseUrl": "https://allowed.example",
    "model": "some-model",
    "messages": [{ "role": "user", "content": "..." }],
    "maxTokens": 600,
    "stream": true
  }
  ```
  成功时返回经过有界单文本完成协议校验的 SSE（`stream !== false`）或 JSON。错误码：`unauthorized`、`provider_not_allowed`、`invalid_messages`、`provider_key_required`、`safety_blocked`、`rate_limited`、`concurrency_limited`、`quota_exhausted`、`upstream_timeout`、`upstream_failed`、`upstream_too_large`、`upstream_protocol_error`、`session_revoked`、`ledger_unavailable` 等。

上游请求固定 `POST {base}/chat/completions`，`redirect: 'error'`，附稳定会话头 `x-opencode-session: gw_<sessionId>`；不发送 `stream_options`。

## 已实现的确定性行为

- 白名单比较是规范化后的**完全相等**，不做前缀/通配匹配；带凭证、查询串或 fragment 的 URL 一律拒绝。
- 危机词命中在配额与出站之前失败关闭，不记正文；只检查 `user` 消息（系统提示里的规则文本不算输入），零宽/方向控制字符会先剥离再匹配。
- 额度用 SQLite `BEGIN IMMEDIATE` 事务预占，跨请求原子，按 UTC 日期切换；每次出站前预占尝试均保守计量；预占后授权变化、上游失败或结果未知均不退还，校验/安全/限流拒绝不占额度。
- 额度和 `attempts` 台账在同一个事务里写入，结算为 `ok`/`upstream_error`/`timeout`/`aborted`；崩溃遗留的 `reserved` 表示结果未知。
- 启动时把创建时间早于“总超时 + 60 秒”的 `reserved` 结算为 `unknown`。
- 停服先停止接收，再等 `GATEWAY_SHUTDOWN_TIMEOUT_MS`，超时强制断开连接，额外最多等 1 秒在途 handler 结算。非协作上游仍可能留下 reserved。
- 响应体与流式累计都有 2 MiB 字节上限，JSON 增量读取；流式已发出 200 时若超限或异常，强制断开，不能用干净 EOF 冒充成功。客户端网关模式需要已知结束标记与干净 EOF。
- 请求体超过 128 KiB 返回 413 并关闭连接，不进入校验或出站。
- 上游超时 504；过滤 422、429/Retry-After、上游权限和额度错误保留脱敏分类；不明 4xx 作为终止错误，不自动 fallback；其他非 2xx 或不支持的媒体类型 502。SSE 台账 ok 仅为传输成功，不是角色完成或语义验收。
- 日志仅记录 requestId、方法、固定路由标签、HTTP 状态、传输结果、耗时、会话短标签；台账错误不记录原始异常。新 attempt 的 model 列保存使用会话签名密钥计算的 HMAC 标签，不保存任意客户端模型字符串；历史库未自动迁移。

## 已知限制（上线前必须解决）

- 匿名签发有限速，但身份仍按会话计；重新签发可绕过会话额度，直到本地同库全局日额度耗尽。B02 的稳定安装身份落地前不能对外。
- 分钟限流桶在内存里，只适用于单进程；多实例需要外部存储。
- 只覆盖 OpenAI 兼容 `/chat/completions`，没有供应商差异适配。
- 没有 operationId 幂等键：客户端重试是独立 attempt，各自计量。
- 启动恢复扫描假设单进程；多实例共享同一个库时无法安全区分在途与遗留。
- 危机守卫是显式短语兜底，不是分类器，不能单独承担安全职责。

## 测试

```bash
node --test server/tests/gateway.test.mjs
```

测试使用注入的假 `fetch` 或真实 loopback HTTP 合成供应商，不访问真实模型、不使用真实 Key。

## 前端接入（可选，默认关闭）

```bash
VITE_GATEWAY_URL=http://127.0.0.1:8787 npm run dev
```

- 构建时注入该变量后，llm.ts 的文本聊天和连接测试改走 `/v1/session` + `/v1/chat`；无效非空配置在这些入口拒绝直连。默认空串保留原路径。不能据此宣称构建字节相同或识图、材料、拆解等所有独立入口已纳入网关。
- 设置里选「自定义（OpenAI 兼容）」：Base URL 填**上游绝对地址**（必须在 `GATEWAY_PROVIDER_ALLOWLIST` 内），Key 填上游 Key；仅两个内置精确 `/api/opencode[-go]/v1` 路径映射到固定绝对地址；其他相对路径拒绝。若部署覆盖 Vite 上游环境变量，必须核对映射，不得默认当作等价。
- `GATEWAY_ALLOWED_ORIGIN` 必须精确等于前端来源（默认已是 `http://127.0.0.1:5173`）。
- 传输层单测：`node --test tests/gateway-client.test.mjs`。

## 未做（需要单独批准）

- 生产同源 TLS 部署、默认启用与设置页可视化（目前只有构建期 `VITE_GATEWAY_URL` 开关）
- provider 协议差异适配（目前只覆盖 OpenAI 兼容 `/chat/completions`）
- 账号绑定、实体级同步、按需队列
- 真实网络/供应商兼容验收、R-01/C-02 重采样

## 独立审查后的新增约束（候选，未批准生产）

- 前端和上游两个方向都禁止重定向；供应商默认 HTTPS，仅开发 loopback 允许 HTTP。
- 有 Origin 但不匹配时拒绝，而不是只去掉 CORS 响应头；没有 Origin 的 CLI 仍可调用，故这不是认证。
- 消息契约只接受 role/content，至少一条 user；Unicode 不可见/控制字符归一化只用于显式危机短语检查。**role 由客户端提交，不可信**；完整可信输入契约仍是开放门禁。
- 会话读取请求体后再核验一次；同一 JS 运行时共享进行中的签发/刷新；不是跨标签或稳定安装身份。
- ledger 结算失败阻断后续签发与生成，health 返回 503；不退还已预占额度。部署需设计恢复、告警、清理及独占/多实例协议。
- 仅为本地 BYOK 原型；稳定匿名主体、生产级全局/跨实例限制、operationId、来源可信、所有入口接入、TLS 生产部署均未完成。禁止默认启用或公开监听。

```bash
# Node 22.16 需要显式 TS strip；Node 24 可直接运行
node --experimental-strip-types --test server/tests/gateway.test.mjs tests/gateway-client.test.mjs tests/gateway-audit.test.mjs
node --test tests/gateway-llm-integration.test.cjs
```

## 第二轮自审加固（本地原型）

- 服务仅绑定 127.0.0.1 或 ::1；仍非生产 TLS 部署。
- 严格单文本完成协议：JSON 必须有一个 choice、非空文本和 stop；SSE 需要合法终止信号、非空正文、正常 EOF。拒绝过滤、错误事件、异常 UTF-8、工具调用、异常 choice、超限与截断。
- SSE 终止帧保留到上游 EOF、授权复查和台账成功结算之后；发送正文后失败则断开，不把普通 EOF 伪装成成功。支持的兼容格式受测试约束；不能保证任意供应商兼容。
- 会话撤销中断本进程的在途请求，读取过程中再次验证权限；客户端缓存重置使用世代和取消信号，阻止旧令牌/任务继续。尚未验证真实产品所有清空入口是否调用此 helper；存储不可用后的跨刷新持久化保证仍未建立。
- 同一 SQLite 库内跨会话日总额度事务预占，账本不一致失败关闭；重启不清除已消费额度。无需修改 schema。分钟签发和并发仍为单进程限制；不保证跨实例运行、稳定主体或 operationId 幂等。
- 网关模式不自动 fallback 到备用模型，避免未知出站结果重复消费；仅明确的预出站 unauthorized 响应允许一次重新签发。直连模式保持旧路径。
- 600/8/60 为候选工程默认值，非正式批准生产额度。

```bash
node --experimental-strip-types --test server/tests/gateway.test.mjs tests/gateway-client.test.mjs tests/gateway-audit.test.mjs tests/gateway-self-review.test.mjs tests/gateway-self-review-wave2.test.mjs
node --test tests/gateway-llm-integration.test.cjs tests/gateway-self-llm.test.cjs
```


### Round 3: local gateway integrity boundaries

- The authenticated chat upload is limited before upstream reservation: 128 KiB byte limit, early declared-length rejection, 10 s total body deadline, and 16 simultaneous pending uploads by default. Timeout/overflow/disconnect does not spend model quota. These are process-local controls, not an internet-facing DoS defense; header/socket limits and distributed rate limiting still need deployment design.
- In the current UTC day, the quota transaction compares every session's attempt count with its quota row. Compensating mismatches fail closed; deleting or replacing both consistent ledgers still requires independent recovery/integrity controls.
- The success settlement UPDATE checks the attempt's session is active in the same SQLite statement. Revocation before this statement prevents success; revocation after its commit can still race with final network delivery. Cross-process immediate cancellation remains out of scope.
- Explicit non-assistant response roles or nonempty refusal fields do not constitute a valid text completion. Empty/null refusal and absent/null role are tolerated for compatibility. Direct mode remains unchanged. No gateway automatic fallback on these failures.
- Empty query/fragment delimiters in gateway/provider base URLs are rejected, rather than allowing suffix concatenation into a query/fragment. Encoded path characters remain valid.
- Client bounded body reads observe caller cancellation even when the body itself does not cooperate. Cancellation does not promise that the provider was never charged.

### Round 4: final local prototype hardening

- Gateway-mode operations capture the session-cache epoch before entering the provider queue, including connection tests. Reset cancels old queue entries and response reads. A cancelled error-body read must not apply stale Retry-After/backoff or discard unrelated queued actions. Default-disabled direct mode does not inherit this gateway epoch.
- Gateway and client fetch waits observe cancellation even for a non-cooperative injected adapter; bounded response readers explicitly cancel unread bodies and do not await arbitrary cancel callbacks. Late responses are disposed of and late rejections handled; an already reserved attempt remains counted. A non-cooperative transport may still physically run after the gateway stops waiting. Real providers/adapters must honor cancellation; this is not a promise of remote cancellation or refund.
- A successful model completion must use HTTP 200; other 2xx (including 206 partial content) are rejected. Session issuance accepts the existing HTTP 200 compatibility contract or 201, not 202/206. Both server and LLM validation require visible text rather than only whitespace, invisible format characters, or controls; actual valid text, including emoji joiners, is preserved byte-for-byte at the string level. Provider-specific deviations require explicit adaptation, not weakening the gate.
- No schema, frozen review material, legacy direct-mode behavior, or default limit changes. No shared key or public listener. No new production claims.

Run all targeted tests from project root (Node 22.16 and TypeScript 5.8.3 used in the recovered fixtures):

```bash
node --experimental-strip-types --test server/tests/gateway.test.mjs tests/gateway-client.test.mjs tests/gateway-audit.test.mjs tests/gateway-self-review.test.mjs tests/gateway-self-review-wave2.test.mjs tests/gateway-round3.test.mjs tests/gateway-round4.test.mjs
node --test tests/gateway-llm-integration.test.cjs tests/gateway-self-llm.test.cjs tests/gateway-round3-llm.test.cjs tests/gateway-round4-llm.test.cjs
```
