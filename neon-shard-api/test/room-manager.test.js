import test from "node:test";
import assert from "node:assert/strict";
import { MATCH_RULES, RoomManager } from "../src/room-manager.js";
import { TokenBucket } from "../src/rate-limiter.js";

/** 假連線：把收到的訊息記下來 */
function connect(manager, id, name = id) {
  const inbox = [];
  const closed = [];
  const player = manager.createPlayer({ id, name, send: (m) => inbox.push(m), close: (code, reason) => closed.push([code, reason]) });
  return { player, inbox, closed, last: (type) => [...inbox].reverse().find((m) => m.type === type) };
}

test("加入房間：代碼不分大小寫、需為 4–8 位英數字；加入後所有人收到名單", () => {
  const m = new RoomManager();
  const a = connect(m, "a"), b = connect(m, "b");
  assert.equal(m.join(a.player, { code: "ab", mode: "arena" }).ok, false);
  assert.equal(m.join(a.player, { code: "ab-cd!", mode: "arena" }).ok, false);
  assert.equal(m.join(a.player, { code: "neon01", mode: "arena" }).ok, true);
  assert.equal(m.join(b.player, { code: "NEON01", mode: "arena" }).ok, true);
  assert.equal(a.last("room").code, "NEON01");
  assert.equal(a.last("room").players.length, 2);
});

test("模式不符或人數已滿會被拒絕；房間滿 4 人", () => {
  const m = new RoomManager();
  const ps = ["a", "b", "c", "d", "e"].map((id) => connect(m, id));
  for (const p of ps.slice(0, 4)) assert.equal(m.join(p.player, { code: "ROOM1", mode: "boss" }).ok, true);
  assert.equal(m.join(ps[4].player, { code: "ROOM1", mode: "boss" }).ok, false, "第 5 人");
  assert.equal(m.join(ps[4].player, { code: "ROOM1", mode: "arena" }).ok, false, "模式不同");
});

test("【回歸】同一帳號開兩個分頁：關掉舊連線不會把新連線踢出房間", () => {
  const m = new RoomManager();
  const tab1 = connect(m, "same"), tab2 = connect(m, "same");
  m.join(tab1.player, { code: "ROOM1", mode: "arena" });
  m.join(tab2.player, { code: "ROOM1", mode: "arena" });
  assert.deepEqual(tab1.closed, [[4409, "signed in elsewhere"]], "舊連線被請出");
  m.leave(tab1.player); // 舊分頁的 socket 之後觸發 close
  assert.equal(m.roomCount, 1, "房間仍在");
  assert.equal(tab2.player.room?.code, "ROOM1", "新連線仍在房間內");
  assert.equal(m.move(tab2.player, 0.2, 0.2), true);
});

test("同一帳號換房間：離開舊房間，空房間會被刪除", () => {
  const m = new RoomManager();
  const a = connect(m, "a");
  m.join(a.player, { code: "AAAA", mode: "arena" });
  m.join(a.player, { code: "BBBB", mode: "arena" });
  assert.equal(m.roomCount, 1);
  m.leave(a.player);
  assert.equal(m.roomCount, 0);
});

test("房間數量有上限", () => {
  const m = new RoomManager({ maxRooms: 2 });
  assert.equal(m.join(connect(m, "a").player, { code: "AAAA", mode: "arena" }).ok, true);
  assert.equal(m.join(connect(m, "b").player, { code: "BBBB", mode: "arena" }).ok, true);
  assert.equal(m.join(connect(m, "c").player, { code: "CCCC", mode: "arena" }).ok, false);
  assert.equal(m.join(connect(m, "d").player, { code: "AAAA", mode: "arena" }).ok, true, "已存在的房間仍可加入");
});

test("移動：座標限制在 0~1，非數字被忽略，並廣播給房間", () => {
  const m = new RoomManager();
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "ROOM1", mode: "arena" }); m.join(b.player, { code: "ROOM1", mode: "arena" });
  assert.equal(m.move(a.player, 5, -3), true);
  assert.deepEqual([a.player.x, a.player.y], [1, 0]);
  assert.equal(b.last("move").x, 1);
  assert.equal(m.move(a.player, NaN, 0.5), false);
  assert.equal(m.move(connect(m, "x").player, 0.5, 0.5), false, "不在房間內");
});

