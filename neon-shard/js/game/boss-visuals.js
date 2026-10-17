/** game/boss-visuals — Boss 登場、死亡、光環、氛圍等視覺效果與繪製 */
import { FIRST_BOSS_TYPE_ID, bossCatalog } from "../config/index.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { TAU, cx } from "../core/viewport.js";
import { burst } from "./battle.js";
import { bInv, bossBolts, bossRays, isB } from "./boss.js";
import { SQ, drawDummyBar } from "./ultimates.js";

// 功能：處理「flk」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function flk(e, a, d) {
  if (e.fo === undefined) e.fo = (Math.random() - 0.5) * 1.2;
  return a + e.fo * Math.max(0, Math.min(1, (d - 70) / 260));
}

// 功能：處理「flash」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function flash(col, t, a) {
  G.FL = { col, t, max: t, a };
}

// 功能：處理「slowmo」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function slowmo(v, t) {
  if (G.TSt <= 0) G.TSv = 1;
  G.TSv = Math.min(G.TSv, v);
  G.TSt = Math.max(G.TSt, t);
}

// 功能：處理「bossIntro」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossIntro(e) {
  for (let k = 0; k < 3; k++)
    G.fxs.push({
      k: "cring",
      x: e.x,
      y: e.y,
      r: 560 - k * 130,
      t: 0.9 + k * 0.25,
      max: 0.9 + k * 0.25,
      col: k ? e.col : "#ffffff",
    });
  bossBolts(e.x, e.y, e.col, 5);
  bossRays(e.x, e.y, e.col, 1.2, 16, 720);
  burst(e.x, e.y, e.col, 60, 380, 4, 1);
  slowmo(0.45, 0.6);
}

// 功能：處理「bossDeath」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossDeath(e) {
  slowmo(0.25, 0.9);
  bossRays(e.x, e.y, "#ffffff", 1.2, 20, 920);
  bossRays(e.x, e.y, e.col, 1.7, 12, 720);
  for (let k = 0; k < 3; k++)
    G.fxs.push({
      k: "w",
      x: e.x,
      y: e.y,
      r: 700 + k * 240,
      t: 0.9 + k * 0.3,
      max: 0.9 + k * 0.3,
      col: k ? e.col : "#ffffff",
    });
  const x = e.x,
    y = e.y,
    col = e.col,
    r = e.r;
  for (let k = 0; k < 9; k++)
    SQ.push({
      t: 0.12 + k * 0.11,
      fn: () => {
        const a = Math.random() * TAU,
          d = Math.random() * r * 1.1,
          px = x + Math.cos(a) * d,
          py = y + Math.sin(a) * d;
        burst(px, py, k % 2 ? "#ffffff" : col, 26, 320, 4, 0.7);
        G.fxs.push({
          k: "w",
          x: px,
          y: py,
          r: 110 + Math.random() * 90,
          t: 0.45,
          max: 0.45,
          col,
        });
        G.shake = Math.max(G.shake, 10);
      },
    });
  SQ.push({
    t: 1.15,
    fn: () => {
      burst(x, y, "#ffffff", 120, 520, 6, 1.2);
      bossBolts(x, y, col, 6);
      flash("#ffffff", 0.35, 0.5);
      G.shake = Math.max(G.shake, 26);
    },
  });
}

// 功能：處理「bossAura」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bossAura(e) {
  const f = Math.max(0, e.hp / e.mhp),
    pu = 0.5 + 0.5 * Math.sin(G.time * 3),
    rg = cx.createRadialGradient(
      e.x,
      e.y,
      e.r * 0.6,
      e.x,
      e.y,
      e.r * (2.4 + 0.3 * pu),
    );
  cx.save();
  cx.globalCompositeOperation = "lighter";
  rg.addColorStop(0, e.col + "00");
  rg.addColorStop(0.55, e.col + (f < 0.35 ? "46" : "2a"));
  rg.addColorStop(1, e.col + "00");
  cx.fillStyle = rg;
  cx.beginPath();
  cx.arc(e.x, e.y, e.r * 2.8, 0, TAU);
  cx.fill();
  const n = 5 + Math.floor((1 - f) * 5),
    sp = 1.2 + (1 - f) * 1.8;
  cx.fillStyle = e.col;
  cx.shadowColor = e.col;
  cx.shadowBlur = 12;
  for (let k = 0; k < n; k++) {
    const a = G.time * sp + (k / n) * TAU,
      rr = e.r + 18 + Math.sin(G.time * 2 + k) * 5;
    cx.save();
    cx.translate(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
    cx.rotate(a + G.time * 2);
    cx.globalAlpha = 0.85;
    cx.fillRect(-3, -3, 6, 6);
    cx.restore();
  }
  if (f < 0.35) {
    cx.strokeStyle = "#ff3a3a";
    cx.globalAlpha = 0.4 + 0.4 * Math.sin(G.time * 14);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 30 + Math.sin(G.time * 9) * 4, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}

// 功能：處理「phaseFx」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function phaseFx(e, ph) {
  slowmo(0.3, 0.5);
  G.bl = G.bl.filter((b) => b.own);
  G.fxs.push(
    { k: "w", x: e.x, y: e.y, r: 420, t: 0.7, max: 0.7, col: e.col },
    { k: "w", x: e.x, y: e.y, r: 260, t: 0.5, max: 0.5, col: "#ffffff" },
  );
  burst(e.x, e.y, e.col, 70, 420, 5, 0.9);
  G.shake = 24;
  flash(e.col, 0.5, 0.5);
  e.rec = 0.7;
  G.ptxt = 1.6;
  G.phn = ph + 1;
}

