/** game/boss — Boss 與特效 */
import { isBossType } from "../config/index.js";
import { G } from "../core/game-state.js";

import { flash, phaseFx, slowmo } from "./boss-visuals.js";
import { beam } from "./boss-telegraph.js";
export { bInv, bd, beeWave, bossBolts, bossRays, detonate, dm, emptyNear, frz, mineBoom, poison, portals, rocks, tiles } from "./boss-attacks.js";
export { bossAI3, bossFire3, bossPhase, chg, cloneAI, mvB, nodeAI } from "./boss-ai.js";
export { bossAura, bossDeath, bossIntro, drawAtmos, drawBoss, drawBossFx, drawWarn, flash, flk, phaseFx, slowmo, zoneParticle } from "./boss-visuals.js";
export { beam, bossTele, tCirc, tFan, tLine, tTiles, teleBeams } from "./boss-telegraph.js";
export { LEAD, aiExtra, bLead, dodge, leadAt } from "./ai-helpers.js";
export const isB = (e) => isBossType(e.t);
const BN_OLD = 0;
// 功能：處理「thr」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function thr(z, x0, y0, d) {
  if (z.k === "bomb") {
    z.t = Math.max(0.3, z.t - d);
    z.max = z.t;
  }
  z.th = { x0, y0, t: d, max: d };
  return z;
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.HF = 0;
G.HC = "#ff1e3c";
G.chp = [];
G.FL = null;
G.bti = 0;
G.bcol = "#ff4d4d";
G.bossIn = 0;
G.bossT = 0;
G.ptxt = 0;
G.phn = 1;

G.TSt = 0;
G.TSv = 1;

G.MVF = 0;

G.TS = null;
}

