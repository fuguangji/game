/** ui/hud — 補給站、血條彈藥條、瞄準輔助 HUD */
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { $, MW, T, TAU, cx } from "../core/viewport.js";
import { PC } from "../game-config.js";
import { blocked, mouse, startWave, turLand, ultMods } from "../game/battle.js";
import { drawBoss, drawWarn } from "../game/boss.js";
import { CH } from "../game/chips.js";
import { BMR } from "../game/physics.js";
import { LAY, slotR } from "../game/pickups.js";
import { SV, UL } from "../game/progress.js";
import { WP } from "../game/weapons.js";
import { icon } from "../icons.js";
import { fanG, rayK } from "./aim.js";
import { xbt, xic } from "./menu.js";
import { trMark } from "./workshop.js";

// 波次間補給站
export function openShop() {
  fsm.transition("shop");
  shopR();
  $("sh").classList.remove("h");
}
// 重繪補給站按鈕
export function shopR() {
  const L = [
      ["hp", "回復 50% 血量", 120, "heal", "立即回復"],
      ["sh", "護盾 +40", 100, "shield", "護盾上限 60"],
      ["am", "全槍補滿彈藥", 150, "ammo", "所有出戰槍"],
      ["ul", "大招充滿", 200, "ult", "立刻可釋放 SUPER"],
      ["dm", "本局傷害 +10%", 250, "chip", "最多 5 次"],
    ],
    el = $("shl");
  el.innerHTML = "";
  $("shc").textContent = "第 " + G.wave + " 波完成 · 積分 " + G.pts;
  for (const [k, n, b, ic, ds] of L) {
    const c = Math.round(b * (1 + G.wave * 0.08)),
      col = PC[ic] || "#ffe14a",
      d = xbt(
        "x-cd",
        `<span class="x-tx"><b>${n}</b><small>${k === "dm" ? ds + "（已購 " + G.RUN.dmg + "）" : ds}</small></span><span class="rt" style="color:var(--g)">${c} 積分</span>`,
      );
    d.style.setProperty("--a", col);
    d.prepend(xic(ic, col, 26));
    d.disabled = G.pts < c || (k === "dm" && G.RUN.dmg >= 5);
    d.onclick = () => {
      if (G.pts < c) return;
      G.pts -= c;
      if (k === "hp") G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + G.pl.mhp / 2);
      else if (k === "sh") G.pl.sh = Math.min(60, G.pl.sh + 40);
      else if (k === "am") {
        for (const w of WP) w.am = w.ms;
      } else if (k === "ul") G.pl.ult = 100;
      else G.RUN.dmg++;
      shopR();
    };
    el.append(d);
  }
}
// 功能：繪製或建立「drawBuffs」所需的畫面元素。
export function drawBuffs(x, yb, u) {
  const p = G.pl,
    L = [];
  if (p.boost > 0) L.push(["speed", "#ffffff", p.boost / 10]);
  if (p.slow > 0) L.push(["slow", "#4de1ff", p.slow / 2.2]);
  if (p.vuln > 0) L.push(["shard", "#ff4d6a", p.vuln / 3]);
  const pv = Math.hypot(p.pvx || 0, p.pvy || 0);
  if (pv > 6) L.push(["pull", "#ff4dff", Math.min(1, pv / 55)]);
  const s = 18 * u;
  L.forEach((b, i) => {
    const bx = x + i * (s + 6),
      by = yb - s - 4;
    cx.fillStyle = "#05060dcc";
    cx.fillRect(bx, by, s, s);
    cx.strokeStyle = b[1] + "99";
    cx.lineWidth = 1;
    cx.strokeRect(bx + 0.5, by + 0.5, s - 1, s - 1);
    icon(cx, b[0], bx + s / 2, by + s / 2 - 1, s * 0.32, b[1]);
    cx.fillStyle = b[1];
    cx.fillRect(
      bx + 2,
      by + s - 4,
      (s - 4) * Math.max(0, Math.min(1, b[2])),
      2.5,
    );
  });
}
// 功能：處理「bar」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bar(x, y, w, h, f, col, ic, txt) {
  const u = G.HU,
    ix = ic ? h + 6 : 0;
  cx.fillStyle = "#05060d99";
  cx.fillRect(x, y, w, h);
  cx.save();
  cx.shadowColor = col;
  cx.shadowBlur = 6;
  cx.fillStyle = col;
  cx.fillRect(x + ix, y + 1, (w - ix - 1) * Math.max(0, Math.min(1, f)), h - 2);
  cx.restore();
  cx.strokeStyle = col + "88";
  cx.lineWidth = 1;
  cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (ic) icon(cx, ic, x + h / 2 + 1, y + h / 2, h * 0.45, col);
  if (txt !== "") {
    cx.fillStyle = "#ffffff";
    cx.font = `bold ${9 * u}px ui-monospace,monospace`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText(txt, x + ix + (w - ix) / 2, y + h / 2 + 0.5);
  }
}
// 功能：處理「ammoBar」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ammoBar(x, y, w, h) {
  const u = G.HU,
    wp = WP[G.pl.w],
    c = 5 / wp.ms,
    n = wp.ms,
    ix = h + 6,
    tw = 24 * u,
    bx = x + ix,
    aw = w - ix - tw,
    sh = Math.floor(wp.am + 1e-6);
  cx.fillStyle = "#05060d99";
  cx.fillRect(x, y, w, h);
  icon(cx, "ammo", x + h / 2 + 1, y + h / 2, h * 0.45, wp.c);
  cx.fillStyle = "#ffffff14";
  cx.fillRect(bx, y + 1, aw, h - 2);
  cx.fillStyle = "#00000088";
  cx.fillRect(bx + (aw * n * c) / 5, y + 1, aw * (1 - (n * c) / 5), h - 2);
  cx.fillStyle = wp.c + "66";
  cx.fillRect(bx, y + 1, aw * Math.min(1, wp.am / wp.ms), h - 2);
  cx.save();
  cx.shadowColor = wp.c;
  cx.shadowBlur = 6;
  cx.fillStyle = wp.c;
  cx.fillRect(bx, y + 1, aw * Math.min(1, (sh * c) / 5), h - 2);
  cx.restore();
  cx.fillStyle = "#05060d";
  for (let k = 1; k <= n; k += wp.ms > 30 ? 10 : wp.ms > 16 ? 5 : 1)
    cx.fillRect(bx + (aw * k * c) / 5 - 0.5, y + 1, 1, h - 2);
  cx.fillStyle = "#ffffff";
  cx.font = `bold ${10 * u}px ui-monospace,monospace`;
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.fillText("x" + sh, x + w - tw / 2, y + h / 2 + 0.5);
  cx.strokeStyle = wp.c + "88";
  cx.lineWidth = 1;
  cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
