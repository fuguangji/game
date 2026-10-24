// 擴充點的行為：狀態效果、特殊方塊、宣告式攻擊、Boss 輪替。這些是「資料／規則」，用眼睛看不出對錯，所以留在自動測試。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { enemyCatalog, bossCatalog } from "../js/config/index.js";
const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("account"))) Object.assign(X, await import(path.join(root, f)));
const { G, SV, STG, fsm } = X;
const play = () => { X.tutorial.active && X.tutorial.exit(); X.start(); G.pl.hp = G.pl.mhp = 1000; if (fsm.state !== "play") fsm.transition("play"); };

test("狀態效果：疊層、速度倍率、劇毒每 0.5 秒扣血、到期清除、未知名稱報錯", () => {
  const p = { st: {} }, hits = [], api = { hurt: (d, o) => hits.push([d, o]) };
  assert.equal(X.speedMultiplier(p), 1);
  X.applyStatus(p, "slow", { duration: 2 });
  assert.equal(X.speedMultiplier(p), 0.5);
  X.applyStatus(p, "slow", { duration: 1, stack: true });
  assert.equal(X.speedMultiplier(p), 0.3, "疊到第 2 層更慢");
  assert.equal(p.st.slow.t, 2, "持續時間取較長者，短的不會把它縮短");
  X.applyStatus(p, "poison", { stack: true }); X.applyStatus(p, "poison", { stack: true });
  X.tickStatuses(p, 0.5, api);
  assert.deepEqual(hits, [[3, { quiet: true }]], "2 層劇毒 = 每 0.5 秒 3 點安靜傷害");
  for (let i = 0; i < 20; i++) X.tickStatuses(p, 0.5, api);
  assert.equal(X.hasStatus(p, "poison"), false, "到期後自動清除");
  X.applyStatus(p, "poison"); X.clearStatus(p, "poison");
  assert.equal(X.hasStatus(p, "poison"), false);
  assert.throws(() => X.applyStatus(p, "不存在"), RangeError);
  assert.ok(X.damageTakenMultiplier({ st: { vuln: { t: 1, n: 1, acc: 0 } } }) > 1, "易傷增加受到的傷害");
});

test("安靜扣血：照樣扣血，但不觸發受傷閃紅", () => {
  play();
  G.HF = 0; const hp = G.pl.hp;
  X.hurt(5, { quiet: true });
  assert.equal(G.pl.hp, hp - 5); assert.equal(G.HF, 0);
  X.hurt(5);
  assert.ok(G.HF > 0, "一般傷害會閃紅");
});

test("宣告式攻擊：每一種有 attack 欄位的敵人，開火時發射設定的子彈數量並帶上子彈的狀態", () => {
  play();
  const shooters = enemyCatalog.all().filter((d) => d.attack);
  assert.ok(shooters.length > 0);
  for (const d of shooters) {
    G.en.length = 0; G.bl.length = 0;
    const e = X.mkEn(d.typeId, G.pl.x + 250, G.pl.y); e.aim = Math.PI; G.en.push(e);
    X.fire(e);
    assert.equal(G.bl.length, d.attack.ring || d.attack.count, `${d.name} 的子彈數量`);
    assert.ok(G.bl.every((b) => b.own === 0 && b.st === X.bulletCatalog.get(d.attack.bullet).status));
  }
});

test("Boss 輪替：無盡模式依 Boss 數量循環，一般關卡可用 boss 欄位指定", () => {
  const endless = STG.findIndex((s) => !s.g), n = bossCatalog.count, old = SV.sel;
  try {
    SV.sel = endless;
    assert.equal(X.bossIndexAt(5), 0);
    assert.equal(X.bossIndexAt(5 * n), n - 1);
    assert.equal(X.bossIndexAt(5 * (n + 1)), 0, "輪完一圈回到第一隻，Boss 增減都不必改程式");
    SV.sel = 0;
    assert.equal(X.bossIndexAt(5), STG[0].boss ?? 0);
  } finally { SV.sel = old; }
});

test("特殊方塊：自動配發編號、依密度生成、地板 onStand、實心方塊 onBreak 後清除標記", () => {
  const log = { stand: 0, broke: 0 };
  X.unregisterAllTiles();
  try {
    const lava = X.registerTile({ name: "測試岩漿", color: "#ff5a14", density: () => 1, onStand: () => log.stand++ });
    const barrel = X.registerTile({ name: "測試炸藥桶", color: "#ffaa00", solid: true, hp: 2, density: () => 0, onBreak: () => log.broke++ });
    assert.deepEqual([lava, barrel], [1, 2], "編號依註冊順序自動配發");
    assert.throws(() => X.registerTile({ name: "測試岩漿", color: "#ff5a14" }), /重複/);
    play(); X.genMap();
    const N = X.N; let floors = 0;
    for (let k = 0; k < N * N; k++) if (G.tile[k] === lava) { floors++; assert.equal(G.grid[k], 0, "地板不改變 grid，碰撞與尋路不受影響"); }
    assert.ok(floors > 100, "density = 1 時幾乎所有空地都是岩漿");
    const k = G.tile.findIndex((t) => t === lava), i = k % N, j = Math.floor(k / N);
    G.pl.x = (i + 0.5) * X.T; G.pl.y = (j + 0.5) * X.T; G.pl.dashT = 0;
    X.standOnTile(G.pl, 0.016, {});
    assert.equal(log.stand, 1);
    G.tile[k] = barrel; G.grid[k] = 2;
    X.hitCell(i, j, 99);
    assert.equal(log.broke, 1); assert.equal(G.tile[k], 0, "被打破後方塊標記清除");
  } finally { X.unregisterAllTiles(); X.genMap(); }
});
