// 術式系統：資料正確性，以及「每個技能、每個術式場都能施放並跑完模擬、不丟例外、數值不出現 NaN」。
// 效果好不好看、手感如何請進訓練場人工確認；這裡只抓會讓遊戲壞掉的錯誤與規則（熔斷、反噬不致死、費用…）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("account"))) Object.assign(X, await import(path.join(root, f)));
const { G, fsm, tutorial } = X;
const run = (n, dt = 0.016) => { for (let i = 0; i < n; i++) X.update(dt); };
const weaponId = (name) => X.ALLWEAPON.getWeapon().findIndex((w) => w.name === name);

/** 乾淨的戰鬥場景：裝備指定術式武器，身邊有一圈敵人（含一隻 Boss）與幾顆敵方子彈 */
function scene(weapon) {
  tutorial.toBattle();
  if (fsm.state !== "play") fsm.transition("play");
  X.resetTechniques();
  const p = G.pl;
  X.WP[0] = X.modW(X.ALLWEAPON.getWeapon(weaponId(weapon))); p.w = 0;
  X.WP[0].am = X.WP[0].ms; X.WP[0].um = 0; p.sc = 0;
  Object.assign(p, { hp: 1000, mhp: 1000, en: 100, enMax: 100, cdw: {}, st: {}, heat: 50, sh: 0, dashT: 0 });
  G.en.length = 0; G.bl.length = 0; G.zones.length = 0;
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const e = X.mkEn(0, p.x + Math.cos(a) * (120 + k * 25), p.y + Math.sin(a) * (120 + k * 25)); e.hp = e.mhp = 1e5; G.en.push(e); }
  const boss = X.mkEn(X.bossCatalog.get(0).typeId, p.x + 200, p.y - 150); boss.hp = boss.mhp = 1e6; G.en.push(boss);
  return p;
}
const sane = (p) => [p.hp, p.en, p.x, p.y, ...G.en.flatMap((e) => [e.hp, e.x, e.y])].every(Number.isFinite) && p.en >= 0 && p.hp >= 1;

test("資料：每套術式都對應到武器、技能與術式場齊全、名稱不重複", () => {
  const all = X.allTechniques();
  assert.ok(all.length > 0);
  const defs = X.ALLWEAPON.getWeapon();
  defs.forEach((w, id) => assert.ok(X.techniqueOf(id), `「${w.name}」沒有註冊術式：這個遊戲只有術式武器（要新增普通武器請先移除這條檢查）`));
  const names = new Set();
  for (const t of all) {
    assert.ok(weaponId(t.weapon) >= 0, `${t.weapon} 找不到對應武器`);
    assert.ok(t.skills.length >= 1 && t.skills.length <= 6, `${t.weapon} 技能數`);
    assert.ok(t.domains.length <= 2);
    for (const s of t.skills) { assert.ok(!names.has(s.name), `技能名稱重複：${s.name}`); names.add(s.name); assert.ok(s.desc, `${s.name} 缺說明`); }
    for (const d of t.domains) assert.ok(d.desc, `${d.name} 缺說明`);
  }
});

for (const tq of X.allTechniques()) {
  test(`${tq.weapon}：每個技能與術式場都能施放並穩定模擬`, () => {
    tq.skills.forEach((sk, i) => {
      const p = scene(tq.weapon), en0 = p.en;
      assert.equal(X.castSkill(i), true, `${sk.name} 應該能施放`);
      run(150);
      assert.ok(sane(p), `${sk.name} 之後數值異常`);
      if (typeof sk.cost === "number" && sk.cost > 0 && !(sk.name === "時柳")) assert.ok(p.en < en0 + 14 * 3, `${sk.name} 應消耗能量`);
    });
    tq.domains.forEach((d, n) => {
      const p = scene(tq.weapon);
      p.ult = 100;
      assert.equal(X.castDomain(n), true, `${d.name} 應該能展開`);
      assert.ok(G.dom, "展開後 G.dom 存在");
      run(300);
      assert.ok(sane(p), `${d.name} 之後數值異常`);
    });
  });
}

test("規則：術式熔斷只擋術式（普通攻擊照常）；靈魂熔斷什麼都不能做；熔斷無效時施加不上", () => {
  const p = scene("青羽鎩");
  X.applyStatus(p, "seal", { duration: 3 });
  assert.equal(X.castSkill(0), false, "熔斷時不能施放術式");
  p.ult = 100; assert.equal(X.castDomain(0), false, "熔斷時不能展開術式場");
  X.shoot(); assert.ok(p.sc > 0 && X.WP[0].am < X.WP[0].ms, "熔斷時普通攻擊照常（出手後進入冷卻、耗了彈藥）");
  X.clearStatus(p, "seal");
  p.sc = 0; X.WP[0].am = X.WP[0].ms;
  X.applyStatus(p, "soulseal", { duration: 3 });
  X.shoot(); assert.ok(p.sc === 0 && X.WP[0].am === X.WP[0].ms, "靈魂熔斷時連普通攻擊也不行");
  X.clearStatus(p, "soulseal");
  X.applyStatus(p, "sealImmune", { duration: 5 });
  X.applyStatus(p, "seal", { duration: 3 });
  X.applyStatus(p, "soulseal", { duration: 3 });
  assert.equal(X.hasStatus(p, "seal") || X.hasStatus(p, "soulseal"), false);
});

