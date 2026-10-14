/** game/ultimates — 各把槍的大招（SUPER）與雷射地帶 */
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { MW, T, TAU, cx } from "../core/viewport.js";
import { BS } from "../game-config.js";
import { ULN, blocked, burst, empty, hitCell, mkEn, ray, turLand, ub, ultT } from "./battle.js";
import { dm, flash, frz, isB, thr } from "./boss.js";
import { chgU, explode } from "./physics.js";
import { UL } from "./progress.js";
import { kill } from "./simulation.js";
import { WP } from "./weapons.js";

export const SQ = [];
// 功能：將延遲執行的回呼加入特效排程佇列。
export const later = (t, fn) => SQ.push({ t, fn }),
  line = (a, len, t, col) =>
    G.fxs.push({ k: "l", x: G.pl.x, y: G.pl.y, a, len, t, max: t, col }),
  spot = (x, y, r, t, col) => G.fxs.push({ k: "c", x, y, r, t, max: t, col }),
  LR = (q) => q * 330;
export const ULTS = {
  0(a) {
    for (let k = 0; k < 12; k++)
      later(k * 0.05, () => ub(a, 720, { dmg: 40, r: 4, life: 0.9 / BS }));
  },
  1(a) {
    for (let n = 0; n < 3; n++)
      later(n * 0.25, () => {
        for (let k = 0; k < 16; k++)
          ub(
            a + (k / 15 - 0.5) * 1.1 + (Math.random() - 0.5) * 0.1,
            380 + Math.random() * 160,
            { dmg: 19, r: 4, life: 0.55 / BS, kb: 300, wd: 2 },
          );
        G.shake = 10;
      });
  },
  2(a) {
    const px = G.pl.x,
      py = G.pl.y;
    line(a, 1700, 0.7, "#ffe14a");
    G.fxs.push({
      k: "cring",
      x: px,
      y: py,
      r: 90,
      t: 0.5,
      max: 0.5,
      col: "#ffe14a",
    });
    later(0.7, () => {
      ub(a, 1500, {
        x: px,
        y: py,
        dmg: 380,
        r: 32,
        tl: 3,
        col: "#ffe14a",
        sn: 1,
        life: 1.47 / BS,
        pierce: 1,
        wd: 3,
        kb: 900,
      });
      G.fxs.push({
        k: "w",
        x: px,
        y: py,
        r: 90,
        t: 0.3,
        max: 0.3,
        col: "#ffe14a",
      });
      burst(px, py, "#ffe14a", 12, 240, 2.5, 0.4);
      G.shake = 16;
    });
  },
  3(a) {
    for (let k = 0; k < 30; k++)
      later(k * 0.035, () => {
        for (let j = 0; j < 2; j++)
          ub(a + (Math.random() - 0.5) * 0.5, 520 + Math.random() * 120, {
            dmg: 11,
            r: 3,
            life: 0.5 / BS,
            kb: 60,
          });
      });
  },
  4(a) {
    for (let k = 0; k < 30; k++)
      later(k * 0.04, () =>
        ub(a + (Math.random() - 0.5) * 0.6, 230 + Math.random() * 60, {
          dmg: 15,
          r: 7,
          life: 0.8 / BS,
          l0: 0.8 / BS,
          kb: 60,
          fl: 1,
          wd: 0.1,
        }),
      );
  },
  5(a, q) {
    const d = LR(q),
      x = G.pl.x + Math.cos(a) * d,
      y = G.pl.y + Math.sin(a) * d;
    spot(x, y, 120, 0.9, "#ffe14a");
    later(0.9, () =>
      explodeU({
        x,
        y,
        ex: 120,
        dmg: 250,
        kb: 700,
        wd: 3,
        col: "#ffe14a",
      }),
    );
  },
  6(a) {
    for (let k = 0; k < 14; k++)
      later(k * 0.05, () =>
        ub(a + (k % 2 ? 1 : -1) * (0.3 + k * 0.05), 360, {
          dmg: 34,
          hm: 1,
          hmr: 3.2,
          hml: 220,
          life: 2.2 / BS,
          r: 4,
        }),
      );
  },
  7(a) {
    for (let n = 0; n < 3; n++)
      later(n * 0.25, () => {
        for (let k = 0; k < 18; k++)
          ub((k / 18) * TAU + n * 0.17, 260 + n * 80, { dmg: 26 });
      });
  },
  8(a) {
    ultLaser(a);
  },
  9(a) {
    for (let k = 0; k < 28; k++)
      later(k * 0.035, () => {
        const t = a + k * 0.4;
        ub(t, 600, { dmg: 22 });
        ub(t + Math.PI, 600, { dmg: 22 });
      });
  },
  10(a, q) {
    const d = LR(q),
      x = G.pl.x + Math.cos(a) * d,
      y = G.pl.y + Math.sin(a) * d;
    spot(x, y, 150, 0.8, "#ffd23a");
    later(0.8, () => {
      explodeU({
        x,
        y,
        ex: 150,
        dmg: 100,
        kb: 600,
        wd: 3,
        col: "#ffd23a",
      });
      for (let k = 0; k < 6; k++) {
        const t = (k / 6) * TAU;
        later(0.15 + k * 0.07, () =>
          explodeU({
            x: x + Math.cos(t) * 95,
            y: y + Math.sin(t) * 95,
            ex: 60,
            dmg: 50,
            kb: 300,
            wd: 2,
            col: "#ffd23a",
          }),
        );
      }
    });
  },
  11(a) {
    for (let k = 0; k < 10; k++)
      ub(a + (k - 4.5) * 0.07, 900, {
        dmg: 55,
        r: 7.5,
        tl: 3,
        pierce: 1,
        wd: 3,
        life: 0.9 / BS,
      });
  },
};
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
// 功能：建立或生成「mkDummy」所需的遊戲資料。
export function mkDummy(x, y) {
  const e = mkEn(14, x, y);
  Object.assign(e, {
    t: 22,
    r: 34,
    hp: 5000,
    mhp: 5000,
    sp: 0,
    m: 1e6,
    col: "#9aa0ab",
    sc: 0,
    cd: 1e9,
    dummy: 1,
    hx: x,
    hy: y,
    hv: 5000,
  });
  return e;
}
// 功能：建立或生成「spawnDummy」所需的遊戲資料。
export function spawnDummy() {
  for (let k = G.en.length - 1; k >= 0; k--) if (G.en[k].dummy) G.en.splice(k, 1);
  const a = G.pl.aim;
  let p = { x: G.pl.x + Math.cos(a) * 260, y: G.pl.y + Math.sin(a) * 260 };
  if (blocked(p.x, p.y, 34)) p = empty(200, G.pl) || p;
  G.en.push(mkDummy(p.x, p.y));
  burst(p.x, p.y, "#ffffff", 12, 160, 2, 0.5);
}
// 功能：繪製或建立「drawDummyBar」所需的畫面元素。
export function drawDummyBar(e) {
  const u = G.HU,
    x = 8 * u,
    w = G.W - 16 * u,
    y = G.safeT + 74 * u,
    h = 14 * u,
    f = Math.max(0, e.hp / e.mhp);
  cx.save();
  cx.fillStyle = "#05060dcc";
  cx.fillRect(x - 2, y - 2, w + 4, h + 4);
  e.hv =
    e.hv === undefined
      ? e.hp
      : e.hv > e.hp
        ? Math.max(e.hp, e.hv - e.mhp * 0.004)
        : e.hp;
  cx.fillStyle = "#ffffff88";
  cx.fillRect(x, y, w * Math.max(0, e.hv / e.mhp), h);
  cx.shadowColor = e.col;
  cx.shadowBlur = 10;
  cx.fillStyle = e.col;
  cx.fillRect(x, y, w * f, h);
  cx.shadowBlur = 0;
  cx.save();
  cx.beginPath();
  cx.rect(x, y, w * f, h);
  cx.clip();
  cx.fillStyle = "#ffffff40";
  cx.fillRect(x + ((G.time * 130) % (w + 80)) - 40, y, 26, h);
  cx.restore();
  cx.strokeStyle = "#ffffff55";
  cx.lineWidth = 1;
  cx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  cx.fillStyle = "#ffffff";
  cx.font = `bold ${12 * u}px ui-monospace,monospace`;
  cx.textAlign = "center";
  cx.textBaseline = "bottom";
  cx.fillText("肉盾", G.W / 2, y - 4);
  cx.restore();
}
// 功能：建立浮動文字特效，供電荷、引爆與暈眩提示使用。
export function ftxt(x, y, text, col = "#ffffff", size = 12) {
  // 將戰鬥提示加入特效佇列，由 render() 依剩餘時間繪製並淡出。
  G.fxs.push({
    k: "txt",
    x,
    y,
    text: String(text),
    col,
    size,
    t: 1.15,
    max: 1.15,
  });
}
// 功能：計算閃電折線的隨機節點。
export function zigPts(x0, y0, x1, y1, n, amp) {
  const pts = [[x0, y0]],
    dx = x1 - x0,
    dy = y1 - y0,
    L = Math.hypot(dx, dy) || 1,
    nx = -dy / L,
    ny = dx / L;
  for (let i = 1; i < n; i++) {
    const t = i / n,
      o = (Math.random() - 0.5) * 2 * amp * (1 - Math.abs(t - 0.5) * 0.6);
    pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
  }
  pts.push([x1, y1]);
  return pts;
}
// 功能：建立閃電折線及分支特效。
export function zig(x0, y0, x1, y1, col, t, w, br, a) {
  const L = Math.hypot(x1 - x0, y1 - y0),
    n = Math.max(5, Math.round(L / 22)),
    pts = zigPts(x0, y0, x1, y1, n, Math.min(26, L * 0.12)),
    brs = [];
  for (let k = 0; k < (br || 0); k++) {
    const i = 1 + Math.floor(Math.random() * Math.max(1, pts.length - 3)),
      p = pts[i],
      a =
        Math.atan2(y1 - y0, x1 - x0) +
        (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6),
      l = L * (0.12 + Math.random() * 0.15);
    brs.push(
      zigPts(p[0], p[1], p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l, 4, 6),
    );
  }
  G.fxs.push({
    k: "zig",
    pts,
    brs,
    x: x0,
    y: y0,
    col,
    t,
    max: t,
    w: w || 5,
    a: a || 1,
  });
}
// 功能：處理「strikeFx」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function strikeFx(e) {
  zig(
    e.x + (Math.random() - 0.5) * 40,
    e.y - 300,
    e.x,
    e.y,
    "#ffe14a",
    0.22,
    3,
    1,
    0.55,
  );
  G.fxs.push({
    k: "w",
    x: e.x,
    y: e.y,
    r: 30,
    t: 0.2,
    max: 0.2,
    col: "#fff4a6",
  });
  burst(e.x, e.y, "#fff4a6", 6, 180, 2, 0.3);
}
// 功能：處理「cloudSpark」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function cloudSpark(z) {
  const a = Math.random() * TAU,
    r = Math.sqrt(Math.random()) * z.r * 0.9,
    x = z.x + Math.cos(a) * r,
    y = z.y + Math.sin(a) * r,
    b = Math.random() * TAU,
    l = 40 + Math.random() * 70;
  zig(
    x,
    y,
    x + Math.cos(b) * l,
    y + Math.sin(b) * l,
    Math.random() < 0.5 ? "#fff4a6" : "#ffe14a",
    0.1,
    1.4,
    0,
    0.4,
  );
}
// 功能：處理「cloudSky」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function cloudSky(z) {
  const x = z.x + (Math.random() - 0.5) * z.r * 1.6,
    y = z.y + (Math.random() - 0.5) * z.r * 1.2;
  zig(
    x + (Math.random() - 0.5) * 60,
    z.y - z.r * 2.2,
    x,
    y,
    "#ffe14a",
    0.14,
    1.8,
    1,
    0.35,
  );
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

