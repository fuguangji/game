/** game/pickups — 掉落物、經濟、道具 */
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { TAU, cx } from "../core/viewport.js";
import { PC, PSPD } from "../game-config.js";
import { blocked, burst } from "./battle.js";
import { isB } from "./boss.js";
import { chipToast } from "./chips.js";
import { explode } from "./physics.js";
import { SV, UB, UC, WPC, WPR, save } from "./progress.js";
import { WP } from "./weapons.js";
import { icon } from "../icons.js";
import { enemyCatalog } from "../config/index.js";

// 功能：處理「jit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function jit(x, y) {
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * TAU,
      r = 8 + Math.random() * 30,
      qx = x + Math.cos(a) * r,
      qy = y + Math.sin(a) * r;
    if (!blocked(qx, qy, 6)) return { x: qx, y: qy };
  }
  return { x, y };
}
// 功能：處理「cur」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function cur(t, x, y, v) {
  if (G.pk.length >= 80 && !G.BK2) return;
  const j = jit(x, y);
  G.pk.push({ x: j.x, y: j.y, t, v, life: 14 });
}
// 功能：處理「collectPk」相關操作與狀態更新。
export function collectPk(q, n) {
  const p = G.pl;
  if (q.t === "coin") G.coins += q.v;
  else if (q.t === "shard") G.shd += q.v;
  else if (q.t === "core") G.cor += q.v;
  else if (q.t === "chip") (G.chp.push(q.v), chipToast(q.v));
  else if (q.t === "heal") p.hp = Math.min(p.mhp, p.hp + 30);
  else if (q.t === "ammo") {
    for (const w of WP) w.am = Math.min(w.ms, w.am + w.ms * 0.4);
    for (const w of WP) w.um = Math.min(100, (w.um || 0) + 25);
  } else if (q.t === "shield") p.sh = Math.min(60, p.sh + 30);
  else p.boost = Math.min(10, Math.max(0, p.boost) + 6);
  burst(q.x, q.y, PC[q.t], n || 14, 200, 2.5, 0.5);
}
// 功能：處理「vacAll」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function vacAll() {
  for (const q of G.pk) {
    q.vac = 1;
    q.vs = 60;
    q.dl = Math.random() * 0.45;
    q.life = 99;
  }
  G.fxs.push({
    k: "cring",
    x: G.pl.x,
    y: G.pl.y,
    r: 170,
    t: 0.7,
    max: 0.7,
    col: "#ffffff",
  });
}
// 功能：處理「ucost」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ucost(u, lv) {
  return UC[u.k] === "sh"
    ? Math.round(UB[u.k] * (1 + lv))
    : Math.round(UB[u.k] * (1 + lv * 0.9));
}
// 購買武器
export function buyW(i) {
  const K = WPC[i];
  if (SV[K] >= WPR[i]) {
    SV[K] -= WPR[i];
    SV.own.push(i);
    save();
    window.upd();
  }
}
// 功能：處理「coin」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function coin(x, y, v) {
  cur("coin", x, y, v);
}
export const AIMR = 170,
  NEWT = () => enemyCatalog.typesIntroducedAt(G.wave),
  EN = [
    "追擊",
    "狙擊",
    "散射",
    "投擲",
    "緩速",
    "牽引",
    "召喚",
    "雷射",
    "衝鋒",
    "築牆",
    "環射",
    "瞬移",
    "分裂",
    "迫擊",
  ];
// 功能：處理「cone」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function cone() {
  const w = WP[G.pl.w],
    mf = Math.min(1, Math.hypot(G.pl.vx, G.pl.vy) / (PSPD * 1.4));
  return w.acc + w.mp * mf + G.pl.rc + (w.n1 === 1 ? w.sp / 2 : 0);
}
// 功能：處理「LAY」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function LAY() {
  const u = G.HU,
    n = WP.length,
    sz = 58 * u,
    g = 10 * u,
    bm = 22 * u,
    hw = n * sz + (n - 1) * g,
    x0 = G.W / 2 - hw / 2,
    sy = G.H - sz - bm,
    por = G.H > G.W * 1.05,
    isz = 46 * u,
    ig = 8 * u,
    ni = BAG().length;
  let ix, iy;
  if (por) {
    ix = G.W / 2 - (ni * isz + Math.max(0, ni - 1) * ig) / 2;
    iy = sy - isz - 8 * u;
  } else {
    ix = x0 + hw + 16 * u;
    iy = sy + (sz - isz);
  }
  const bh = 11 * u;
  return {
    u,
    n,
    sz,
    g,
    hw,
    x0,
    sy,
    por,
    isz,
    ig,
    ix,
    iy,
    bh,
    by: (por ? iy : sy) - bh - 8 * u,
  };
}
// 功能：處理「slotR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function slotR(i) {
  const L = LAY();
  return { x: L.x0 + i * (L.sz + L.g), y: L.sy, w: L.sz };
}

