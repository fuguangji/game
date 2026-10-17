import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/room-manager.js";
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
