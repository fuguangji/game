/** game/ultimates — 各把槍的大招（SUPER）與雷射地帶 */
import { G } from "../core/game-state.js";

import { MW, T, TAU } from "../core/viewport.js";
import { ULN, blocked, burst, hitCell, turLand, ub } from "./battle.js";
import { dm, flash, isB, thr } from "./boss.js";
import { chgU, explode } from "./physics.js";
import { UL } from "./progress.js";
import { kill } from "./simulation.js";
import { WP } from "./weapons.js";
import { BULLET_SPEED_SCALE } from "../config/index.js";
import { ultLaser } from "./laser-zones.js";
import { chipHit } from "./chip-effects.js";
import { strikeFx } from "./ultimate-effects.js";
export { drawLZ, laserFire, lzBeam, lzDmg, lzHit, ultLaser, updLZ } from "./laser-zones.js";
export { chainZone, chgHit, chipHit, chipTick, drawChg, gpTick } from "./chip-effects.js";
export { cloudSky, cloudSpark, drawDummyBar, ftxt, mkDummy, spawnDummy, strikeFx, zig, zigPts } from "./ultimate-effects.js";

export const SQ = [];
// 功能：將延遲執行的回呼加入特效排程佇列。
export const later = (t, fn) => SQ.push({ t, fn }),
  line = (a, len, t, col) =>
    G.fxs.push({ k: "l", x: G.pl.x, y: G.pl.y, a, len, t, max: t, col }),
  spot = (x, y, r, t, col) => G.fxs.push({ k: "c", x, y, r, t, max: t, col }),
  LR = (q) => q * 330;
// 功能：處理「dmM」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function dmM() {
  return 1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg;
}

