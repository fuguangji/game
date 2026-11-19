import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../js/account/api-client.js";
import { CloudSync } from "../js/account/cloud-sync.js";
import { isPristine, mergeSaves, sameSave, stableStringify } from "../js/account/save-merge.js";

const DEFAULTS = Object.freeze({ coins: 0, up: {}, own: [7], clr: [], sb: [], sel: 0, sh: 0, co: 0, chips: {}, mods: {}, chars: [0], char: 0, items: { heal: 2, shield: 1, ammo: 1 }, bagSel: ["heal", "shield", "ammo"], sv: 2 });
const clone = (v) => JSON.parse(JSON.stringify(v));
const mk = (patch = {}) => ({ ...clone(DEFAULTS), ...clone(patch) });
const merge = (base, local, remote) => mergeSaves({ base, local, remote, defaults: DEFAULTS }).save;

/* ───────────── 合併 ───────────── */

test("合併：貨幣 = base + 兩邊各自的變化（一邊賺、一邊花都保留）", () => {
  const base = mk({ coins: 100, sh: 10, co: 5 });
  const out = merge(base, mk({ coins: 400, sh: 10, co: 2 }), mk({ coins: 0, sh: 25, co: 5 }));
  assert.equal(out.coins, 300); // 100 + 300 - 100
  assert.equal(out.sh, 25);
  assert.equal(out.co, 2);
});

test("合併：沒有 base 時貨幣取較大值，不會加總翻倍", () => {
  const out = merge(null, mk({ coins: 500 }), mk({ coins: 500 }));
  assert.equal(out.coins, 500);
  assert.equal(merge(null, mk({ coins: 120 }), mk({ coins: 900 })).coins, 900);
});

test("合併：貨幣不會變成負數", () => {
  assert.equal(merge(mk({ coins: 100 }), mk({ coins: 0 }), mk({ coins: 0 })).coins, 0);
});

test("合併：武器與角色取聯集、通關與最佳波數逐格取大、強化取大", () => {
  const out = merge(mk({ own: [7] }), mk({ own: [7, 3], chars: [0, 1], clr: [1, 1, 0], sb: [5, 9], up: { hp: 2 } }), mk({ own: [7, 9], chars: [0, 2], clr: [1, 0, 1, 1], sb: [8, 4, 3], up: { hp: 1, spd: 3 } }));
  assert.deepEqual(out.own, [7, 3, 9]);
  assert.deepEqual(out.chars, [0, 1, 2]);
  assert.deepEqual(out.clr, [1, 1, 1, 1]);
  assert.deepEqual(out.sb, [8, 9, 3]);
  assert.deepEqual(out.up, { hp: 2, spd: 3 });
});

test("合併：晶片與道具逐項三方合併，道具上限 9", () => {
  const base = mk({ chips: { 1: 2 }, items: { heal: 2, shield: 1, ammo: 1 } });
  const out = merge(base, mk({ chips: { 1: 3, 4: 1 }, items: { heal: 9, shield: 1, ammo: 0 } }), mk({ chips: { 1: 2, 5: 2 }, items: { heal: 9, shield: 3, ammo: 1 } }));
  assert.deepEqual(out.chips, { 1: 3, 4: 1, 5: 2 });
  assert.equal(out.items.heal, 9, "9 + 9 - 2 超過上限，被截到 9");
  assert.equal(out.items.shield, 3);
  assert.equal(out.items.ammo, 0);
});

test("合併：選擇類欄位——只有一邊改過就用那邊，兩邊都改用本機", () => {
  const base = mk({ sel: 1, char: 0, bagSel: ["heal"] });
  assert.equal(merge(base, mk({ sel: 1 }), mk({ sel: 4 })).sel, 4, "只有雲端改了");
  assert.equal(merge(base, mk({ sel: 2 }), mk({ sel: 4 })).sel, 2, "兩邊都改，用本機");
  assert.equal(merge(base, mk({ sel: 3 }), mk({ sel: 1 })).sel, 3, "只有本機改了");
  assert.deepEqual(merge(base, mk({ bagSel: ["heal"] }), mk({ bagSel: ["ammo", "heal"] })).bagSel, ["ammo", "heal"]);
});

test("合併：武器的晶片配置逐個武器各自決定", () => {
  const base = mk({ mods: { 1: [1], 2: [2] } });
  const out = merge(base, mk({ mods: { 1: [9], 2: [2] } }), mk({ mods: { 1: [1], 2: [7], 3: [4] } }));
  assert.deepEqual(out.mods, { 1: [9], 2: [7], 3: [4] });
});

