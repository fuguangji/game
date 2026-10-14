/** game/simulation — 區域效果、擊殺、整體每幀模擬 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { MW, N, T, TAU } from "../core/viewport.js";
import { EL_COL } from "../enemy-config.js";
import { PN } from "../game-config.js";
import { blocked, burst, cell, drop, empty, hitCell, hurt, mkEn, mv, ray } from "./battle.js";
import { aiExtra, bossDeath, detonate, dm, dodge, flash, frz, isB, mineBoom, thr, zoneParticle } from "./boss.js";
import { rollChip } from "./chips.js";
import { updEW, updEn } from "./enemy-ai.js";
import { flow } from "./pathfinding.js";
import { BMR, boom, chgU, explode, home, homeP, seamHit } from "./physics.js";
import { coin, cur, vacAll } from "./pickups.js";
import { updPl } from "./player.js";
import { ST, UL, win } from "./progress.js";
import { tutorial } from "./tutorial.js";
import { SQ, chainZone, chgHit, chipHit, chipTick, cloudSky, cloudSpark, dmM, fTarget, frag, gpTick, strikeFx, updLZ, wBul, zfl } from "./ultimates.js";
import { rayK } from "../ui/aim.js";
import { openShop } from "../ui/hud.js";
import { showOv } from "../ui/render.js";

// 更新地面區域（炸彈倒數、牽引力場等）
export function updZ(dt) {
  for (const z of G.zones) {
    if (z.th && z.th.t > 0) {
      z.th.t -= dt;
      if (z.th.t <= 0) {
        burst(z.x, z.y, z.col, 10, 140, 2, 0.35);
        if (z.bnc) {
          z.bnc = 0;
          const a =
              Math.atan2(G.pl.y - z.y, G.pl.x - z.x) + (Math.random() - 0.5) * 1.4,
            nx = z.x + Math.cos(a) * 55,
            ny = z.y + Math.sin(a) * 55;
          z.th = { x0: z.x, y0: z.y, t: 0.3, max: 0.3 };
          if (!blocked(nx, ny, 8)) {
            z.x = nx;
            z.y = ny;
          }
        }
      }
      continue;
    }
    z.t -= dt;
    if (z.k === "bomb" && z.t <= 0 && !z.td) {
      z.td = 1;
      for (const o of G.zones)
        if (
          o.k === "tur" &&
          o.hp > 0 &&
          Math.hypot(o.x - z.x, o.y - z.y) < z.r + 13
        )
          o.hp -= z.dmg;
    }
    if (z.grow) z.r += z.grow * dt;
    if (z.k === "flame") {
      if (
        z.t > 0 &&
        Math.hypot(G.pl.x - z.x, G.pl.y - z.y) < z.r + G.pl.r &&
        G.pl.dashT <= 0 &&
        G.pl.flT !== G.time &&
        fsm.state === "play" &&
        !(G.train && G.god)
      ) {
        G.pl.flT = G.time;
        let q = z.dps * dt * (G.CHR.dr || 1);
        if (G.pl.sh > 0) {
          const a = Math.min(G.pl.sh, q);
          G.pl.sh -= a;
          q -= a;
        }
        G.pl.hp -= q;
        G.pl.hf = 0.1;
        if (G.pl.hp <= 0) {
          G.pl.hp = 0.1;
          hurt(5);
        }
      }
      continue;
    }
    if (z.k === "slowz") {
      if (Math.hypot(G.pl.x - z.x, G.pl.y - z.y) < z.r && G.pl.dashT <= 0) {
        G.pl.slow = Math.max(G.pl.slow, 0.35);
        if (z.trg && !z.fd) {
          z.fd = 1;
          z.t = Math.min(z.t, 0.4);
          if (z.trg === 1)
            G.zones.push({
              k: "bomb",
              x: z.x,
              y: z.y,
              r: 60,
              t: 0.35,
              max: 0.35,
              col: "#ff8a3a",
              dmg: 18,
            });
          else {
            G.pl.slowL = 2;
            G.pl.slow = 2.6;
            burst(z.x, z.y, z.col, 12, 140, 2, 0.4);
          }
        }
        if (z.dps && !(G.train && G.god)) {
          G.pl.hp -= z.dps * dt * (G.CHR.dr || 1);
          if (G.pl.hp <= 0) {
            G.pl.hp = 0.1;
            hurt(5);
          }
        }
      }
    } else if (z.k === "web") {
      for (const e of G.en)
        if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r) {
          e.wb = 0.25;
          if (z.wi !== undefined) chgU(z.wi, 3 * dt);
          chipTick(e, dt, z, 0);
        }
      for (const b of G.bl)
        if (!b.own && b.life > 0 && Math.hypot(b.x - z.x, b.y - z.y) < z.r) {
          if (!b.sp0) b.sp0 = Math.hypot(b.vx, b.vy);
          const sp = Math.hypot(b.vx, b.vy) || 1,
            m = b.sp0 * 0.3;
          if (sp > m) {
            b.vx *= m / sp;
            b.vy *= m / sp;
          }
          b.inweb = G.time;
        }
    } else if (z.k === "storm") {
      z.x = G.pl.x;
      z.y = G.pl.y;
      z.fxT = (z.fxT || 0) - dt;
      if (z.fxT <= 0) {
        z.fxT = 0.24;
        zoneParticle(z, "ice", Math.random() < 0.5 ? "#ffe14a" : "#fff4a6");
      }
      for (const e of G.en)
        if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r) {
          e.fv = (e.fv || 0) + dt * 5;
          if (e.fv >= 6) frz(e);
        }
    } else if (z.k === "cloud") {
      z.fxT = (z.fxT || 0) - dt;
      if (z.fxT <= 0) {
        z.fxT = 0.06;
        zoneParticle(z, "elec", "#ffe14a");
        if (Math.random() < 0.7) zoneParticle(z, "elec", "#fff4a6");
      }
      z.am = (z.am || 0) - dt;
      if (z.am <= 0) {
        z.am = 0.3 + Math.random() * 0.3;
        cloudSpark(z);
      }
      z.sk = (z.sk || 0) - dt;
      if (z.sk <= 0) {
        z.sk = 1 + Math.random() * 0.8;
        cloudSky(z);
      }
      z.nx = (z.nx || 0) - dt;
      if (z.nx <= 0) {
        z.nx = 0.3;
        const c = G.en.filter(
          (e) => e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r,
        );
        if (c.length) {
          const e = c[(Math.random() * c.length) | 0];
          strikeFx(e);
          if (!isB(e)) e.stn = Math.max(e.stn || 0, 0.8);
          {
            const d0 = dm(e, 35 * dmM() * (z.dm || 1));
            e.hp -= d0;
            chipHit(e, d0, z);
          }
          e.hf = 1;
          burst(e.x, e.y, "#ffe14a", 8, 160, 2, 0.3);
          if (e.hp <= 0) kill(e);
        }
      }
    } else if (z.k === "portal") {
      if ((G.pl.pT || 0) < G.time && Math.hypot(G.pl.x - z.x, G.pl.y - z.y) < z.r) {
        G.pl.x = z.o.x;
        G.pl.y = z.o.y;
        G.pl.pT = G.time + 1;
        burst(G.pl.x, G.pl.y, z.o.col, 14, 160, 2, 0.4);
      }
      for (const b of G.bl) {
        if ((b.pT || 0) >= G.time || Math.hypot(b.x - z.x, b.y - z.y) >= z.r)
          continue;
        const sp = Math.hypot(b.vx, b.vy) || 1;
        b.x = z.o.x + (b.vx / sp) * (z.r + 6);
        b.y = z.o.y + (b.vy / sp) * (z.r + 6);
        b.pT = G.time + 0.3;
      }
    } else if (z.k === "gpull") {
      gpTick(z, dt);
      for (const e of G.en)
        if (e.hp > 0 && !isB(e)) {
          const dx = z.x - e.x,
            dy = z.y - e.y,
            d = Math.hypot(dx, dy);
          if (d < z.r && d > 6) {
            G.MVF = 1;
            mv(e, (dx / d) * 110 * dt, (dy / d) * 110 * dt);
            G.MVF = 0;
          }
        }
      if (z.ult)
        for (const b of G.bl) {
          if (!b.own || b.life <= 0) continue;
          const dx = z.x - b.x,
            dy = z.y - b.y,
            d = Math.hypot(dx, dy);
          if (d < z.r && d > 5) {
            const f = 900;
            b.vx += (dx / d) * f * dt;
            b.vy += (dy / d) * f * dt;
          }
        }
    } else if (z.k === "mine") {
      let go = false;
      if (z.fuse !== undefined) {
        z.fuse -= dt;
        go = z.fuse <= 0;
      } else if (z.arm > 0) z.arm -= dt;
      else
        for (const e of G.en)
          if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.7 + e.r) {
            go = true;
            break;
          }
      if (go) mineBoom(z);
    } else if (z.k === "tur") {
      if (z.hp <= 0 && z.t > 0) {
        z.t = 0;
        burst(z.x, z.y, z.col, 16, 220, 3, 0.5);
        G.shake = Math.max(G.shake, 3);
      }
      for (const e of G.en) {
        if (
          e.hp > 0 &&
          Math.hypot(e.x - z.x, e.y - z.y) < e.r + (z.r || 14) + 1
        )
          z.hp -= (8 + G.wave * 0.4) * dt;
      }
      z.cd -= dt;
      let tb = null,
        td = 1e9;
      for (const e of G.en) {
        if (e.hp <= 0) continue;
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (
          d < z.rg + e.r &&
          d < td &&
          ray(z.x, z.y, Math.atan2(e.y - z.y, e.x - z.x), d) >= d - e.r - 6
        ) {
          td = d;
          tb = e;
        }
      }
      if (tb) {
        z.ang = Math.atan2(tb.y - z.y, tb.x - z.x);
        if (z.cd <= 0) {
          z.cd = z.fi;
          if (z.big) {
            const lt = 0.6,
              px = Math.max(20, Math.min(MW - 20, tb.x + (tb.mvx || 0) * lt)),
              py = Math.max(20, Math.min(MW - 20, tb.y + (tb.mvy || 0) * lt));
            G.zones.push(
              thr(
                {
                  k: "gren",
                  x: px,
                  y: py,
                  r: z.br,
                  t: 0.5,
                  max: 0.5,
                  col: z.col,
                  dmg: z.gd,
                  kb: 500,
                  wd: 2,
                  ult: 1,
                  ...zfl(z.w),
                },
                z.x,
                z.y,
                0.45,
              ),
            );
            burst(z.x, z.y, z.col, 10, 160, 2.5, 0.3);
            G.shake = Math.max(G.shake, 3);
          } else {
            const n0 = G.bl.length,
              tn = Math.max(1, z.w.n1 || 1);
            for (let k = 0; k < tn; k++)
              wBul(
                z.w,
                z.x + Math.cos(z.ang) * 14,
                z.y + Math.sin(z.ang) * 14,
                z.ang +
                  (tn > 1
                    ? (k / (tn - 1) - 0.5) * Math.max(0.1, z.w.sp || 0)
                    : 0),
                z.dmul,
              );
            if (z.ult) for (let q = n0; q < G.bl.length; q++) G.bl[q].ult = 1;
          }
        }
      }
    } else if (z.k === "tox") {
      z.nx = (z.nx || 0) - dt;
      const dps = z.dmg / z.max;
      z.cht = (z.cht || 0) - dt;
      if (z.ch && z.cht <= 0) {
        z.cht = 0.4;
        chainZone(z, dps * 0.4);
      }
      for (const e of G.en) {
        if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r * 0.5) {
          const dd = dm(e, dps * dt);
          e.hp -= dd;
          if (!z.ult) chgU(z.wi, dd * 0.12);
          chipTick(e, dt, z, dd);
          if (e.hp <= 0) kill(e);
        }
      }
      if (z.nx <= 0) {
        z.nx = 0.2;
        burst(
          z.x + (Math.random() - 0.5) * z.r * 1.4,
          z.y + (Math.random() - 0.5) * z.r * 1.4,
          z.col,
          1,
          25,
          3,
          0.7,
        );
      }
    } else if (z.k === "gren") {
      if (z.t <= 0)
        explode({
          x: z.x,
          y: z.y,
          ex: z.r,
          dmg: z.dmg,
          kb: z.kb,
          wd: z.wd,
          col: z.col,
          bu: z.bu,
          fr: z.fr,
          fz4: z.fz4,
          lk: z.lk,
          ch: z.ch,
        });
    } else if (z.k === "pull") {
      const dx = z.x - G.pl.x,
        dy = z.y - G.pl.y,
        d = Math.hypot(dx, dy),
        E = z.el;
      if (d < z.r && d > 8 && G.pl.dashT <= 0) {
        const k = (E ? 150 : 120) * (1 - ((E ? 0.35 : 0.4) * d) / z.r),
          cp = E ? 50 : 55;
        G.pl.pvx += (dx / d) * k * dt;
        G.pl.pvy += (dy / d) * k * dt;
        const sp = Math.hypot(G.pl.pvx, G.pl.pvy);
        if (sp > cp) {
          G.pl.pvx *= cp / sp;
          G.pl.pvy *= cp / sp;
        }
      }
      if (E) {
        if (d < z.r && G.pl.dashT <= 0 && fsm.state === "play" && !(G.train && G.god)) {
          G.pl.hp -= z.dps * dt * (G.CHR.dr || 1);
          if (G.pl.hp <= 0) {
            G.pl.hp = 0.1;
            hurt(5);
          }
        }
        if (z.t <= 0 && !z.bst) {
          z.bst = 1;
          burst(z.x, z.y, z.col, 30, 300, 3, 0.6);
          G.fxs.push({
            k: "w",
            x: z.x,
            y: z.y,
            r: z.r,
            t: 0.4,
            max: 0.4,
            col: z.col,
          });
          G.shake = Math.max(G.shake, 6);
          if (d < z.r + G.pl.r && G.pl.dashT <= 0) {
            hurt(10);
            const a = Math.atan2(G.pl.y - z.y, G.pl.x - z.x);
            G.pl.pvx = Math.cos(a) * 200;
            G.pl.pvy = Math.sin(a) * 200;
          }
        }
      }
    } else if (z.t <= 0) {
      burst(z.x, z.y, z.col, 30, 300, 3, 0.6);
      burst(z.x, z.y, "#ffffff", 10, 200, 2, 0.3);
      G.shake = Math.max(G.shake, 9);
      if (Math.hypot(G.pl.x - z.x, G.pl.y - z.y) < z.r + G.pl.r) hurt(z.dmg);
      for (
        let j = Math.floor((z.y - z.r) / T);
        j <= Math.floor((z.y + z.r) / T);
        j++
      )
        for (
          let i = Math.floor((z.x - z.r) / T);
          i <= Math.floor((z.x + z.r) / T);
          i++
        )
          if (Math.hypot((i + 0.5) * T - z.x, (j + 0.5) * T - z.y) < z.r + 10)
            hitCell(i, j);
    }
  }
  G.zones = G.zones.filter((z) => z.t > 0);
}
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
// 整體模擬一步（dt 秒）
export function update(dt) {
  if (G.pendEn.length) {
    for (const m of G.pendEn) G.en.push(m);
    G.pendEn.length = 0;
  }
  G.time += dt;
  G.HF = Math.max(0, G.HF - dt * 1.8);
  G.bossIn = Math.max(0, G.bossIn - dt);
  G.ptxt = Math.max(0, G.ptxt - dt);
  if (G.FL) {
    G.FL.t -= dt;
    if (G.FL.t <= 0) G.FL = null;
  }
  const BB = G.en.find((e) => isB(e) && !e.dummy);
  if (BB) G.bcol = BB.col;
  if (BB && fsm.state === "play") {
    const hf = BB.hp / BB.mhp;
    if (hf < 0.35 && Math.random() < dt * 1.3)
      G.fxs.push({
        k: "w",
        x: BB.x,
        y: BB.y,
        r: BB.r * 3.2,
        t: 0.8,
        max: 0.8,
        col: "#ff4a4a",
      });
    if (Math.hypot(BB.mvx || 0, BB.mvy || 0) > 170 && G.pt.length < 480)
      G.pt.push({
        x: BB.x,
        y: BB.y,
        vx: 0,
        vy: 0,
        life: 0.28,
        max: 0.28,
        col: BB.col,
        sz: BB.r * 0.85,
      });
  }
  G.bti += ((BB ? 1 : 0) - G.bti) * Math.min(1, dt * 2);
  if (BB && fsm.state === "play" && G.pt.length < 500 && Math.random() < 0.7)
    G.pt.push({
      x: G.camx + (Math.random() * G.W) / G.S,
      y: G.camy + (Math.random() * G.H) / G.S,
      vx: (Math.random() - 0.5) * 40,
      vy: -30 - Math.random() * 50,
      life: 2.4,
      max: 2.4,
      col: BB.col,
      sz: 1.5 + Math.random() * 3,
    });
  G.shake = Math.max(0, G.shake - dt * 40);
  if (fsm.state === "play") {
    updPl(dt);
    G.pl.avx =
      (G.pl.avx || 0) + ((G.pl.vx || 0) - (G.pl.avx || 0)) * Math.min(1, dt * 5);
    G.pl.avy =
      (G.pl.avy || 0) + ((G.pl.vy || 0) - (G.pl.avy || 0)) * Math.min(1, dt * 5);
    for (let i = SQ.length - 1; i >= 0; i--) {
      const s = SQ[i];
      s.t -= dt;
      if (s.t <= 0) {
        SQ.splice(i, 1);
        s.fn();
      }
    }
    for (const f of G.fxs) f.t -= dt;
    G.fxs = G.fxs.filter((f) => f.t > 0);
    G.fT -= dt;
    if (G.fT <= 0) {
      G.fT = 0.25;
      flow();
    }
    for (const e of G.en) {
      if (e.inv > 0) e.inv -= dt;
      if (e.bu > 0) {
        e.bu -= dt;
        e.hp -= dm(e, 10 * dt);
        if (Math.random() < 0.3) burst(e.x, e.y, "#ff7a3d", 1, 40, 2, 0.3);
        if (e.hp <= 0) kill(e);
      }
      if (e.fr > 0) {
        e.fr -= dt;
        if (Math.random() < 0.2) burst(e.x, e.y, "#7af0ff", 1, 30, 2, 0.3);
      }
      if (e.wb > 0) e.wb -= dt;
      if (e.frz > 0) e.frz -= dt;
      if (e.inv > 0) e.inv -= dt;
      if (e.fv > 0) e.fv = Math.max(0, e.fv - dt * 0.6);
      if (e.cgt > 0) {
        e.cgt -= dt;
        if (e.cgt <= 0) e.cg = 0;
      }
      if (e.root > 0) {
        e.root -= dt;
        if (Math.random() < 0.2) burst(e.x, e.y, "#c0a060", 1, 20, 2, 0.3);
      }
      if (e.stn > 0) {
        e.stn -= dt;
        if (Math.random() < 0.3) burst(e.x, e.y, "#ffe14a", 1, 40, 2, 0.3);
      } else if (!(G.train && G.fz) && !e.dummy) {
        const ft = isB(e) || e.t >= 30 ? null : fTarget(e),
          real = G.pl;
        if (ft) {
          G.pl = Object.create(real);
          G.pl.x = ft.x;
          G.pl.y = ft.y;
          G.pl.vx = 0;
          G.pl.vy = 0;
        }
        try {
          updEn(
            e,
            dt * (e.fr > 0 ? 0.55 : 1) * (e.wb > 0 ? (isB(e) ? 0.7 : 0.35) : 1),
          );
          dodge(e, dt);
          aiExtra(e, dt);
        } finally {
          G.pl = real;
        }
      }
      if (dt > 0) {
        e.mvx = ((e.x - e.px) / dt) * 0.3 + e.mvx * 0.7;
        e.mvy = ((e.y - e.py) / dt) * 0.3 + e.mvy * 0.7;
      }
      e.px = e.x;
      e.py = e.y;
      if (e.kx || e.ky) {
        G.MVF = 1;
        mv(e, e.kx * dt, e.ky * dt);
        G.MVF = 0;
        const f = Math.pow(0.0025, dt);
        e.kx *= f;
        e.ky *= f;
      }
    }
    for (let i = 0; i < G.en.length; i++)
      for (let j = i + 1; j < G.en.length; j++) {
        const a = G.en[i],
          b = G.en[j],
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy),
          m = a.r + b.r;
        const ms = isB(a) || isB(b) ? m : m * 1.35;
        if (d < ms && d > 0) {
          const k = ((ms - d) / 2 / d) * (d < m ? 1 : 0.1);
          mv(a, -dx * k, -dy * k);
          mv(b, dx * k, dy * k);
        }
      }
    for (const b of G.bl) {
      if (b.sp0 && b.inweb !== undefined && b.inweb < G.time - 0.05) {
        const s0 = Math.hypot(b.vx, b.vy) || 1;
        b.vx *= b.sp0 / s0;
        b.vy *= b.sp0 / s0;
        b.inweb = undefined;
      }
      if (b.hm) home(b, dt);
      if (b.hm2) homeP(b, dt);
      if (b.acc && !b.acd && Math.hypot(G.pl.x - b.x, G.pl.y - b.y) < 150) {
        b.acd = 1;
        b.vx *= 1.5;
        b.vy *= 1.5;
      }
      if (b.spl && b.age > 1 && b.life > 0) {
        b.life = 0;
        const a1 = Math.atan2(b.vy, b.vx),
          s1 = Math.hypot(b.vx, b.vy);
        for (const sg of [-0.5, 0.5])
          G.bl.push({
            eff: 2,
            hm2: true,
            hr: 1.4,
            x: b.x,
            y: b.y,
            vx: Math.cos(a1 + sg) * s1,
            vy: Math.sin(a1 + sg) * s1,
            r: 4,
            own: 0,
            dmg: 8,
            life: 2.5,
            col: "#e04dff",
          });
        burst(b.x, b.y, EL_COL, 8, 120, 2, 0.3);
      }
      if (b.bm) boom(b, dt);
      if (b.life <= 0) continue;
      const px0 = b.x,
        py0 = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!(b.bm && b.t2 && b.returnSlow)) b.life -= dt;
      b.age = (b.age || 0) + dt;
      if (b.fl && b.l0)
        b.r = (b.r0 || (b.r0 = b.r)) * (1 + 2 * Math.min(1, b.age / b.l0));
      let i = Math.floor(b.x / T),
        j = Math.floor(b.y / T),
        v = cell(i, j);
      if (!(b.bm && b.t2)) {
        if (v === 0) {
          const sw = seamHit(px0, py0, b.x, b.y);
          if (sw) {
            b.x = sw[0];
            b.y = sw[1];
            i = sw[2];
            j = sw[3];
            v = cell(i, j);
          }
        } else if (!b.pierce && !b.sn && !b.bm && !(b.bn > 0) && !(b.pw > 0)) {
          const ddx = b.x - px0,
            ddy = b.y - py0,
            LL = Math.hypot(ddx, ddy);
          if (
            LL > 1e-6 &&
            cell(Math.floor(px0 / T), Math.floor(py0 / T)) === 0
          ) {
            const tt = rayK(px0, py0, Math.atan2(ddy, ddx), LL, 0);
            if (tt < LL) {
              const qx = px0 + (ddx / LL) * (tt + 0.05),
                qy = py0 + (ddy / LL) * (tt + 0.05),
                qi = Math.floor(qx / T),
                qj = Math.floor(qy / T);
              if (cell(qi, qj) !== 0) {
                b.x = qx;
                b.y = qy;
                i = qi;
                j = qj;
                v = cell(i, j);
              }
            }
          }
        }
      }
      if (v !== 0 && b.bm && !b.t2) {
        if (v > 0) hitCell(i, j, b.ult ? 5 : 3);
        const ox = b.x - b.vx * dt,
          oy = b.y - b.vy * dt;
        b.x = ox;
        b.y = oy;
        if (b.t2 !== 1) {
          b.t2 = 1;
          b.hit.length = 0;
          b.life = 12;
          b.returnSlow = 1;
          b.vx = -b.vx;
          b.vy = -b.vy;
        } else {
          b.vx = -b.vx;
          b.vy = -b.vy;
        }
        const bs = Math.hypot(b.vx, b.vy) || 1;
        b.spd0 = b.spd0 || bs;
        b.vx = (b.vx / bs) * b.spd0;
        b.vy = (b.vy / bs) * b.spd0;
        continue;
      }
      if (b.bm && b.t2 && v > 0) {
        const key = j * N + i;
        if (!b.hit.includes(key)) {
          hitCell(i, j, b.ult ? 5 : 3);
          b.hit.push(key);
        }
      }
      if (v !== 0 && b.bn > 0) {
        b.bn--;
        const ox = b.x - b.vx * dt,
          oy = b.y - b.vy * dt;
        if (v > 0) hitCell(i, j, 1);
        if (cell(i, Math.floor(oy / T)) === 0) b.vy = -b.vy;
        else if (cell(Math.floor(ox / T), j) === 0) b.vx = -b.vx;
        else {
          b.vx = -b.vx;
          b.vy = -b.vy;
        }
        b.x = ox;
        b.y = oy;
        continue;
      }
      if (b.pw > 0 && v !== 0) b.pwin = 1;
      else if (b.pwin && v === 0) {
        b.pw--;
        b.pwin = 0;
      }
      if (!(b.bm && b.t2) && !(b.pw > 0 && v !== 0)) {
        if (v < 0 && !b.sn) {
          b.life = 0;
          burst(b.x, b.y, "#b45cff", 4, 100, 2, 0.25);
        } else if (v > 0) {
          const wn =
            b.wd === undefined
              ? 1
              : Math.floor(b.wd) + (Math.random() < b.wd % 1 ? 1 : 0);
          if (b.pierce) {
            if (b.lc !== j * N + i) {
              b.lc = j * N + i;
              hitCell(i, j, wn);
            }
          } else {
            hitCell(i, j, wn);
            b.life = 0;
          }
        }
      }
      if (b.life <= 0) continue;
      if (b.own) {
        for (const e of G.en) {
          if (e.hp <= 0 || ((b.pierce || b.pe) && b.hit.includes(e))) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + (b.bm ? BMR(b) : b.r)) {
            const dd = dm(e, b.dmg, Math.atan2(b.y - e.y, b.x - e.x));
            e.hp -= dd;
            e.hf = dd > 0 ? 1 : 0;
            {
              const n = Math.hypot(b.vx, b.vy) || 1;
              e.kx += ((b.vx / n) * b.kb) / e.m;
              e.ky += ((b.vy / n) * b.kb) / e.m;
            }
            if (b.ch) {
              let t2 = null,
                bd = 140;
              for (const o of G.en)
                if (o !== e && o.hp > 0) {
                  const d2 = Math.hypot(o.x - e.x, o.y - e.y);
                  if (d2 < bd) {
                    bd = d2;
                    t2 = o;
                  }
                }
              if (t2) {
                t2.hp -= dm(t2, b.dmg * 0.5);
                t2.hf = 1;
                G.fxs.push({
                  k: "l",
                  x: e.x,
                  y: e.y,
                  a: Math.atan2(t2.y - e.y, t2.x - e.x),
                  len: bd,
                  t: 0.15,
                  max: 0.15,
                  col: "#7ab8ff",
                });
                if (t2.hp <= 0) kill(t2);
              }
            }
            if (b.xb)
              explode({
                x: b.x,
                y: b.y,
                ex: 48,
                dmg: b.dmg * 0.35,
                kb: 120,
                wd: 0,
                col: b.col || "#ffb040",
              });
            if (b.bu) e.bu = 3;
            if (b.fr) e.fr = 2;
            if (b.lk && G.pl.hp < G.pl.mhp)
              G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + Math.min(2, b.dmg * 0.025));
            if (b.fz4) {
              e.fv = (e.fv || 0) + 1;
              e.fr = 1.2;
              if (e.fv >= 6) frz(e);
            }
            if (b.cg) {
              e.cg = (e.cg || 0) + 1;
              e.cgt = 6;
              if (e.cg >= 3) detonate(e);
              else chgHit(e);
            }
            if (!b.ult) chgU(b.wi, b.dmg * 0.25);
            if (dd > 0) {
              burst(b.x, b.y, e.col, 6, 160, 2, 0.3);
              if (isB(e) && Math.random() < 0.5)
                burst(b.x, b.y, "#ffffff", 4, 260, 1.6, 0.25);
            } else burst(b.x, b.y, "#9aa0ab", 10, 200, 2, 0.35);
            G.shake = Math.max(G.shake, 2.5);
            if (e.hp <= 0) kill(e);
            if (b.pierce || b.pe) b.hit.push(e);
            else {
              b.life = 0;
              break;
            }
          }
        }
      } else if (
        G.pl.dashT <= 0 &&
        Math.hypot(G.pl.x - b.x, G.pl.y - b.y) < G.pl.r + b.r
      ) {
        b.life = 0;
        hurt(b.dmg);
        if (b.eff === 1) G.pl.slow = 2.2;
        if (b.eff === 3) {
          G.pl.slowL = G.pl.slow > 0 ? Math.min(2, (G.pl.slowL || 1) + 1) : 1;
          G.pl.slow = 2.6;
          burst(G.pl.x, G.pl.y, "#bfefff", 8, 120, 2, 0.4);
          if (b.efz) {
            G.zones.push({
              k: "slowz",
              x: b.x,
              y: b.y,
              r: 55,
              t: 1.5,
              max: 1.5,
              col: "#bfefff",
            });
            G.fxs.push({
              k: "w",
              x: b.x,
              y: b.y,
              r: 55,
              t: 0.35,
              max: 0.35,
              col: "#bfefff",
            });
          }
        }
      }
    }
    for (const z of G.zones)
      if (z.k === "tur" && z.hp > 0 && !(z.th && z.th.t > 0))
        for (const b of G.bl)
          if (
            !b.own &&
            b.life > 0 &&
            Math.hypot(b.x - z.x, b.y - z.y) < (z.r || 14) - 1 + b.r
          ) {
            z.hp -= b.dmg;
            b.life = 0;
            burst(b.x, b.y, "#ff6a6a", 3, 80, 2, 0.25);
          }
    for (const b of G.bl)
      if (b.life <= 0) {
        if (b.ex) explode(b);
        else if (b.cs) frag(b);
        else if (b.gp) {
          const gk =
            Math.min(1.5, Math.sqrt((b.r || 7) / 7)) * (b.xb ? 1.25 : 1);
          G.zones.push({
            k: "gpull",
            x: b.x,
            y: b.y,
            r: 120 * gk,
            t: 1.8,
            max: 1.8,
            col: b.col || "#b0a0ff",
            dps: b.dmg * 0.35,
            bu: b.bu,
            fr: b.fr,
            fz4: b.fz4,
            lk: b.lk,
            ch: b.ch,
            xb: b.xb,
          });
        }
      }
    G.bl = G.bl.filter((b) => b.life > 0);
    updLZ(dt);
    G.en = G.en.filter((e) => e.hp > 0);
    updZ(dt);
    updEW(dt);
    G.pkT -= dt;
    if (G.pkT <= 0) {
      G.pkT = 7;
      if (G.pk.filter((q) => PN.includes(q.t)).length < 8) {
        const p = empty(120, G.pl);
        if (p)
          G.pk.push({
            x: p.x,
            y: p.y,
            t: PN[(Math.random() * 4) | 0],
            life: 18,
          });
      }
    }
    if (!G.train && !tutorial.active && G.en.length === 0) {
      G.waveT -= dt;
      if (G.waveT <= 0) {
        G.waveT = 1.8;
        if (ST().g && G.wave >= ST().g) win();
        else openShop();
      }
    } else G.waveT = 1.8;
    G.banner = Math.max(0, G.banner - dt);
    const tx = Math.max(0, Math.min(MW - G.W / G.S, G.pl.x - G.W / G.S / 2)),
      ty = Math.max(0, Math.min(MW - G.H / G.S, G.pl.y - G.H / G.S / 2));
    const k = Math.min(1, dt * 10);
    G.camx += (tx - G.camx) * k;
    G.camy += (ty - G.camy) * k;
    if (G.W / G.S >= MW) G.camx = (MW - G.W / G.S) / 2;
    if (G.H / G.S >= MW) G.camy = (MW - G.H / G.S) / 2;
  }
  if (fsm.state === "over") {
    G.bl = G.bl.filter((b) => b.life > 0);
    G.overT -= dt;
    if (G.overT <= 0 && !G.shown) {
      G.shown = 1;
      showOv(1);
    }
  }
  for (let i = G.pt.length - 1; i >= 0; i--) {
    const p = G.pt[i];
    p.life -= dt;
    p.age = (p.age || 0) + dt;
    if (p.life <= 0) {
      G.pt.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    if (p.k === "ice") p.vy = Math.min(p.vy + 2 * dt, -12);
    else p.vy *= 0.96;
    if (p.f) p.rot += p.vr * dt;
  }
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.pendEn = [];
}

