import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./firebase-sdk-loader.mjs", import.meta.url);

/* ───────────── 記憶體版 Realtime Database：和真的一樣，寫入 undefined 會丟錯 ───────────── */
function makeDb() {
  const root = { v: {} };
  const watchers = new Set();
  const disconnects = [];
  const segs = (path) => path.split("/").filter(Boolean);
  const read = (path) => segs(path).reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), root.v);
  const noUndefined = (v, where) => {
    if (v === undefined) throw new Error(`Reference.set failed: contains undefined in property '${where}'`);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) noUndefined(x, `${where}.${k}`);
  };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const prune = (node) => {
    if (node && typeof node === "object") { for (const k of Object.keys(node)) { prune(node[k]); if (node[k] === null || (typeof node[k] === "object" && !Object.keys(node[k]).length)) delete node[k]; } }
  };
  const write = (path, value) => {
    noUndefined(value, path);
    const s = segs(path);
    if (!s.length) { root.v = value ?? {}; }
    else {
      let n = root.v;
      for (const k of s.slice(0, -1)) { if (!n[k] || typeof n[k] !== "object") n[k] = {}; n = n[k]; }
      if (value === null) delete n[s.at(-1)]; else n[s.at(-1)] = clone(value);
    }
    prune(root.v);
    for (const w of [...watchers]) w();
  };
  const snap = (path) => { const v = read(path); return { exists: () => v !== undefined && v !== null, val: () => clone(v), key: segs(path).at(-1) }; };
  let pushId = 0;
  return {
    ref: (_db, path) => ({ path }),
    get: async ({ path }) => snap(path),
    set: async ({ path }, value) => write(path, value),
    remove: async ({ path }) => write(path, null),
    push: async ({ path }, value) => { const id = `k${String(++pushId).padStart(6, "0")}`; write(`${path}/${id}`, value); return { key: id }; },
    runTransaction: async ({ path }, fn) => { const cur = read(path) ?? null; const next = fn(clone(cur)); if (next === undefined) return { committed: false, snapshot: snap(path) }; write(path, next); return { committed: true, snapshot: snap(path) }; },
    onValue: ({ path }, cb) => { let last = "\u0000"; const fire = () => { const s = snap(path), j = JSON.stringify(s.val()); if (j !== last) { last = j; cb(s); } }; watchers.add(fire); queueMicrotask(fire); return () => watchers.delete(fire); },
    onChildAdded: ({ path }, cb) => { const seen = new Set(); const fire = () => { const parent = read(path); for (const k of Object.keys(parent ?? {})) if (!seen.has(k)) { seen.add(k); cb(snap(`${path}/${k}`)); } }; watchers.add(fire); queueMicrotask(fire); return () => watchers.delete(fire); },
    onDisconnect: ({ path }) => ({ remove: async () => { disconnects.push({ path, type: "remove" }); }, set: async (v) => { disconnects.push({ path, type: "set", v }); }, cancel: async () => { for (let i = disconnects.length - 1; i >= 0; i--) if (disconnects[i].path === path) disconnects.splice(i, 1); } }),
    _dump: () => clone(root.v),
    _fireDisconnects: (uid) => { for (const d of disconnects.splice(0)) if (d.uid === uid || !d.uid) write(d.path, d.type === "remove" ? null : d.v); },
    _disconnects: disconnects,
  };
}

/* ───────────── 假的 WebRTC ───────────── */
const rtc = { pcs: new Map(), n: 0 };
class FakeChannel {
  constructor() { this.readyState = "connecting"; this.sent = []; this.peer = null; }
  send(t) { if (this.readyState !== "open") throw new Error("not open"); queueMicrotask(() => this.peer?.onmessage?.({ data: t })); }
  close() { if (this.readyState === "closed") return; this.readyState = "closed"; this.onclose?.(); }
}
class FakePC {
  constructor() { this.id = ++rtc.n; rtc.pcs.set(this.id, this); this.remoteDescription = null; this.connectionState = "new"; this.dc = null; }
  createDataChannel() { this.dc = new FakeChannel(); return this.dc; }
  async createOffer() { return { type: "offer", sdp: `host:${this.id}` }; }
  async createAnswer() { return { type: "answer", sdp: `guest:${this.id}|${this.remoteDescription.sdp}` }; }
  async setLocalDescription() {
    // 模擬瀏覽器：usernameFragment 在部分瀏覽器是 undefined（正是原本會讓資料庫丟錯的值）
    queueMicrotask(() => this.onicecandidate?.({ candidate: { candidate: `candidate:${this.id} 1 udp 1 1.2.3.4 5000 typ host`, sdpMid: "0", sdpMLineIndex: 0, usernameFragment: undefined, toJSON() { return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex, usernameFragment: this.usernameFragment }; } } }));
  }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
    if (d.type === "answer") { // 房主收到訪客的 answer → 兩邊接通
      const guest = rtc.pcs.get(Number(/guest:(\d+)/.exec(d.sdp)[1]));
      const gdc = new FakeChannel(); gdc.peer = this.dc; this.dc.peer = gdc;
      guest.ondatachannel?.({ channel: gdc });
      queueMicrotask(() => { this.dc.readyState = gdc.readyState = "open"; this.connectionState = guest.connectionState = "connected"; this.dc.onopen?.(); gdc.onopen?.(); this.onconnectionstatechange?.(); guest.onconnectionstatechange?.(); });
    }
  }
  async addIceCandidate(c) { if (!c || typeof c.candidate !== "string") throw new Error("bad candidate"); }
  close() { this.connectionState = "closed"; rtc.pcs.delete(this.id); }
}