test("合併：不修改傳入的物件、補齊缺少的欄位、忽略危險的鍵", () => {
  const local = mk({ coins: 5 }), remote = { coins: 7 };
  const lSnap = clone(local), rSnap = clone(remote);
  const out = merge(mk(), local, remote);
  assert.deepEqual(local, lSnap);
  assert.deepEqual(remote, rSnap);
  assert.deepEqual(out.own, [7], "雲端缺少的欄位用預設值");
  const evil = JSON.parse('{"__proto__":{"polluted":1},"coins":3}');
  merge(null, mk(), evil);
  assert.equal({}.polluted, undefined);
});

test("stableStringify / sameSave：鍵的順序不影響比較", () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.ok(sameSave(mk(), mk()));
  assert.ok(!sameSave(mk(), mk({ coins: 1 })));
  assert.ok(isPristine(mk(), DEFAULTS));
  assert.ok(!isPristine(mk({ own: [7, 1] }), DEFAULTS));
});

/* ───────────── 同步引擎：假伺服器、假帳號、假計時器 ───────────── */

function makeServer() {
  const server = { save: null, revision: 0, calls: { download: 0, upload: 0 }, failNext: [], beforeUpload: null };
  return server;
}

function makeDevice(server, { userId = "u1", unlocked = true, signedIn = true, localSave = mk(), canApply = true, auto = true } = {}) {
  const device = { local: clone(localSave), canApply, auto, meta: null, timers: [], applied: 0, statuses: [] };
  const svc = new EventTarget();
  Object.assign(svc, {
    signedIn, unlocked, userId,
    async downloadSave() {
      server.calls.download++;
      const fail = server.failNext.shift();
      if (fail) throw fail;
      if (!server.save) throw new ApiError("none", { status: 404, code: "SAVE_NOT_FOUND" });
      return { save: clone(server.save), revision: server.revision };
    },
    async uploadSave(save, { expectedRevision } = {}) {
      server.calls.upload++;
      const fail = server.failNext.shift();
      if (fail) throw fail;
      server.beforeUpload?.();
      server.beforeUpload = null;
      if (expectedRevision === null) {
        if (server.save) throw new ApiError("exists", { status: 409, code: "SAVE_ALREADY_EXISTS" });
      } else if (expectedRevision !== server.revision) throw new ApiError("conflict", { status: 409, code: "REVISION_CONFLICT" });
      server.save = clone(save);
      return ++server.revision;
    },
  });
  device.svc = svc;
  device.sync = new CloudSync({
    service: svc,
    defaults: DEFAULTS,
    autoEnabled: () => device.auto,
    bridge: {
      getSave: () => clone(device.local),
      applySave: (s) => { device.local = clone(s); device.applied++; },
      normalize: (s) => { const o = clone(DEFAULTS); for (const k of Object.keys(s ?? {})) if (k in o) o[k] = clone(s[k]); return o; },
      canApply: () => device.canApply,
    },
    storage: { get: () => device.meta, set: (m) => { device.meta = clone(m); }, clear: () => { device.meta = null; } },
    now: () => 1_000_000 + device.timers.length,
    setTimer: (fn, ms) => { const t = { fn, ms, id: device.timers.length }; device.timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    debounceMs: 8000,
  });
  device.sync.addEventListener("status", (e) => device.statuses.push(e.detail.status));
  device.fire = async () => { const t = device.timers.filter((x) => !x.cleared && !x.fired).pop(); if (t) { t.fired = true; await t.fn(); } };
  device.pendingTimers = () => device.timers.filter((x) => !x.cleared && !x.fired);
  device.idle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  return device;
}

test("第一次同步：雲端空的、本機有進度 → 上傳；本機也是空的 → 什麼都不傳", async () => {
  const server = makeServer();
  const empty = makeDevice(server);
  await empty.sync.sync();
  assert.equal(server.calls.upload, 0);
  assert.equal(empty.sync.status, "synced");

  const a = makeDevice(server, { localSave: mk({ coins: 120, own: [7, 3] }) });
  await a.sync.sync();
  assert.equal(server.revision, 1);
  assert.equal(server.save.coins, 120);
  assert.equal(a.sync.revision, 1);
  assert.equal(a.sync.status, "synced");
});

test("新裝置（本機是空的）登入 → 自動載入雲端進度", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 120, own: [7, 3] }) });
  await a.sync.sync();
  const b = makeDevice(server);
  await b.sync.sync();
  assert.equal(b.applied, 1);
  assert.equal(b.local.coins, 120);
  assert.deepEqual(b.local.own, [7, 3]);
  assert.equal(b.sync.status, "synced");
});