test("攻擊：450ms 冷卻；Boss 模式扣 Boss 血；競技場優先打範圍內玩家，否則打敵人", () => {
  let now = 1000;
  const m = new RoomManager({ now: () => now });
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "BOSS1", mode: "boss" }); m.join(b.player, { code: "ARENA", mode: "arena" });
  assert.equal(m.attack(a.player), true);
  assert.equal(a.last("combat").bossHp, 980);
  assert.equal(m.attack(a.player), false, "冷卻中");
  now += 450;
  assert.equal(m.attack(a.player), true);
  // 競技場
  const c = connect(m, "c"); m.join(c.player, { code: "ARENA", mode: "arena" });
  b.player.x = 0.5; b.player.y = 0.5; c.player.x = 0.55; c.player.y = 0.5;
  now += 450; m.attack(b.player);
  assert.equal(c.player.hp, 80, "範圍內的玩家受到傷害");
  c.player.x = 0.9;
  now += 450; m.attack(b.player);
  assert.equal(c.player.hp, 80, "超出範圍不受傷");
  assert.equal(b.last("combat").mobs[0].hp, 20, "改打敵人");
});

test("某個連線送不出訊息，不影響其他人收到廣播", () => {
  const m = new RoomManager();
  const bad = m.createPlayer({ id: "bad", name: "x", send() { throw new Error("socket closed"); } });
  const good = connect(m, "good");
  m.join(bad, { code: "ROOM1", mode: "arena" });
  m.join(good.player, { code: "ROOM1", mode: "arena" });
  assert.equal(good.last("room").players.length, 2);
});

test("TokenBucket：允許短暫爆發，長期不能超過補充速度", () => {
  let now = 0;
  const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 10, now: () => now });
  const burst = Array.from({ length: 7 }, () => bucket.tryRemove());
  assert.deepEqual(burst, [true, true, true, true, true, false, false]);
  now += 100; // 補 1 個
  assert.equal(bucket.tryRemove(), true);
  assert.equal(bucket.tryRemove(), false);
  now += 10_000; // 補滿但不超過容量
  assert.equal(Array.from({ length: 10 }, () => bucket.tryRemove()).filter(Boolean).length, 5);
  assert.throws(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 }), RangeError);
});

/* ───────── 對戰：合作（boss）與競爭（arena） ───────── */
const rooms = (opts) => { const m = new RoomManager(opts); return { m, mk: (id, mode = "arena", code = "MATCH1") => { const c = connect(m, id); m.join(c.player, { code, mode }); return c; } }; };

test("開始對戰：只有房主、人數足夠、大廳階段才能開始；開始後不能再加入", () => {
  const { m, mk } = rooms();
  const a = mk("a"); const b = mk("b");
  assert.equal(m.start(b.player).ok, false, "非房主");
  const solo = rooms(); const s = solo.mk("s");
  assert.match(solo.m.start(s.player).message, /至少需要 2/);
  assert.equal(m.start(a.player).ok, true);
  const started = a.last("started");
  assert.equal(started.mode, "arena");
  assert.deepEqual(Object.keys(started.spawns).sort(), ["a", "b"]);
  assert.equal(a.last("room").phase, "playing");
  assert.equal(m.start(a.player).ok, false, "不能重複開始");
  const late = connect(m, "late");
  assert.match(m.join(late.player, { code: "MATCH1", mode: "arena" }).message, /已經開始/);
});

test("合作模式：一個人就能開始；Boss 血量共用，扣到 0 全員勝利", () => {
  let now = 10_000;
  const { m, mk } = rooms({ now: () => now });
  const a = mk("a", "boss"), b = mk("b", "boss");
  assert.equal(m.start(a.player).ok, true);
  assert.equal(m.bossDamage(a.player, 100), true);
  assert.equal(m.bossDamage(b.player, 100), true);
  assert.equal(b.last("combat").bossHp, 800, "兩人的傷害加在同一條血量上");
  now += 5000; // 令牌桶補滿
  assert.equal(m.bossDamage(a.player, 9999), true);
  assert.equal(a.last("combat").bossHp, 650, "單次回報有上限（150）");
  for (let i = 0; i < 5; i++) { now += 5000; m.bossDamage(i % 2 ? a.player : b.player, 150); }
  const end = a.last("end");
  assert.equal(end.result.victory, true);
  assert.equal(a.last("room").phase, "ended");
  assert.equal(m.bossDamage(a.player, 10), false, "結束後不能再扣血");
  assert.ok(end.result.scores.every((x) => x.score > 0), "雙方都有貢獻分數");
});