let db, uidCounter;
function install() {
  db = makeDb(); uidCounter = 0;
  globalThis.RTCPeerConnection = FakePC;
  globalThis.__fb = {
    ...db,
    initializeApp: () => ({ auth: { currentUser: null, authStateReady: async () => {} } }),
    getApps: () => [],
    getAuth: (app) => app.auth,
    getDatabase: () => ({}),
    signInAnonymously: async (auth) => { auth.currentUser = { uid: `user-${++uidCounter}` }; },
  };
}
const { FirebaseRoomClient, toDbValue, candidateToDb, candidateFromDb, resolveIceServers } = await import("../js/profile/firebase-room-client.js");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, label) => { for (let i = 0; i < 100; i++) { if (fn()) return; await tick(5); } assert.fail(`逾時：${label}`); };
const events = (client, ...types) => { const log = []; for (const t of types) client.addEventListener(t, (e) => log.push({ type: t, ...e.detail })); return log; };

test("toDbValue：undefined 換成 null 並被略過，不會讓資料庫丟錯", () => {
  assert.deepEqual(toDbValue({ a: 1, b: undefined, c: { d: undefined, e: "x" }, f: [1, undefined] }), { a: 1, c: { e: "x" }, f: [1, null] });
  assert.equal(toDbValue(NaN), null);
});

test("candidateToDb / candidateFromDb：缺欄位、undefined、過長的資料都安全", () => {
  const raw = { candidate: "candidate:1 1 udp", sdpMid: undefined, sdpMLineIndex: 0, usernameFragment: undefined };
  const stored = candidateToDb(raw, "abc");
  assert.deepEqual(stored, { candidate: "candidate:1 1 udp", sdpMLineIndex: 0, sid: "abc" });
  assert.deepEqual(candidateFromDb(stored), { candidate: "candidate:1 1 udp", sdpMLineIndex: 0 });
  assert.equal(candidateToDb({ candidate: "" }, "s"), null);
  assert.equal(candidateToDb({ candidate: "x".repeat(5000) }, "s"), null);
  assert.equal(candidateToDb(null, "s"), null);
  assert.equal(candidateFromDb({ candidate: 5 }), null);
});

test("resolveIceServers：保留 STUN、接受合法 TURN、忽略格式不對的項目", () => {
  const base = resolveIceServers([]);
  assert.ok(base.length >= 1 && String(base[0].urls).startsWith("stun:"));
  const extra = resolveIceServers([{ urls: "turn:t.example.com:3478", username: "u", credential: "c" }, { urls: "http://evil" }, { urls: 5 }, null]);
  assert.equal(extra.length, base.length + 1);
  assert.equal(extra.at(-1).username, "u");
});

test("房主建房、訪客加入：接通後能互傳 move，ICE 候選資料不含 undefined", async () => {
  install();
  const host = new FirebaseRoomClient(), guest = new FirebaseRoomClient();
  const code = await host.createRoom({ mode: "boss" });
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  const got = []; guest.addEventListener("move", (e) => got.push(e.detail));
  await guest.joinRoom({ code, mode: "boss" });
  await waitFor(() => host.connected && guest.connected, "兩端接通");
  assert.equal(host.move(0.25, 0.75), true);
  await waitFor(() => got.length === 1, "訪客收到 move");
  assert.equal(got[0].x, 0.25);
  const room = db._dump().rooms[code];
  assert.equal(room.status, "connected");
  assert.ok(Object.values(room.hostCandidates).every((c) => typeof c.sid === "string"));
  await host.close(); await guest.close();
});

