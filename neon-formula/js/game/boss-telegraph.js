/** game/boss-telegraph — Boss 攻擊預警（直線、圓圈、扇形、光束、地磚）的計算與繪製 */
import { bossIndexOf } from "../config/index.js";
import { G } from "../core/game-state.js";
import { T, TAU, cx } from "../core/viewport.js";
import { burst, hitCell, hurt, ray, solidAt } from "./battle.js";

// 功能：處理「beam」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function beam(e, ang, rf) {
  const L = ray(e.x, e.y, ang, 800),
    c = Math.cos(ang),
    s = Math.sin(ang),
    dx = G.pl.x - e.x,
    dy = G.pl.y - e.y,
    u = dx * c + dy * s;
  for (let q = 0; q < L; q += 14)
    burst(e.x + c * q, e.y + s * q, e.col, 1, 40, 3, 0.3);
  if (u > 0 && u < L && Math.abs(-dx * s + dy * c) < G.pl.r + 8) hurt(22);
  hitCell(
    Math.floor((e.x + c * (L + 4)) / T),
    Math.floor((e.y + s * (L + 4)) / T),
  );
  if (rf && L < 790) {
    const px = e.x + c * L,
      py = e.y + s * L;
    let c2 = c,
      s2 = s;
    if (solidAt(px + Math.sign(c) * 8, py)) c2 = -c;
    else if (solidAt(px, py + Math.sign(s) * 8)) s2 = -s;
    else {
      c2 = -c;
      s2 = -s;
    }
    beam({ x: px, y: py, col: e.col }, Math.atan2(s2, c2));
  }
}

// 功能：處理「tLine」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tLine(x, y, a, L) {
  const l = Math.min(L, ray(x, y, a, L));
  cx.moveTo(x, y);
  cx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
}

// 功能：處理「tCirc」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tCirc(x, y, r) {
  cx.moveTo(x + r, y);
  cx.arc(x, y, r, 0, TAU);
}

// 功能：處理「tFan」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tFan(x, y, a, n, sp, L) {
  for (let q = 0; q < n; q++)
    tLine(x, y, a + (n > 1 ? (q / (n - 1) - 0.5) * sp : 0), L);
}

// 功能：處理「teleBeams」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function teleBeams(s, n) {
  const a = Math.atan2(G.pl.y - s.y, G.pl.x - s.x);
  for (let q = 0; q < n; q++)
    tLine(s.x, s.y, a + (q - (n - 1) / 2) * 0.22, 800);
}

// 功能：處理「tTiles」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function tTiles() {
  const x0 = Math.round(G.pl.x / 70) * 70 - 175,
    y0 = Math.round(G.pl.y / 70) * 70 - 175;
  cx.rect(x0, y0, 350, 350);
}

// 功能：處理「bossTele」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossTele(e) {
  const i = bossIndexOf(e.t),
    ph = e.ph || 0,
    k = e.atk,
    A = e.aim,
    R = e.r;
  if (i === 0) {
    if (k === 0) tCirc(e.x, e.y, R + 50);
    else if (k === 1) tFan(e.x, e.y, A, 5 + ph * 2, 0.18 * (4 + ph * 2), 520);
    else {
      tLine(e.x, e.y, A - 1.2, 520);
      tLine(e.x, e.y, A + 1.2, 520);
      cx.moveTo(e.x + Math.cos(A - 1.2) * 140, e.y + Math.sin(A - 1.2) * 140);
      cx.arc(e.x, e.y, 140, A - 1.2, A + 1.2);
    }
  } else if (i === 1) {
    if (k === 0) tLine(e.x, e.y, A, 420 * (0.8 + 0.1 * ph));
    else if (k === 1) {
      tCirc(e.tx, e.ty, 85);
      tCirc(e.tx, e.ty, 150);
    } else
      for (let q = 0; q < 8; q++) {
        const t = (q / 8) * TAU;
        tCirc(e.x + Math.cos(t) * 140, e.y + Math.sin(t) * 140, 60);
      }
  } else if (i === 2) {
    if (k === 0) teleBeams(e, [1, 3, 5, 7][ph]);
    else {
      const x = G.pl.x + G.pl.vx * 0.6,
        y = G.pl.y + G.pl.vy * 0.6;
      tCirc(x, y, 55);
      tCirc(x, y, 150);
    }
  } else if (i === 3) {
    if (k === 2) {
      const n = 6 + ph * 2;
      for (let q = 0; q < n; q++) {
        const t = (q / n) * TAU;
        tCirc(e.x + Math.cos(t) * 130, e.y + Math.sin(t) * 130, 70);
      }
    } else tCirc(e.x, e.y, R + (k === 0 ? 60 : 40));
  } else if (i === 4) {
    if (k === 0) tLine(e.x, e.y, A, 520 * (0.5 + 0.08 * ph));
    else if (k === 1) {
      const n = 4 + ph * 2;
      for (let q = 0; q < n; q++) {
        const x = G.pl.x + (q - (n - 1) / 2) * 70;
        tLine(x, G.pl.y - 300, Math.PI / 2, 600);
      }
    } else tTiles();
  } else if (i === 5) {
    if (k === 0) tFan(e.x, e.y, A, 5, 0.9, 520);
    else if (k === 1) tCirc(G.pl.x, G.pl.y, 60);
    else tCirc(e.x, e.y, R + 40);
  } else if (i === 6) {
    if (k === 0) tCirc(e.x, e.y, 280);
    else if (k === 1) tCirc(G.pl.x, G.pl.y, 160);
    else tCirc(G.pl.x, G.pl.y, 190);
  } else {
    if (ph === 1 && (k === 0 || k === 2)) tTiles();
    else if (ph === 2 && k === 2) teleBeams(e, 5);
    else if (k === 1 || (ph === 3 && k === 3)) tCirc(e.x, e.y, R + 60);
    else if (k === 3) tCirc(e.x, e.y, R + 40);
    else {
      tCirc(e.x, e.y, R + 50);
      tFan(e.x, e.y, A, 5 + ph, 1.1, 520);
    }
  }
}