// 功能：處理「lzDmg」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function lzDmg(e, d, a, kb, o) {
  const dd = dm(e, d, Math.atan2(G.pl.y - e.y, G.pl.x - e.x));
  e.hp -= dd;
  e.hf = dd > 0 ? 1 : 0;
  e.kx += (Math.cos(a) * kb) / e.m;
  e.ky += (Math.sin(a) * kb) / e.m;
  if (o) {
    if (o.bu) e.bu = 3;
    if (o.fr) e.fr = 2;
    if (o.lk && G.pl.hp < G.pl.mhp)
      G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + Math.min(2, d * 0.025));
    if (o.fz4) {
      e.fv = (e.fv || 0) + 1;
      e.fr = 1.2;
      if (e.fv >= 6) frz(e);
    }
    if (o.ch) {
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
        t2.hp -= dm(t2, d * 0.5);
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
    if (o.xb && Math.random() < 0.3)
      explode({
        x: e.x,
        y: e.y,
        ex: 48,
        dmg: d * 0.35,
        kb: 120,
        wd: 0,
        col: o.col || "#ffb040",
      });
  }
  return dd;
}
// 沿著射線 (x0,y0,a) 長度 L、半寬 hw 的光束，對所有碰到的敵人造成傷害；回傳命中數
export function lzHit(x0, y0, a, L, hw, d, kb, o, col) {
  const c = Math.cos(a),
    s = Math.sin(a);
  let n = 0;
  for (const e of G.en) {
    if (e.hp <= 0) continue;
    const dx = e.x - x0,
      dy = e.y - y0,
      u = dx * c + dy * s;
    if (u < -e.r || u > L + e.r) continue;
    if (Math.abs(-dx * s + dy * c) > e.r + hw) continue;
    const dd = lzDmg(e, d, a, kb, o);
    n++;
    if (Math.random() < 0.5)
      burst(
        e.x - c * e.r * 0.8,
        e.y - s * e.r * 0.8,
        dd > 0 ? col || e.col : "#9aa0ab",
        1,
        150,
        2,
        0.25,
      );
    if (e.hp <= 0) kill(e);
  }
  return n;
}
// 光線槍：每個射擊間隔結算一次傷害，按住射擊時光束持續存在
export function laserFire(w, tg, SB) {
  const R = w.v * w.life,
    hw = Math.max(2.5, w.r * 1.3);
  const a0 = tg ? Math.atan2(tg.y - G.pl.y, tg.x - G.pl.x) : G.pl.aim;
  const n = Math.max(1, w.n1 || 1),
    offs = [];
  for (let k = 0; k < n; k++)
    offs.push(n > 1 ? (k / (n - 1) - 0.5) * Math.max(0.12, w.sp || 0) : 0);
  const crt = w.cr && Math.random() < w.cr;
  const d = w.dmg * SB * dmM() * (crt ? w.cm : 1);
  const col = crt ? "#ffffff" : w.c;
  let hit = 0;
  for (const o of offs) {
    const a = a0 + o,
      c = Math.cos(a),
      s = Math.sin(a),
      x0 = G.pl.x + c * 14,
      y0 = G.pl.y + s * 14;
    const L = ray(x0, y0, a, R);
    hit += lzHit(G.pl.x, G.pl.y, a, L + 14, hw, d, w.kb, w, col);
    if (L < R - 4) {
      const wn =
        w.wd === undefined
          ? 1
          : Math.floor(w.wd) + (Math.random() < w.wd % 1 ? 1 : 0);
      if (wn > 0)
        hitCell(
          Math.floor((x0 + c * (L + 4)) / T),
          Math.floor((y0 + s * (L + 4)) / T),
          wn,
        );
      burst(x0 + c * L, y0 + s * L, col, 2, 130, 2, 0.22);
    }
    if (G.pt.length < 600)
      burst(
        x0 + c * Math.random() * L,
        y0 + s * Math.random() * L,
        col,
        1,
        40,
        2,
        0.2,
      );
  }
  if (hit) chgU(G.pl.w, d * 0.25 * hit);
  G.pl.lz = { t: 0.13, tg: tg, a: a0, offs: offs, col: col, hw: hw, R: R };
  G.shake = Math.max(G.shake, 0.9);
}
// 破滅雷射：蓄力 0.5 秒後釋放一道貫穿一切的粗大光束，持續 2.6 秒並左右掃動
export function ultLaser(a) {
  const m = G.UM || {};
  LZ.push({
    k: "u",
    t: 0,
    ch: 0.5,
    dur: 2.6,
    tk: 0,
    man: G.UMANUAL,
    base: a,
    a: a,
    off: 0,
    R: 820,
    L: 0,
    x0: G.pl.x,
    y0: G.pl.y,
    hw: Math.max(14, Math.min(34, 19 * (m.r || 1))),
    d: 14 * dmM() * (m.dm || 1),
    kb: 50,
    o: {
      bu: m.bu,
      fr: m.fr,
      fz4: m.fz4,
      lk: m.lk,
      ch: m.ch,
      xb: m.xb,
      col: "#ffe14a",
    },
    col: "#ffe14a",
  });
  G.fxs.push({
    k: "w",
    x: G.pl.x,
    y: G.pl.y,
    r: 110,
    t: 0.5,
    max: 0.5,
    col: "#ffe14a",
  });
}
// 功能：更新雷射武器與光束狀態。
export function updLZ(dt) {
  for (const e of G.en)
    if (e.dummy) {
      e.x = e.hx;
      e.y = e.hy;
      e.kx = 0;
      e.ky = 0;
    }
  for (let i = FT.length - 1; i >= 0; i--) {
    const f = FT[i];
    f.t -= dt;
    f.y -= dt * 26;
    if (f.t <= 0) FT.splice(i, 1);
  }
  const z = G.pl.lz;
  if (z && z.t > 0) {
    z.t -= dt;
    const tg = z.tg && z.tg.hp > 0 ? z.tg : null;
    z.a = tg ? Math.atan2(tg.y - G.pl.y, tg.x - G.pl.x) : G.pl.aim;
  }
  for (let i = LZ.length - 1; i >= 0; i--) {
    const u = LZ[i];
    u.t += dt;
    if (!u.man) {
      const tg = ultT();
      u.base = tg ? Math.atan2(tg.y - G.pl.y, tg.x - G.pl.x) : G.pl.aim;
    }
    const fire = u.t >= u.ch;
    u.off = fire ? Math.sin((u.t - u.ch) * 2.7) * 0.42 : 0;
    u.a = u.base + u.off;
    const c = Math.cos(u.a),
      s = Math.sin(u.a);
    u.x0 = G.pl.x + c * 14;
    u.y0 = G.pl.y + s * 14;
    u.L = ray(u.x0, u.y0, u.a, u.R);
    if (fire) {
      G.shake = Math.max(G.shake, 4);
      u.tk -= dt;
      while (u.tk <= 0) {
        u.tk += 0.05;
        lzHit(G.pl.x, G.pl.y, u.a, u.L + 14, u.hw, u.d, u.kb, u.o, u.col);
        if (u.L < u.R - 4)
          hitCell(
            Math.floor((u.x0 + c * (u.L + 4)) / T),
            Math.floor((u.y0 + s * (u.L + 4)) / T),
            2,
          );
      }
      if (G.pt.length < 600) {
        const k = Math.random() * u.L,
          px = u.x0 + c * k,
          py = u.y0 + s * k;
        burst(
          px + (Math.random() - 0.5) * u.hw,
          py + (Math.random() - 0.5) * u.hw,
          u.col,
          1,
          70,
          2.5,
          0.3,
        );
      }
      burst(u.x0 + c * u.L, u.y0 + s * u.L, u.col, 2, 200, 2.5, 0.3);
    }
    if (u.t >= u.ch + u.dur) {
      LZ.splice(i, 1);
      G.fxs.push({
        k: "w",
        x: G.pl.x,
        y: G.pl.y,
        r: 90,
        t: 0.35,
        max: 0.35,
        col: u.col,
      });
    }
  }
}
// 功能：繪製指定方向的雷射光束。
export function lzBeam(x, y, a, L, w, col, al) {
  const ex = x + Math.cos(a) * L,
    ey = y + Math.sin(a) * L,
    fl = 1 + 0.12 * Math.sin(G.time * 70);
  cx.save();
  cx.globalCompositeOperation = "lighter";
  cx.lineCap = "round";
  cx.shadowColor = col;
  cx.shadowBlur = 20;
  cx.strokeStyle = col;
  cx.beginPath();
  cx.moveTo(x, y);
  cx.lineTo(ex, ey);
  cx.globalAlpha = 0.22 * al;
  cx.lineWidth = w * 3.2 * fl;
  cx.stroke();
  cx.globalAlpha = 0.6 * al;
  cx.lineWidth = w * 1.7 * fl;
  cx.stroke();
  cx.shadowBlur = 8;
  cx.strokeStyle = "#ffffff";
  cx.globalAlpha = 0.95 * al;
  cx.lineWidth = w * 0.7 * fl;
  cx.stroke();
  cx.shadowBlur = 0;
  for (const [px, py, r] of [
    [ex, ey, w * 2.6],
    [x, y, w * 1.9],
  ]) {
    const g = cx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.35, col);
    g.addColorStop(1, col + "00");
    cx.globalAlpha = 0.85 * al;
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(px, py, r, 0, TAU);
    cx.fill();
  }
  cx.restore();
}
// 功能：繪製目前的雷射武器視覺效果。
export function drawLZ() {
  if (fsm.state !== "play") return;
  for (const f of FT) {
    cx.save();
    cx.globalAlpha = Math.min(1, (f.t / f.max) * 2);
    cx.font = `bold ${f.sz}px system-ui`;
    cx.textAlign = "center";
    cx.lineWidth = 3;
    cx.strokeStyle = "#05060d";
    cx.shadowColor = f.col;
    cx.shadowBlur = 8;
    cx.strokeText(f.txt, f.x, f.y);
    cx.fillStyle = f.col;
    cx.fillText(f.txt, f.x, f.y);
    cx.restore();
  }
  const z = G.pl.lz;
  if (z && z.t > 0) {
    const al = Math.min(1, z.t / 0.05);
    for (const o of z.offs) {
      const a = z.a + o,
        x0 = G.pl.x + Math.cos(a) * 14,
        y0 = G.pl.y + Math.sin(a) * 14,
        L = ray(x0, y0, a, z.R);
      lzBeam(x0, y0, a, L, z.hw * 1.6, z.col, al);
    }
  }
  for (const u of LZ) {
    if (u.t < u.ch) {
      const p = u.t / u.ch,
        ex = u.x0 + Math.cos(u.a) * u.L,
        ey = u.y0 + Math.sin(u.a) * u.L;
      cx.save();
      cx.globalCompositeOperation = "lighter";
      cx.shadowColor = u.col;
      cx.shadowBlur = 12;
      cx.strokeStyle = u.col;
      cx.globalAlpha = 0.25 + 0.5 * p;
      cx.lineWidth = 1 + 4 * p;
      cx.setLineDash([12, 8]);
      cx.beginPath();
      cx.moveTo(u.x0, u.y0);
      cx.lineTo(ex, ey);
      cx.stroke();
      cx.setLineDash([]);
      const r = 8 + 26 * p,
        g = cx.createRadialGradient(u.x0, u.y0, 0, u.x0, u.y0, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.4, u.col);
      g.addColorStop(1, u.col + "00");
      cx.globalAlpha = 0.9;
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(u.x0, u.y0, r, 0, TAU);
      cx.fill();
      cx.restore();
    } else {
      const al = Math.max(
        0,
        Math.min(1, (u.t - u.ch) / 0.1 + 0.3, (u.ch + u.dur - u.t) / 0.3),
      );
      lzBeam(u.x0, u.y0, u.a, u.L, u.hw * 1.2, u.col, al);
    }
  }
}
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
    vx: Math.cos(a) * w.v * BS,
    vy: Math.sin(a) * w.v * BS,
    r: w.r,
    own: 1,
    dmg: w.dmg * mul * (crt ? w.cm : 1),
    life: w.life / BS,
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
    l0: w.life / BS,
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
      vx: Math.cos(a) * 380 * BS,
      vy: Math.sin(a) * 380 * BS,
      r: 5,
      own: 1,
      dmg: b.dmg * 0.35,
      life: 0.3 / BS,
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
      l0: 0.3 / BS,
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
export function ultRing() {
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * TAU;
    G.bl.push({
      x: G.pl.x,
      y: G.pl.y,
      vx: Math.cos(a) * 430 * BS,
      vy: Math.sin(a) * 430 * BS,
      r: 6,
      own: 1,
      dmg: 30,
      life: 1.3 / BS,
      pierce: 1,
      hit: [],
      ult: 1,
      kb: 350,
      lc: -1,
      col: "#ffe14a",
    });
  }
  G.shake = 14;
  burst(G.pl.x, G.pl.y, "#ffe14a", 40, 320, 3, 0.7);
}

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

