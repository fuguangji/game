/**
 * game/enemy-effects — 敵人身上的效果（中毒、術式熔斷、靈魂熔斷、能量流失、術式反噬…）
 *
 * 和 status-effects.js（玩家）是同一種做法：想新增一種敵人效果，只要在 ENEMY_FX 加一項。
 * 舊的灼燒（e.bu）、寒冷（e.fr）、凍結（e.frz）等仍是各自獨立的欄位，這張表是給新效果用的。
 *
 * 每一項可以有：
 *   label / color        名稱與頭上光環顏色
 *   defaultDuration      預設持續秒數
 *   maxStacks            最多疊幾層（預設 1）
 *   blocks               ["attack", "move"]：生效期間禁止攻擊／禁止移動
 *   bossImmune           true = Boss 完全免疫
 *   bossDurationMul      Boss 的持續時間倍率（預設 1）
 *   backlashMul(n)       這個敵人承受的術式反噬倍率
 *   onTick(e, s, dt, api)   每幀呼叫（s = { t, n, acc }）
 *   onAttack(e, s, api)     每次這隻敵人發動攻擊時呼叫（術式反噬用）
 * api = { damage(e, 傷害), damagePct(e, 一般敵人比例, Boss 比例), gainEnergy(量), backlashMul(e) }，由 simulation.js 綁定。
 */
import { isBossType } from "../config/index.js";
import { TAU } from "../core/viewport.js";

export const ENEMY_FX = Object.freeze({
  poison: {
    label: "中毒", color: "#7dff3d", defaultDuration: 5, maxStacks: 3,
    onTick(e, s, dt, api) {
      s.acc += dt;
      while (s.acc >= 0.5) { s.acc -= 0.5; api.damage(e, 4 * s.n); }
    },
  },
  frozen: { label: "冰凍", color: "#5edfff", defaultDuration: 1.2 ,
    blocks: ["move"], bossDurationMul: 0.5,
  },
  shock: { label: "麻痺", color: "#ffd27a", defaultDuration: 1.5, bossDurationMul: 0.5 ,blocks:["attack"]
  },
  burn: {
    label: "灼燒", color: "#ff4d4d", defaultDuration: 3, maxStacks: 3,
    onTick(e, s, dt, api) {
      s.acc += dt;
      while (s.acc >= 0.5) { s.acc -= 0.5; api.damage(e, 3 * s.n); }
    },
    damageTakenMul: (n) => 1 + 0.1 * n,
  },
  seal: { label: "術式熔斷", color: "#ff9a3d", defaultDuration: 4, blocks: ["attack"], bossDurationMul: 0.5 },
  soulseal: { label: "靈魂熔斷", color: "#c070ff", defaultDuration: 4, blocks: ["attack", "move"], bossImmune: true },
  /** 能量流失：持續失去生命（Boss 只受 1/4），同時把流失的能量補給玩家 */
  drain: {
    label: "能量流失", color: "#4de1ff", defaultDuration: 6,
    onTick(e, s, dt, api) { api.damagePct(e, 0.06 * dt, 0.015 * dt); api.gainEnergy(3 * dt); },
  },
  /** 術式反噬：每次發動攻擊都會傷到自己 */
  backlash: {
    label: "術式反噬", color: "#ff6a8a", defaultDuration: 8,
    onAttack(e, s, api) { const m = api.backlashMul(e); api.damagePct(e, 0.06 * m, 0.015 * m); },
  },
  flux: { label: "助焊劑", color: "#ffd27a", defaultDuration: 30, backlashMul: () => 2.5 },
  bloom: { label: "花域", color: "#ff9ad0", defaultDuration: 0.25, backlashMul: () => 1.1 },
  /** 迷失：看不見玩家的位置（AI 會追一個假位置，見 techniques.js 的 blindTarget） */
  blind: { label: "迷失", color: "#cfe8ff", defaultDuration: 0.3 },
});

