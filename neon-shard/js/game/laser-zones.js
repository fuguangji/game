/** game/laser-zones — 雷射地帶：發射、判定、更新與繪製 */
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { T, TAU, cx } from "../core/viewport.js";
import { burst, hitCell, ray, ultT } from "./battle.js";
import { dm, frz } from "./boss.js";
import { chgU, explode } from "./physics.js";
import { kill } from "./simulation.js";
import { FT, LZ, dmM } from "./ultimates.js";

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