ULTS[12] = (a) => {
  for (let k = 0; k < 20; k++)
    later(k * 0.04, () =>
      ub(Math.random() * TAU, 520, {
        dmg: 30,
        bn: 4,
        life: 2.4 / BS,
        r: 4,
      }),
    );
};

ULTS[13] = (a) => {
  const t = G.en
    .slice()
    .sort(
      (p, q) =>
        Math.hypot(p.x - G.pl.x, p.y - G.pl.y) - Math.hypot(q.x - G.pl.x, q.y - G.pl.y),
    )
    .slice(0, 10);
  t.forEach((e, i) =>
    later(i * 0.1, () => {
      if (e.hp <= 0) return;
      strikeFx(e);
      {
        const d0 = dm(
          e,
          130 * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) * (G.UM ? G.UM.dm : 1),
        );
        e.hp -= d0;
        e.hf = 1;
        chipHit(e, d0, ufl());
      }
      burst(e.x, e.y, "#ffe14a", 24, 280, 3, 0.5);
      G.shake = Math.max(G.shake, 8);
      if (e.hp <= 0) kill(e);
    }),
  );
};

ULTS[14] = (a, q) => {
  const d = LR(q),
    gid = G.time + Math.random();
  G.fxs.push({
    k: "w",
    x: G.pl.x,
    y: G.pl.y,
    r: 130,
    t: 0.4,
    max: 0.4,
    col: "#ffe14a",
  });
  for (let k = 0; k < 9; k++) {
    const t = (k / 9) * TAU,
      r = k ? 85 : 0,
      x = G.pl.x + Math.cos(a) * d + Math.cos(t) * r,
      y = G.pl.y + Math.sin(a) * d + Math.sin(t) * r;
    if (!blocked(x, y, 8))
      later(k * 0.06, () =>
        G.zones.push(
          thr(
            {
              k: "mine",
              x,
              y,
              r: 75,
              t: 16,
              max: 16,
              col: "#ffe14a",
              dmg: 90 * (G.UM ? G.UM.dm : 1),
              kb: 300 * (G.UM ? G.UM.kb : 1),
              arm: 0.4,
              ult: 1,
              grp: gid,
              ...ufl(),
            },
            G.pl.x,
            G.pl.y,
            0.3,
          ),
        ),
      );
  }
};

