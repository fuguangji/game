import { WebSocketServer } from "ws";
import { RoomManager } from "./room-manager.js";
import { TokenBucket } from "./rate-limiter.js";

const MAX_CONNECTIONS = 500;
const AUTH_TIMEOUT_MS = 8000;
const HEARTBEAT_MS = 30_000;
const MATCH_TICK_MS = 500;
const MAX_VIOLATIONS = 100; // 超過頻率限制的訊息累積這麼多就斷線

const safeSend = (socket, data) => {
  if (socket.readyState === 1) socket.send(JSON.stringify(data));
};

/**
 * WebSocket 轉接層：只處理連線、驗證、頻率限制與心跳；遊戲規則都在 RoomManager。
 */
export function attachRealtime(server, { firebaseAuth, allowedOrigins = [], manager = new RoomManager() } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const originBlocked = req.headers.origin && allowedOrigins.length && !allowedOrigins.includes(req.headers.origin);
    if (url.pathname !== "/api/realtime" || originBlocked || wss.clients.size >= MAX_CONNECTIONS) {
      socket.write(`HTTP/1.1 ${wss.clients.size >= MAX_CONNECTIONS ? "503 Service Unavailable" : "403 Forbidden"}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // 心跳：連續一輪沒有回應的連線視為已斷線並清掉（手機切換網路時常見）
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  // 對戰計時（競爭模式時間到、弱敵人重生）
  const matchTick = setInterval(() => manager.tick(), MATCH_TICK_MS);
  matchTick.unref?.();
  wss.on("close", () => { clearInterval(heartbeat); clearInterval(matchTick); });

  wss.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    const bucket = new TokenBucket({ capacity: 80, refillPerSecond: 60 }) // 對戰中：移動 10 次/秒 + 彈道 + 傷害回報;
    let violations = 0;
    let player = null;
    let authState = "none"; // none -> checking -> done
    const authTimeout = setTimeout(() => { if (authState !== "done") socket.close(4401, "auth required"); }, AUTH_TIMEOUT_MS);

    socket.on("message", async (raw) => {
      if (!bucket.tryRemove()) {
        if (++violations > MAX_VIOLATIONS) socket.close(4429, "too many messages");
        return;
      }
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { safeSend(socket, { type: "error", message: "Invalid JSON" }); return; }
      if (!msg || typeof msg.type !== "string") return;

      if (authState !== "done") {
        if (authState === "checking" || msg.type !== "auth" || typeof msg.token !== "string" || msg.token.length > 4096) {
          socket.close(4401, "auth required");
          return;
        }
        authState = "checking"; // 驗證進行中時，再收到任何訊息都視為違規
        if (!firebaseAuth) { socket.close(1013, "Firebase not configured"); return; }
        let decoded;
        try { decoded = await firebaseAuth.verifyIdToken(msg.token, true); }
        catch { socket.close(4401, "invalid token"); return; }
        if (!decoded?.uid) { socket.close(4401, "invalid token"); return; }
        authState = "done";
        clearTimeout(authTimeout);
        player = manager.createPlayer({
          id: decoded.uid,
          name: decoded.name ?? decoded.email?.split("@")[0] ?? "玩家",
          send: (payload) => safeSend(socket, payload),
          close: (code, reason) => socket.close(code, reason),
        });
        safeSend(socket, { type: "authenticated", playerId: player.id });
        return;
      }

      const fail = (result) => { if (!result.ok) safeSend(socket, { type: "error", message: result.message }); };
      switch (msg.type) {
        case "join": fail(manager.join(player, { code: msg.code, mode: msg.mode })); break;
        case "start": fail(manager.start(player)); break;
        case "reset": manager.reset(player); break;
        case "leave": manager.leave(player); break;
        case "move": manager.move(player, Number(msg.x), Number(msg.y), msg.hp === undefined ? undefined : Number(msg.hp)); break;
        case "shot": manager.shots(player, msg.shots); break;
        case "hit": manager.hit(player, msg.target, Number(msg.dmg)); break;
        case "bossDamage": manager.bossDamage(player, Number(msg.amount)); break;
        case "died": manager.died(player); break;
        case "attack": manager.attack(player); break; // 舊版：只在大廳可用
        default: break;
      }
    });

    const cleanup = () => { clearTimeout(authTimeout); if (player) manager.leave(player); };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  return wss;
}