test("遠端無法偽造本機事件（room / state / problem），也不能送超大或壞格式的訊息", async () => {
  install();
  const host = new FirebaseRoomClient(), guest = new FirebaseRoomClient();
  const code = await host.createRoom({ mode: "arena" });
  await guest.joinRoom({ code, mode: "arena" });
  await waitFor(() => host.connected && guest.connected, "接通");
  const problems = events(guest, "problem"), moves = events(guest, "move");
  const before = problems.length;
  for (const bad of [{ type: "problem", message: "你中毒了" }, { type: "room", status: "x" }, { type: "state", state: "connected" }, { type: "move", x: "a", y: 1 }, { type: "move", x: 0.1, y: 0.2, pad: "x".repeat(20000) }]) host.send(bad);
  host.send({ type: "move", x: 0.5, y: 0.5 });
  await waitFor(() => moves.length >= 1, "合法 move 仍會送達");
  await tick(20);
  assert.equal(moves.length, 1);
  assert.equal(problems.length, before);
  await host.close(); await guest.close();
});

test("加入錯誤：錯誤代碼、模式不同、自己的房間、滿員", async () => {
  install();
  const host = new FirebaseRoomClient(), a = new FirebaseRoomClient(), b = new FirebaseRoomClient();
  const code = await host.createRoom({ mode: "boss" });
  await assert.rejects(a.joinRoom({ code: "ZZZZZZ", mode: "boss" }), /找不到房間/);
  await assert.rejects(a.joinRoom({ code: "abc", mode: "boss" }), /6 位/);
  await assert.rejects(a.joinRoom({ code, mode: "arena" }), /模式不同/);
  await a.joinRoom({ code, mode: "boss" });
  await assert.rejects(b.joinRoom({ code, mode: "boss" }), /已滿/);
  await Promise.all([host.close(), a.close(), b.close()]);
});

test("訪客離開後釋放座位，房主重新產生 offer，新的訪客可以加入並接通", async () => {
  install();
  const host = new FirebaseRoomClient(), g1 = new FirebaseRoomClient(), g2 = new FirebaseRoomClient();
  const left = events(host, "peer-left");
  const code = await host.createRoom({ mode: "boss" });
  await g1.joinRoom({ code, mode: "boss" });
  await waitFor(() => host.connected && g1.connected, "第一位訪客接通");
  const sid1 = db._dump().rooms[code].offer.sid;
  await g1.close();
  await waitFor(() => left.length === 1, "房主偵測到訪客離開");
  await waitFor(() => { const r = db._dump().rooms?.[code]; return r && r.offer && r.offer.sid !== sid1 && !r.guestUid && !r.answer; }, "房主重新開放房間");
  assert.equal(db._dump().rooms[code].status, "waiting");
  await g2.joinRoom({ code, mode: "boss" });
  await waitFor(() => host.connected && g2.connected, "第二位訪客接通");
  assert.equal(db._dump().rooms[code].status, "connected");
  await host.close(); await g2.close();
  assert.equal(db._dump().rooms, undefined, "房主離開後房間被刪除");
});

test("同一個玩家重新整理後重新加入：座位上已經是自己，不算「已滿」", async () => {
  install();
  const host = new FirebaseRoomClient(), guest = new FirebaseRoomClient();
  const code = await host.createRoom({ mode: "boss" });
  await guest.joinRoom({ code, mode: "boss" });
  const guestUid = db._dump().rooms[code].guestUid;
  // 模擬重新整理：沒有正常 close()，直接用同一個 uid 的新實例加入
  const again = new FirebaseRoomClient();
  globalThis.__fb.signInAnonymously = async (auth) => { auth.currentUser = { uid: guestUid }; };
  await again.joinRoom({ code, mode: "boss" });
  assert.equal(db._dump().rooms[code].guestUid, guestUid);
  await Promise.all([host.close(), guest.close(), again.close()]);
});

test("close() 在建立途中被呼叫：不留下房間、不丟未處理的例外", async () => {
  install();
  const host = new FirebaseRoomClient();
  const pending = host.createRoom({ mode: "boss" }).catch((e) => e);
  await host.close();
  const result = await pending;
  await tick(30);
  assert.ok(result instanceof Error || typeof result === "string");
  assert.equal(db._dump().rooms, undefined);
});