const SPV = {
  0: { k: "b", l: 650, w: 8 },
  1: { k: "a", r: 290, h: 0.6 },
  2: { k: "b", l: 900, w: 28 },
  3: { k: "a", r: 310, h: 0.27 },
  4: { k: "a", r: 230, h: 0.32 },
  5: { k: "l", r: 120 },
  6: { k: "a", r: 320, h: 0.95 },
  7: { k: "r", r: [312, 408, 504] },
  8: { k: "a", r: 585, h: 0.65 },
  9: { k: "r", r: [720] },
  10: { k: "l", r: 150, c: 1 },
  11: { k: "a", r: 810, h: 0.33 },
  12: { k: "r", r: [420] },
  13: { k: "t" },
  14: { k: "l", r: 160 },
  15: { k: "f", l: 290, w: 28, h: 0.4 },
  16: { k: "r", r: [260] },
  17: { k: "l", r: 220 },
  18: { k: "l", r: 130 },
  19: { k: "l", r: 160 },
  20: { k: "tu" },
  21: { k: "l", r: 190 },
  22: { k: "r", r: [215] },
  23: { k: "cl" },
};
// 功能：繪製或建立「drawSuperDir」所需的畫面元素。
export function drawSuperDir() {
  if (G.pl.ult < 100 || fsm.state !== "play") return;
  let a,
    q,
    al = 1;
  const dg = G.sd ? Math.hypot(G.sd.x - G.sd.sx, G.sd.y - G.sd.sy) : 0;
  if (G.sd && dg > 18 * G.HU) {
    a = Math.atan2(G.sd.y - G.sd.sy, G.sd.x - G.sd.sx);
    q = Math.min(1, dg / (90 * G.HU));
  } else if (!G.sd && mouse.has && !G.touchOn) {
    a = G.pl.aim;
    q = Math.max(
      0,
      Math.min(
        1,
        Math.hypot(mouse.x / G.S + G.camx - G.pl.x, mouse.y / G.S + G.camy - G.pl.y) / 330,
      ),
    );
    al = 0.3;
  } else return;
  const id = WP[G.pl.w].id,
    um = ultMods() || { v: 1, life: 1, r: 1 },
    col = "#ffe14a",
    ox = G.pl.x,
    oy = G.pl.y,
    cA = Math.cos(a),
    sA = Math.sin(a),
    V = um.v * um.life,
    d = q * 330,
    tx = ox + cA * d,
    ty = oy + sA * d;
  cx.save();
  cx.strokeStyle = cx.fillStyle = col;
  cx.shadowColor = col;
  cx.shadowBlur = 0;
  cx.translate(-G.camx * G.S, -G.camy * G.S);
  cx.scale(G.S, G.S);
  cx.lineWidth = 2;
  cx.lineCap = "round";
  cx.lineJoin = "round";
  // 功能：處理「band」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const band = (aa, len, wd, pu) => {
      const l = rayK(ox, oy, aa, len, pu),
        ex = ox + Math.cos(aa) * l,
        ey = oy + Math.sin(aa) * l;
      cx.save();
      cx.globalAlpha = al * 0.16;
      cx.lineCap = "butt";
      cx.lineWidth = wd;
      cx.beginPath();
      cx.moveTo(ox, oy);
      cx.lineTo(ex, ey);
      cx.stroke();
      cx.globalAlpha = al;
      cx.lineWidth = 2;
      cx.setLineDash([7, 6]);
      cx.beginPath();
      cx.moveTo(ox, oy);
      cx.lineTo(ex, ey);
      cx.stroke();
      cx.restore();
      return [ex, ey];
    },
    fan = (a0, a1, R, pu, f) => {
      cx.save();
      cx.globalAlpha = al * (f === undefined ? 0.14 : f);
      fanG(ox, oy, a0, a1, R, pu, 1, 0);
      cx.globalAlpha = al;
      cx.lineWidth = 2;
      cx.setLineDash([7, 6]);
      fanG(ox, oy, a0, a1, R, pu, 0, 1);
      cx.restore();
    },
    circ = (x, y, r, f, dash) => {
      cx.save();
      if (f) {
        cx.globalAlpha = al * f;
        cx.beginPath();
        cx.arc(x, y, r, 0, TAU);
        cx.fill();
      }
      cx.globalAlpha = al;
      if (dash) cx.setLineDash(dash);
      cx.beginPath();
      cx.arc(x, y, r, 0, TAU);
      cx.stroke();
      cx.restore();
    },
    toT = () => {
      cx.save();
      cx.globalAlpha = al;
      cx.setLineDash([7, 6]);
      cx.beginPath();
      cx.moveTo(ox, oy);
      cx.lineTo(tx, ty);
      cx.stroke();
      cx.restore();
    };
  switch (id) {
    case 0:
      band(a, 16 + 648 * V, 8 * um.r, 0);
      break;
    case 1:
      fan(a - 0.6, a + 0.6, 16 + 297 * V, 0);
      break;
    case 2:
      band(a, 2205 * V, 64 * um.r, 2);
      break;
    case 3:
      fan(a - 0.25, a + 0.25, 16 + 320 * V, 0);
      break;
    case 4: {
      const gw = Math.atan2(21 * um.r, 200 * V);
      fan(a - 0.3 - gw, a + 0.3 + gw, 16 + 232 * V, 0);
      break;
    }
    case 5:
      toT();
      circ(tx, ty, 120, 0.12);
      break;
    case 6:
      fan(a - 0.95, a - 0.3, 16 + 792 * V, 0);
      fan(a + 0.3, a + 0.95, 16 + 792 * V, 0);
      break;
    case 7:
      for (const r of [312, 408, 504]) fan(0, TAU, 16 + r * V, 0, 0.06);
      break;
    case 8:
      fan(a - 0.65, a + 0.65, 16 + 585 * V, 0);
      break;
    case 9:
      fan(0, TAU, 16 + 720 * V, 0, 0.08);
      break;
    case 10:
      toT();
      circ(tx, ty, 150, 0.14);
      for (let k = 0; k < 6; k++) {
        const t = (k / 6) * TAU;
        circ(tx + Math.cos(t) * 95, ty + Math.sin(t) * 95, 60, 0.1, [4, 6]);
      }
      break;
    case 11:
      {
        const gw = Math.atan2(7.5 * um.r, 400);
        fan(a - 0.315 - gw, a + 0.315 + gw, 16 + 810 * V, 1);
      }
      break;
    case 12:
      fan(0, TAU, 16 + 1248 * V, 0, 0.06);
      break;
    case 13:
      for (const e of G.en
        .slice()
        .sort(
          (p, r) =>
            Math.hypot(p.x - ox, p.y - oy) - Math.hypot(r.x - ox, r.y - oy),
        )
        .slice(0, 10))
        circ(e.x, e.y, e.r + 8, 0);
      break;
    case 14:
      toT();
      for (let k = 0; k < 9; k++) {
        const t = (k / 9) * TAU,
          r = k ? 85 : 0,
          x = tx + Math.cos(t) * r,
          y = ty + Math.sin(t) * r;
        if (!blocked(x, y, 8)) circ(x, y, 75, 0.1);
      }
      break;
    case 15:
      {
        const hr = BMR({ ult: 1 }),
          R = 16 + 520 * 1.6 * 0.35 * V;
        for (let k = -1; k <= 1; k++) {
          const aa = a + k * 0.4,
            e = band(aa, R, hr * 2, 0);
          circ(e[0], e[1], hr, 0);
        }
      }
      break;
    case 16:
      circ(ox, oy, 260, 0.1);
      break;
    case 17:
      toT();
      circ(tx, ty, 220, 0.1);
      circ(tx, ty, 90, 0, [3, 7]);
      break;
    case 18:
      toT();
      circ(tx, ty, 130, 0.12);
      break;
    case 19:
      toT();
      circ(tx, ty, 160, 0.1);
      break;
    case 20:
      {
        const [x, y] = turLand(ox + cA * d, oy + sA * d, 36, 30);
        cx.save();
        cx.globalAlpha = al;
        cx.setLineDash([7, 6]);
        cx.beginPath();
        cx.moveTo(ox, oy);
        cx.lineTo(x, y);
        cx.stroke();
        cx.restore();
        circ(x, y, 36, 0);
        cx.save();
        cx.globalAlpha = al * 0.4;
        cx.setLineDash([3, 7]);
        fanG(x, y, 0, TAU, 420, 2, 0, 1);
        cx.restore();
      }
      break;
    case 21:
      {
        const x = Math.max(20, Math.min(MW - 20, tx)),
          y = Math.max(20, Math.min(MW - 20, ty));
        cx.save();
        cx.globalAlpha = al;
        cx.setLineDash([7, 6]);
        cx.beginPath();
        cx.moveTo(ox, oy);
        cx.lineTo(x, y);
        cx.stroke();
        cx.restore();
        circ(x, y, 190, 0.1);
      }
      break;
    case 22:
      circ(ox, oy, 215, 0.1);
      break;
    case 23:
      for (let k = 0; k < 5; k++) {
        const aa = a + (k - 2) * 0.22,
          e = band(aa, 16 + 260 * V, 22 * um.r, 0);
        cx.save();
        cx.globalAlpha = al * 0.12;
        fanG(e[0], e[1], 0, TAU, 114, 0, 1, 0);
        cx.globalAlpha = al * 0.6;
        cx.setLineDash([4, 6]);
        fanG(e[0], e[1], 0, TAU, 114, 0, 0, 1);
        cx.restore();
      }
      break;
  }
  cx.restore();
}
// 功能：繪製或建立「drawDashDir」所需的畫面元素。
export function drawDashDir() {
  if (!G.dd) return;
  const dx = G.dd.x - G.dd.sx,
    dy = G.dd.y - G.dd.sy;
  if (Math.hypot(dx, dy) <= 18 * G.HU) return;
  const a = Math.atan2(dy, dx),
    px = (G.pl.x - G.camx) * G.S,
    py = (G.pl.y - G.camy) * G.S,
    L = Math.max(60, 71 * G.S),
    ex = px + Math.cos(a) * L,
    ey = py + Math.sin(a) * L;
  cx.save();
  cx.strokeStyle = cx.fillStyle = "#22e6ff";
  cx.shadowColor = "#22e6ff";
  cx.shadowBlur = 10;
  cx.lineWidth = 3;
  cx.setLineDash([8, 6]);
  cx.beginPath();
  cx.moveTo(px, py);
  cx.lineTo(ex, ey);
  cx.stroke();
  cx.setLineDash([]);
  cx.translate(ex, ey);
  cx.rotate(a);
  cx.beginPath();
  cx.moveTo(10, 0);
  cx.lineTo(-6, -7);
  cx.lineTo(-6, 7);
  cx.closePath();
  cx.fill();
  cx.restore();
}
// 功能：處理「ring」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ring(el, f, col, flash) {
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const x = r.left + r.width / 2,
    y = r.top + r.height / 2,
    R = r.width / 2 + 6;
  cx.save();
  cx.lineWidth = 4;
  cx.strokeStyle = "#ffffff22";
  cx.beginPath();
  cx.arc(x, y, R, 0, TAU);
  cx.stroke();
  if (f > 0) {
    cx.strokeStyle = flash ? "#ffffff" : col;
    cx.shadowColor = col;
    cx.shadowBlur = flash ? 14 : 6;
    cx.lineCap = "round";
    cx.beginPath();
    cx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, f));
    cx.stroke();
  }
  cx.restore();
}
// 功能：繪製或建立「drawBars」所需的畫面元素。
export function drawBars() {
  if (G.train) trMark();
  if (fsm.state !== "play") return;
  const L = LAY(),
    u = L.u,
    p = G.pl,
    x0 = L.x0,
    x1 = x0 + L.hw,
    bh = L.bh,
    Wb = (L.hw - 8 * u) / 2,
    y = L.by;
  bar(x0, y, Wb, bh, p.hp / p.mhp, "#ff3d6a", "hp", Math.ceil(p.hp));
  if (p.sh > 0) bar(x0, y - 9 * u, Wb, 6 * u, p.sh / 60, "#4d9bff", null, "");
  ammoBar(x1 - Wb, y, Wb, bh);
  drawBuffs(x0, y - (p.sh > 0 ? 9 * u : 0), u);
  drawWarn();
  drawBoss();
  drawDashDir();
  drawSuperDir();
  ring(
    $("bS"),
    p.ult / 100,
    "#ffe14a",
    p.ult >= 100 && Math.floor(G.time * 6) % 2,
  );
  ring(
    $("bD"),
    1 - Math.max(0, p.dashCd) / (1.2 * (1 - 0.06 * UL("dsh"))),
    "#22e6ff",
    false,
  );
}
// 功能：繪製或建立「drawLast」所需的畫面元素。
export function drawLast() {
  if (fsm.state !== "play" || G.en.length > 3 || !G.en.length) return;
  const u = G.HU,
    mx = G.W / 2,
    my = G.H / 2;
  for (const e of G.en) {
    const sx = (e.x - G.camx) * G.S,
      sy = (e.y - G.camy) * G.S,
      on = sx > 20 * u && sx < G.W - 20 * u && sy > 20 * u && sy < G.H - 20 * u;
    cx.save();
    cx.strokeStyle = e.col;
    cx.fillStyle = e.col + "88";
    cx.shadowColor = e.col;
    cx.shadowBlur = 10;
    cx.lineWidth = 2;
    if (on) {
      cx.setLineDash([6, 6]);
      cx.beginPath();
      cx.arc(sx, sy, (e.r + 10) * G.S + Math.sin(G.time * 6) * 2, 0, TAU);
      cx.stroke();
    } else {
      const a = Math.atan2(sy - my, sx - mx),
        dx = Math.cos(a),
        dy = Math.sin(a),
        k = Math.min(
          (G.W / 2 - 30 * u) / (Math.abs(dx) || 1e-6),
          (G.H / 2 - 30 * u - G.safeT / 2) / (Math.abs(dy) || 1e-6),
        ),
        px = mx + dx * k,
        py = my + dy * k;
      cx.translate(px, py);
      cx.rotate(a);
      cx.globalAlpha = 0.7 + 0.3 * Math.sin(G.time * 6);
      cx.beginPath();
      cx.moveTo(13 * u, 0);
      cx.lineTo(-8 * u, -9 * u);
      cx.lineTo(-8 * u, 9 * u);
      cx.closePath();
      cx.fill();
      cx.stroke();
      cx.rotate(-a);
      cx.shadowBlur = 0;
      cx.fillStyle = "#d8f4ff";
      cx.font = `${10 * u}px ui-monospace,monospace`;
      cx.textAlign = "center";
      cx.textBaseline = "middle";
      cx.fillText(
        Math.round(Math.hypot(e.x - G.pl.x, e.y - G.pl.y) / T),
        -dx * 22 * u,
        -dy * 22 * u,
      );
    }
    cx.restore();
  }
}
const AAH = [
  "完全手動，不做任何修正",
  "只修正你準星附近的敵人，其他方向照你瞄的打",
  "修正範圍較大，但仍只會鎖定準星方向附近的敵人",
];
// 功能：處理「setAA」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function setAA(v) {
  G.AA = v;
  G.tgLast = null;
  $("aa").textContent = "自瞄：" + ["關", "輔助", "強"][G.AA];
  $("aa").classList.toggle("off", !G.AA);
  [0, 1, 2].forEach((i) => {
    const b = $("aa" + i);
    if (b) b.classList.toggle("pri", i === G.AA);
  });
  const h = $("aah");
  if (h) h.textContent = AAH[G.AA];
  store.setNumber(KEYS.autoAim, G.AA);
}
// 功能：繪製或建立「drawSlots」所需的畫面元素。
export function drawSlots() {
  if (fsm.state !== "play") return;
  const u = G.HU;
  for (let i = 0; i < WP.length; i++) {
    const r = slotR(i),
      w = WP[i],
      sel = i === G.pl.w;
    cx.save();
    cx.globalAlpha = G.drag && G.drag.from === i ? 0.35 : 1;
    cx.fillStyle = sel ? w.c + "33" : "#05060d99";
    cx.strokeStyle = sel ? w.c : w.c + "66";
    cx.lineWidth = sel ? 2.5 : 1.5;
    if (sel) {
      cx.shadowColor = w.c;
      cx.shadowBlur = 12;
    }
    cx.beginPath();
    cx.rect(r.x, r.y, r.w, r.w);
    cx.fill();
    cx.stroke();
    cx.shadowBlur = 0;
    icon(cx, "ammo", r.x + r.w / 2, r.y + r.w * 0.4, r.w * 0.24, w.c);
    cx.fillStyle = "#d8f4ff";
    cx.font = `${10 * u}px system-ui`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText(i + 1 + " " + w.n, r.x + r.w / 2, r.y + r.w * 0.76);
    {
      const mm = (G.train ? G.TM : SV.mods)[w.id] || [];
      for (let j = 0; j < mm.length; j++)
        if (CH[mm[j]]) {
          cx.fillStyle = CH[mm[j]].c;
          cx.fillRect(r.x + 5 + j * 10, r.y + 5, 7, 7);
        }
    }
    cx.fillStyle = "#ffffff22";
    cx.fillRect(r.x + 5, r.y + r.w - 9, r.w - 10, 3);
    cx.fillStyle = w.c;
    cx.fillRect(r.x + 5, r.y + r.w - 9, ((r.w - 10) * w.am) / w.ms, 3);
    {
      const um = w.um || 0;
      cx.fillStyle = "#ffffff22";
      cx.fillRect(r.x + 5, r.y + r.w - 5, r.w - 10, 3);
      cx.fillStyle =
        um >= 100 && Math.floor(G.time * 6) % 2 ? "#ffffff" : "#ffe14a";
      cx.fillRect(r.x + 5, r.y + r.w - 5, ((r.w - 10) * um) / 100, 3);
    }
    cx.restore();
  }
  if (G.drag) {
    const w = WP[G.drag.from],
      s = 58 * u;
    cx.save();
    cx.globalAlpha = 0.9;
    cx.strokeStyle = w.c;
    cx.fillStyle = w.c + "44";
    cx.shadowColor = w.c;
    cx.shadowBlur = 14;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.rect(G.drag.x - s / 2, G.drag.y - s / 2, s, s);
    cx.fill();
    cx.stroke();
    icon(cx, "ammo", G.drag.x, G.drag.y, s * 0.24, w.c);
    cx.restore();
  }
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

$("shg").onclick = () => {
  $("sh").classList.add("h");
  fsm.transition("play");
  startWave();
};


G.dd = null;
G.sd = null;

[0, 1, 2].forEach((i) => {
  $("aa" + i).onclick = () => setAA(i);
});

{
  const v0 = store.getNumber(KEYS.autoAim, { min: 0, max: 2, integer: true, fallback: 1 });
  setAA(v0);
}
}

