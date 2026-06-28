# 炸弹传递

支持 2～5 人实时联机的浏览器派对游戏。玩家通过房间链接加入，使用剪线、转移目标和护盾坚持到最后。

## 本地 Node 版本

```bash
corepack enable
pnpm install
pnpm run build
pnpm start
```

打开 `http://127.0.0.1:4173`。

## 免费部署到 Cloudflare

项目已经配置为 Cloudflare Worker + Durable Objects：

- Worker 托管 Vite 前端静态文件
- 每个房间由一个 Durable Object 管理
- WebSocket Hibernation 保持多人实时连接
- SQLite Durable Object 可使用 Workers Free 套餐
- 不依赖银行卡或常驻服务器

首次部署：

```bash
pnpm install
pnpm run deploy
```

Wrangler 会引导登录 Cloudflare。部署完成后会返回 `https://bomb-pass-party.<你的子域>.workers.dev` 公网地址。

本地 Cloudflare 运行环境：

```bash
pnpm run cf:dev
```

## 协议测试

Node 兼容服务运行时，可执行：

```bash
node test-multiplayer.mjs
```

测试会创建五名玩家、开始游戏并验证炸弹传递状态同步。

## Render（可选）

仓库中的 `render.yaml` 仍可用于 Render Blueprint 部署。如果 Render 账号要求银行卡验证，可直接使用上面的 Cloudflare 免费方案。