ULTS[15] = (a) => {
  for (let k = -1; k <= 1; k++)
    ub(a + k * 0.4, 520, {
      dmg: 90,
      r: 14,
      bm: 1,
      life: 1.6 / BS,
      l0: 1.6 / BS,
    });
};

ULN.push("反彈風暴", "雷暴", "地雷陣", "三連巨鏢");

G.UMANUAL = false;


ULN.push("絕對零度", "黑洞", "雷霆震懇", "天羅地網");

ULTS[16] = (a) => {
  G.fxs.push({
    k: "w",
    x: G.pl.x,
    y: G.pl.y,
    r: 300,
    t: 0.6,
    max: 0.6,
    col: "#ffe14a",
  });
  for (const e of G.en) {
    if (e.hp > 0 && Math.hypot(e.x - G.pl.x, e.y - G.pl.y) < 300) {
      if (!isB(e)) e.stn = 2;
      e.fr = 3;
      e.hp -= dm(e, 90 * dmM());
      e.hf = 1;
      if (e.hp <= 0) kill(e);
    }
  }
  G.shake = 10;
  flash("#ffe14a", 0.4, 0.35);
};

ULTS[17] = (a, q) => {
  const d = LR(q),
    x = G.pl.x + Math.cos(a) * d,
    y = G.pl.y + Math.sin(a) * d;
  spot(x, y, 220, 0.5, "#ffe14a");
  later(0.5, () => {
    G.zones.push({
      k: "gpull",
      x,
      y,
      r: 220,
      t: 5,
      max: 5,
      col: "#ffe14a",
      ult: 1,
      ...ufl(),
    });
    for (let k = 0; k < 6; k++)
      later(0.4 + 0.5 * k, () => {
        for (const e of G.en)
          if (e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 90) {
            {
              const d0 = dm(e, 10 * dmM() * (G.UM ? G.UM.dm : 1));
              e.hp -= d0;
              e.hf = 1;
              chipHit(e, d0, ufl());
            }
            if (e.hp <= 0) kill(e);
          }
      });
  });
};

