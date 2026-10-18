/** game/player-attacks — 玩家攻擊：開火、子彈建立、大招（SUPER）加成與施放 */
import { BULLET_SPEED_SCALE } from "../config/index.js";
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { MW, TAU } from "../core/viewport.js";
import { mouse } from "./battle.js";
import { isB, thr } from "./boss.js";
import { aimT, angD, explode, quickT } from "./physics.js";
import { AIMR, cone } from "./pickups.js";
import { UL } from "./progress.js";
import { ULTS, laserFire, slashHit, ultRing, zfl } from "./ultimates.js";
import { ALLWEAPON, WP } from "./weapons.js";
import { burst, ray, turLand } from "./world-helpers.js";

// 開火：檢查彈藥與冷卻，依武器產生子彈（含自動瞄準與散佈）
export function shoot(f, qk) {
  const w = WP[G.pl.w];
  if (fsm.state !== "play" || G.pl.sc > 0 || w.am < (w.laser ? 0.85 : 1)) return;
  w.am -= w.laser ? 0.85 : 1;
  G.pl.sc = w.cd;
  G.pl.lf = G.time;
  const tg = qk ? quickT() : aimT();
  bus.emit(GameEvents.PLAYER_SHOT, { autoAim: !!tg });
  const SB = G.pl.sb > 0 ? 1.3 : 1;
  G.pl.sb = 0;
  let ba = G.pl.aim;
  if (tg && !(w.mine || w.web || w.tur || w.tox || w.slash)) {
    const sp = w.v * BULLET_SPEED_SCALE,
      D = Math.hypot(tg.x - G.pl.x, tg.y - G.pl.y),
      t = D / sp;
    ba = Math.atan2(tg.y + tg.mvy * t - G.pl.y, tg.x + tg.mvx * t - G.pl.x);
  }
  const jit =
    (Math.random() * 2 - 1) *
    (cone() - (w.n1 === 1 ? w.sp / 2 : 0)) *
    (tg ? 0.4 : 1);
  G.pl.rc = Math.min(0.1, G.pl.rc + (w.rcg || 0));
  if (w.slash) {
    if (tg) ba = Math.atan2(tg.y - G.pl.y, tg.x - G.pl.x);
    slashHit(
      G.pl.x,
      G.pl.y,
      ba,
      w.sw,
      w.rg,
      w.dmg * (w.n1 || 1) * SB * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg),
      w.kb,
      w.c,
      w,
    );
    G.shake = Math.max(G.shake, 2);
    return;
  }
  if (w.mine || w.web || w.gren || w.tur || w.tox) {
    const W0 = ALLWEAPON.getWeapon()[w.id] || w,
      RGm = Math.max(0.5, (w.life || 1) / (W0.life || 1)),
      RG = 260 * RGm,
      N1 = Math.max(1, w.n1 || 1),
      XB = w.xb ? 1.25 : 1;
    if (tg) {
      const lt = w.mine ? 0.3 : w.gren ? 0.6 : w.tox ? 0.5 : w.tur ? 0.3 : 0,
        px = tg.x + (tg.mvx || 0) * lt,
        py = tg.y + (tg.mvy || 0) * lt;
      ba = Math.atan2(py - G.pl.y, px - G.pl.x);
      G.pl.q = Math.max(0, Math.min(1, Math.hypot(px - G.pl.x, py - G.pl.y) / RG));
    }
    const L =
        w.gren || w.tox || w.tur
          ? Math.max(0, G.pl.q * RG)
          : Math.max(0, Math.min(G.pl.q * RG, ray(G.pl.x, G.pl.y, ba, RG) - 12)),
      mx = G.pl.x + Math.cos(ba) * L,
      my = G.pl.y + Math.sin(ba) * L;
    if (w.gren) {
      const crt = w.cr && Math.random() < w.cr,
        gx = Math.max(20, Math.min(MW - 20, mx)),
        gy = Math.max(20, Math.min(MW - 20, my));
      G.zones.push(
        thr(
          {
            k: "gren",
            x: gx,
            y: gy,
            r: (w.ex || 70) * Math.sqrt((w.r || 6) / 6) * XB,
            t: 0.5,
            max: 0.5,
            col: crt ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              N1 *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) *
              (crt ? w.cm : 1),
            kb: w.kb,
            wd: w.wd,
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.45,
        ),
      );
      burst(
        G.pl.x + Math.cos(ba) * 20,
        G.pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.tox) {
      const crt = w.cr && Math.random() < w.cr,
        gx = Math.max(20, Math.min(MW - 20, mx)),
        gy = Math.max(20, Math.min(MW - 20, my));
      G.zones.push(
        thr(
          {
            k: "tox",
            x: gx,
            y: gy,
            r: 85 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 4,
            max: 4,
            wi: G.pl.w,
            col: crt ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              (4 / 6) *
              N1 *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) *
              (crt ? w.cm : 1),
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.45,
        ),
      );
      burst(
        G.pl.x + Math.cos(ba) * 20,
        G.pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.tur) {
      const ts = G.zones.filter((z) => z.k === "tur" && !z.ult);
      while (ts.length >= 2) {
        const o = ts.shift();
        o.t = 0;
        burst(o.x, o.y, o.col, 8, 120, 2, 0.3);
      }
      const [tx0, ty0] = turLand(mx, my, 18);
      G.zones.push(
        thr(
          {
            k: "tur",
            x: tx0,
            y: ty0,
            r: 14,
            t: 10,
            max: 10,
            hp: 40,
            mhp: 40,
            col: w.c,
            w: w,
            cd: 0.4,
            ang: ba,
            rg: 250 * RGm,
            fi: w.cd,
            dmul: SB * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg),
          },
          G.pl.x,
          G.pl.y,
          0.3,
        ),
      );
      burst(
        G.pl.x + Math.cos(ba) * 20,
        G.pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.web)
      G.zones.push(
        thr(
          {
            k: "web",
            x: mx,
            y: my,
            r: 70 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 7,
            max: 7,
            wi: G.pl.w,
            col: w.c,
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.28,
        ),
      );
    else {
      const crM = w.cr && Math.random() < w.cr;
      G.zones.push(
        thr(
          {
            k: "mine",
            x: mx,
            y: my,
            r: 70 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 14,
            max: 14,
            wi: G.pl.w,
            col: crM ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) *
              (crM ? w.cm : 1),
            kb: w.kb,
            wd: w.wd,
            arm: 0.6,
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.28,
        ),
      );
    }
    burst(mx, my, w.c, 8, 120, 2, 0.3);
    return;
  }
  if (w.laser) {
    laserFire(w, tg, SB);
    return;
  }
  for (let k = 0; k < w.n1; k++) {
    const crt = w.cr && Math.random() < w.cr,
      a =
        ba +
        jit +
        (w.n1 > 1
          ? (k / (w.n1 - 1) - 0.5) * w.sp
          : (Math.random() - 0.5) * w.sp),
      c = Math.cos(a),
      s = Math.sin(a);
    G.bl.push({
      x: G.pl.x + c * 20,
      y: G.pl.y + s * 20,
      vx: c * w.v * BULLET_SPEED_SCALE,
      vy: s * w.v * BULLET_SPEED_SCALE,
      r: crt ? w.r * 1.4 : w.r,
      own: 1,
      dmg:
        w.dmg * SB * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) * (crt ? w.cm : 1),
      life: w.life / BULLET_SPEED_SCALE,
      col: crt ? "#ffffff" : w.c,
      kb: w.kb,
      pe: w.pierce,
      hm: w.hm,
      pierce: w.pa,
      ex: w.ex,
      ch: w.ch,
      bn: w.bn,
      bm: w.bm,
      wi: G.pl.w,
      xb: w.xb,
      bu: w.bu,
      fr: w.fr,
      lk: w.lk,
      fz4: w.fz4,
      cg: w.cg,
      gp: w.gp,
      wd: w.wd,
      fl: w.fl,
      cs: w.cs,
      l0: w.life / BULLET_SPEED_SCALE,
      age: 0,
      lc: -1,
      hit: [],
    });
  }
  burst(
    G.pl.x + Math.cos(ba) * 22,
    G.pl.y + Math.sin(ba) * 22,
    w.c,
    3,
    120,
    1.8,
    0.2,
  );
  G.shake = Math.max(G.shake, w.n1 > 1 || w.kb > 400 ? 4 : 1);
}

// 功能：處理「ub」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ub(a, v, o) {
  const b = Object.assign(
    {
      x: G.pl.x + Math.cos(a) * 16,
      y: G.pl.y + Math.sin(a) * 16,
      vx: Math.cos(a) * v * BULLET_SPEED_SCALE,
      vy: Math.sin(a) * v * BULLET_SPEED_SCALE,
      r: 5,
      own: 1,
      dmg: 30,
      life: 1.2 / BULLET_SPEED_SCALE,
      col: "#ffe14a",
      kb: 300,
      pe: 1,
      ult: 1,
      hit: [],
      lc: -1,
    },
    o,
  );
  b.dmg *= 1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg;
  applyUM(b);
  G.bl.push(b);
}

