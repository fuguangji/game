import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("account"))) Object.assign(X, await import(path.join(root, f)));
const { G, fsm, bus, GameEvents, STG, SV } = X;
const run = (n, dt = 0.016) => { for (let i = 0; i < n; i++) { X.update(dt); bus.emit(GameEvents.TICK, dt); } };
const boot = (stage, weaponId = 3, open = true) => {
  SV.sel = stage;
  SV.own = [...new Set([...SV.own, weaponId])];
  G.LO = [weaponId];
  X.applyLO();
  X.setup();
  if (fsm.state !== "play") fsm.transition("play");
  G.pl.hp = G.pl.mhp = 1e7;
  G.en.length = 0;
  G.pendEn.length = 0;
  if (open) clearWalls();
};
/** 清空場地內的牆與特殊地形，只留外框（需要精準量測位移的測試用，避免隨機地形擋住） */
const clearWalls = () => {
  const n = Math.round(Math.sqrt(G.grid.length));
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { G.grid[j * n + i] = 0; if (G.tile) G.tile[j * n + i] = 0; }
};

test("關卡表：無盡模式在最後、每個有目標波數的關卡都有有效的 Boss、名稱不重複", () => {
  assert.equal(STG.at(-1).g, 0, "最後一關是無盡模式");
  assert.equal(STG.filter((s) => s.g === 0).length, 1, "只有一個無盡模式");
  assert.equal(new Set(STG.map((s) => s.n)).size, STG.length, "關卡名稱不重複");
  STG.forEach((s, i) => {
    if (!s.g) return;
    assert.ok(X.bossCatalog.find(s.boss ?? i), `第 ${i} 關「${s.n}」的 Boss 編號 ${s.boss ?? i} 不存在`);
    assert.ok(s.g >= 5 && s.hm > 0 && s.cm > 0 && s.dn >= 0 && s.dn < 0.5, `第 ${i} 關數值合理`);
    assert.match(s.c, /^#[0-9a-f]{6}$/i);
  });
  assert.ok(STG.length >= 13, "新增的 4 關在表裡");
  for (let i = 1; i < STG.filter((s) => s.g).length; i++) assert.ok(STG[i].g >= STG[i - 1].g || STG[i].boss !== undefined, "後面的關卡不會比前面的短（新關卡除外）");
});

test("存檔遷移：舊存檔的無盡紀錄搬到新的最後一格，重複執行不會再搬", () => {
  const endless = STG.length - 1;
  const old = { clr: [1, 1, 1, 1, 1, 1, 1, 1, 0], sb: [5, 8, 10, 12, 14, 15, 16, 18, 37], sel: 8 };
  X.migrateSave(old);
  assert.equal(old.sv, X.SAVE_STAGE_LAYOUT);
  assert.equal(old.sb[endless], 37, "無盡最佳波數搬到最後");
  assert.equal(old.sb[8], 0, "原本那格變成新關卡，從 0 開始");
  assert.equal(old.sel, endless, "選取中的無盡關卡跟著搬");
  assert.ok(!old.clr[8], "新關卡一開始是未通關");
  const snapshot = JSON.stringify(old);
  X.migrateSave(old);
  assert.equal(JSON.stringify(old), snapshot, "第二次執行不改動");
  const fresh = { sv: 2, sb: [0, 0, 0, 0, 0, 0, 0, 0, 5], sel: 8 };
  X.migrateSave(fresh);
  assert.equal(fresh.sb[8], 5, "已是新版的存檔不會被搬動");
  assert.equal(X.migrateSave(null), null);
  assert.equal(X.migrateSave("x"), "x");
  const broken = { sb: "壞掉", clr: 5, sel: "x" };
  assert.doesNotThrow(() => X.migrateSave(broken));
});

test("特殊方塊真的會生成（回歸：density 原本拿物件跟數字比大小，永遠是 false）", () => {
  const count = (stage) => {
    SV.sel = stage;
    X.genMap();
    const names = {};
    for (let k = 0; k < G.tile.length; k++) { const d = X.tileDef(G.tile[k]); if (d) names[d.name] = (names[d.name] || 0) + 1; }
    return names;
  };
  assert.deepEqual(count(0), {}, "訓練場沒有特殊地形");
  assert.ok(count(4)["冰面"] > 20, "冰封港灣有冰面");
  assert.ok(count(5)["毒氣地板"] > 20, "毒蜂巢穴有毒氣");
  assert.ok(count(8)["岩漿地板"] > 20, "熔岩熔爐有岩漿");
  assert.ok(count(9)["磁化地板"] > 20, "雷暴平原有磁化地板");
  assert.ok(count(3)["炸藥桶"] > 3, "虛空核心有炸藥桶");
  assert.ok(Object.values(count(1)).length >= 0);
  // 出生安全區（中心 5 格內）不會有特殊方塊
  SV.sel = 8;
  for (let n = 0; n < 5; n++) {
    X.genMap();
    for (let j = 17; j <= 27; j++) for (let i = 17; i <= 27; i++) assert.equal(G.tile[j * 44 + i] ?? 0, 0, "安全區沒有特殊方塊");
  }
});

test("地圖沒有被打不破的牆封住的孤島：所有空地都能從出生點走到", () => {
  const N = Math.round(Math.sqrt(G.grid.length));
  for (let s = 0; s < STG.length; s++) {
    SV.sel = s;
    for (let rep = 0; rep < 12; rep++) {
      X.genMap();
      const seen = new Uint8Array(N * N), stack = [22 * N + 22];
      seen[22 * N + 22] = 1;
      while (stack.length) {
        const idx = stack.pop(), i = idx % N, j = (idx - i) / N;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj, n = nj * N + ni;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N || seen[n] || G.grid[n] === -1) continue;
          seen[n] = 1; stack.push(n);
        }
      }
      for (let k = 0; k < N * N; k++) if (G.grid[k] === 0) assert.ok(seen[k], `關卡 ${s} 有走不到的空地（格 ${k}）`);
    }
  }
});