ULTS[18] = (a) => {
  flash("#ffe14a", 0.35, 0.4);
  for (const e of G.en) {
    if (e.hp <= 0 || Math.hypot(e.x - G.pl.x, e.y - G.pl.y) > 520) continue;
    G.fxs.push({
      k: "l",
      x: e.x,
      y: e.y - 300,
      a: Math.PI / 2,
      len: 300,
      t: 0.25,
      max: 0.25,
      col: "#ffe14a",
    });
    if (!isB(e)) e.stn = 1.6;
    e.hp -= dm(e, 60 * dmM());
    e.hf = 1;
    if (e.hp <= 0) kill(e);
  }
  G.shake = 12;
};

ULTS[19] = (a) => {
  G.fxs.push({
    k: "w",
    x: G.pl.x,
    y: G.pl.y,
    r: 340,
    t: 0.5,
    max: 0.5,
    col: "#ffe14a",
  });
  for (const e of G.en) {
    if (e.hp <= 0 || Math.hypot(e.x - G.pl.x, e.y - G.pl.y) > 340) continue;
    if (!isB(e)) e.root = 3.5;
    e.fr = 3.5;
  }
};

ULTS[16] = (a) => {
  G.zones.push({
    k: "storm",
    x: G.pl.x,
    y: G.pl.y,
    r: 260,
    t: 5,
    max: 5,
    col: "#ffe14a",
  });
  flash("#ffe14a", 0.3, 0.3);
};