// 功能：處理「ultMods」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ultMods() {
  const c = WP[G.pl.w],
    b = c && ALLWEAPON.getWeapon()[c.id];
  if (!b) return null;
  // 功能：計算兩個武器屬性之間的倍率；分母無效時回傳預設倍率。
  const g = (x, y) => (y > 0 ? x / y : 1),
    fl = (k) => (c[k] && !b[k] ? 1 : 0);
  return {
    dm: 1 + (g(c.dmg * (c.n1 || 1), b.dmg * (b.n1 || 1)) - 1) * 0.6,
    kb: g(c.kb, b.kb),
    wd: (c.wd || 0) - (b.wd || 0),
    r: g(c.r, b.r),
    v: g(c.v, b.v),
    life: g(c.life, b.life),
    xb: fl("xb"),
    ch: fl("ch"),
    bu: fl("bu"),
    fr: fl("fr"),
    fz4: fl("fz4"),
    lk: fl("lk"),
    hm: fl("hm"),
    bn: (c.bn || 0) - (b.bn || 0),
    cr: (c.cr || 0) - (b.cr || 0),
    cm: c.cm || 1,
  };
}

// 功能：處理「applyUM」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function applyUM(b) {
  if (!G.UM || b.um) return;
  b.um = 1;
  const m = G.UM;
  b.dmg *= m.dm;
  b.kb *= m.kb;
  if (m.wd > 0) b.wd = (b.wd === undefined ? 1 : b.wd) + m.wd;
  b.r *= m.r;
  b.vx *= m.v;
  b.vy *= m.v;
  b.life *= m.life;
  if (b.l0) b.l0 *= m.life;
  if (m.xb) b.xb = 1;
  if (m.ch) b.ch = 1;
  if (m.bu) b.bu = 1;
  if (m.fr) b.fr = 1;
  if (m.fz4) b.fz4 = 1;
  if (m.lk) b.lk = 1;
  if (m.hm) b.hm = 1;
  if (m.bn > 0) b.bn = (b.bn || 0) + m.bn;
  if (m.cr > 0 && Math.random() < m.cr) {
    b.dmg *= m.cm;
    b.col = "#ffffff";
    b.r *= 1.4;
  }
}

