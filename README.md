# 炸弹传递

支持 2–5 人实时联机的浏览器派对游戏。玩家通过房间链接加入，使用剪线、转移目标和护盾坚持到最后。

## 本地运行

```bash
corepack enable
pnpm install
pnpm run build
pnpm start
```

打开 `http://127.0.0.1:4173`。

## 一键部署到 Render

仓库根目录中的 `render.yaml` 已配置：

- Node.js Web Service
- 免费实例
- 新加坡区域
- 自动构建并启动 WebSocket 服务
- 每次推送到 Git 仓库后自动重新部署

在 Render 中选择 **New Blueprint** 并连接这个仓库即可。部署完成后，打开 Render 提供的 `https://*.onrender.com` 地址创建房间，再复制邀请链接给朋友。

免费实例闲置后可能休眠；房间状态保存在内存中，服务重启后会清空。

