// 設定資料的結構與一致性。刻意不寫「共幾種敵人／Boss」這類數量或平衡數值：新增內容時測試不該跟著改。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { enemyCatalog, bossCatalog, bulletCatalog, creatureOf, requireCreature, isBossType, isMinionType, bossIndexOf, BulletEffect } from "../js/config/index.js";
import { EnemyDefinition } from "../js/config/enemy-catalog.js";
import { BulletDefinition } from "../js/config/bullet-catalog.js";
import { STATUS } from "../js/game/status-effects.js";

const BASE = { typeId: 99, name: "測試", radius: 10, maxHealth: 10, moveSpeed: 10, color: "#112233", scoreValue: 1, mass: 1, unlockWave: 1 };

test("資料表是 #私有欄位：外部讀不到、列舉不到、序列化不出來", () => {
  for (const catalog of [enemyCatalog, bossCatalog, bulletCatalog]) {
    assert.deepEqual(Reflect.ownKeys(catalog), []);
    assert.equal(JSON.stringify(catalog), "{}");
  }
});

test("定義是唯讀的；回傳的陣列是副本", () => {
  const e = enemyCatalog.all()[0];
  assert.throws(() => { e.radius = 999; }, TypeError);
  assert.throws(() => { e.newField = 1; }, TypeError);
  assert.throws(() => { bossCatalog.get(0).maxHealth = 1; }, TypeError);
  assert.throws(() => { BulletEffect.SLOW = 99; }, TypeError);
  const before = enemyCatalog.all().length;
  enemyCatalog.all().length = 0;
  bossCatalog.names().push("駭客");
  assert.equal(enemyCatalog.all().length, before);
  assert.equal(bossCatalog.names().includes("駭客"), false);
});

test("建構時驗證資料：寫錯會立刻報錯，不會悄悄變成 NaN", () => {
  assert.doesNotThrow(() => new EnemyDefinition(BASE));
  assert.throws(() => new EnemyDefinition({ ...BASE, radius: -1 }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, maxHealth: NaN }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, color: "red" }), TypeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, unlockWave: 0 }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, attack: { bullet: "" } }), TypeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, attack: { bullet: "X", count: 0 } }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, elite: { n: "缺 fx" } }), TypeError);
  assert.throws(() => new BulletDefinition({ id: "x", speed: -1, damage: 1 }), RangeError);
  assert.throws(() => new BulletDefinition({ id: "x", speed: 1, damage: 1, status: { name: 5 } }), TypeError);
});

test("查詢：未知編號／名稱會丟錯，找不到的 find 回傳 null", () => {
  assert.throws(() => requireCreature(-1), RangeError);
  assert.throws(() => enemyCatalog.get(bossCatalog.get(0).typeId), RangeError); // Boss 編號不是一般敵人
  assert.throws(() => enemyCatalog.byName("不存在"), RangeError);
  assert.throws(() => bulletCatalog.get("NOPE"), RangeError);
  assert.throws(() => bossCatalog.get(bossCatalog.count), RangeError);
  assert.equal(creatureOf(-1), null);
  assert.equal(bossCatalog.find(bossCatalog.count), null);
});

test("編號：所有敵方單位不重複，且 Boss／小單位的判斷只看資料、不看編號範圍", () => {
  const all = [...enemyCatalog.all(), ...bossCatalog.all(), ...bossCatalog.minions()];
  assert.equal(new Set(all.map((d) => d.typeId)).size, all.length, "編號不可重複（啟動時也會檢查）");
  for (const b of bossCatalog.all()) {
    assert.equal(isBossType(b.typeId), true);
    assert.equal(bossIndexOf(b.typeId), b.index);
    assert.equal(bossCatalog.get(b.index), b);
  }
  for (const m of bossCatalog.minions()) assert.equal(isMinionType(m.typeId), true);
  for (const d of enemyCatalog.all()) assert.equal(isBossType(d.typeId) || isMinionType(d.typeId), false, `${d.name} 不應被當成 Boss／小單位`);
});

test("沒寫 typeId 的敵人會自動配發編號，且不與寫死編號的敵人衝突", () => {
  const auto = enemyCatalog.all().filter((d) => d.typeId >= 100);
  for (const d of auto) assert.equal(enemyCatalog.byName(d.name), d);
});

test("每一列資料引用到的東西都存在：宣告式攻擊的子彈、子彈的狀態、精英資料格式", () => {
  for (const d of enemyCatalog.all()) {
    if (d.attack) assert.ok(bulletCatalog.has(d.attack.bullet), `${d.name} 的 attack.bullet「${d.attack.bullet}」不存在`);
    if (d.elite) assert.ok(typeof d.elite.n === "string" && d.elite.fx.length > 0, `${d.name} 的 elite 缺名稱或效果說明`);
  }
  for (const id of bulletCatalog.ids()) {
    const status = bulletCatalog.get(id).status;
    if (status) assert.ok(STATUS[status.name], `子彈 ${id} 的狀態「${status.name}」不在 STATUS 裡`);
  }
  assert.deepEqual(Object.keys(enemyCatalog.eliteTable()).map(Number).sort((a, b) => a - b), enemyCatalog.all().filter((d) => d.elite).map((d) => d.typeId));
});

test("原始碼中所有 fireBullet(…, \"名稱\") 與 bulletCatalog.get(\"名稱\") 的名稱都存在", () => {
  const root = path.resolve(import.meta.dirname, "../js");
  const names = new Set();
  for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("config"))) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of text.matchAll(/(?:fireBullet\([^;]*?,\s*|bulletCatalog\.get\()\s*"([A-Z_]+)"/g)) names.add(m[1]);
  }
  assert.ok(names.size > 0, "沒有掃描到任何子彈名稱，檢查用的正規表示式可能壞了");
  for (const id of names) assert.ok(bulletCatalog.has(id), `未知的子彈：${id}`);
});
