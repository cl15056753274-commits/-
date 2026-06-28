import WebSocket from "ws";

const roomId = `QA${Date.now().toString().slice(-4)}`;
const clients = [];
const states = new Map();
const serverUrl = (process.env.WS_URL || "ws://127.0.0.1:4173").replace(/\/$/, "");
const websocketOptions = process.env.WS_RESOLVE_IP
  ? { lookup: (_hostname, _options, callback) => callback(null, process.env.WS_RESOLVE_IP, 4) }
  : undefined;

const waitFor = (check, timeout = 4000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    const value = check();
    if (value) return resolve(value);
    if (Date.now() - started > timeout) return reject(new Error("Timed out waiting for multiplayer state"));
    setTimeout(tick, 25);
  };
  tick();
});

for (let i = 0; i < 5; i += 1) {
  const ws = new WebSocket(`${serverUrl}/ws?room=${roomId}`, websocketOptions);
  clients.push(ws);
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "state") states.set(i, msg.room);
  });
  await new Promise((resolve) => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", roomId, playerId: `qa-player-${i}`, name: `特工${i + 1}` }));
}

await waitFor(() => states.get(0)?.players.length === 5);
clients[0].send(JSON.stringify({ type: "start" }));
const playing = await waitFor(() => states.get(0)?.phase === "playing" && states.get(0)?.timer === 18 ? states.get(0) : null);
const holderIndex = playing.players.findIndex((p) => p.id === playing.holderId);
const target = playing.players.find((p) => p.id !== playing.holderId);
clients[holderIndex].send(JSON.stringify({ type: "pass", targetId: target.id }));
const passed = await waitFor(() => states.get(0)?.round === 2 && states.get(0)?.holderId === target.id ? states.get(0) : null);

console.log(JSON.stringify({ room: roomId, players: passed.players.length, phase: passed.phase, round: passed.round, passVerified: true }));
clients.forEach((ws) => ws.close());