test("合作模式：傷害有每秒上限（令牌桶），亂報的值無效", () => {
  const { m, mk } = rooms({ now: () => 10_000 });
  const a = mk("a", "boss"); m.start(a.player);
  assert.equal(m.bossDamage(a.player, 150), true);
  assert.equal(m.bossDamage(a.player, 150), false, "容量 200，第二次超過");
  assert.equal(m.bossDamage(a.player, -5), false);
  assert.equal(m.bossDamage(a.player, NaN), false);
});

test("合作模式：全員倒下就是失敗；倒下的人不能再扣 Boss 血", () => {
  const { m, mk } = rooms();
  const a = mk("a", "boss"), b = mk("b", "boss"); m.start(a.player);
  assert.equal(m.died(a.player), true);
  assert.equal(m.bossDamage(a.player, 10), false, "倒下的人不能攻擊");
  assert.equal(b.last("eliminated").id, "a");
  assert.equal(m.died(b.player), true);
  assert.equal(a.last("end").result.victory, false);
});

test("合作模式：隊友血量由各端回報（0~1），只用於顯示", () => {
  const { m, mk } = rooms();
  const a = mk("a", "boss"), b = mk("b", "boss"); m.start(a.player);
  m.move(a.player, 0.4, 0.4, 0.25);
  assert.equal(b.last("move").hp, 25);
});

test("競爭模式：命中回報扣伺服器血量；距離、冷卻、單次上限都有檢查", () => {
  let now = 0;
  const { m, mk } = rooms({ now: () => now });
  const a = mk("a"), b = mk("b"); m.start(a.player);
  assert.equal(m.hit(a.player, "a", 10), false, "不能打自己");
  assert.equal(m.hit(a.player, "zzz", 10), false, "目標不存在");
  assert.equal(m.hit(a.player, "b", 10), true);
  assert.equal(b.player.hp, 90);
  assert.equal(m.hit(a.player, "b", 999), true);
  assert.equal(b.player.hp, 50, "單次最多 40");
  b.player.x = 0.2; b.player.y = 0.2; a.player.x = 0.95; a.player.y = 0.95;
  assert.equal(m.hit(a.player, "b", 5), false, "距離太遠（超過 0.9）");
  a.player.x = 0.3; a.player.y = 0.3;
  now += 5000; // 令牌桶補滿
  assert.equal(m.hit(a.player, "b", 40), true);
  assert.equal(m.hit(a.player, "b", 40), true, "容量 80，還夠");
  assert.equal(m.hit(a.player, "b", 40), false, "超過每秒傷害上限");
});

test("競爭模式：血量歸零淘汰；剩最後一人時結束，贏家是存活者", () => {
  let now = 0;
  const { m, mk } = rooms({ now: () => now });
  const a = mk("a"), b = mk("b"), c = mk("c"); m.start(a.player);
  for (const t of [1, 2]) { now += 5000; m.hit(a.player, "b", 40); now += 5000; m.hit(a.player, "b", 40); now += 5000; m.hit(a.player, "b", 40); if (t) break; }
  assert.equal(b.player.alive, false);
  assert.equal(c.last("eliminated").by, "a");
  assert.equal(a.last("room").phase, "playing", "還有兩人存活，繼續");
  now += 5000; m.hit(a.player, "c", 40); now += 5000; m.hit(a.player, "c", 40); now += 5000; m.hit(a.player, "c", 40);
  const end = a.last("end");
  assert.equal(end.result.winnerId, "a");
  assert.equal(end.result.scores[0].kills, 2);
  assert.equal(m.hit(a.player, "b", 10), false, "結束後不能再打");
});

