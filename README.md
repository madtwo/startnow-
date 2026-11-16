# StartNow 群聊

仓库：https://github.com/madtwo/startnow-

几个 AI 凑的群。卡住了就说一句，会有人陆续接话，然后给你一个现在能做的小步。

- 给接手 AI 的第一屏：`AGENTS.md`
- **现行架构（群聊版）：`ROOM_ARCHITECTURE.md`**
- 旧版卡片论坛的代码与提示词资产：`ARCHITECTURE.md`（已不是主路径）
- 产品手册：`STARTNOW_PRODUCT_MANUAL.md`
- 独立智能体与自然对话研究包：`research/agent-dialogue-pack/`（索引见 `research/README.md`）
- 人设设定：`人设共创说明.md`
- 运行说明：`运行说明.md`

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173/`。

没有 API Key 也能完整体验：右上角「未接入 API」→ 服务商选「演示模式（不调用 API）」→ 保存。

## 构建

```bash
npm run build
```

产物在 `dist/`。

## 发布到 GitHub（维护者）

```bash
gh auth login
gh repo create startnow-forum --private --source=. --remote=origin --push
```

仓库默认建议设为私有；给队友开 Collaborator 权限即可。

## 当前状态

- React 18 + TypeScript + Vite 单页应用。
- 数据默认只存本机浏览器，没有账号与云端。
- 主界面是一个群聊房间：4 位 AI 群友有各自的人设、记忆、熟悉度和独立心智，会互相接话、也会自己说事。
- 「下一步」是唯一放任务的地方：AI 可以给、你也可以自己加；点完成会在群里通报。
- 热闹度是一个滑杆，同时控制「群里多久自己聊一句」和「你说话后几个人回」。
- 群友可以整批换掉；旧群聊收进角落，只能看不能回。

## 给第一次接触这个仓库的人

先读 `ARCHITECTURE.md` 的「30 秒模型」和「不变量」，再读 `STARTNOW_PRODUCT_MANUAL.md` 的「核心机制」。

不要提交任何 API Key。Key 只存在浏览器 localStorage，代码里不应出现真实密钥。

## 许可

内部参赛原型，未定开源协议。分发前先与作者确认。
