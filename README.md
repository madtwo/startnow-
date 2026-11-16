# StartNow 论坛

仓库：https://github.com/madtwo/startnow-

一个不保证长期陪伴、只帮你看清此刻能做的最小一步的匿名卡片论坛。

- 产品手册：`STARTNOW_PRODUCT_MANUAL.md`
- 代码与 AI 交接：`ARCHITECTURE.md`
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
- 四位 AI 同伴拥有各自的人设、记忆、熟悉度和独立心智，会互相回帖、影响彼此状态。
- 下一步由卡片主题决定，并支持「做不到再小一级」。
- 便签包含未完成、自己加的、已完成三个区域。

## 给第一次接触这个仓库的人

先读 `ARCHITECTURE.md` 的「30 秒模型」和「不变量」，再读 `STARTNOW_PRODUCT_MANUAL.md` 的「核心机制」。

不要提交任何 API Key。Key 只存在浏览器 localStorage，代码里不应出现真实密钥。

## 许可

内部参赛原型，未定开源协议。分发前先与作者确认。