// ===== 雷射系統：光線槍（持續光束）與其大招（破滅雷射）=====
// ===== 芯片效果通用層：讓地雷/毒罐/蛛網/黑洞/砲塔/斬擊/大招都吃到芯片 =====
export function ufl() {
  const m = G.UM;
  return m ? { bu: m.bu, fr: m.fr, fz4: m.fz4, lk: m.lk, ch: m.ch } : {};
}
// 功能：處理「zfl」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function zfl(w) {
  return w ? { bu: w.bu, fr: w.fr, fz4: w.fz4, lk: w.lk, ch: w.ch } : {};
}
// 功能：處理「explodeU」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function explodeU(o) {
  const m = G.UM;
  if (m) {
    o = Object.assign({}, ufl(), o);
    o.dmg *= m.dm;
    o.kb *= m.kb;
    if (m.wd > 0) o.wd = (o.wd || 0) + m.wd;
    if (m.xb) o.ex *= 1.2;
  }
  explode(o);
}
export const LZ = [];
export const FT = [];
// 功能：處理「fTarget」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function fTarget(e) {
  let b = null,
    bd = Math.hypot(G.pl.x - e.x, G.pl.y - e.y) * 0.9;
  for (const z of G.zones) {
    if (z.k !== "tur" || z.hp <= 0 || (z.th && z.th.t > 0)) continue;
    const d = Math.hypot(z.x - e.x, z.y - e.y);
    if (d < bd && d < 700) {
      bd = d;
      b = z;
    }
  }
  return b;
}
// 功能：處理「wBul」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function wBul(w, x, y, a, mul) {
  const crt = w.cr && Math.random() < w.cr;
  a += (Math.random() - 0.5) * 0.06;
  G.bl.push({
    x,
    y,
    vx: Math.cos(a) * w.v * BULLET_SPEED_SCALE,
    vy: Math.sin(a) * w.v * BULLET_SPEED_SCALE,
    r: w.r,
    own: 1,
    dmg: w.dmg * mul * (crt ? w.cm : 1),
    life: w.life / BULLET_SPEED_SCALE,
    col: crt ? "#ffffff" : w.c,
    kb: w.kb,
    wi: WP.indexOf(w),
    pe: w.pierce,
    pierce: w.pa,
    hm: w.hm,
    ch: w.ch,
    bn: w.bn,
    xb: w.xb,
    bu: w.bu,
    fr: w.fr,
    lk: w.lk,
    fz4: w.fz4,
    wd: w.wd,
    l0: w.life / BULLET_SPEED_SCALE,
    age: 0,
    lc: -1,
    hit: [],
  });
}
// 功能：處理「frag」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function frag(b) {
  const n = b.cs > 1 ? b.cs : 8;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + Math.random() * 0.4;
    G.bl.push({
      x: b.x,
      y: b.y,
      vx: Math.cos(a) * 380 * BULLET_SPEED_SCALE,
      vy: Math.sin(a) * 380 * BULLET_SPEED_SCALE,
      r: 5,
      own: 1,
      dmg: b.dmg * 0.35,
      life: 0.3 / BULLET_SPEED_SCALE,
      col: b.col,
      kb: Math.max(50, (b.kb || 0) * 0.3),
      wd: Math.max(0.3, b.wd || 0),
      bu: b.bu,
      fr: b.fr,
      lk: b.lk,
      fz4: b.fz4,
      ch: b.ch,
      xb: b.xb,
      pe: b.pe,
      l0: 0.3 / BULLET_SPEED_SCALE,
      age: 0,
      lc: -1,
      hit: [],
      ult: b.ult,
      wi: b.wi,
    });
  }
  burst(b.x, b.y, b.col, 10, 200, 2.5, 0.35);
  G.shake = Math.max(G.shake, 3);
}
// 功能：處理「slashHit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function slashHit(x, y, a, sw, rg, dmg, kb, col, w, nu) {
  const full = sw >= TAU - 0.01,
    an = (px, py) => Math.atan2(py - y, px - x),
    df = (p, q) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q)));
  for (const e of G.en) {
    if (e.hp <= 0) continue;
    const dx = e.x - x,
      dy = e.y - y,
      d = Math.hypot(dx, dy);
    if (d > rg + e.r) continue;
    if (!full && df(an(e.x, e.y), a) > sw / 2 + Math.atan2(e.r, Math.max(d, 1)))
      continue;
    const crt = w && w.cr && Math.random() < w.cr,
      dd = dm(e, dmg * (crt ? w.cm : 1), Math.atan2(y - e.y, x - e.x));
    e.hp -= dd;
    e.hf = dd > 0 ? 1 : 0;
    e.kx += ((dx / (d || 1)) * kb) / e.m;
    e.ky += ((dy / (d || 1)) * kb) / e.m;
    if (w) {
      if (w.bu) e.bu = 3;
      if (w.fr) e.fr = 2;
      if (w.lk && dd > 0 && G.pl.hp < G.pl.mhp)
        G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + Math.min(2, dd * 0.025));
      if (dd > 0) {
        if (w.fz4 || w.ch) chipHit(e, dd, { fz4: w.fz4, ch: w.ch });
        if (w.xb && Math.random() < 0.3)
          explode({
            x: e.x,
            y: e.y,
            ex: 48,
            dmg: dd * 0.35,
            kb: 120,
            wd: 0,
            col: w.c || col,
          });
      }
    }
    if (dd > 0) {
      if (!nu) chgU(w, dd * 0.25);
      burst(e.x, e.y, e.col, 6, 160, 2, 0.3);
    } else burst(e.x, e.y, "#9aa0ab", 10, 200, 2, 0.35);
    if (e.hp <= 0) kill(e);
  }
  for (const b of G.bl) {
    if (b.own || b.life <= 0) continue;
    const dx = b.x - x,
      dy = b.y - y;
    if (Math.hypot(dx, dy) > rg) continue;
    if (!full && df(an(b.x, b.y), a) > sw / 2) continue;
    b.life = 0;
    burst(b.x, b.y, col, 3, 90, 2, 0.25);
  }
  const wn = Math.floor((w && w.wd) || 0);
  if (wn > 0)
    for (let k = 0; k < 6; k++) {
      const aa = full ? (k / 6) * TAU : a + (k / 5 - 0.5) * sw;
      hitCell(
        Math.floor((x + Math.cos(aa) * rg * 0.8) / T),
        Math.floor((y + Math.sin(aa) * rg * 0.8) / T),
        wn,
      );
    }
  G.fxs.push({ k: "sl", x, y, a, sw, r: rg, t: 0.26, max: 0.26, col });
}
// 功能：處理「ultRing」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.fxs = [];

ULN.splice(
  0,
  12,
  "百發百中",
  "三連轟",
  "貫穿光束",
  "掃射",
  "烈焰噴吐",
  "隕石墜落",
  "飛彈雨",
  "連環脈衝",
  "破滅雷射",
  "旋風雙槍",
  "集束炸彈",
  "破牆箭",
);





ULN.push("反彈風暴", "雷暴", "地雷陣", "三連巨鏢");

G.UMANUAL = false;

ULN.push("絕對零度", "黑洞", "雷霆震懇", "天羅地網");








ULN[16] = "冰河期";

ULN[18] = "雷暴領域";

ULN.push("砲塔陣", "毒霧瀰漫", "旋風斬", "集束轟炸");




}

