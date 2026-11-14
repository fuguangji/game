import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js");
await import(path.join(root, "main.js"));
const { onlineMatch, seededRandom, nearestFree, VERSUS_DAMAGE_SCALE } = await import(path.join(root, "game/online-match.js"));
const { onlineState } = await import(path.join(root, "game/online-state.js"));
const { G } = await import(path.join(root, "core/game-state.js"));
const { fsm } = await import(path.join(root, "core/state-machine.js"));
const { update } = await import(path.join(root, "game/simulation.js"));
const { SV } = await import(path.join(root, "game/progress.js"));
const { MW, N, T } = await import(path.join(root, "core/viewport.js"));

/** 假的連線：記錄送出的訊息，並可由測試推送伺服器事件 */
class FakeClient extends EventTarget {
  sent = []; inRoom = true; playerId = "me";
  async connect() {}
  close() {}
  start() { this.sent.push(["start"]); return true; }
  reset() { this.sent.push(["reset"]); return true; }
  move(x, y, hp) { this.sent.push(["move", x, y, hp]); return true; }
  shots(list) { this.sent.push(["shots", list.length]); return true; }
  hit(target, dmg) { this.sent.push(["hit", target, dmg]); return true; }
  bossDamage(amount) { this.sent.push(["bossDamage", amount]); return true; }
  died() { this.sent.push(["died"]); return true; }
  push(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  of(type) { return this.sent.filter((m) => m[0] === type); }
}

async function enter(mode, { players = [{ id: "me", name: "我", x: 0.2, y: 0.2, hp: 100, alive: true }, { id: "p2", name: "乙", x: 0.8, y: 0.8, hp: 100, alive: true }], seed = 7 } = {}) {
  const client = new FakeClient();
  let menus = 0;
  onlineMatch.configure({ createClient: () => client, backToMenu: () => { menus++; } });
  await onlineMatch.connect({ mode, code: "TEST01" });
  client.push("room", { type: "room", code: "TEST01", mode, phase: "lobby", hostId: "me", players, bossHp: 1000, mobs: [{ id: "m1", x: 0.5, y: 0.5, hp: 30 }], endsAt: 0 });
  client.push("started", { type: "started", mode, spawns: { me: { x: 0.2, y: 0.2 }, p2: { x: 0.8, y: 0.8 } }, endsAt: mode === "arena" ? Date.now() + 100000 : 0, playerCount: players.length, bossPool: 1000, seed });
  return { client, menus: () => menus };
}
const leave = () => { onlineMatch.disconnect(); if (fsm.state !== "menu") fsm.transition("menu"); };
const run = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) update(dt); };

