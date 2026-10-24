/**
 * 敵人、子彈、Boss 設定的統一入口。
 * 全部是唯讀：這裡匯出的是「類別實例」與查詢函式，沒有任何可被改寫的資料表。
 */
import { BulletCatalog, BulletEffect } from "./bullet-catalog.js";
import { BossCatalog } from "./boss-catalog.js";
import { EnemyCatalog } from "./enemy-catalog.js";
import { DEFAULT_DODGE } from "./creature-definition.js";

export { BulletEffect, DEFAULT_DODGE };
export const enemyCatalog = new EnemyCatalog();
export const bulletCatalog = new BulletCatalog();
export const bossCatalog = new BossCatalog();

// 啟動時檢查：任兩種敵方單位不能共用編號，宣告式攻擊用到的子彈必須存在。寫錯當場報錯，不會等到遊戲裡才出怪事。
{
  const seen = new Map();
  const claim = (def, kind) => {
    if (seen.has(def.typeId)) throw new Error(`編號 ${def.typeId} 同時被「${seen.get(def.typeId)}」和${kind}「${def.name}」使用`);
    seen.set(def.typeId, `${kind}「${def.name}」`);
  };
  for (const d of enemyCatalog.all()) claim(d, "敵人");
  for (const d of bossCatalog.all()) claim(d, "Boss");
  for (const id of [30, 31]) claim(bossCatalog.findMinion(id), "小單位");
  for (const d of enemyCatalog.all()) {
    if (d.attack && !bulletCatalog.has(d.attack.bullet)) throw new Error(`敵人「${d.name}」的 attack.bullet 不存在：${d.attack.bullet}`);
  }
}

/** 是不是 Boss（以資料判斷，不靠編號範圍） */
export const isBossType = (typeId) => bossCatalog.findByType(typeId) !== null;
/** 是不是 Boss 召喚的小單位（分身節點、護盾核心） */
export const isMinionType = (typeId) => bossCatalog.findMinion(typeId) !== null;
/** Boss 的出場順序（0 起算）；不是 Boss 回傳 -1 */
export const bossIndexOf = (typeId) => bossCatalog.findByType(typeId)?.index ?? -1;

/** 全域子彈速度倍率（以前的 BS） */
export const BULLET_SPEED_SCALE = bulletCatalog.speedScale;
/** 全域敵人速度倍率（以前的 ESPD） */
export const ENEMY_SPEED_SCALE = enemyCatalog.speedScale;

/** 依種類編號找出任何敵方單位（一般敵人 / Boss / Boss 的小單位）；找不到回傳 null */
export function creatureOf(typeId) {
  return enemyCatalog.find(typeId) ?? bossCatalog.findByType(typeId) ?? bossCatalog.findMinion(typeId) ?? null;
}

/** 同上，但找不到會丟出錯誤（生成敵人時使用：寫錯編號要立刻發現） */
export function requireCreature(typeId) {
  const creature = creatureOf(typeId);
  if (!creature) throw new RangeError(`未知的敵方單位編號：${String(typeId)}`);
  return creature;
}

export const dodgeProfileOf = (typeId) => creatureOf(typeId)?.dodge ?? DEFAULT_DODGE;
export const preferredDistanceOf = (typeId) => enemyCatalog.find(typeId)?.preferredDistance ?? null;
export const attackCooldownOf = (typeId) => enemyCatalog.find(typeId)?.attackCooldown ?? null;
export const recoveryTimeOf = (typeId) => enemyCatalog.find(typeId)?.recoveryTime ?? null;
export const telegraphDurationOf = (typeId) => enemyCatalog.find(typeId)?.telegraphDuration ?? null;
export const telegraphRadiusOf = (typeId) => creatureOf(typeId)?.telegraphRadius ?? null;
export const usesLineTelegraph = (typeId) => creatureOf(typeId)?.usesLineTelegraph ?? false;
/** 圖示形狀：{sides, innerRatio} 或 null */
export const iconShapeOf = (typeId) => creatureOf(typeId)?.shape ?? enemyCatalog.extraIconShape(typeId);
