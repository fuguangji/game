import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { enemyCatalog, bossCatalog, bulletCatalog, creatureOf, requireCreature, BulletEffect, FIRST_BOSS_TYPE_ID } from "../js/config/index.js";
import { EnemyDefinition } from "../js/config/enemy-catalog.js";
import { BulletDefinition } from "../js/config/bullet-catalog.js";

const BASE = { typeId: 99, name: "測試", radius: 10, maxHealth: 10, moveSpeed: 10, color: "#112233", scoreValue: 1, mass: 1, unlockWave: 1 };

test("資料表是 #私有欄位：外部讀不到、列舉不到、序列化不出來", () => {
  for (const catalog of [enemyCatalog, bossCatalog, bulletCatalog]) {
    assert.deepEqual(Reflect.ownKeys(catalog), [], "實例上不應有任何可見屬性");
    assert.equal(JSON.stringify(catalog), "{}");
  }
  for (const Cls of [enemyCatalog.constructor, bossCatalog.constructor, bulletCatalog.constructor]) {
    assert.deepEqual(Object.getOwnPropertyNames(Cls).filter((k) => !["length", "name", "prototype"].includes(k)), [], "類別上不應有可讀取的靜態資料表");
  }
  assert.equal(enemyCatalog.rows ?? enemyCatalog.ROWS ?? enemyCatalog.definitions, undefined);
});

test("定義是唯讀的：不能改寫任何屬性（模組是嚴格模式，改寫會直接丟錯）", () => {
  const e = enemyCatalog.get(1);
  assert.throws(() => { e.radius = 999; }, TypeError);
  assert.throws(() => { e.newField = 1; }, TypeError); // 已凍結，不能新增欄位
  assert.throws(() => { e.shape.sides = 3; }, TypeError);
  assert.throws(() => { bossCatalog.get(0).maxHealth = 1; }, TypeError);
  assert.throws(() => { bulletCatalog.get("SNIPER_SHOT").damage = 9999; }, TypeError);
  assert.throws(() => { BulletEffect.SLOW = 99; }, TypeError);
});

test("回傳的陣列是副本：改它不會影響設定", () => {
  const before = enemyCatalog.all().length;
  enemyCatalog.all().length = 0;
  assert.equal(enemyCatalog.all().length, before);
  bossCatalog.names().push("駭客");
  assert.equal(bossCatalog.names().length, 8);
  bossCatalog.all().pop();
  assert.equal(bossCatalog.count, 8);
  bulletCatalog.ids().push("X");
  assert.equal(bulletCatalog.has("X"), false);
});

test("建構時驗證資料：寫錯會立刻報錯，不會悄悄變成 NaN", () => {
  assert.doesNotThrow(() => new EnemyDefinition(BASE));
  assert.throws(() => new EnemyDefinition({ ...BASE, radius: -1 }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, maxHealth: NaN }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, color: "red" }), TypeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, unlockWave: 0 }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, shape: { sides: 2, innerRatio: 1 } }), RangeError);
  assert.throws(() => new EnemyDefinition({ ...BASE, dodge: { skill: 2, mistakeChance: 0 } }), RangeError);
  assert.throws(() => new BulletDefinition({ id: "x", speed: -1, damage: 1 }), RangeError);
  assert.throws(() => new BulletDefinition({ id: "x", speed: 1, damage: 1, effect: 42 }), RangeError);
});

test("查詢：未知編號／名稱會丟錯（生成敵人與子彈時寫錯要立刻發現）", () => {
  assert.throws(() => requireCreature(999), RangeError);
  assert.throws(() => enemyCatalog.get(14), RangeError); // 14 是 Boss，不是一般敵人
  assert.throws(() => bulletCatalog.get("NOPE"), RangeError);
  assert.throws(() => bossCatalog.get(8), RangeError);
  assert.equal(creatureOf(999), null);
  assert.equal(bossCatalog.find(8), null);
});

test("設定內容：關鍵數值與關係", () => {
  assert.equal(enemyCatalog.all().length, 18);
  assert.deepEqual(enemyCatalog.typesUnlockedBy(1), [0]);
  assert.deepEqual(enemyCatalog.typesIntroducedAt(9), [10, 27]);
  assert.equal(enemyCatalog.get(1).preferredDistance, 300);
  assert.equal(bossCatalog.count, 8);
  assert.deepEqual(bossCatalog.names().slice(0, 4), ["哨兵", "巨像", "棱鏡", "核心"]);
  assert.equal(bossCatalog.get(0).typeId, FIRST_BOSS_TYPE_ID);
  assert.equal(bossCatalog.findByType(21).name, "終焉");
  assert.equal(bossCatalog.findByType(22), null);
  assert.equal(bossCatalog.findMinion(31).name, "護盾核心");
  assert.equal(bulletCatalog.get("SLOW_ORB").effect, BulletEffect.SLOW);
  assert.equal(bulletCatalog.get("TRACKER_ORB_HEAVY").isHoming, true);
  assert.equal(bulletCatalog.speedScale, 0.7);
  const rock = bulletCatalog.get("BOSS_ROCK");
  assert.equal(rock.lifetimeScalesWithSpeedScale, true);
});

test("原始碼中所有 fireBullet(…, \"名稱\") 與 bulletCatalog.get(\"名稱\") 的名稱都存在", () => {
  const root = path.resolve(import.meta.dirname, "../js");
  const names = new Set();
  for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("config"))) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of text.matchAll(/(?:fireBullet\([^;]*?,\s*|bulletCatalog\.get\()\s*"([A-Z_]+)"/g)) names.add(m[1]);
  }
  assert.ok(names.size >= 10, `只找到 ${names.size} 個子彈名稱`);
  for (const id of names) assert.ok(bulletCatalog.has(id), `未知的子彈：${id}`);
});
