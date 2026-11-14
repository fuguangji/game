/** game/zone-update — 地面區域效果（炸彈、牽引、毒區、地雷等）的每幀更新 */
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { MW, T } from "../core/viewport.js";
import { blocked, burst, hitCell, hurt, mv, ray } from "./battle.js";
import { dm, frz, isB, mineBoom, thr, zoneParticle } from "./boss.js";
import { kill } from "./enemy-death.js";
import { chgU, explode } from "./physics.js";
import { chainZone, chipHit, chipTick, cloudSky, cloudSpark, dmM, gpTick, strikeFx, wBul, zfl } from "./ultimates.js";
import { applyStatus } from "./status-effects.js";

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
        applyStatus(G.pl, "slow", { duration: 0.35 });
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
            applyStatus(G.pl, "slow", { duration: 2.6, stacks: 2 });
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
