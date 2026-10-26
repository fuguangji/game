/** ui/menu — 主頁、備戰、背包、關卡、商城、圖鑑 */
import { accountService } from "../account/index.js";
import { escapeHtml } from "../core/dom-utils.js";
import { G } from "../core/game-state.js";
import { fsOK, toggleFS } from "../core/input.js";
import { KEYS, store } from "../core/save-store.js";
import { $ } from "../core/viewport.js";

import { CHS } from "../game/chips.js";

import { CC, CN, SV, UL } from "../game/progress.js";

import { ALLWEAPON, MAX_LOADOUT, WD } from "../game/weapons.js";
import { mkIcon } from "../icons.js";
import { xAccount } from "./account.js";

import { xLoad, xLobby, xStage } from "./menu-lobby.js";
import { xBag } from "./menu-bag.js";
import { xShop } from "./menu-shop.js";
import { xCodex } from "./menu-codex.js";
export { xBag, xEmb, xEquip, xUnequip } from "./menu-bag.js";
export { xShop } from "./menu-shop.js";
export { trPick, xCodex, xEnemyCmp } from "./menu-codex.js";
export { xLoad, xLobby, xPause, xResult, xStage } from "./menu-lobby.js";

/* ===== NEON SHARD · 新版選單（資料與工具） ===== */
export const XCAT = [["近戰"], ["遠程"]];
// 功能：取得指定武器的分類名稱（近戰＝揮砍型，其餘為遠程；由武器資料判斷，新增武器不必改這裡）。
export const wCat = (i) => (ALLWEAPON.getWeapon()[i]?.meleeArcEnabled ? "近戰" : "遠程");
// 功能：取得武器描述中的模式欄位。
export const wMode = (i) => (WD[i] || "").split("·")[0];
// 功能：取得武器描述中的補充說明。
export const wNote = (i) => (WD[i] || "").split("·").slice(1).join("·");
export const XS = {
  t: "h",
  lc: "全部",
  ws: 0,
  sl: 0,
  sh: "up",
  sc: "全部",
  rf: -1,
  cx: "i",
  over: 0,
  fresh: 0,
};
export const CI = { coins: "coin", sh: "shard", co: "core" };
// 功能：建立介面標題或區塊標籤。
export const xh = (c, t, tag) => {
  const d = document.createElement(tag || "div");
  if (c) d.className = c;
  if (t !== undefined) d.innerHTML = t;
  return d;
};
// 功能：建立帶有文字與點擊回呼的介面按鈕。
export const xbt = (c, t, f, dis) => {
  const b = xh(c, t, "button");
  b.type = "button";
  if (f) b.onclick = f;
  if (dis) b.disabled = true;
  return b;
};
// 功能：建立指定類型的介面圖示。
export const xic = (t, c, s) => {
  const w = xh("x-ic");
  w.append(mkIcon(t, c, s || 24));
  return w;
};
// 功能：保存目前選定的武器配置。
export const xSaveLO = () => {
  store.setJSON(KEYS.loadout, G.LO);
};
// 功能：切換至指定介面分頁或遊戲狀態。
export const xGo = (t) => {
  if (t !== XS.t) {
    XS.t = t;
    XS.fresh = 1;
  }
  window.upd();
};
// 功能：更新指定介面欄位的內容。
export const xSub = (k, v) => {
  XS[k] = v;
  XS.fresh = 1;
  window.upd();
};
// 功能：依目前篩選條件整理清單並建立篩選介面。
export const xFlt = (list, cur, fn) => {
  const f = xh("x-flt");
  for (const n of list)
    f.append(xbt("x-f" + (cur === n ? " on" : ""), n, () => fn(n)));
  return f;
};
// 功能：計算武器的傷害、射速、彈速與每秒傷害等數值。
export const wStat = (o) => {
  const pel = o.mine || o.web ? 1 : o.n1,
    crit = 1 + (o.cr || 0) * ((o.cm || 1) - 1),
    ms = Math.round(o.ms0 * (1 + 0.1 * UL("mag"))),
    shot = o.dmg * pel * crit * (1 + 0.06 * UL("dmg"));
  return {
    dmg: shot,
    rate: 1 / o.cd,
    ms,
    burst: shot * ms,
    dps: (shot * (1 + 0.08 * UL("reg"))) / o.rs,
  };
};
// 功能：本行宣告多個相關輔助函式；「xmax」及同列工具供後續邏輯共用。
export const xmax = () =>
  G.XM ||
  (G.XM = (() => {
    const a = ALLWEAPON.getWeapon().map((w) => wStat(w)),
      mx = (k) => Math.max(...a.map((s) => s[k])) || 1;
    return {
      dmg: mx("dmg"),
      rate: mx("rate"),
      ms: mx("ms"),
      dps: mx("dps"),
    };
  })());
