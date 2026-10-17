/** game/boss-ai — Boss 行為決策：階段切換、招式選擇、移動、衝鋒、分身與節點 */
import { bossCatalog } from "../config/index.js";
import { G } from "../core/game-state.js";
import { T, TAU } from "../core/viewport.js";
import { EL_COL } from "../enemy-config.js";
import { blocked, burst, hitCell, hurt, mkEn, mv, ray } from "./battle.js";
import { beeWave, lat, pBomb, pFan, pHom, pRing, pSum, poison, portals, rocks, tiles } from "./boss-attacks.js";
import { beam } from "./boss-telegraph.js";
import { flash, phaseFx } from "./boss-visuals.js";
import { isB } from "./boss.js";
import { eb } from "./enemy-ai.js";
import { nav } from "./pathfinding.js";

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
export const dk = (c) => {
  const n = parseInt(c.slice(1), 16),
    r = (((n >> 16) & 255) * 0.4) | 0,
    g = (((n >> 8) & 255) * 0.4) | 0,
    b = ((n & 255) * 0.4) | 0;
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
};

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
  const pref = bossCatalog.get(i).preferredDistance,
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
    e.atk = (e.na = (e.na || 0) + 1) % bossCatalog.get(i).attackPatternCount;
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
