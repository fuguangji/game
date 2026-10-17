/** game/chip-effects — 芯片觸發效果：命中、持續、連鎖、重力井、充能 */
import { G } from "../core/game-state.js";
import { TAU, cx } from "../core/viewport.js";
import { burst } from "./battle.js";
import { dm, frz } from "./boss.js";
import { explode } from "./physics.js";
import { kill } from "./simulation.js";
import { ftxt } from "./ultimate-effects.js";

// 功能：處理「chipHit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chipHit(e, dd, f) {
  if (!f || !(dd > 0)) return;
  if (f.bu) e.bu = 3;
  if (f.fr) e.fr = 2;
  if (f.fz4) {
    e.fv = (e.fv || 0) + 1;
    e.fr = Math.max(e.fr || 0, 1.2);
    if (e.fv >= 6) frz(e);
  }
  if (f.lk && G.pl.hp < G.pl.mhp)
    G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + Math.min(2, dd * 0.025));
  if (f.ch) {
    let t2 = null,
      bdist = 140;
    for (const q of G.en)
      if (q !== e && q.hp > 0) {
        const d2 = Math.hypot(q.x - e.x, q.y - e.y);
        if (d2 < bdist) {
          bdist = d2;
          t2 = q;
        }
      }
    if (t2) {
      const d3 = dm(t2, dd * 0.5);
      t2.hp -= d3;
      t2.hf = 1;
      G.fxs.push({
        k: "l",
        x: e.x,
        y: e.y,
        a: Math.atan2(t2.y - e.y, t2.x - e.x),
        len: bdist,
        t: 0.15,
        max: 0.15,
        col: "#7ab8ff",
      });
      if (t2.hp <= 0) kill(t2);
    }
  }
}

// 功能：處理「chipTick」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chipTick(e, dt, z, dd) {
  if (z.bu) e.bu = 3;
  if (z.fr) e.fr = Math.max(e.fr || 0, 0.6);
  if (z.fz4) {
    e.fv = (e.fv || 0) + dt * 5;
    e.fr = Math.max(e.fr || 0, 0.6);
    if (e.fv >= 6) frz(e);
  }
  if (z.lk && dd > 0 && G.pl.hp < G.pl.mhp)
    G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + dd * 0.025);
}

// 功能：處理「chainZone」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chainZone(z, d) {
  if (!(d > 0)) return;
  const c = G.en.filter(
    (e) => e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r,
  );
  if (!c.length) return;
  chipHit(c[(Math.random() * c.length) | 0], d * 2, { ch: 1 });
}

// 功能：處理「gpTick」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function gpTick(z, dt) {
  for (const e of G.en) {
    if (e.hp <= 0 || Math.hypot(e.x - z.x, e.y - z.y) >= z.r + e.r) continue;
    let dd = 0;
    if (z.dps) {
      dd = dm(e, z.dps * dt);
      e.hp -= dd;
      e.hf = dd > 0 ? 1 : 0;
    }
    chipTick(e, dt, z, dd);
    if (e.hp <= 0) kill(e);
  }
  if (z.ch) {
    z.cht = (z.cht || 0) - dt;
    if (z.cht <= 0) {
      z.cht = 0.4;
      chainZone(z, (z.dps || 10) * 0.4);
    }
  }
  if (z.t <= 0 && z.xb && !z.xd) {
    z.xd = 1;
    explode({
      x: z.x,
      y: z.y,
      ex: z.r * 0.6,
      dmg: (z.dps || 10) * 1.2,
      kb: 300,
      wd: 1,
      col: z.col,
    });
  }
}

// 功能：處理敵人電荷增加時的特效與文字提示。
export function chgHit(e) {
  G.fxs.push({
    k: "w",
    x: e.x,
    y: e.y,
    r: e.r + 26,
    t: 0.25,
    max: 0.25,
    col: "#ffe14a",
  });
  burst(e.x, e.y, "#fff4a6", 8, 200, 2, 0.3);
  ftxt(
    e.x,
    e.y - e.r - 26,
    e.cg >= 2 ? "電荷 " + e.cg + "/3 · 再一發引爆！" : "電荷 " + e.cg + "/3",
    "#ffe14a",
    e.cg >= 2 ? 13 : 11,
  );
}