test("競爭模式：打弱敵人得分；時間到以存活與分數排名；弱敵人會重生", () => {
  let now = 0;
  const { m, mk } = rooms({ now: () => now });
  const a = mk("a"), b = mk("b"); m.start(a.player);
  a.player.x = 0.3; a.player.y = 0.3;
  assert.equal(m.hit(a.player, "m1", 30), true);
  assert.equal(a.last("combat").mobs[0].hp, 0);
  assert.equal(a.player.score, 1);
  assert.equal(m.hit(a.player, "m1", 5), false, "已死亡的敵人不能再打");
  now += 6000; m.tick();
  assert.equal(a.last("combat").mobs[0].hp, 30, "6 秒後重生");
  now += 150_000; m.tick();
  const end = b.last("end");
  assert.equal(end.result.winnerId, "a", "分數較高者勝");
  assert.equal(b.last("room").phase, "ended");
});

test("彈道轉發：只轉給其他人、有間隔與數量限制、非數字被丟棄", () => {
  let now = 10_000;
  const { m, mk } = rooms({ now: () => now });
  const a = mk("a"), b = mk("b"); m.start(a.player);
  const shot = { x: 0.5, y: 0.5, vx: 1, vy: 0 };
  assert.equal(m.shots(a.player, [shot]), true);
  assert.equal(b.last("shot").id, "a");
  assert.equal(a.inbox.some((x) => x.type === "shot"), false, "不會回傳給發射者");
  assert.equal(m.shots(a.player, [shot]), false, "間隔太短");
  now += 100;
  assert.equal(m.shots(a.player, [{ x: "x", y: 1, vx: 1, vy: 1 }]), false, "非數字");
  now += 100;
  m.shots(a.player, Array.from({ length: 20 }, () => shot));
  assert.equal(b.last("shot").shots.length, 6, "單次最多 6 顆");
});

test("房主離開時換房主；結算後房主可重置回大廳", () => {
  const { m, mk } = rooms();
  const a = mk("a"), b = mk("b"), c = mk("c");
  m.leave(a.player);
  assert.equal(b.last("room").hostId, "b");
  m.start(b.player);
  m.leave(c.player); // 對戰中有人離開：剩下一人 → 競爭模式結束
  assert.equal(b.last("room").phase, "ended");
  assert.equal(m.reset(c.player), false, "非房主");
  assert.equal(m.reset(b.player), true);
  assert.equal(b.last("room").phase, "lobby");
  assert.equal(b.player.alive, true);
});

test("舊版攻擊只在大廳可用；對戰中改用 hit / bossDamage", () => {
  let now = 10_000;
  const { m, mk } = rooms({ now: () => now });
  const a = mk("a"), b = mk("b"); void b;
  assert.equal(m.attack(a.player), true);
  m.start(a.player); now += 1000;
  assert.equal(m.attack(a.player), false);
});

/* ───────────── 斷線重連 ───────────── */

function clockManager() {
  const clock = { t: 1_000_000 };
  const m = new RoomManager({ now: () => clock.t });
  return { m, clock };
}

test("斷線：大廳裡直接移除（還沒開始不需要保留位置）", () => {
  const { m } = clockManager();
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "LOBBY1", mode: "arena" });
  m.join(b.player, { code: "LOBBY1", mode: "arena" });
  m.disconnect(b.player);
  assert.equal(a.last("room").players.length, 1);
});

test("斷線：對戰中保留位置、對手看到「連線中斷」，對戰不會因此結束", () => {
  const { m } = clockManager();
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "DROP01", mode: "arena" });
  m.join(b.player, { code: "DROP01", mode: "arena" });
  m.start(a.player);
  m.disconnect(b.player);
  const snap = a.last("room");
  assert.equal(snap.phase, "playing");
  assert.equal(snap.players.length, 2, "位置還在");
  assert.equal(snap.players.find((p) => p.id === "b").connected, false);
  assert.equal(snap.players.find((p) => p.id === "a").connected, true);
  assert.equal(a.last("end"), undefined, "沒有因為對手斷線就結束");
});