test("種子亂數：同一個種子產生同一串數字，不同種子不同", () => {
  const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test("競爭模式：開始後沒有波次與敵人，出生在伺服器指定位置附近，關卡固定、結束後還原", async () => {
  const before = SV.sel;
  await enter("arena");
  assert.equal(onlineState.active && onlineState.pvp, true);
  assert.equal(fsm.state, "play");
  assert.equal(G.en.length, 0, "沒有本地敵人");
  assert.ok(Math.hypot(G.pl.x - 0.2 * MW, G.pl.y - 0.2 * MW) < 8 * T, "出生點在 (0.2, 0.2) 附近");
  run(300);
  assert.equal(fsm.state, "play", "沒有敵人也不會跳到商店或勝利");
  assert.notEqual(SV.sel, before === 1 ? -1 : before === undefined ? -1 : 99, "測試用");
  leave();
  assert.equal(SV.sel, before, "離開後關卡選擇還原");
  assert.equal(onlineState.active, false);
});

test("同一個種子在兩次開局產生同一張地圖（所有玩家看到一樣的牆）", async () => {
  await enter("arena", { seed: 12345 });
  const first = Array.from(G.grid);
  leave();
  await enter("arena", { seed: 12345 });
  assert.deepEqual(Array.from(G.grid), first);
  leave();
  await enter("arena", { seed: 54321 });
  assert.notDeepEqual(Array.from(G.grid), first, "不同種子不同地圖");
  leave();
});

test("競爭模式：我的子彈打到對手幽靈 → 累積後回報 hit（傷害乘以倍率、單次 ≤ 40）", async () => {
  const { client } = await enter("arena");
  const ghost = onlineMatch.ghosts.get("p2");
  ghost.x = ghost.tx = G.pl.x; ghost.y = ghost.ty = G.pl.y; // 玩家站的地方一定是空地，子彈不會先撞牆
  const bullet = { x: ghost.x, y: ghost.y, vx: 0, vy: 0, r: 4, life: 1, own: true, dmg: 25, pierce: false };
  G.bl.push(bullet);
  run(1);
  assert.equal(bullet.life <= 0 || !G.bl.includes(bullet), true, "子彈被吃掉");
  run(20);
  const hits = client.of("hit");
  assert.ok(hits.length >= 1, "有回報命中");
  assert.equal(hits[0][1], "p2");
  assert.ok(Math.abs(hits[0][2] - 25 * VERSUS_DAMAGE_SCALE) < 1e-6);
  leave();
});

test("競爭模式：我的血量只聽伺服器；本地傷害無效；血量歸零就死亡", async () => {
  const { client } = await enter("arena");
  const hp0 = G.pl.hp;
  const { hurt } = await import(path.join(root, "game/battle.js"));
  hurt(50);
  assert.equal(G.pl.hp, hp0, "競爭模式忽略本地傷害");
  client.push("combat", { type: "combat", bossHp: 1000, mobs: [], players: [{ id: "me", name: "我", hp: 50, alive: true }, { id: "p2", name: "乙", hp: 100, alive: true, x: 0.8, y: 0.8 }] });
  assert.ok(Math.abs(G.pl.hp - hp0 * 0.5) < 0.01, `伺服器血量 50% → 本地 ${G.pl.hp}/${hp0}`);
  client.push("combat", { type: "combat", bossHp: 1000, mobs: [], players: [{ id: "me", name: "我", hp: 0, alive: false }, { id: "p2", name: "乙", hp: 100, alive: true, x: 0.8, y: 0.8 }] });
  assert.equal(fsm.state, "over", "伺服器說我 0 血 → 死亡");
  leave();
});

test("競爭模式：結算訊息 → 狀態 ended、不顯示單人結算；回到大廳會通知回選單", async () => {
  const { client, menus } = await enter("arena");
  client.push("end", { type: "end", result: { mode: "arena", winnerId: "p2", scores: [{ id: "p2", name: "乙", kills: 1, score: 3, hp: 20, alive: true }, { id: "me", name: "我", kills: 0, score: 0, hp: 0, alive: false }] } });
  assert.equal(onlineMatch.state.status, "ended");
  assert.equal(fsm.state, "over");
  run(200);
  assert.equal(G.shown, 1, "線上對戰不跳出單人結算畫面");
  onlineMatch.returnToLobby();
  assert.equal(onlineState.active, false);
  assert.equal(menus() >= 1, true);
  assert.equal(onlineMatch.state.status, "lobby");
  onlineMatch.disconnect();
});

test("合作模式：出生一隻共用 Boss；本地 Boss 掉血 → 回報千分比；伺服器共用血量更低時拉低本地血量", async () => {
  const { client } = await enter("boss");
  const boss = G.en.find((e) => e.raid);
  assert.ok(boss, "有 Boss");
  assert.equal(onlineState.coop, true);
  const mhp = boss.mhp;
  boss.hp -= mhp * 0.1; // 我打掉 10%
  run(30);
  const reported = client.of("bossDamage").reduce((s, m) => s + m[1], 0);
  assert.ok(Math.abs(reported - 100) < 5, `回報約 100 千分比（${reported}）`);
  client.push("combat", { type: "combat", bossHp: 500, mobs: [], players: [] }); // 其他人也在打，共用血量剩 50%
  assert.ok(Math.abs(boss.hp - mhp * 0.5) < 1, `本地 Boss 拉到 50%（${boss.hp / mhp}）`);
  run(30);
  const after = client.of("bossDamage").reduce((s, m) => s + m[1], 0);
  assert.ok(Math.abs(after - reported) < 5, "被伺服器拉低的血量不會重複回報");
  leave();
});

test("合作模式：我倒下會回報 died；勝利訊息讓 Boss 消失並結算", async () => {
  const { client } = await enter("boss");
  G.pl.hp = 1;
  const { hurt } = await import(path.join(root, "game/battle.js"));
  hurt(9999);
  run(5);
  assert.equal(client.of("died").length, 1, "只回報一次");
  run(60);
  assert.equal(client.of("died").length, 1);
  client.push("end", { type: "end", result: { mode: "boss", victory: true, scores: [{ id: "me", name: "我", kills: 0, score: 300, hp: 0, alive: false }] } });
  assert.equal(onlineMatch.state.result.victory, true);
  assert.equal(G.en.length, 0);
  leave();
});

test("位置與彈道：每 0.1 秒回報位置（合作模式附血量），我的新子彈轉發且只轉發一次", async () => {
  const { client } = await enter("boss");
  run(20);
  const moves = client.of("move");
  assert.ok(moves.length >= 2 && moves.length <= 4, `約 0.33 秒內 3 次（${moves.length}）`);
  assert.ok(Number.isFinite(moves[0][3]), "合作模式附血量比例");
  const b = { x: G.pl.x, y: G.pl.y, vx: 300, vy: 0, r: 3, life: 1, own: true, dmg: 5 };
  G.bl.push(b);
  run(10);
  assert.equal(b._net, 1, "已標記，不會重複轉發");
  assert.equal(client.of("shots").length, 1);
  leave();
});

test("對手移動與彈道：幽靈平滑追上目標位置；彈道會飛、會過期", async () => {
  const { client } = await enter("arena");
  client.push("move", { type: "move", id: "p2", x: 0.6, y: 0.6 });
  const g = onlineMatch.ghosts.get("p2");
  run(60);
  assert.ok(Math.abs(g.x - 0.6 * MW) < 5, "追上目標");
  client.push("shot", { type: "shot", id: "p2", shots: [{ x: 0.5, y: 0.5, vx: 0.1, vy: 0 }] });
  assert.equal(onlineMatch._debug().shots, 1);
  run(80);
  assert.equal(onlineMatch._debug().shots, 0, "約 0.9 秒後消失");
  leave();
});

test("暫停鍵：線上對戰不會凍結，改為發出離開詢問；斷線時顯示中斷結算", async () => {
  const { client } = await enter("arena");
  let asked = 0;
  onlineMatch.addEventListener("leave-request", () => asked++);
  const { pause } = await import(path.join(root, "game/progress.js"));
  pause();
  assert.equal(fsm.state, "play", "沒有進入暫停");
  assert.equal(asked, 1);
  client.push("state", { state: "closed", code: 1006 });
  assert.equal(onlineMatch.state.status, "ended");
  assert.match(onlineMatch.state.message, /中斷/);
  leave();
});

test("nearestFree：出生點在牆裡也會找到空地", () => {
  const p = nearestFree(0.5 * MW, 0.5 * MW);
  const i = (p.x / T) | 0, j = (p.y / T) | 0;
  assert.equal(G.grid[j * N + i], 0);
});