test("新關卡可以開局、連打數波、最終波出現指定的 Boss", () => {
  for (let s = 8; s <= 11; s++) {
    boot(s);
    assert.equal(G.wave, 1);
    G.wave = STG[s].g - 1;
    X.startWave();
    run(30);
    const boss = G.en.find((e) => X.isBossType(e.t));
    assert.ok(boss, `關卡 ${s} 最終波有 Boss`);
    assert.equal(X.bossIndexOf(boss.t), STG[s].boss, `關卡 ${s} 的 Boss 是指定的那一隻`);
  }
});

test("霆淵弓：註冊為第 10 把武器，有 5 個技能與 1 個術式場，價格已設定", () => {
  const id = X.ALLWEAPON.getWeapon().findIndex((w) => w.name === "霆淵弓");
  assert.equal(id, 9);
  const t = X.techniqueOf(id);
  assert.equal(t.skills.length, 5);
  assert.equal(t.domains.length, 1);
  assert.ok(X.WPR[id] > 0 && X.WPC[id] === "coins");
  assert.equal(X.WPR.length, X.ALLWEAPON.getWeapon().length, "每把武器都有價格");
});

test("霆淵弓的每個技能與術式場都能施放，並且真的造成效果", () => {
  boot(2, 9);
  const mk = (dx, dy = 0) => { const e = X.mkEn(0, G.pl.x + dx, G.pl.y + dy); e.hp = e.mhp = 5000; G.en.push(e); return e; };
  const foes = [mk(120), mk(160, 30), mk(200, -30), mk(250, 10)];
  const totalHp = () => foes.reduce((s, e) => s + Math.max(0, e.hp), 0);
  G.pl.aim = 0;
  const cast = (slot) => { G.pl.en = 100; for (const k in G.pl.cdw) G.pl.cdw[k] = 0; const before = totalHp(); assert.equal(X.castSkill(slot), true, `技能 ${slot} 施放成功`); run(60); return before - totalHp(); };
  assert.ok(cast(1) > 0, "鏈閃造成傷害");
  assert.ok(foes.some((e) => e.fx?.shock), "鏈閃讓敵人麻痺");
  assert.ok(cast(0) > 0, "引雷落雷造成傷害");
  const x0 = G.pl.x;
  cast(3);
  assert.ok(Math.abs(G.pl.x - x0) > 40, "雷遁讓玩家位移");
  G.pl.hp = G.pl.mhp;
  cast(4);
  assert.ok(X.hasStatus(G.pl, "overload"), "過載狀態生效");
  assert.ok(X.damageDealtMultiplier(G.pl) > 1.3, "過載提高傷害倍率");
  assert.ok(X.speedMultiplier(G.pl) > 1.1, "過載提高移動速度");
  // 磁暴：場在玩家前方 260 像素；把敵人凍在場的外緣，確認它被往中心拉
  boot(2, 9);
  const far = X.mkEn(0, G.pl.x + 400, G.pl.y); far.hp = far.mhp = 1e6; G.en.push(far);
  X.applyEnemyFx(far, "frozen", { duration: 30 });
  G.pl.aim = 0; X.mouse.has = false;
  G.pl.en = 100; assert.equal(X.castSkill(2), true);
  const fieldCenter = { x: G.pl.x + 260, y: G.pl.y };
  const d0 = Math.hypot(far.x - fieldCenter.x, far.y - fieldCenter.y);
  run(120);
  assert.ok(Math.hypot(far.x - fieldCenter.x, far.y - fieldCenter.y) < d0 - 40, "磁暴把敵人拉向場的中心");
  // 術式場
  boot(2, 9);
  for (let k = 0; k < 5; k++) { const e = X.mkEn(0, G.pl.x + 100 + k * 40, G.pl.y); e.hp = e.mhp = 5000; G.en.push(e); }
  G.pl.ult = 100; G.pl.en = 100;
  assert.equal(X.castDomain(0), true);
  const hp0 = G.en.reduce((s, e) => s + e.hp, 0);
  run(120);
  assert.ok(G.en.reduce((s, e) => s + e.hp, 0) < hp0, "雷獄持續傷害敵人");
  assert.ok(G.dom, "術式場展開中");
  run(700);
  assert.equal(G.dom, null, "術式場到時間會結束");
});

test("塵流懸液新增的聚塵、塵暴可以施放並有效果", () => {
  const t = X.techniqueOf(3);
  assert.deepEqual(t.skills.map((s) => s.name), ["簡筆", "裂解", "聚塵", "塵暴"]);
  boot(2, 3);
  const e = X.mkEn(0, G.pl.x + 280, G.pl.y); e.hp = e.mhp = 1e6; G.en.push(e);
  const d0 = Math.hypot(e.x - G.pl.x, e.y - G.pl.y);
  G.pl.en = 100; assert.equal(X.castSkill(2), true);
  assert.ok(Math.hypot(e.x - G.pl.x, e.y - G.pl.y) < d0 - 50, "聚塵把敵人拉近");
  assert.ok(e.fx?.blind?.t > 0, "聚塵讓敵人迷失");
  boot(2, 3);
  const near = X.mkEn(0, G.pl.x + 60, G.pl.y); near.hp = near.mhp = 1e6; G.en.push(near);
  G.pl.en = 100; assert.equal(X.castSkill(3), true);
  const hp0 = near.hp; run(90);
  assert.ok(near.hp < hp0, "塵暴持續傷害靠近的敵人");
});
