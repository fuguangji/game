import test from "node:test";
import assert from "node:assert/strict";
import { GAVE_UP_CODE, RECONNECT_DELAYS, RealtimeClient, RealtimeStates } from "../js/profile/realtime-client.js";

/** 假 WebSocket：由測試手動觸發 open / message / close */
class FakeWS {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code = 1000) { this.readyState = 3; this.closedWith = code; }
  // 測試用
  open() { this.readyState = 1; this.onopen?.(); }
  say(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

function make({ token = "tok", delays = RECONNECT_DELAYS } = {}) {
  FakeWS.all.length = 0;
  const clock = { t: 1000, timers: [] };
  const tokens = { value: token, calls: 0 };
  const client = new RealtimeClient({
    url: "wss://x/api/realtime",
    getToken: async () => { tokens.calls++; return tokens.value; },
    WebSocketImpl: FakeWS,
    now: () => clock.t,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; clock.timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    reconnectDelays: delays,
  });
  const log = { states: [], events: [] };
  client.addEventListener("state", (e) => log.states.push(e.detail));
  for (const type of ["reconnected", "latency", "problem", "room", "started"]) client.addEventListener(type, (e) => log.events.push({ type, ...e.detail }));
  const live = () => FakeWS.all.at(-1);
  const flush = () => new Promise((r) => setImmediate(r));
  const fire = async () => { const t = clock.timers.filter((x) => !x.cleared && !x.fired).at(-1); assert.ok(t, "有排程中的計時器"); t.fired = true; await t.fn(); await flush(); return t; };
  const pending = () => clock.timers.filter((x) => !x.cleared && !x.fired);
  /** 走完「連線 → 驗證 → 加入房間」 */
  const join = async (ws = live()) => { ws.open(); ws.say({ type: "authenticated", playerId: "me" }); ws.say({ type: "room", code: "ABCD", mode: "boss", phase: "lobby", players: [], hostId: "me" }); await flush(); };
  return { client, clock, tokens, log, live, fire, pending, join, flush };
}

test("連線流程：取 token → 開 socket → 驗證 → 加入房間 → 進入房間", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "abcd" });
  assert.equal(t.client.state, RealtimeStates.CONNECTING);
  t.live().open();
  assert.deepEqual(t.live().sent[0], { type: "auth", token: "tok" });
  t.live().say({ type: "authenticated", playerId: "me" });
  assert.deepEqual(t.live().sent[1], { type: "join", mode: "boss", code: "ABCD" });
  t.live().say({ type: "room", code: "ABCD", players: [] });
  assert.equal(t.client.state, RealtimeStates.IN_ROOM);
  assert.equal(t.client.playerId, "me");
});

test("輸入檢查：不支援的玩法、壞的房間代碼、沒有 token", async () => {
  const t = make();
  await assert.rejects(t.client.connect({ mode: "x", code: "ABCD" }), /玩法/);
  await assert.rejects(t.client.connect({ mode: "boss", code: "a" }), /4–8/);
  const t2 = make({ token: null });
  await assert.rejects(t2.client.connect({ mode: "boss", code: "ABCD" }), /登入/);
  assert.equal(t2.client.state, RealtimeStates.IDLE);
});

test("意外斷線：進入「重新連線中」，依序退避，重連時重新取 token 並自動回到同一個房間", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "ABCD" });
  await t.join();
  const first = t.live();
  first.drop(1006);
  assert.equal(t.client.state, RealtimeStates.RECONNECTING);
  const s = t.log.states.at(-1);
  assert.deepEqual([s.attempt, s.of, s.inMs], [1, RECONNECT_DELAYS.length, 500]);
  assert.equal(t.client.inRoom, false);
  assert.equal(t.client.move(0.5, 0.5), false, "重連期間不送位置");

  const callsBefore = t.tokens.calls;
  await t.fire();
  assert.equal(t.tokens.calls, callsBefore + 1, "重連前重新取得 token（舊的可能過期）");
  assert.notEqual(t.live(), first, "開了新的 socket");
  t.live().open();
  assert.equal(t.live().sent[0].type, "auth");
  t.live().say({ type: "authenticated", playerId: "me" });
  assert.deepEqual(t.live().sent[1], { type: "join", mode: "boss", code: "ABCD" }, "自動重新加入同一個房間");
  t.live().say({ type: "room", code: "ABCD", players: [] });
  assert.equal(t.client.state, RealtimeStates.IN_ROOM);
  assert.equal(t.log.events.filter((e) => e.type === "reconnected").length, 1);
});

