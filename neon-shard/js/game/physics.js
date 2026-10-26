/** game/physics — 爆炸、自動瞄準、追蹤 */
import { G } from "../core/game-state.js";
import { T } from "../core/viewport.js";
import { burst, cell, hitCell, ray } from "./battle.js";
import { dm } from "./boss.js";
import { AIMR } from "./pickups.js";
import { kill } from "./simulation.js";
import { chipHit } from "./ultimates.js";
import { WP } from "./weapons.js";

// 範圍爆炸：傷害敵人並破壞範圍內方塊
export function explode(b) {
  const R = b.ex,
    big = R >= 100;
  if (b.soft) {
    burst(b.x, b.y, b.col, 22, 240, 2.8, 0.45);
    burst(b.x, b.y, "#ffe0b0", 6, 160, 2, 0.3);
    G.fxs.push({
      k: "w",
      x: b.x,
      y: b.y,
      r: R * 0.9,
      t: 0.3,
      max: 0.3,
      col: b.col,
    });
    G.shake = Math.max(G.shake, 4);
  } else {
    burst(
      b.x,
      b.y,
      b.col,
      big ? 80 : 26 + R / 4,
      big ? 420 : 300,
      big ? 7 : 3 + R / 40,
      big ? 1 : 0.6,
    );
    if (big) {
      burst(b.x, b.y, "#ffffff", 30, 360, 4, 0.5);
      G.fxs.push({
        k: "w",
        x: b.x,
        y: b.y,
        r: R * 1.3,
        t: 0.45,
        max: 0.45,
        col: b.col,
      });
      G.shake = Math.max(G.shake, 16);
    } else G.shake = Math.max(G.shake, R < 60 ? 3 : 6);
  }
  for (const e of G.en) {
    if (e.hp <= 0) continue;
    const dx = e.x - b.x,
      dy = e.y - b.y,
      d = Math.hypot(dx, dy);
    if (d < R + e.r) {
      {
        const dd = dm(e, b.dmg, Math.atan2(b.y - e.y, b.x - e.x));
        e.hp -= dd;
        e.hf = dd > 0 ? 1 : 0;
        if (dd > 0 && b.cw !== undefined) chgU(b.cw, dd * 0.25);
        if (dd > 0 && (b.bu || b.fr || b.fz4 || b.lk || b.ch)) {
          chipHit(e, dd, b);
          b.ch = 0;
          b.lk = 0;
        }
        if (dd <= 0) burst(e.x, e.y, "#9aa0ab", 12, 200, 2, 0.35);
      }
      e.kx += ((dx / (d || 1)) * b.kb) / e.m;
      e.ky += ((dy / (d || 1)) * b.kb) / e.m;
      if (e.hp <= 0) kill(e);
    }
  }
  for (let j = Math.floor((b.y - R) / T); j <= Math.floor((b.y + R) / T); j++)
    for (let i = Math.floor((b.x - R) / T); i <= Math.floor((b.x + R) / T); i++)
      if (Math.hypot((i + 0.5) * T - b.x, (j + 0.5) * T - b.y) < R + 8)
        hitCell(i, j, Math.floor(b.wd));
}
// 功能：處理「angD」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export const angD = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// 功能：處理「quickT」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function quickT() {
  if (!G.AA) return null;
  let b = null,
    bd = 9999;
  const R = G.AA === 2 ? AIMR * 2.4 : AIMR * 1.9;
  for (const e of G.en) {
    if (e.hp <= 0) continue;
    const D = Math.hypot(e.x - G.pl.x, e.y - G.pl.y);
    if (D > R + e.r || D >= bd) continue;
    if (ray(G.pl.x, G.pl.y, Math.atan2(e.y - G.pl.y, e.x - G.pl.x), D) < D - e.r - 6)
      continue;
    bd = D;
    b = e;
  }
  return b;
}
// 自動瞄準：在範圍與視線內挑最近的敵人
export function aimT() {
  if (!G.AA) return null;
  let b = null,
    bs = 9;
  const R = AIMR * (G.AA === 2 ? 1.5 : 1.15),
    ex = G.AA === 2 ? 0.26 : 0.09;
  for (const e of G.en) {
    if (e.hp <= 0) continue;
    const D = Math.hypot(e.x - G.pl.x, e.y - G.pl.y);
    if (D > R + e.r) continue;
    const a = Math.atan2(e.y - G.pl.y, e.x - G.pl.x),
      tol = Math.min(Math.atan2(e.r + 8, Math.max(D, 1)), 0.32) + ex,
      df = angD(a, G.pl.aim);
    if (df > tol) continue;
    if (ray(G.pl.x, G.pl.y, a, D) < D - e.r - 6) continue;
    const sc = df / tol + (D / R) * 0.55 - (e === G.tgLast ? 0.08 : 0);
    if (sc < bs) {
      bs = sc;
      b = e;
    }
  }
  G.tgLast = b;
  return b;
}
// 子彈穿牆縫修正：把這一幀的移動切成 4px 小段檢查，並且嚴格判定斜角穿縫（只改判定，不改顯示）
export function seamHit(x0, y0, x1, y1) {
  const dx = x1 - x0,
    dy = y1 - y0,
    L = Math.hypot(dx, dy);
  if (L < 1e-6) return null;
  const n = Math.max(1, Math.ceil(L / 4)),
    ux = dx / L,
    uy = dy / L;
  let px = x0,
    py = y0,
    pi = Math.floor(px / T),
    pj = Math.floor(py / T);
  for (let k = 1; k <= n; k++) {
    const x = x0 + (dx * k) / n,
      y = y0 + (dy * k) / n,
      ci = Math.floor(x / T),
      cj = Math.floor(y / T);
    if (ci !== pi || cj !== pj) {
      if (cell(ci, cj) !== 0) return [x, y, ci, cj];
      if (ci !== pi && cj !== pj) {
        const bx = (ci > pi ? ci : pi) * T,
          by = (cj > pj ? cj : pj) * T,
          tx = (bx - px) / (x - px || 1e-9),
          ty = (by - py) / (y - py || 1e-9),
          ni = tx < ty ? ci : pi,
          nj = tx < ty ? pj : cj;
        if (cell(ni, nj) !== 0) {
          const t = tx < ty ? tx : ty;
          return [
            px + (x - px) * t + ux * 0.5,
            py + (y - py) * t + uy * 0.5,
            ni,
            nj,
          ];
        }
      }
      pi = ci;
      pj = cj;
    }
    px = x;
    py = y;
  }
  return null;
}
// 大招（術式場）蓄能：每把武器各自一條(w.um 0~100)；UE[武器id] 可調各武器的蓄能效率，沒寫就是 1
const UE = [];
// 增加大招蓄能
export function chgU(wo, amt) {
  const w = wo === undefined ? WP[G.pl.w] : typeof wo === "number" ? WP[wo] : wo;
  if (!w) return;
  w.um = Math.min(100, (w.um || 0) + amt * (G.CHR.sc || 1) * (UE[w.id] ?? 1));
}
// 功能：處理「BMR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export const BMR = (b) => 17 * (b.ult ? 2.5 : 1.7);
// 功能：處理「boom」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function boom(b, dt) {
  if (!b.spd0) b.spd0 = Math.hypot(b.vx, b.vy) || 1;
  if (!b.t2 && b.age > b.l0 * 0.35) {
    b.t2 = 1;
    b.hit.length = 0;
    b.life = 12;
    b.returnSlow = 1;
  }
  if (b.t2 && b.returnSlow) {
    const dx = G.pl.x - b.x,
      dy = G.pl.y - b.y,
      sp = b.spd0,
      d = Math.hypot(dx, dy) || 1;
    b.vx = (dx / d) * sp;
    b.vy = (dy / d) * sp;
    if (d < G.pl.r + b.r + 10) {
      b.life = 0;
      const w = WP[b.wi];
      if (w) w.am = 1;
      return;
    }
  }
}
// 功能：處理「homeP」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function homeP(b, dt) {
  const dx = G.pl.x - b.x,
    dy = G.pl.y - b.y,
    sp = Math.hypot(b.vx, b.vy),
    a = Math.atan2(b.vy, b.vx);
  let df = Math.atan2(dy, dx) - a;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  const na =
    a + Math.max(-(b.hr || 1.4) * dt, Math.min((b.hr || 1.4) * dt, df));
  b.vx = Math.cos(na) * sp;
  b.vy = Math.sin(na) * sp;
}
// 功能：處理「home」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function home(b, dt) {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1) return;
  const c = b.vx / sp,
    s = b.vy / sp,
    L = Math.min(230, Math.max(0, b.life) * sp);
  let bd = 1e9,
    t = null;
  for (const e of G.en) {
    if (e.hp <= 0 || (b.hit && b.hit.includes(e))) continue;
    const dx = e.x - b.x,
      dy = e.y - b.y,
      u = dx * c + dy * s;
    if (u < -e.r) continue;
    const cr = Math.abs(-dx * s + dy * c),
      d = (u > L ? Math.hypot(u - L, cr) : cr) - e.r;
    if (d < (b.hml || 50) && d < bd) {
      bd = d;
      t = e;
    }
  }
  if (!t) return;
  const a = Math.atan2(b.vy, b.vx);
  let df = Math.atan2(t.y - b.y, t.x - b.x) - a;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  const na =
    a + Math.max(-(b.hmr || 1.1) * dt, Math.min((b.hmr || 1.1) * dt, df));
  b.vx = Math.cos(na) * sp;
  b.vy = Math.sin(na) * sp;
}
