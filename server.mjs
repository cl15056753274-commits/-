import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const port = Number(process.env.PORT || 4173);
const root = resolve("dist");
const rooms = new Map();
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = join(root, decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname));
    if (!path.startsWith(root)) throw new Error("bad path");
    try { if ((await stat(path)).isDirectory()) path = join(path, "index.html"); } catch { path = join(root, "index.html"); }
    const data = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
});

const wss = new WebSocketServer({ server });
const cleanName = (name) => String(name || "特工").trim().slice(0, 10) || "特工";
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const active = (room) => room.players.filter((p) => p.alive);
const randomOther = (room, except) => {
  const pool = active(room).filter((p) => p.id !== except);
  return pool[Math.floor(Math.random() * pool.length)] || active(room)[0];
};
const publicRoom = (room) => ({ ...room, players: room.players.map(({ socket, ...p }) => p) });
const broadcast = (room, event) => room.players.forEach((p) => p.socket?.readyState === WebSocket.OPEN && p.socket.send(JSON.stringify({ type: "state", room: publicRoom(room), event })));
const log = (room, text, kind = "normal") => room.logs.unshift({ id: Date.now() + Math.random(), text, kind, time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) });

function start(room) {
  room.phase = "playing"; room.round = 1; room.timer = 18; room.tension = 35; room.winnerId = null;
  room.players.forEach((p) => { p.alive = true; p.shields = 1; p.score = 0; });
  room.holderId = room.players[Math.floor(Math.random() * room.players.length)].id;
  log(room, `${room.players.find((p) => p.id === room.holderId).name} 接收了第一枚装置。`, "danger");
}

function moveBomb(room, targetId, reason) {
  const target = room.players.find((p) => p.id === targetId && p.alive) || randomOther(room, room.holderId);
  if (!target) return;
  room.holderId = target.id; room.round += 1; room.timer = 12 + Math.floor(Math.random() * 7); room.tension = Math.min(100, room.tension + 9);
  log(room, `${reason}，装置已转移给 ${target.name}。`, "danger");
}

wss.on("connection", (socket) => {
  let joined = null; let playerId = null;
  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "join") {
        const roomId = (msg.roomId || code()).toUpperCase().slice(0, 8);
        let room = rooms.get(roomId);
        if (!room) { room = { id: roomId, phase: "lobby", players: [], logs: [], round: 0, timer: 0, tension: 0, holderId: null, winnerId: null }; rooms.set(roomId, room); }
        let p = room.players.find((x) => x.id === msg.playerId);
        if (!p && room.players.length >= 5) return socket.send(JSON.stringify({ type: "error", message: "行动小组已满（最多 5 人）" }));
        if (!p) { p = { id: msg.playerId || crypto.randomUUID(), name: cleanName(msg.name), avatar: room.players.length % 5, alive: true, shields: 1, score: 0, host: room.players.length === 0 }; room.players.push(p); }
        p.socket = socket; p.connected = true; joined = room; playerId = p.id;
        socket.send(JSON.stringify({ type: "joined", playerId: p.id, roomId }));
        log(room, `${p.name} 已接入行动频道。`); broadcast(room);
      }
      if (!joined) return;
      const me = joined.players.find((p) => p.id === playerId);
      if (msg.type === "start" && me && joined.players.length >= 2) { start(joined); broadcast(joined); }
      if (msg.type === "restart" && me) { joined.phase = "lobby"; joined.logs = []; broadcast(joined); }
      if (joined.phase !== "playing" || joined.holderId !== playerId || !me?.alive) return;
      if (msg.type === "pass") moveBomb(joined, msg.targetId, me.name);
      if (msg.type === "shield" && me.shields > 0) { me.shields -= 1; moveBomb(joined, null, `${me.name} 启动护盾`); }
      if (msg.type === "cut") {
        if (Math.random() < 0.58) { me.score += 1; joined.timer = Math.min(16, joined.timer + 4); moveBomb(joined, null, `${me.name} 成功剪断旁路线`); }
        else { joined.timer = Math.max(1, joined.timer - 3); joined.tension = Math.min(100, joined.tension + 16); log(joined, `${me.name} 剪错引线，倒计时加速！`, "danger"); }
      }
      broadcast(joined);
    } catch { socket.send(JSON.stringify({ type: "error", message: "指令解析失败" })); }
  });
  socket.on("close", () => { if (!joined) return; const p = joined.players.find((x) => x.id === playerId); if (p) p.connected = false; broadcast(joined); });
});

setInterval(() => {
  rooms.forEach((room) => {
    if (room.phase !== "playing") return;
    room.timer -= 1; room.tension = Math.min(100, room.tension + 2);
    if (room.timer <= 0) {
      const holder = room.players.find((p) => p.id === room.holderId); if (holder) holder.alive = false;
      log(room, `${holder?.name || "一名特工"} 的装置爆炸，已退出行动。`, "danger");
      const survivors = active(room);
      if (survivors.length <= 1) { room.phase = "ended"; room.winnerId = survivors[0]?.id || null; log(room, survivors[0] ? `${survivors[0].name} 完成最终任务！` : "行动失败，无人生还。"); }
      else { room.holderId = survivors[Math.floor(Math.random() * survivors.length)].id; room.round += 1; room.timer = 18; room.tension = 30; }
    }
    broadcast(room);
  });
}, 1000);

server.listen(port, "0.0.0.0", () => console.log(`炸弹传递: http://127.0.0.1:${port}`));