ULTS[18] = (a, q) => {
  const d = LR(q),
    x = G.pl.x + Math.cos(a) * d,
    y = G.pl.y + Math.sin(a) * d;
  spot(x, y, 130, 0.5, "#ffe14a");
  later(0.5, () =>
    G.zones.push({
      k: "cloud",
      x,
      y,
      r: 130,
      t: 7,
      max: 7,
      col: "#ffe14a",
      dm: G.UM ? G.UM.dm : 1,
      ...ufl(),
    }),
  );
};

ULTS[19] = (a, q) => {
  const d = LR(q),
    x = G.pl.x + Math.cos(a) * d,
    y = G.pl.y + Math.sin(a) * d;
  G.zones.push(
    thr(
      { k: "web", x, y, r: 160, t: 5, max: 5, col: "#ffe14a", ...ufl() },
      G.pl.x,
      G.pl.y,
      0.3,
    ),
  );
  flash("#ffe14a", 0.2, 0.2);
};

ULN[16] = "冰河期";

ULN[18] = "雷暴領域";

ULN.push("砲塔陣", "毒霧瀰漫", "旋風斬", "集束轟炸");

ULTS[20] = (a, q) => {
  const w = Object.assign({}, WP[G.pl.w], { c: "#ffe14a", r: 7 });
  const d = LR(q),
    [x, y] = turLand(G.pl.x + Math.cos(a) * d, G.pl.y + Math.sin(a) * d, 36, 30);
  G.zones.push(
    thr(
      {
        k: "tur",
        x,
        y,
        r: 28,
        t: 22,
        max: 22,
        hp: 300,
        mhp: 300,
        col: "#ffe14a",
        w,
        cd: 0.8,
        ang: a,
        rg: 420,
        fi: 2.5,
        big: 1,
        br: 42,
        gd: 140 * dmM() * (G.UM ? G.UM.dm : 1),
        ult: 1,
      },
      G.pl.x,
      G.pl.y,
      0.45,
    ),
  );
  G.fxs.push({
    k: "w",
    x: G.pl.x,
    y: G.pl.y,
    r: 90,
    t: 0.35,
    max: 0.35,
    col: "#ffe14a",
  });
};

