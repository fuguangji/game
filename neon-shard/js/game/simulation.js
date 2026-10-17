/** game/simulation — 區域效果、擊殺、整體每幀模擬 */

import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { MW, N, T } from "../core/viewport.js";
import { EL_COL } from "../enemy-config.js";
import { PN } from "../game-config.js";
import { burst, cell, empty, hitCell, hurt, mv } from "./battle.js";
import { aiExtra, detonate, dm, dodge, frz, isB } from "./boss.js";

import { updEW, updEn } from "./enemy-ai.js";
import { flow } from "./pathfinding.js";
import { BMR, boom, chgU, explode, home, homeP, seamHit } from "./physics.js";

import { updPl } from "./player.js";
import { ST, win } from "./progress.js";
import { tutorial } from "./tutorial.js";
import { SQ, chgHit, fTarget, frag, updLZ } from "./ultimates.js";
import { rayK } from "../ui/aim.js";
import { openShop } from "../ui/hud.js";
import { showOv } from "../ui/render.js";
import { kill } from "./enemy-death.js";
import { updZ } from "./zone-update.js";
export { updZ } from "./zone-update.js";
export { kill } from "./enemy-death.js";
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

