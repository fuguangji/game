/**
 * 敵人、子彈、Boss 設定的統一入口。
 * 全部是唯讀：這裡匯出的是「類別實例」與查詢函式，沒有任何可被改寫的資料表。
 */
import { BulletCatalog, BulletEffect } from "./bullet-catalog.js";
import { BossCatalog, FIRST_BOSS_TYPE_ID } from "./boss-catalog.js";
import { EnemyCatalog } from "./enemy-catalog.js";
import { DEFAULT_DODGE } from "./creature-definition.js";

export { BulletEffect, DEFAULT_DODGE, FIRST_BOSS_TYPE_ID };
export const enemyCatalog = new EnemyCatalog();
export const bulletCatalog = new BulletCatalog();
export const bossCatalog = new BossCatalog();

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
