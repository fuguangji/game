/** game/ultimate-effects — 大招與訓練用的視覺輔助：假人、閃電折線、飄字、雲層火花 */
import { G } from "../core/game-state.js";
import { TAU, cx } from "../core/viewport.js";
import { blocked, burst, empty, mkEn } from "./battle.js";

// 功能：建立或生成「mkDummy」所需的遊戲資料。
export function mkDummy(x, y) {
  const e = mkEn(14, x, y);
  Object.assign(e, {
    t: 22,
    r: 34,
    hp: 5000,
    mhp: 5000,
    sp: 0,
    m: 1e6,
    col: "#9aa0ab",
    sc: 0,
    cd: 1e9,
    dummy: 1,
    hx: x,
    hy: y,
    hv: 5000,
  });
  return e;
}

// 功能：建立或生成「spawnDummy」所需的遊戲資料。
export function spawnDummy() {
  for (let k = G.en.length - 1; k >= 0; k--) if (G.en[k].dummy) G.en.splice(k, 1);
  const a = G.pl.aim;
  let p = { x: G.pl.x + Math.cos(a) * 260, y: G.pl.y + Math.sin(a) * 260 };
  if (blocked(p.x, p.y, 34)) p = empty(200, G.pl) || p;
  G.en.push(mkDummy(p.x, p.y));
  burst(p.x, p.y, "#ffffff", 12, 160, 2, 0.5);
}

// 功能：繪製或建立「drawDummyBar」所需的畫面元素。
export function drawDummyBar(e) {
  const u = G.HU,
    x = 8 * u,
    w = G.W - 16 * u,
    y = G.safeT + 74 * u,
    h = 14 * u,
    f = Math.max(0, e.hp / e.mhp);
  cx.save();
  cx.fillStyle = "#05060dcc";
  cx.fillRect(x - 2, y - 2, w + 4, h + 4);
  e.hv =
    e.hv === undefined
      ? e.hp
      : e.hv > e.hp
        ? Math.max(e.hp, e.hv - e.mhp * 0.004)
        : e.hp;
  cx.fillStyle = "#ffffff88";
  cx.fillRect(x, y, w * Math.max(0, e.hv / e.mhp), h);
  cx.shadowColor = e.col;
  cx.shadowBlur = 10;
  cx.fillStyle = e.col;
  cx.fillRect(x, y, w * f, h);
  cx.shadowBlur = 0;
  cx.save();
  cx.beginPath();
  cx.rect(x, y, w * f, h);
  cx.clip();
  cx.fillStyle = "#ffffff40";
  cx.fillRect(x + ((G.time * 130) % (w + 80)) - 40, y, 26, h);
  cx.restore();
  cx.strokeStyle = "#ffffff55";
  cx.lineWidth = 1;
  cx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  cx.fillStyle = "#ffffff";
  cx.font = `bold ${12 * u}px ui-monospace,monospace`;
  cx.textAlign = "center";
  cx.textBaseline = "bottom";
  cx.fillText("肉盾", G.W / 2, y - 4);
  cx.restore();
}

// 功能：建立浮動文字特效，供電荷、引爆與暈眩提示使用。
export function ftxt(x, y, text, col = "#ffffff", size = 12) {
  // 將戰鬥提示加入特效佇列，由 render() 依剩餘時間繪製並淡出。
  G.fxs.push({
    k: "txt",
    x,
    y,
    text: String(text),
    col,
    size,
    t: 1.15,
    max: 1.15,
  });
}

// 功能：計算閃電折線的隨機節點。
export function zigPts(x0, y0, x1, y1, n, amp) {
  const pts = [[x0, y0]],
    dx = x1 - x0,
    dy = y1 - y0,
    L = Math.hypot(dx, dy) || 1,
    nx = -dy / L,
    ny = dx / L;
  for (let i = 1; i < n; i++) {
    const t = i / n,
      o = (Math.random() - 0.5) * 2 * amp * (1 - Math.abs(t - 0.5) * 0.6);
    pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
  }
  pts.push([x1, y1]);
  return pts;
}

// 功能：建立閃電折線及分支特效。
export function zig(x0, y0, x1, y1, col, t, w, br, a) {
  const L = Math.hypot(x1 - x0, y1 - y0),
    n = Math.max(5, Math.round(L / 22)),
    pts = zigPts(x0, y0, x1, y1, n, Math.min(26, L * 0.12)),
    brs = [];
  for (let k = 0; k < (br || 0); k++) {
    const i = 1 + Math.floor(Math.random() * Math.max(1, pts.length - 3)),
      p = pts[i],
      a =
        Math.atan2(y1 - y0, x1 - x0) +
        (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6),
      l = L * (0.12 + Math.random() * 0.15);
    brs.push(
      zigPts(p[0], p[1], p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l, 4, 6),
    );
  }
  G.fxs.push({
    k: "zig",
    pts,
    brs,
    x: x0,
    y: y0,
    col,
    t,
    max: t,
    w: w || 5,
    a: a || 1,
  });
}

// 功能：處理「strikeFx」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function strikeFx(e) {
  zig(
    e.x + (Math.random() - 0.5) * 40,
    e.y - 300,
    e.x,
    e.y,
    "#ffe14a",
    0.22,
    3,
    1,
    0.55,
  );
  G.fxs.push({
    k: "w",
    x: e.x,
    y: e.y,
    r: 30,
    t: 0.2,
    max: 0.2,
    col: "#fff4a6",
  });
  burst(e.x, e.y, "#fff4a6", 6, 180, 2, 0.3);
}

// 功能：處理「cloudSpark」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function cloudSpark(z) {
  const a = Math.random() * TAU,
    r = Math.sqrt(Math.random()) * z.r * 0.9,
    x = z.x + Math.cos(a) * r,
    y = z.y + Math.sin(a) * r,
    b = Math.random() * TAU,
    l = 40 + Math.random() * 70;
  zig(
    x,
    y,
    x + Math.cos(b) * l,
    y + Math.sin(b) * l,
    Math.random() < 0.5 ? "#fff4a6" : "#ffe14a",
    0.1,
    1.4,
    0,
    0.4,
  );
}

// 功能：處理「cloudSky」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function cloudSky(z) {
  const x = z.x + (Math.random() - 0.5) * z.r * 1.6,
    y = z.y + (Math.random() - 0.5) * z.r * 1.2;
  zig(
    x + (Math.random() - 0.5) * 60,
    z.y - z.r * 2.2,
    x,
    y,
    "#ffe14a",
    0.14,
    1.8,
    1,
    0.35,
  );
}
