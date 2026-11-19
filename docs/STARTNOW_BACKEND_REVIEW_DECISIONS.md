# StartNow 后端评审决策与验证说明（2026-11-17）

## 适用基线

本补丁以用户上传的 `startnow-backend-review-questions-2026-11-17.zip` 内 `code/` 相关源码为**唯一补丁基线**，不以旧版 ZIP 覆盖前端队友的工作。附件只提供部分代码；如果仓库已有更新，先运行 `git apply --check`，冲突时应人工三方合并。

## 本轮实际实现

| 对应问题 | 做法 | 重要限制 |
| --- | --- | --- |
| Q1 | 对明确教学/否定/游戏/就医/考试语境做小范围误报豁免；一旦同句有另一处明确危险信号，仍然拦截；补了药物过量回归。 | **未**实现“强信号点继续发”按钮，也不是心理危机分类器。隐晦语义仍需要真人与专业服务兜底。 |
| Q2 | 保持危机内容不入库、不进 AI 上下文。用户发帖草稿不主动清空；炫耀草稿遇拦截也不再主动关闭。 | 暂不将危机原话持久化。需要隐私与安全评估后，才能考虑 B/C 选项。 |
| Q3 | `crisis.ts` 增加中国大陆范围和“各地接听时段不同”说明；App 页脚不保证 24 小时。 | `CrisisCard.tsx` 未在本次附件中，另外提供**可选前端补丁**，必须在正式试玩前核对并修正文案。 |
| Q6 | Windows / Shell H5 启动脚本默认只监听 127.0.0.1；只有显式 `--host 0.0.0.0` 才开放局域网；终端提示 HTTP 与本地 Key 风险。 | API Key 仍在原浏览器 localStorage；共享电脑用后需重置。局域网 HTTP 不是加密传输。 |
| Q7 | 在个人资料页提示勿填真实姓名、学校、宿舍号。 | 未内置高校 3000 所名单，也未宣称已全面匿名化。 |
| Q9 | `clearAll()` 包含 `shudong.room.v1`、`shudong.archives.v1`、`shudong.roomsettings.v1`。 | 正在运行的另一自习室页面可能再写回数据；清空前应关闭另一页面。 |
| Q10 | 导入只接收四个代码内置角色的**经过筛查的记忆与状态**，不接受外来人设字段或 `custom-*` 角色定义；`baselineExtra` 保持本机值。 | 外来 memory 仍是不可信数据，提示词仍须持续隔离；自定义角色需在本机另行设置。 |
| Q11 | SSE 缺少 `[DONE]`/`finish_reason` 时，明显断在连接词/未完成动作会报错；兼容不带句号的短完整回复。 | 仅是启发式补丁，不能证明回复完整性；真实服务端应尽量发送正规结束标记。 |
| Q12 | `x-opencode-session` 按**浏览器标签页 + 角色/卡片线程**产生稳定值；同一线程保持，角色之间隔离。 | OpenCode Go 文档将其定位为 coding-agent 流量；情绪支持/论坛场景是否适合该产品，应向供应商确认。 |
| Q13 | 解析 429 的 `Retry-After`（秒数或 HTTP-date，封顶 10 分钟），H5 代理透传该响应头；后台定时任务按剩余时间退避；429 不再同 Key 立即尝试备用模型。 | 还未实现指数退避历史计数。用户主动触发仍可调用，符合目前产品“暂停仅管后台”的语义。 |
| Q24 | 隐藏标签页已有暂停，新增 Web Locks 同源 tick 互斥；收到其它标签页的 localStorage 写入事件，当前页面禁止继续后台生成并提示关闭其它标签页/刷新。 | 非同源或不支持 Web Locks 的 LAN HTTP 页面仍只能依赖提醒。**未**实现多标签页事务或跨标签页状态自动合并。 |
| Q25 | 导入保留本机 `paused`、`dailyCalls`、`baselineExtra`、模型配置及当日 `callsToday`，不允许导入后自动解除暂停或提升预算。 | 内容类设置仍可随存档导入（例如普通烦恼发卡额度）；正式版可再细分。 |

## 本轮明确不改、建议的产品决策