// 功能：依顯示需求格式化數值與小數位數。
export const xfmt = (v, dp) =>
  dp ? v.toFixed(v < 100 ? 1 : 0) : String(Math.round(v));
// 功能：建立介面側欄內容或操作項目。
export const xSide = (c, f) => {
  const s = xh("x-side"),
    i = xh("x-sc");
  i.dataset.sc = "r";
  i.append(...c);
  s.append(i);
  if (f) s.append(f);
  return s;
};
// 功能：加總目前已裝備或持有的芯片數量。
export const xChipTotal = () => Object.values(SV.chips).reduce((a, b) => a + b, 0);

/* ---------- 商城 ---------- */
export const XPK = [
  { n: "普通芯片包", cost: 30, k: 1, b: 0, g: 0 },
  { n: "精選芯片包", cost: 80, k: 3, b: 1, g: 0 },
  { n: "頂級芯片包", cost: 200, k: 3, b: 2, g: 1 },
];

/* ---------- 版面總管 ---------- */
const XFIT = { h: 1, b: 1, i: 1, k: 1 };
// 功能：處理介面系統「xRender」相關的資料、互動或顯示。
export function xRender() {
  const v = $("xV"),
    sv = {},
    tp = v.scrollTop,
    t = XS.t,
    fresh = XS.fresh;
  XS.fresh = 0;
  v.querySelectorAll("[data-sc]").forEach(
    (e) => (sv[e.dataset.sc] = e.scrollTop),
  );
  $("xa").dataset.t = t;
  document
    .querySelectorAll("#xn .x-tab")
    .forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  const cl = SV.clr.filter(Boolean).length;
  const TI = {
    h: ["大廳", `最高分 ${G.best}`],
    b: ["備戰", `${(CHS[SV.char] || CHS[0]).n} · 出戰 ${G.LO.length} / ${MAX_LOADOUT} 把`],
    i: ["背包", `芯片 ${xChipTotal()} 枚 · 槍械 ${SV.own.length} 把`],
    k: ["關卡", `已通關 ${cl} / 8`],
    m: ["商城", "強化、解鎖與芯片包"],
    c: ["圖鑑", "玩法、操作與敵人資料"],
    a: ["個人檔案", `歡迎回來，${escapeHtml(accountService.displayName)}`], // 暱稱來自伺服器，必須先跳脫再放進 innerHTML
  }[t];
  $("xT").innerHTML = `<b>${TI[0]}</b><small>${TI[1]}</small>`;
  const cur = $("xC");
  cur.replaceChildren();
  for (const k of ["coins", "sh", "co"]) {
    const s = document.createElement("span");
    s.style.color = CC[k];
    s.append(mkIcon(CI[k], CC[k], 15), String(SV[k]));
    s.title = CN[k];
    cur.append(s);
  }
  $("go").textContent = XS.over ? "再次出戰" : "出戰";
  v.replaceChildren();
  v.className = "x-view" + (XFIT[t] ? " fit" : "");
  ({ h: xLobby, b: xLoad, i: xBag, k: xStage, m: xShop, c: xCodex ,a: xAccount})[t](v);
  if (!fresh) {
    v.scrollTop = tp;
    v.querySelectorAll("[data-sc]").forEach((e) => {
      if (sv[e.dataset.sc] != null) e.scrollTop = sv[e.dataset.sc];
    });
  }
}
// 把舊版長頁面重組為主頁（分頁、商城、關卡選擇）
export function buildHome() {
  window.upd = xRender;
  window.showTab = (k) => xGo(k);
  document
    .querySelectorAll("#xn .x-tab")
    .forEach((b) => (b.onclick = () => xGo(b.dataset.t)));
  const fb = $("xfs");
  if (!fsOK) fb.style.display = "none";
  else fb.onclick = toggleFS;
  // 功能：處理「sync」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const sync = () =>
    document.body.classList.toggle("inmenu", !$("ov").classList.contains("h"));
  new MutationObserver(sync).observe($("ov"), {
    attributes: true,
    attributeFilter: ["class"],
  });
  sync();
  xRender();
}


/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.XM = null;




}

