/** ui/aim — 瞄準線與彈道預測 */
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { N, T, TAU, cx } from "../core/viewport.js";
import { cell, ray, turLand } from "../game/battle.js";
import { BMR, aimT } from "../game/physics.js";
import { cone } from "../game/pickups.js";
import { WP } from "../game/weapons.js";

// 精確格線射線(DDA)：回傳到第一個擋住的方塊「邊界」的精確距離，線尾會剛好貼在牆面上
// RAYAX: 0=撞到左右面, 1=撞到上下面 (彈跳反射用)
export function rayK(x, y, a, m, pu) {
  if (pu === 2) return m;
  const dx = Math.cos(a),
    dy = Math.sin(a),
    sx = dx > 0 ? 1 : -1,
    sy = dy > 0 ? 1 : -1,
    bl = (v) => (pu === 1 ? v < 0 : v !== 0);
  let i = Math.floor(x / T),
    j = Math.floor(y / T);
  if (bl(cell(i, j))) return 0;
  const tdx = Math.abs(dx) < 1e-12 ? 1e30 : Math.abs(T / dx),
    tdy = Math.abs(dy) < 1e-12 ? 1e30 : Math.abs(T / dy);
  let tx =
      Math.abs(dx) < 1e-12
        ? 1e30
        : (dx > 0 ? (i + 1) * T - x : x - i * T) / Math.abs(dx),
    ty =
      Math.abs(dy) < 1e-12
        ? 1e30
        : (dy > 0 ? (j + 1) * T - y : y - j * T) / Math.abs(dy),
    t = 0;
  while (true) {
    if (Math.abs(tx - ty) < 1e-9) {
      t = tx;
      if (t >= m) return m;
      if (
        bl(cell(i + sx, j)) ||
        bl(cell(i, j + sy)) ||
        bl(cell(i + sx, j + sy))
      ) {
        G.RAYAX = 0;
        return t;
      }
      tx += tdx;
      ty += tdy;
      i += sx;
      j += sy;
      continue;
    }
    if (tx < ty) {
      t = tx;
      if (t >= m) return m;
      tx += tdx;
      i += sx;
      if (bl(cell(i, j))) {
        G.RAYAX = 0;
        return t;
      }
    } else {
      t = ty;
      if (t >= m) return m;
      ty += tdy;
      j += sy;
      if (bl(cell(i, j))) {
        G.RAYAX = 1;
        return t;
      }
    }
  }
}
// 扇形/圓形範圍：除了等角取樣，還對每個牆角多射兩條射線(角度±1e-4)，輪廓才會貼合牆面轉角、不會有縫
let FANC; // 初始化在 init()
// 功能：處理「fanPts」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function fanPts(x, y, a0, a1, R, pu) {
  if (G.FANT !== G.time) {
    FANC.clear();
    G.FANT = G.time;
  }
  const key =
      x.toFixed(1) +
      "," +
      y.toFixed(1) +
      "," +
      a0.toFixed(4) +
      "," +
      a1.toFixed(4) +
      "," +
      R.toFixed(1) +
      "," +
      pu,
    hit = FANC.get(key);
  if (hit) return hit;
  const A = [],
    n = Math.max(8, Math.ceil((a1 - a0) / 0.06));
  for (let i = 0; i <= n; i++) A.push(a0 + ((a1 - a0) * i) / n);
  if (pu !== 2) {
    // 功能：處理「solid」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
    const solid = (i, j) => {
        const v = cell(i, j);
        return pu === 1 ? v < 0 : v !== 0;
      },
      i0 = Math.max(0, Math.floor((x - R) / T)),
      i1 = Math.min(N - 1, Math.floor((x + R) / T)),
      j0 = Math.max(0, Math.floor((y - R) / T)),
      j1 = Math.min(N - 1, Math.floor((y + R) / T)),
      seen = new Set(),
      R2 = R * R;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (!solid(i, j)) continue;
        for (let u = 0; u < 2; u++)
          for (let w = 0; w < 2; w++) {
            const ci = i + u,
              cj = j + w,
              k = ci * 1000 + cj;
            if (seen.has(k)) continue;
            seen.add(k);
            const px = ci * T - x,
              py = cj * T - y;
            if (px * px + py * py > R2) continue;
            const s4 =
              (solid(ci - 1, cj - 1) ? 1 : 0) +
              (solid(ci, cj - 1) ? 1 : 0) +
              (solid(ci - 1, cj) ? 1 : 0) +
              (solid(ci, cj) ? 1 : 0);
            if (s4 === 0 || s4 === 4) continue;
            let an = Math.atan2(py, px);
            an = a0 + ((((an - a0) % TAU) + TAU) % TAU);
            for (const e of [an - 1e-4, an, an + 1e-4])
              if (e >= a0 && e <= a1) A.push(e);
          }
      }
  }
  A.sort((p, q) => p - q);
  const P = A.map((an) => {
    const l = rayK(x, y, an, R, pu);
    return [x + Math.cos(an) * l, y + Math.sin(an) * l];
  });
  FANC.set(key, P);
  return P;
}
// 功能：處理「fanG」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function fanG(x, y, a0, a1, R, pu, fill, stroke) {
  const full = a1 - a0 >= TAU - 0.01,
    P = fanPts(x, y, a0, a1, R, pu);
  cx.beginPath();
  if (full) cx.moveTo(P[0][0], P[0][1]);
  else {
    cx.moveTo(x, y);
    cx.lineTo(P[0][0], P[0][1]);
  }
  for (let i = 1; i < P.length; i++) cx.lineTo(P[i][0], P[i][1]);
  cx.closePath();
  if (fill) cx.fill();
  if (stroke) cx.stroke();
}
// 彈跳預判：用精確射線算出每一次撞牆點，並依撞到的是左右面還是上下面來反射
export function bouncePath(x, y, a, len, nb) {
  const P = [[x, y]];
  let px = x,
    py = y,
    dx = Math.cos(a),
    dy = Math.sin(a),
    left = len,
    b = 0;
  for (let g = 0; g < 24 && left > 1e-3; g++) {
    const t = rayK(px, py, Math.atan2(dy, dx), left, 0),
      hit = t < left;
    px += dx * t;
    py += dy * t;
    left -= t;
    P.push([px, py]);
    if (!hit || nb <= 0) break;
    nb--;
    b++;
    if (G.RAYAX === 0) dx = -dx;
    else dy = -dy;
    px += dx * 0.01;
    py += dy * 0.01;
  }
  return { p: P, b };
}
// 功能：處理「aimBullet」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function aimBullet(w, a, c, pu, Rt) {
  const x = G.pl.x,
    y = G.pl.y,
    half = w.n1 > 1 ? w.sp / 2 + c : c,
    cone = w.ad === "c" || !!w.fl,
    L = rayK(x, y, a, Rt, pu),
    ex = x + Math.cos(a) * L,
    ey = y + Math.sin(a) * L;
  cx.lineCap = "round";
  if (cone) {
    cx.globalAlpha = 0.14;
    fanG(x, y, a - half, a + half, Rt, pu, 1, 0);
    cx.globalAlpha = 0.42;
    cx.lineWidth = 2;
    cx.setLineDash([5, 7]);
    fanG(x, y, a - half, a + half, Rt, pu, 0, 1);
    cx.setLineDash([]);
  }
  const bw = w.bm ? BMR({}) * 2 : w.fl ? 0 : w.r * 2;
  if (bw && !(w.bn > 0)) {
    cx.save();
    cx.lineCap = "butt";
    cx.globalAlpha = w.bm ? 0.2 : 0.12;
    cx.lineWidth = bw;
    cx.beginPath();
    cx.moveTo(x, y);
    cx.lineTo(ex, ey);
    cx.stroke();
    cx.restore();
  }
  if (w.bn > 0 && !w.bm) {
    const B = bouncePath(x, y, a, Rt, w.bn),
      P = B.p;
    cx.lineWidth = 2;
    for (let i = 1; i < P.length; i++) {
      cx.globalAlpha = i === 1 ? 0.6 : 0.38;
      cx.setLineDash(i === 1 ? [] : [6, 6]);
      cx.beginPath();
      cx.moveTo(P[i - 1][0], P[i - 1][1]);
      cx.lineTo(P[i][0], P[i][1]);
      cx.stroke();
    }
    cx.setLineDash([]);
    for (let i = 1; i <= B.b && i < P.length; i++) {
      cx.globalAlpha = i === 1 ? 0.9 : 0.5;
      cx.beginPath();
      cx.arc(P[i][0], P[i][1], (w.r || 4) + (i === 1 ? 4 : 2), 0, TAU);
      cx.stroke();
    }
  } else if (w.bm) {
    cx.globalAlpha = 0.85;
    cx.lineWidth = 2;
    cx.setLineDash([7, 5]);
    cx.beginPath();
    cx.moveTo(x, y);
    cx.lineTo(ex, ey);
    cx.stroke();
    cx.setLineDash([]);
    cx.globalAlpha = 0.9;
    cx.beginPath();
    cx.arc(ex, ey, BMR({}), 0, TAU);
    cx.stroke();
  } else {
    cx.globalAlpha = 0.5;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(x, y);
    cx.lineTo(ex, ey);
    cx.stroke();
  }
  if (w.ex) {
    cx.globalAlpha = 0.12;
    cx.beginPath();
    cx.arc(ex, ey, w.ex, 0, TAU);
    cx.fill();
    cx.globalAlpha = 0.5;
    cx.lineWidth = 2;
    cx.stroke();
  }
  if (w.gp) {
    cx.globalAlpha = 0.1;
    cx.beginPath();
    cx.arc(ex, ey, 120, 0, TAU);
    cx.fill();
    cx.globalAlpha = 0.45;
    cx.lineWidth = 2;
    cx.stroke();
  }
  if (w.cs) {
    cx.setLineDash([]);
    cx.globalAlpha = 0.12;
    fanG(ex, ey, 0, TAU, 114, 0, 1, 0);
    cx.globalAlpha = 0.5;
    cx.lineWidth = 2;
    fanG(ex, ey, 0, TAU, 114, 0, 0, 1);
  }
  if (!cone) {
    cx.setLineDash(w.bm ? [8, 7] : [5, 7]);
    cx.globalAlpha = w.bm ? 0.62 : 0.4;
    cx.lineWidth = w.bm ? 3 : 2;
    cx.beginPath();
    for (const sg of [-1, 1]) {
      const aa = a + sg * half,
        l2 = rayK(x, y, aa, Rt, pu);
      cx.moveTo(x, y);
      cx.lineTo(x + Math.cos(aa) * l2, y + Math.sin(aa) * l2);
    }
    cx.stroke();
    cx.setLineDash([]);
  }
}
// 功能：繪製或建立「drawAim」所需的畫面元素。
export function drawAimLegacy() {
  const w = WP[G.pl.w];
  let a = G.pl.aim;
  if (w.slash) {
    const t = aimT();
    if (t) a = Math.atan2(t.y - G.pl.y, t.x - G.pl.x);
  }
  const c = cone(),
    pu = w.pa ? 1 : 0,
    Rt = 20 + (w.bm ? w.v * w.life * 0.35 : w.v * w.life),
    pc = w.am < 1 ? "#8a90a0" : w.c;
  cx.save();
  cx.strokeStyle = pc;
  cx.fillStyle = pc;
  if (w.slash) {
    cx.globalAlpha = 0.25;
    cx.beginPath();
    cx.moveTo(G.pl.x, G.pl.y);
    cx.arc(G.pl.x, G.pl.y, w.rg, a - w.sw / 2, a + w.sw / 2);
    cx.closePath();
    cx.fill();
    cx.globalAlpha = 0.6;
    cx.lineWidth = 2;
    cx.stroke();
    cx.globalAlpha = 0.3;
    cx.setLineDash([4, 6]);
    cx.beginPath();
    cx.arc(G.pl.x, G.pl.y, w.rg + 14, a - w.sw / 2, a + w.sw / 2);
    cx.stroke();
    {
      cx.setLineDash([]);
      cx.globalAlpha = 0.8;
      const ea = a + w.sw / 2,
        ex = G.pl.x + Math.cos(ea) * (w.rg + 14),
        ey = G.pl.y + Math.sin(ea) * (w.rg + 14);
      cx.beginPath();
      cx.moveTo(ex - Math.sin(ea) * 12, ey + Math.cos(ea) * 12);
      cx.lineTo(ex - Math.cos(ea) * 7, ey - Math.sin(ea) * 7);
      cx.lineTo(ex + Math.cos(ea) * 7, ey + Math.sin(ea) * 7);
      cx.closePath();
      cx.fill();
    }
    cx.restore();
    return;
  }
  if (w.mine || w.web || w.gren || w.tur || w.tox) {
    const d =
        w.gren || w.tox || w.tur
          ? Math.max(0, G.pl.q * 260)
          : Math.max(0, Math.min(G.pl.q * 260, ray(G.pl.x, G.pl.y, a, 260) - 12)),
      mx0 = G.pl.x + Math.cos(a) * d,
      my0 = G.pl.y + Math.sin(a) * d,
      [mx, my] = w.tur ? turLand(mx0, my0, 18) : [mx0, my0];
    cx.globalAlpha = 0.5;
    cx.lineWidth = 2;
    cx.setLineDash([6, 8]);
    cx.beginPath();
    cx.moveTo(G.pl.x, G.pl.y);
    cx.lineTo(mx, my);
    cx.stroke();
    cx.setLineDash([]);
    const rr = w.gren
      ? (w.ex || 70) * Math.sqrt((w.r || 6) / 6)
      : w.tox
        ? 85 * Math.sqrt((w.r || 5) / 5)
        : w.tur
          ? 18
          : 70;
    if (!w.tur) {
      cx.globalAlpha = 0.15;
      cx.beginPath();
      cx.arc(mx, my, rr, 0, TAU);
      cx.fill();
    }
    cx.beginPath();
    cx.arc(mx, my, rr, 0, TAU);
    cx.globalAlpha = 0.6;
    cx.stroke();
    if (w.mine) {
      cx.setLineDash([4, 5]);
      cx.beginPath();
      cx.arc(mx, my, 49, 0, TAU);
      cx.stroke();
    }
    if (w.tur) {
      cx.globalAlpha = 0.35;
      cx.setLineDash([3, 7]);
      cx.beginPath();
      cx.arc(mx, my, 250, 0, TAU);
      cx.stroke();
    }
  } else if (w.ad === "r") {
    cx.globalAlpha = 0.3;
    cx.lineWidth = 2;
    cx.setLineDash([6, 8]);
    fanG(G.pl.x, G.pl.y, 0, TAU, Rt, pu, 0, 1);
    cx.setLineDash([]);
    cx.globalAlpha = 0.08;
    fanG(G.pl.x, G.pl.y, 0, TAU, Rt, pu, 1, 0);
  } else {
    aimBullet(w, a, c, pu, Rt);
  }
  cx.restore();
}

