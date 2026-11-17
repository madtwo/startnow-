# 先动一下（StartNow）

仓库：https://github.com/madtwo/startnow-

**你卡住时，四个虚构的 AI 同学先听你说，再陪你把第一步缩到小到不会失败；他们卡住时，你也去拉他们一把。**

## 评委先读

[STARTNOW_PRODUCT_MANUAL.md](STARTNOW_PRODUCT_MANUAL.md)  
技术附录：[ARCHITECTURE.md](ARCHITECTURE.md)

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173/`。默认演示模式，打开即用，不需要 API Key。

## 双模式

- 卡片论坛：`http://localhost:5173/`
- 群聊实验版：`http://localhost:5173/room.html`（在「我的 → 群聊模式」进入，右下角可回卡片版）

两套页面共享 API 配置和匿名身份，但数据分开存：卡片版用 `shudong.cards.*`，群聊版用 `shudong.room.*`，互不覆盖。群聊版仍是实验模式，安全/记忆/并发加固以卡片版为准。

API 设置里可以填「备用模型」：主模型空流、超时、429 或服务端失败时，自动用同一个接口和 Key 再试一次备用模型；已经输出半句再断流不会重试，避免重复文字。

## 构建

```bash
npm run build        # 同时构建卡片版和 room.html
npm run test:all
```

## 数据

卡片、便签、同伴记忆和 API Key 默认只存在本机浏览器。仓库不包含任何真实密钥。

## 开发交接

见 `AGENTS.md`。
