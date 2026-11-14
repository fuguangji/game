/** game/enemy-death — 敵人死亡：得分、掉落、分裂與特效 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { EL_COL } from "../enemy-config.js";
import { blocked, burst, drop, mkEn } from "./battle.js";
import { bossDeath, flash, isB } from "./boss.js";
import { rollChip } from "./chips.js";
import { coin, cur, vacAll } from "./pickups.js";
import { ST, UL } from "./progress.js";

// 敵人死亡：加分、掉落、特效
export function kill(e) {
  if (e.dk) return;
  e.dk = 1;
  bus.emit(GameEvents.ENEMY_KILLED, { enemy: e });
  if (G.CHR.kh) G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + G.CHR.kh);
  if (isB(e)) {
    G.BK2 = 1;
    for (const c of G.en) if (c.t === 30 || c.t === 31 || c.bee) c.hp = 0;
    G.zones = G.zones.filter((z) => z.k !== "portal" && z.k !== "slowz");
    for (let k = 0; k < 8; k++) cur("coin", e.x, e.y, 4);
    for (let k = 0; k < 3; k++) cur("core", e.x, e.y, 1);
    for (let k = 0; k < 5; k++) cur("shard", e.x, e.y, 2);
    if (Math.random() < 0.22) cur("chip", e.x, e.y, rollChip(1));
    bossDeath(e);
    G.shake = 20;
    burst(e.x, e.y, e.col, 90, 420, 6, 1);
    flash("#ffffff", 0.7, 0.8);
    G.fxs.push(
      { k: "w", x: e.x, y: e.y, r: 600, t: 0.9, max: 0.9, col: e.col },
      {
        k: "w",
        x: e.x,
        y: e.y,
        r: 380,
        t: 0.6,
        max: 0.6,
        col: "#ffffff",
      },
    );
  }
  if (e.t === 12 && (e.gen || 0) < 2) {
    const g = (e.gen || 0) + 1,
      L = e.el ? 3 : 2,
      ph = Math.random() * TAU;
    for (let k = 0; k < L; k++) {
      const aa = e.el ? ph + (k / L) * TAU : k ? 0 : Math.PI,
        m = mkEn(
          12,
          e.x + (e.el ? Math.cos(aa) * 18 : k ? 16 : -16),
          e.y + (e.el ? Math.sin(aa) * 18 : 0),
        );
      m.gen = g;
      m.r = (e.el ? [20, 12, 8] : [20, 13, 9])[g] * (e.el ? 1.2 : 1);
      m.hp = m.mhp = e.mhp * (e.el ? [0, 0.3, 0.35] : [0, 0.4, 0.45])[g];
      m.sc = [300, 120, 50][g];
      m.sp *= 1 + (e.el ? 0.35 : 0.3) * g;
      if (e.el) {
        m.el = 1;
        m.m *= 1.6;
        m.kx = Math.cos(aa) * 220;
        m.ky = Math.sin(aa) * 220;
      } else {
        m.kx = (k ? 1 : -1) * 220;
        m.ky = 0;
      }
      m.rec = 0.25;
      m.inv = 0.4;
      if (!blocked(m.x, m.y, m.r)) G.pendEn.push(m);
    }
    burst(e.x, e.y, e.col, 18, 220, 3, 0.4);
    if (e.el) {
      G.fxs.push({
        k: "w",
        x: e.x,
        y: e.y,
        r: 130,
        t: 0.35,
        max: 0.35,
        col: EL_COL,
      });
      burst(e.x, e.y, EL_COL, 22, 260, 3, 0.45);
      const dx = G.pl.x - e.x,
        dy = G.pl.y - e.y,
        dd = Math.hypot(dx, dy) || 1;
      if (dd < 130 && G.pl.dashT <= 0) {
        const v = 170 * (1 - dd / 130) + 40;
        G.pl.pvx += (dx / dd) * v;
        G.pl.pvy += (dy / dd) * v;
      }
    }
  }
  G.score += e.sc;
  G.pts += Math.round(e.sc / 8);
  burst(e.x, e.y, e.col, 24, 280, 3, 0.7);
  if (e.el) {
    const sm = (e.gen || 0) > 0;
    burst(e.x, e.y, EL_COL, sm ? 10 : 50, sm ? 220 : 380, sm ? 2.5 : 4.5, 0.8);
    if (!sm) {
      burst(e.x, e.y, "#ffffff", 14, 260, 2.5, 0.5);
      G.fxs.push(
        {
          k: "w",
          x: e.x,
          y: e.y,
          r: 230,
          t: 0.55,
          max: 0.55,
          col: EL_COL,
        },
        {
          k: "w",
          x: e.x,
          y: e.y,
          r: 150,
          t: 0.4,
          max: 0.4,
          col: "#ffffff",
        },
        {
          k: "w",
          x: e.x,
          y: e.y,
          r: 80,
          t: 0.28,
          max: 0.28,
          col: EL_COL,
        },
      );
      G.shake = Math.max(G.shake, 11);
      flash(EL_COL, 0.15, 0.2);
    }
  }
  G.shake = Math.max(G.shake, 5);
  drop(e.x, e.y, 0.35);
  coin(
    e.x,
    e.y,
    Math.max(
      1,
      Math.round(
        (e.sc / 50) * (1 + 0.1 * UL("gold")) * (1 + G.wave * 0.05) * ST().cm,
      ),
    ),
  );
  if (e.sc >= 250 && Math.random() < 0.3) cur("core", e.x, e.y, 1);
  if (e.sc >= 250 && Math.random() < 0.015) cur("chip", e.x, e.y, rollChip(0));
  if (Math.random() < 0.2) cur("shard", e.x, e.y, 1);
  if (isB(e)) {
    vacAll();
    G.BK2 = 0;
  }
}