ULTS[21] = (a, q) => {
  const d = LR(q),
    x = Math.max(20, Math.min(MW - 20, G.pl.x + Math.cos(a) * d)),
    y = Math.max(20, Math.min(MW - 20, G.pl.y + Math.sin(a) * d));
  G.zones.push(
    thr(
      {
        k: "tox",
        x,
        y,
        r: 190,
        t: 5,
        max: 5,
        col: "#ffe14a",
        dmg: 360 * (5 / 9) * dmM() * (G.UM ? G.UM.dm : 1),
        ult: 1,
        ...ufl(),
      },
      G.pl.x,
      G.pl.y,
      0.5,
    ),
  );
};

ULTS[22] = (a, q) => {
  const w = WP[G.pl.w];
  G.fxs.push({
    k: "c",
    x: G.pl.x,
    y: G.pl.y,
    r: 215,
    t: 0.45,
    max: 0.45,
    col: "#ffe14a",
    fp: 1,
  });
  later(0.45, () => {
    slashHit(G.pl.x, G.pl.y, 0, TAU, 215, 260 * dmM(), 900, "#ffe14a", w, 1);
    G.shake = Math.max(G.shake, 14);
  });
};

ULTS[23] = (a, q) => {
  for (let k = 0; k < 5; k++)
    later(k * 0.08, () =>
      ub(a + (k - 2) * 0.22, 520, {
        dmg: 70,
        r: 11,
        life: 0.5 / BS,
        cs: 12,
        pe: 0,
        kb: 200,
        col: "#ffe14a",
      }),
    );
};
}

