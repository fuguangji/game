import { WebSocketServer } from "ws";

const MAX_ROOM_SIZE = 4;
const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const rooms = new Map();
const safeSend = (socket, data) => {
  if (socket.readyState === 1) socket.send(JSON.stringify(data));
};
const roomSnapshot = (room) => ({
  type: "room",
  code: room.code,
  mode: room.mode,
  players: [...room.players.values()].map(({ id, name, x, y, hp }) => ({ id, name, x, y, hp })),
  bossHp: room.bossHp,
  mobs: room.mobs,
});
function broadcast(room, data) {
  for (const player of room.players.values()) safeSend(player.socket, data);
}
function makeRoom(code, mode) {
  return { code, mode, players: new Map(), bossHp: 1000, mobs: [
    { id: "m1", x: 0.22, y: 0.28, hp: 30 }, { id: "m2", x: 0.75, y: 0.62, hp: 30 },
    { id: "m3", x: 0.66, y: 0.25, hp: 30 },
  ] };
}
export function attachRealtime(server, { admin, allowedOrigins = [] } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/realtime" || (req.headers.origin && allowedOrigins.length && !allowedOrigins.includes(req.headers.origin))) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (socket) => {
    let player = null;
    let authenticated = false;
    const authTimeout = setTimeout(() => { if (!authenticated) socket.close(4401, "auth required"); }, 8000);
    socket.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { safeSend(socket, { type: "error", message: "Invalid JSON" }); return; }
      if (!authenticated) {
        if (msg.type !== "auth" || typeof msg.token !== "string" || msg.token.length > 4096) {
          socket.close(4401, "auth required"); return;
        }
        const { data, error } = await admin.auth.getUser(msg.token);
        if (error || !data?.user?.id) { socket.close(4401, "invalid token"); return; }
        authenticated = true; clearTimeout(authTimeout);
        player = { id: data.user.id, name: String(data.user.user_metadata?.display_name ?? "玩家").slice(0, 20), socket, x: 0.5, y: 0.5, hp: 100, lastAttack: 0 };
        safeSend(socket, { type: "authenticated", playerId: player.id });
        return;
      }
      if (!player || !msg || typeof msg.type !== "string") return;
      if (msg.type === "join") {
        const code = typeof msg.code === "string" ? msg.code.toUpperCase() : "";
        const mode = msg.mode === "boss" ? "boss" : "arena";
        if (!ROOM_CODE.test(code)) { safeSend(socket, { type: "error", message: "房間代碼需為 4–8 位英數字" }); return; }
        if (player.room) leaveRoom(player);
        let room = rooms.get(code);
        if (!room) { room = makeRoom(code, mode); rooms.set(code, room); }
        if (room.mode !== mode || room.players.size >= MAX_ROOM_SIZE) { safeSend(socket, { type: "error", message: "房間不存在相容模式或已滿" }); return; }
        player.room = room; room.players.set(player.id, player);
        broadcast(room, roomSnapshot(room)); return;
      }
      const room = player.room;
      if (!room) return;
      if (msg.type === "move") {
        const x = Number(msg.x), y = Number(msg.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          player.x = Math.max(0, Math.min(1, x)); player.y = Math.max(0, Math.min(1, y));
          broadcast(room, { type: "move", id: player.id, x: player.x, y: player.y });
        }
      } else if (msg.type === "attack" && Date.now() - player.lastAttack >= 450) {
        player.lastAttack = Date.now();
        let hitPlayer = null;
        if (room.mode === "arena") {
          const opponents = [...room.players.values()].filter((other) => other.id !== player.id && other.hp > 0);
          hitPlayer = opponents
            .map((other) => ({ other, distance: Math.hypot(other.x - player.x, other.y - player.y) }))
            .filter((entry) => entry.distance <= 0.12)
            .sort((a, b) => a.distance - b.distance)[0]?.other ?? null;
        }
        if (room.mode === "boss") room.bossHp = Math.max(0, room.bossHp - 20);
        else if (hitPlayer) hitPlayer.hp = Math.max(0, hitPlayer.hp - 20);
        else if (Array.isArray(room.mobs)) {
          const target = room.mobs.find((mob) => mob.hp > 0);
          if (target) target.hp = Math.max(0, target.hp - 10);
        }
        broadcast(room, { type: "combat", bossHp: room.bossHp, mobs: room.mobs,
          players: [...room.players.values()].map(({ id, name, x, y, hp }) => ({ id, name, x, y, hp })) });
      }
    });
    function leaveRoom(p) {
      const room = p.room;
      if (!room) return;
      room.players.delete(p.id); p.room = null;
      if (!room.players.size) rooms.delete(room.code);
      else broadcast(room, roomSnapshot(room));
    }
    socket.on("close", () => { clearTimeout(authTimeout); if (player) leaveRoom(player); });
    socket.on("error", () => { if (player) leaveRoom(player); });
  });
  return wss;
}
