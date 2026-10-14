/** game/boss — Boss 與特效 */
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { N, T, TAU, cx } from "../core/viewport.js";
import { EL_COL } from "../enemy-config.js";
import { BS, DG } from "../game-config.js";
import { blocked, burst, hitCell, hurt, mkEn, mv, ray, solidAt } from "./battle.js";
import { eb } from "./enemy-ai.js";
import { nav } from "./pathfinding.js";
import { explode } from "./physics.js";
import { kill } from "./simulation.js";
import { SQ, dmM, drawDummyBar, ftxt, later, zig } from "./ultimates.js";

// 功能：處理「flk」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function flk(e, a, d) {
  if (e.fo === undefined) e.fo = (Math.random() - 0.5) * 1.2;
  return a + e.fo * Math.max(0, Math.min(1, (d - 70) / 260));
}
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
  const P = leadAt(e, 420 * BS, 0.25, 0.55);
  let df = Math.atan2(P[1] - e.y, P[0] - e.x) - a;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  return a + Math.max(-0.3, Math.min(0.3, df)) * Math.min(1, 0.4 + G.wave * 0.02);
}
// 功能：處理「aiExtra」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function aiExtra(e, dt) {
  if (isB(e) || e.t >= 30 || dt <= 0) return;
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
  if (isB(e) || e.t >= 30) return;
  if (e.dtm > 0) {
    e.dtm -= dt;
    mv(e, e.dvx * dt, e.dvy * dt);
  }
  e.rt -= dt;
  if (e.dgn > 0) e.dgn = Math.max(0, e.dgn - dt * 0.8);
  if (e.rt > 0 || e.tele > 0 || e.dash > 0 || e.dtm > 0 || e.rec > 0) return;
  e.rt = 0.16 + Math.random() * 0.2;
  const [sk0, ms] = DG[e.t] || [0.2, 0.3],
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
// 功能：處理「flash」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function flash(col, t, a) {
  G.FL = { col, t, max: t, a };
}
// 功能：處理「slowmo」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function slowmo(v, t) {
  if (G.TSt <= 0) G.TSv = 1;
  G.TSv = Math.min(G.TSv, v);
  G.TSt = Math.max(G.TSt, t);
}
// 功能：處理「bossRays」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossRays(x, y, col, t, n, len) {
  G.fxs.push({
    k: "rays",
    x,
    y,
    col,
    t,
    max: t,
    n,
    len,
    rot: Math.random() * TAU,
  });
}
// 功能：處理「bossBolts」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossBolts(x, y, col, n) {
  for (let k = 0; k < n; k++) {
    const t = 0.35 + Math.random() * 0.25;
    G.fxs.push({
      k: "bolt",
      x: x + (Math.random() - 0.5) * 300,
      y: y + (Math.random() - 0.5) * 40,
      y0: y - 760,
      col,
      t,
      max: t,
      seed: Math.random() * 90 + 3,
    });
  }
}
// 功能：處理「bossIntro」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossIntro(e) {
  for (let k = 0; k < 3; k++)
    G.fxs.push({
      k: "cring",
      x: e.x,
      y: e.y,
      r: 560 - k * 130,
      t: 0.9 + k * 0.25,
      max: 0.9 + k * 0.25,
      col: k ? e.col : "#ffffff",
    });
  bossBolts(e.x, e.y, e.col, 5);
  bossRays(e.x, e.y, e.col, 1.2, 16, 720);
  burst(e.x, e.y, e.col, 60, 380, 4, 1);
  slowmo(0.45, 0.6);
}
// 功能：處理「bossDeath」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossDeath(e) {
  slowmo(0.25, 0.9);
  bossRays(e.x, e.y, "#ffffff", 1.2, 20, 920);
  bossRays(e.x, e.y, e.col, 1.7, 12, 720);
  for (let k = 0; k < 3; k++)
    G.fxs.push({
      k: "w",
      x: e.x,
      y: e.y,
      r: 700 + k * 240,
      t: 0.9 + k * 0.3,
      max: 0.9 + k * 0.3,
      col: k ? e.col : "#ffffff",
    });
  const x = e.x,
    y = e.y,
    col = e.col,
    r = e.r;
  for (let k = 0; k < 9; k++)
    SQ.push({
      t: 0.12 + k * 0.11,
      fn: () => {
        const a = Math.random() * TAU,
          d = Math.random() * r * 1.1,
          px = x + Math.cos(a) * d,
          py = y + Math.sin(a) * d;
        burst(px, py, k % 2 ? "#ffffff" : col, 26, 320, 4, 0.7);
        G.fxs.push({
          k: "w",
          x: px,
          y: py,
          r: 110 + Math.random() * 90,
          t: 0.45,
          max: 0.45,
          col,
        });
        G.shake = Math.max(G.shake, 10);
      },
    });
  SQ.push({
    t: 1.15,
    fn: () => {
      burst(x, y, "#ffffff", 120, 520, 6, 1.2);
      bossBolts(x, y, col, 6);
      flash("#ffffff", 0.35, 0.5);
      G.shake = Math.max(G.shake, 26);
    },
  });
}
// 功能：處理「bossAura」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossAura(e) {
  const f = Math.max(0, e.hp / e.mhp),
    pu = 0.5 + 0.5 * Math.sin(G.time * 3),
    rg = cx.createRadialGradient(
      e.x,
      e.y,
      e.r * 0.6,
      e.x,
      e.y,
      e.r * (2.4 + 0.3 * pu),
    );
  cx.save();
  cx.globalCompositeOperation = "lighter";
  rg.addColorStop(0, e.col + "00");
  rg.addColorStop(0.55, e.col + (f < 0.35 ? "46" : "2a"));
  rg.addColorStop(1, e.col + "00");
  cx.fillStyle = rg;
  cx.beginPath();
  cx.arc(e.x, e.y, e.r * 2.8, 0, TAU);
  cx.fill();
  const n = 5 + Math.floor((1 - f) * 5),
    sp = 1.2 + (1 - f) * 1.8;
  cx.fillStyle = e.col;
  cx.shadowColor = e.col;
  cx.shadowBlur = 12;
  for (let k = 0; k < n; k++) {
    const a = G.time * sp + (k / n) * TAU,
      rr = e.r + 18 + Math.sin(G.time * 2 + k) * 5;
    cx.save();
    cx.translate(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
    cx.rotate(a + G.time * 2);
    cx.globalAlpha = 0.85;
    cx.fillRect(-3, -3, 6, 6);
    cx.restore();
  }
  if (f < 0.35) {
    cx.strokeStyle = "#ff3a3a";
    cx.globalAlpha = 0.4 + 0.4 * Math.sin(G.time * 14);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 30 + Math.sin(G.time * 9) * 4, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}
// 功能：處理「phaseFx」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function phaseFx(e, ph) {
  slowmo(0.3, 0.5);
  G.bl = G.bl.filter((b) => b.own);
  G.fxs.push(
    { k: "w", x: e.x, y: e.y, r: 420, t: 0.7, max: 0.7, col: e.col },
    { k: "w", x: e.x, y: e.y, r: 260, t: 0.5, max: 0.5, col: "#ffffff" },
  );
  burst(e.x, e.y, e.col, 70, 420, 5, 0.9);
  G.shake = 24;
  flash(e.col, 0.5, 0.5);
  e.rec = 0.7;
  G.ptxt = 1.6;
  G.phn = ph + 1;
}
// 功能：繪製或建立「drawWarn」所需的畫面元素。
export function drawWarn() {
  const u = G.HU;
  if (G.bossIn > 0) {
    const y = G.H * 0.4;
    cx.save();
    cx.globalAlpha = Math.min(1, G.bossIn * 1.2);
    cx.fillStyle = "#ff2a4a22";
    cx.fillRect(0, y - 34 * u, G.W, 68 * u);
    cx.fillStyle = "#ff2a4a33";
    for (let sx = -((G.time * 90) % 70); sx < G.W; sx += 70) {
      cx.beginPath();
      cx.moveTo(sx, y - 34 * u);
      cx.lineTo(sx + 34, y - 34 * u);
      cx.lineTo(sx + 8, y + 34 * u);
      cx.lineTo(sx - 26, y + 34 * u);
      cx.fill();
    }
    cx.strokeStyle = "#ff2a4a";
    cx.lineWidth = 3;
    cx.beginPath();
    cx.moveTo(0, y - 34 * u);
    cx.lineTo(G.W, y - 34 * u);
    cx.moveTo(0, y + 34 * u);
    cx.lineTo(G.W, y + 34 * u);
    cx.stroke();
    cx.globalAlpha = Math.min(1, G.bossIn) * (0.6 + 0.4 * Math.sin(G.time * 16));
    cx.fillStyle = "#ff2a4a";
    cx.shadowColor = "#ff2a4a";
    cx.shadowBlur = 22;
    cx.font = `bold ${38 * u}px ui-monospace,monospace`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("WARNING", G.W / 2, y - 4 * u);
    cx.font = `bold ${15 * u}px ui-monospace,monospace`;
    cx.fillText("BOSS " + BN[G.bossT], G.W / 2, y + 22 * u);
    cx.restore();
  }
  if (G.ptxt > 0) {
    cx.save();
    cx.globalAlpha = Math.min(1, G.ptxt * 1.5);
    cx.fillStyle = G.bcol;
    cx.shadowColor = G.bcol;
    cx.shadowBlur = 20;
    cx.font = `bold ${30 * u}px ui-monospace,monospace`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("PHASE " + G.phn, G.W / 2, G.H * 0.32);
    cx.restore();
  }
}
// 功能：繪製或建立「drawAtmos」所需的畫面元素。
export function drawAtmos() {
  cx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
  if (G.bti > 0.01) {
    const g = cx.createRadialGradient(
      G.W / 2,
      G.H / 2,
      Math.min(G.W, G.H) * 0.3,
      G.W / 2,
      G.H / 2,
      Math.max(G.W, G.H) * 0.75,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, G.bcol + "88");
    cx.globalAlpha = G.bti * (0.7 + 0.3 * Math.sin(G.time * 2.5));
    cx.fillStyle = g;
    cx.fillRect(0, 0, G.W, G.H);
    cx.globalAlpha = 1;
  }
  if (G.HF > 0.01) {
    cx.globalAlpha = Math.min(0.2, G.HF * 0.28);
    cx.fillStyle = G.HC;
    cx.fillRect(0, 0, G.W, G.H);
    cx.globalAlpha = 1;
  }
  {
    const lowF =
        fsm.state === "play" && G.pl.hp > 0 && G.pl.hp / G.pl.mhp < 0.3
          ? (0.3 + 0.2 * Math.sin(G.time * 6)) *
            (1 - (G.pl.hp / G.pl.mhp / 0.3) * 0.5)
          : 0,
      hv = Math.max(G.HF, lowF);
    if (hv > 0.01) {
      const g2 = cx.createRadialGradient(
          G.W / 2,
          G.H / 2,
          Math.min(G.W, G.H) * 0.25,
          G.W / 2,
          G.H / 2,
          Math.max(G.W, G.H) * 0.72,
        ),
        col = lowF > G.HF ? "#ff1e3c" : G.HC;
      g2.addColorStop(0, "rgba(0,0,0,0)");
      g2.addColorStop(1, col + "dd");
      cx.globalAlpha = Math.min(1, hv);
      cx.fillStyle = g2;
      cx.fillRect(0, 0, G.W, G.H);
      cx.globalAlpha = hv * 0.16;
      cx.fillStyle = col;
      cx.fillRect(0, 0, G.W, G.H);
      cx.globalAlpha = 1;
    }
  }
  if (G.FL) {
    cx.globalAlpha = (G.FL.a * G.FL.t) / G.FL.max;
    cx.fillStyle = G.FL.col;
    cx.fillRect(0, 0, G.W, G.H);
    cx.globalAlpha = 1;
  }
}
export const BN = ["哨兵", "巨像", "棱鏡", "核心", "雷霆", "蜂后", "虛空", "終焉"],
  isB = (e) => e.t >= 14 && e.t < 26,
  EXT = {
    18: [30, 1800, 150, "#ffe14a", 4500, 3],
    19: [40, 2200, 95, "#9dff3d", 5000, 4],
    20: [36, 2400, 85, "#7a7aff", 5500, 4],
    21: [44, 3500, 65, "#ff2a8a", 9000, 6],
    30: [26, 1, 0, "#4dffd8", 0, 3],
    31: [18, 300, 0, "#d070ff", 200, 9],
    26: [12, 28, 210, "#ff9f2a", 140, 1],
    27: [13, 45, 70, "#e04dff", 230, 1],
    28: [14, 60, 60, "#6dffb0", 260, 1],
    29: [14, 55, 65, "#c0a060", 240, 1],
  },
  BK = [3, 3, 2, 4, 3, 3, 3, 4],
  BPF = [130, 130, 260, 0, 200, 150, 0, 180];