| 问题 | 建议 | 原因 |
| --- | --- | --- |
| Q4 | 原型只展示危机求助，不收集紧急联系人、不自动通知；重复提醒需另做伦理审查。 | 小型本地原型不具备专业值守能力。 |
| Q5 | “可联系校医院/心理中心”放行；“你这是焦虑症”拦截；药物经历分享先维持保守处理。 | 非诊断性求助与医疗指导应分开。 |
| Q8 | 深度记忆保留原有条数上限，继续提供查看/删除入口；留存期限待试用后决定。 | 不应未经告知自动删除用户珍视的互动。 |
| Q14 | 主动请求暂按现状计数但不阻断；“暂停”只影响后台；日期按浏览器本地时区。 | 防止用户刚发帖却因为额度耗尽完全得不到回应，但要明确成本上限不等于硬预算。 |
| Q15 | 自习室与主页预算暂时独立。 | 两套页面仍处于实验阶段。 |
| Q16 | 模型列表 CORS 失败提示手工输入即可，不维护易过期的模型白名单。 | 节制维护成本。 |
| Q17 | **A**：炫耀卡不占普通烦恼额度。设置为 0 的说明应写明“停止新烦恼，不代表取消既有炫耀排期”。 | 保留玩家给予建议后的因果回报。 |
| Q18 | **按角色**取消旧炫耀。 | 不能由魏霓的新烦恼取消沈默的故事线。 |
| Q19 | 继续按角色最近 12 张比较去重。 | 暂无跨角色撞题的实际伤害证据。 |
| Q20 | 暂不硬限制每位角色 24 小时 1 张、也不压低 0–8 的已存在配置。 | 该规则需先做试用观察，避免临时更改用户既有节奏。 |
| Q21 | 先整体丢弃竞态结果，已花费调用仍计费；未来再考虑逐卡乐观合并。 | 避免已删除的卡被后台旧结果复活。 |
| Q22 | 保持现有炫耀模型审核 + 模拟兜底。后续做“结果不得夸大动作”的专项模型测评。 | 当前关键词共现不能证明真实执行。 |
| Q23 | 线下邀约误报维持保守；收集真实用户样本后迭代。 | 人身边界优先。 |

## 本地测试

```bash
# 完整项目仓库根目录，先应用核心补丁（仅一次）
git apply --check /path/to/startnow-backend-review-core-2026-11-17.patch
git apply /path/to/startnow-backend-review-core-2026-11-17.patch

npm ci
npm run test:backend
npm run test:all
npm run build
```

若项目的 `CrisisCard.tsx` 仍有“12356 24 小时”字样，可在**核对文件版本后**应用可选 UI 补丁：

```bash
git apply --check /path/to/startnow-backend-crisis-ui-optional-2026-11-17.patch
git apply /path/to/startnow-backend-crisis-ui-optional-2026-11-17.patch
```

两份补丁分开验证，不要跳过 `git apply --check`。作者后台和群聊的部分最新版文件不在本次附件中，不能据此宣称完整 UI 已验收。

## 运行与试玩注意事项

- `start-h5.sh` 或 `start-h5.cmd` 不带参数：仅本机可访问。
- 在**可信内网**明确要多设备访问：`start-h5.sh --host 0.0.0.0` / `start-h5.cmd --host 0.0.0.0`。此方式是明文 HTTP，**不适合公共 Wi-Fi 或外网暴露**。
- 共享设备试玩后，使用应用内“清空所有数据”并关闭所有关联标签页；如果担心残留，再在浏览器站点设置清除该站点数据。
- 使用自带模拟演示数据时，剧情和 AI 完成动作均为**虚构内容**，不可暗示真实线下行为。

## 本轮参考资源

- 国家卫健委 `12356` 通知（2024-12）：https://ncmhc.org.cn/channel/newsinfo/7902
- 国家卫健委 2025-12 发布会，确认各地已开通：https://www.nhc.gov.cn/xcs/c100122/202512/9731f93a7e0d451284a0da462527cbd2.shtml
- 湖北卫健委 12356 18 小时示例：https://wjw.hubei.gov.cn/zfxxgk/zc/gkwj/ywh/202503/t20250320_5582408.shtml
- OpenCode Go 会话要求：https://dev.opencode.ai/docs/console/go/
- OWASP Prompt Injection Prevention：https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- OWASP HTML5 Security（localStorage 敏感数据）：https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- MDN Retry-After：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After
- MDN Page Visibility：https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN Web Locks：https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- MDN Storage event：https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event