// 功能：繪製或建立「drawWarn」所需的畫面元素。
export function drawWarn() {
  const u = G.HU;
  if (G.bossIn > 0) {
    const y = G.H * 0.4;
    cx.save();
    cx.globalAlpha = Math.min(1, G.bossIn * 1.2);
    cx.fillStyle = "#ff2a4a22";
    cx.fillRect(0, y - 34 * u, G.W, 68 * u);
    cx.fillStyle = "#ff2a4a33";
    for (let sx = -((G.time * 90) % 70); sx < G.W; sx += 70) {
      cx.beginPath();
      cx.moveTo(sx, y - 34 * u);
      cx.lineTo(sx + 34, y - 34 * u);
      cx.lineTo(sx + 8, y + 34 * u);
      cx.lineTo(sx - 26, y + 34 * u);
      cx.fill();
    }
    cx.strokeStyle = "#ff2a4a";
    cx.lineWidth = 3;
    cx.beginPath();
    cx.moveTo(0, y - 34 * u);
    cx.lineTo(G.W, y - 34 * u);
    cx.moveTo(0, y + 34 * u);
    cx.lineTo(G.W, y + 34 * u);
    cx.stroke();
    cx.globalAlpha = Math.min(1, G.bossIn) * (0.6 + 0.4 * Math.sin(G.time * 16));
    cx.fillStyle = "#ff2a4a";
    cx.shadowColor = "#ff2a4a";
    cx.shadowBlur = 22;
    cx.font = `bold ${38 * u}px ui-monospace,monospace`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("WARNING", G.W / 2, y - 4 * u);
    cx.font = `bold ${15 * u}px ui-monospace,monospace`;
    cx.fillText("BOSS " + bossCatalog.get(G.bossT).name, G.W / 2, y + 22 * u);
    cx.restore();
  }
  if (G.ptxt > 0) {
    cx.save();
    cx.globalAlpha = Math.min(1, G.ptxt * 1.5);
    cx.fillStyle = G.bcol;
    cx.shadowColor = G.bcol;
    cx.shadowBlur = 20;
    cx.font = `bold ${30 * u}px ui-monospace,monospace`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("PHASE " + G.phn, G.W / 2, G.H * 0.32);
    cx.restore();
  }
}

// 功能：繪製或建立「drawAtmos」所需的畫面元素。
export function drawAtmos() {
  cx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
  if (G.bti > 0.01) {
    const g = cx.createRadialGradient(
      G.W / 2,
      G.H / 2,
      Math.min(G.W, G.H) * 0.3,
      G.W / 2,
      G.H / 2,
      Math.max(G.W, G.H) * 0.75,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, G.bcol + "88");
    cx.globalAlpha = G.bti * (0.7 + 0.3 * Math.sin(G.time * 2.5));
    cx.fillStyle = g;
    cx.fillRect(0, 0, G.W, G.H);
    cx.globalAlpha = 1;
  }
  if (G.HF > 0.01) {
    cx.globalAlpha = Math.min(0.2, G.HF * 0.28);
    cx.fillStyle = G.HC;
    cx.fillRect(0, 0, G.W, G.H);
    cx.globalAlpha = 1;
  }
  {
    const lowF =
        fsm.state === "play" && G.pl.hp > 0 && G.pl.hp / G.pl.mhp < 0.3
          ? (0.3 + 0.2 * Math.sin(G.time * 6)) *
            (1 - (G.pl.hp / G.pl.mhp / 0.3) * 0.5)
          : 0,
      hv = Math.max(G.HF, lowF);
    if (hv > 0.01) {
      const g2 = cx.createRadialGradient(
          G.W / 2,
          G.H / 2,
          Math.min(G.W, G.H) * 0.25,
          G.W / 2,
          G.H / 2,
          Math.max(G.W, G.H) * 0.72,
        ),
        col = lowF > G.HF ? "#ff1e3c" : G.HC;
      g2.addColorStop(0, "rgba(0,0,0,0)");
      g2.addColorStop(1, col + "dd");
      cx.globalAlpha = Math.min(1, hv);
      cx.fillStyle = g2;
      cx.fillRect(0, 0, G.W, G.H);
      cx.globalAlpha = hv * 0.16;
      cx.fillStyle = col;
      cx.fillRect(0, 0, G.W, G.H);
      cx.globalAlpha = 1;
    }
  }
  if (G.FL) {
    cx.globalAlpha = (G.FL.a * G.FL.t) / G.FL.max;
    cx.fillStyle = G.FL.col;
    cx.fillRect(0, 0, G.W, G.H);
    cx.globalAlpha = 1;
  }
}