// 功能：處理「pRing」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const pRing = (e, n, sp, d, o) => {
    for (let k = 0; k < n; k++) eb(e, (o || 0) + (k / n) * TAU, sp, d);
  },
  pFan = (e, a, c, sp, d, s) => {
    for (let k = 0; k < c; k++)
      eb(e, a + (c > 1 ? (k / (c - 1) - 0.5) * s : 0), sp, d);
  },
  pBomb = (x, y, r, t, d, col) =>
    G.zones.push(
      thr(
        { k: "bomb", x, y, r, t, max: t, col, dmg: d },
        G.TS ? G.TS.x : x,
        G.TS ? G.TS.y : y,
        Math.min(0.7, t * 0.7),
      ),
    ),
  pHom = (e, n, sp, d) => {
    for (let k = 0; k < n; k++) eb(e, Math.random() * TAU, sp, d, 2);
  },
  pSum = (e, n, ts) => {
    for (let k = 0; k < n; k++) {
      const p = emptyNear(e, 90, 20 * T) || { x: e.x, y: e.y };
      if (G.en.length < 34) {
        const m = mkEn(ts[(Math.random() * ts.length) | 0], p.x, p.y);
        m.gl = e.col;
        G.en.push(m);
      }
    }
  },
  lat = (e, t, fn) =>
    later(t, () => {
      if (e.hp > 0 && fsm.state === "play") fn();
    });
