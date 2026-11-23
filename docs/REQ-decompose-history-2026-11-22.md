# 需求包：目标拆解重置与浏览器返回（2026-11-22）

## 1. 触发案例

1. 自动拆解连续问 3 个问题。中途关闭再回来，会停在离开时的问题；之前填过的答案没有入口清掉。
2. 三问结束后点“重新拆解”没有反应；只有“加入目标并排日程”才会清空草稿。
3. 站内返回都是内部按钮；使用浏览器返回会直接离开站点。

## 2. 根因

### 拆解

- `DecomposeSheet` 按设计在关闭时保持挂载，`goal/answers/questionIndex/phase` 都留在 React state 里。
- 草稿只在组件首次挂载时读取一次 `DECOMPOSE_DRAFT_KEY`，之后关闭/重开不会刷新。
- 没有“清空答案 / 清空草稿”的入口；`返回修改` 只改 phase，不撤回答题。
- 预览页没有“重新拆解”动作，用户只能保存或放弃方案。

### 浏览器返回

- `view`、`homeTab`、`detailId`、`goalId` 只存在于 React state，没有写入 `history`。
- 浏览器的 back 找不到站内记录，于是直接离开页面。

## 3. 需求

### R1 拆解必须可重置

- 在问题页、失败页、预览页提供“重新拆解”。
- “重新拆解”必须：
  - 中止当前请求；
  - 清空 answers、grillAnswers、questionIndex、plan、checked；
  - 回到 entry；
  - 保留 goal（用户可继续改），除非用户点“清空草稿”。
- entry 提供“清空草稿”：清空 goal、deadline、manualSteps、answers，并删除 `DECOMPOSE_DRAFT_KEY`。
- 预览页保留“返回修改”和“放弃方案（保留草稿）”，但必须有独立的“重新拆解（清空答案）”。

### R2 草稿恢复与重置的边界

- 关闭窗口仍保留草稿，这是预期行为。
- 重新打开可以恢复离开时的问题，但必须能一键清空，不允许只能通过保存到日程才能重来。
- 重置后再次启动，必须从第 1 问开始。

### R3 浏览器返回

- 每次 view/homeTab/detailId/goalId 变化写入 `history.pushState`。
- `popstate` 恢复对应状态，并且关闭 settings/admin/drawer/decompose 等浮层。
- 站内 `← 返回` 使用 `history.back()`，与浏览器返回同一条路径。
- 从卡片详情、日程、群聊等子页面按浏览器返回，必须回到上一站内视图，不得直接退出站点。
- 首页是历史起点，继续 back 离开站点属于浏览器正常行为。

## 4. 测试矩阵

| 编号 | 操作 | 期望 |
| --- | --- | --- |
| D1 | 关闭在问题 2，重新打开 | 回到问题 2/3（保留草稿，可接受） |
| D2 | 问题页点“重新拆解” | 回 entry，goal 保留，answers 清空 |
| D3 | entry 点“清空草稿” | goal/deadline/manualSteps/answers 全空，draft 删除 |
| D4 | 三问结束预览点“重新拆解（清空答案）” | 回 entry，再次开始从问题 1 开始 |
| D5 | 重置后重启 | 不出现旧答案，不直接跳到旧问题 |
| H1 | 打开卡片详情，浏览器 back | 回到 feed，URL 仍在站内 |
| H2 | 切到日程，浏览器 back | 回到切换前视图 |
| H3 | 卡片详情点“← 返回” | 与浏览器 back 行为一致 |

## 5. 验收

```sh
npm run test:baseline
npm run test:v4
npm run build
node --test tests/decompose-reset-history.test.cjs
node --test tests/personalized-sheet-runtime.test.cjs
```

浏览器独立无头验收：

- 关闭在问题 2 → 重开到问题 3 → 点“重新拆解” → goal 保留、answers 为空 → 重新开始问题 1。
- 卡片详情浏览器 back → 回 feed；日程浏览器 back → 回上一视图；站内“← 返回”同样回上一视图。

## 6. 不做

- 不把“关闭即清空”作为默认行为；用户可能只是暂时离开。
- 不删除旧草稿的兼容读取。
- 不用 `location.href` 或整页刷新模拟返回。
- 不因为浏览器返回而丢当前表单：重置必须是显式按钮。