test("重連：寬限期內用同一帳號回來，沿用血量與分數，並重發開戰資訊（種子、出生點）與戰況", () => {
  const { m, clock } = clockManager();
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "BACK01", mode: "arena" });
  m.join(b.player, { code: "BACK01", mode: "arena" });
  m.start(a.player);
  const started = a.last("started");
  a.player.x = b.player.x = 0.5; a.player.y = b.player.y = 0.5; // 拉近距離，hit 才會成立
  m.hit(a.player, "b", 30); // b 剩 70 血
  m.disconnect(b.player);
  clock.t += 10_000; // 10 秒後回來
  const b2 = connect(m, "b");
  assert.equal(m.join(b2.player, { code: "BACK01", mode: "arena" }).ok, true);
  assert.equal(b2.player.hp, 70, "血量沿用");
  const resumed = b2.last("started");
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.seed, started.seed, "同一個亂數種子 → 還原同一張地圖");
  assert.deepEqual(resumed.spawns, started.spawns);
  assert.equal(b2.last("combat").players.find((p) => p.id === "b").hp, 70);
  assert.equal(a.last("room").players.find((p) => p.id === "b").connected, true, "對手看到他回來了");
  assert.equal(a.inbox.filter((x) => x.type === "started").length, 1, "其他人不會收到第二次開戰訊息");
});

test("重連：逾時未回來就被移出房間；競爭模式因此只剩一人 → 結算", () => {
  const { m, clock } = clockManager();
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "LATE01", mode: "arena" });
  m.join(b.player, { code: "LATE01", mode: "arena" });
  m.start(a.player);
  m.disconnect(b.player);
  clock.t += MATCH_RULES.reconnectGraceMs - 1000;
  m.tick();
  assert.equal(a.last("room").players.length, 2, "還在寬限期");
  clock.t += 2000;
  m.tick();
  assert.equal(a.last("room").players.length, 1, "逾時移除");
  assert.equal(a.last("end").result.winnerId, "a");
  // 太晚才回來：對戰已經結束，只能以新玩家身分加入已結束的房間 → 被拒絕
  const b2 = connect(m, "b");
  assert.equal(m.join(b2.player, { code: "LATE01", mode: "arena" }).ok, false);
});

test("重連：合作模式只有一位玩家也能斷線重連，Boss 血量沿用", () => {
  const { m, clock } = clockManager();
  const a = connect(m, "a");
  m.join(a.player, { code: "COOP01", mode: "boss" });
  m.start(a.player);
  m.bossDamage(a.player, 100);
  m.disconnect(a.player);
  clock.t += 5000;
  m.tick();
  const a2 = connect(m, "a");
  assert.equal(m.join(a2.player, { code: "COOP01", mode: "boss" }).ok, true);
  assert.equal(a2.last("combat").bossHp, MATCH_RULES.bossPool - 100);
  assert.equal(a2.last("started").resumed, true);
});

test("斷線的舊連線事後才觸發，不會影響已經重連的新連線；主動離開後的斷線也是無動作", () => {
  const { m } = clockManager();
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "OLD001", mode: "arena" });
  m.join(b.player, { code: "OLD001", mode: "arena" });
  m.start(a.player);
  const b2 = connect(m, "b");
  m.join(b2.player, { code: "OLD001", mode: "arena" }); // 新連線先到
  m.disconnect(b.player); // 舊連線之後才被偵測到斷線
  assert.equal(a.last("room").players.find((p) => p.id === "b").connected, true, "新連線不受影響");
  m.leave(b2.player);
  assert.doesNotThrow(() => m.disconnect(b2.player));
});

test("結算中斷線也保留位置：重連後看得到結算；房主逾時離開時換房主", () => {
  const { m, clock } = clockManager();
  const a = connect(m, "a"), b = connect(m, "b");
  m.join(a.player, { code: "END001", mode: "arena" });
  m.join(b.player, { code: "END001", mode: "arena" });
  m.start(a.player);
  a.player.x = b.player.x = 0.5; a.player.y = b.player.y = 0.5;
  for (let i = 0; i < 6; i++) { clock.t += 1000; m.hit(a.player, "b", 40); }
  assert.equal(a.last("end").result.winnerId, "a");
  m.disconnect(a.player); // 房主在結算畫面斷線
  clock.t += MATCH_RULES.reconnectGraceMs + 1;
  m.tick();
  assert.equal(b.last("room").hostId, "b", "房主逾時離開 → 房主換人");
});

test("ping 的回應由連線層處理；房間規則層的 tick 對沒有人斷線的房間沒有副作用", () => {
  const { m } = clockManager();
  const a = connect(m, "a");
  m.join(a.player, { code: "TICK01", mode: "boss" });
  const before = a.inbox.length;
  m.tick(); m.tick();
  assert.equal(a.inbox.length, before);
});