// 功能：繪製敵人電荷層數與蓄電狀態。
export function drawChg(e) {
  const t = G.time;
  if (e.cg > 0) {
    const n = Math.min(3, e.cg),
      pu = 0.5 + 0.5 * Math.sin(t * (n >= 2 ? 18 : 7)),
      R = e.r + 7;
    cx.save();
    cx.globalCompositeOperation = "lighter";
    cx.lineJoin = "round";
    if (n >= 2) {
      cx.globalAlpha = 0.07 + 0.06 * pu;
      cx.fillStyle = "#ffe14a";
      cx.beginPath();
      cx.arc(e.x, e.y, 150, 0, TAU);
      cx.fill();
      cx.globalAlpha = 0.3 + 0.25 * pu;
      cx.strokeStyle = "#ffe14a";
      cx.lineWidth = 1.5;
      cx.setLineDash([7, 7]);
      cx.lineDashOffset = -t * 40;
      cx.beginPath();
      cx.arc(e.x, e.y, 150, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
    }
    cx.shadowColor = "#ffe14a";
    cx.shadowBlur = 12;
    cx.strokeStyle = n >= 2 ? "#fff4a6" : "#ffe14a";
    cx.lineWidth = 1.2 + n * 0.6;
    cx.globalAlpha = 0.4 + 0.12 * n * pu;
    cx.beginPath();
    const seg = 18;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU + t * (1 + n),
        r =
          R +
          (i % 2 ? 1 : -1) *
            (1.5 + n * 1.2) *
            (0.5 + 0.5 * Math.sin(t * 30 + i * 1.7)),
        px = e.x + Math.cos(a) * r,
        py = e.y + Math.sin(a) * r;
      i ? cx.lineTo(px, py) : cx.moveTo(px, py);
    }
    cx.stroke();
    cx.globalAlpha = 0.8;
    cx.lineWidth = 2;
    cx.shadowBlur = 0;
    cx.beginPath();
    cx.arc(
      e.x,
      e.y,
      R + 7,
      -Math.PI / 2,
      -Math.PI / 2 + TAU * Math.max(0, Math.min(1, (e.cgt || 0) / 6)),
    );
    cx.stroke();
    cx.restore();
    cx.save();
    const py = e.y - e.r - 18;
    for (let q = 0; q < 3; q++) {
      const px = e.x + (q - 1) * 12,
        on = q < n;
      cx.beginPath();
      cx.arc(px, py, on ? 4.5 : 3.5, 0, TAU);
      if (on) {
        cx.fillStyle = n >= 2 && q === n - 1 ? "#ffffff" : "#ffe14a";
        cx.shadowColor = "#ffe14a";
        cx.shadowBlur = 10 + 6 * pu;
        cx.fill();
      } else {
        cx.strokeStyle = "#ffe14a88";
        cx.lineWidth = 1.5;
        cx.stroke();
      }
    }
    cx.restore();
  }
  if (e.stn > 0 && !(e.frz > 0)) {
    cx.save();
    const hy = e.y - e.r - (e.cg > 0 ? 44 : 10);
    cx.globalCompositeOperation = "lighter";
    cx.shadowColor = "#ffe14a";
    cx.shadowBlur = 8;
    cx.fillStyle = "#ffe14a";
    for (let q = 0; q < 3; q++) {
      const a = t * 6 + (q * TAU) / 3,
        x = e.x + Math.cos(a) * 13,
        y = hy + Math.sin(a) * 4;
      cx.beginPath();
      cx.moveTo(x, y - 3);
      cx.lineTo(x + 2.5, y);
      cx.lineTo(x, y + 3);
      cx.lineTo(x - 2.5, y);
      cx.closePath();
      cx.fill();
    }
    cx.globalCompositeOperation = "source-over";
    cx.fillStyle = "#ffe14a44";
    cx.fillRect(e.x - 10, hy - 5, 20, 2);
    cx.fillStyle = "#ffe14a";
    cx.fillRect(e.x - 10, hy - 5, 20 * Math.max(0, Math.min(1, e.stn / 2)), 2);
    cx.restore();
  }
}
