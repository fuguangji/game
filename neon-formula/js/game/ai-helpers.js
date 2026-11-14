/** game/ai-helpers — 敵人 AI 共用輔助：預判彈道、閃避玩家子彈 */
import { BULLET_SPEED_SCALE, dodgeProfileOf, isMinionType } from "../config/index.js";
import { G } from "../core/game-state.js";
import { blocked, mv, ray } from "./battle.js";
import { isB } from "./boss.js";

export const LEAD = {
  1: [400, null, 1],
  2: [235, null, 1],
  4: [300, null, 1],
  7: [1e5, null, 0.6],
  3: [1e5, 0.55, 1],
  13: [1e5, 0.5, 1],
  5: [1e5, 0.5, 1],
  29: [1e5, 0.5, 1],
};

// 功能：處理「leadAt」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function leadAt(e, sp, td, acc) {
  const vx = G.pl.avx || 0,
    vy = G.pl.avy || 0;
  if (vx * vx + vy * vy < 100) return [G.pl.x, G.pl.y];
  const qx = G.pl.x - e.x + vx * td,
    qy = G.pl.y - e.y + vy * td,
    a = vx * vx + vy * vy - sp * sp,
    b = 2 * (qx * vx + qy * vy),
    c = qx * qx + qy * qy;
  let t = 0;
  if (Math.abs(a) < 1e-3) t = b < 0 ? -c / b : 0;
  else {
    const D = b * b - 4 * a * c;
    if (D >= 0) {
      const r1 = (-b - Math.sqrt(D)) / (2 * a),
        r2 = (-b + Math.sqrt(D)) / (2 * a),
        lo = Math.min(r1, r2),
        hi = Math.max(r1, r2);
      t = lo > 0 ? lo : hi;
    }
  }
  if (!(t > 0) || t > 1.6) t = Math.min(1, Math.sqrt(c) / sp);
  let tx = G.pl.x + vx * (td + t) * acc,
    ty = G.pl.y + vy * (td + t) * acc;
  const L0 = Math.hypot(tx - G.pl.x, ty - G.pl.y);
  if (L0 > 260) {
    tx = G.pl.x + ((tx - G.pl.x) * 260) / L0;
    ty = G.pl.y + ((ty - G.pl.y) * 260) / L0;
  }
  if (L0 > 1) {
    const g = Math.atan2(ty - G.pl.y, tx - G.pl.x),
      Lc = Math.max(
        0,
        Math.min(
          Math.hypot(tx - G.pl.x, ty - G.pl.y),
          ray(G.pl.x, G.pl.y, g, 300) - G.pl.r,
        ),
      );
    tx = G.pl.x + Math.cos(g) * Lc;
    ty = G.pl.y + Math.sin(g) * Lc;
  }
  return [tx, ty];
}

// 功能：處理「bLead」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bLead(e, a) {
  const P = leadAt(e, 420 * BULLET_SPEED_SCALE, 0.25, 0.55);
  let df = Math.atan2(P[1] - e.y, P[0] - e.x) - a;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  return a + Math.max(-0.3, Math.min(0.3, df)) * Math.min(1, 0.4 + G.wave * 0.02);
}

// 功能：處理「aiExtra」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function aiExtra(e, dt) {
  if (isB(e) || isMinionType(e.t) || dt <= 0) return;
  if (e.iq === undefined) e.iq = Math.random();
  const dd = Math.hypot(G.pl.x - e.x, G.pl.y - e.y);
  if ((e.t === 0 || e.t === 12 || e.t === 26) && !(e.rec > 0) && !(e.un > 0)) {
    const mvd = Math.hypot(e.x - e.px, e.y - e.py);
    if (mvd < e.sp * dt * 0.12 && dd > e.r + G.pl.r + 34) {
      e.sk = (e.sk || 0) + dt;
      if (e.sk > 0.5) {
        e.sk = 0;
        e.un = 0.45;
        e.ua =
          Math.atan2(G.pl.y - e.y, G.pl.x - e.x) +
          (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.6);
      }
    } else e.sk = Math.max(0, (e.sk || 0) - dt * 2);
  }
  const aw = Math.min(0.8, 0.1 + G.wave * 0.035) * e.iq;
  if (aw > 0.25)
    for (const z of G.zones) {
      if (z.k !== "mine" || (z.th && z.th.t > 0)) continue;
      const ex = e.x - z.x,
        ey = e.y - z.y,
        dz = Math.hypot(ex, ey),
        R = z.r * 0.7 + e.r + 26;
      if (dz < R && dz > 1) {
        const k = (e.sp * aw * 1.1 * dt) / dz;
        mv(e, ex * k, ey * k);
      }
    }
}

