import { useEffect, useRef, useState } from "react";
import { Bomb, ClipboardText, Copy, Crosshair, LinkSimple, Microphone, Scissors, ShieldCheck, SignIn, Target, UsersThree, Warning } from "@phosphor-icons/react";

const portraits = Array.from({ length: 5 }, (_, i) => `/assets/agent-${i + 1}.png`);
const makeCode = () => Math.random().toString(36).slice(2, 6).toUpperCase();

function useGame() {
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const ws = useRef(null);
  const join = (name, roomId) => {
    ws.current?.close();
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
    ws.current = socket;
    const storageKey = `bomb-pass:${roomId}`;
    socket.onopen = () => socket.send(JSON.stringify({ type: "join", name, roomId, playerId: localStorage.getItem(storageKey) }));
    socket.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type === "joined") { setPlayerId(msg.playerId); localStorage.setItem(storageKey, msg.playerId); setConnected(true); }
      if (msg.type === "state") setRoom(msg.room);
      if (msg.type === "error") setError(msg.message);
    };
    socket.onclose = () => setConnected(false);
  };
  const send = (type, extra = {}) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify({ type, ...extra }));
  return { room, playerId, error, connected, join, send };
}

export function App() {
  const game = useGame();
  const queryRoom = new URLSearchParams(location.search).get("room")?.toUpperCase() || "";
  const [name, setName] = useState(localStorage.getItem("bomb-pass:name") || "");
  const [roomCode, setRoomCode] = useState(queryRoom);
  const [joined, setJoined] = useState(false);
  const enter = (id) => { const clean = name.trim(); if (!clean) return; localStorage.setItem("bomb-pass:name", clean); const code = id || roomCode || makeCode(); history.replaceState({}, "", `?room=${code}`); setRoomCode(code); setJoined(true); game.join(clean, code); };
  if (!joined || !game.room) return <Entry name={name} setName={setName} roomCode={roomCode} setRoomCode={setRoomCode} enter={enter} loading={joined} error={game.error} />;
  if (game.room.phase === "lobby") return <Lobby {...game} />;
  return <Mission {...game} />;
}

function Entry({ name, setName, roomCode, setRoomCode, enter, loading, error }) {
  return <main className="entry-shell">
    <section className="entry-copy"><div className="eyebrow"><Bomb weight="fill" /> 绝密多人行动</div><h1>炸弹传递</h1><p>装置已启动。和 4～5 位朋友进入同一行动频道，在倒计时归零前拆线、转移，或者把麻烦丢给下一位。</p><div className="brief-points"><span><UsersThree /> 链接即玩</span><span><Crosshair /> 实时同步</span><span><ShieldCheck /> 无需注册</span></div></section>
    <form className="entry-form" onSubmit={(e) => { e.preventDefault(); enter(); }}>
      <div className="form-mark"><Warning weight="fill" /><span>行动接入</span></div>
      <label>特工代号<input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={10} placeholder="输入你的昵称" /></label>
      <label>房间代码（可选）<input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} placeholder="例如 B527" /></label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={!name.trim() || loading}><SignIn weight="bold" />{loading ? "正在接入…" : roomCode ? "加入行动" : "创建房间"}</button>
      <small>创建后复制邀请链接给朋友，最多 5 人。</small>
    </form>
  </main>;
}