test("連續失敗：等待時間依序加長，用完次數就放棄（代碼 4000）", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "ABCD" });
  await t.join();
  t.live().drop(1006);
  const waits = [t.log.states.at(-1).inMs];
  for (let i = 1; i < RECONNECT_DELAYS.length; i++) {
    await t.fire();
    t.live().drop(1006); // 重連一直失敗
    waits.push(t.log.states.at(-1).inMs);
  }
  assert.deepEqual(waits, [...RECONNECT_DELAYS]);
  await t.fire();
  t.live().drop(1006);
  assert.equal(t.client.state, RealtimeStates.CLOSED);
  assert.equal(t.log.states.at(-1).code, GAVE_UP_CODE);
  assert.equal(t.pending().length, 0, "不再排程");
});

test("不該重連的關閉代碼：被別處登入頂掉、驗證失敗、主動關閉、訊息太頻繁", async () => {
  for (const code of [4409, 4401, 1000, 4429]) {
    const t = make();
    await t.client.connect({ mode: "boss", code: "ABCD" });
    await t.join();
    t.live().drop(code);
    assert.equal(t.client.state, RealtimeStates.CLOSED, `代碼 ${code}`);
    assert.equal(t.log.states.at(-1).code, code);
    assert.equal(t.pending().length, 0);
  }
});

test("主動 close()：取消重連、之後遲到的事件一律忽略", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "ABCD" });
  await t.join();
  const ws = t.live();
  ws.drop(1006);
  assert.equal(t.client.state, RealtimeStates.RECONNECTING);
  t.client.close();
  assert.equal(t.client.state, RealtimeStates.CLOSED);
  assert.equal(t.pending().length, 0, "重連計時器被取消");
  const sockets = FakeWS.all.length;
  ws.drop(1006); // 舊連線的事件遲到
  assert.equal(FakeWS.all.length, sockets, "不會重連");
});

test("重連途中登入過期（拿不到 token）：停止重連並回報驗證失敗", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "ABCD" });
  await t.join();
  t.live().drop(1006);
  t.tokens.value = null;
  await t.fire();
  assert.equal(t.client.state, RealtimeStates.CLOSED);
  assert.equal(t.log.states.at(-1).code, 4401);
});

test("重連期間又呼叫 connect()（換房間）：舊的重連排程不會再執行", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "ABCD" });
  await t.join();
  t.live().drop(1006);
  const stale = t.pending()[0];
  await t.client.connect({ mode: "boss", code: "WXYZ" });
  assert.ok(stale.cleared, "舊的計時器被取消");
  t.live().open();
  t.live().say({ type: "authenticated", playerId: "me" });
  assert.equal(t.live().sent[1].code, "WXYZ");
});

test("延遲量測：進房後每 5 秒送 ping，收到 pong 算出來回時間；斷線後歸零", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "ABCD" });
  await t.join();
  assert.equal(t.live().sent.at(-1).type, "ping", "進房就先量一次");
  const ping = t.live().sent.at(-1);
  t.clock.t += 42;
  t.live().say({ type: "pong", t: ping.t });
  assert.equal(t.client.latency, 42);
  assert.equal(t.log.events.find((e) => e.type === "latency").ms, 42);
  const timer = t.pending().at(-1);
  assert.equal(timer.ms, 5000);
  await timer.fn();
  assert.equal(t.live().sent.filter((m) => m.type === "ping").length, 2);
  t.live().say({ type: "pong", t: "壞資料" }); // 壞掉的 pong 被丟棄
  t.live().say({ type: "pong", t: t.clock.t + 99999 }); // 未來的時間（負延遲）也丟棄
  assert.equal(t.client.latency, 42);
  t.live().drop(1006);
  assert.equal(t.client.latency, null);
});

test("伺服器訊息：未知類型與壞掉的 JSON 被丟棄，不丟例外", async () => {
  const t = make();
  await t.client.connect({ mode: "boss", code: "ABCD" });
  t.live().open();
  assert.doesNotThrow(() => { t.live().onmessage({ data: "{壞掉" }); t.live().say({ type: "hacked" }); t.live().say({}); t.live().say(null); });
  assert.equal(t.client.state, RealtimeStates.AUTHENTICATING);
});