test("本機變動 → 去抖後自動上傳；連續變動只上傳一次；另一台自動拉到新進度", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }) });
  const b = makeDevice(server);
  await a.sync.sync(); await b.sync.sync();
  const uploads = server.calls.upload;
  a.local.coins = 50; a.sync.markDirty();
  a.local.coins = 80; a.sync.markDirty();
  a.local.coins = 99; a.sync.markDirty();
  assert.equal(a.pendingTimers().length, 1, "只留一個去抖計時器");
  await a.fire();
  assert.equal(server.calls.upload, uploads + 1);
  assert.equal(server.save.coins, 99);
  await b.sync.sync({ reason: "poll" });
  assert.equal(b.local.coins, 99, "B 沒有未同步的變動 → 直接採用雲端");
});

test("本機沒有變動時，去抖觸發的同步不會打擾伺服器", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }) });
  await a.sync.sync();
  const before = server.calls.download + server.calls.upload;
  a.sync.markDirty();
  await a.fire();
  assert.equal(server.calls.download + server.calls.upload, before);
  assert.equal(a.sync.status, "synced");
});

test("兩台裝置各自玩了一段：自動三方合併，兩邊的進度都保留並上傳", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 100, own: [7] }) });
  const b = makeDevice(server);
  await a.sync.sync(); await b.sync.sync();
  // A 賺了 300 並買了武器 3；B 花了 40 並通關第 1 關
  a.local.coins = 400; a.local.own = [7, 3];
  b.local.coins = 60; b.local.clr = [1];
  await a.sync.sync();
  await b.sync.sync();
  assert.equal(b.local.coins, 360, "100 + 300 - 40");
  assert.deepEqual(b.local.own, [7, 3]);
  assert.deepEqual(b.local.clr, [1]);
  assert.equal(server.save.coins, 360);
  await a.sync.sync({ reason: "poll" });
  assert.equal(a.local.coins, 360, "A 之後也拿到合併結果");
  assert.deepEqual(a.local.clr, [1]);
});

test("上傳時版本被別台搶先 → 重新取得雲端、重新合併後再傳，不會蓋掉對方", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 100 }) });
  const b = makeDevice(server);
  await a.sync.sync(); await b.sync.sync();
  a.local.coins = 150; // A +50
  // 就在 A 要上傳的瞬間，B 搶先上傳了 +7
  server.beforeUpload = () => { server.save = { ...clone(server.save), coins: 107 }; server.revision++; };
  await a.sync.sync();
  assert.equal(server.save.coins, 157, "100 + 50 + 7");
  assert.equal(a.local.coins, 157);
  assert.equal(a.sync.status, "synced");
});

test("第一次同步、兩邊都有進度、沒有共同的底 → 停在衝突，不自動覆蓋任何一邊", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 500, own: [7, 1] }) });
  await a.sync.sync();
  const b = makeDevice(server, { localSave: mk({ coins: 30, own: [7, 2] }) });
  await b.sync.sync();
  assert.equal(b.sync.status, "conflict");
  assert.equal(b.local.coins, 30, "本機沒被動");
  assert.equal(server.save.coins, 500, "雲端沒被動");
  assert.equal(b.sync.conflict.remote.save.coins, 500);
  b.sync.markDirty();
  assert.equal(b.pendingTimers().length, 0, "衝突時不排程自動上傳");

  await b.sync.resolveConflict("merge");
  assert.equal(b.sync.status, "synced");
  assert.equal(b.local.coins, 500, "沒有共同的底 → 貨幣取較大值，不加總");
  assert.deepEqual([...b.local.own].sort(), [1, 2, 7], "武器取聯集");
  assert.equal(server.save.coins, 500);
  assert.equal(b.sync.conflict, null);
});

test("衝突：選「以雲端為準」與「以本機為準」", async () => {
  for (const choice of ["cloud", "local"]) {
    const server = makeServer();
    const a = makeDevice(server, { localSave: mk({ coins: 500 }) });
    await a.sync.sync();
    const b = makeDevice(server, { localSave: mk({ coins: 30 }) });
    await b.sync.sync();
    await b.sync.resolveConflict(choice);
    assert.equal(b.sync.status, "synced");
    if (choice === "cloud") { assert.equal(b.local.coins, 500); assert.equal(server.save.coins, 500); }
    else { assert.equal(b.local.coins, 30); assert.equal(server.save.coins, 30); }
  }
});

test("衝突：戰鬥中不能選雲端／合併（會替換存檔），狀態維持衝突", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 500 }) });
  await a.sync.sync();
  const b = makeDevice(server, { localSave: mk({ coins: 30 }), canApply: false });
  await b.sync.sync();
  await assert.rejects(b.sync.resolveConflict("cloud"), /主選單/);
  assert.equal(b.sync.status, "conflict");
  assert.equal(b.local.coins, 30);
});