// 功能：處理「dm」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function dm(e, d, ang) {
  if (e.inv > 0) return 0;
  if (e.frz > 0) d *= 1.5;
  return isB(e) ? bd(e, d, ang) : d;
}
// 功能：處理「bInv」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const bInv = (e) => {
  const i = e.t - 14;
  return (
    e.inv > 0 ||
    (i === 3 && G.en.some((n) => n.t === 31 && n.hp > 0)) ||
    (i === 5 && G.en.some((n) => n.bee && n.hp > 0)) ||
    ((i === 2 || (i === 7 && e.ph === 2)) &&
      G.en.some((n) => n.t === 30 && n.hp > 0))
  );
};
// 功能：處理「bd」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bd(e, d, ang) {
  const i = e.t - 14;
  if (e.inv > 0) return 0;
  if (e.dummy) return d;
  let m = 1,
    sh = false;
  if (
    (i === 0 || (i === 7 && e.ph === 0)) &&
    ang !== undefined &&
    Math.abs(
      Math.atan2(Math.sin(ang - (e.open || 0)), Math.cos(ang - (e.open || 0))),
    ) > 0.9
  )
    m *= 0.08;
  if (i === 3 && G.en.some((n) => n.t === 31 && n.hp > 0)) {
    m = 0;
    sh = true;
  }
  if (i === 5 && G.en.some((n) => n.bee && n.hp > 0)) {
    m = 0;
    sh = true;
  }
  if (
    (i === 2 || (i === 7 && e.ph === 2)) &&
    G.en.some((n) => n.t === 30 && n.hp > 0)
  ) {
    m = 0;
    sh = true;
  }
  if (i === 6 && !(e.vis > 0)) m *= 0.25;
  if (e.vul > 0) return d * m * 1.5;
  const r = d * m;
  e.sg = (e.sg || 0) + (sh ? d * 0.25 : r);
  if (e.sg > e.mhp * 0.12) {
    e.sg = 0;
    e.vul = 3;
    slowmo(0.4, 0.28);
    burst(e.x, e.y, "#ffe14a", 30, 300, 4, 0.7);
    G.shake = Math.max(G.shake, 12);
    flash("#ffe14a", 0.2, 0.25);
    G.fxs.push({
      k: "w",
      x: e.x,
      y: e.y,
      r: 200,
      t: 0.5,
      max: 0.5,
      col: "#ffe14a",
    });
  }
  return r;
}
// 功能：處理「frz」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function frz(e) {
  e.fv = 0;
  if (isB(e)) {
    e.fr = 2.5;
    return;
  }
  e.stn = 2;
  e.frz = 2;
  burst(e.x, e.y, "#9ae6ff", 16, 160, 3, 0.5);
}
// 功能：引爆電荷並結算範圍傷害、暈眩與特效。
export function detonate(e) {
  e.cg = 0;
  G.fxs.push(
    {
      k: "w",
      x: e.x,
      y: e.y,
      r: 150,
      t: 0.35,
      max: 0.35,
      col: "#ffe14a",
    },
    {
      k: "mx",
      x: e.x,
      y: e.y,
      r: 150,
      t: 0.45,
      max: 0.45,
      col: "#ffe14a",
      rot: Math.random() * TAU,
    },
    {
      k: "rays",
      x: e.x,
      y: e.y,
      len: 150,
      n: 9,
      rot: Math.random() * TAU,
      t: 0.3,
      max: 0.3,
      col: "#fff4a6",
    },
  );
  burst(e.x, e.y, "#ffe14a", 34, 300, 3, 0.55);
  ftxt(e.x, e.y - e.r - 20, "電荷引爆！", "#fff4a6", 15);
  G.shake = Math.max(G.shake, 8);
  flash("#ffe14a", 0.15, 0.2);
  let n = 0;
  e.hp -= dm(e, 40 * dmM());
  e.hf = 1;
  if (e.hp <= 0) kill(e);
  for (const o of G.en) {
    if (o === e || o.hp <= 0 || Math.hypot(o.x - e.x, o.y - e.y) > 150)
      continue;
    if (!isB(o)) {
      o.stn = Math.max(o.stn || 0, 1);
      ftxt(o.x, o.y - o.r - 20, "暈眩", "#ffe14a", 12);
    }
    if (n < 3) {
      n++;
      o.hp -= dm(o, 30 * dmM());
      o.hf = 1;
      zig(e.x, e.y, o.x, o.y, "#ffe14a", 0.22, 3.5, 1);
      burst(o.x, o.y, "#ffe14a", 8, 180, 2, 0.3);
      if (o.hp <= 0) kill(o);
    }
  }
}
// 功能：處理「tiles」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tiles(e, ph) {
  const x0 = Math.round(G.pl.x / 70) * 70 - 175,
    y0 = Math.round(G.pl.y / 70) * 70 - 175,
    Wv = ph > 1 ? 3 : 2;
  for (let wv = 0; wv < Wv; wv++) {
    const list = [];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++) {
        const dg =
          wv === 0
            ? (r + c) % 2 === 0
            : wv === 1
              ? (r + c) % 2 === 1
              : Math.random() < 0.5;
        if (dg) list.push([x0 + c * 70, y0 + r * 70]);
      }
    lat(e, wv * 0.7, () => {
      for (const [x, y] of list)
        G.fxs.push({ k: "t", x, y, w: 70, t: 0.9, max: 0.9, col: e.col });
    });
    lat(e, wv * 0.7 + 0.9, () => {
      for (const [x, y] of list)
        if (
          G.pl.x > x &&
          G.pl.x < x + 70 &&
          G.pl.y > y &&
          G.pl.y < y + 70 &&
          G.pl.dashT <= 0
        )
          hurt(24);
      G.shake = Math.max(G.shake, 6);
      flash(e.col, 0.15, 0.2);
    });
  }
}
// 功能：處理「rocks」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function rocks(e, n) {
  const cs = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++)
      if (G.grid[j * N + i] > 0) {
        const D = Math.hypot((i + 0.5) * T - e.x, (j + 0.5) * T - e.y);
        if (D < 300) cs.push([D, i, j]);
      }
  cs.sort((a, b) => a[0] - b[0]);
  for (const [D, i, j] of cs.slice(0, n)) {
    G.grid[j * N + i] = 0;
    const x = (i + 0.5) * T,
      y = (j + 0.5) * T,
      a = Math.atan2(G.pl.y - y, G.pl.x - x);
    burst(x, y, "#ffb040", 10, 160, 3, 0.5);
    G.bl.push({
      x,
      y,
      vx: Math.cos(a) * 220 * BS,
      vy: Math.sin(a) * 220 * BS,
      r: 10,
      own: 0,
      dmg: 16,
      life: 3 / BS,
      col: "#ffb040",
    });
  }
  return cs.length;
}
// 功能：處理「emptyNear」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function emptyNear(e, a, b) {
  for (let k = 0; k < 150; k++) {
    const an = Math.random() * TAU,
      d = a + Math.random() * (b - a),
      x = e.x + Math.cos(an) * d,
      y = e.y + Math.sin(an) * d;
    if (!blocked(x, y, 16)) return { x, y };
  }
  return null;
}
// 功能：處理「beeWave」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function beeWave(e) {
  for (let q = 0; q < 6; q++) {
    if (G.en.length >= 34) break;
    const p = emptyNear(e, 90, 20 * T) || { x: e.x, y: e.y },
      m = mkEn(26, p.x, p.y);
    m.bee = 1;
    m.col = e.col;
    m.gl = e.col;
    G.en.push(m);
  }
}
// 功能：處理「poison」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function poison(e) {
  for (let q = 0; q < 3 + (e.ph || 0); q++) {
    const ax = Math.random() * TAU,
      o = q ? 60 + Math.random() * 100 : 0;
    G.zones.push(
      thr(
        {
          k: "slowz",
          x: G.pl.x + Math.cos(ax) * o,
          y: G.pl.y + Math.sin(ax) * o,
          r: 55,
          t: 13,
          max: 13,
          col: e.col,
          grow: 11,
          dps: 3,
        },
        e.x,
        e.y,
        0.5,
      ),
    );
  }
}
// 功能：處理「portals」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function portals(e) {
  G.zones = G.zones.filter((z) => z.k !== "portal");
  const ang = Math.random() * TAU,
    a = {
      k: "portal",
      x: G.pl.x + Math.cos(ang) * 190,
      y: G.pl.y + Math.sin(ang) * 190,
      r: 30,
      t: 14,
      max: 14,
      col: "#ffb040",
    },
    b = {
      k: "portal",
      x: G.pl.x - Math.cos(ang) * 190,
      y: G.pl.y - Math.sin(ang) * 190,
      r: 30,
      t: 14,
      max: 14,
      col: "#4dffd8",
    };
  if (blocked(a.x, a.y, 10) || blocked(b.x, b.y, 10)) return;
  a.o = b;
  b.o = a;
  G.zones.push(a, b);
}
// 功能：處理「bossPhase」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossPhase(e, ph, i) {
  if (i === 2 || (i === 7 && ph === 2)) {
    for (const c of G.en) if (c.t === 30) c.hp = 0;
    for (let q = 0; q < 3; q++) {
      const m = mkEn(30, e.x, e.y);
      m.gl = e.col;
      m.ci = q;
      m.hp = m.mhp = 1;
      m.dk = 1;
      m.col = e.col;
      m.sc = 0;
      G.en.push(m);
    }
  }
  if (i === 3) {
    for (const c of G.en) if (c.t === 31) c.hp = 0;
    e.nal = 3;
    for (let q = 0; q < 3; q++) {
      const m = mkEn(31, e.x, e.y);
      m.gl = e.col;
      m.ni = q;
      m.hp = m.mhp = e.mhp * 0.1;
      G.en.push(m);
    }
  }
  if (i === 5) beeWave(e);
  if (i === 6) portals(e);
  if (i === 7 && ph === 3) {
    e.sp *= 1.3;
    poison(e);
  }
}
// 功能：處理「cloneAI」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function cloneAI(e, dt) {
  const b = G.en.find(isB);
  if (!b || b.hp <= 0) {
    e.hp = 0;
    return;
  }
  e.oa = (e.oa || e.ci * 2.1) + dt * 0.7;
  e.x = b.x + Math.cos(e.oa) * 150;
  e.y = b.y + Math.sin(e.oa) * 150;
  if (e.tele > 0) e.tele -= dt;
}
// 功能：處理「nodeAI」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function nodeAI(e, dt) {
  const b = G.en.find(isB);
  if (!b || b.hp <= 0) {
    e.hp = 0;
    return;
  }
  e.oa = (e.oa || e.ni * 2.09) + dt * 0.8;
  e.x = b.x + Math.cos(e.oa) * 150;
  e.y = b.y + Math.sin(e.oa) * 150;
  e.cd -= dt;
  if (e.cd <= 0) {
    e.cd = 2.4;
    const A = Math.atan2(G.pl.y - e.y, G.pl.x - e.x);
    if (e.ni === 0) pRing(e, 10, 170, 8, G.time);
    else if (e.ni === 1) pFan(e, A, 5, 260, 10, 0.7);
    else pHom(e, 3, 140, 9);
  }
}
// 功能：處理「dk」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const dk = (c) => {
  const n = parseInt(c.slice(1), 16),
    r = (((n >> 16) & 255) * 0.4) | 0,
    g = (((n >> 8) & 255) * 0.4) | 0,
    b = ((n & 255) * 0.4) | 0;
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
};
// 功能：繪製或建立「drawBossFx」所需的畫面元素。
export function drawBossFx(e) {
  const i = e.t - 14;
  bossAura(e);
  cx.save();
  if (i === 0 || (i === 7 && e.ph === 0)) {
    cx.strokeStyle = e.col;
    cx.lineWidth = 6;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 9, (e.open || 0) + 0.9, (e.open || 0) + TAU - 0.9);
    cx.stroke();
  }
  if (bInv(e)) {
    cx.strokeStyle = "#4f5560";
    cx.lineWidth = 6;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 8, 0, TAU);
    cx.stroke();
  }
  if (e.vul > 0) {
    cx.strokeStyle = "#ffe14a";
    cx.shadowColor = "#ffe14a";
    cx.shadowBlur = 14;
    cx.lineWidth = 3;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 12 + Math.sin(G.time * 10) * 3, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}