/*
 * 瞄準線擴充註冊表：
 * - before：先畫額外提示，不取代預設瞄準線
 * - override：符合條件且 render 回傳 true 時，取代預設瞄準線
 * - after：在預設瞄準線之後畫額外提示
 * 新武器只需註冊 renderer，不必再往 drawAim 的條件鏈塞 if/else。
 */
let AIM_LINE_EXTENSIONS; // 初始化在 init()
export function registerAimLineExtension({
  id,
  phase = "override",
  priority = 0,
  supports = () => true,
  render,
}) {
  if (!id || typeof id !== "string") throw new TypeError("瞄準線擴充需要字串 id");
  if (!["before", "override", "after"].includes(phase))
    throw new TypeError('phase 必須是 "before"、"override" 或 "after"');
  if (typeof supports !== "function" || typeof render !== "function")
    throw new TypeError("supports 與 render 必須是函式");
  AIM_LINE_EXTENSIONS.set(id, { id, phase, priority, supports, render });
  return () => AIM_LINE_EXTENSIONS.delete(id);
}

export function drawAim() {
  const weapon = WP[G.pl?.w];
  if (!weapon || !G.pl) return;
  const context = {
    weapon,
    player: G.pl,
    canvas: cx,
    state: fsm.state,
    helpers: { ray, rayK, fanG, bouncePath, turLand, cone, aimT },
    drawDefault: drawAimLegacy,
  };
  const extensions = [...AIM_LINE_EXTENSIONS.values()].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
  const runPhase = (phase) => {
    for (const extension of extensions) {
      if (extension.phase !== phase) continue;
      try {
        if (!extension.supports(context)) continue;
        cx.save();
        let handled;
        try {
          handled = extension.render(context);
        } finally {
          cx.restore();
        }
        if (phase === "override" && handled === true) return true;
      } catch (error) {
        console.error(`[aim] extension "${extension.id}" failed`, error);
      }
    }
    return false;
  };
  runPhase("before");
  const overridden = runPhase("override");
  if (!overridden) drawAimLegacy();
  runPhase("after");
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {


// ===== 判定線共用工具：射線檢測 / 扇形區域 / 彈跳路徑 =====
// pu: 0=碰到任何方塊就停, 1=只被不可破壞方塊擋住(穿牆彈), 2=完全不受阻擋
G.RAYAX = 0;
FANC = new Map();

G.FANT = -1;
AIM_LINE_EXTENSIONS = new Map();
}