test("戰鬥中雲端有新進度 → 先擱著（pending），回到選單後才套用", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }) });
  const b = makeDevice(server);
  await a.sync.sync(); await b.sync.sync();
  a.local.coins = 77; await a.sync.sync();
  b.canApply = false;
  await b.sync.sync({ reason: "poll" });
  assert.equal(b.sync.status, "pending");
  assert.equal(b.local.coins, 10, "戰鬥中不替換存檔");
  b.canApply = true;
  b.sync.poke("pending");
  await b.idle();
  assert.equal(b.local.coins, 77);
  assert.equal(b.sync.status, "synced");
});

test("網路失敗 → 標示離線並指數退避重試；恢復後自動同步成功", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }) });
  server.failNext.push(new ApiError("net", { code: "NETWORK" }));
  await a.sync.sync();
  assert.equal(a.sync.status, "offline");
  const first = a.pendingTimers().at(-1);
  assert.equal(first.ms, 5000);
  server.failNext.push(new ApiError("timeout", { code: "TIMEOUT" }));
  await a.fire();
  await a.idle();
  assert.equal(a.sync.status, "offline");
  assert.equal(a.pendingTimers().at(-1).ms, 10000, "第二次失敗，等待加倍");
  await a.fire();
  await a.idle();
  assert.equal(a.sync.status, "synced");
  assert.equal(server.save.coins, 10, "最後有成功上傳");
});

test("伺服器 5xx 與 429 也算暫時性錯誤；4xx（如存檔格式錯）不自動重試", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }) });
  server.failNext.push(new ApiError("busy", { status: 503 }));
  await a.sync.sync();
  assert.equal(a.sync.status, "offline");
  server.failNext.push(new ApiError("bad", { status: 400, code: "INVALID_PAYLOAD" }));
  await a.fire(); await a.idle();
  assert.equal(a.sync.status, "error");
  assert.equal(a.pendingTimers().length, 0, "不會一直重試");
});

test("自動同步關閉：不排程、不重試；手動同步仍可用", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }), auto: false });
  a.sync.markDirty();
  assert.equal(a.pendingTimers().length, 0);
  await a.sync.sync({ reason: "manual" });
  assert.equal(server.save.coins, 10);
});

test("未登入／未解鎖：狀態正確，解鎖後自動同步一次", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }), signedIn: false });
  assert.equal(a.sync.status, "off");
  a.svc.signedIn = true; a.svc.unlocked = false;
  a.svc.dispatchEvent(new Event("change"));
  assert.equal(a.sync.status, "locked");
  await a.sync.sync();
  assert.equal(a.sync.status, "locked");
  assert.equal(server.calls.upload, 0);
  a.svc.unlocked = true;
  a.svc.dispatchEvent(new Event("change"));
  await a.idle();
  assert.equal(a.sync.status, "synced");
  assert.equal(server.save.coins, 10);
});

test("同一時間只跑一次同步；跑的途中又被呼叫會在結束後補一次", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }) });
  const p1 = a.sync.sync(), p2 = a.sync.sync(), p3 = a.sync.sync();
  assert.equal(p1, p2); assert.equal(p2, p3);
  await p1;
  assert.equal(server.calls.upload, 1);
  assert.equal(a.pendingTimers().length >= 1, true, "補跑已排程");
});

test("換了另一個帳號：舊帳號的「上次同步」資訊不會被拿來合併", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }), userId: "u1" });
  await a.sync.sync();
  assert.equal(a.meta.userId, "u1");
  const other = makeDevice(server, { localSave: mk({ coins: 999 }), userId: "u2" });
  other.meta = clone(a.meta); // 同一台裝置，先前是 u1 登入
  assert.equal(other.sync.revision, null);
  await other.sync.sync();
  assert.equal(other.sync.status, "conflict", "沒有屬於 u2 的底，兩邊都有進度 → 讓玩家決定");
});

test("強制上傳與強制載入：不比對，會更新「上次同步」資訊", async () => {
  const server = makeServer();
  const a = makeDevice(server, { localSave: mk({ coins: 10 }) });
  await a.sync.sync();
  a.local.coins = 5;
  await a.sync.forceUpload();
  assert.equal(server.save.coins, 5);
  server.save.coins = 777; server.revision++;
  await a.sync.forcePull();
  assert.equal(a.local.coins, 777);
  assert.equal(a.sync.revision, server.revision);
  a.canApply = false;
  await assert.rejects(a.sync.forcePull(), /主選單/);
});