// 功能：繪製或建立「drawBossFx」所需的畫面元素。
export function drawBossFx(e) {
  const i = e.t - 14;
  bossAura(e);
  cx.save();
  if (i === 0 || (i === 7 && e.ph === 0)) {
    cx.strokeStyle = e.col;
    cx.lineWidth = 6;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 9, (e.open || 0) + 0.9, (e.open || 0) + TAU - 0.9);
    cx.stroke();
  }
  if (bInv(e)) {
    cx.strokeStyle = "#4f5560";
    cx.lineWidth = 6;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 8, 0, TAU);
    cx.stroke();
  }
  if (e.vul > 0) {
    cx.strokeStyle = "#ffe14a";
    cx.shadowColor = "#ffe14a";
    cx.shadowBlur = 14;
    cx.lineWidth = 3;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 12 + Math.sin(G.time * 10) * 3, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}

// 功能：繪製或建立「drawBoss」所需的畫面元素。
export function drawBoss() {
  const e = G.en.find(isB);
  if (!e) return;
  if (e.dummy) {
    drawDummyBar(e);
    return;
  }
  const u = G.HU,
    w = Math.min(G.W * 0.4, 420),
    x = G.W / 2 - w / 2,
    y = G.safeT + 14 * u,
    f = Math.max(0, e.hp / e.mhp);
  cx.save();
  cx.fillStyle = "#05060dcc";
  cx.fillRect(x - 2, y - 2, w + 4, 12 * u + 4);
  cx.shadowColor = e.col;
  cx.shadowBlur = 10;
  e.hv =
    e.hv === undefined
      ? e.hp
      : e.hv > e.hp
        ? Math.max(e.hp, e.hv - e.mhp * 0.004)
        : e.hp;
  cx.fillStyle = "#ffffff88";
  cx.fillRect(x, y, w * Math.max(0, e.hv / e.mhp), 12 * u);
  cx.fillStyle = e.col;
  cx.fillRect(x, y, w * f, 12 * u);
  cx.save();
  cx.beginPath();
  cx.rect(x, y, w * f, 12 * u);
  cx.clip();
  cx.fillStyle = "#ffffff40";
  cx.fillRect(x + ((G.time * 130) % (w + 80)) - 40, y, 26, 12 * u);
  cx.restore();
  cx.restore();
  cx.strokeStyle = "#ffffff55";
  cx.lineWidth = 1;
  cx.strokeRect(x - 2, y - 2, w + 4, 12 * u + 4);
  for (const t of [0.25, 0.5, 0.75]) {
    cx.fillStyle = "#05060d";
    cx.fillRect(x + w * t - 1, y, 2, 12 * u);
  }
  cx.fillStyle = "#ffffff";
  cx.font = `bold ${11 * u}px ui-monospace,monospace`;
  cx.textAlign = "center";
  cx.textBaseline = "bottom";
  cx.fillText("BOSS " + bossCatalog.get(e.t - FIRST_BOSS_TYPE_ID).name, G.W / 2, y - 4);
  const sgf = e.vul > 0 ? 1 : Math.min(1, (e.sg || 0) / (e.mhp * 0.12));
  cx.fillStyle = "#05060dcc";
  cx.fillRect(x, y + 12 * u + 4, w, 5 * u);
  cx.fillStyle = e.vul > 0 ? "#ffffff" : "#ffe14a";
  cx.fillRect(x, y + 12 * u + 4, w * sgf, 5 * u);
  if (e.vul > 0) {
    cx.fillStyle = "#ffe14a";
    cx.textBaseline = "top";
    cx.fillText("BREAK!", G.W / 2, y + 20 * u);
  }
}

// 功能：處理「zoneParticle」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function zoneParticle(z, k, col) {
  if (G.pt.length >= 700) return;
  const n =
    k === "ice" ? 5 + ((Math.random() * 5) | 0) : 1 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n && G.pt.length < 700; i++) {
    const a = Math.random() * TAU,
      r = z.r * Math.sqrt(Math.random()),
      ice = k === "ice",
      life = ice ? 0.55 + Math.random() * 0.55 : 0.09 + Math.random() * 0.09;
    G.pt.push({
      x: z.x + Math.cos(a) * r,
      y: z.y + Math.sin(a) * r,
      vx: ice ? (Math.random() - 0.5) * 12 : (Math.random() - 0.5) * 22,
      vy: ice ? -18 - Math.random() * 34 : (Math.random() - 0.5) * 22,
      life,
      max: life,
      age: 0,
      col,
      sz: ice ? 1.5 + Math.random() * 4 : 1.15 + Math.random() * 1.15,
      f: 2,
      k,
      rot: Math.random() * TAU,
      vr: ice ? (Math.random() - 0.5) * 1.4 : (Math.random() - 0.5) * 5,
      seed: Math.random() * 1000,
    });
  }
}