// 敵人預判並閃避玩家子彈
export function dodge(e, dt) {
  if (isB(e) || isMinionType(e.t)) return;
  if (e.dtm > 0) {
    e.dtm -= dt;
    mv(e, e.dvx * dt, e.dvy * dt);
  }
  e.rt -= dt;
  if (e.dgn > 0) e.dgn = Math.max(0, e.dgn - dt * 0.8);
  if (e.rt > 0 || e.tele > 0 || e.dash > 0 || e.dtm > 0 || e.rec > 0) return;
  e.rt = 0.16 + Math.random() * 0.2;
  const { skill: sk0, mistakeChance: ms } = dodgeProfileOf(e.t),
    sk = (sk0 + Math.min(0.12, G.wave * 0.01)) / (1 + (e.dgn || 0) * 0.8);
  let th = null,
    ts = 9,
    c0 = 0,
    pr = false;
  for (const b of G.bl) {
    if (!b.own) continue;
    const s2 = b.vx * b.vx + b.vy * b.vy,
      rx = e.x - b.x,
      ry = e.y - b.y,
      t = (rx * b.vx + ry * b.vy) / s2;
    if (t < 0.04 || t > 0.45) continue;
    const cr = (rx * b.vy - ry * b.vx) / Math.sqrt(s2);
    if (Math.abs(cr) < e.r + b.r + 12 && t < ts) {
      ts = t;
      th = b;
      c0 = cr;
    }
  }
  if (!th && G.time - (G.pl.lf || -9) < 0.3) {
    const ax = Math.cos(G.pl.aim),
      ay = Math.sin(G.pl.aim),
      rx = e.x - G.pl.x,
      ry = e.y - G.pl.y,
      u = rx * ax + ry * ay,
      cr = rx * ay - ry * ax;
    if (
      u > 20 &&
      u < 380 &&
      Math.abs(cr) < e.r + 16 &&
      ray(G.pl.x, G.pl.y, G.pl.aim, u) >= u - e.r - 6
    ) {
      th = { vx: ax * 600, vy: ay * 600 };
      c0 = cr;
      pr = true;
    }
  }
  if (!th || Math.random() > sk * (pr ? 0.45 : 1)) return;
  const sp = Math.hypot(th.vx, th.vy) || 1;
  let sg = Math.abs(c0) < 1 ? (Math.random() < 0.5 ? 1 : -1) : -Math.sign(c0);
  if (Math.random() < ms) sg = -sg;
  const spd = Math.max(110, Math.min(210, e.sp * 2.1));
  let dx2 = (-th.vy / sp) * sg,
    dy2 = (th.vx / sp) * sg;
  if (blocked(e.x + dx2 * 30, e.y + dy2 * 30, e.r)) {
    dx2 = -dx2;
    dy2 = -dy2;
    if (blocked(e.x + dx2 * 30, e.y + dy2 * 30, e.r)) {
      dx2 = th.vx / sp;
      dy2 = th.vy / sp;
      if (blocked(e.x + dx2 * 30, e.y + dy2 * 30, e.r)) return;
    }
  }
  e.dvx = dx2 * spd;
  e.dvy = dy2 * spd;
  e.dtm = 0.25;
  e.dgn = (e.dgn || 0) + 1;
}