export const ULN = [
    "連珠",
    "轟炸",
    "貫穿光束",
    "彈幕",
    "烈焰環",
    "隕石",
    "飛彈群",
    "雙環爆",
    "雷射掃射",
    "雙向火網",
    "地毯轟炸",
    "穿透風暴",
  ],
  ULT_OLD = {
    0() {
      const a = G.pl.aim;
      for (let k = 0; k < 12; k++) ub(a + (k - 5.5) * 0.05, 680, { dmg: 30 });
    },
    1() {
      const a = G.pl.aim;
      for (let k = 0; k < 40; k++)
        ub(a + (Math.random() - 0.5) * 2, 420 + Math.random() * 180, {
          dmg: 22,
          life: 0.55 / BULLET_SPEED_SCALE,
          r: 4,
          kb: 260,
        });
    },
    2() {
      ub(G.pl.aim, 1500, {
        dmg: 220,
        r: 14,
        life: 0.6 / BULLET_SPEED_SCALE,
        pierce: 1,
        wd: 3,
        kb: 900,
      });
    },
    3() {
      const a = G.pl.aim;
      for (let k = 0; k < 36; k++)
        ub(a + k * 0.4, 330 + (k % 6) * 35, {
          dmg: 16,
          r: 3.5,
          life: 0.9 / BULLET_SPEED_SCALE,
        });
    },
    4() {
      for (let k = 0; k < 24; k++)
        ub((k / 24) * TAU, 220, {
          dmg: 25,
          r: 7,
          life: 0.9 / BULLET_SPEED_SCALE,
          l0: 0.9 / BULLET_SPEED_SCALE,
          kb: 120,
          fl: 1,
        });
    },
    5() {
      const t = G.en
        .slice()
        .sort(
          (p, q) =>
            Math.hypot(p.x - G.pl.x, p.y - G.pl.y) -
            Math.hypot(q.x - G.pl.x, q.y - G.pl.y),
        )
        .slice(0, 6);
      if (!t.length)
        for (let k = 0; k < 6; k++)
          t.push({
            x: G.pl.x + Math.cos(k) * 120,
            y: G.pl.y + Math.sin(k) * 120,
          });
      for (const e of t)
        explode({
          x: e.x,
          y: e.y,
          ex: 90,
          dmg: 70,
          kb: 500,
          wd: 3,
          col: "#b45cff",
        });
    },
    6() {
      for (let k = 0; k < 16; k++)
        ub(Math.random() * TAU, 380, {
          dmg: 28,
          hm: 1,
          life: 2 / BULLET_SPEED_SCALE,
          r: 4,
        });
    },
    7() {
      for (let k = 0; k < 20; k++) {
        ub((k / 20) * TAU, 300, { dmg: 25 });
        ub(((k + 0.5) / 20) * TAU, 450, { dmg: 25 });
      }
    },
    8() {
      const a = G.pl.aim;
      for (let k = 0; k < 5; k++)
        ub(a + (k - 2) * 0.16, 1300, { dmg: 60, life: 0.45 / BULLET_SPEED_SCALE, r: 3 });
    },
    9() {
      const a = G.pl.aim;
      for (let k = 0; k < 12; k++) {
        ub(a + (k - 5.5) * 0.09, 600, { dmg: 24 });
        ub(a + Math.PI + (k - 5.5) * 0.09, 600, { dmg: 24 });
      }
    },
    10() {
      const a = G.pl.aim,
        c = Math.cos(a),
        s = Math.sin(a),
        L = ray(G.pl.x, G.pl.y, a, 450);
      for (let k = 0; k < 8; k++) {
        const d = 50 + k * 45;
        if (d < L)
          explode({
            x: G.pl.x + c * d,
            y: G.pl.y + s * d,
            ex: 70,
            dmg: 55,
            kb: 350,
            wd: 2,
            col: "#ffd23a",
          });
      }
    },
    11() {
      for (let k = 0; k < 24; k++)
        ub((k / 24) * TAU, 450, {
          dmg: 35,
          r: 4,
          pierce: 1,
          wd: 2,
          life: 1.3 / BULLET_SPEED_SCALE,
        });
    },
  };

