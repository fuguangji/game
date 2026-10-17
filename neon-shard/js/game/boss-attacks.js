/** game/boss-attacks — Boss 的攻擊招式：彈幕、炸彈、地磚、落石、蜂群、傳送門、毒區、射線等 */
import { bulletCatalog } from "../config/index.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { N, T, TAU } from "../core/viewport.js";
import { blocked, burst, hurt, mkEn } from "./battle.js";
import { flash, slowmo } from "./boss-visuals.js";
import { isB, thr } from "./boss.js";
import { eb, spawnEnemyBullet } from "./enemy-ai.js";
import { explode } from "./physics.js";
import { kill } from "./simulation.js";
import { dmM, ftxt, later, zig } from "./ultimates.js";

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

// 功能：處理「pRing」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export const pRing = (e, n, sp, d, o) => {
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
export const bInv = (e) => {
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
    spawnEnemyBullet(x, y, a, bulletCatalog.get("BOSS_ROCK"));
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