export let ITM, ITK; // 初始化在 init()
// 功能：取得背包中有效且符合槽位上限的道具清單。
export const BAG = () => (SV.bagSel || []).filter((k) => ITM[k]).slice(0, 3);
// 功能：使用指定背包道具並套用效果。
export function useItem(k) {
  if (fsm.state !== "play" || !k || !ITM[k] || G.itCd > 0) return;
  if (!G.train && !(SV.items[k] > 0)) return;
  const p = G.pl;
  if (k === "heal") {
    if (p.hp >= p.mhp) return;
    p.hp = Math.min(p.mhp, p.hp + p.mhp / 2);
  } else if (k === "shield") {
    if (p.sh >= 60) return;
    p.sh = Math.min(60, p.sh + 40);
  } else if (k === "ammo") {
    for (const w of WP) w.am = w.ms;
  } else if (k === "ult") {
    if (p.ult >= 100) return;
    p.ult = 100;
  } else if (k === "bomb") {
    explode({
      x: p.x,
      y: p.y,
      ex: 240,
      dmg: 90,
      kb: 500,
      wd: 2,
      col: ITM.bomb.c,
    });
    for (const e of G.en)
      if (e.hp > 0 && !isB(e) && Math.hypot(e.x - p.x, e.y - p.y) < 240)
        e.stn = Math.max(e.stn || 0, 1);
  } else p.boost = Math.min(10, Math.max(0, p.boost) + 10);
  if (!G.train) {
    SV.items[k]--;
    save();
  }
  G.itCd = 0.5;
  burst(p.x, p.y, ITM[k].c, 18, 220, 2.5, 0.5);
  G.fxs.push({
    k: "w",
    x: p.x,
    y: p.y,
    r: 90,
    t: 0.4,
    max: 0.4,
    col: ITM[k].c,
  });
}
// 功能：處理「itemR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function itemR(i) {
  const L = LAY();
  return { x: L.ix + i * (L.isz + L.ig), y: L.iy, w: L.isz };
}
// 功能：判斷「itemAt」所需的條件或位置。
export function itemAt(x, y) {
  const b = BAG();
  for (let i = 0; i < b.length; i++) {
    const r = itemR(i);
    if (
      x >= r.x - 4 &&
      x <= r.x + r.w + 4 &&
      y >= r.y - 4 &&
      y <= r.y + r.w + 4
    )
      return i;
  }
  return -1;
}
// 功能：繪製或建立「drawItems」所需的畫面元素。
export function drawItems() {
  if (fsm.state !== "play") return;
  const b = BAG(),
    u = G.HU;
  for (let i = 0; i < b.length; i++) {
    const k = b[i],
      t = ITM[k],
      r = itemR(i),
      n = G.train ? "∞" : SV.items[k] || 0,
      dim = !G.train && !n;
    cx.save();
    cx.globalAlpha = dim ? 0.4 : 1;
    cx.fillStyle = "#05060d99";
    cx.strokeStyle = t.c + "aa";
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.rect(r.x, r.y, r.w, r.w);
    cx.fill();
    cx.stroke();
    icon(cx, t.ic, r.x + r.w / 2, r.y + r.w * 0.4, r.w * 0.22, t.c);
    cx.fillStyle = "#d8f4ff";
    cx.font = `${10 * u}px system-ui`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText(t.n, r.x + r.w / 2, r.y + r.w * 0.78);
    cx.fillStyle = t.c;
    cx.font = `bold ${10 * u}px ui-monospace,monospace`;
    cx.textAlign = "right";
    cx.textBaseline = "top";
    cx.fillText("x" + n, r.x + r.w - 3, r.y + 3);
    cx.fillStyle = "#ffffff77";
    cx.textAlign = "left";
    cx.fillText(String(i + 4), r.x + 4, r.y + 3);
    cx.restore();
  }
}
// 功能：判斷「slotAt」所需的條件或位置。
export function slotAt(x, y) {
  for (let i = 0; i < WP.length; i++) {
    const r = slotR(i);
    if (
      x >= r.x - 4 &&
      x <= r.x + r.w + 4 &&
      y >= r.y - 4 &&
      y <= r.y + r.w + 4
    )
      return i;
  }
  return -1;
}
// 功能：處理「slotDown」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function slotDown(x, y, id) {
  const ii = itemAt(x, y);
  if (ii >= 0) {
    useItem(BAG()[ii]);
    return true;
  }
  const i = slotAt(x, y);
  if (i < 0) return false;
  G.drag = { from: i, x, y, id };
  return true;
}
// 功能：處理「slotUp」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function slotUp(x, y) {
  if (!G.drag) return;
  const d = G.drag,
    to = slotAt(x, y);
  G.drag = null;
  if (to < 0) return;
  if (to === d.from) G.pl.w = to;
  else {
    [WP[d.from], WP[to]] = [WP[to], WP[d.from]];
    if (!G.train) [G.LO[d.from], G.LO[to]] = [G.LO[to], G.LO[d.from]];
    if (G.pl.w === d.from) G.pl.w = to;
    else if (G.pl.w === to) G.pl.w = d.from;
    store.setJSON(KEYS.loadout, G.LO);
  }
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.BK2 = 0;

EN[26] = "爆彈客";

EN[27] = "追蹤者";

EN[28] = "治療者";

EN[29] = "陷阱師";

G.drag = null;
ITM = {
    heal: {
      n: "治療針",
      d: "回復 50% 最大血量",
      c: "#3dff8f",
      ic: "heal",
      p: 120,
    },
    shield: {
      n: "護盾卡",
      d: "護盾 +40（上限 60）",
      c: "#4d9bff",
      ic: "shield",
      p: 100,
    },
    ammo: {
      n: "彈藥包",
      d: "所有出戰槍補滿彈藥",
      c: "#ffe14a",
      ic: "ammo",
      p: 150,
    },
    ult: {
      n: "能量電池",
      d: "SUPER 立刻充滿",
      c: "#ff9a3d",
      ic: "ult",
      p: 200,
    },
    bomb: {
      n: "震波彈",
      d: "身邊大範圍爆炸，傷害並擊退敵人",
      c: "#ff5a7a",
      ic: "pull",
      p: 180,
    },
    speed: {
      n: "加速劑",
      d: "移動速度 +40%，持續 10 秒",
      c: "#ffffff",
      ic: "speed",
      p: 100,
    },
  };
ITK = Object.keys(ITM);

G.itCd = 0;
}

