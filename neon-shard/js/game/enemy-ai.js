/** game/enemy-ai — 敵人 AI：開火與每幀行為 */
import { G } from "../core/game-state.js";
import { N, T, TAU } from "../core/viewport.js";
import { ELITE, EL_COL } from "../enemy-config.js";
import { blocked, burst, cell, hitCell, hurt, mkEn, mv, ray, solidAt } from "./battle.js";
import { LEAD, bLead, bossAI3, chg, cloneAI, flk, isB, leadAt, nodeAI, thr } from "./boss.js";
import { nav } from "./pathfinding.js";
import { applyStatus } from "./status-effects.js";
import { BULLET_SPEED_SCALE, ENEMY_SPEED_SCALE, attackCooldownOf, bulletCatalog, enemyCatalog, preferredDistanceOf, recoveryTimeOf, telegraphDurationOf } from "../config/index.js";

// 功能：處理「eb」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
/** 依子彈設定，在 (x, y) 朝 angle 方向發射一顆敵方子彈；color 省略時用設定中的顏色 */
export function spawnEnemyBullet(x, y, angle, def, color) {
  G.bl.push({
    eff: def.effect,
    st: def.status,
    hm2: def.isHoming,
    x,
    y,
    vx: Math.cos(angle) * def.speed * BULLET_SPEED_SCALE,
    vy: Math.sin(angle) * def.speed * BULLET_SPEED_SCALE,
    r: def.radius,
    own: 0,
    dmg: def.damage,
    life: def.lifetimeScalesWithSpeedScale ? def.lifetimeSeconds / BULLET_SPEED_SCALE : def.lifetimeSeconds,
    col: color ?? def.color,
  });
}

/** 從發射者 e 的邊緣射出具名子彈（見 config/bullet-catalog.js） */
export function fireBullet(e, angle, bulletId) {
  const def = bulletCatalog.get(bulletId);
  spawnEnemyBullet(e.x + Math.cos(angle) * e.r, e.y + Math.sin(angle) * e.r, angle, def, def.color ?? e.col); // 設定有指定顏色就用設定的
}