function Lobby({ room, playerId, send, connected }) {
  const me = room.players.find((p) => p.id === playerId);
  const invite = `${location.origin}${location.pathname}?room=${room.id}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return <main className="lobby-shell">
    <header className="command-bar"><div className="brand"><Bomb weight="fill" />炸弹传递</div><div className="connection"><i className={connected ? "online" : ""} />{connected ? "频道已加密" : "连接中断"}</div></header>
    <section className="lobby-brief"><span className="eyebrow">行动编号 // {room.id}</span><h1>等待小组成员接入</h1><p>将安全链接发送给朋友。2 人可开始，4～5 人体验最佳。</p><button className="copy-link" onClick={copy}><LinkSimple />{copied ? "已复制邀请链接" : "复制邀请链接"}</button></section>
    <section className="team-grid">{room.players.map((p, i) => <article className="team-card" key={p.id}><img src={portraits[p.avatar]} /><div><span>{String(i + 1).padStart(2, "0")}</span><h2>{p.name}</h2><p>{p.host ? "行动指挥" : p.connected ? "频道在线" : "暂时离线"}</p></div></article>)}{Array.from({ length: 5 - room.players.length }, (_, i) => <div className="empty-agent" key={i}><UsersThree /><span>等待接入</span></div>)}</section>
    <footer className="lobby-footer"><div><strong>{room.players.length}/5</strong><span>行动成员</span></div><button className="primary" disabled={room.players.length < 2} onClick={() => send("start")}><Target weight="bold" />{room.players.length < 2 ? "等待至少 2 人" : "启动装置"}</button></footer>
  </main>;
}

function Mission({ room, playerId, send, connected }) {
  const me = room.players.find((p) => p.id === playerId);
  const holder = room.players.find((p) => p.id === room.holderId);
  const aliveOthers = room.players.filter((p) => p.alive && p.id !== playerId);
  const [target, setTarget] = useState(aliveOthers[0]?.id || "");
  useEffect(() => { if (!aliveOthers.some((p) => p.id === target)) setTarget(aliveOthers[0]?.id || ""); }, [room.holderId, room.players.length]);
  const isTurn = room.holderId === playerId && me?.alive && room.phase === "playing";
  const winner = room.players.find((p) => p.id === room.winnerId);
  const invite = `${location.origin}${location.pathname}?room=${room.id}`;
  const copy = () => navigator.clipboard.writeText(invite);
  return <main className="mission-shell">
    <header className="command-bar"><div className="brand"><Bomb weight="fill" />炸弹传递</div><div className="round">第 <b>{room.round}</b> 回合</div><div className="target-label"><Crosshair />目标：<b>{holder?.name || "未知"}</b></div><div className="room-link">房间 <b>{room.id}</b><button onClick={copy}><Copy />复制邀请链接</button></div></header>
    <section className="mission-main">
      <div className="dossier"><div className="paper-head"><b>机密档案</b><span>// {room.id}-{String(room.round).padStart(2, "0")}</span></div><div className="paper-grid"><div className="specs"><h3>装置信息</h3><dl><dt>型号</dt><dd>VX-9 便携装置</dd><dt>引爆方式</dt><dd>多条件触发</dd><dt>稳定性</dt><dd className="red">{room.tension > 70 ? "极不稳定" : "不稳定"}</dd><dt>拆除记录</dt><dd>{room.players.reduce((n, p) => n + p.score, 0)} 次成功</dd></dl></div><img className="bomb-device" src="/assets/bomb-device.png" alt="定时装置" /></div><div className="intel"><b>情报提示</b><p>剪线成功可争取时间，但失败会加速倒计时。</p><p>护盾仅有一次，可将装置随机转移。</p></div></div>
      <div className="status-column"><span className="section-label">倒计时</span><div className={`timer ${room.timer <= 4 ? "critical" : ""}`}>{String(Math.max(0, room.timer)).padStart(2, "0")}<small>秒</small></div><span className="section-label">紧张度</span><div className="tension"><div style={{ height: `${room.tension}%` }} /></div><div className="tension-label"><span>危险</span><span>稳定</span></div></div>
      <aside className="squad"><h2><UsersThree />行动小组 ({room.players.length}人)</h2>{room.players.map((p, i) => <article key={p.id} className={`${p.id === room.holderId ? "carrier" : ""} ${!p.alive ? "eliminated" : ""}`}><b className="agent-no">{i + 1}</b><img src={portraits[p.avatar]} /><div><h3>{p.name}{p.id === playerId && <small>你</small>}</h3><p><i className={p.connected ? "online" : ""} />{!p.alive ? "已退出行动" : p.id === room.holderId ? "携带装置" : "待命"}</p></div>{p.id === room.holderId ? <span className="danger-tag"><Bomb weight="fill" />携带中</span> : <Microphone className="mic" />}</article>)}<div className="mission-log"><h3><ClipboardText />任务日志</h3>{room.logs.slice(0, 3).map((l) => <p key={l.id}><time>{l.time}</time><span className={l.kind}>{l.text}</span></p>)}</div></aside>
    </section>
    <section className="actions"><button className="cut" disabled={!isTurn} onClick={() => send("cut")}><Scissors weight="bold" /><span>剪断引线<small>58% 成功率</small></span></button><label className="pass"><select disabled={!isTurn} value={target} onChange={(e) => setTarget(e.target.value)}>{aliveOthers.map((p) => <option key={p.id} value={p.id}>转移给 {p.name}</option>)}</select><button disabled={!isTurn || !target} onClick={() => send("pass", { targetId: target })}><Target weight="bold" />转移目标</button></label><button className="shield" disabled={!isTurn || me?.shields < 1} onClick={() => send("shield")}><ShieldCheck weight="bold" /><span>启动护盾<small>剩余 {me?.shields || 0} 次</small></span></button></section>
    {!isTurn && room.phase === "playing" && <div className="turn-note">{!me?.alive ? "你已退出行动，正在观战" : `等待 ${holder?.name || "其他特工"} 行动`}</div>}
    {room.phase === "ended" && <div className="result-modal"><div><span className="eyebrow">任务结束</span><h2>{winner ? `${winner.name} 完成最终任务` : "行动失败"}</h2><p>行动频道仍然开放，可以重新集结再来一局。</p><button className="primary" onClick={() => send("restart")}>返回行动室</button></div></div>}
    {!connected && <div className="offline">正在重新连接行动频道…</div>}
  </main>;
}
