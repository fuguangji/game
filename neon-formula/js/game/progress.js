/** game/progress — 存檔、關卡、結算、暫停 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { KEYS, isPlainObject, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { $ } from "../core/viewport.js";
import { keys, mouse, ta, tm } from "./battle.js";
import { bankChips } from "./chips.js";
import { bossCatalog } from "../config/index.js";
import { endTrain } from "./training.js";
import { xPause } from "../ui/menu.js";
import { showOv } from "../ui/render.js";
import { onlineState } from "./online-state.js";

export const SV = {
  coins: 0,
  up: {},
  own: [7], // 起始武器：符咒（見 weapons.js 的 STARTER_WEAPON）
  clr: [],
  sb: [],
  sel: 0,
  sh: 0,
  co: 0,
  chips: {},
  mods: {},
  chars: [0],
  char: 0,
  items: { heal: 2, shield: 1, ammo: 1 },
  bagSel: ["heal", "shield", "ammo"],
  sv: 1, // 關卡表版本（見 migrateSave）；舊存檔沒有這個欄位，載入時會補成 1
};
/** 把存檔合併進預設值；型別不符或不是有限數的欄位一律忽略（防止存檔損毀或被竄改） */
export function mergeSave(target, saved, { allowUnknown = true } = {}) {
  for (const k of Object.keys(saved)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue; // 防止原型污染
    const a = target[k], b = saved[k];
    if (!(k in target)) { if (allowUnknown) target[k] = b; continue; }
    const ok = Array.isArray(a) ? Array.isArray(b)
      : typeof a === "number" ? typeof b === "number" && Number.isFinite(b)
      : a !== null && typeof a === "object" ? isPlainObject(b)
      : typeof a === typeof b;
    if (ok) target[k] = b;
  }
}
export let SV_DEFAULTS; // 初始化在 init()

/** 關卡表版本。2 = 在「無盡深淵」前面新增 4 關，無盡從第 8 個變成最後一個（第 12 個） */
export const SAVE_STAGE_LAYOUT = 2;
const LEGACY_ENDLESS_INDEX = 8;

/**
 * 把舊版存檔搬到目前的關卡表：舊存檔的「無盡深淵」紀錄（sb[8]、選取中的關卡）移到新的最後一格，
 * 原本那一格變成新關卡（從 0 開始）。就地修改並回傳同一個物件；已經是新版或不是物件就不動。
 */
export function migrateSave(save) {
  if (!save || typeof save !== "object") return save;
  const version = Number.isFinite(save.sv) ? save.sv : 1;
  if (version >= SAVE_STAGE_LAYOUT) return save;
  const endless = STG.length - 1;
  if (endless > LEGACY_ENDLESS_INDEX) {
    if (Array.isArray(save.sb) && Number.isFinite(save.sb[LEGACY_ENDLESS_INDEX])) {
      save.sb[endless] = Math.max(Number(save.sb[endless]) || 0, save.sb[LEGACY_ENDLESS_INDEX]);
      save.sb[LEGACY_ENDLESS_INDEX] = 0;
    }
    if (Array.isArray(save.clr) && save.clr[LEGACY_ENDLESS_INDEX]) save.clr[LEGACY_ENDLESS_INDEX] = 0; // 舊的無盡紀錄不是新關卡的通關紀錄
    if (save.sel === LEGACY_ENDLESS_INDEX) save.sel = endless;
  }
  save.sv = SAVE_STAGE_LAYOUT;
  return save;
}
// 功能：保存或讀取「save」相關資料。
export let save, UL, WPR, WPC, UC, UB, CC, CN, UPD; // 初始化在 init()
export const STG = [
    { n: "訓練場", g: 5, hm: 0.8, cm: 1, dn: 0.16, c: "#3dff8f" },
    { n: "霓虹街區", g: 8, hm: 1, cm: 1.2, dn: 0.235, c: "#22e6ff" },
    { n: "數據峽谷", g: 10, hm: 1.3, cm: 1.5, dn: 0.3, c: "#b45cff" },
    { n: "虛空核心", g: 12, hm: 1.7, cm: 2, dn: 0.2, c: "#ff3d9a" },
    { n: "冰封港灣", g: 14, hm: 1.6, cm: 2.4, dn: 0.22, c: "#9ae6ff" },
    { n: "毒蜂巢穴", g: 15, hm: 1.7, cm: 2.8, dn: 0.28, c: "#9dff3d" },
    { n: "虛空裂隙", g: 16, hm: 1.8, cm: 3.2, dn: 0.2, c: "#7a7aff" },
    { n: "終焉之塔", g: 18, hm: 2, cm: 4, dn: 0.24, c: "#ff2a8a" },
    // 第 8~11 關（新增）：每關有自己的地形主題（見 tiles.js 的 density），Boss 沿用既有的（boss 欄位 = Boss 編號）
    { n: "熔岩熔爐", g: 20, hm: 2.2, cm: 4.4, dn: 0.22, c: "#ff7a3d", boss: 1 },
    { n: "雷暴平原", g: 22, hm: 2.4, cm: 4.8, dn: 0.18, c: "#ffe14a", boss: 4 },
    { n: "棱鏡迴廊", g: 24, hm: 2.6, cm: 5.2, dn: 0.26, c: "#7fffe0", boss: 2 },
    { n: "終焉黎明", g: 26, hm: 3, cm: 6, dn: 0.2, c: "#ff5a7a", boss: 7 },
    // 無盡模式必須是最後一個（g = 0）；新增關卡請插在它前面，並把 SAVE_STAGE_LAYOUT 加 1、補 migrateSave
    { n: "無盡深淵", g: 0, hm: 2.4, cm: 3, dn: 0.235, c: "#ffd23a" },
  ],
  ST = () => STG[SV.sel] || STG[0];