/** 臨時組合的敵方子彈（Boss 的速度、傷害會隨階段變動）；eff 為 BulletEffect */
export function eb(e, a, sp, dmg, eff) {
  spawnEnemyBullet(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, a, bulletCatalog.custom({ speed: sp, damage: dmg, effect: eff }), e.col);
}
// 功能：更新「updEW」所管理的遊戲狀態。
export function updEW(dt) {
  for (let n = G.ewl.length - 1; n >= 0; n--) {
    const w = G.ewl[n],
      x = (w.i + 0.5) * T,
      y = (w.j + 0.5) * T;
    w.life -= dt;
    if (G.grid[w.j * N + w.i] <= 0) {
      G.zones.push({
        k: "bomb",
        x,
        y,
        r: 45,
        t: 0.4,
        max: 0.4,
        col: EL_COL,
        dmg: 10,
      });
      burst(x, y, EL_COL, 10, 160, 2, 0.4);
      G.ewl.splice(n, 1);
      continue;
    }
    if (w.life <= 0) {
      G.grid[w.j * N + w.i] = 0;
      burst(x, y, EL_COL, 8, 120, 2, 0.4);
      G.ewl.splice(n, 1);
      continue;
    }
    w.nt -= dt;
    if (w.nt <= 0) {
      w.nt = 2.5;
      const dx = w.cx - x,
        dy = w.cy - y;
      let ni = w.i,
        nj = w.j;
      if (Math.abs(dx) > Math.abs(dy)) ni += Math.sign(dx);
      else nj += Math.sign(dy);
      const nx = (ni + 0.5) * T,
        ny = (nj + 0.5) * T;
      if (
        (ni !== w.i || nj !== w.j) &&
        Math.hypot(dx, dy) > T * 1.5 &&
        cell(ni, nj) === 0 &&
        Math.hypot(nx - G.pl.x, ny - G.pl.y) > 40 &&
        !G.en.some((q) => Math.hypot(q.x - nx, q.y - ny) < q.r + T * 0.5)
      ) {
        G.grid[nj * N + ni] = G.grid[w.j * N + w.i];
        G.grid[w.j * N + w.i] = 0;
        w.i = ni;
        w.j = nj;
      }
    }
    w.st -= dt;
    if (w.st <= 0) {
      w.st = 3;
      const a = Math.atan2(G.pl.y - y, G.pl.x - x),
        d = Math.hypot(G.pl.x - x, G.pl.y - y),
        sx = x + Math.cos(a) * T * 0.8,
        sy = y + Math.sin(a) * T * 0.8;
      if (d < 520 && !solidAt(sx, sy) && ray(sx, sy, a, d) >= d - T - 6)
        spawnEnemyBullet(sx, sy, a, bulletCatalog.get("WALL_TURRET_SHOT"));
    }
  }
  for (let n = G.egh.length - 1; n >= 0; n--) {
    const g = G.egh[n];
    g.t -= dt;
    if (!g.fd && g.t <= 0.4) {
      g.fd = 1;
      const a = Math.atan2(G.pl.y - g.y, G.pl.x - g.x);
      spawnEnemyBullet(g.x + Math.cos(a) * 13, g.y + Math.sin(a) * 13, a, bulletCatalog.get("GHOST_SHOT"), g.col);
      burst(g.x, g.y, g.col, 6, 150, 2, 0.3);
    }
    if (g.t <= 0) G.egh.splice(n, 1);
  }
}
// 功能：處理「elzHit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function elzHit(e, dmg) {
  const c = Math.cos(e.lza),
    s = Math.sin(e.lza),
    dx = G.pl.x - e.x,
    dy = G.pl.y - e.y,
    u = dx * c + dy * s;
  if (u > 0 && u < e.lzL && Math.abs(-dx * s + dy * c) < G.pl.r + 10) hurt(dmg);
}
// 功能：處理「lzEnd」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function lzEnd(e, n) {
  const c = Math.cos(e.lza),
    s = Math.sin(e.lza);
  hitCell(
    Math.floor((e.x + c * (e.lzL + 4)) / T),
    Math.floor((e.y + s * (e.lzL + 4)) / T),
  );
  if (n > 1)
    hitCell(
      Math.floor((e.x + c * (e.lzL + 4 + T)) / T),
      Math.floor((e.y + s * (e.lzL + 4 + T)) / T),
    );
}
// 敵人開火（依種類發射子彈、投放地面區域或召喚）
export function fire(e) {
  const t = e.t;
  e.rec = recoveryTimeOf(t) || 0.6;
  e.cd =
    Math.max(1, ((e.el && ELITE[t].cd) || attackCooldownOf(t)) - 0.05 * G.wave) +
    Math.random() * 0.6;
  if (t === 1) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      fireBullet(e, e.aim, "SNIPER_ELITE_SHOT");
      if (e.shc % 3 === 0) {
        const bb = G.bl[G.bl.length - 1];
        bb.pw = 1;
        bb.col = EL_COL;
        bb.r = 6.5;
      }
    } else fireBullet(e, e.aim, "SNIPER_SHOT");
  } else if (t === 2) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      if (e.shc % 2 === 0) {
        for (let k = -3; k <= 3; k++) fireBullet(e, e.aim + k * 0.1, "SPREAD_ELITE_PELLET");
        e.dsc = 0.3;
        e.dsa = e.aim;
        G.fxs.push({
          k: "w",
          x: e.x,
          y: e.y,
          r: 40,
          t: 0.3,
          max: 0.3,
          col: EL_COL,
        });
      } else for (let k = -3; k <= 3; k++) fireBullet(e, e.aim + k * 0.2, "SPREAD_ELITE_PELLET");
    } else for (let k = -2; k <= 2; k++) fireBullet(e, e.aim + k * 0.22, "SPREAD_PELLET");
  } else if (t === 3) {
    if (e.el) {
      const nb = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < nb; k++) {
        const a = Math.random() * TAU,
          o = k ? 30 + Math.random() * 50 : 0,
          d = 0.55 + Math.random() * 0.25;
        G.zones.push(
          thr(
            {
              k: "bomb",
              x: e.tx + Math.cos(a) * o,
              y: e.ty + Math.sin(a) * o,
              r: 70,
              t: d + 0.45,
              max: d + 0.45,
              col: e.col,
              dmg: 30,
              bnc: 1,
            },
            e.x,
            e.y,
            d,
          ),
        );
      }
    } else
      G.zones.push(
        thr(
          {
            k: "bomb",
            x: e.tx,
            y: e.ty,
            r: 64,
            t: 1.1,
            max: 1.1,
            col: e.col,
            dmg: 25,
          },
          e.x,
          e.y,
          0.65,
        ),
      );
  } else if (t === 4) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      fireBullet(e, e.aim, "SLOW_ELITE_ORB");
      if (e.shc % 4 === 0) {
        const bb = G.bl[G.bl.length - 1];
        bb.efz = 1;
        bb.col = "#bfefff";
        bb.r = 7.5;
      }
    } else fireBullet(e, e.aim, "SLOW_ORB");
  } else if (t === 5)
    G.zones.push(
      e.el
        ? {
            k: "pull",
            x: e.tx,
            y: e.ty,
            r: 160,
            t: 3,
            max: 3,
            col: e.col,
            el: 1,
            dps: 4,
          }
        : {
            k: "pull",
            x: e.tx,
            y: e.ty,
            r: 130,
            t: 2.5,
            max: 2.5,
            col: e.col,
          },
    );
  else if (t === 6) {
    const E = e.el,
      nn = E ? 3 : 2;
    for (let k = 0; k < nn; k++)
      if (G.en.length < (E ? 45 : 40)) {
        const m = mkEn(0, e.x + (k - (nn - 1) / 2) * 40, e.y);
        if (blocked(m.x, m.y, m.r)) continue;
        m.r = E ? 10 : 9;
        m.hp = m.mhp = E ? 18 : 12;
        m.sc = 30;
        m.sp *= E ? 1.4 : 1.3;
        if (E) {
          m.sm = 1;
          m.inv = 1.6;
        }
        G.en.push(m);
      }
    if (E)
      G.fxs.push({
        k: "w",
        x: e.x,
        y: e.y,
        r: 70,
        t: 0.5,
        max: 0.5,
        col: EL_COL,
      });
  } else if (t === 7 && e.el) {
    e.lz = 0.9;
    e.lza = e.aim;
    e.lzT = 0.3;
    e.lzL = ray(e.x, e.y, e.aim, 750);
    elzHit(e, 32);
    lzEnd(e, Math.random() < 0.5 ? 2 : 1);
    {
      const c = Math.cos(e.aim),
        s = Math.sin(e.aim);
      for (let q = 0; q < e.lzL; q += 10)
        burst(e.x + c * q, e.y + s * q, e.col, 2, 40, 3, 0.3);
    }
    G.shake = Math.max(G.shake, 6);
  } else if (t === 7) {
    const L = ray(e.x, e.y, e.aim, 700),
      c = Math.cos(e.aim),
      s = Math.sin(e.aim),
      dx = G.pl.x - e.x,
      dy = G.pl.y - e.y,
      u = dx * c + dy * s;
    for (let q = 0; q < L; q += 10)
      burst(e.x + c * q, e.y + s * q, e.col, 2, 40, 3, 0.3);
    if (u > 0 && u < L && Math.abs(-dx * s + dy * c) < G.pl.r + 8) hurt(25);
    hitCell(
      Math.floor((e.x + c * (L + 4)) / T),
      Math.floor((e.y + s * (L + 4)) / T),
    );
    G.shake = Math.max(G.shake, 5);
  } else if (t === 27) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      for (let k = -1; k <= 1; k++) {
        fireBullet(e, e.aim + k * 0.3, "TRACKER_ORB_HEAVY");
        const bb = G.bl[G.bl.length - 1];
        bb.hr = 2.2;
        bb.acc = 1;
        if (k === 0 && e.shc % 3 === 0) {
          bb.spl = 1;
          bb.col = EL_COL;
          bb.r = 6.5;
        }
      }
    } else {
      fireBullet(e, e.aim - 0.25, "TRACKER_ORB_LIGHT");
      fireBullet(e, e.aim + 0.25, "TRACKER_ORB_LIGHT");
    }
  } else if (t === 28) {
    let h = 0;
    for (const o of G.en)
      if (
        o !== e &&
        o.hp > 0 &&
        o.hp < o.mhp &&
        Math.hypot(o.x - e.x, o.y - e.y) < (e.el ? 220 : 180)
      ) {
        o.hp = Math.min(o.mhp, o.hp + o.mhp * (e.el ? 0.45 : 0.35));
        burst(o.x, o.y, "#6dffb0", 10, 120, 2, 0.5);
        h = 1;
      }
    G.fxs.push({
      k: "w",
      x: e.x,
      y: e.y,
      r: e.el ? 220 : 180,
      t: 0.5,
      max: 0.5,
      col: "#6dffb0",
    });
    if (!h) e.cd = e.el ? 1 : 1.2;
    if (e.el && h && Math.hypot(G.pl.x - e.x, G.pl.y - e.y) < 220) {
      applyStatus(G.pl, "vuln", { duration: 3 });
      const dd = Math.hypot(G.pl.x - e.x, G.pl.y - e.y);
      if (dd < 120 && G.pl.dashT <= 0) {
        const a = Math.atan2(G.pl.y - e.y, G.pl.x - e.x);
        G.pl.pvx += Math.cos(a) * 170;
        G.pl.pvy += Math.sin(a) * 170;
      }
    }
  } else if (t === 29) {
    const E = e.el,
      nt = E ? (G.wave > 14 ? 4 : 3) : 2 + (G.wave > 14 ? 1 : 0);
    for (let k = 0; k < nt; k++) {
      const ax = Math.random() * TAU,
        o = k ? Math.random() * (E ? 100 : 80) : 0,
        z0 = {
          k: "slowz",
          x: e.tx + Math.cos(ax) * o,
          y: e.ty + Math.sin(ax) * o,
          r: E ? 70 : 60,
          t: E ? 8 : 7,
          max: E ? 8 : 7,
          col: e.col,
        };
      if (E && k === 1) {
        z0.trg = 1;
        z0.col = "#ff8a3a";
      } else if (E && k === 2) {
        z0.trg = 2;
        z0.col = "#4de1ff";
      }
      G.zones.push(thr(z0, e.x, e.y, 0.5));
    }
  } else if (t === 10) {
    if (e.el) {
      const a0 = G.time * 1.3;
      for (let k = 0; k < 12; k++) fireBullet(e, a0 + (k * Math.PI) / 6, "RING_ELITE_HEAVY_PELLET");
      for (let k = 0; k < 12; k++) {
        fireBullet(e, a0 + Math.PI / 12 + (k * Math.PI) / 6, "RING_ELITE_FAST_PELLET");
        G.bl[G.bl.length - 1].col = "#ffc0e8";
      }
    } else {
      for (let k = 0; k < 8; k++) fireBullet(e, G.time + (k / 8) * TAU, "RING_PELLET");
    }
  } else if (t === 11) {
    const E = e.el;
    if (E) G.egh.push({ x: e.x, y: e.y, t: 0.7, max: 0.7, col: e.col });
    e.x = e.tx;
    e.y = e.ty;
    {
      const P = leadAt(
        e,
        bulletCatalog.get(E ? "BLINK_BURST_ELITE_PELLET" : "BLINK_BURST_PELLET").speed * BULLET_SPEED_SCALE,
        0,
        Math.min(0.9, 0.4 + G.wave * 0.035) * 0.8,
      );
      e.aim = Math.atan2(P[1] - e.y, P[0] - e.x);
    }
    if (E) {
      for (let k = 0; k < 4; k++) fireBullet(e, e.aim + (k - 1.5) * 0.11, "BLINK_BURST_ELITE_PELLET");
    } else for (let k = -1; k <= 1; k++) fireBullet(e, e.aim + k * 0.12, "BLINK_BURST_PELLET");
  } else if (t === 13 && e.el) {
    const g1 = (Math.random() * 5) | 0,
      g2 = Math.random() < 0.5 ? (g1 + 2) % 5 : -1;
    for (let k = 0; k < 5; k++) {
      const a = Math.random() * TAU,
        r = Math.random() * 90,
        tt = 1.1 + k * 0.18;
      G.zones.push(
        thr(
          {
            k: "bomb",
            x: e.tx + Math.cos(a) * r,
            y: e.ty + Math.sin(a) * r,
            r: 55,
            t: tt,
            max: tt,
            col: e.col,
            dmg: 22,
            gd: k === g1 || k === g2 ? 1 : 0,
          },
          e.x,
          e.y,
          0.7 + k * 0.1,
        ),
      );
    }
  } else if (t === 13) {
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * TAU,
        r = Math.random() * 70;
      G.zones.push(
        thr(
          {
            k: "bomb",
            x: e.tx + Math.cos(a) * r,
            y: e.ty + Math.sin(a) * r,
            r: 50,
            t: 1.3 + k * 0.2,
            max: 1.3 + k * 0.2,
            col: e.col,
            dmg: 18,
          },
          e.x,
          e.y,
          1 + k * 0.1,
        ),
      );
    }
  } else if (t === 9) {
    const E = e.el,
      n9 = E ? 10 : 8,
      r9 = E ? 90 : 75;
    for (let k = 0; k < n9; k++) {
      const a = (k / n9) * TAU,
        x = e.tx + Math.cos(a) * r9,
        y = e.ty + Math.sin(a) * r9,
        i = Math.floor(x / T),
        j = Math.floor(y / T);
      if (cell(i, j) === 0 && Math.hypot(x - G.pl.x, y - G.pl.y) > 35) {
        G.grid[j * N + i] = E ? 7 : 3;
        if (E)
          G.ewl.push({
            i,
            j,
            cx: e.tx,
            cy: e.ty,
            nt: 2 + Math.random(),
            st: 1.5 + Math.random() * 2,
            life: 14,
          });
        burst(
          (i + 0.5) * T,
          (j + 0.5) * T,
          E ? EL_COL : "#ffd23a",
          8,
          100,
          2,
          0.4,
        );
      }
    }
  } else {
    fireDeclared(e); // 沒有專屬程式的敵人：照 enemy-catalog.js 的 attack 欄位開火
  }
  burst(e.x, e.y, e.col, 6, 150, 2, 0.3);
}