test("規則：術式反噬不會致死（最少留 1 點）；無視反噬時不受反噬", () => {
  const p = scene("幻日虹");
  p.hp = 2;
  X.selfBacklash(5);
  assert.equal(p.hp, 1);
  p.hp = 500; X.applyStatus(p, "ignoreBacklash", { duration: 5 });
  assert.equal(X.selfBacklash(0.5), 0);
  assert.equal(p.hp, 500);
  assert.equal(p.mhp, 850, "無視反噬期間最大生命 -15%");
  X.clearStatus(p, "ignoreBacklash");
  assert.equal(p.mhp, 1000, "結束後還原");
});

test("規則：能量不足、血量不足時不能施放；爐心熔毀需要血量高於 99%", () => {
  const p = scene("噐體熔融");
  p.en = 0; assert.equal(X.castSkill(0), false);
  p.en = 100; p.hp = 400; p.ult = 100;
  assert.equal(X.castDomain(0), false, "血量不足 99%");
  p.hp = 1000; p.ult = 100; p.en = 100;
  assert.equal(X.castDomain(0), true);
  assert.ok(p.hp <= 11 && p.hp >= 1, "代價 99% 最大生命");
  assert.ok(p.en <= 20, "消耗 80% 能量");
});

test("規則：托克馬克蓄能後再按一次釋放，熱量歸零；時柳到期後昏迷", () => {
  let p = scene("青羽鎩");
  p.heat = 0;
  X.castSkill(2); run(60);
  assert.ok(p.heat > 0 && X.hasStatus(p, "slow"), "蓄能中熱量上升、移動變慢");
  X.castSkill(2);
  assert.equal(p.heat, 0, "釋放後熱量歸零");
  p = scene("未雨鎩");
  X.castSkill(0);
  assert.ok(p.en > p.enMax, "預支能量");
  run(Math.ceil(10.5 / 0.016));
  assert.ok(X.hasStatus(p, "soulseal"), "預支結束後昏迷");
});

test("規則：塵流懸圖的數字鍵控制同心圓，敵人隨層旋轉；期間不能用其他術式", () => {
  const p = scene("塵流懸液");
  p.ult = 100; X.castDomain(0);
  G.en.length = 0;
  const e = X.mkEn(0, p.x + 50, p.y); e.hp = e.mhp = 1e5; G.en.push(e); // 第 2 層（40~80）
  assert.equal(X.techDigit(2), true);
  const a0 = Math.atan2(e.y - p.y, e.x - p.x);
  run(30);
  assert.notEqual(Math.atan2(e.y - p.y, e.x - p.x).toFixed(2), a0.toFixed(2), "敵人隨著旋轉移動");
  assert.equal(X.castSkill(0), false, "術式場中不能用其他術式");
  assert.equal(X.techDigit(2), true); assert.equal(X.techDigit(2), true); // 再按兩次回到停止
});

test("規則：霜雪風域讓場內敵人看不見你，且幾乎無法傷到你；你出不去", () => {
  const p = scene("驥隱流楓");
  p.ult = 100; X.castDomain(0);
  const e = G.en[0];
  assert.ok(X.blindTarget(e), "場內敵人追的是假位置");
  run(2); // 讓術式場的庇護狀態生效
  const hp = p.hp; X.hurt(500);
  assert.ok(hp - p.hp < 1, "敵方傷害幾乎無效");
  p.x += 9999; run(2);
  assert.ok(Math.hypot(p.x - G.dom.x, p.y - G.dom.y) < G.dom.r, "被限制在場內");
});

test("敵人效果：熔斷的敵人不會開火、靈魂熔斷不能移動；Boss 免疫靈魂熔斷", () => {
  const p = scene("幻日虹");
  const e = X.mkEn(X.enemyCatalog.byName("毒霧").typeId, p.x + 200, p.y); e.hp = e.mhp = 1e5; G.en.push(e);
  X.applyEnemyFx(e, "seal", { duration: 5 });
  G.bl.length = 0; X.fire(e);
  assert.equal(G.bl.length, 0, "熔斷中不開火");
  X.clearEnemyFx(e, "seal"); X.fire(e);
  assert.ok(G.bl.length > 0, "解除後能開火");
  assert.equal(X.applyEnemyFx(G.en.find((x) => X.isBossType(x.t)), "soulseal"), false);
  assert.equal(X.enemyBlocks(e, "move"), false);
  X.applyEnemyFx(e, "soulseal", { duration: 2 });
  assert.equal(X.enemyBlocks(e, "move"), true);
});

test("狀態倍率：升溫隨熱量提高傷害；轉態只放大水屬性技能", () => {
  const p = { st: {}, heat: 100 };
  X.applyStatus(p, "heated");
  assert.ok(X.damageDealtMultiplier(p) > 1.5);
  X.applyStatus(p, "waterBoost");
  assert.equal(X.skillDamageMultiplier(p, "water"), 3);
  assert.equal(X.skillDamageMultiplier(p, "fire"), 1);
});

test("出戰上限：最多 2 把，只能裝擁有的武器，至少留一把", () => {
  const own = X.SV.own.slice(), lo = G.LO.slice();
  try {
    X.SV.own = [0, 1, 2, 3]; G.LO = [0, 1, 2, 9];
    X.applyLO();
    assert.deepEqual(G.LO, [0, 1], "超過 2 把會被截斷，沒擁有的會被濾掉");
    G.LO = [9]; X.applyLO();
    assert.deepEqual(G.LO, [0], "全部無效時退回擁有的第一把");
  } finally { X.SV.own = own; G.LO = lo; X.applyLO(); }
});
