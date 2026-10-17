/** ui/render — 場景繪製與主頁／結算顯示 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { $, MW, N, T, TAU, cx } from "../core/viewport.js";
import { ELITE, EL_COL } from "../enemy-config.js";
import { PC, PN } from "../game-config.js";
import { ULN, hc, mouse, ray, setup, ta, tm, ultT } from "../game/battle.js";
import { bossTele, drawAtmos, drawBossFx, isB, teleBeams } from "../game/boss.js";
import { CH, RC } from "../game/chips.js";
import { aimT } from "../game/physics.js";
import { EN, NEWT, drawItems } from "../game/pickups.js";
import { ST } from "../game/progress.js";
import { drawChg, drawLZ } from "../game/ultimates.js";
import { WP, applyLO } from "../game/weapons.js";
import { icon } from "../icons.js";
import { drawAim } from "./aim.js";
import { drawBars, drawLast, drawSlots } from "./hud.js";
import { XS, xResult } from "./menu.js";
import { bossCatalog, telegraphDurationOf, telegraphRadiusOf, usesLineTelegraph } from "../config/index.js";
import { settings } from "../core/settings-store.js";
import { drawRoleAura, skinRenderer } from "../profile/appearance.js";
import { accountService } from "../account/index.js";

// 繪製整個場景（地圖、物件、特效、HUD）
export function render() {
  cx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
  cx.fillStyle = "#05060d";
  cx.fillRect(0, 0, G.W, G.H);
  const VW = G.W / G.S,
    VH = G.H / G.S,
    ox = (Math.random() - 0.5) * G.shake * 0.6,
    oy = (Math.random() - 0.5) * G.shake * 0.6;
  cx.setTransform(
    G.DPR * G.S,
    0,
    0,
    G.DPR * G.S,
    -(G.camx + ox) * G.DPR * G.S,
    -(G.camy + oy) * G.DPR * G.S,
  );
  cx.fillStyle = "#080a17";
  cx.fillRect(0, 0, MW, MW);
  if (G.bti > 0.01) {
    cx.globalAlpha = G.bti * 0.12;
    cx.fillStyle = G.bcol;
    cx.fillRect(0, 0, MW, MW);
    cx.globalAlpha = 1;
  }
  const i0 = Math.max(0, Math.floor(G.camx / T)),
    i1 = Math.min(N - 1, Math.ceil((G.camx + VW) / T)),
    j0 = Math.max(0, Math.floor(G.camy / T)),
    j1 = Math.min(N - 1, Math.ceil((G.camy + VH) / T));
  cx.strokeStyle = G.bti > 0.05 ? G.bcol : "rgba(60,200,255,.07)";
  cx.globalAlpha = G.bti > 0.05 ? 0.09 + 0.05 * Math.sin(G.time * 3) * G.bti : 1;
  cx.lineWidth = 1;
  cx.beginPath();
  for (let i = i0; i <= i1 + 1; i++) {
    cx.moveTo(i * T, j0 * T);
    cx.lineTo(i * T, (j1 + 1) * T);
  }
  for (let j = j0; j <= j1 + 1; j++) {
    cx.moveTo(i0 * T, j * T);
    cx.lineTo((i1 + 1) * T, j * T);
  }
  cx.stroke();
  cx.globalAlpha = 1;
  cx.lineJoin = "round";
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const v = G.grid[j * N + i];
      if (!v) continue;
      const x = i * T,
        y = j * T;
      if (v < 0) {
        cx.fillStyle = "rgba(168,85,247,.22)";
        cx.strokeStyle = "#b45cff";
        cx.lineWidth = 2;
        cx.fillRect(x + 3, y + 3, T - 6, T - 6);
        cx.strokeRect(x + 3, y + 3, T - 6, T - 6);
        cx.beginPath();
        cx.moveTo(x + 11, y + 11);
        cx.lineTo(x + T - 11, y + T - 11);
        cx.moveTo(x + T - 11, y + 11);
        cx.lineTo(x + 11, y + T - 11);
        cx.stroke();
        continue;
      }
      cx.fillStyle = hc(v, 0.18);
      cx.strokeStyle = hc(v, 0.9);
      cx.lineWidth = 2;
      cx.fillRect(x + 3, y + 3, T - 6, T - 6);
      cx.strokeRect(x + 3, y + 3, T - 6, T - 6);
      if (v < 6) {
        const h = ((i * 73856093) ^ (j * 19349663)) >>> 0,
          q = (n) => (((h * (n + 3) * 2654435761) >>> 0) % 1000) / 1000;
        cx.lineWidth = 1.5;
        cx.beginPath();
        for (let k = 0; k < 6 - v; k++) {
          const a = q(k) * TAU,
            l = 8 + q(k + 9) * 9,
            cx0 = x + T / 2,
            cy0 = y + T / 2;
          cx.moveTo(cx0, cy0);
          const mx = cx0 + Math.cos(a) * l,
            my = cy0 + Math.sin(a) * l;
          cx.lineTo(mx, my);
          cx.lineTo(mx + Math.cos(a + 0.7) * 7, my + Math.sin(a + 0.7) * 7);
        }
        cx.stroke();
      }
    }
  cx.strokeStyle = G.bti > 0.05 ? G.bcol : "#b45cff";
  cx.lineWidth = 3;
  cx.strokeRect(0, 0, MW, MW);
  for (const q of G.pk) {
    const by = Math.sin(G.time * 3 + q.x) * 2;
    if (q.life < 4 && Math.floor(G.time * 8) % 2) continue;
    cx.save();
    cx.globalAlpha = 0.5;
    const pc = q.t === "chip" ? RC[CH[q.v].r] : PC[q.t],
      rr = q.t === "chip" ? CH[q.v].r : 0;
    cx.shadowColor = pc;
    cx.shadowBlur = 14 + rr * 4;
    cx.strokeStyle = pc + "88";
    cx.lineWidth = 1.5;
    const cu = !PN.includes(q.t);
    if (rr >= 3) {
      cx.beginPath();
      cx.arc(q.x, q.y + by, 14 + Math.sin(G.time * 5) * 2, 0, TAU);
      cx.stroke();
    }
    if (!cu) {
      cx.beginPath();
      cx.arc(q.x, q.y + by, 17, 0, TAU);
      cx.stroke();
    }
    icon(cx, q.t, q.x, q.y + by, cu ? (q.t === "chip" ? 8 + rr : 5.5) : 10, pc);
    cx.restore();
  }
  for (const z of G.zones) {
    if (z.th && z.th.t > 0) {
      cx.save();
      cx.strokeStyle = z.col;
      cx.fillStyle = z.col;
      cx.lineWidth = 2;
      cx.beginPath();
      cx.arc(z.x, z.y, z.r * (z.k === "mine" ? 0.7 : 1), 0, TAU);
      cx.globalAlpha = 0.18;
      cx.fill();
      cx.globalAlpha = 0.5;
      cx.stroke();
      cx.restore();
      continue;
    }
    cx.save();
    const pr = 1 - z.t / z.max;
    cx.strokeStyle = z.col;
    cx.lineWidth = 2;
    cx.shadowColor = z.col;
    cx.shadowBlur = 10;
    if (z.k === "flame") {
      const fa = Math.max(0, z.t / z.max),
        g = cx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r * 1.5);
      g.addColorStop(0, "#ffe14a");
      g.addColorStop(0.5, "#ff7a1a");
      g.addColorStop(1, "#ff2a0000");
      cx.globalCompositeOperation = "lighter";
      cx.globalAlpha = 0.85 * fa;
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(z.x, z.y, z.r * (0.8 + 0.5 * fa), 0, TAU);
      cx.fill();
    } else if (z.k === "mine") {
      cx.globalAlpha = z.arm > 0 ? 0.4 : 1;
      cx.fillStyle = z.col + "33";
      cx.beginPath();
      cx.arc(z.x, z.y, z.r * 0.7, 0, TAU);
      cx.fill();
      cx.stroke();
      cx.fillStyle = z.col + "aa";
      cx.beginPath();
      cx.arc(z.x, z.y, 6, 0, TAU);
      cx.fill();
      cx.stroke();
    } else if (z.k === "tur") {
      const sc = (z.r || 14) / 14;
      cx.fillStyle = z.col + "44";
      cx.beginPath();
      cx.arc(z.x, z.y, 11 * sc, 0, TAU);
      cx.fill();
      cx.stroke();
      cx.lineWidth = 4 * sc;
      cx.beginPath();
      cx.moveTo(z.x, z.y);
      cx.lineTo(
        z.x + Math.cos(z.ang) * 17 * sc,
        z.y + Math.sin(z.ang) * 17 * sc,
      );
      cx.stroke();
      cx.lineWidth = 2;
      cx.globalAlpha = 0.8;
      cx.beginPath();
      cx.arc(
        z.x,
        z.y,
        17 * sc,
        -Math.PI / 2,
        -Math.PI / 2 + TAU * Math.max(0, z.t / z.max),
      );
      cx.stroke();
      cx.globalAlpha = 1;
      cx.fillStyle = "#000a";
      cx.fillRect(z.x - 14 * sc, z.y - 27 * sc, 28 * sc, 4);
      const hr = Math.max(0, z.hp / z.mhp);
      cx.fillStyle = hr > 0.4 ? "#7affc0" : "#ff6a6a";
      cx.fillRect(z.x - 14 * sc, z.y - 27 * sc, 28 * sc * hr, 4);
    } else if (z.k === "tox") {
      const g = cx.createRadialGradient(z.x, z.y, z.r * 0.2, z.x, z.y, z.r);
      g.addColorStop(0, z.col + "66");
      g.addColorStop(1, z.col + "10");
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(z.x, z.y, z.r * (1 + 0.03 * Math.sin(G.time * 4)), 0, TAU);
      cx.fill();
      cx.stroke();
    } else if (z.k === "gren") {
      cx.fillStyle = z.col + "40";
      cx.beginPath();
      cx.arc(z.x, z.y, z.r, 0, TAU);
      cx.fill();
      cx.stroke();
      cx.beginPath();
      cx.arc(z.x, z.y, z.r * pr, 0, TAU);
      cx.stroke();
      cx.fillStyle = z.col;
      cx.beginPath();
      cx.arc(z.x, z.y, 5, 0, TAU);
      cx.fill();
    } else if (z.k === "bomb") {
      cx.fillStyle = `rgba(255,60,80,${0.08 + 0.3 * pr})`;
      cx.beginPath();
      cx.arc(z.x, z.y, z.r, 0, TAU);
      cx.fill();
      cx.stroke();
      cx.beginPath();
      cx.arc(z.x, z.y, z.r * pr, 0, TAU);
      cx.stroke();
    } else if (z.k === "storm" || z.k === "cloud") {
      const R = z.r,
        storm = z.k === "storm",
        fade = Math.min(1, z.t / 0.45),
        col = z.col || (storm ? "#9ae6ff" : "#ffe14a");
      cx.globalAlpha = fade;
      const grad = cx.createRadialGradient(z.x, z.y, 0, z.x, z.y, R);
      grad.addColorStop(0, col + (storm ? "38" : "32"));
      grad.addColorStop(0.68, col + (storm ? "25" : "22"));
      grad.addColorStop(1, col + "08");
      cx.fillStyle = grad;
      cx.beginPath();
      cx.arc(z.x, z.y, R, 0, TAU);
      cx.fill();
      cx.strokeStyle = col;
      cx.lineWidth = 2;
      cx.globalAlpha = fade * 0.55;
      cx.beginPath();
      cx.arc(z.x, z.y, R, 0, TAU);
      cx.stroke();
      cx.globalAlpha = 1;
    } else if (z.k === "gpull" || z.k === "pull") {
      const R = z.r,
        fa = Math.min(1, z.t / 0.6, 0.2 + pr * 10),
        rot = G.time * 2.2;
      cx.globalAlpha = fa;
      const g = cx.createRadialGradient(z.x, z.y, 0, z.x, z.y, R);
      g.addColorStop(0, "rgba(0,0,0,.85)");
      g.addColorStop(0.35, "rgba(10,8,20,.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(z.x, z.y, R, 0, TAU);
      cx.fill();
      cx.lineWidth = 2;
      for (let j = 0; j < 3; j++) {
        cx.globalAlpha = fa * 0.75;
        cx.beginPath();
        for (let q = 0; q <= 24; q++) {
          const t = q / 24,
            rr = R * (1 - t * 0.88),
            an = (j / 3) * TAU + rot + t * 3.6,
            x = z.x + Math.cos(an) * rr,
            y = z.y + Math.sin(an) * rr;
          q ? cx.lineTo(x, y) : cx.moveTo(x, y);
        }
        cx.stroke();
      }
      for (let i = 0; i < 90; i++) {
        const ph = (G.time * (0.35 + ((i * 37) % 10) * 0.05) + i * 0.6180339) % 1,
          u = Math.pow(1 - ph, 1.8),
          rr = R * (0.08 + 0.92 * u),
          an = i * 2.399963 + ph * 4 + rot * 0.3,
          x = z.x + Math.cos(an) * rr,
          y = z.y + Math.sin(an) * rr,
          dn = 1 - rr / R;
        cx.globalAlpha = fa * (0.25 + 0.7 * dn);
        cx.fillStyle = "#000";
        cx.strokeStyle = z.col;
        cx.lineWidth = 1;
        cx.beginPath();
        cx.arc(x, y, 1.2 + 2.6 * dn, 0, TAU);
        cx.fill();
        cx.globalAlpha *= 0.5;
        cx.stroke();
      }
      cx.globalAlpha = fa;
      cx.lineWidth = 3;
      cx.beginPath();
      cx.arc(z.x, z.y, R * 0.14, 0, TAU);
      cx.stroke();
      cx.fillStyle = "#000";
      cx.beginPath();
      cx.arc(z.x, z.y, R * 0.11, 0, TAU);
      cx.fill();
    } else if (z.k === "web") {
      const R = z.r,
        n = R > 100 ? 12 : 8,
        fade = Math.min(1, z.t / 0.4),
        sh = 0.8 + 0.2 * Math.sin(G.time * 3 + z.x * 0.01),
        o = 0.2;
      cx.setLineDash([]);
      cx.globalAlpha = fade;
      cx.fillStyle = z.col + "33";
      cx.beginPath();
      cx.arc(z.x, z.y, R, 0, TAU);
      cx.fill();
      cx.lineWidth = 1.6;
      cx.globalAlpha = fade * sh;
      cx.beginPath();
      for (let i = 0; i < n; i++) {
        const an = (i / n) * TAU + o;
        cx.moveTo(z.x, z.y);
        cx.lineTo(z.x + Math.cos(an) * R, z.y + Math.sin(an) * R);
      }
      cx.stroke();
      for (let k = 1; k <= 3; k++) {
        const rr = (R * k) / 4;
        cx.beginPath();
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * TAU + o,
            a1 = ((i + 1) / n) * TAU + o,
            am = (a0 + a1) / 2,
            x1 = z.x + Math.cos(a1) * rr,
            y1 = z.y + Math.sin(a1) * rr,
            qx = z.x + Math.cos(am) * rr * 0.84,
            qy = z.y + Math.sin(am) * rr * 0.84;
          if (i === 0)
            cx.moveTo(z.x + Math.cos(a0) * rr, z.y + Math.sin(a0) * rr);
          cx.quadraticCurveTo(qx, qy, x1, y1);
        }
        cx.stroke();
      }
      cx.lineWidth = 2;
      cx.beginPath();
      cx.arc(z.x, z.y, R, 0, TAU);
      cx.stroke();
      cx.globalAlpha = 1;
    } else {
      cx.fillStyle = z.col + "30";
      cx.beginPath();
      cx.arc(z.x, z.y, z.r, 0, TAU);
      cx.fill();
      cx.stroke();
    }
    if (z.max > 0 && z.t > 0 && Number.isFinite(z.t / z.max)) {
      cx.save();
      cx.setLineDash([]);
      cx.globalAlpha = 0.95;
      cx.shadowBlur = 0;
      cx.lineWidth = 4;
      cx.strokeStyle = "#05060d";
      cx.beginPath();
      cx.arc(z.x, z.y, z.r + 5, 0, TAU);
      cx.stroke();
      cx.strokeStyle = z.col;
      cx.lineWidth = 2.5;
      cx.beginPath();
      cx.arc(
        z.x,
        z.y,
        z.r + 5,
        -Math.PI / 2,
        -Math.PI / 2 + TAU * Math.max(0, Math.min(1, z.t / z.max)),
      );
      cx.stroke();
      cx.restore();
    }
    cx.restore();
  }
  for (const z of G.zones) {
    if (!z.th || z.th.t <= 0) continue;
    const p = 1 - z.th.t / z.th.max,
      gx = z.th.x0 + (z.x - z.th.x0) * p,
      gy = z.th.y0 + (z.y - z.th.y0) * p,
      D = Math.hypot(z.x - z.th.x0, z.y - z.th.y0),
      h = Math.sin(p * Math.PI) * Math.min(90, 20 + D * 0.35);
    cx.save();
    cx.globalAlpha = 0.35;
    cx.fillStyle = "#000";
    cx.beginPath();
    cx.ellipse(gx, gy, 7, 4, 0, 0, TAU);
    cx.fill();
    cx.globalAlpha = 1;
    cx.shadowColor = z.col;
    cx.shadowBlur = 14;
    cx.fillStyle = z.col;
    cx.strokeStyle = "#ffffff";
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.arc(gx, gy - h, 6, 0, TAU);
    cx.fill();
    cx.stroke();
    cx.globalAlpha = 0.4;
    cx.beginPath();
    const bp = Math.max(0, p - 0.12),
      bh = Math.sin(bp * Math.PI) * Math.min(90, 20 + D * 0.35);
    cx.moveTo(
      z.th.x0 + (z.x - z.th.x0) * bp,
      z.th.y0 + (z.y - z.th.y0) * bp - bh,
    );
    cx.lineTo(gx, gy - h);
    cx.lineWidth = 4;
    cx.strokeStyle = z.col;
    cx.stroke();
    cx.restore();
  }
  for (const f of G.fxs) {
    if (f.fp) {
      f.x = G.pl.x;
      f.y = G.pl.y;
    }
    const p = 1 - f.t / f.max;
    cx.save();
    cx.strokeStyle = f.col;
    cx.shadowColor = f.col;
    cx.shadowBlur = 10;
    cx.lineWidth = 2;
    if (f.k === "c") {
      cx.fillStyle = f.col + "22";
      cx.beginPath();
      cx.arc(f.x, f.y, f.r, 0, TAU);
      cx.fill();
      cx.setLineDash([8, 6]);
      cx.stroke();
      cx.setLineDash([]);
      cx.beginPath();
      cx.arc(f.x, f.y, f.r * p, 0, TAU);
      cx.stroke();
    } else if (f.k === "t") {
      cx.globalAlpha = 0.25 + 0.35 * p;
      cx.fillStyle = f.col;
      cx.fillRect(f.x, f.y, f.w, f.w);
      cx.globalAlpha = 0.8;
      cx.strokeRect(f.x, f.y, f.w, f.w);
    } else if (f.k === "w") {
      cx.globalAlpha = 1 - p;
      cx.lineWidth = 1 + 6 * (1 - p);
      cx.beginPath();
      cx.arc(f.x, f.y, f.r * p, 0, TAU);
      cx.stroke();
    } else if (f.k === "cring") {
      cx.globalAlpha = 0.3 + 0.7 * p;
      cx.lineWidth = 2 + 5 * p;
      cx.beginPath();
      cx.arc(f.x, f.y, f.r * (1 - p) + 8, 0, TAU);
      cx.stroke();
    } else if (f.k === "rays") {
      cx.globalCompositeOperation = "lighter";
      cx.globalAlpha = Math.max(0, 1 - p);
      cx.lineWidth = 2 + 9 * (1 - p);
      const RL = f.len * Math.min(1, p * 3 + 0.15),
        rt = f.rot + p * 0.7;
      for (let q = 0; q < f.n; q++) {
        const an = rt + (q / f.n) * TAU;
        cx.beginPath();
        cx.moveTo(f.x + Math.cos(an) * 20, f.y + Math.sin(an) * 20);
        cx.lineTo(f.x + Math.cos(an) * RL, f.y + Math.sin(an) * RL);
        cx.stroke();
      }
    } else if (f.k === "sl") {
      const full = f.sw >= TAU - 0.01,
        e = 1 - Math.pow(1 - p, 2.2),
        st = f.a - f.sw / 2,
        hd = st + f.sw * e,
        fade = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1,
        mx = Math.min(hd - st, full ? 3.6 : 1.6);
      cx.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const tl = Math.max(0.05, mx * (1 - k * 0.28));
        cx.globalAlpha = fade * (0.22 + 0.28 * k);
        cx.lineWidth = (16 - 4.5 * k) * (full ? 1.1 : 1);
        cx.strokeStyle = k === 2 ? "#ffffff" : f.col;
        cx.beginPath();
        cx.arc(f.x, f.y, f.r * (0.9 - 0.04 * k), hd - tl, hd);
        cx.stroke();
      }
      cx.globalAlpha = fade;
      cx.translate(f.x, f.y);
      cx.rotate(hd);
      {
        const R = f.r,
          bw = Math.max(8, R * 0.075),
          h = bw * 0.55;
        cx.lineJoin = "round";
        cx.lineCap = "butt";
        cx.strokeStyle = f.col;
        cx.lineWidth = bw * 0.8;
        cx.beginPath();
        cx.moveTo(R * 0.04, 0);
        cx.lineTo(R * 0.21, 0);
        cx.stroke();
        cx.fillStyle = f.col;
        cx.strokeStyle = "#ffffff";
        cx.lineWidth = 2;
        cx.beginPath();
        cx.rect(R * 0.23 - bw * 0.28, -bw * 0.95, bw * 0.56, bw * 1.9);
        cx.fill();
        cx.stroke();
        cx.beginPath();
        cx.moveTo(R * 0.26, -h);
        cx.lineTo(R, -h);
        cx.lineTo(R * 0.93, h);
        cx.lineTo(R * 0.26, h);
        cx.closePath();
        cx.fill();
        cx.stroke();
      }
    } else if (f.k === "mx") {
      cx.globalCompositeOperation = "lighter";
      cx.globalAlpha = Math.max(0, 1 - p * 2.2);
      cx.fillStyle = "#ffffff";
      cx.beginPath();
      cx.arc(f.x, f.y, f.r * (0.25 + 0.45 * p), 0, TAU);
      cx.fill();
      cx.globalAlpha = Math.max(0, 0.5 - p * 0.6);
      cx.fillStyle = f.col;
      cx.beginPath();
      cx.arc(f.x, f.y, f.r * (0.3 + 0.7 * Math.sqrt(p)), 0, TAU);
      cx.fill();
      cx.globalAlpha = Math.max(0, 1 - p);
      cx.strokeStyle = f.col;
      cx.lineWidth = 2 + 11 * (1 - p);
      cx.beginPath();
      cx.arc(f.x, f.y, f.r * (0.15 + 0.85 * Math.sqrt(p)), 0, TAU);
      cx.stroke();
      if (p > 0.15) {
        cx.strokeStyle = "#ffffff";
        cx.lineWidth = 1 + 4 * (1 - p);
        cx.beginPath();
        cx.arc(f.x, f.y, f.r * 0.9 * Math.sqrt(p - 0.15), 0, TAU);
        cx.stroke();
      }
      cx.strokeStyle = "#ffffff";
      cx.lineWidth = 2 + 3 * (1 - p);
      cx.beginPath();
      for (let q = 0; q < 10; q++) {
        const an = f.rot + (q / 10) * TAU,
          r1 = f.r * 0.25 * p,
          r2 = f.r * (0.35 + 0.75 * Math.sqrt(p)) * (q % 2 ? 0.7 : 1);
        cx.moveTo(f.x + Math.cos(an) * r1, f.y + Math.sin(an) * r1);
        cx.lineTo(f.x + Math.cos(an) * r2, f.y + Math.sin(an) * r2);
      }
      cx.stroke();
    } else if (f.k === "zig") {
      cx.globalCompositeOperation = "lighter";
      cx.lineJoin = "round";
      cx.lineCap = "round";
      const al =
          Math.max(0, 1 - p * p * 1.1) *
          (Math.random() < 0.2 ? 0.55 : 1) *
          (f.a || 1),
        pp = (a, w, c, o) => {
          cx.globalAlpha = o * al;
          cx.strokeStyle = c;
          cx.lineWidth = w;
          cx.beginPath();
          a.forEach((q, i) =>
            i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1]),
          );
          cx.stroke();
        };
      cx.shadowBlur = 18;
      pp(f.pts, f.w * 2.6, f.col, 0.35);
      for (const b of f.brs) pp(b, f.w * 0.8, f.col, 0.6);
      pp(f.pts, f.w, f.col, 0.8);
      cx.shadowBlur = 6;
      pp(f.pts, f.w * 0.4, "#ffffff", 1);
    } else if (f.k === "txt") {
      // 浮動戰鬥文字隨時間上移並淡出，提示清楚但不長時間遮擋畫面。
      cx.globalAlpha = Math.max(0, 1 - p * 1.25);
      cx.textAlign = "center";
      cx.textBaseline = "middle";
      cx.font = `bold ${Math.max(10, f.size || 12)}px ui-monospace,monospace`;
      cx.lineJoin = "round";
      cx.lineWidth = 4;
      cx.strokeStyle = "#101018";
      cx.strokeText(f.text, f.x, f.y - p * 24);
      cx.fillStyle = f.col;
      cx.fillText(f.text, f.x, f.y - p * 24);
    } else if (f.k === "bolt") {
      cx.globalCompositeOperation = "lighter";
      cx.globalAlpha = Math.max(0, 1 - p * 1.2);
      for (let ps = 0; ps < 2; ps++) {
        cx.strokeStyle = ps ? "#ffffff" : f.col;
        cx.lineWidth = ps ? 2 : 7;
        cx.beginPath();
        for (let q = 0; q <= 14; q++) {
          const yy = f.y0 + ((f.y - f.y0) * q) / 14,
            xx =
              f.x +
              (q === 14 ? 0 : Math.sin(f.seed * (q + 1) + G.time * 60) * 22);
          q ? cx.lineTo(xx, yy) : cx.moveTo(xx, yy);
        }
        cx.stroke();
      }
    } else {
      cx.globalAlpha = 0.4 + 0.6 * p;
      cx.lineWidth = 2 + 4 * p;
      cx.beginPath();
      cx.moveTo(f.x, f.y);
      cx.lineTo(f.x + Math.cos(f.a) * f.len, f.y + Math.sin(f.a) * f.len);
      cx.stroke();
    }
    cx.restore();
  }
  cx.save();
  cx.setLineDash([8, 8]);
  cx.lineWidth = 2;
  for (const e of G.en)
    if (e.tele > 0) {
      const al = Math.max(
        0.2,
        0.3 +
          0.7 *
            (1 -
              e.tele /
                (isB(e) ? 0.6 : (e.el && ELITE[e.t].tl) || telegraphDurationOf(e.t) || 0.45)),
      );
      cx.strokeStyle =
        e.el && e.t === 1 && ((e.shc || 0) + 1) % 3 === 0
          ? `rgba(255,178,26,${al})`
          : e.el && e.t === 4 && ((e.shc || 0) + 1) % 4 === 0
            ? `rgba(160,235,255,${al})`
            : `rgba(255,42,74,${al})`;
      cx.beginPath();
      if (isB(e)) bossTele(e);
      else if (e.t === 30) teleBeams(e, 1);
      else if (usesLineTelegraph(e.t)) {
        const E2 = e.el && e.t === 2,
          dbl = E2 && ((e.shc || 0) + 1) % 2 === 0,
          cnt = e.t === 2 ? (E2 ? 7 : 5) : 1,
          sp = E2 ? (dbl ? 0.1 : 0.2) : 0.22,
          ks = Array.from({ length: cnt }, (_, q) => q - (cnt - 1) / 2);
        for (const k of ks) {
          const a = e.aim + k * sp;
          cx.moveTo(e.x, e.y);
          cx.lineTo(
            e.x + Math.cos(a) * ray(e.x, e.y, a, e.el && e.t === 7 ? 750 : 600),
            e.y + Math.sin(a) * ray(e.x, e.y, a, e.el && e.t === 7 ? 750 : 600),
          );
        }
        if (dbl) {
          cx.stroke();
          cx.beginPath();
          cx.strokeStyle = `rgba(255,178,26,${al * 0.8})`;
          for (const k of ks) {
            const a = e.aim + k * 0.26;
            cx.moveTo(e.x, e.y);
            cx.lineTo(
              e.x +
                Math.cos(a) * ray(e.x, e.y, a, e.el && e.t === 7 ? 750 : 600),
              e.y +
                Math.sin(a) * ray(e.x, e.y, a, e.el && e.t === 7 ? 750 : 600),
            );
          }
        }
      } else
        cx.arc(e.tx, e.ty, (e.el && ELITE[e.t].rg) || telegraphRadiusOf(e.t) || 30, 0, TAU);
      cx.stroke();
    }
  for (const e of G.en)
    if (e.lz > 0) {
      const c = Math.cos(e.lza),
        s = Math.sin(e.lza),
        w = Math.min(1, e.lz / 0.15),
        x2 = e.x + c * e.lzL,
        y2 = e.y + s * e.lzL,
        fl = 0.85 + 0.15 * Math.sin(G.time * 60);
      cx.save();
      cx.globalCompositeOperation = "lighter";
      cx.lineCap = "round";
      cx.beginPath();
      cx.moveTo(e.x, e.y);
      cx.lineTo(x2, y2);
      cx.globalAlpha = 0.4 * w * fl;
      cx.strokeStyle = e.col;
      cx.lineWidth = (G.pl.r + 10) * 1.6;
      cx.stroke();
      cx.globalAlpha = 0.8 * w;
      cx.lineWidth = 10;
      cx.stroke();
      cx.globalAlpha = w;
      cx.strokeStyle = "#ffffff";
      cx.lineWidth = 4;
      cx.stroke();
      cx.globalAlpha = 0.7 * w;
      cx.fillStyle = "#ffffff";
      cx.beginPath();
      cx.arc(x2, y2, 9 * fl, 0, TAU);
      cx.fill();
      cx.restore();
    }
  for (const g of G.egh) {
    cx.save();
    cx.globalAlpha = 0.55 * Math.min(1, g.t / 0.3);
    cx.translate(g.x, g.y);
    cx.rotate(Math.atan2(G.pl.y - g.y, G.pl.x - g.x));
    cx.shadowColor = g.col;
    cx.shadowBlur = 14;
    icon(cx, "e11", 0, 0, 13, g.col);
    cx.restore();
  }
  for (const e of G.en)
    if (e.sm && e.inv > 0) {
      cx.save();
      cx.globalAlpha = 0.8 * Math.min(1, e.inv / 0.3);
      cx.strokeStyle = EL_COL;
      cx.shadowColor = EL_COL;
      cx.shadowBlur = 10;
      cx.lineWidth = 2;
      cx.beginPath();
      cx.arc(e.x, e.y, e.r + 6, 0, TAU);
      cx.stroke();
      cx.restore();
    }
  cx.restore();

  if (
    fsm.state === "play" &&
    ((ta.act && Math.hypot(ta.x - ta.sx, ta.y - ta.sy) > G.CZ) ||
      (mouse.has && !G.touchOn))
  )
    drawAim();
  if (G.AA && fsm.state === "play") {
    cx.save();
    cx.lineWidth = 2;
    const t = aimT();
    if (t) {
      cx.setLineDash([]);
      cx.strokeStyle = "#ffe14a";
      cx.beginPath();
      cx.arc(t.x, t.y, t.r + 6, 0, TAU);
      cx.stroke();
      cx.setLineDash([3, 6]);
      cx.globalAlpha = 0.5;
      cx.beginPath();
      const dx = t.x - G.pl.x,
        dy = t.y - G.pl.y,
        d = Math.hypot(dx, dy) || 1;
      cx.moveTo(G.pl.x + (dx / d) * G.pl.r, G.pl.y + (dy / d) * G.pl.r);
      cx.lineTo(t.x, t.y);
      cx.stroke();
    }
    if (G.pl.ult >= 100 && !G.sd) {
      const u = ultT();
      if (u) {
        cx.setLineDash([6, 5]);
        cx.strokeStyle = "#ff4d4d";
        cx.globalAlpha = 0.9;
        cx.beginPath();
        cx.arc(u.x, u.y, u.r + 12 + Math.sin(G.time * 8) * 2, 0, TAU);
        cx.stroke();
      }
    }
    cx.restore();
  }
  for (const e of G.en) {
    if (e.gl) {
      cx.save();
      cx.globalCompositeOperation = "lighter";
      const g = cx.createRadialGradient(
        e.x,
        e.y,
        e.r * 0.3,
        e.x,
        e.y,
        e.r * 2.8,
      );
      g.addColorStop(0, e.gl + "99");
      g.addColorStop(1, e.gl + "00");
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(e.x, e.y, e.r * 2.8, 0, TAU);
      cx.fill();
      cx.restore();
    }
    cx.save();
    cx.translate(e.x, e.y);
    if (e.rec > 0) cx.globalAlpha = 0.55;
    if (e.t === 20 && !(e.vis > 0) && !(e.vul > 0)) cx.globalAlpha = 0.12;
    if (e.t === 30) cx.globalAlpha = 0.8 + 0.2 * Math.sin(G.time * 9);
    const col = e.hf > 0 ? "#ffffff" : e.col;
    cx.shadowColor = e.gl || e.col;
    cx.shadowBlur = e.gl ? 26 : 14;
    cx.rotate(e.t === 2 ? G.time * 0.8 : e.ang);
    icon(cx, "e" + e.t, 0, 0, e.r, col);
    if (e.el) {
      const s0 = cx.shadowColor,
        b0 = cx.shadowBlur;
      cx.shadowColor = EL_COL;
      cx.shadowBlur = 18;
      icon.eo = 7;
      icon(cx, "e" + e.t, 0, 0, e.r, col);
      icon.eo = 0;
      cx.shadowColor = s0;
      cx.shadowBlur = b0;
    }
    if (e.frz > 0) {
      cx.fillStyle = "#9ae6ff66";
      cx.beginPath();
      cx.arc(0, 0, e.r + 4, 0, TAU);
      cx.fill();
    }
    cx.restore();
    drawChg(e);
    if (isB(e)) drawBossFx(e);
    if (e.hp < e.mhp) {
      cx.fillStyle = "#ffffff22";
      cx.fillRect(e.x - 14, e.y + e.r + 5, 28, 3);
      cx.fillStyle = e.col;
      cx.fillRect(e.x - 14, e.y + e.r + 5, (28 * e.hp) / e.mhp, 3);
    }
  }
  if (fsm.state !== "over" || G.shown < 2) {
    cx.save();
    const p = G.pl,
      col = p.hf > 0 ? "#ffffff" : G.CHR.c;
    cx.translate(p.x, p.y);
    cx.globalAlpha = p.dashT > 0 ? 0.7 : 1;
    cx.shadowColor = col;
    cx.shadowBlur = 16;
    cx.strokeStyle = col;
    cx.fillStyle = col + "33";
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.arc(0, 0, p.r, 0, TAU);
    cx.fill();
    cx.stroke();
    // 職業光環與自訂外觀：只影響視覺，可在「個人檔案 → 設定」關閉
    if (settings.get("showAura")) drawRoleAura(cx, p.r, /^#[0-9a-f]{6}$/i.test(G.CHR?.c) ? G.CHR.c : col, G.time);
    if (settings.get("showSkin")) skinRenderer.draw(cx, p.r, G.S * G.DPR);
    if (p.sh > 0) {
      cx.strokeStyle = "#4d9bff";
      cx.globalAlpha = 0.5 + 0.3 * Math.sin(G.time * 6);
      cx.beginPath();
      cx.arc(0, 0, p.r + 7, 0, TAU);
      cx.stroke();
    }
    cx.restore();
        // 名牌：畫在玩家頭上
    const name = accountService.displayName;           // 純文字，fillText 不會解析 HTML，不需要額外跳脫
    const size = 13 / G.S;                              // 除以縮放倍率，讓字在螢幕上永遠是 13px
    cx.save();
    cx.font = `bold ${size}px system-ui, "Noto Sans TC", sans-serif`;
    
    // 1. 先量測文字寬度
    const textMetrics = cx.measureText(name);
    const textWidth = textMetrics.width;
    const textHeight = size;                            // 13px 換算後的文字高度
    
    // 2. 設定圓角矩形的內距 (Padding) 與圓角半徑 (同樣要除以 G.S 保持螢幕物理像素不變)
    const paddingX = 8 / G.S;
    const paddingY = 4 / G.S;
    const borderRadius = 4 / G.S;
    
    // 3. 計算圓角矩形的尺寸
    const rectWidth = textWidth + paddingX * 2;
    const rectHeight = textHeight + paddingY * 2;
    
    // 4. 定位文字與矩形
    // 原本文字的基準點 Y 軸
    const y = p.y - p.r - 16;                           // 16 是留給職業光環的空間，可自行調整
    
    // 因為文字是置中且底部對齊，所以矩形的左上角 (X, Y) 座標如下計算：
    const rectX = p.x - rectWidth / 2;
    const rectY = y - textHeight - paddingY;            // 從文字底部往上推算矩形頂端
    
    // 5. 先畫圓角矩形背景
    cx.beginPath();
    cx.roundRect(rectX, rectY, rectWidth, rectHeight, borderRadius);
    cx.fillStyle = "rgba(5, 6, 13, 0.65)";               // 65% 透明度的深色背景
    cx.fill();
    
    // 6. 再畫字（因為有了背景，描邊通常可省略，如果你想保留也可以取消註解）
    cx.textAlign = "center";
    cx.textBaseline = "bottom";
    cx.lineJoin = "round";
    cx.lineWidth = 3 / G.S;
    cx.strokeStyle = "#05060dcc";                       
    cx.fillStyle = "#d8f4ff";
    
    // cx.strokeText(name, p.x, y);                    // 有背景後可不描邊。若想保留雙重防護可自由開啟
    cx.fillText(name, p.x, y);
    cx.restore();

     
  }
  drawLZ();
  for (const b of G.bl) {
    cx.save();
    if (b.fl) {
      const g = Math.min(1, b.age / (b.l0 || 0.43)),
        s = (b.r0 || b.r) * (1.3 + g * 3),
        k = b.age * 9 + b.x * 0.05;
      cx.globalAlpha = 0.55 * (1 - g * 0.55);
      cx.globalCompositeOperation = "lighter";
      cx.translate(b.x, b.y);
      cx.rotate(k);
      cx.fillStyle = `hsla(${45 - g * 40},100%,${60 - g * 20}%,.9)`;
      cx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        cx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      }
      cx.closePath();
      cx.fill();
      cx.rotate(-k * 1.7);
      cx.globalAlpha *= 0.8;
      cx.beginPath();
      cx.rect(-s * 0.45, -s * 0.45, s * 0.9, s * 0.9);
      cx.fill();
    } else if (b.bm) {
      const ang = Math.atan2(b.vy, b.vx),
        spin = G.time * 30 + (b.age || 0) * 12,
        sc = b.ult ? 2.5 : 1.7,
        col = b.ult ? "#ffd23a" : "#ffb3e6",
        edge = b.ult ? "#d6ad2e" : "#c77da9";
      cx.save();
      cx.globalCompositeOperation = "source-over";
      cx.shadowBlur = 0;
      // 功能：處理「hex」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
      const hex = (r) => {
        cx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6 - Math.PI / 6,
            x = Math.cos(a) * r,
            y = Math.sin(a) * r;
          if (i === 0) cx.moveTo(x, y);
          else cx.lineTo(x, y);
        }
        cx.closePath();
      };
      if (b.ult) {
        for (let q = 3; q >= 1; q--) {
          cx.save();
          cx.translate(b.x - b.vx * 0.035 * q, b.y - b.vy * 0.035 * q);
          cx.rotate(ang + spin * 0.12);
          cx.scale(sc, sc);
          cx.globalAlpha = 0.09 / q;
          cx.fillStyle = col;
          hex(17);
          cx.fill("evenodd");
          cx.strokeStyle = edge;
          cx.lineWidth = 1.8;
          cx.stroke();
          cx.restore();
        }
      }
      cx.globalAlpha = 1;
      cx.translate(b.x, b.y);
      cx.rotate(ang + spin * 0.12);
      cx.scale(sc, sc);
      cx.rotate(spin);
      cx.fillStyle = b.ult ? "#ffd23a" : "#ffb3e6";
      cx.strokeStyle = edge;
      cx.lineWidth = b.ult ? 2 : 1.7;
      hex(17);
      cx.fill();
      cx.globalCompositeOperation = "destination-out";
      hex(9.5);
      cx.fill();
      cx.globalCompositeOperation = "source-over";
      cx.strokeStyle = edge;
      hex(17);
      cx.stroke();
      cx.strokeStyle = b.ult ? "#a98724" : "#a9688e";
      cx.lineWidth = 1.2;
      hex(9.5);
      cx.stroke();
      cx.restore();
    } else if (b.own) {
      cx.shadowColor = b.col;
      cx.shadowBlur = b.sn ? 14 : b.ult ? 18 : 12;
      const tl = (b.tl || 1) * 0.06,
        g = cx.createLinearGradient(b.x - b.vx * tl, b.y - b.vy * tl, b.x, b.y);
      g.addColorStop(0, b.col + "00");
      g.addColorStop(1, b.col + "cc");
      cx.strokeStyle = g;
      cx.lineWidth = b.r * 1.6;
      cx.lineCap = "round";
      cx.beginPath();
      cx.moveTo(b.x - b.vx * tl, b.y - b.vy * tl);
      cx.lineTo(b.x, b.y);
      cx.stroke();
      if (b.fz4) {
        cx.globalCompositeOperation = "lighter";
        cx.globalAlpha = 0.7;
        cx.fillStyle = "#9ae6ff";
        for (let q = 0; q < 3; q++) {
          const a = G.time * 3 + (q * TAU) / 3,
            tx = b.x - b.vx * tl * (0.35 + q * 0.22) + Math.cos(a) * b.r * 1.5,
            ty = b.y - b.vy * tl * (0.35 + q * 0.22) + Math.sin(a) * b.r * 1.5,
            sz = 1.2 + Math.sin(G.time * 8 + q) * 0.5;
          cx.beginPath();
          cx.moveTo(tx, ty - sz * 2);
          cx.lineTo(tx + sz, ty);
          cx.lineTo(tx, ty + sz * 2);
          cx.lineTo(tx - sz, ty);
          cx.closePath();
          cx.fill();
        }
        cx.globalAlpha = 1;
        cx.globalCompositeOperation = "source-over";
      }
      if (b.sn) {
        cx.globalCompositeOperation = "lighter";
        cx.lineJoin = "round";
        const x0 = b.x - b.vx * tl * 0.8,
          y0 = b.y - b.vy * tl * 0.8,
          L = Math.hypot(b.x - x0, b.y - y0) || 1,
          nx = -(b.y - y0) / L,
          ny = (b.x - x0) / L,
          N = 14,
          off = [];
        for (let q = 0; q <= N; q++)
          off.push(
            q === N
              ? 0
              : (Math.random() - 0.5) * 1.4 * b.r * Math.sin((q / N) * Math.PI),
          );
        for (const [w, c, a2] of [
          [b.r * 0.3, "#ffb400", 0.6],
          [b.r * 0.11, "#fff3b0", 0.75],
        ]) {
          cx.strokeStyle = c;
          cx.lineWidth = w;
          cx.globalAlpha = a2;
          cx.beginPath();
          cx.moveTo(x0, y0);
          for (let q = 1; q <= N; q++) {
            const t = q / N;
            cx.lineTo(
              x0 + (b.x - x0) * t + nx * off[q],
              y0 + (b.y - y0) * t + ny * off[q],
            );
          }
          cx.stroke();
        }
        cx.globalAlpha = 0.12 + 0.08 * Math.sin(G.time * 40);
        cx.fillStyle = "#ffe14a";
        cx.beginPath();
        cx.arc(b.x, b.y, b.r * 1.1, 0, TAU);
        cx.fill();
        cx.globalAlpha = 1;
        cx.globalCompositeOperation = "source-over";
      }
      cx.fillStyle = b.col;
      cx.beginPath();
      cx.arc(b.x, b.y, b.r * 0.8, 0, TAU);
      cx.fill();
    } else {
      cx.shadowColor = b.col;
      cx.shadowBlur = 12;
      cx.strokeStyle = b.col;
      cx.lineWidth = 2;
      cx.beginPath();
      cx.arc(b.x, b.y, b.r, 0, TAU);
      cx.stroke();
      cx.fillStyle = "#fff";
      cx.beginPath();
      cx.arc(b.x, b.y, 1.8, 0, TAU);
      cx.fill();
    }
    cx.restore();
  }
  cx.save();
  cx.globalCompositeOperation = "lighter";
  for (const p of G.pt) {
    cx.globalAlpha = Math.max(0, p.life / p.max);
    cx.fillStyle = cx.strokeStyle = p.col;
    if (p.k === "ice") {
      cx.save();
      cx.translate(p.x, p.y);
      cx.rotate(p.rot);
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(0, -p.sz * 1.8);
      cx.lineTo(p.sz * 0.8, 0);
      cx.lineTo(0, p.sz * 1.8);
      cx.lineTo(-p.sz * 0.8, 0);
      cx.closePath();
      cx.fill();
      cx.strokeStyle = "#e8fbff";
      cx.stroke();
      cx.restore();
    } else if (p.k === "elec") {
      const flick = Math.sin(G.time * 95 + p.seed) * 0.5 + 0.5,
        dx = Math.sin(p.seed + G.time * 37) * p.sz * 0.35,
        L = p.sz * (2.4 + flick * 0.8),
        x0 = p.x - dx,
        y0 = p.y - L * 0.5,
        x1 = p.x + dx * 0.35,
        y1 = p.y + L * 0.5,
        N = 7,
        off = [];
      for (let j = 0; j <= N; j++)
        off.push(
          j === 0 || j === N
            ? 0
            : Math.sin(p.seed + j * 8.7 + G.time * 48) * p.sz * 0.8,
        );
      cx.save();
      cx.globalAlpha *= 0.25 + 0.75 * flick;
      cx.globalCompositeOperation = "lighter";
      cx.lineCap = "round";
      cx.lineJoin = "round";
      for (const [w, c, a2] of [
        [p.sz * 0.9, p.col, 0.45],
        [p.sz * 0.42, "#fff0a0", 0.8],
        [Math.max(0.45, p.sz * 0.16), "#ffffff", 0.95],
      ]) {
        cx.strokeStyle = c;
        cx.shadowColor = p.col;
        cx.shadowBlur = 3 + p.sz * 1.2;
        cx.lineWidth = w;
        cx.globalAlpha =
          Math.max(0, p.life / p.max) * (0.25 + 0.75 * flick) * a2;
        cx.beginPath();
        cx.moveTo(x0, y0);
        for (let j = 1; j <= N; j++) {
          const t = j / N;
          cx.lineTo(x0 + (x1 - x0) * t + off[j], y0 + (y1 - y0) * t);
        }
        cx.stroke();
      }
      if (flick > 0.62) {
        const q = 2 + ((p.seed | 0) % 3),
          bx = x0 + ((x1 - x0) * q) / N + off[q],
          by = y0 + ((y1 - y0) * q) / N;
        cx.globalAlpha *= 0.75;
        cx.strokeStyle = "#fff5b8";
        cx.lineWidth = Math.max(0.45, p.sz * 0.22);
        cx.beginPath();
        cx.moveTo(bx, by);
        cx.lineTo(
          bx + p.sz * (0.8 + Math.sin(G.time * 53 + p.seed)),
          by + p.sz * 0.45,
        );
        cx.lineTo(bx + p.sz * 1.3, by + p.sz * 1.1);
        cx.stroke();
      }
      cx.restore();
    } else if (p.f) {
      cx.save();
      cx.translate(p.x, p.y);
      cx.rotate(p.rot);
      cx.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz);
      cx.restore();
    } else {
      cx.beginPath();
      cx.arc(p.x, p.y, p.sz, 0, TAU);
      cx.fill();
    }
  }
  cx.restore();
  drawAtmos();
  hud();
}
// 功能：處理「row」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function row(i, t, col, f, txt) {
  const u = G.HU,
    y = G.safeT + 16 * u + i * 25 * u,
    x = 12;
  cx.save();
  cx.shadowColor = col;
  cx.shadowBlur = 6;
  icon(cx, t, x + 9 * u, y, 9 * u, col);
  cx.restore();
  cx.fillStyle = "#ffffff18";
  cx.fillRect(x + 26 * u, y - 4 * u, 110 * u, 8 * u);
  cx.fillStyle = col;
  cx.fillRect(
    x + 26 * u,
    y - 4 * u,
    110 * u * Math.max(0, Math.min(1, f)),
    8 * u,
  );
  cx.fillStyle = "#d8f4ff";
  cx.font = `${11 * u}px ui-monospace,monospace`;
  cx.textAlign = "left";
  cx.textBaseline = "middle";
  cx.fillText(txt, x + 142 * u, y);
}
// 繪製 HUD 與觸控搖桿
export function hud() {
  G.itCd = Math.max(0, G.itCd - 0.017);
  cx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
  const u = G.HU,
    p = G.pl;
  drawBars();

  cx.textAlign = "right";
  cx.textBaseline = "top";
  cx.font = `bold ${16 * u}px ui-monospace,monospace`;
  const X = G.W - 12 * u;
  let y = G.safeT + 8 * u;
  cx.fillStyle = "#22e6ff";
  cx.fillText(
    G.train ? "TRAINING" : "WAVE " + G.wave + (ST().g ? "/" + ST().g : ""),
    X,
    y,
  );
  cx.fillStyle = "#ff3d9a";
  cx.fillText("ENEMY " + G.en.length, X, y + 22 * u);
  cx.fillStyle = "#ffe14a";
  cx.fillText("SCORE " + G.score, X, y + 44 * u);
  cx.fillStyle = "#ffffff99";
  cx.font = `${12 * u}px ui-monospace,monospace`;
  cx.fillText("BEST " + Math.max(G.best, G.score), X, y + 68 * u);
  cx.fillStyle = "#ffd23a";
  cx.fillText("COIN " + G.coins, X, y + 86 * u);
  cx.fillStyle = "#4de1ff";
  cx.fillText("SHARD " + G.shd, X, y + 102 * u);
  cx.fillStyle = "#ff4dff";
  cx.fillText("CORE " + G.cor, X, y + 118 * u);
  cx.fillStyle = "#ffffff";
  cx.fillText("PTS " + G.pts, X, y + 134 * u);
  if (G.banner > 0 && fsm.state === "play") {
    cx.save();
    cx.globalAlpha = Math.min(1, G.banner);
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.font = `bold ${40 * u}px ui-monospace,monospace`;
    cx.fillStyle = "#22e6ff";
    cx.shadowColor = "#22e6ff";
    cx.shadowBlur = 20;
    cx.fillText("WAVE " + G.wave, G.W / 2, G.H * 0.25);
    if (G.en.some(isB)) {
      cx.font = `bold ${18 * u}px ui-monospace,monospace`;
      cx.fillStyle = "#ff4d4d";
      cx.fillText(
        "BOSS: " + (bossCatalog.findByType(G.en.find(isB).t)?.name || "肉盾"),
        G.W / 2,
        G.H * 0.25 + 34 * u,
      );
    } else if (G.wave > 1 && NEWT().length) {
      cx.font = `bold ${18 * u}px ui-monospace,monospace`;
      cx.fillStyle = "#ffe14a";
      cx.fillText(
        "NEW: " +
          NEWT()
            .map((i) => EN[i])
            .join(" / "),
        G.W / 2,
        G.H * 0.25 + 34 * u,
      );
    }
    if (G.eliteN) {
      cx.font = `bold ${16 * u}px ui-monospace,monospace`;
      cx.fillStyle = EL_COL;
      cx.shadowColor = EL_COL;
      cx.shadowBlur = 18;
      cx.fillText(
        "⚠ 精英怪出現：" +
          Object.entries(G.eliteL)
            .map(([k, v]) => k + " ×" + v)
            .join("、"),
        G.W / 2,
        G.H * 0.25 + 62 * u,
      );
    }
    cx.restore();
  }
  if (G.touchOn && fsm.state === "play") {
    cx.lineWidth = 2;
    const m = tm.id !== null,
      a = ta.id !== null,
      R = 50 * u,
      kr = 20 * u;
    cx.strokeStyle = m ? "rgba(34,230,255,.5)" : "rgba(34,230,255,.2)";
    cx.beginPath();
    cx.arc(m ? tm.sx : 100 * u, m ? tm.sy : G.H - 100 * u, R, 0, TAU);
    cx.stroke();
    if (m) {
      const dx = tm.x - tm.sx,
        dy = tm.y - tm.sy,
        d = Math.hypot(dx, dy) || 1,
        k = Math.min(d, R) / d;
      cx.fillStyle = "rgba(34,230,255,.4)";
      cx.beginPath();
      cx.arc(tm.sx + dx * k, tm.sy + dy * k, kr, 0, TAU);
      cx.fill();
    }
    cx.strokeStyle = a ? "rgba(255,61,154,.6)" : "rgba(255,61,154,.2)";
    cx.beginPath();
    cx.arc(a ? ta.sx : G.W - 92 * u, a ? ta.sy : G.H - 92 * u, R, 0, TAU);
    cx.stroke();
    if (a) {
      cx.save();
      cx.setLineDash([4, 4]);
      cx.beginPath();
      cx.arc(ta.sx, ta.sy, G.CZ, 0, TAU);
      cx.stroke();
      cx.restore();
    }
    if (a) {
      const dx = ta.x - ta.sx,
        dy = ta.y - ta.sy,
        d = Math.hypot(dx, dy) || 1,
        k = Math.min(d, R) / d;
      cx.fillStyle =
        Math.hypot(ta.x - ta.sx, ta.y - ta.sy) > G.CZ
          ? "rgba(255,61,154,.5)"
          : "rgba(180,190,210,.45)";
      cx.beginPath();
      cx.arc(ta.sx + dx * k, ta.sy + dy * k, kr, 0, TAU);
      cx.fill();
    }
  }
  drawLast();
  drawSlots();
  drawItems();
  $("bS").lastChild.textContent = ULN[WP[p.w].id];
  $("bS").classList.toggle("r", p.ult >= 100);
  $("bD").style.opacity = p.dashCd > 0 ? 0.4 : 1;
  $("bW").textContent = WP[p.w].n;
  bus.emit(GameEvents.HUD_DRAWN);
}
// 顯示主頁/結算畫面
export function showOv(over) {
  XS.over = over ? 1 : 0;
  XS.t = "h";
  XS.fresh = 1;
  if (window.upd) window.upd();
  $("ov").classList.remove("h");
  xResult(over);
}
// 按下出戰：套用裝備、初始化並進入 play
export function start() {
    applyLO();
  setup();
  fsm.transition("play");
  $("ov").classList.add("h");
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

$("go").onclick = start;
}