/**
 * 宣告式攻擊：照 enemy-catalog.js 該敵人的 attack 欄位發射子彈，新增普通射手不必再寫程式。
 *   { bullet }                        朝玩家一發
 *   { bullet, count: 3, spread: 0.5 } 3 發扇形，整個扇形展開 0.5 弧度
 *   { bullet, ring: 12 }              一圈 12 發
 */
function fireDeclared(e) {
  const spec = enemyCatalog.find(e.t)?.attack;
  if (!spec) return;
  if (spec.ring) {
    for (let k = 0; k < spec.ring; k++) fireBullet(e, G.time + (k / spec.ring) * TAU, spec.bullet);
    return;
  }
  for (let k = 0; k < spec.count; k++) {
    const offset = spec.count > 1 ? (k / (spec.count - 1) - 0.5) * spec.spread : 0;
    fireBullet(e, e.aim + offset, spec.bullet);
  }
}
// 每幀更新單一敵人：移動、預警、開火等 AI
export function updEn(e, dt) {
  const dx = G.pl.x - e.x,
    dy = G.pl.y - e.y,
    d = Math.hypot(dx, dy) || 1,
    a = Math.atan2(dy, dx);
  e.ang = a;
  e.hf = Math.max(0, e.hf - dt * 6);
  e.cc -= dt;
  if (e.bo > 0) e.bo -= dt;
  if (e.lz > 0) {
    e.lz -= dt;
    let df = Math.atan2(G.pl.y - e.y, G.pl.x - e.x) - e.lza;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    e.lza += Math.max(-0.6 * dt, Math.min(0.6 * dt, df));
    e.lzL = ray(e.x, e.y, e.lza, 750);
    e.lzT -= dt;
    if (e.lzT <= 0) {
      e.lzT += 0.3;
      elzHit(e, 8);
      lzEnd(e, 1);
    }
    if (Math.random() < 0.7) {
      const q = Math.random() * e.lzL;
      burst(
        e.x + Math.cos(e.lza) * q,
        e.y + Math.sin(e.lza) * q,
        e.col,
        1,
        40,
        3,
        0.25,
      );
    }
    if (e.lz <= 0) {
      const c = Math.cos(e.lza),
        s = Math.sin(e.lza);
      for (let q = 45; q < e.lzL; q += 45)
        G.zones.push({
          k: "flame",
          x: e.x + c * q,
          y: e.y + s * q,
          r: 16,
          t: 1.5,
          max: 1.5,
          col: "#ff7a1a",
          dps: 10,
        });
    }
  }
  if (e.dsc > 0) {
    e.dsc -= dt;
    if (e.dsc <= 0) {
      for (let k = -3; k <= 3; k++)
        (fireBullet(e, e.dsa + k * 0.26, "SPREAD_ELITE_PELLET"), (G.bl[G.bl.length - 1].col = EL_COL));
      burst(e.x, e.y, EL_COL, 10, 160, 2, 0.35);
    }
  }
  if (e.rec > 0) {
    e.rec -= dt;
    return;
  }
  if (e.un > 0) {
    e.un -= dt;
    mv(e, Math.cos(e.ua) * e.sp * dt, Math.sin(e.ua) * e.sp * dt);
    return;
  }
  if (e.t === 0 || e.t === 12) {
    const na = nav(e, flk(e, a, d), d),
      sp = e.sp + (e.bo > 0 ? 40 * ENEMY_SPEED_SCALE : 0);
    if (e.el && e.t === 0) {
      e.ft = (e.ft || 0) - dt;
      if (e.ft <= 0) {
        e.ft = 0.1;
        G.zones.push({
          k: "flame",
          x: e.x,
          y: e.y,
          r: 15,
          t: 0.6,
          max: 0.6,
          col: "#ff7a1a",
          dps: 10,
        });
      }
    }
    if (mv(e, Math.cos(na) * sp * dt, Math.sin(na) * sp * dt)) {
      e.ramT += dt;
      if (e.ramT > (e.el && e.t === 0 ? 0.3 : 0.4)) {
        e.ramT = 0;
        const px = e.x + Math.cos(a) * (e.r + 6),
          py = e.y + Math.sin(a) * (e.r + 6);
        hitCell(Math.floor(px / T), Math.floor(py / T));
      }
    } else e.ramT = 0;
    if (d < e.r + G.pl.r + 2 && e.cc <= 0 && G.pl.dashT <= 0) {
      hurt(
        e.t === 12
          ? (e.el ? [20, 14, 9] : [14, 10, 7])[e.gen || 0]
          : e.el
            ? 22
            : 14,
      );
      e.cc = e.el && e.t === 0 ? 0.55 : 0.7;
      if (e.el && e.t === 0) e.bo = 0.8;
    }
  } else if (isB(e)) bossAI3(e, dt, d, bLead(e, a));
  else if (e.t === 30) cloneAI(e, dt);
  else if (e.t === 31) nodeAI(e, dt);
  else if (e.t === 26) {
    const na = nav(e, a, d);
    mv(e, Math.cos(na) * e.sp * dt, Math.sin(na) * e.sp * dt);
    if (d < e.r + G.pl.r + (e.el ? 30 : 26)) {
      G.zones.push({
        k: "bomb",
        x: e.x,
        y: e.y,
        r: e.el ? 95 : 75,
        t: e.el ? 0.5 : 0.45,
        max: e.el ? 0.5 : 0.45,
        col: e.col,
        dmg: e.el ? 38 : 28,
      });
      if (e.el) {
        const ph = Math.random() * TAU;
        for (let q = 0; q < 2; q++) {
          const aa = ph + q * Math.PI;
          G.zones.push({
            k: "bomb",
            x: e.x + Math.cos(aa) * 60,
            y: e.y + Math.sin(aa) * 60,
            r: 40,
            t: 0.7,
            max: 0.7,
            col: e.col,
            dmg: 15,
          });
        }
      }
      burst(e.x, e.y, e.col, 20, 260, 3, 0.5);
      e.hp = 0;
    }
  } else if (e.t === 8) chg(e, dt, d, a);
  else if (e.tele > 0) {
    e.tele -= dt;
    if (e.tele <= 0) fire(e);
  } else {
    const los = ray(e.x, e.y, a, d) >= d - 6,
      pref = (e.el && ELITE[e.t].pref) || preferredDistanceOf(e.t) || 210,
      m = !los ? 1 : d < pref - 40 ? -1 : d > pref + 40 ? 1 : 0,
      na = m > 0 ? nav(e, a, d) : a,
      k = los ? 1 : 0;
    let vx = Math.cos(na) * m * e.sp - (dy / d) * e.st * e.sp * 0.5 * k,
      vy = Math.sin(na) * m * e.sp + (dx / d) * e.st * e.sp * 0.5 * k;
    if (mv(e, vx * dt, vy * dt) && Math.random() < 0.02) e.st *= -1;
    e.cd -= dt;
    if (e.cd <= 0 && d < 560 && los) {
      e.tele = (e.el && ELITE[e.t].tl) || telegraphDurationOf(e.t) || 0.45;
      let tx = G.pl.x,
        ty = G.pl.y;
      {
        const ld = (e.el && ELITE[e.t].lead) || LEAD[e.t];
        if (ld) {
          const P = leadAt(
            e,
            ld[0] < 1e4 ? ld[0] * BULLET_SPEED_SCALE : ld[0],
            ld[1] === null ? e.tele : ld[1],
            Math.min(e.el ? 0.97 : 0.9, 0.4 + G.wave * 0.035 + (e.el ? 0.2 : 0)) *
              ld[2],
          );
          tx = P[0];
          ty = P[1];
        }
      }
      e.tx = tx;
      e.ty = ty;
      e.aim = Math.atan2(ty - e.y, tx - e.x);
      if (e.t === 6 || e.t === 10 || e.t === 27 || e.t === 28) {
        e.tx = e.x;
        e.ty = e.y;
      }
      if (e.t === 11) {
        e.tx = e.x;
        e.ty = e.y;
        for (let q = 0; q < (e.el ? 15 : 12); q++) {
          const aa = Math.random() * TAU,
            RR = e.el ? 200 : 220,
            x = G.pl.x + Math.cos(aa) * RR,
            y = G.pl.y + Math.sin(aa) * RR;
          if (!blocked(x, y, 14)) {
            e.tx = x;
            e.ty = y;
            break;
          }
        }
      }
    }
  }
}