// 功能：處理「bossFire3」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossFire3(e, ph, a, i) {
  G.TS = e;
  e.rec = Math.max(0.25, 0.5 - 0.08 * ph);
  const k = e.atk,
    A = e.aim;
  if (i === 0) {
    if (k === 0) {
      pRing(e, 12 + ph * 5, 170 + ph * 20, 9, G.time);
      if (ph > 0)
        lat(e, 0.35, () =>
          pRing(e, 12 + ph * 5, 150 + ph * 20, 9, G.time + 0.26),
        );
    } else if (k === 1)
      pFan(e, A, 5 + ph * 2, 260 + ph * 30, 12, 0.18 * (4 + ph * 2));
    else {
      for (let q = 0; q < 14 + ph * 2; q++)
        lat(e, q * 0.07, () => beam(e, A - 1.2 + (q * 2.4) / (13 + ph * 2)));
    }
  } else if (i === 1) {
    if (k === 0) {
      e.dash = 0.8 + ph * 0.1;
      e.dn = ph > 1 ? 1 : 0;
    } else if (k === 1) {
      const n = 2 + ph;
      for (let q = 0; q < n; q++) {
        const o = q ? 150 : 0,
          ax = Math.random() * TAU;
        pBomb(
          e.tx + Math.cos(ax) * o * Math.random(),
          e.ty + Math.sin(ax) * o * Math.random(),
          85,
          1 + q * 0.15,
          26,
          e.col,
        );
      }
    } else {
      if (!rocks(e, 3 + ph * 2) || ph > 1)
        for (let q = 0; q < 8; q++) {
          const t = (q / 8) * TAU;
          pBomb(
            e.x + Math.cos(t) * 140,
            e.y + Math.sin(t) * 140,
            60,
            1,
            22,
            e.col,
          );
        }
      if (ph > 0) pSum(e, 1 + ph, [0, 0, 26]);
    }
  } else if (i === 2) {
    if (k === 0) {
      const src = [e, ...G.en.filter((c) => c.t === 30 && c.hp > 0)];
      src.forEach((s, idx) => {
        const ang = Math.atan2(G.pl.y - s.y, G.pl.x - s.x),
          n = idx ? 1 : [1, 3, 5, 7][ph];
        for (let q = 0; q < n; q++) beam(s, ang + (q - (n - 1) / 2) * 0.22, 1);
      });
    } else {
      if (!G.en.some((c) => c.t === 30 && c.hp > 0)) bossPhase(e, ph, 2);
      const n = 4 + ph * 2;
      for (let q = 0; q < n; q++) {
        const o = q ? Math.random() * 140 : 0,
          ax = Math.random() * TAU;
        pBomb(
          G.pl.x + G.pl.vx * 0.6 + Math.cos(ax) * o,
          G.pl.y + G.pl.vy * 0.6 + Math.sin(ax) * o,
          55,
          1 + q * 0.08,
          20,
          e.col,
        );
      }
    }
  } else if (i === 3) {
    if (k === 0) {
      e.spi = 2.2 + ph * 0.5;
      e.st2 = 0;
    } else if (k === 1) pSum(e, 3 + ph, [0, 1, 2, 3, 4, 10]);
    else if (k === 2) {
      const n = 6 + ph * 2;
      for (let q = 0; q < n; q++) {
        const t = (q / n) * TAU;
        pBomb(
          e.x + Math.cos(t) * 130,
          e.y + Math.sin(t) * 130,
          70,
          1.1,
          22,
          e.col,
        );
      }
    } else pHom(e, 6 + ph * 2, 140, 10);
  } else if (i === 4) {
    if (k === 0) {
      e.dash = 0.5 + ph * 0.08;
      e.dn = ph > 0 ? 1 : 0;
    } else if (k === 1) {
      const n = 4 + ph * 2;
      for (let q = 0; q < n; q++) {
        const x = G.pl.x + (q - (n - 1) / 2) * 70 + (Math.random() - 0.5) * 30,
          y0 = G.pl.y - 300;
        G.fxs.push({
          k: "l",
          x,
          y: y0,
          a: Math.PI / 2,
          len: 600,
          t: 0.8,
          max: 0.8,
          col: e.col,
        });
        lat(e, 0.8, () => {
          G.fxs.push({
            k: "l",
            x,
            y: y0,
            a: Math.PI / 2,
            len: 600,
            t: 0.15,
            max: 0.15,
            col: "#ffffff",
          });
          if (Math.abs(G.pl.x - x) < 22 && G.pl.dashT <= 0) hurt(22);
          G.shake = Math.max(G.shake, 8);
        });
      }
    } else {
      tiles(e, ph);
      pRing(e, 10 + ph * 2, 240, 10, G.time);
    }
  } else if (i === 5) {
    if (k === 0) {
      if (!G.en.some((n) => n.bee && n.hp > 0)) beeWave(e);
      pFan(e, A, 5, 250, 10, 0.9);
    } else if (k === 1) {
      poison(e);
      pBomb(G.pl.x, G.pl.y, 60, 1, 20, e.col);
    } else pHom(e, 5 + ph * 2, 150, 10);
  } else if (i === 6) {
    if (k === 0) {
      G.zones.push({
        k: "pull",
        x: e.x,
        y: e.y,
        r: 280,
        t: 3,
        max: 3,
        col: e.col,
      });
      pRing(e, 14 + ph * 3, 150, 9, G.time);
      e.vis = 3;
    } else if (k === 1) {
      const ang = Math.random() * TAU,
        bx = G.pl.x + Math.cos(ang) * 160,
        by = G.pl.y + Math.sin(ang) * 160;
      if (!blocked(bx, by, 20)) {
        e.x = bx;
        e.y = by;
      }
      e.aim = Math.atan2(G.pl.y - e.y, G.pl.x - e.x);
      e.vis = 1.5;
      for (let q = -1; q <= 1; q++)
        lat(e, 0.2 + q * 0.05, () => beam(e, e.aim + q * 0.3));
    } else {
      portals(e);
      e.spi = 2 + ph * 0.4;
      e.st2 = 0;
    }
  } else {
    if (ph === 1 && (k === 0 || k === 2)) tiles(e, ph);
    else if (ph === 2 && k === 2) {
      const src = [e, ...G.en.filter((c) => c.t === 30 && c.hp > 0)];
      src.forEach((s, idx) => {
        const ang = Math.atan2(G.pl.y - s.y, G.pl.x - s.x),
          n = idx ? 1 : 5;
        for (let q = 0; q < n; q++) beam(s, ang + (q - (n - 1) / 2) * 0.22, 1);
      });
    } else if (k === 1 || (ph === 3 && k === 3)) {
      e.spi = 2.2 + ph * 0.5;
      e.st2 = 0;
    } else if (k === 3) pSum(e, 3 + ph, [0, 1, 2, 3, 4, 10, 27]);
    else {
      pRing(e, 14 + ph * 4, 180, 9, G.time);
      pFan(e, A, 5 + ph, 270, 12, 1.1);
      if (ph > 1) pHom(e, 4, 140, 10);
    }
    if (ph === 3 && k === 0) poison(e);
  }
}
// 功能：處理「bossAI3」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossAI3(e, dt, d, a) {
  const i = e.t - 14,
    hf = e.hp / e.mhp,
    ph = hf < 0.25 ? 3 : hf < 0.5 ? 2 : hf < 0.75 ? 1 : 0;
  if (!e.init) {
    e.init = 1;
    e.open = 0;
    e.lph = 0;
    bossPhase(e, 0, i);
  }
  if (ph > e.lph) {
    e.lph = ph;
    e.inv = 5;
    phaseFx(e, ph);
    bossPhase(e, ph, i);
  }
  e.ph = ph;
  if (i === 0 || (i === 7 && ph === 0)) e.open += dt * (0.5 + 0.2 * ph);
  if (e.vis > 0) e.vis -= dt;
  if (i === 3 && e.nal > 0 && !G.en.some((n) => n.t === 31 && n.hp > 0)) {
    e.nal = 0;
    e.vul = 5;
    flash("#d070ff", 0.3, 0.3);
    lat(e, 5.2, () => bossPhase(e, e.ph, 3));
  }
  if (e.vul > 0) {
    e.vul -= dt;
    return;
  }
  if (d < e.r + G.pl.r + 2 && e.cc <= 0 && G.pl.dashT <= 0) {
    hurt(e.dash > 0 ? 28 : 16);
    e.cc = 0.7;
  }
  if (e.dash > 0) {
    e.dash -= dt;
    const c = Math.cos(e.aim),
      s = Math.sin(e.aim),
      sp = i === 4 ? 520 : i === 7 ? 440 : 420;
    if (mvB(e, c * sp * dt, s * sp * dt)) {
      e.dash = 0;
      if (i === 1) {
        e.vul = 3;
        G.shake = 20;
        burst(e.x, e.y, "#ffb040", 40, 320, 4, 0.8);
        flash("#ffb040", 0.25, 0.3);
        return;
      }
    }
    if (e.dash <= 0) {
      if (e.dn > 0) {
        e.dn--;
        e.aim = a;
        e.dash = 0.6;
      } else e.rec = 0.7;
    }
    return;
  }
  if (e.spi > 0) {
    e.spi -= dt;
    e.st2 -= dt;
    if (e.st2 <= 0) {
      e.st2 = 0.09;
      e.rot = (e.rot || 0) + 0.45;
      const n = 3 + ph;
      for (let k = 0; k < n; k++)
        eb(e, e.rot + (k / n) * TAU, 190 + ph * 20, 8);
    }
    return;
  }
  if (e.tele > 0) {
    e.tele -= dt;
    if (e.tele <= 0) bossFire3(e, ph, a, i);
    return;
  }
  const pref = BPF[i],
    na = nav(e, a, d),
    sp = e.sp * dt * (1 + 0.12 * ph);
  if (pref > 0) {
    if (d > pref + 30) mvB(e, Math.cos(na) * sp, Math.sin(na) * sp);
    else if (d < pref - 40) mvB(e, -Math.cos(a) * sp, -Math.sin(a) * sp);
    else if (i === 2 || i === 4)
      mvB(e, -Math.sin(a) * sp * 0.6, Math.cos(a) * sp * 0.6);
  }
  e.cd -= dt;
  if (e.cd <= 0) {
    e.cd = Math.max(0.7, 1.7 - 0.3 * ph) * (i === 7 ? 0.85 : 1);
    e.tele = Math.max(0.35, 0.6 - 0.08 * ph);
    e.tx = e.x;
    e.ty = e.y;
    e.aim = a;
    e.atk = (e.na = (e.na || 0) + 1) % BK[i];
    if ((i === 1 && e.atk === 1) || (i === 6 && e.atk === 0)) {
      e.tx = G.pl.x;
      e.ty = G.pl.y;
    }
    if ((i === 2 && e.atk === 0) || (i === 7 && ph === 2 && e.atk === 2))
      for (const c of G.en)
        if (c.t === 30) {
          c.tele = e.tele;
          c.aim = Math.atan2(G.pl.y - c.y, G.pl.x - c.x);
          c.tx = c.x;
          c.ty = c.y;
        }
  }
}
const BN_OLD = 0;
// 功能：處理「mvB」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function mvB(e, x, y) {
  const r = e.r;
  e.r = 16;
  const b = mv(e, x, y);
  e.r = r;
  if (b && Math.random() < 0.1) {
    const l = Math.hypot(x, y) || 1;
    hitCell(
      Math.floor((e.x + (x / l) * 24) / T),
      Math.floor((e.y + (y / l) * 24) / T),
    );
  }
  return b;
}
// 功能：處理「beam」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function beam(e, ang, rf) {
  const L = ray(e.x, e.y, ang, 800),
    c = Math.cos(ang),
    s = Math.sin(ang),
    dx = G.pl.x - e.x,
    dy = G.pl.y - e.y,
    u = dx * c + dy * s;
  for (let q = 0; q < L; q += 14)
    burst(e.x + c * q, e.y + s * q, e.col, 1, 40, 3, 0.3);
  if (u > 0 && u < L && Math.abs(-dx * s + dy * c) < G.pl.r + 8) hurt(22);
  hitCell(
    Math.floor((e.x + c * (L + 4)) / T),
    Math.floor((e.y + s * (L + 4)) / T),
  );
  if (rf && L < 790) {
    const px = e.x + c * L,
      py = e.y + s * L;
    let c2 = c,
      s2 = s;
    if (solidAt(px + Math.sign(c) * 8, py)) c2 = -c;
    else if (solidAt(px, py + Math.sign(s) * 8)) s2 = -s;
    else {
      c2 = -c;
      s2 = -s;
    }
    beam({ x: px, y: py, col: e.col }, Math.atan2(s2, c2));
  }
}
// 功能：處理「tLine」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tLine(x, y, a, L) {
  const l = Math.min(L, ray(x, y, a, L));
  cx.moveTo(x, y);
  cx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
}
// 功能：處理「tCirc」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tCirc(x, y, r) {
  cx.moveTo(x + r, y);
  cx.arc(x, y, r, 0, TAU);
}
// 功能：處理「tFan」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tFan(x, y, a, n, sp, L) {
  for (let q = 0; q < n; q++)
    tLine(x, y, a + (n > 1 ? (q / (n - 1) - 0.5) * sp : 0), L);
}
// 功能：處理「teleBeams」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function teleBeams(s, n) {
  const a = Math.atan2(G.pl.y - s.y, G.pl.x - s.x);
  for (let q = 0; q < n; q++)
    tLine(s.x, s.y, a + (q - (n - 1) / 2) * 0.22, 800);
}
// 功能：處理「tTiles」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tTiles() {
  const x0 = Math.round(G.pl.x / 70) * 70 - 175,
    y0 = Math.round(G.pl.y / 70) * 70 - 175;
  cx.rect(x0, y0, 350, 350);
}
// 功能：處理「bossTele」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossTele(e) {
  const i = e.t - 14,
    ph = e.ph || 0,
    k = e.atk,
    A = e.aim,
    R = e.r;
  if (i === 0) {
    if (k === 0) tCirc(e.x, e.y, R + 50);
    else if (k === 1) tFan(e.x, e.y, A, 5 + ph * 2, 0.18 * (4 + ph * 2), 520);
    else {
      tLine(e.x, e.y, A - 1.2, 520);
      tLine(e.x, e.y, A + 1.2, 520);
      cx.moveTo(e.x + Math.cos(A - 1.2) * 140, e.y + Math.sin(A - 1.2) * 140);
      cx.arc(e.x, e.y, 140, A - 1.2, A + 1.2);
    }
  } else if (i === 1) {
    if (k === 0) tLine(e.x, e.y, A, 420 * (0.8 + 0.1 * ph));
    else if (k === 1) {
      tCirc(e.tx, e.ty, 85);
      tCirc(e.tx, e.ty, 150);
    } else
      for (let q = 0; q < 8; q++) {
        const t = (q / 8) * TAU;
        tCirc(e.x + Math.cos(t) * 140, e.y + Math.sin(t) * 140, 60);
      }
  } else if (i === 2) {
    if (k === 0) teleBeams(e, [1, 3, 5, 7][ph]);
    else {
      const x = G.pl.x + G.pl.vx * 0.6,
        y = G.pl.y + G.pl.vy * 0.6;
      tCirc(x, y, 55);
      tCirc(x, y, 150);
    }
  } else if (i === 3) {
    if (k === 2) {
      const n = 6 + ph * 2;
      for (let q = 0; q < n; q++) {
        const t = (q / n) * TAU;
        tCirc(e.x + Math.cos(t) * 130, e.y + Math.sin(t) * 130, 70);
      }
    } else tCirc(e.x, e.y, R + (k === 0 ? 60 : 40));
  } else if (i === 4) {
    if (k === 0) tLine(e.x, e.y, A, 520 * (0.5 + 0.08 * ph));
    else if (k === 1) {
      const n = 4 + ph * 2;
      for (let q = 0; q < n; q++) {
        const x = G.pl.x + (q - (n - 1) / 2) * 70;
        tLine(x, G.pl.y - 300, Math.PI / 2, 600);
      }
    } else tTiles();
  } else if (i === 5) {
    if (k === 0) tFan(e.x, e.y, A, 5, 0.9, 520);
    else if (k === 1) tCirc(G.pl.x, G.pl.y, 60);
    else tCirc(e.x, e.y, R + 40);
  } else if (i === 6) {
    if (k === 0) tCirc(e.x, e.y, 280);
    else if (k === 1) tCirc(G.pl.x, G.pl.y, 160);
    else tCirc(G.pl.x, G.pl.y, 190);
  } else {
    if (ph === 1 && (k === 0 || k === 2)) tTiles();
    else if (ph === 2 && k === 2) teleBeams(e, 5);
    else if (k === 1 || (ph === 3 && k === 3)) tCirc(e.x, e.y, R + 60);
    else if (k === 3) tCirc(e.x, e.y, R + 40);
    else {
      tCirc(e.x, e.y, R + 50);
      tFan(e.x, e.y, A, 5 + ph, 1.1, 520);
    }
  }
}
// 功能：繪製或建立「drawBoss」所需的畫面元素。
export function drawBoss() {
  const e = G.en.find(isB);
  if (!e) return;
  if (e.dummy) {
    drawDummyBar(e);
    return;
  }
  const u = G.HU,
    w = Math.min(G.W * 0.4, 420),
    x = G.W / 2 - w / 2,
    y = G.safeT + 14 * u,
    f = Math.max(0, e.hp / e.mhp);
  cx.save();
  cx.fillStyle = "#05060dcc";
  cx.fillRect(x - 2, y - 2, w + 4, 12 * u + 4);
  cx.shadowColor = e.col;
  cx.shadowBlur = 10;
  e.hv =
    e.hv === undefined
      ? e.hp
      : e.hv > e.hp
        ? Math.max(e.hp, e.hv - e.mhp * 0.004)
        : e.hp;
  cx.fillStyle = "#ffffff88";
  cx.fillRect(x, y, w * Math.max(0, e.hv / e.mhp), 12 * u);
  cx.fillStyle = e.col;
  cx.fillRect(x, y, w * f, 12 * u);
  cx.save();
  cx.beginPath();
  cx.rect(x, y, w * f, 12 * u);
  cx.clip();
  cx.fillStyle = "#ffffff40";
  cx.fillRect(x + ((G.time * 130) % (w + 80)) - 40, y, 26, 12 * u);
  cx.restore();
  cx.restore();
  cx.strokeStyle = "#ffffff55";
  cx.lineWidth = 1;
  cx.strokeRect(x - 2, y - 2, w + 4, 12 * u + 4);
  for (const t of [0.25, 0.5, 0.75]) {
    cx.fillStyle = "#05060d";
    cx.fillRect(x + w * t - 1, y, 2, 12 * u);
  }
  cx.fillStyle = "#ffffff";
  cx.font = `bold ${11 * u}px ui-monospace,monospace`;
  cx.textAlign = "center";
  cx.textBaseline = "bottom";
  cx.fillText("BOSS " + BN[e.t - 14], G.W / 2, y - 4);
  const sgf = e.vul > 0 ? 1 : Math.min(1, (e.sg || 0) / (e.mhp * 0.12));
  cx.fillStyle = "#05060dcc";
  cx.fillRect(x, y + 12 * u + 4, w, 5 * u);
  cx.fillStyle = e.vul > 0 ? "#ffffff" : "#ffe14a";
  cx.fillRect(x, y + 12 * u + 4, w * sgf, 5 * u);
  if (e.vul > 0) {
    cx.fillStyle = "#ffe14a";
    cx.textBaseline = "top";
    cx.fillText("BREAK!", G.W / 2, y + 20 * u);
  }
}
// 功能：處理「chg」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chg(e, dt, d, a) {
  const E = e.el;
  if (e.dash > 0) {
    e.dash -= dt;
    let c = Math.cos(e.aim),
      s = Math.sin(e.aim);
    if (mv(e, c * (E ? 340 : 300) * dt, s * (E ? 340 : 300) * dt)) {
      const cx0 = Math.floor((e.x + c * (e.r + 6)) / T),
        cy0 = Math.floor((e.y + s * (e.r + 6)) / T);
      if (E && !e.bn && e.dash > 0.05) {
        e.bn = 1;
        const bx = blocked(e.x + c * 8, e.y, e.r),
          by = blocked(e.x, e.y + s * 8, e.r);
        if (bx) c = -c;
        if (by) s = -s;
        if (!bx && !by) {
          c = -c;
          s = -s;
        }
        e.aim = Math.atan2(s, c);
        burst(e.x, e.y, EL_COL, 10, 200, 2, 0.3);
      } else e.dash = 0;
      hitCell(cx0, cy0);
    }
    burst(e.x, e.y, e.col, 1, 30, 3, 0.25);
    if (e.dash <= 0) {
      e.rec = E ? 0.7 : 0.9;
      if (E)
        G.zones.push({
          k: "slowz",
          x: e.x,
          y: e.y,
          r: 60,
          t: 1.2,
          max: 1.2,
          col: e.col,
        });
    }
  } else if (e.tele > 0) {
    e.tele -= dt;
    if (E) {
      if (Math.random() < 0.3) burst(e.x, e.y, EL_COL, 1, 60, 2, 0.3);
      for (const o of G.en) {
        if (o === e || o.hp <= 0 || isB(o) || o.t >= 30 || o.dummy) continue;
        const ox = e.x - o.x,
          oy = e.y - o.y,
          od = Math.hypot(ox, oy);
        if (od < 240 && od > e.r + o.r + 10)
          mv(o, (ox / od) * 110 * dt, (oy / od) * 110 * dt);
      }
    }
    if (e.tele <= 0) {
      e.dash = E ? 0.55 : 0.5;
      e.bn = 0;
    }
  } else {
    const na = nav(e, a, d);
    mv(e, Math.cos(na) * e.sp * dt, Math.sin(na) * e.sp * dt);
    e.cd -= dt;
    if (e.cd <= 0 && d < (E ? 450 : 420) && ray(e.x, e.y, a, d) >= d - 6) {
      e.cd = E ? 2 + Math.random() * 0.8 : 2.4 + Math.random();
      e.tele = E ? 0.35 : 0.45;
      e.aim = a;
      e.tx = e.x;
      e.ty = e.y;
    }
  }
  if (d < e.r + G.pl.r + 2 && e.cc <= 0 && G.pl.dashT <= 0) {
    hurt(e.dash > 0 ? (E ? 28 : 22) : E ? 16 : 12);
    e.cc = 0.7;
  }
}

