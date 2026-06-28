import { DurableObject } from "cloudflare:workers";

const MAX_PLAYERS = 5;

const cleanName = (name) => String(name || "特工").trim().slice(0, 10) || "特工";
const active = (room) => room.players.filter((player) => player.alive);
const createRoom = (id) => ({
  id,
  phase: "lobby",
  players: [],
  logs: [],
  round: 0,
  timer: 0,
  tension: 0,
  holderId: null,
  winnerId: null,
});

const randomOther = (room, except) => {
  const alive = active(room);
  const pool = alive.filter((player) => player.id !== except);
  return pool[Math.floor(Math.random() * pool.length)] || alive[0];
};

const addLog = (room, text, kind = "normal") => {
  room.logs.unshift({
    id: Date.now() + Math.random(),
    text,
    kind,
    time: new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Shanghai",
    }),
  });
  room.logs = room.logs.slice(0, 20);
};

const startGame = (room) => {
  room.phase = "playing";
  room.round = 1;
  room.timer = 18;
  room.tension = 35;
  room.winnerId = null;
  room.players.forEach((player) => {
    player.alive = true;
    player.shields = 1;
    player.score = 0;
  });
  room.holderId = room.players[Math.floor(Math.random() * room.players.length)].id;
  const holder = room.players.find((player) => player.id === room.holderId);
  addLog(room, `${holder.name} 接收了第一枚装置。`, "danger");
};

const moveBomb = (room, targetId, reason) => {
  const target = room.players.find((player) => player.id === targetId && player.alive)
    || randomOther(room, room.holderId);
  if (!target) return;
  room.holderId = target.id;
  room.round += 1;
  room.timer = 12 + Math.floor(Math.random() * 7);
  room.tension = Math.min(100, room.tension + 9);
  addLog(room, `${reason}，装置已转移给 ${target.name}。`, "danger");
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.room = null;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get("room")) || null;
    });
  }

  async fetch(request) {
    await this.ready;
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const roomId = new URL(request.url).searchParams.get("room")?.toUpperCase();
    if (!roomId) return new Response("Missing room", { status: 400 });
    if (!this.room) {
      this.room = createRoom(roomId);
      await this.ctx.storage.put("room", this.room);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  socketsFor(playerId, except = null) {
    return this.ctx.getWebSockets().filter((socket) => {
      if (socket === except) return false;
      return socket.deserializeAttachment()?.playerId === playerId;
    });
  }

  syncConnections() {
    const connected = new Set(
      this.ctx.getWebSockets()
        .map((socket) => socket.deserializeAttachment()?.playerId)
        .filter(Boolean),
    );
    this.room.players.forEach((player) => {
      player.connected = connected.has(player.id);
    });
  }

  publicRoom() {
    return {
      ...this.room,
      players: this.room.players.map((player) => ({ ...player })),
    };
  }

  send(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // A stale socket will be removed by the runtime.
    }
  }

  async commit(event) {
    this.syncConnections();
    await this.ctx.storage.put("room", this.room);
    const payload = { type: "state", room: this.publicRoom(), event };
    this.ctx.getWebSockets().forEach((socket) => this.send(socket, payload));
  }

  async scheduleTick() {
    if (this.room.phase === "playing") {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async webSocketMessage(socket, raw) {
    await this.ready;
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      this.send(socket, { type: "error", message: "指令解析失败" });
      return;
    }

    if (message.type === "join") {
      let player = this.room.players.find((item) => item.id === message.playerId);
      if (!player && this.room.players.length >= MAX_PLAYERS) {
        this.send(socket, { type: "error", message: "行动小组已满（最多 5 人）" });
        return;
      }
      if (!player) {
        player = {
          id: message.playerId || crypto.randomUUID(),
          name: cleanName(message.name),
          avatar: this.room.players.length % MAX_PLAYERS,
          alive: true,
          shields: 1,
          score: 0,
          host: this.room.players.length === 0,
          connected: true,
        };
        this.room.players.push(player);
      } else {
        player.name = cleanName(message.name || player.name);
        player.connected = true;
      }
      socket.serializeAttachment({ playerId: player.id });
      this.send(socket, { type: "joined", playerId: player.id, roomId: this.room.id });
      addLog(this.room, `${player.name} 已接入行动频道。`);
      await this.commit();
      return;
    }

    const playerId = socket.deserializeAttachment()?.playerId;
    const me = this.room.players.find((player) => player.id === playerId);
    if (!me) return;

    if (message.type === "start" && this.room.players.length >= 2) {
      startGame(this.room);
      await this.scheduleTick();
      await this.commit();
      return;
    }
    if (message.type === "restart") {
      this.room.phase = "lobby";
      this.room.logs = [];
      await this.scheduleTick();
      await this.commit();
      return;
    }
    if (this.room.phase !== "playing" || this.room.holderId !== playerId || !me.alive) return;

    if (message.type === "pass") moveBomb(this.room, message.targetId, me.name);
    if (message.type === "shield" && me.shields > 0) {
      me.shields -= 1;
      moveBomb(this.room, null, `${me.name} 启动护盾`);
    }
    if (message.type === "cut") {
      if (Math.random() < 0.58) {
        me.score += 1;
        this.room.timer = Math.min(16, this.room.timer + 4);
        moveBomb(this.room, null, `${me.name} 成功剪断旁路线`);
      } else {
        this.room.timer = Math.max(1, this.room.timer - 3);
        this.room.tension = Math.min(100, this.room.tension + 16);
        addLog(this.room, `${me.name} 剪错引线，倒计时加速！`, "danger");
      }
    }
    await this.scheduleTick();
    await this.commit();
  }

  async webSocketClose(socket) {
    await this.ready;
    const playerId = socket.deserializeAttachment()?.playerId;
    const player = this.room?.players.find((item) => item.id === playerId);
    if (player && this.socketsFor(playerId, socket).length === 0) {
      player.connected = false;
      await this.commit();
    }
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    await this.ready;
    if (!this.room || this.room.phase !== "playing") return;

    this.room.timer -= 1;
    this.room.tension = Math.min(100, this.room.tension + 2);
    if (this.room.timer <= 0) {
      const holder = this.room.players.find((player) => player.id === this.room.holderId);
      if (holder) holder.alive = false;
      addLog(this.room, `${holder?.name || "一名特工"} 的装置爆炸，已退出行动。`, "danger");
      const survivors = active(this.room);
      if (survivors.length <= 1) {
        this.room.phase = "ended";
        this.room.winnerId = survivors[0]?.id || null;
        addLog(this.room, survivors[0] ? `${survivors[0].name} 完成最终任务！` : "行动失败，无人生还。");
      } else {
        this.room.holderId = survivors[Math.floor(Math.random() * survivors.length)].id;
        this.room.round += 1;
        this.room.timer = 18;
        this.room.tension = 30;
      }
    }
    await this.commit();
    await this.scheduleTick();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("room")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      if (!roomId) return new Response("Missing room", { status: 400 });
      const id = env.GAME_ROOMS.idFromName(roomId);
      return env.GAME_ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