let api = null;
/** simulation.js 啟動時綁定（讓這個模組不必依賴戰鬥與擊殺模組） */
export const bindEnemyFxApi = (a) => { api = a; };

const defOf = (name) => {
  const def = ENEMY_FX[name];
  if (!def) throw new RangeError(`未知的敵人效果：${String(name)}（可用：${Object.keys(ENEMY_FX).join("、")}）`);
  return def;
};

export const hasEnemyFx = (e, name) => (e.fx?.[name]?.t ?? 0) > 0;

/**
 * 對敵人施加效果。持續時間取較長者；Boss 依 bossImmune／bossDurationMul 處理。
 * @param {{duration?: number, stack?: boolean, stacks?: number}} [opts]
 * @returns {boolean} 有沒有真的施加上去（Boss 免疫會回傳 false）
 */
export function applyEnemyFx(e, name, { duration, stack = false, stacks } = {}) {
  const def = defOf(name);
  const boss = isBossType(e.t);
  if (boss && def.bossImmune) return false;
  const s = ((e.fx ??= {})[name] ??= { t: 0, n: 0, acc: 0 });
  const active = s.t > 0;
  const want = stacks ?? (stack ? (active ? s.n : 0) + 1 : Math.max(1, active ? s.n : 0));
  s.n = Math.min(def.maxStacks ?? 1, Math.max(1, want));
  s.t = Math.max(active ? s.t : 0, (duration ?? def.defaultDuration) * (boss ? (def.bossDurationMul ?? 1) : 1));
  return true;
}

export function clearEnemyFx(e, name) {
  const s = e.fx?.[name];
  if (s) { s.t = 0; s.n = 0; s.acc = 0; }
}

const active = (e) => Object.keys(e.fx ?? {}).filter((n) => ENEMY_FX[n] && e.fx[n].t > 0);

/** 這隻敵人現在是否被禁止做某件事：what = "attack" 或 "move" */
export const enemyBlocks = (e, what) => active(e).some((n) => ENEMY_FX[n].blocks?.includes(what));

/** 這隻敵人承受術式反噬的倍率 */
export const enemyBacklashMul = (e) => active(e).reduce((m, n) => m * (ENEMY_FX[n].backlashMul?.(e.fx[n].n) ?? 1), 1);

/** 每幀倒數並執行 onTick */
export function tickEnemyFx(e, dt) {
  if (!e.fx) return;
  for (const name of active(e)) {
    const s = e.fx[name], def = ENEMY_FX[name];
    s.t -= dt;
    if (api) def.onTick?.(e, s, dt, api);
    if (s.t <= 0) { s.t = 0; s.n = 0; s.acc = 0; }
  }
}

/**
 * 敵人要發動攻擊前呼叫：被熔斷時回傳 false（這次攻擊取消）；否則觸發術式反噬等效果並回傳 true。
 * enemy-ai.js 的 fire() 與 boss-ai.js 的 bossFire3() 開頭各呼叫一次。
 */
export function enemyMayAttack(e) {
  if (!e.fx) return true;
  if (enemyBlocks(e, "attack")) return false;
  if (api) for (const name of active(e)) ENEMY_FX[name].onAttack?.(e, e.fx[name], api);
  return true;
}

/** 在敵人身上畫效果光環（座標為世界座標）：每個效果一圈虛線 */
export function drawEnemyFx(cx, e, time) {
  const names = active(e);
  if (!names.length) return;
  names.forEach((name, i) => {
    if (ENEMY_FX[name].color === undefined) return;
    cx.save();
    cx.strokeStyle = ENEMY_FX[name].color;
    cx.globalAlpha = 0.5 + 0.25 * Math.sin(time * 6 + i);
    cx.lineWidth = 2;
    cx.setLineDash([4, 4]);
    cx.lineDashOffset = -time * 18;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 5 + i * 3, 0, TAU);
    cx.stroke();
    cx.restore();
  });
}