// 功能：處理「mineBoom」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function mineBoom(z) {
  explode({
    x: z.x,
    y: z.y,
    ex: z.r,
    dmg: z.dmg,
    kb: z.kb || 300,
    wd: z.wd === undefined ? 2 : z.wd,
    col: z.col,
    soft: 1,
    cw: z.ult ? undefined : z.wi,
    bu: z.bu,
    fr: z.fr,
    fz4: z.fz4,
    lk: z.lk,
    ch: z.ch,
  });
  z.t = 0;
}
// 功能：處理「zoneParticle」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function zoneParticle(z, k, col) {
  if (G.pt.length >= 700) return;
  const n =
    k === "ice" ? 5 + ((Math.random() * 5) | 0) : 1 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n && G.pt.length < 700; i++) {
    const a = Math.random() * TAU,
      r = z.r * Math.sqrt(Math.random()),
      ice = k === "ice",
      life = ice ? 0.55 + Math.random() * 0.55 : 0.09 + Math.random() * 0.09;
    G.pt.push({
      x: z.x + Math.cos(a) * r,
      y: z.y + Math.sin(a) * r,
      vx: ice ? (Math.random() - 0.5) * 12 : (Math.random() - 0.5) * 22,
      vy: ice ? -18 - Math.random() * 34 : (Math.random() - 0.5) * 22,
      life,
      max: life,
      age: 0,
      col,
      sz: ice ? 1.5 + Math.random() * 4 : 1.15 + Math.random() * 1.15,
      f: 2,
      k,
      rot: Math.random() * TAU,
      vr: ice ? (Math.random() - 0.5) * 1.4 : (Math.random() - 0.5) * 5,
      seed: Math.random() * 1000,
    });
  }
}
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

