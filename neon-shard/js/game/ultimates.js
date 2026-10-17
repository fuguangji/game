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
export const ULTS = {
  0(a) {
    for (let k = 0; k < 12; k++)
      later(k * 0.05, () => ub(a, 720, { dmg: 40, r: 4, life: 0.9 / BULLET_SPEED_SCALE }));
  },
  1(a) {
    for (let n = 0; n < 3; n++)
      later(n * 0.25, () => {
        for (let k = 0; k < 16; k++)
          ub(
            a + (k / 15 - 0.5) * 1.1 + (Math.random() - 0.5) * 0.1,
            380 + Math.random() * 160,
            { dmg: 19, r: 4, life: 0.55 / BULLET_SPEED_SCALE, kb: 300, wd: 2 },
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
        life: 1.47 / BULLET_SPEED_SCALE,
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
            life: 0.5 / BULLET_SPEED_SCALE,
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
          life: 0.8 / BULLET_SPEED_SCALE,
          l0: 0.8 / BULLET_SPEED_SCALE,
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
          life: 2.2 / BULLET_SPEED_SCALE,
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
        life: 0.9 / BULLET_SPEED_SCALE,
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
export function ultRing() {
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * TAU;
    G.bl.push({
      x: G.pl.x,
      y: G.pl.y,
      vx: Math.cos(a) * 430 * BULLET_SPEED_SCALE,
      vy: Math.sin(a) * 430 * BULLET_SPEED_SCALE,
      r: 6,
      own: 1,
      dmg: 30,
      life: 1.3 / BULLET_SPEED_SCALE,
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
        life: 2.4 / BULLET_SPEED_SCALE,
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
      life: 1.6 / BULLET_SPEED_SCALE,
      l0: 1.6 / BULLET_SPEED_SCALE,
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
        life: 0.5 / BULLET_SPEED_SCALE,
        cs: 12,
        pe: 0,
        kb: 200,
        col: "#ffe14a",
      }),
    );
};
}

