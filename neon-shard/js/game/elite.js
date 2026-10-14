/** game/elite — 精英怪詞綴與數值 */
import { G } from "../core/game-state.js";
import { $ } from "../core/viewport.js";
import { ELITE } from "../enemy-config.js";
import { mkEn } from "./battle.js";
import { ST, SV } from "./progress.js";
import { mkIcon } from "../icons.js";

// 功能：計算菁英敵人的基礎生命值。
export function eliteHP() {
  const bw = ST().g ? ST().g : Math.max(1, Math.ceil(G.wave / 5)) * 5,
    bi = ST().g ? SV.sel : (bw / 5 - 1) % 8;
  return Math.round(mkEn(14 + bi, 0, 0).mhp * 0.25);
}
// 功能：依菁英倍率調整敵人屬性。
export function elify(m, q) {
  const E = ELITE[m.t];
  m.el = 1;
  m.r *= 1.2;
  m.m *= 1.6;
  m.hp = m.mhp = eliteHP();
  m.sp *= E.sk;
  m.sc = Math.round(m.sc * 2.5);
  if (!q) {
    G.eliteN++;
    G.eliteL[E.n] = (G.eliteL[E.n] || 0) + 1;
  }
}
// 功能：建立遊戲圖示圖例。
export function legend() {
  $("iS").append(mkIcon("ult", "#ffe14a", 26));
  $("iD").append(mkIcon("dash", "#22e6ff", 24));
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

/* ---------- 精英怪系統 ---------- */
G.eliteN = 0;
G.eliteL = {};

G.ewl = [];
G.egh = [];

G.CZ = 24;
}

