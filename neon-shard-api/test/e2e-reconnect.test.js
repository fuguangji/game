/**
 * 端對端：真的 HTTP / WebSocket 伺服器（realtime.js + room-manager.js）＋ 真的前端 RealtimeClient。
 * 驗證兩邊的協定真的對得上：加入房間、ping/pong 延遲、對戰中被強制斷線 → 自動重連 → 還原同一場對戰。
 * 前端檔案不存在時（只部署 API 的環境）整組略過。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { RoomManager } from "../src/room-manager.js";
import { attachRealtime } from "../src/realtime.js";

const clientPath = fileURLToPath(new URL("../../neon-shard/js/profile/realtime-client.js", import.meta.url));
const available = fs.existsSync(clientPath) && typeof WebSocket === "function";
const { RealtimeClient, RealtimeStates } = available ? await import(clientPath) : {};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(10); }
  assert.fail(`逾時：${label}`);
}

async function boot() {
  const manager = new RoomManager();
  const server = http.createServer();
  const firebaseAuth = { verifyIdToken: async (token) => ({ uid: token, name: token.toUpperCase() }) };
  const wss = attachRealtime(server, { firebaseAuth, manager });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `ws://127.0.0.1:${server.address().port}/api/realtime`;
  const clients = [];
  const player = (uid) => {
    const client = new RealtimeClient({ url, getToken: async () => uid, reconnectDelays: [40, 80, 160, 320] });
    const log = { rooms: [], started: [], states: [], reconnected: 0, latency: [] };
    client.addEventListener("room", (e) => log.rooms.push(e.detail));
    client.addEventListener("started", (e) => log.started.push(e.detail));
    client.addEventListener("state", (e) => log.states.push(e.detail));
    client.addEventListener("reconnected", () => log.reconnected++);
    client.addEventListener("latency", (e) => log.latency.push(e.detail.ms));
    clients.push(client);
    return { client, log, uid };
  };
  const stop = async () => { for (const c of clients) c.close(); await wait(20); for (const ws of wss.clients) ws.terminate(); await new Promise((r) => server.close(r)); };
  return { manager, wss, server, player, stop };
}

test("端對端：加入房間、量到延遲、對戰中被切斷 → 自動重連 → 還原同一場對戰", { skip: !available && "找不到前端 realtime-client.js" }, async (t) => {
  const env = await boot();
  t.after(env.stop);
  const a = env.player("alice"), b = env.player("bob");
  await a.client.connect({ mode: "arena", code: "E2E001" });
  await until(() => a.client.state === RealtimeStates.IN_ROOM, "A 進房");
  await b.client.connect({ mode: "arena", code: "E2E001" });
  await until(() => b.client.state === RealtimeStates.IN_ROOM, "B 進房");
  await until(() => b.log.latency.length > 0, "B 量到延遲");
  assert.ok(b.client.latency >= 0 && b.client.latency < 2000);

  assert.equal(a.client.start(), true);
  await until(() => a.log.started.length === 1 && b.log.started.length === 1, "兩邊收到開戰");
  const started = b.log.started[0];

  // 從伺服器端強制切斷 Bob 的連線（不送關閉訊框，模擬網路中斷）。伺服器沒有「帳號 → socket」對照，Bob 是後連的，所以是第二個
  assert.equal(env.wss.clients.size, 2);
  [...env.wss.clients][1].terminate();

  await until(() => a.log.rooms.at(-1)?.players.find((p) => p.id === "bob")?.connected === false, "A 看到 Bob 連線中斷");
  assert.equal(a.log.rooms.at(-1).phase, "playing", "對戰沒有因此結束");
  await until(() => b.log.states.some((s) => s.state === "reconnecting"), "B 進入重連");
  await until(() => b.log.reconnected === 1, "B 重連成功");

  // 重連後：拿到同一個種子與出生點（resumed），而且對手看到他回來
  const resumed = await until(() => b.log.started.find((s) => s.resumed), "B 收到還原用的開戰訊息");
  assert.equal(resumed.seed, started.seed);
  assert.deepEqual(resumed.spawns, started.spawns);
  await until(() => a.log.rooms.at(-1)?.players.find((p) => p.id === "bob")?.connected === true, "A 看到 Bob 回來");
  assert.equal(a.log.started.length, 1, "Alice 沒有被重發開戰訊息");
  assert.equal(b.client.state, RealtimeStates.IN_ROOM);

  // 重連後仍能正常通訊
  assert.equal(b.client.move(0.4, 0.4, 100), true);
});

test("端對端：大廳裡主動離開會直接移除（逾時移除的規則由 room-manager 單元測試涵蓋）", { skip: !available && "找不到前端 realtime-client.js" }, async (t) => {
  const env = await boot();
  t.after(env.stop);
  const a = env.player("alice"), b = env.player("bob");
  await a.client.connect({ mode: "boss", code: "E2E002" });
  await until(() => a.client.state === RealtimeStates.IN_ROOM, "A 進房");
  await b.client.connect({ mode: "boss", code: "E2E002" });
  await until(() => a.log.rooms.at(-1)?.players.length === 2, "兩人在房內");
  b.client.close(); // 主動離開（大廳）
  await until(() => a.log.rooms.at(-1)?.players.length === 1, "大廳裡主動離開直接移除");
});