// 功能：處理「ultT」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ultT() {
  if (!G.AA) return null;
  const R = AIMR * (G.AA === 2 ? 3.4 : 2.6),
    ex = G.AA === 2 ? 0.7 : 0.35;
  let b = null,
    bs = 1e9;
  for (const e of G.en) {
    if (e.hp <= 0) continue;
    const D = Math.hypot(e.x - G.pl.x, e.y - G.pl.y);
    if (D > R * (isB(e) ? 1.3 : 1) + e.r) continue;
    const a = Math.atan2(e.y - G.pl.y, e.x - G.pl.x);
    if (
      angD(a, G.pl.aim) >
      Math.min(Math.atan2(e.r + 8, Math.max(D, 1)), 0.4) + ex
    )
      continue;
    const los = ray(G.pl.x, G.pl.y, a, D) >= D - e.r - 6,
      sc = D + (los ? 0 : 120) - (isB(e) ? 200 : 0);
    if (sc < bs) {
      bs = sc;
      b = e;
    }
  }
  return b;
}

// 施放 SUPER 大招：依目前武器查表執行，並清空蓄能
export function ult(ang, q) {
  if (fsm.state !== "play" || G.pl.ult < 100) return;
  G.UMANUAL = ang !== undefined;
  if (ang === undefined) {
    const t = ultT();
    if (t) {
      const lx = t.x + (t.mvx || 0) * 0.3,
        ly = t.y + (t.mvy || 0) * 0.3;
      ang = Math.atan2(ly - G.pl.y, lx - G.pl.x);
      G.pl.aim = ang;
      q = Math.max(0, Math.min(1, Math.hypot(lx - G.pl.x, ly - G.pl.y) / 330));
    }
  }
  G.pl.ult = 0;
  bus.emit(GameEvents.ULTIMATE_USED);
  G.UM = ultMods();
  const n0 = G.bl.length;
  (ULTS[WP[G.pl.w].id] || ultRing)(
    ang === undefined ? G.pl.aim : ang,
    q === undefined
      ? mouse.has
        ? Math.max(
            0,
            Math.min(
              1,
              Math.hypot(mouse.x / G.S + G.camx - G.pl.x, mouse.y / G.S + G.camy - G.pl.y) /
                330,
            ),
          )
        : 0.7
      : q,
  );
  for (let i = n0; i < G.bl.length; i++) if (G.bl[i].ult) applyUM(G.bl[i]);
  if (WP[G.pl.w].id !== 18) {
    if (WP[G.pl.w].id !== 18) {
      G.shake = 14;
      burst(G.pl.x, G.pl.y, "#ffe14a", 40, 320, 3, 0.7);
    }
  }
}