/**
 * 第 wave 波（Boss 波）要出哪一隻 Boss 的順序。
 * - 一般關卡：該關的 boss 欄位；沒寫就等於關卡順序（第 N 關打第 N 隻）
 * - 無盡模式：每 5 波輪流，輪完自動回到第一隻，Boss 數量增減都不必改這裡
 */
export const bossIndexAt = (wave) => (ST().g ? (ST().boss ?? SV.sel) : (Math.max(1, Math.ceil(wave / 5)) - 1) % bossCatalog.count);

/** 圖鑑用：這隻 Boss 會在哪些關卡出現（由關卡表推導，不用手寫） */
export function bossAppearance(index) {
  const stages = STG.filter((s, i) => s.g && (s.boss ?? i) === index).map((s) => `${s.n}最終波`);
  const first = 5 * (index + 1), cycle = 5 * bossCatalog.count;
  return [...stages, `無盡模式第 ${first} 波起每 ${cycle} 波`].join("；");
}
// 通關結算
export function win() {
  G.cor += Math.ceil(ST().g / 3);
  G.coins += Math.round(ST().g * 20 * ST().cm);
  fsm.transition("over");
  G.won = 1;
  SV.coins += G.coins;
  SV.sh += G.shd;
  SV.co += G.cor;
  bankChips();
  SV.clr[SV.sel] = 1;
  SV.sb[SV.sel] = Math.max(SV.sb[SV.sel] || 0, G.wave);
  save();
  G.overT = 0.6;
  G.shown = 0;
}
// 放棄本局並結算
export function quit() {
  const quitEvent = { cancel: false };
  bus.emit(GameEvents.QUIT_REQUESTED, quitEvent); // 監聽者可攔截
  if (quitEvent.cancel) return;
  if (fsm.state !== "play" && fsm.state !== "shop") return;
  if (!G.train) {
    bankChips();
    SV.coins += G.coins;
    SV.sh += G.shd;
    SV.co += G.cor;
    SV.sb[SV.sel] = Math.max(SV.sb[SV.sel] || 0, G.wave);
    save();
  }
  fsm.transition("over");
  G.shown = 1;
  $("sh").classList.add("h");
  showOv(G.train ? 0 : 1);
  endTrain();
}
// 暫停：清除輸入並顯示暫停選單
export function pause() {
  if (onlineState.active) { if (!document.hidden) onlineState.onPauseRequest?.(); return; } // 線上對戰：別人還在打，不能凍結
  if (fsm.state !== "play") return;
  fsm.transition("pause");
  xPause();
  for (const k in keys) keys[k] = false;
  mouse.down = false;
  tm.id = null;
  ta.id = null;
  ta.act = false;
  G.drag = null;
  $("ps").classList.remove("h");
}
// 從暫停回到戰鬥
export function resume() {
  if (fsm.state !== "pause") return;
  fsm.transition("play");
  $("ps").classList.add("h");
  bus.emit(GameEvents.GAME_RESUMED);
}
// 切換暫停
export function togglePause() {
  if (fsm.state === "play") pause();
  else if (fsm.state === "pause") resume();
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.AA = 1;
G.tgLast = null;
G.coins = 0;
G.RUN = { dmg: 0 };
SV_DEFAULTS = JSON.parse(JSON.stringify(SV));
 // 預設存檔（套用雲端存檔時當底）
mergeSave(SV, store.getJSON(KEYS.save, isPlainObject, {}));
migrateSave(SV);
save = () => {
    store.setJSON(KEYS.save, SV);
  };
UL = (k) => (SV.up[k] || 0) + ((G.CHR && G.CHR["L" + k]) || 0);
WPR = [
    // 武器價格（索引＝武器編號，見 weapons.js 的順序）：青羽鎩、未雨鎩、閃霰劍、塵流懸液、噐體熔融、銘骨衍枝曲、驥隱流楓、符咒（起始，免費）
    1000, 1000, 1300, 1000, 1200, 1000, 1400, 0, 1000, 1500
  ];
WPC = Array(WPR.length).fill("coins");
UC = {
    hp: "sh",
    spd: "sh",
    dsh: "sh",
    mag: "sh",
    reg: "sh",
    dmg: "co",
    gold: "co",
  };
UB = { hp: 40, spd: 50, dsh: 50, mag: 60, reg: 60, dmg: 8, gold: 8 };
CC = { coins: "#ffd23a", sh: "#4de1ff", co: "#ff4dff" };
CN = { coins: "金幣", sh: "碎片", co: "晶核" };
UPD = [
    { k: "hp", n: "最大血量", d: "+10", b: 60, m: 10 },
    { k: "spd", n: "移動速度", d: "+4%", b: 80, m: 8 },
    { k: "mag", n: "彈匣容量", d: "+10%", b: 90, m: 8 },
    { k: "reg", n: "彈藥回復", d: "+8%", b: 90, m: 8 },
    { k: "dmg", n: "傷害", d: "+6%", b: 120, m: 10 },
    { k: "dsh", n: "衝刺冷卻", d: "-6%", b: 80, m: 6 },
    { k: "gold", n: "金幣加成", d: "+10%", b: 100, m: 8 },
  ];

G.won = 0;
G.shd = 0;
G.cor = 0;
G.pts = 0;
G.train = false;
G.god = true;
G.fz = false;
G.inf = true;

$("qt").onclick = pause;

$("rs").onclick = resume;

$("qb").onclick = () => {
  $("ps").classList.add("h");
  fsm.transition("play");
  quit();
};

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
}

