import { ELITE, EL_COL, ESTAT } from "./enemy-config.js";
import {
  BS,
  CD,
  DG,
  ESPD,
  LEG_A,
  LEG_B,
  LN,
  NE,
  PC,
  PN,
  PREF,
  PSPD,
  REGEN,
  RG,
  SH,
  TH,
  TL,
} from "./game-config.js";
import { eIcon, icon, mkEIcon, mkIcon } from "./icons.js";

/* =====================================================================
 * NEON SHARD — 整理版
 * 架構：輸入(keys/mouse/touch) -> setState 狀態機 -> update(dt) -> render()
 *   - 狀態機：menu / play / pause / shop / over（見 STATE_GRAPH）
 *   - 執行緒：路徑場 BFS 在 Web Worker 計算（flowWorkerMain），主執行緒只負責模擬與繪圖
 *   - 教學模式：文末 TUT 區塊（15 步，可跳過/上一步）；localStorage 判斷首次遊玩並自動進入，主頁「教學模式」按鈕可再次開啟
 * 命名縮寫：pl=玩家 en=敵人陣列 bl=子彈 pk=掉落物 pt=粒子 zones=地面區域 T=格寬 N=格數
 * ===================================================================== */
const $ = (id) => document.getElementById(id),
  cv = $("g"),
  cx = cv.getContext("2d");
/* 狀態機：menu(主頁) -> play(戰鬥) <-> pause / shop；play -> over(結算) -> play / menu；pause -> menu(教學中離開) */
const STATE_GRAPH = {
  menu: { play: 1 },
  play: { pause: 1, shop: 1, over: 1, menu: 1 },
  pause: { play: 1, over: 1, menu: 1 },
  shop: { play: 1, over: 1 },
  over: { play: 1, menu: 1 },
};
const STATE_HOOKS = {
  enter: { play() {}, pause() {}, shop() {}, over() {}, menu() {} },
  exit: {},
};
// 擴充點：新增狀態、轉移邊、進出狀態回呼與轉移守門條件，不必改動 setState 本體。
const STATE_EXTENSION_HOOKS = { enter: new Map(), exit: new Map() };
const STATE_TRANSITION_GUARDS = new Set();

let STATE_STRICT = false; // true：非法轉移直接拒絕；false：只在 console 警告

// 註冊或移除狀態轉移；回傳取消註冊函式，方便模組卸載。
function registerStateTransition(from, to, allowed = true) {
  if (!STATE_GRAPH[from]) STATE_GRAPH[from] = {};
  if (!STATE_GRAPH[to]) STATE_GRAPH[to] = {};
  const previous = STATE_GRAPH[from][to];
  STATE_GRAPH[from][to] = allowed ? 1 : 0;
  return () => {
    if (previous === undefined) delete STATE_GRAPH[from][to];
    else STATE_GRAPH[from][to] = previous;
  };
}

// 註冊狀態進入／離開回呼；同一狀態可由多個模組分別擴充。
function registerStateHook(stateName, phase, callback) {
  if (phase !== "enter" && phase !== "exit")
    throw new TypeError('phase 必須是 "enter" 或 "exit"');
  if (typeof callback !== "function")
    throw new TypeError("callback 必須是函式");
  if (!STATE_GRAPH[stateName]) STATE_GRAPH[stateName] = {};
  const hooks = STATE_EXTENSION_HOOKS[phase];
  if (!hooks.has(stateName)) hooks.set(stateName, new Set());
  hooks.get(stateName).add(callback);
  return () => hooks.get(stateName)?.delete(callback);
}

// 守門函式回傳 false 即拒絕轉移；可用來集中管理教學、過場等限制。
function registerStateGuard(guard) {
  if (typeof guard !== "function") throw new TypeError("guard 必須是函式");
  STATE_TRANSITION_GUARDS.add(guard);
  return () => STATE_TRANSITION_GUARDS.delete(guard);
}

function runStateHooks(phase, stateName, ...args) {
  const legacyHook = STATE_HOOKS[phase][stateName];
  if (legacyHook) legacyHook(...args);
  for (const callback of STATE_EXTENSION_HOOKS[phase].get(stateName) || []) {
    try {
      callback(...args);
    } catch (error) {
      console.error(`[state] ${phase} hook failed for "${stateName}"`, error);
    }
  }
}

// 功能：驗證並執行狀態轉移，觸發離開與進入狀態的鉤子。
function setState(next) {
  if (state === next) return true;
  const previous = state;
  for (const guard of STATE_TRANSITION_GUARDS) {
    try {
      if (guard(previous, next) === false) return false;
    } catch (error) {
      console.error("[state] transition guard failed", error);
      return false;
    }
  }
  const transition = STATE_GRAPH[previous]?.[next];
  if (transition === 0) return false;
  if (!transition) {
    console.warn("[state] 非法轉移 " + previous + " -> " + next);
    if (STATE_STRICT) return false;
  }
  runStateHooks("exit", previous, next);
  state = next;
  runStateHooks("enter", next, previous);
  return true;
}
const N = 44,
  T = 40,
  MW = N * T,
  TAU = Math.PI * 2;
let W,
  H,
  DPR,
  S,
  HU = 1,
  safeT = 0;
// 依視窗大小重設畫布、縮放與像素比
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth;
  H = innerHeight;
  cv.width = W * DPR;
  cv.height = H * DPR;
  S = Math.max(0.6, Math.min(1.6, Math.min(W, H) / 600));
  HU = Math.max(0.75, Math.min(1.7, Math.min(W, H) / 465));
  CZ = 24 * HU;
  document.documentElement.style.setProperty("--u", HU.toFixed(3));
  safeT = $("sa").offsetHeight;
}
addEventListener("resize", resize);
/* ---------- 精英怪系統 ---------- */
let eliteN = 0,
  eliteL = {};
let ewl = [],
  egh = [];
// 功能：計算菁英敵人的基礎生命值。
function eliteHP() {
  const bw = ST().g ? ST().g : Math.max(1, Math.ceil(wave / 5)) * 5,
    bi = ST().g ? SV.sel : (bw / 5 - 1) % 8;
  return Math.round(mkEn(14 + bi, 0, 0).mhp * 0.25);
}
// 功能：依菁英倍率調整敵人屬性。
function elify(m, q) {
  const E = ELITE[m.t];
  m.el = 1;
  m.r *= 1.2;
  m.m *= 1.6;
  m.hp = m.mhp = eliteHP();
  m.sp *= E.sk;
  m.sc = Math.round(m.sc * 2.5);
  if (!q) {
    eliteN++;
    eliteL[E.n] = (eliteL[E.n] || 0) + 1;
  }
}
// 功能：建立遊戲圖示圖例。
function legend() {
  $("iS").append(mkIcon("ult", "#ffe14a", 26));
  $("iD").append(mkIcon("dash", "#22e6ff", 24));
}
let CZ = 24;
const ALLW = [
  {
    name: "手槍",
    color: "#22e6ff",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 24,
    projectileSpeed: 680,
    projectileLifetime: 0.75,
    fireCooldown: 0.16,
    ammoCost: 1,
    knockback: 220,
    projectileRadius: 4,
  },
  {
    name: "霰彈",
    color: "#ffb03d",
    projectilesPerShot: 5,
    spreadAngle: 0.45,
    damage: 15,
    projectileSpeed: 600,
    projectileLifetime: 0.38,
    fireCooldown: 0.55,
    ammoCost: 2,
    knockback: 200,
    projectileRadius: 3.5,
  },
  {
    name: "狙擊",
    color: "#ff5fd0",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 70,
    projectileSpeed: 1150,
    projectileLifetime: 0.9,
    fireCooldown: 0.8,
    ammoCost: 2,
    knockback: 700,
    projectileRadius: 4,
    pierceCount: 1,
  },
  {
    name: "衝鋒",
    color: "#9dff3d",
    projectilesPerShot: 1,
    spreadAngle: 0.14,
    damage: 11,
    projectileSpeed: 720,
    projectileLifetime: 0.6,
    fireCooldown: 0.075,
    ammoCost: 0.45,
    knockback: 90,
    projectileRadius: 3,
  },
  {
    name: "噴火",
    color: "#ff7a3d",
    projectilesPerShot: 1,
    spreadAngle: 0.22,
    damage: 5,
    projectileSpeed: 260,
    projectileLifetime: 0.7,
    fireCooldown: 0.06,
    ammoCost: 0.35,
    knockback: 35,
    projectileRadius: 6,
    pierceCount: 1,
  },
  {
    name: "重炮",
    color: "#b45cff",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 78,
    projectileSpeed: 420,
    projectileLifetime: 1,
    fireCooldown: 0.9,
    ammoCost: 2.5,
    knockback: 650,
    projectileRadius: 8,
  },
  {
    name: "導引",
    color: "#4dffd8",
    projectilesPerShot: 1,
    spreadAngle: 0.3,
    damage: 20,
    projectileSpeed: 440,
    projectileLifetime: 1.2,
    fireCooldown: 0.35,
    ammoCost: 1,
    knockback: 120,
    projectileRadius: 4,
    homingEnabled: 1,
  },
  {
    name: "環爆",
    color: "#ffe14a",
    projectilesPerShot: 10,
    spreadAngle: 5.65,
    damage: 9,
    projectileSpeed: 400,
    projectileLifetime: 0.5,
    fireCooldown: 0.8,
    ammoCost: 2.5,
    knockback: 130,
    projectileRadius: 3.5,
  },
];
const WP = [],
  WD = [
    "均衡",
    "近距大擊退",
    "穿透·強擊退",
    "連射·輕擊退",
    "短程噴射",
    "慢速重擊退",
    "自動追蹤",
    "環狀 10 發",
  ];
ALLW.push(
  {
    name: "光線",
    color: "#7af0ff",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 8,
    projectileSpeed: 1100,
    projectileLifetime: 0.5,
    fireCooldown: 0.09,
    ammoCost: 0.45,
    knockback: 30,
    projectileRadius: 2.5,
    pierceCount: 1,
    accuracySpread: 0.015,
    muzzleParameter: 0.045,
    wallDamage: 0.3,
    automaticFire: 1,
    aimPreviewMode: "l",
    laserMode: 1,
  },
  {
    name: "雙槍",
    color: "#ff9ad5",
    projectilesPerShot: 2,
    spreadAngle: 0.12,
    damage: 14,
    projectileSpeed: 700,
    projectileLifetime: 0.7,
    fireCooldown: 0.2,
    ammoCost: 1.2,
    knockback: 90,
    projectileRadius: 3.5,
    accuracySpread: 0.03,
    muzzleParameter: 0.075,
    wallDamage: 0.8,
    automaticFire: 1,
    aimPreviewMode: "c",
  },
  {
    name: "榴彈",
    color: "#ffd23a",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 32,
    projectileSpeed: 380,
    projectileLifetime: 0.9,
    fireCooldown: 0.9,
    ammoCost: 2.5,
    knockback: 300,
    projectileRadius: 6,
    explosionRadius: 70,
    accuracySpread: 0.015,
    muzzleParameter: 0.045,
    wallDamage: 2,
    automaticFire: 0,
    aimPreviewMode: "l",
  },
  {
    name: "穿甲",
    color: "#e0e0ff",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 32,
    projectileSpeed: 900,
    projectileLifetime: 0.7,
    fireCooldown: 0.35,
    ammoCost: 1.2,
    knockback: 150,
    projectileRadius: 4,
    pierceWalls: 1,
    accuracySpread: 0.015,
    muzzleParameter: 0.045,
    wallDamage: 2,
    automaticFire: 0,
    aimPreviewMode: "l",
  },
);
const XW = [
  { accuracySpread: 0.025, muzzleParameter: 0.06, wallDamage: 1, automaticFire: 0, aimPreviewMode: "l" },
  { spreadAngle: 0.26, accuracySpread: 0.015, muzzleParameter: 0.045, wallDamage: 0.6, automaticFire: 0, aimPreviewMode: "c" },
  { accuracySpread: 0, muzzleParameter: 0.09, wallDamage: 2, automaticFire: 0, aimPreviewMode: "s" },
  { spreadAngle: 0, accuracySpread: 0.04, muzzleParameter: 0.075, legacyRcg: 0.018, wallDamage: 0.5, automaticFire: 1, aimPreviewMode: "l" },
  { flameMode: 1, accuracySpread: 0.015, muzzleParameter: 0.03, wallDamage: 0.07, automaticFire: 1, aimPreviewMode: "c" },
  { accuracySpread: 0.015, muzzleParameter: 0.04, wallDamage: 3, automaticFire: 0, aimPreviewMode: "l" },
  { spreadAngle: 0.08, accuracySpread: 0.03, muzzleParameter: 0.04, wallDamage: 0.5, automaticFire: 1, aimPreviewMode: "l" },
  { accuracySpread: 0, muzzleParameter: 0, wallDamage: 0.5, automaticFire: 0, aimPreviewMode: "r" },
];
ALLW.forEach((w, i) => {
  if (XW[i]) Object.assign(w, XW[i]);
});
ALLW.push(
  {
    name: "彈跳",
    color: "#8dff7a",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 17,
    projectileSpeed: 600,
    projectileLifetime: 1.5,
    fireCooldown: 0.18,
    knockback: 100,
    projectileRadius: 4,
    bounceCount: 3,
    accuracySpread: 0.02,
    muzzleParameter: 0.05,
    wallDamage: 0.8,
    automaticFire: 1,
    aimPreviewMode: "l",
  },
  {
    name: "電弧",
    color: "#7ab8ff",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 10,
    projectileSpeed: 850,
    projectileLifetime: 0.55,
    fireCooldown: 0.12,
    knockback: 40,
    projectileRadius: 3,
    chainLightningEnabled: 1,
    accuracySpread: 0.015,
    muzzleParameter: 0.04,
    wallDamage: 0.3,
    automaticFire: 1,
    aimPreviewMode: "l",
  },
  {
    name: "地雷",
    color: "#ff8a5c",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 70,
    projectileSpeed: 0,
    projectileLifetime: 0.1,
    fireCooldown: 0.5,
    knockback: 300,
    projectileRadius: 5,
    mineMode: 1,
    accuracySpread: 0,
    muzzleParameter: 0,
    wallDamage: 2,
    automaticFire: 0,
    aimPreviewMode: "l",
  },
  {
    name: "迴旋",
    color: "#ffb3e6",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 34,
    projectileSpeed: 520,
    projectileLifetime: 1.3,
    fireCooldown: 0.45,
    knockback: 200,
    projectileRadius: 6,
    boomerangEnabled: 1,
    pierceCount: 1,
    accuracySpread: 0.02,
    muzzleParameter: 0.05,
    wallDamage: 1,
    automaticFire: 0,
    aimPreviewMode: "l",
  },
);
ALLW.push(
  {
    name: "寒霜",
    color: "#9ae6ff",
    projectilesPerShot: 1,
    spreadAngle: 0.28,
    damage: 5,
    projectileSpeed: 480,
    projectileLifetime: 0.45,
    fireCooldown: 0.07,
    knockback: 15,
    projectileRadius: 5,
    freezeOnHit: 1,
    accuracySpread: 0.02,
    muzzleParameter: 0.04,
    wallDamage: 0.1,
    automaticFire: 1,
    aimPreviewMode: "c",
  },
  {
    name: "重力",
    color: "#b0a0ff",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 26,
    projectileSpeed: 420,
    projectileLifetime: 0.9,
    fireCooldown: 0.7,
    knockback: 0,
    projectileRadius: 7,
    gravityFieldEnabled: 1,
    accuracySpread: 0.02,
    muzzleParameter: 0.05,
    wallDamage: 0.5,
    automaticFire: 0,
    aimPreviewMode: "l",
  },
  {
    name: "電荷",
    color: "#ffe14a",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 18,
    projectileSpeed: 900,
    projectileLifetime: 0.6,
    fireCooldown: 0.4,
    knockback: 20,
    projectileRadius: 4,
    chargeStackEnabled: 1,
    accuracySpread: 0.01,
    muzzleParameter: 0.04,
    wallDamage: 0.3,
    automaticFire: 0,
    aimPreviewMode: "l",
  },
  {
    name: "蛛網",
    color: "#c0a060",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 0,
    projectileSpeed: 0,
    projectileLifetime: 0.1,
    fireCooldown: 0.6,
    knockback: 0,
    projectileRadius: 5,
    webMode: 1,
    accuracySpread: 0,
    muzzleParameter: 0,
    wallDamage: 0,
    automaticFire: 0,
    aimPreviewMode: "l",
  },
);
const AM = [
  [8, 0.9],
  [4, 2.2],
  [3, 2.3],
  [24, 0.33],
  [36, 0.2],
  [3, 2.5],
  [10, 0.8],
  [3, 2.8],
  [30, 0.22],
  [8, 1],
  [4, 2.2],
  [6, 1.3],
  [12, 0.6],
  [20, 0.34],
  [4, 2.5],
  [5, 1.4],
  [40, 0.2],
  [6, 1.7],
  [8, 1],
  [4, 3],
];
ALLW.forEach((w, i) => {
  w.id = i;
  w.magazineCapacity = AM[i][0];
  w.ammoInMagazine = w.magazineCapacity;
  w.reloadDuration = AM[i][1];
});
ALLW.push(
  {
    name: "砲塔",
    color: "#7affc0",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 9,
    projectileSpeed: 700,
    projectileLifetime: 0.55,
    fireCooldown: 0.45,
    knockback: 40,
    projectileRadius: 3,
    accuracySpread: 0.02,
    muzzleParameter: 0.03,
    wallDamage: 0.3,
    automaticFire: 0,
    aimPreviewMode: "l",
    turretMode: 1,
  },
  {
    name: "毒罐",
    color: "#8dff3d",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 80,
    projectileSpeed: 380,
    projectileLifetime: 0.9,
    fireCooldown: 0.6,
    knockback: 0,
    projectileRadius: 5,
    accuracySpread: 0,
    muzzleParameter: 0,
    wallDamage: 0,
    automaticFire: 0,
    aimPreviewMode: "l",
    poisonCloudMode: 1,
  },
  {
    name: "斬擊",
    color: "#ff9a4d",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 40,
    projectileSpeed: 1000,
    projectileLifetime: 0.1,
    fireCooldown: 0.4,
    knockback: 900,
    projectileRadius: 4,
    accuracySpread: 0,
    muzzleParameter: 0,
    wallDamage: 0.6,
    automaticFire: 0,
    aimPreviewMode: "l",
    meleeArcEnabled: 1,
    meleeRange: 102,
    meleeSweepAngle: 2.1,
  },
  {
    name: "集束彈",
    color: "#ffb84d",
    projectilesPerShot: 1,
    spreadAngle: 0,
    damage: 22,
    projectileSpeed: 520,
    projectileLifetime: 0.55,
    fireCooldown: 0.5,
    knockback: 120,
    projectileRadius: 10,
    accuracySpread: 0.02,
    muzzleParameter: 0.04,
    wallDamage: 0.5,
    automaticFire: 0,
    aimPreviewMode: "l",
    clusterShotEnabled: 1,
  },
);
{
  const NM = [
    [3, 4],
    [4, 3],
    [6, 1.2],
    [5, 1.5],
  ];
  for (let i = 20; i < 24; i++) {
    const w = ALLW[i];
    w.id = i;
    w.magazineCapacity = NM[i - 20][0];
    w.ammoInMagazine = w.magazineCapacity;
    w.reloadDuration = NM[i - 20][1];
  }
}
const BAL = {
  10: { grenadeMode: 1, damage: 58 },
  4: { damage: 6 },
  6: { damage: 24 },
  8: { damage: 7 },
  11: { damage: 36 },
  17: { damage: 30, reloadDuration: 1.5 },
};
for (const k in BAL) Object.assign(ALLW[k], BAL[k]);
ALLW[20].magazineCapacity = 2;
ALLW[20].ammoInMagazine = 2;
WD.splice(
  0,
  WD.length,
  "手動·普通破牆",
  "手動·扇形範圍·近距強",
  "手動·穿透·站定才準",
  "自動·越射越散",
  "自動·短程噴射",
  "手動·破牆最強",
  "自動·自動追蹤",
  "手動·環狀 10 發",
  "自動·高速穿透敵人",
  "自動·雙發",
  "手動·投擲·可越過牆壁，落地爆炸",
  "手動·穿透敵人與牆",
);
WD.push("自動·碰牆反彈", "自動·連鎖電擊", "手動·放置地雷", "手動·飛出又飛回來");
WD.push(
  "自動·噴流累積凍結值，凍成冰塊後受傷 +50%",
  "手動·命中處產生引力場拉攝敵人",
  "手動·命中疊 3 層電荷後引爆，範圍暈眩",
  "手動·放置蛛網，距離可控；範圍內敵人與敵方子彈大幅減速",
);
WD.push(
  "手動·投擲部署自動砲塔，持續自動攻擊範圍內敵人（最多同時 2 座）",
  "手動·投擲毒罐，落地產生持續傷害的毒雲，可越過牆壁",
  "手動·近戰由左向右揮砍，大範圍強擊退，同時擊落範圍內的敵方子彈",
  "手動·飛行一段距離或命中後爆開成碎片",
);

// 武器設定採用可讀性較高的正名；舊欄位以 getter/setter 暫時相容既有戰鬥程式。
const WEAPON_PROPERTY_ALIASES = Object.freeze({
  "n": "name",
  "c": "color",
  "n1": "projectilesPerShot",
  "sp": "spreadAngle",
  "dmg": "damage",
  "v": "projectileSpeed",
  "life": "projectileLifetime",
  "cd": "fireCooldown",
  "cost": "ammoCost",
  "kb": "knockback",
  "r": "projectileRadius",
  "pierce": "pierceCount",
  "hm": "homingEnabled",
  "acc": "accuracySpread",
  "mp": "muzzleParameter",
  "wd": "wallDamage",
  "auto": "automaticFire",
  "ad": "aimPreviewMode",
  "laser": "laserMode",
  "ex": "explosionRadius",
  "pa": "pierceWalls",
  "bn": "bounceCount",
  "bm": "boomerangEnabled",
  "ch": "chainLightningEnabled",
  "mine": "mineMode",
  "fz4": "freezeOnHit",
  "gp": "gravityFieldEnabled",
  "cg": "chargeStackEnabled",
  "web": "webMode",
  "tur": "turretMode",
  "tox": "poisonCloudMode",
  "slash": "meleeArcEnabled",
  "rg": "meleeRange",
  "sw": "meleeSweepAngle",
  "cs": "clusterShotEnabled",
  "gren": "grenadeMode",
  "fl": "flameMode",
  "rcg": "legacyRcg",
  "ms0": "magazineCapacity",
  "ms": "ammoInMagazine",
  "rs": "reloadDuration"
});
function normalizeWeaponProperties(weapon) {
  for (const [legacyName, canonicalName] of Object.entries(WEAPON_PROPERTY_ALIASES)) {
    if (Object.prototype.hasOwnProperty.call(weapon, legacyName)) {
      if (weapon[canonicalName] === undefined) weapon[canonicalName] = weapon[legacyName];
      delete weapon[legacyName];
    }
    if (!Object.prototype.hasOwnProperty.call(weapon, legacyName)) {
      Object.defineProperty(weapon, legacyName, {
        configurable: true,
        enumerable: false,
        get() { return this[canonicalName]; },
        set(value) { this[canonicalName] = value; },
      });
    }
  }
  return weapon;
}
const WEAPON_DEFINITIONS = ALLW;
for (const weaponDefinition of WEAPON_DEFINITIONS) normalizeWeaponProperties(weaponDefinition);
let LO = [0, 1, 2];
try {
  const s = JSON.parse(localStorage.getItem("neonShardLO"));
  if (Array.isArray(s) && s.length && s.length <= 3 && s.every((i) => ALLW[i]))
    LO = s;
} catch (e) {}
// 功能：讀取並套用保存的武器配置。
function applyLO() {
  LO = LO.filter((i) => SV.own.includes(i));
  if (!LO.length) LO = [SV.own[0]];
  WP.splice(0, WP.length, ...LO.map((i) => modW(ALLW[i])));
}
const accoutInfo={name:"test"}
let fd = new Int16Array(N * N),
  fT = 0,
  zones = [],
  grid,
  pl,
  en,
  bl,
  pk,
  pt,
  wave,
  score,
  state = "menu",
  best = 0,
  shake = 0,
  camx = 0,
  camy = 0,
  time = 0,
  waveT = 0,
  banner = 0,
  pkT = 0,
  overT = 0,
  shown = 0;
try {
  best = +localStorage.getItem("neonShardBest") || 0;
} catch (e) {}
const keys = {},
  mouse = { x: 0, y: 0, down: false, has: false },
  tm = { id: null, sx: 0, sy: 0, x: 0, y: 0 },
  ta = { id: null, sx: 0, sy: 0, x: 0, y: 0, a: 0, act: false };
let touchOn = false;
// 功能：讀取地圖格；超出地圖邊界時視為不可通行。
const cell = (i, j) =>
  i < 0 || j < 0 || i >= N || j >= N ? -1 : grid[j * N + i];
// 功能：判斷指定座標是否落在實心地圖格。
const solidAt = (x, y) => cell(Math.floor(x / T), Math.floor(y / T)) !== 0;
// 功能：以角色碰撞半徑檢查四角是否被地形阻擋。
const blocked = (x, y, r) =>
  solidAt(x - r, y - r) ||
  solidAt(x + r, y - r) ||
  solidAt(x - r, y + r) ||
  solidAt(x + r, y + r);
// 功能：處理「turLand」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function turLand(x, y, r, m) {
  m = m || 20;
  x = Math.max(m, Math.min(MW - m, x));
  y = Math.max(m, Math.min(MW - m, y));
  if (!blocked(x, y, r)) return [x, y];
  for (let d = 8; d <= 160; d += 8)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU,
        nx = Math.max(m, Math.min(MW - m, x + Math.cos(a) * d)),
        ny = Math.max(m, Math.min(MW - m, y + Math.sin(a) * d));
      if (!blocked(nx, ny, r)) return [nx, ny];
    }
  return [x, y];
}
// 功能：處理「mv」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function mv(e, dx, dy) {
  if (e.root > 0 && !MVF) return true;
  let b = false;
  if (!blocked(e.x + dx, e.y, e.r)) e.x += dx;
  else b = true;
  if (!blocked(e.x, e.y + dy, e.r)) e.y += dy;
  else b = true;
  return b;
}
// 功能：處理「ray」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function ray(x, y, a, m) {
  let l = 0;
  const c = Math.cos(a),
    s = Math.sin(a);
  while (l < m && !solidAt(x + c * l, y + s * l)) l += 8;
  return l;
}
// 功能：將敵人索引轉換為對應色相的 HSLA 顏色字串。
const hc = (v, a) => `hsla(${(v - 1) * 36},85%,46%,${a})`;
// 隨機產生地圖：外框不可破、中央安全區、其餘依關卡密度放可破壞牆
function genMap() {
  grid = new Int8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (i == 0 || j == 0 || i == N - 1 || j == N - 1) v = -1;
      else if (Math.max(Math.abs(i - 22), Math.abs(j - 22)) > 5) {
        const r = Math.random();
        v = r < 0.035 ? -1 : r < 0.035 + ST().dn ? 6 : 0;
      }
      grid[j * N + i] = v;
    }
}
// 功能：尋找符合距離條件且未被障礙物阻擋的位置。
function empty(minD, ref, maxD) {
  for (let k = 0; k < 400; k++) {
    const i = (1 + Math.random() * (N - 2)) | 0,
      j = (1 + Math.random() * (N - 2)) | 0;
    if (grid[j * N + i] === 0) {
      const x = (i + 0.5) * T,
        y = (j + 0.5) * T,
        dd = ref ? Math.hypot(x - ref.x, y - ref.y) : 0;
      if (!ref || (dd >= minD && (!maxD || dd <= maxD))) return { x, y };
    }
  }
  return maxD ? empty(minD, ref) : null;
}
// 功能：在指定位置建立粒子爆發特效。
function burst(x, y, col, n, sp, sz, life) {
  for (let i = 0; i < n && pt.length < 700; i++) {
    const a = Math.random() * TAU,
      s = sp * (0.3 + Math.random() * 0.7);
    pt.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: life * (0.6 + Math.random() * 0.4),
      max: life,
      col,
      sz: sz * (0.6 + Math.random() * 0.8),
    });
  }
}
// 功能：建立指定掉落物。
function drop(x, y, p) {
  if (Math.random() < p && pk.filter((q) => PN.includes(q.t)).length < 12)
    pk.push({
      ...jit(x, y),
      t: PN[[0, 0, 0, 1, 1, 1, 2, 2, 3, 3][(Math.random() * 10) | 0]],
      life: 18,
    });
}
// 子彈/爆炸命中方塊：扣血、碎裂與掉落
function hitCell(i, j, n = 1) {
  const v = cell(i, j);
  if (v <= 0) return;
  const nv = Math.max(0, v - n);
  grid[j * N + i] = nv;
  const x = (i + 0.5) * T,
    y = (j + 0.5) * T,
    col = hc(v, 1);
  if (nv === 0) {
    for (let k = 0; k < 9; k++) {
      const a = Math.random() * TAU,
        s = 80 + Math.random() * 180;
      pt.push({
        x: x + (Math.random() - 0.5) * T * 0.6,
        y: y + (Math.random() - 0.5) * T * 0.6,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.8,
        max: 0.8,
        col,
        sz: 4 + Math.random() * 6,
        f: 1,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
    burst(x, y, col, 10, 180, 2.5, 0.5);
    drop(x, y, 0.1);
    if (Math.random() < 0.15) coin(x, y, 1);
    if (Math.random() < 0.3) cur("shard", x, y, 1);
    score += 5;
    pts += 2;
    shake = Math.max(shake, 3);
  } else burst(x, y, col, 5, 120, 2, 0.35);
}
// 建立敵人物件；血量隨波數與關卡倍率成長
function mkEn(t, x, y) {
  const m = (1 + 0.1 * (wave - 1)) * ST().hm,
    D =
      EXT[t] ||
      [
        [13, 30, 125, "#ff3d9a", 100, 1],
        [14, 40, 80, "#ff9a3d", 200, 1],
        [15, 60, 70, "#b45cff", 250, 1.5],
        [13, 35, 75, "#9dff3d", 220, 1],
        [13, 35, 80, "#4de1ff", 200, 1],
        [14, 50, 60, "#ff4dff", 260, 1.2],
        [16, 70, 55, "#3dffb0", 300, 1.2],
        [14, 45, 65, "#ff2a4a", 280, 1.5],
        [17, 90, 90, "#c0c8ff", 320, 2.5],
        [15, 60, 60, "#ffd23a", 270, 2],
        [14, 55, 60, "#ff9ad5", 290, 1.2],
        [13, 40, 70, "#7a7aff", 300, 1],
        [20, 100, 75, "#ff7a5a", 300, 2],
        [15, 55, 50, "#d4ff3d", 310, 1.5],
        [34, 1750, 90, "#ff4d4d", 1500, 3],
        [38, 2250, 100, "#ffb040", 2000, 4],
        [30, 1625, 140, "#4dffd8", 2200, 3],
        [40, 3000, 50, "#d070ff", 4000, 5],
      ][t];
  return {
    t,
    x,
    y,
    m: D[5],
    kx: 0,
    ky: 0,
    dash: 0,
    tx: 0,
    ty: 0,
    rt: Math.random() * 0.3,
    dtm: 0,
    dvx: 0,
    dvy: 0,
    px: x,
    py: y,
    mvx: 0,
    mvy: 0,
    r: D[0],
    hp: D[1] * m,
    mhp: D[1] * m,
    sp: D[2] * ESPD * (1 + Math.min(0.5, 0.03 * wave)),
    col: D[3],
    sc: D[4],
    cd: 1 + Math.random() * 2,
    tele: 0,
    aim: 0,
    hf: 0,
    cc: 0,
    ang: 0,
    st: Math.random() < 0.5 ? 1 : -1,
    ramT: 0,
  };
}
// 進入下一波：依波數解鎖敵種並生成敵人與補給
function startWave() {
  wave++;
  banner = 2.2;
  if (wave > 1) score += wave * 50;
  const bw = ST().g ? wave === ST().g : wave % 5 === 0,
    n = bw
      ? Math.max(3, Math.floor(Math.min(26, 3 + wave * 2) / 2))
      : Math.min(26, 3 + wave * 2);
  eliteN = 0;
  eliteL = {};
  const elW = !train && (bw || (ST().g ? wave === ST().g - 1 : wave % 5 === 4));
  for (let k = 0; k < n; k++) {
    const pool = [0, 0];
    for (let q = 0; q < 14; q++) if (wave >= TH[q]) pool.push(q);
    for (const [t2, w2] of NE) if (wave >= w2) pool.push(t2);
    const nw = NEWT(),
      t =
        k < nw.length * 2
          ? nw[k % nw.length]
          : pool[(Math.random() * pool.length) | 0];
    const p = empty(380, pl, 760);
    if (p) {
      const m0 = mkEn(t, p.x, p.y);
      if (elW && ELITE[t] && Math.random() < 0.2) elify(m0);
      en.push(m0);
      burst(p.x, p.y, m0.el ? EL_COL : "#ffffff", m0.el ? 16 : 8, 120, 2, 0.5);
    }
  }
  if (eliteN) {
    banner = 3;
    flash(EL_COL, 0.5, 0.4);
  }
  if (bw) {
    const p = empty(380, pl, 760);
    if (p) {
      const bi = ST().g ? SV.sel : (wave / 5 - 1) % 8;
      {
        const bb = mkEn(14 + bi, p.x, p.y);
        en.push(bb);
        bossIntro(bb);
      }
      banner = 3;
      bossT = bi;
      bossIn = 2.4;
      flash("#ff2a4a", 0.8, 0.5);
      shake = 26;
      fxs.push({
        k: "w",
        x: p.x,
        y: p.y,
        r: 500,
        t: 0.9,
        max: 0.9,
        col: "#ff2a4a",
      });
    }
  }
  for (let k = 0; k < 2; k++) {
    const p = empty(100, pl);
    if (p) pk.push({ x: p.x, y: p.y, t: PN[k ? 1 : 0], life: 18 });
  }
}
// 開局初始化：地圖、玩家、彈匣、各種陣列與計時器
function setup() {
  ewl = [];
  egh = [];
  CHR = CHS[SV.char] || CHS[0];
  genMap();
  pl = {
    x: 22.5 * T,
    y: 22.5 * T,
    r: 12,
    hp: 100 + 10 * UL("hp") + CHR.hp,
    mhp: 100 + 10 * UL("hp") + CHR.hp,
    sh: 0,
    ammo: 5,
    w: 0,
    rc: 0,
    slow: 0,
    pvx: 0,
    pvy: 0,
    q: 0.5,
    dashCd: 0,
    dashT: 0,
    dx: 1,
    dy: 0,
    boost: 0,
    aim: 0,
    sc: 0,
    hf: 0,
    vx: 0,
    vy: 0,
  };
  WP.forEach((w) => {
    w.ms = w.bm ? 1 : Math.round(w.ms0 * (1 + 0.1 * UL("mag")));
    w.am = w.ms;
    w.um = 0;
  });
  Object.defineProperty(pl, "ult", {
    configurable: true,
    enumerable: true,
    get() {
      const w = WP[this.w];
      return w ? w.um || 0 : 0;
    },
    set(v) {
      const w = WP[this.w];
      if (w) w.um = v;
    },
  });
  SQ.length = 0;
  LZ.length = 0;
  FT.length = 0;
  fxs = [];
  FL = null;
  bossIn = 0;
  ptxt = 0;
  bti = 0;
  chp = [];
  coins = 0;
  shd = 0;
  cor = 0;
  pts = 0;
  won = 0;
  RUN = { dmg: 0 };
  en = [];
  pendEn.length = 0;
  bl = [];
  pk = [];
  pt = [];
  zones = [];
  wave = 0;
  score = 0;
  shake = 0;
  pkT = 6;
  waveT = 1.8;
  shown = 0;
  camx = pl.x - W / S / 2;
  camy = pl.y - H / S / 2;
  startWave();
}
// 玩家受傷：衝刺無敵、減傷、先扣護盾再扣血，血量歸零則結束遊戲
function hurt(d) {
  if (pl.dashT > 0 || state !== "play" || (train && god)) return;
  d *= (CHR.dr || 1) * (pl.vuln > 0 ? 1.15 : 1);
  const dd = d;
  HF = Math.min(1, Math.max(HF, 0.3 + d / 45));
  HC = pl.sh > 0 && d <= pl.sh ? "#4d9bff" : "#ff1e3c";
  if (pl.sh > 0) {
    const a = Math.min(pl.sh, d);
    pl.sh -= a;
    d -= a;
  }
  pl.hp -= d;
  pl.hf = 0.2;
  shake = Math.max(shake, Math.min(26, 3 + dd * 0.4));
  try {
    if (navigator.vibrate)
      navigator.vibrate(
        pl.hp <= 0 ? [60, 40, 160] : Math.round(Math.min(120, 15 + dd * 2.5)),
      );
  } catch (e) {}
  burst(pl.x, pl.y, "#ff3d6a", 10, 200, 2.5, 0.5);
  if (pl.hp <= 0) {
    pl.hp = 0;
    setState("over");
    overT = 1;
    if (!train) {
      bankChips();
      SV.coins += coins;
      SV.sh += shd;
      SV.co += cor;
      SV.sb[SV.sel] = Math.max(SV.sb[SV.sel] || 0, wave);
      save();
    }
    endTrain();
    burst(pl.x, pl.y, "#22e6ff", 60, 380, 3, 1.1);
    try {
      if (score > best) {
        best = score;
        localStorage.setItem("neonShardBest", best);
      }
    } catch (e) {}
  }
}
// 開火：檢查彈藥與冷卻，依武器產生子彈（含自動瞄準與散佈）
function shoot(f, qk) {
  const w = WP[pl.w];
  if (state !== "play" || pl.sc > 0 || w.am < (w.laser ? 0.85 : 1)) return;
  w.am -= w.laser ? 0.85 : 1;
  pl.sc = w.cd;
  pl.lf = time;
  const tg = qk ? quickT() : aimT();
  const SB = pl.sb > 0 ? 1.3 : 1;
  pl.sb = 0;
  let ba = pl.aim;
  if (tg && !(w.mine || w.web || w.tur || w.tox || w.slash)) {
    const sp = w.v * BS,
      D = Math.hypot(tg.x - pl.x, tg.y - pl.y),
      t = D / sp;
    ba = Math.atan2(tg.y + tg.mvy * t - pl.y, tg.x + tg.mvx * t - pl.x);
  }
  const jit =
    (Math.random() * 2 - 1) *
    (cone() - (w.n1 === 1 ? w.sp / 2 : 0)) *
    (tg ? 0.4 : 1);
  pl.rc = Math.min(0.1, pl.rc + (w.rcg || 0));
  if (w.slash) {
    if (tg) ba = Math.atan2(tg.y - pl.y, tg.x - pl.x);
    slashHit(
      pl.x,
      pl.y,
      ba,
      w.sw,
      w.rg,
      w.dmg * (w.n1 || 1) * SB * (1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg),
      w.kb,
      w.c,
      w,
    );
    shake = Math.max(shake, 2);
    return;
  }
  if (w.mine || w.web || w.gren || w.tur || w.tox) {
    const W0 = ALLW[w.id] || w,
      RGm = Math.max(0.5, (w.life || 1) / (W0.life || 1)),
      RG = 260 * RGm,
      N1 = Math.max(1, w.n1 || 1),
      XB = w.xb ? 1.25 : 1;
    if (tg) {
      const lt = w.mine ? 0.3 : w.gren ? 0.6 : w.tox ? 0.5 : w.tur ? 0.3 : 0,
        px = tg.x + (tg.mvx || 0) * lt,
        py = tg.y + (tg.mvy || 0) * lt;
      ba = Math.atan2(py - pl.y, px - pl.x);
      pl.q = Math.max(0, Math.min(1, Math.hypot(px - pl.x, py - pl.y) / RG));
    }
    const L =
        w.gren || w.tox || w.tur
          ? Math.max(0, pl.q * RG)
          : Math.max(0, Math.min(pl.q * RG, ray(pl.x, pl.y, ba, RG) - 12)),
      mx = pl.x + Math.cos(ba) * L,
      my = pl.y + Math.sin(ba) * L;
    if (w.gren) {
      const crt = w.cr && Math.random() < w.cr,
        gx = Math.max(20, Math.min(MW - 20, mx)),
        gy = Math.max(20, Math.min(MW - 20, my));
      zones.push(
        thr(
          {
            k: "gren",
            x: gx,
            y: gy,
            r: (w.ex || 70) * Math.sqrt((w.r || 6) / 6) * XB,
            t: 0.5,
            max: 0.5,
            col: crt ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              N1 *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg) *
              (crt ? w.cm : 1),
            kb: w.kb,
            wd: w.wd,
            ...zfl(w),
          },
          pl.x,
          pl.y,
          0.45,
        ),
      );
      burst(
        pl.x + Math.cos(ba) * 20,
        pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.tox) {
      const crt = w.cr && Math.random() < w.cr,
        gx = Math.max(20, Math.min(MW - 20, mx)),
        gy = Math.max(20, Math.min(MW - 20, my));
      zones.push(
        thr(
          {
            k: "tox",
            x: gx,
            y: gy,
            r: 85 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 4,
            max: 4,
            wi: pl.w,
            col: crt ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              (4 / 6) *
              N1 *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg) *
              (crt ? w.cm : 1),
            ...zfl(w),
          },
          pl.x,
          pl.y,
          0.45,
        ),
      );
      burst(
        pl.x + Math.cos(ba) * 20,
        pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.tur) {
      const ts = zones.filter((z) => z.k === "tur" && !z.ult);
      while (ts.length >= 2) {
        const o = ts.shift();
        o.t = 0;
        burst(o.x, o.y, o.col, 8, 120, 2, 0.3);
      }
      const [tx0, ty0] = turLand(mx, my, 18);
      zones.push(
        thr(
          {
            k: "tur",
            x: tx0,
            y: ty0,
            r: 14,
            t: 10,
            max: 10,
            hp: 40,
            mhp: 40,
            col: w.c,
            w: w,
            cd: 0.4,
            ang: ba,
            rg: 250 * RGm,
            fi: w.cd,
            dmul: SB * (1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg),
          },
          pl.x,
          pl.y,
          0.3,
        ),
      );
      burst(
        pl.x + Math.cos(ba) * 20,
        pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.web)
      zones.push(
        thr(
          {
            k: "web",
            x: mx,
            y: my,
            r: 70 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 7,
            max: 7,
            wi: pl.w,
            col: w.c,
            ...zfl(w),
          },
          pl.x,
          pl.y,
          0.28,
        ),
      );
    else {
      const crM = w.cr && Math.random() < w.cr;
      zones.push(
        thr(
          {
            k: "mine",
            x: mx,
            y: my,
            r: 70 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 14,
            max: 14,
            wi: pl.w,
            col: crM ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg) *
              (crM ? w.cm : 1),
            kb: w.kb,
            wd: w.wd,
            arm: 0.6,
            ...zfl(w),
          },
          pl.x,
          pl.y,
          0.28,
        ),
      );
    }
    burst(mx, my, w.c, 8, 120, 2, 0.3);
    return;
  }
  if (w.laser) {
    laserFire(w, tg, SB);
    return;
  }
  for (let k = 0; k < w.n1; k++) {
    const crt = w.cr && Math.random() < w.cr,
      a =
        ba +
        jit +
        (w.n1 > 1
          ? (k / (w.n1 - 1) - 0.5) * w.sp
          : (Math.random() - 0.5) * w.sp),
      c = Math.cos(a),
      s = Math.sin(a);
    bl.push({
      x: pl.x + c * 20,
      y: pl.y + s * 20,
      vx: c * w.v * BS,
      vy: s * w.v * BS,
      r: crt ? w.r * 1.4 : w.r,
      own: 1,
      dmg:
        w.dmg * SB * (1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg) * (crt ? w.cm : 1),
      life: w.life / BS,
      col: crt ? "#ffffff" : w.c,
      kb: w.kb,
      pe: w.pierce,
      hm: w.hm,
      pierce: w.pa,
      ex: w.ex,
      ch: w.ch,
      bn: w.bn,
      bm: w.bm,
      wi: pl.w,
      xb: w.xb,
      bu: w.bu,
      fr: w.fr,
      lk: w.lk,
      fz4: w.fz4,
      cg: w.cg,
      gp: w.gp,
      wd: w.wd,
      fl: w.fl,
      cs: w.cs,
      l0: w.life / BS,
      age: 0,
      lc: -1,
      hit: [],
    });
  }
  burst(
    pl.x + Math.cos(ba) * 22,
    pl.y + Math.sin(ba) * 22,
    w.c,
    3,
    120,
    1.8,
    0.2,
  );
  shake = Math.max(shake, w.n1 > 1 || w.kb > 400 ? 4 : 1);
}
// 功能：處理「ub」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function ub(a, v, o) {
  const b = Object.assign(
    {
      x: pl.x + Math.cos(a) * 16,
      y: pl.y + Math.sin(a) * 16,
      vx: Math.cos(a) * v * BS,
      vy: Math.sin(a) * v * BS,
      r: 5,
      own: 1,
      dmg: 30,
      life: 1.2 / BS,
      col: "#ffe14a",
      kb: 300,
      pe: 1,
      ult: 1,
      hit: [],
      lc: -1,
    },
    o,
  );
  b.dmg *= 1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg;
  applyUM(b);
  bl.push(b);
}
let UM = null;
// 功能：處理「ultMods」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function ultMods() {
  const c = WP[pl.w],
    b = c && ALLW[c.id];
  if (!b) return null;
  // 功能：計算兩個武器屬性之間的倍率；分母無效時回傳預設倍率。
  const g = (x, y) => (y > 0 ? x / y : 1),
    fl = (k) => (c[k] && !b[k] ? 1 : 0);
  return {
    dm: 1 + (g(c.dmg * (c.n1 || 1), b.dmg * (b.n1 || 1)) - 1) * 0.6,
    kb: g(c.kb, b.kb),
    wd: (c.wd || 0) - (b.wd || 0),
    r: g(c.r, b.r),
    v: g(c.v, b.v),
    life: g(c.life, b.life),
    xb: fl("xb"),
    ch: fl("ch"),
    bu: fl("bu"),
    fr: fl("fr"),
    fz4: fl("fz4"),
    lk: fl("lk"),
    hm: fl("hm"),
    bn: (c.bn || 0) - (b.bn || 0),
    cr: (c.cr || 0) - (b.cr || 0),
    cm: c.cm || 1,
  };
}
// 功能：處理「applyUM」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function applyUM(b) {
  if (!UM || b.um) return;
  b.um = 1;
  const m = UM;
  b.dmg *= m.dm;
  b.kb *= m.kb;
  if (m.wd > 0) b.wd = (b.wd === undefined ? 1 : b.wd) + m.wd;
  b.r *= m.r;
  b.vx *= m.v;
  b.vy *= m.v;
  b.life *= m.life;
  if (b.l0) b.l0 *= m.life;
  if (m.xb) b.xb = 1;
  if (m.ch) b.ch = 1;
  if (m.bu) b.bu = 1;
  if (m.fr) b.fr = 1;
  if (m.fz4) b.fz4 = 1;
  if (m.lk) b.lk = 1;
  if (m.hm) b.hm = 1;
  if (m.bn > 0) b.bn = (b.bn || 0) + m.bn;
  if (m.cr > 0 && Math.random() < m.cr) {
    b.dmg *= m.cm;
    b.col = "#ffffff";
    b.r *= 1.4;
  }
}
const ULN = [
    "連珠",
    "轟炸",
    "貫穿光束",
    "彈幕",
    "烈焰環",
    "隕石",
    "飛彈群",
    "雙環爆",
    "雷射掃射",
    "雙向火網",
    "地毯轟炸",
    "穿透風暴",
  ],
  ULT_OLD = {
    0() {
      const a = pl.aim;
      for (let k = 0; k < 12; k++) ub(a + (k - 5.5) * 0.05, 680, { dmg: 30 });
    },
    1() {
      const a = pl.aim;
      for (let k = 0; k < 40; k++)
        ub(a + (Math.random() - 0.5) * 2, 420 + Math.random() * 180, {
          dmg: 22,
          life: 0.55 / BS,
          r: 4,
          kb: 260,
        });
    },
    2() {
      ub(pl.aim, 1500, {
        dmg: 220,
        r: 14,
        life: 0.6 / BS,
        pierce: 1,
        wd: 3,
        kb: 900,
      });
    },
    3() {
      const a = pl.aim;
      for (let k = 0; k < 36; k++)
        ub(a + k * 0.4, 330 + (k % 6) * 35, {
          dmg: 16,
          r: 3.5,
          life: 0.9 / BS,
        });
    },
    4() {
      for (let k = 0; k < 24; k++)
        ub((k / 24) * TAU, 220, {
          dmg: 25,
          r: 7,
          life: 0.9 / BS,
          l0: 0.9 / BS,
          kb: 120,
          fl: 1,
        });
    },
    5() {
      const t = en
        .slice()
        .sort(
          (p, q) =>
            Math.hypot(p.x - pl.x, p.y - pl.y) -
            Math.hypot(q.x - pl.x, q.y - pl.y),
        )
        .slice(0, 6);
      if (!t.length)
        for (let k = 0; k < 6; k++)
          t.push({
            x: pl.x + Math.cos(k) * 120,
            y: pl.y + Math.sin(k) * 120,
          });
      for (const e of t)
        explode({
          x: e.x,
          y: e.y,
          ex: 90,
          dmg: 70,
          kb: 500,
          wd: 3,
          col: "#b45cff",
        });
    },
    6() {
      for (let k = 0; k < 16; k++)
        ub(Math.random() * TAU, 380, {
          dmg: 28,
          hm: 1,
          life: 2 / BS,
          r: 4,
        });
    },
    7() {
      for (let k = 0; k < 20; k++) {
        ub((k / 20) * TAU, 300, { dmg: 25 });
        ub(((k + 0.5) / 20) * TAU, 450, { dmg: 25 });
      }
    },
    8() {
      const a = pl.aim;
      for (let k = 0; k < 5; k++)
        ub(a + (k - 2) * 0.16, 1300, { dmg: 60, life: 0.45 / BS, r: 3 });
    },
    9() {
      const a = pl.aim;
      for (let k = 0; k < 12; k++) {
        ub(a + (k - 5.5) * 0.09, 600, { dmg: 24 });
        ub(a + Math.PI + (k - 5.5) * 0.09, 600, { dmg: 24 });
      }
    },
    10() {
      const a = pl.aim,
        c = Math.cos(a),
        s = Math.sin(a),
        L = ray(pl.x, pl.y, a, 450);
      for (let k = 0; k < 8; k++) {
        const d = 50 + k * 45;
        if (d < L)
          explode({
            x: pl.x + c * d,
            y: pl.y + s * d,
            ex: 70,
            dmg: 55,
            kb: 350,
            wd: 2,
            col: "#ffd23a",
          });
      }
    },
    11() {
      for (let k = 0; k < 24; k++)
        ub((k / 24) * TAU, 450, {
          dmg: 35,
          r: 4,
          pierce: 1,
          wd: 2,
          life: 1.3 / BS,
        });
    },
  };
// 功能：處理「ultT」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function ultT() {
  if (!AA) return null;
  const R = AIMR * (AA === 2 ? 3.4 : 2.6),
    ex = AA === 2 ? 0.7 : 0.35;
  let b = null,
    bs = 1e9;
  for (const e of en) {
    if (e.hp <= 0) continue;
    const D = Math.hypot(e.x - pl.x, e.y - pl.y);
    if (D > R * (isB(e) ? 1.3 : 1) + e.r) continue;
    const a = Math.atan2(e.y - pl.y, e.x - pl.x);
    if (
      angD(a, pl.aim) >
      Math.min(Math.atan2(e.r + 8, Math.max(D, 1)), 0.4) + ex
    )
      continue;
    const los = ray(pl.x, pl.y, a, D) >= D - e.r - 6,
      sc = D + (los ? 0 : 120) - (isB(e) ? 200 : 0);
    if (sc < bs) {
      bs = sc;
      b = e;
    }
  }
  return b;
}
// 施放 SUPER 大招：依目前武器查表執行，並清空蓄能
function ult(ang, q) {
  if (state !== "play" || pl.ult < 100) return;
  UMANUAL = ang !== undefined;
  if (ang === undefined) {
    const t = ultT();
    if (t) {
      const lx = t.x + (t.mvx || 0) * 0.3,
        ly = t.y + (t.mvy || 0) * 0.3;
      ang = Math.atan2(ly - pl.y, lx - pl.x);
      pl.aim = ang;
      q = Math.max(0, Math.min(1, Math.hypot(lx - pl.x, ly - pl.y) / 330));
    }
  }
  pl.ult = 0;
  UM = ultMods();
  const n0 = bl.length;
  (ULTS[WP[pl.w].id] || ultRing)(
    ang === undefined ? pl.aim : ang,
    q === undefined
      ? mouse.has
        ? Math.max(
            0,
            Math.min(
              1,
              Math.hypot(mouse.x / S + camx - pl.x, mouse.y / S + camy - pl.y) /
                330,
            ),
          )
        : 0.7
      : q,
  );
  for (let i = n0; i < bl.length; i++) if (bl[i].ult) applyUM(bl[i]);
  if (WP[pl.w].id !== 18) {
    if (WP[pl.w].id !== 18) {
      shake = 14;
      burst(pl.x, pl.y, "#ffe14a", 40, 320, 3, 0.7);
    }
  }
}
const SQ = [];
let fxs = [];
// 功能：將延遲執行的回呼加入特效排程佇列。
const later = (t, fn) => SQ.push({ t, fn }),
  line = (a, len, t, col) =>
    fxs.push({ k: "l", x: pl.x, y: pl.y, a, len, t, max: t, col }),
  spot = (x, y, r, t, col) => fxs.push({ k: "c", x, y, r, t, max: t, col }),
  LR = (q) => q * 330;
const ULTS = {
  0(a) {
    for (let k = 0; k < 12; k++)
      later(k * 0.05, () => ub(a, 720, { dmg: 40, r: 4, life: 0.9 / BS }));
  },
  1(a) {
    for (let n = 0; n < 3; n++)
      later(n * 0.25, () => {
        for (let k = 0; k < 16; k++)
          ub(
            a + (k / 15 - 0.5) * 1.1 + (Math.random() - 0.5) * 0.1,
            380 + Math.random() * 160,
            { dmg: 19, r: 4, life: 0.55 / BS, kb: 300, wd: 2 },
          );
        shake = 10;
      });
  },
  2(a) {
    const px = pl.x,
      py = pl.y;
    line(a, 1700, 0.7, "#ffe14a");
    fxs.push({
      k: "cring",
      x: px,
      y: py,
      r: 90,
      t: 0.5,
      max: 0.5,
      col: "#ffe14a",
    });
    later(0.7, () => {
      ub(a, 1500, {
        x: px,
        y: py,
        dmg: 380,
        r: 32,
        tl: 3,
        col: "#ffe14a",
        sn: 1,
        life: 1.47 / BS,
        pierce: 1,
        wd: 3,
        kb: 900,
      });
      fxs.push({
        k: "w",
        x: px,
        y: py,
        r: 90,
        t: 0.3,
        max: 0.3,
        col: "#ffe14a",
      });
      burst(px, py, "#ffe14a", 12, 240, 2.5, 0.4);
      shake = 16;
    });
  },
  3(a) {
    for (let k = 0; k < 30; k++)
      later(k * 0.035, () => {
        for (let j = 0; j < 2; j++)
          ub(a + (Math.random() - 0.5) * 0.5, 520 + Math.random() * 120, {
            dmg: 11,
            r: 3,
            life: 0.5 / BS,
            kb: 60,
          });
      });
  },
  4(a) {
    for (let k = 0; k < 30; k++)
      later(k * 0.04, () =>
        ub(a + (Math.random() - 0.5) * 0.6, 230 + Math.random() * 60, {
          dmg: 15,
          r: 7,
          life: 0.8 / BS,
          l0: 0.8 / BS,
          kb: 60,
          fl: 1,
          wd: 0.1,
        }),
      );
  },
  5(a, q) {
    const d = LR(q),
      x = pl.x + Math.cos(a) * d,
      y = pl.y + Math.sin(a) * d;
    spot(x, y, 120, 0.9, "#ffe14a");
    later(0.9, () =>
      explodeU({
        x,
        y,
        ex: 120,
        dmg: 250,
        kb: 700,
        wd: 3,
        col: "#ffe14a",
      }),
    );
  },
  6(a) {
    for (let k = 0; k < 14; k++)
      later(k * 0.05, () =>
        ub(a + (k % 2 ? 1 : -1) * (0.3 + k * 0.05), 360, {
          dmg: 34,
          hm: 1,
          hmr: 3.2,
          hml: 220,
          life: 2.2 / BS,
          r: 4,
        }),
      );
  },
  7(a) {
    for (let n = 0; n < 3; n++)
      later(n * 0.25, () => {
        for (let k = 0; k < 18; k++)
          ub((k / 18) * TAU + n * 0.17, 260 + n * 80, { dmg: 26 });
      });
  },
  8(a) {
    ultLaser(a);
  },
  9(a) {
    for (let k = 0; k < 28; k++)
      later(k * 0.035, () => {
        const t = a + k * 0.4;
        ub(t, 600, { dmg: 22 });
        ub(t + Math.PI, 600, { dmg: 22 });
      });
  },
  10(a, q) {
    const d = LR(q),
      x = pl.x + Math.cos(a) * d,
      y = pl.y + Math.sin(a) * d;
    spot(x, y, 150, 0.8, "#ffd23a");
    later(0.8, () => {
      explodeU({
        x,
        y,
        ex: 150,
        dmg: 100,
        kb: 600,
        wd: 3,
        col: "#ffd23a",
      });
      for (let k = 0; k < 6; k++) {
        const t = (k / 6) * TAU;
        later(0.15 + k * 0.07, () =>
          explodeU({
            x: x + Math.cos(t) * 95,
            y: y + Math.sin(t) * 95,
            ex: 60,
            dmg: 50,
            kb: 300,
            wd: 2,
            col: "#ffd23a",
          }),
        );
      }
    });
  },
  11(a) {
    for (let k = 0; k < 10; k++)
      ub(a + (k - 4.5) * 0.07, 900, {
        dmg: 55,
        r: 7.5,
        tl: 3,
        pierce: 1,
        wd: 3,
        life: 0.9 / BS,
      });
  },
};
ULN.splice(
  0,
  12,
  "百發百中",
  "三連轟",
  "貫穿光束",
  "掃射",
  "烈焰噴吐",
  "隕石墜落",
  "飛彈雨",
  "連環脈衝",
  "破滅雷射",
  "旋風雙槍",
  "集束炸彈",
  "破牆箭",
);
ULTS[12] = (a) => {
  for (let k = 0; k < 20; k++)
    later(k * 0.04, () =>
      ub(Math.random() * TAU, 520, {
        dmg: 30,
        bn: 4,
        life: 2.4 / BS,
        r: 4,
      }),
    );
};
ULTS[13] = (a) => {
  const t = en
    .slice()
    .sort(
      (p, q) =>
        Math.hypot(p.x - pl.x, p.y - pl.y) - Math.hypot(q.x - pl.x, q.y - pl.y),
    )
    .slice(0, 10);
  t.forEach((e, i) =>
    later(i * 0.1, () => {
      if (e.hp <= 0) return;
      strikeFx(e);
      {
        const d0 = dm(
          e,
          130 * (1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg) * (UM ? UM.dm : 1),
        );
        e.hp -= d0;
        e.hf = 1;
        chipHit(e, d0, ufl());
      }
      burst(e.x, e.y, "#ffe14a", 24, 280, 3, 0.5);
      shake = Math.max(shake, 8);
      if (e.hp <= 0) kill(e);
    }),
  );
};
ULTS[14] = (a, q) => {
  const d = LR(q),
    gid = time + Math.random();
  fxs.push({
    k: "w",
    x: pl.x,
    y: pl.y,
    r: 130,
    t: 0.4,
    max: 0.4,
    col: "#ffe14a",
  });
  for (let k = 0; k < 9; k++) {
    const t = (k / 9) * TAU,
      r = k ? 85 : 0,
      x = pl.x + Math.cos(a) * d + Math.cos(t) * r,
      y = pl.y + Math.sin(a) * d + Math.sin(t) * r;
    if (!blocked(x, y, 8))
      later(k * 0.06, () =>
        zones.push(
          thr(
            {
              k: "mine",
              x,
              y,
              r: 75,
              t: 16,
              max: 16,
              col: "#ffe14a",
              dmg: 90 * (UM ? UM.dm : 1),
              kb: 300 * (UM ? UM.kb : 1),
              arm: 0.4,
              ult: 1,
              grp: gid,
              ...ufl(),
            },
            pl.x,
            pl.y,
            0.3,
          ),
        ),
      );
  }
};
ULTS[15] = (a) => {
  for (let k = -1; k <= 1; k++)
    ub(a + k * 0.4, 520, {
      dmg: 90,
      r: 14,
      bm: 1,
      life: 1.6 / BS,
      l0: 1.6 / BS,
    });
};
ULN.push("反彈風暴", "雷暴", "地雷陣", "三連巨鏢");
// 功能：處理「dmM」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function dmM() {
  return 1 + 0.06 * UL("dmg") + 0.1 * RUN.dmg;
}

// ===== 雷射系統：光線槍（持續光束）與其大招（破滅雷射）=====
// ===== 芯片效果通用層：讓地雷/毒罐/蛛網/黑洞/砲塔/斬擊/大招都吃到芯片 =====
function ufl() {
  const m = UM;
  return m ? { bu: m.bu, fr: m.fr, fz4: m.fz4, lk: m.lk, ch: m.ch } : {};
}
// 功能：處理「zfl」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function zfl(w) {
  return w ? { bu: w.bu, fr: w.fr, fz4: w.fz4, lk: w.lk, ch: w.ch } : {};
}
// 功能：處理「chipHit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chipHit(e, dd, f) {
  if (!f || !(dd > 0)) return;
  if (f.bu) e.bu = 3;
  if (f.fr) e.fr = 2;
  if (f.fz4) {
    e.fv = (e.fv || 0) + 1;
    e.fr = Math.max(e.fr || 0, 1.2);
    if (e.fv >= 6) frz(e);
  }
  if (f.lk && pl.hp < pl.mhp)
    pl.hp = Math.min(pl.mhp, pl.hp + Math.min(2, dd * 0.025));
  if (f.ch) {
    let t2 = null,
      bdist = 140;
    for (const q of en)
      if (q !== e && q.hp > 0) {
        const d2 = Math.hypot(q.x - e.x, q.y - e.y);
        if (d2 < bdist) {
          bdist = d2;
          t2 = q;
        }
      }
    if (t2) {
      const d3 = dm(t2, dd * 0.5);
      t2.hp -= d3;
      t2.hf = 1;
      fxs.push({
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
}
// 功能：處理「chipTick」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chipTick(e, dt, z, dd) {
  if (z.bu) e.bu = 3;
  if (z.fr) e.fr = Math.max(e.fr || 0, 0.6);
  if (z.fz4) {
    e.fv = (e.fv || 0) + dt * 5;
    e.fr = Math.max(e.fr || 0, 0.6);
    if (e.fv >= 6) frz(e);
  }
  if (z.lk && dd > 0 && pl.hp < pl.mhp)
    pl.hp = Math.min(pl.mhp, pl.hp + dd * 0.025);
}
// 功能：處理「chainZone」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chainZone(z, d) {
  if (!(d > 0)) return;
  const c = en.filter(
    (e) => e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r,
  );
  if (!c.length) return;
  chipHit(c[(Math.random() * c.length) | 0], d * 2, { ch: 1 });
}
// 功能：處理「gpTick」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function gpTick(z, dt) {
  for (const e of en) {
    if (e.hp <= 0 || Math.hypot(e.x - z.x, e.y - z.y) >= z.r + e.r) continue;
    let dd = 0;
    if (z.dps) {
      dd = dm(e, z.dps * dt);
      e.hp -= dd;
      e.hf = dd > 0 ? 1 : 0;
    }
    chipTick(e, dt, z, dd);
    if (e.hp <= 0) kill(e);
  }
  if (z.ch) {
    z.cht = (z.cht || 0) - dt;
    if (z.cht <= 0) {
      z.cht = 0.4;
      chainZone(z, (z.dps || 10) * 0.4);
    }
  }
  if (z.t <= 0 && z.xb && !z.xd) {
    z.xd = 1;
    explode({
      x: z.x,
      y: z.y,
      ex: z.r * 0.6,
      dmg: (z.dps || 10) * 1.2,
      kb: 300,
      wd: 1,
      col: z.col,
    });
  }
}
// 功能：處理「explodeU」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function explodeU(o) {
  const m = UM;
  if (m) {
    o = Object.assign({}, ufl(), o);
    o.dmg *= m.dm;
    o.kb *= m.kb;
    if (m.wd > 0) o.wd = (o.wd || 0) + m.wd;
    if (m.xb) o.ex *= 1.2;
  }
  explode(o);
}
const LZ = [];
let UMANUAL = false;
const FT = [];
// 功能：建立或生成「mkDummy」所需的遊戲資料。
function mkDummy(x, y) {
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
function spawnDummy() {
  for (let k = en.length - 1; k >= 0; k--) if (en[k].dummy) en.splice(k, 1);
  const a = pl.aim;
  let p = { x: pl.x + Math.cos(a) * 260, y: pl.y + Math.sin(a) * 260 };
  if (blocked(p.x, p.y, 34)) p = empty(200, pl) || p;
  en.push(mkDummy(p.x, p.y));
  burst(p.x, p.y, "#ffffff", 12, 160, 2, 0.5);
}
// 功能：繪製或建立「drawDummyBar」所需的畫面元素。
function drawDummyBar(e) {
  const u = HU,
    x = 8 * u,
    w = W - 16 * u,
    y = safeT + 74 * u,
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
  cx.fillRect(x + ((time * 130) % (w + 80)) - 40, y, 26, h);
  cx.restore();
  cx.strokeStyle = "#ffffff55";
  cx.lineWidth = 1;
  cx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  cx.fillStyle = "#ffffff";
  cx.font = `bold ${12 * u}px ui-monospace,monospace`;
  cx.textAlign = "center";
  cx.textBaseline = "bottom";
  cx.fillText("肉盾", W / 2, y - 4);
  cx.restore();
}
// 功能：建立浮動文字特效，供電荷、引爆與暈眩提示使用。
function ftxt(x, y, text, col = "#ffffff", size = 12) {
  // 將戰鬥提示加入特效佇列，由 render() 依剩餘時間繪製並淡出。
  fxs.push({
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
function zigPts(x0, y0, x1, y1, n, amp) {
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
function zig(x0, y0, x1, y1, col, t, w, br, a) {
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
  fxs.push({
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
function strikeFx(e) {
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
  fxs.push({
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
function cloudSpark(z) {
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
function cloudSky(z) {
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
// 功能：處理敵人電荷增加時的特效與文字提示。
function chgHit(e) {
  fxs.push({
    k: "w",
    x: e.x,
    y: e.y,
    r: e.r + 26,
    t: 0.25,
    max: 0.25,
    col: "#ffe14a",
  });
  burst(e.x, e.y, "#fff4a6", 8, 200, 2, 0.3);
  ftxt(
    e.x,
    e.y - e.r - 26,
    e.cg >= 2 ? "電荷 " + e.cg + "/3 · 再一發引爆！" : "電荷 " + e.cg + "/3",
    "#ffe14a",
    e.cg >= 2 ? 13 : 11,
  );
}
// 功能：繪製敵人電荷層數與蓄電狀態。
function drawChg(e) {
  const t = time;
  if (e.cg > 0) {
    const n = Math.min(3, e.cg),
      pu = 0.5 + 0.5 * Math.sin(t * (n >= 2 ? 18 : 7)),
      R = e.r + 7;
    cx.save();
    cx.globalCompositeOperation = "lighter";
    cx.lineJoin = "round";
    if (n >= 2) {
      cx.globalAlpha = 0.07 + 0.06 * pu;
      cx.fillStyle = "#ffe14a";
      cx.beginPath();
      cx.arc(e.x, e.y, 150, 0, TAU);
      cx.fill();
      cx.globalAlpha = 0.3 + 0.25 * pu;
      cx.strokeStyle = "#ffe14a";
      cx.lineWidth = 1.5;
      cx.setLineDash([7, 7]);
      cx.lineDashOffset = -t * 40;
      cx.beginPath();
      cx.arc(e.x, e.y, 150, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
    }
    cx.shadowColor = "#ffe14a";
    cx.shadowBlur = 12;
    cx.strokeStyle = n >= 2 ? "#fff4a6" : "#ffe14a";
    cx.lineWidth = 1.2 + n * 0.6;
    cx.globalAlpha = 0.4 + 0.12 * n * pu;
    cx.beginPath();
    const seg = 18;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU + t * (1 + n),
        r =
          R +
          (i % 2 ? 1 : -1) *
            (1.5 + n * 1.2) *
            (0.5 + 0.5 * Math.sin(t * 30 + i * 1.7)),
        px = e.x + Math.cos(a) * r,
        py = e.y + Math.sin(a) * r;
      i ? cx.lineTo(px, py) : cx.moveTo(px, py);
    }
    cx.stroke();
    cx.globalAlpha = 0.8;
    cx.lineWidth = 2;
    cx.shadowBlur = 0;
    cx.beginPath();
    cx.arc(
      e.x,
      e.y,
      R + 7,
      -Math.PI / 2,
      -Math.PI / 2 + TAU * Math.max(0, Math.min(1, (e.cgt || 0) / 6)),
    );
    cx.stroke();
    cx.restore();
    cx.save();
    const py = e.y - e.r - 18;
    for (let q = 0; q < 3; q++) {
      const px = e.x + (q - 1) * 12,
        on = q < n;
      cx.beginPath();
      cx.arc(px, py, on ? 4.5 : 3.5, 0, TAU);
      if (on) {
        cx.fillStyle = n >= 2 && q === n - 1 ? "#ffffff" : "#ffe14a";
        cx.shadowColor = "#ffe14a";
        cx.shadowBlur = 10 + 6 * pu;
        cx.fill();
      } else {
        cx.strokeStyle = "#ffe14a88";
        cx.lineWidth = 1.5;
        cx.stroke();
      }
    }
    cx.restore();
  }
  if (e.stn > 0 && !(e.frz > 0)) {
    cx.save();
    const hy = e.y - e.r - (e.cg > 0 ? 44 : 10);
    cx.globalCompositeOperation = "lighter";
    cx.shadowColor = "#ffe14a";
    cx.shadowBlur = 8;
    cx.fillStyle = "#ffe14a";
    for (let q = 0; q < 3; q++) {
      const a = t * 6 + (q * TAU) / 3,
        x = e.x + Math.cos(a) * 13,
        y = hy + Math.sin(a) * 4;
      cx.beginPath();
      cx.moveTo(x, y - 3);
      cx.lineTo(x + 2.5, y);
      cx.lineTo(x, y + 3);
      cx.lineTo(x - 2.5, y);
      cx.closePath();
      cx.fill();
    }
    cx.globalCompositeOperation = "source-over";
    cx.fillStyle = "#ffe14a44";
    cx.fillRect(e.x - 10, hy - 5, 20, 2);
    cx.fillStyle = "#ffe14a";
    cx.fillRect(e.x - 10, hy - 5, 20 * Math.max(0, Math.min(1, e.stn / 2)), 2);
    cx.restore();
  }
}

// 功能：處理「lzDmg」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function lzDmg(e, d, a, kb, o) {
  const dd = dm(e, d, Math.atan2(pl.y - e.y, pl.x - e.x));
  e.hp -= dd;
  e.hf = dd > 0 ? 1 : 0;
  e.kx += (Math.cos(a) * kb) / e.m;
  e.ky += (Math.sin(a) * kb) / e.m;
  if (o) {
    if (o.bu) e.bu = 3;
    if (o.fr) e.fr = 2;
    if (o.lk && pl.hp < pl.mhp)
      pl.hp = Math.min(pl.mhp, pl.hp + Math.min(2, d * 0.025));
    if (o.fz4) {
      e.fv = (e.fv || 0) + 1;
      e.fr = 1.2;
      if (e.fv >= 6) frz(e);
    }
    if (o.ch) {
      let t2 = null,
        bdist = 140;
      for (const q of en)
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
        fxs.push({
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
function lzHit(x0, y0, a, L, hw, d, kb, o, col) {
  const c = Math.cos(a),
    s = Math.sin(a);
  let n = 0;
  for (const e of en) {
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
function laserFire(w, tg, SB) {
  const R = w.v * w.life,
    hw = Math.max(2.5, w.r * 1.3);
  const a0 = tg ? Math.atan2(tg.y - pl.y, tg.x - pl.x) : pl.aim;
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
      x0 = pl.x + c * 14,
      y0 = pl.y + s * 14;
    const L = ray(x0, y0, a, R);
    hit += lzHit(pl.x, pl.y, a, L + 14, hw, d, w.kb, w, col);
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
    if (pt.length < 600)
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
  if (hit) chgU(pl.w, d * 0.25 * hit);
  pl.lz = { t: 0.13, tg: tg, a: a0, offs: offs, col: col, hw: hw, R: R };
  shake = Math.max(shake, 0.9);
}
// 破滅雷射：蓄力 0.5 秒後釋放一道貫穿一切的粗大光束，持續 2.6 秒並左右掃動
function ultLaser(a) {
  const m = UM || {};
  LZ.push({
    k: "u",
    t: 0,
    ch: 0.5,
    dur: 2.6,
    tk: 0,
    man: UMANUAL,
    base: a,
    a: a,
    off: 0,
    R: 820,
    L: 0,
    x0: pl.x,
    y0: pl.y,
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
  fxs.push({
    k: "w",
    x: pl.x,
    y: pl.y,
    r: 110,
    t: 0.5,
    max: 0.5,
    col: "#ffe14a",
  });
}
// 功能：更新雷射武器與光束狀態。
function updLZ(dt) {
  for (const e of en)
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
  const z = pl.lz;
  if (z && z.t > 0) {
    z.t -= dt;
    const tg = z.tg && z.tg.hp > 0 ? z.tg : null;
    z.a = tg ? Math.atan2(tg.y - pl.y, tg.x - pl.x) : pl.aim;
  }
  for (let i = LZ.length - 1; i >= 0; i--) {
    const u = LZ[i];
    u.t += dt;
    if (!u.man) {
      const tg = ultT();
      u.base = tg ? Math.atan2(tg.y - pl.y, tg.x - pl.x) : pl.aim;
    }
    const fire = u.t >= u.ch;
    u.off = fire ? Math.sin((u.t - u.ch) * 2.7) * 0.42 : 0;
    u.a = u.base + u.off;
    const c = Math.cos(u.a),
      s = Math.sin(u.a);
    u.x0 = pl.x + c * 14;
    u.y0 = pl.y + s * 14;
    u.L = ray(u.x0, u.y0, u.a, u.R);
    if (fire) {
      shake = Math.max(shake, 4);
      u.tk -= dt;
      while (u.tk <= 0) {
        u.tk += 0.05;
        lzHit(pl.x, pl.y, u.a, u.L + 14, u.hw, u.d, u.kb, u.o, u.col);
        if (u.L < u.R - 4)
          hitCell(
            Math.floor((u.x0 + c * (u.L + 4)) / T),
            Math.floor((u.y0 + s * (u.L + 4)) / T),
            2,
          );
      }
      if (pt.length < 600) {
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
      fxs.push({
        k: "w",
        x: pl.x,
        y: pl.y,
        r: 90,
        t: 0.35,
        max: 0.35,
        col: u.col,
      });
    }
  }
}
// 功能：繪製指定方向的雷射光束。
function lzBeam(x, y, a, L, w, col, al) {
  const ex = x + Math.cos(a) * L,
    ey = y + Math.sin(a) * L,
    fl = 1 + 0.12 * Math.sin(time * 70);
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
function drawLZ() {
  if (state !== "play") return;
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
  const z = pl.lz;
  if (z && z.t > 0) {
    const al = Math.min(1, z.t / 0.05);
    for (const o of z.offs) {
      const a = z.a + o,
        x0 = pl.x + Math.cos(a) * 14,
        y0 = pl.y + Math.sin(a) * 14,
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

ULN.push("絕對零度", "黑洞", "雷霆震懇", "天羅地網");
ULTS[16] = (a) => {
  fxs.push({
    k: "w",
    x: pl.x,
    y: pl.y,
    r: 300,
    t: 0.6,
    max: 0.6,
    col: "#ffe14a",
  });
  for (const e of en) {
    if (e.hp > 0 && Math.hypot(e.x - pl.x, e.y - pl.y) < 300) {
      if (!isB(e)) e.stn = 2;
      e.fr = 3;
      e.hp -= dm(e, 90 * dmM());
      e.hf = 1;
      if (e.hp <= 0) kill(e);
    }
  }
  shake = 10;
  flash("#ffe14a", 0.4, 0.35);
};
ULTS[17] = (a, q) => {
  const d = LR(q),
    x = pl.x + Math.cos(a) * d,
    y = pl.y + Math.sin(a) * d;
  spot(x, y, 220, 0.5, "#ffe14a");
  later(0.5, () => {
    zones.push({
      k: "gpull",
      x,
      y,
      r: 220,
      t: 5,
      max: 5,
      col: "#ffe14a",
      ult: 1,
      ...ufl(),
    });
    for (let k = 0; k < 6; k++)
      later(0.4 + 0.5 * k, () => {
        for (const e of en)
          if (e.hp > 0 && Math.hypot(e.x - x, e.y - y) < 90) {
            {
              const d0 = dm(e, 10 * dmM() * (UM ? UM.dm : 1));
              e.hp -= d0;
              e.hf = 1;
              chipHit(e, d0, ufl());
            }
            if (e.hp <= 0) kill(e);
          }
      });
  });
};
ULTS[18] = (a) => {
  flash("#ffe14a", 0.35, 0.4);
  for (const e of en) {
    if (e.hp <= 0 || Math.hypot(e.x - pl.x, e.y - pl.y) > 520) continue;
    fxs.push({
      k: "l",
      x: e.x,
      y: e.y - 300,
      a: Math.PI / 2,
      len: 300,
      t: 0.25,
      max: 0.25,
      col: "#ffe14a",
    });
    if (!isB(e)) e.stn = 1.6;
    e.hp -= dm(e, 60 * dmM());
    e.hf = 1;
    if (e.hp <= 0) kill(e);
  }
  shake = 12;
};
ULTS[19] = (a) => {
  fxs.push({
    k: "w",
    x: pl.x,
    y: pl.y,
    r: 340,
    t: 0.5,
    max: 0.5,
    col: "#ffe14a",
  });
  for (const e of en) {
    if (e.hp <= 0 || Math.hypot(e.x - pl.x, e.y - pl.y) > 340) continue;
    if (!isB(e)) e.root = 3.5;
    e.fr = 3.5;
  }
};
ULTS[16] = (a) => {
  zones.push({
    k: "storm",
    x: pl.x,
    y: pl.y,
    r: 260,
    t: 5,
    max: 5,
    col: "#ffe14a",
  });
  flash("#ffe14a", 0.3, 0.3);
};
ULTS[18] = (a, q) => {
  const d = LR(q),
    x = pl.x + Math.cos(a) * d,
    y = pl.y + Math.sin(a) * d;
  spot(x, y, 130, 0.5, "#ffe14a");
  later(0.5, () =>
    zones.push({
      k: "cloud",
      x,
      y,
      r: 130,
      t: 7,
      max: 7,
      col: "#ffe14a",
      dm: UM ? UM.dm : 1,
      ...ufl(),
    }),
  );
};
ULTS[19] = (a, q) => {
  const d = LR(q),
    x = pl.x + Math.cos(a) * d,
    y = pl.y + Math.sin(a) * d;
  zones.push(
    thr(
      { k: "web", x, y, r: 160, t: 5, max: 5, col: "#ffe14a", ...ufl() },
      pl.x,
      pl.y,
      0.3,
    ),
  );
  flash("#ffe14a", 0.2, 0.2);
};
ULN[16] = "冰河期";
ULN[18] = "雷暴領域";
// 功能：處理「fTarget」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function fTarget(e) {
  let b = null,
    bd = Math.hypot(pl.x - e.x, pl.y - e.y) * 0.9;
  for (const z of zones) {
    if (z.k !== "tur" || z.hp <= 0 || (z.th && z.th.t > 0)) continue;
    const d = Math.hypot(z.x - e.x, z.y - e.y);
    if (d < bd && d < 700) {
      bd = d;
      b = z;
    }
  }
  return b;
}
// 功能：處理「wBul」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function wBul(w, x, y, a, mul) {
  const crt = w.cr && Math.random() < w.cr;
  a += (Math.random() - 0.5) * 0.06;
  bl.push({
    x,
    y,
    vx: Math.cos(a) * w.v * BS,
    vy: Math.sin(a) * w.v * BS,
    r: w.r,
    own: 1,
    dmg: w.dmg * mul * (crt ? w.cm : 1),
    life: w.life / BS,
    col: crt ? "#ffffff" : w.c,
    kb: w.kb,
    wi: WP.indexOf(w),
    pe: w.pierce,
    pierce: w.pa,
    hm: w.hm,
    ch: w.ch,
    bn: w.bn,
    xb: w.xb,
    bu: w.bu,
    fr: w.fr,
    lk: w.lk,
    fz4: w.fz4,
    wd: w.wd,
    l0: w.life / BS,
    age: 0,
    lc: -1,
    hit: [],
  });
}
// 功能：處理「frag」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function frag(b) {
  const n = b.cs > 1 ? b.cs : 8;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + Math.random() * 0.4;
    bl.push({
      x: b.x,
      y: b.y,
      vx: Math.cos(a) * 380 * BS,
      vy: Math.sin(a) * 380 * BS,
      r: 5,
      own: 1,
      dmg: b.dmg * 0.35,
      life: 0.3 / BS,
      col: b.col,
      kb: Math.max(50, (b.kb || 0) * 0.3),
      wd: Math.max(0.3, b.wd || 0),
      bu: b.bu,
      fr: b.fr,
      lk: b.lk,
      fz4: b.fz4,
      ch: b.ch,
      xb: b.xb,
      pe: b.pe,
      l0: 0.3 / BS,
      age: 0,
      lc: -1,
      hit: [],
      ult: b.ult,
      wi: b.wi,
    });
  }
  burst(b.x, b.y, b.col, 10, 200, 2.5, 0.35);
  shake = Math.max(shake, 3);
}
// 功能：處理「slashHit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function slashHit(x, y, a, sw, rg, dmg, kb, col, w, nu) {
  const full = sw >= TAU - 0.01,
    an = (px, py) => Math.atan2(py - y, px - x),
    df = (p, q) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q)));
  for (const e of en) {
    if (e.hp <= 0) continue;
    const dx = e.x - x,
      dy = e.y - y,
      d = Math.hypot(dx, dy);
    if (d > rg + e.r) continue;
    if (!full && df(an(e.x, e.y), a) > sw / 2 + Math.atan2(e.r, Math.max(d, 1)))
      continue;
    const crt = w && w.cr && Math.random() < w.cr,
      dd = dm(e, dmg * (crt ? w.cm : 1), Math.atan2(y - e.y, x - e.x));
    e.hp -= dd;
    e.hf = dd > 0 ? 1 : 0;
    e.kx += ((dx / (d || 1)) * kb) / e.m;
    e.ky += ((dy / (d || 1)) * kb) / e.m;
    if (w) {
      if (w.bu) e.bu = 3;
      if (w.fr) e.fr = 2;
      if (w.lk && dd > 0 && pl.hp < pl.mhp)
        pl.hp = Math.min(pl.mhp, pl.hp + Math.min(2, dd * 0.025));
      if (dd > 0) {
        if (w.fz4 || w.ch) chipHit(e, dd, { fz4: w.fz4, ch: w.ch });
        if (w.xb && Math.random() < 0.3)
          explode({
            x: e.x,
            y: e.y,
            ex: 48,
            dmg: dd * 0.35,
            kb: 120,
            wd: 0,
            col: w.c || col,
          });
      }
    }
    if (dd > 0) {
      if (!nu) chgU(w, dd * 0.25);
      burst(e.x, e.y, e.col, 6, 160, 2, 0.3);
    } else burst(e.x, e.y, "#9aa0ab", 10, 200, 2, 0.35);
    if (e.hp <= 0) kill(e);
  }
  for (const b of bl) {
    if (b.own || b.life <= 0) continue;
    const dx = b.x - x,
      dy = b.y - y;
    if (Math.hypot(dx, dy) > rg) continue;
    if (!full && df(an(b.x, b.y), a) > sw / 2) continue;
    b.life = 0;
    burst(b.x, b.y, col, 3, 90, 2, 0.25);
  }
  const wn = Math.floor((w && w.wd) || 0);
  if (wn > 0)
    for (let k = 0; k < 6; k++) {
      const aa = full ? (k / 6) * TAU : a + (k / 5 - 0.5) * sw;
      hitCell(
        Math.floor((x + Math.cos(aa) * rg * 0.8) / T),
        Math.floor((y + Math.sin(aa) * rg * 0.8) / T),
        wn,
      );
    }
  fxs.push({ k: "sl", x, y, a, sw, r: rg, t: 0.26, max: 0.26, col });
}
ULN.push("砲塔陣", "毒霧瀰漫", "旋風斬", "集束轟炸");
ULTS[20] = (a, q) => {
  const w = Object.assign({}, WP[pl.w], { c: "#ffe14a", r: 7 });
  const d = LR(q),
    [x, y] = turLand(pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d, 36, 30);
  zones.push(
    thr(
      {
        k: "tur",
        x,
        y,
        r: 28,
        t: 22,
        max: 22,
        hp: 300,
        mhp: 300,
        col: "#ffe14a",
        w,
        cd: 0.8,
        ang: a,
        rg: 420,
        fi: 2.5,
        big: 1,
        br: 42,
        gd: 140 * dmM() * (UM ? UM.dm : 1),
        ult: 1,
      },
      pl.x,
      pl.y,
      0.45,
    ),
  );
  fxs.push({
    k: "w",
    x: pl.x,
    y: pl.y,
    r: 90,
    t: 0.35,
    max: 0.35,
    col: "#ffe14a",
  });
};
ULTS[21] = (a, q) => {
  const d = LR(q),
    x = Math.max(20, Math.min(MW - 20, pl.x + Math.cos(a) * d)),
    y = Math.max(20, Math.min(MW - 20, pl.y + Math.sin(a) * d));
  zones.push(
    thr(
      {
        k: "tox",
        x,
        y,
        r: 190,
        t: 5,
        max: 5,
        col: "#ffe14a",
        dmg: 360 * (5 / 9) * dmM() * (UM ? UM.dm : 1),
        ult: 1,
        ...ufl(),
      },
      pl.x,
      pl.y,
      0.5,
    ),
  );
};
ULTS[22] = (a, q) => {
  const w = WP[pl.w];
  fxs.push({
    k: "c",
    x: pl.x,
    y: pl.y,
    r: 215,
    t: 0.45,
    max: 0.45,
    col: "#ffe14a",
    fp: 1,
  });
  later(0.45, () => {
    slashHit(pl.x, pl.y, 0, TAU, 215, 260 * dmM(), 900, "#ffe14a", w, 1);
    shake = Math.max(shake, 14);
  });
};
ULTS[23] = (a, q) => {
  for (let k = 0; k < 5; k++)
    later(k * 0.08, () =>
      ub(a + (k - 2) * 0.22, 520, {
        dmg: 70,
        r: 11,
        life: 0.5 / BS,
        cs: 12,
        pe: 0,
        kb: 200,
        col: "#ffe14a",
      }),
    );
};
// 功能：處理「ultRing」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function ultRing() {
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * TAU;
    bl.push({
      x: pl.x,
      y: pl.y,
      vx: Math.cos(a) * 430 * BS,
      vy: Math.sin(a) * 430 * BS,
      r: 6,
      own: 1,
      dmg: 30,
      life: 1.3 / BS,
      pierce: 1,
      hit: [],
      ult: 1,
      kb: 350,
      lc: -1,
      col: "#ffe14a",
    });
  }
  shake = 14;
  burst(pl.x, pl.y, "#ffe14a", 40, 320, 3, 0.7);
}
// 衝刺：短暫無敵位移，方向取輸入或瞄準方向
function dash(ang) {
  if (state !== "play" || pl.dashCd > 0) return;
  let { ix, iy } = inp();
  if (ang !== undefined) {
    ix = Math.cos(ang);
    iy = Math.sin(ang);
  } else if (!ix && !iy) {
    ix = Math.cos(pl.aim);
    iy = Math.sin(pl.aim);
  }
  const n = Math.hypot(ix, iy) || 1;
  pl.dx = ix / n;
  pl.dy = iy / n;
  pl.dashT = 0.17;
  pl.dashCd = 1.2 * (1 - 0.06 * UL("dsh"));
}
// 功能：彙整鍵盤、滑鼠與觸控輸入。
function inp() {
  let ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    iy = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  if (ix || iy) {
    const n = Math.hypot(ix, iy);
    ix /= n;
    iy /= n;
  }
  if (tm.id !== null) {
    const dx = tm.x - tm.sx,
      dy = tm.y - tm.sy,
      d = Math.hypot(dx, dy);
    if (d > 6 * HU) {
      ix = dx / d;
      iy = dy / d;
    }
  }
  return { ix, iy };
}
// 每幀更新玩家：移動、彈藥回復、拾取物判定
function updPl(dt) {
  const p = pl,
    { ix, iy } = inp();
  p.hf -= dt;
  p.rc = Math.max(0, p.rc - dt * 0.25);
  p.slow -= dt;
  if (p.slow <= 0) p.slowL = 0;
  if (p.vuln > 0) p.vuln -= dt;
  p.dashCd -= dt;
  p.boost -= dt;
  p.sc -= dt;
  if (ta.act) {
    p.aim = ta.a;
    p.q = Math.max(
      0,
      Math.min(
        1,
        (Math.hypot(ta.x - ta.sx, ta.y - ta.sy) - CZ) / (90 * HU - CZ),
      ),
    );
  } else if (mouse.has) {
    p.aim = Math.atan2(mouse.y / S + camy - p.y, mouse.x / S + camx - p.x);
    p.q = Math.max(
      0,
      Math.min(
        1,
        Math.hypot(mouse.x / S + camx - p.x, mouse.y / S + camy - p.y) / 260,
      ),
    );
  }
  if (pl.lw !== pl.w) {
    if (pl.lw !== undefined) {
      pl.sb = 2.5;
      fxs.push({
        k: "w",
        x: pl.x,
        y: pl.y,
        r: 55,
        t: 0.35,
        max: 0.35,
        col: WP[pl.w].c,
      });
    }
    pl.lw = pl.w;
  }
  if (pl.sb > 0) pl.sb -= dt;
  for (const w of WP)
    if (w.am < w.ms)
      w.am = Math.min(w.ms, w.am + (dt * (1 + 0.08 * UL("reg"))) / w.rs);
  if (train && inf) {
    for (const w of WP) {
      w.am = w.ms;
      w.um = 100;
    }
  }
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.vx = p.dx * 420;
    p.vy = p.dy * 420;
    burst(p.x, p.y, "#22e6ff", 2, 40, 3, 0.3);
  } else {
    const sp =
      PSPD *
      (1 + 0.04 * UL("spd")) *
      (p.boost > 0 ? 1.4 : 1) *
      (p.slow > 0 ? (p.slowL >= 2 ? 0.3 : 0.5) : 1);
    p.vx = ix * sp;
    p.vy = iy * sp;
  }
  mv(p, p.vx * dt, p.vy * dt);
  if (p.pvx || p.pvy) {
    mv(p, p.pvx * dt, p.pvy * dt);
    const f = Math.exp(-1.5 * dt);
    p.pvx *= f;
    p.pvy *= f;
    if (Math.hypot(p.pvx, p.pvy) < 1) p.pvx = p.pvy = 0;
  }
  if (mouse.down && WP[p.w].auto) shoot();
  if (ta.act && WP[p.w].auto) {
    const dq = Math.hypot(ta.x - ta.sx, ta.y - ta.sy);
    if (dq > CZ) {
      shoot();
      ta.fired = 1;
    } else if (!ta.out && performance.now() - ta.t0 > 250) {
      shoot(false, true);
      ta.fired = 1;
    }
  }
  for (let i = pk.length - 1; i >= 0; i--) {
    const q = pk[i];
    q.life -= dt;
    if (q.life <= 0) {
      pk.splice(i, 1);
      continue;
    }
    if (q.vac) {
      if (q.dl > 0) q.dl -= dt;
      else {
        q.vs = Math.min(1500, q.vs + 1100 * dt);
        const mx = p.x - q.x,
          my = p.y - q.y,
          md = Math.hypot(mx, my);
        if (md > 1) {
          const st = Math.min(md, q.vs * dt);
          q.x += (mx / md) * st;
          q.y += (my / md) * st;
        }
        if (Math.random() < 0.7)
          burst(q.x, q.y, PC[q.t] || "#ffffff", 1, 25, 2.2, 0.25);
      }
    }
    if (q.t === "coin" || q.t === "shard" || q.t === "core" || q.t === "chip") {
      const mx = p.x - q.x,
        my = p.y - q.y,
        md = Math.hypot(mx, my);
      if (md < 120 && md > 1) {
        q.x += (mx / md) * 260 * dt;
        q.y += (my / md) * 260 * dt;
      }
    }
    if (Math.hypot(q.x - p.x, q.y - p.y) < p.r + 15) {
      collectPk(q);
      pk.splice(i, 1);
    }
  }
}
// 功能：處理「eb」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function eb(e, a, sp, dmg, eff) {
  bl.push({
    eff,
    hm2: eff === 2,
    x: e.x + Math.cos(a) * e.r,
    y: e.y + Math.sin(a) * e.r,
    vx: Math.cos(a) * sp * BS,
    vy: Math.sin(a) * sp * BS,
    r: 5,
    own: 0,
    dmg,
    life: 3,
    col: e.col,
  });
}
// 功能：更新「updEW」所管理的遊戲狀態。
function updEW(dt) {
  for (let n = ewl.length - 1; n >= 0; n--) {
    const w = ewl[n],
      x = (w.i + 0.5) * T,
      y = (w.j + 0.5) * T;
    w.life -= dt;
    if (grid[w.j * N + w.i] <= 0) {
      zones.push({
        k: "bomb",
        x,
        y,
        r: 45,
        t: 0.4,
        max: 0.4,
        col: EL_COL,
        dmg: 10,
      });
      burst(x, y, EL_COL, 10, 160, 2, 0.4);
      ewl.splice(n, 1);
      continue;
    }
    if (w.life <= 0) {
      grid[w.j * N + w.i] = 0;
      burst(x, y, EL_COL, 8, 120, 2, 0.4);
      ewl.splice(n, 1);
      continue;
    }
    w.nt -= dt;
    if (w.nt <= 0) {
      w.nt = 2.5;
      const dx = w.cx - x,
        dy = w.cy - y;
      let ni = w.i,
        nj = w.j;
      if (Math.abs(dx) > Math.abs(dy)) ni += Math.sign(dx);
      else nj += Math.sign(dy);
      const nx = (ni + 0.5) * T,
        ny = (nj + 0.5) * T;
      if (
        (ni !== w.i || nj !== w.j) &&
        Math.hypot(dx, dy) > T * 1.5 &&
        cell(ni, nj) === 0 &&
        Math.hypot(nx - pl.x, ny - pl.y) > 40 &&
        !en.some((q) => Math.hypot(q.x - nx, q.y - ny) < q.r + T * 0.5)
      ) {
        grid[nj * N + ni] = grid[w.j * N + w.i];
        grid[w.j * N + w.i] = 0;
        w.i = ni;
        w.j = nj;
      }
    }
    w.st -= dt;
    if (w.st <= 0) {
      w.st = 3;
      const a = Math.atan2(pl.y - y, pl.x - x),
        d = Math.hypot(pl.x - x, pl.y - y),
        sx = x + Math.cos(a) * T * 0.8,
        sy = y + Math.sin(a) * T * 0.8;
      if (d < 520 && !solidAt(sx, sy) && ray(sx, sy, a, d) >= d - T - 6)
        bl.push({
          eff: 0,
          x: sx,
          y: sy,
          vx: Math.cos(a) * 160 * BS,
          vy: Math.sin(a) * 160 * BS,
          r: 4,
          own: 0,
          dmg: 6,
          life: 3,
          col: EL_COL,
        });
    }
  }
  for (let n = egh.length - 1; n >= 0; n--) {
    const g = egh[n];
    g.t -= dt;
    if (!g.fd && g.t <= 0.4) {
      g.fd = 1;
      const a = Math.atan2(pl.y - g.y, pl.x - g.x);
      bl.push({
        eff: 0,
        x: g.x + Math.cos(a) * 13,
        y: g.y + Math.sin(a) * 13,
        vx: Math.cos(a) * 320 * BS,
        vy: Math.sin(a) * 320 * BS,
        r: 5,
        own: 0,
        dmg: 14,
        life: 3,
        col: g.col,
      });
      burst(g.x, g.y, g.col, 6, 150, 2, 0.3);
    }
    if (g.t <= 0) egh.splice(n, 1);
  }
}
// 功能：處理「elzHit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function elzHit(e, dmg) {
  const c = Math.cos(e.lza),
    s = Math.sin(e.lza),
    dx = pl.x - e.x,
    dy = pl.y - e.y,
    u = dx * c + dy * s;
  if (u > 0 && u < e.lzL && Math.abs(-dx * s + dy * c) < pl.r + 10) hurt(dmg);
}
// 功能：處理「lzEnd」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function lzEnd(e, n) {
  const c = Math.cos(e.lza),
    s = Math.sin(e.lza);
  hitCell(
    Math.floor((e.x + c * (e.lzL + 4)) / T),
    Math.floor((e.y + s * (e.lzL + 4)) / T),
  );
  if (n > 1)
    hitCell(
      Math.floor((e.x + c * (e.lzL + 4 + T)) / T),
      Math.floor((e.y + s * (e.lzL + 4 + T)) / T),
    );
}
// 敵人開火（依種類發射子彈、投放地面區域或召喚）
function fire(e) {
  const t = e.t;
  e.rec = REC[t] || 0.6;
  e.cd =
    Math.max(1, ((e.el && ELITE[t].cd) || CD[t]) - 0.05 * wave) +
    Math.random() * 0.6;
  if (t === 1) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      eb(e, e.aim, 480, 28);
      if (e.shc % 3 === 0) {
        const bb = bl[bl.length - 1];
        bb.pw = 1;
        bb.col = EL_COL;
        bb.r = 6.5;
      }
    } else eb(e, e.aim, 400, 20);
  } else if (t === 2) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      if (e.shc % 2 === 0) {
        for (let k = -3; k <= 3; k++) eb(e, e.aim + k * 0.1, 250, 11);
        e.dsc = 0.3;
        e.dsa = e.aim;
        fxs.push({
          k: "w",
          x: e.x,
          y: e.y,
          r: 40,
          t: 0.3,
          max: 0.3,
          col: EL_COL,
        });
      } else for (let k = -3; k <= 3; k++) eb(e, e.aim + k * 0.2, 250, 11);
    } else for (let k = -2; k <= 2; k++) eb(e, e.aim + k * 0.22, 235, 9);
  } else if (t === 3) {
    if (e.el) {
      const nb = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < nb; k++) {
        const a = Math.random() * TAU,
          o = k ? 30 + Math.random() * 50 : 0,
          d = 0.55 + Math.random() * 0.25;
        zones.push(
          thr(
            {
              k: "bomb",
              x: e.tx + Math.cos(a) * o,
              y: e.ty + Math.sin(a) * o,
              r: 70,
              t: d + 0.45,
              max: d + 0.45,
              col: e.col,
              dmg: 30,
              bnc: 1,
            },
            e.x,
            e.y,
            d,
          ),
        );
      }
    } else
      zones.push(
        thr(
          {
            k: "bomb",
            x: e.tx,
            y: e.ty,
            r: 64,
            t: 1.1,
            max: 1.1,
            col: e.col,
            dmg: 25,
          },
          e.x,
          e.y,
          0.65,
        ),
      );
  } else if (t === 4) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      eb(e, e.aim, 320, 8, 3);
      if (e.shc % 4 === 0) {
        const bb = bl[bl.length - 1];
        bb.efz = 1;
        bb.col = "#bfefff";
        bb.r = 7.5;
      }
    } else eb(e, e.aim, 300, 6, 1);
  } else if (t === 5)
    zones.push(
      e.el
        ? {
            k: "pull",
            x: e.tx,
            y: e.ty,
            r: 160,
            t: 3,
            max: 3,
            col: e.col,
            el: 1,
            dps: 4,
          }
        : {
            k: "pull",
            x: e.tx,
            y: e.ty,
            r: 130,
            t: 2.5,
            max: 2.5,
            col: e.col,
          },
    );
  else if (t === 6) {
    const E = e.el,
      nn = E ? 3 : 2;
    for (let k = 0; k < nn; k++)
      if (en.length < (E ? 45 : 40)) {
        const m = mkEn(0, e.x + (k - (nn - 1) / 2) * 40, e.y);
        if (blocked(m.x, m.y, m.r)) continue;
        m.r = E ? 10 : 9;
        m.hp = m.mhp = E ? 18 : 12;
        m.sc = 30;
        m.sp *= E ? 1.4 : 1.3;
        if (E) {
          m.sm = 1;
          m.inv = 1.6;
        }
        en.push(m);
      }
    if (E)
      fxs.push({
        k: "w",
        x: e.x,
        y: e.y,
        r: 70,
        t: 0.5,
        max: 0.5,
        col: EL_COL,
      });
  } else if (t === 7 && e.el) {
    e.lz = 0.9;
    e.lza = e.aim;
    e.lzT = 0.3;
    e.lzL = ray(e.x, e.y, e.aim, 750);
    elzHit(e, 32);
    lzEnd(e, Math.random() < 0.5 ? 2 : 1);
    {
      const c = Math.cos(e.aim),
        s = Math.sin(e.aim);
      for (let q = 0; q < e.lzL; q += 10)
        burst(e.x + c * q, e.y + s * q, e.col, 2, 40, 3, 0.3);
    }
    shake = Math.max(shake, 6);
  } else if (t === 7) {
    const L = ray(e.x, e.y, e.aim, 700),
      c = Math.cos(e.aim),
      s = Math.sin(e.aim),
      dx = pl.x - e.x,
      dy = pl.y - e.y,
      u = dx * c + dy * s;
    for (let q = 0; q < L; q += 10)
      burst(e.x + c * q, e.y + s * q, e.col, 2, 40, 3, 0.3);
    if (u > 0 && u < L && Math.abs(-dx * s + dy * c) < pl.r + 8) hurt(25);
    hitCell(
      Math.floor((e.x + c * (L + 4)) / T),
      Math.floor((e.y + s * (L + 4)) / T),
    );
    shake = Math.max(shake, 5);
  } else if (t === 27) {
    if (e.el) {
      e.shc = (e.shc || 0) + 1;
      for (let k = -1; k <= 1; k++) {
        eb(e, e.aim + k * 0.3, 165, 14, 2);
        const bb = bl[bl.length - 1];
        bb.hr = 2.2;
        bb.acc = 1;
        if (k === 0 && e.shc % 3 === 0) {
          bb.spl = 1;
          bb.col = EL_COL;
          bb.r = 6.5;
        }
      }
    } else {
      eb(e, e.aim - 0.25, 150, 12, 2);
      eb(e, e.aim + 0.25, 150, 12, 2);
    }
  } else if (t === 28) {
    let h = 0;
    for (const o of en)
      if (
        o !== e &&
        o.hp > 0 &&
        o.hp < o.mhp &&
        Math.hypot(o.x - e.x, o.y - e.y) < (e.el ? 220 : 180)
      ) {
        o.hp = Math.min(o.mhp, o.hp + o.mhp * (e.el ? 0.45 : 0.35));
        burst(o.x, o.y, "#6dffb0", 10, 120, 2, 0.5);
        h = 1;
      }
    fxs.push({
      k: "w",
      x: e.x,
      y: e.y,
      r: e.el ? 220 : 180,
      t: 0.5,
      max: 0.5,
      col: "#6dffb0",
    });
    if (!h) e.cd = e.el ? 1 : 1.2;
    if (e.el && h && Math.hypot(pl.x - e.x, pl.y - e.y) < 220) {
      pl.vuln = 3;
      const dd = Math.hypot(pl.x - e.x, pl.y - e.y);
      if (dd < 120 && pl.dashT <= 0) {
        const a = Math.atan2(pl.y - e.y, pl.x - e.x);
        pl.pvx += Math.cos(a) * 170;
        pl.pvy += Math.sin(a) * 170;
      }
    }
  } else if (t === 29) {
    const E = e.el,
      nt = E ? (wave > 14 ? 4 : 3) : 2 + (wave > 14 ? 1 : 0);
    for (let k = 0; k < nt; k++) {
      const ax = Math.random() * TAU,
        o = k ? Math.random() * (E ? 100 : 80) : 0,
        z0 = {
          k: "slowz",
          x: e.tx + Math.cos(ax) * o,
          y: e.ty + Math.sin(ax) * o,
          r: E ? 70 : 60,
          t: E ? 8 : 7,
          max: E ? 8 : 7,
          col: e.col,
        };
      if (E && k === 1) {
        z0.trg = 1;
        z0.col = "#ff8a3a";
      } else if (E && k === 2) {
        z0.trg = 2;
        z0.col = "#4de1ff";
      }
      zones.push(thr(z0, e.x, e.y, 0.5));
    }
  } else if (t === 10) {
    if (e.el) {
      const a0 = time * 1.3;
      for (let k = 0; k < 12; k++) eb(e, a0 + (k * Math.PI) / 6, 210, 10);
      for (let k = 0; k < 12; k++) {
        eb(e, a0 + Math.PI / 12 + (k * Math.PI) / 6, 260, 6);
        bl[bl.length - 1].col = "#ffc0e8";
      }
    } else {
      for (let k = 0; k < 8; k++) eb(e, time + (k / 8) * TAU, 190, 8);
    }
  } else if (t === 11) {
    const E = e.el;
    if (E) egh.push({ x: e.x, y: e.y, t: 0.7, max: 0.7, col: e.col });
    e.x = e.tx;
    e.y = e.ty;
    {
      const P = leadAt(
        e,
        (E ? 320 : 300) * BS,
        0,
        Math.min(0.9, 0.4 + wave * 0.035) * 0.8,
      );
      e.aim = Math.atan2(P[1] - e.y, P[0] - e.x);
    }
    if (E) {
      for (let k = 0; k < 4; k++) eb(e, e.aim + (k - 1.5) * 0.11, 320, 14);
    } else for (let k = -1; k <= 1; k++) eb(e, e.aim + k * 0.12, 300, 12);
  } else if (t === 13 && e.el) {
    const g1 = (Math.random() * 5) | 0,
      g2 = Math.random() < 0.5 ? (g1 + 2) % 5 : -1;
    for (let k = 0; k < 5; k++) {
      const a = Math.random() * TAU,
        r = Math.random() * 90,
        tt = 1.1 + k * 0.18;
      zones.push(
        thr(
          {
            k: "bomb",
            x: e.tx + Math.cos(a) * r,
            y: e.ty + Math.sin(a) * r,
            r: 55,
            t: tt,
            max: tt,
            col: e.col,
            dmg: 22,
            gd: k === g1 || k === g2 ? 1 : 0,
          },
          e.x,
          e.y,
          0.7 + k * 0.1,
        ),
      );
    }
  } else if (t === 13) {
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * TAU,
        r = Math.random() * 70;
      zones.push(
        thr(
          {
            k: "bomb",
            x: e.tx + Math.cos(a) * r,
            y: e.ty + Math.sin(a) * r,
            r: 50,
            t: 1.3 + k * 0.2,
            max: 1.3 + k * 0.2,
            col: e.col,
            dmg: 18,
          },
          e.x,
          e.y,
          1 + k * 0.1,
        ),
      );
    }
  } else if (t === 9) {
    const E = e.el,
      n9 = E ? 10 : 8,
      r9 = E ? 90 : 75;
    for (let k = 0; k < n9; k++) {
      const a = (k / n9) * TAU,
        x = e.tx + Math.cos(a) * r9,
        y = e.ty + Math.sin(a) * r9,
        i = Math.floor(x / T),
        j = Math.floor(y / T);
      if (cell(i, j) === 0 && Math.hypot(x - pl.x, y - pl.y) > 35) {
        grid[j * N + i] = E ? 7 : 3;
        if (E)
          ewl.push({
            i,
            j,
            cx: e.tx,
            cy: e.ty,
            nt: 2 + Math.random(),
            st: 1.5 + Math.random() * 2,
            life: 14,
          });
        burst(
          (i + 0.5) * T,
          (j + 0.5) * T,
          E ? EL_COL : "#ffd23a",
          8,
          100,
          2,
          0.4,
        );
      }
    }
  }
  burst(e.x, e.y, e.col, 6, 150, 2, 0.3);
}
// 每幀更新單一敵人：移動、預警、開火等 AI
function updEn(e, dt) {
  const dx = pl.x - e.x,
    dy = pl.y - e.y,
    d = Math.hypot(dx, dy) || 1,
    a = Math.atan2(dy, dx);
  e.ang = a;
  e.hf = Math.max(0, e.hf - dt * 6);
  e.cc -= dt;
  if (e.bo > 0) e.bo -= dt;
  if (e.lz > 0) {
    e.lz -= dt;
    let df = Math.atan2(pl.y - e.y, pl.x - e.x) - e.lza;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    e.lza += Math.max(-0.6 * dt, Math.min(0.6 * dt, df));
    e.lzL = ray(e.x, e.y, e.lza, 750);
    e.lzT -= dt;
    if (e.lzT <= 0) {
      e.lzT += 0.3;
      elzHit(e, 8);
      lzEnd(e, 1);
    }
    if (Math.random() < 0.7) {
      const q = Math.random() * e.lzL;
      burst(
        e.x + Math.cos(e.lza) * q,
        e.y + Math.sin(e.lza) * q,
        e.col,
        1,
        40,
        3,
        0.25,
      );
    }
    if (e.lz <= 0) {
      const c = Math.cos(e.lza),
        s = Math.sin(e.lza);
      for (let q = 45; q < e.lzL; q += 45)
        zones.push({
          k: "flame",
          x: e.x + c * q,
          y: e.y + s * q,
          r: 16,
          t: 1.5,
          max: 1.5,
          col: "#ff7a1a",
          dps: 10,
        });
    }
  }
  if (e.dsc > 0) {
    e.dsc -= dt;
    if (e.dsc <= 0) {
      for (let k = -3; k <= 3; k++)
        (eb(e, e.dsa + k * 0.26, 250, 11), (bl[bl.length - 1].col = EL_COL));
      burst(e.x, e.y, EL_COL, 10, 160, 2, 0.35);
    }
  }
  if (e.rec > 0) {
    e.rec -= dt;
    return;
  }
  if (e.un > 0) {
    e.un -= dt;
    mv(e, Math.cos(e.ua) * e.sp * dt, Math.sin(e.ua) * e.sp * dt);
    return;
  }
  if (e.t === 0 || e.t === 12) {
    const na = nav(e, flk(e, a, d), d),
      sp = e.sp + (e.bo > 0 ? 40 * ESPD : 0);
    if (e.el && e.t === 0) {
      e.ft = (e.ft || 0) - dt;
      if (e.ft <= 0) {
        e.ft = 0.1;
        zones.push({
          k: "flame",
          x: e.x,
          y: e.y,
          r: 15,
          t: 0.6,
          max: 0.6,
          col: "#ff7a1a",
          dps: 10,
        });
      }
    }
    if (mv(e, Math.cos(na) * sp * dt, Math.sin(na) * sp * dt)) {
      e.ramT += dt;
      if (e.ramT > (e.el && e.t === 0 ? 0.3 : 0.4)) {
        e.ramT = 0;
        const px = e.x + Math.cos(a) * (e.r + 6),
          py = e.y + Math.sin(a) * (e.r + 6);
        hitCell(Math.floor(px / T), Math.floor(py / T));
      }
    } else e.ramT = 0;
    if (d < e.r + pl.r + 2 && e.cc <= 0 && pl.dashT <= 0) {
      hurt(
        e.t === 12
          ? (e.el ? [20, 14, 9] : [14, 10, 7])[e.gen || 0]
          : e.el
            ? 22
            : 14,
      );
      e.cc = e.el && e.t === 0 ? 0.55 : 0.7;
      if (e.el && e.t === 0) e.bo = 0.8;
    }
  } else if (isB(e)) bossAI3(e, dt, d, bLead(e, a));
  else if (e.t === 30) cloneAI(e, dt);
  else if (e.t === 31) nodeAI(e, dt);
  else if (e.t === 26) {
    const na = nav(e, a, d);
    mv(e, Math.cos(na) * e.sp * dt, Math.sin(na) * e.sp * dt);
    if (d < e.r + pl.r + (e.el ? 30 : 26)) {
      zones.push({
        k: "bomb",
        x: e.x,
        y: e.y,
        r: e.el ? 95 : 75,
        t: e.el ? 0.5 : 0.45,
        max: e.el ? 0.5 : 0.45,
        col: e.col,
        dmg: e.el ? 38 : 28,
      });
      if (e.el) {
        const ph = Math.random() * TAU;
        for (let q = 0; q < 2; q++) {
          const aa = ph + q * Math.PI;
          zones.push({
            k: "bomb",
            x: e.x + Math.cos(aa) * 60,
            y: e.y + Math.sin(aa) * 60,
            r: 40,
            t: 0.7,
            max: 0.7,
            col: e.col,
            dmg: 15,
          });
        }
      }
      burst(e.x, e.y, e.col, 20, 260, 3, 0.5);
      e.hp = 0;
    }
  } else if (e.t === 8) chg(e, dt, d, a);
  else if (e.tele > 0) {
    e.tele -= dt;
    if (e.tele <= 0) fire(e);
  } else {
    const los = ray(e.x, e.y, a, d) >= d - 6,
      pref = (e.el && ELITE[e.t].pref) || PREF[e.t] || 210,
      m = !los ? 1 : d < pref - 40 ? -1 : d > pref + 40 ? 1 : 0,
      na = m > 0 ? nav(e, a, d) : a,
      k = los ? 1 : 0;
    let vx = Math.cos(na) * m * e.sp - (dy / d) * e.st * e.sp * 0.5 * k,
      vy = Math.sin(na) * m * e.sp + (dx / d) * e.st * e.sp * 0.5 * k;
    if (mv(e, vx * dt, vy * dt) && Math.random() < 0.02) e.st *= -1;
    e.cd -= dt;
    if (e.cd <= 0 && d < 560 && los) {
      e.tele = (e.el && ELITE[e.t].tl) || TL[e.t] || 0.45;
      let tx = pl.x,
        ty = pl.y;
      {
        const ld = (e.el && ELITE[e.t].lead) || LEAD[e.t];
        if (ld) {
          const P = leadAt(
            e,
            ld[0] < 1e4 ? ld[0] * BS : ld[0],
            ld[1] === null ? e.tele : ld[1],
            Math.min(e.el ? 0.97 : 0.9, 0.4 + wave * 0.035 + (e.el ? 0.2 : 0)) *
              ld[2],
          );
          tx = P[0];
          ty = P[1];
        }
      }
      e.tx = tx;
      e.ty = ty;
      e.aim = Math.atan2(ty - e.y, tx - e.x);
      if (e.t === 6 || e.t === 10 || e.t === 27 || e.t === 28) {
        e.tx = e.x;
        e.ty = e.y;
      }
      if (e.t === 11) {
        e.tx = e.x;
        e.ty = e.y;
        for (let q = 0; q < (e.el ? 15 : 12); q++) {
          const aa = Math.random() * TAU,
            RR = e.el ? 200 : 220,
            x = pl.x + Math.cos(aa) * RR,
            y = pl.y + Math.sin(aa) * RR;
          if (!blocked(x, y, 14)) {
            e.tx = x;
            e.ty = y;
            break;
          }
        }
      }
    }
  }
}
let AA = 1,
  tgLast = null,
  coins = 0,
  RUN = { dmg: 0 };
const SV = {
  coins: 0,
  up: {},
  own: [0, 1, 3],
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
};
try {
  Object.assign(SV, JSON.parse(localStorage.getItem("neonShardSave")) || {});
} catch (e) {}
// 功能：保存或讀取「save」相關資料。
const save = () => {
    try {
      localStorage.setItem("neonShardSave", JSON.stringify(SV));
    } catch (e) {}
  },
  UL = (k) => (SV.up[k] || 0) + ((CHR && CHR["L" + k]) || 0),
  WPR = [
    0, 0, 300, 0, 250, 600, 200, 450, 500, 250, 700, 550, 350, 650, 500, 400,
    450, 500, 550, 450, 1200, 1000, 800, 1100,
  ],
  WPC = Array(24).fill("coins"),
  UC = {
    hp: "sh",
    spd: "sh",
    dsh: "sh",
    mag: "sh",
    reg: "sh",
    dmg: "co",
    gold: "co",
  },
  UB = { hp: 40, spd: 50, dsh: 50, mag: 60, reg: 60, dmg: 8, gold: 8 },
  CC = { coins: "#ffd23a", sh: "#4de1ff", co: "#ff4dff" },
  CN = { coins: "金幣", sh: "碎片", co: "晶核" },
  UPD = [
    { k: "hp", n: "最大血量", d: "+10", b: 60, m: 10 },
    { k: "spd", n: "移動速度", d: "+4%", b: 80, m: 8 },
    { k: "mag", n: "彈匣容量", d: "+10%", b: 90, m: 8 },
    { k: "reg", n: "彈藥回復", d: "+8%", b: 90, m: 8 },
    { k: "dmg", n: "傷害", d: "+6%", b: 120, m: 10 },
    { k: "dsh", n: "衝刺冷卻", d: "-6%", b: 80, m: 6 },
    { k: "gold", n: "金幣加成", d: "+10%", b: 100, m: 8 },
  ];
let won = 0,
  shd = 0,
  cor = 0,
  pts = 0,
  train = false,
  god = true,
  fz = false,
  inf = true;
const STG = [
    { n: "訓練場", g: 5, hm: 0.8, cm: 1, dn: 0.16, c: "#3dff8f" },
    { n: "霓虹街區", g: 8, hm: 1, cm: 1.2, dn: 0.235, c: "#22e6ff" },
    { n: "數據峽谷", g: 10, hm: 1.3, cm: 1.5, dn: 0.3, c: "#b45cff" },
    { n: "虛空核心", g: 12, hm: 1.7, cm: 2, dn: 0.2, c: "#ff3d9a" },
    { n: "冰封港灣", g: 14, hm: 1.6, cm: 2.4, dn: 0.22, c: "#9ae6ff" },
    { n: "毒蜂巢穴", g: 15, hm: 1.7, cm: 2.8, dn: 0.28, c: "#9dff3d" },
    { n: "虛空裂隙", g: 16, hm: 1.8, cm: 3.2, dn: 0.2, c: "#7a7aff" },
    { n: "終焉之塔", g: 18, hm: 2, cm: 4, dn: 0.24, c: "#ff2a8a" },
    { n: "無盡深淵", g: 0, hm: 2.2, cm: 3, dn: 0.235, c: "#ffd23a" },
  ],
  ST = () => STG[SV.sel] || STG[0];
// 通關結算
function win() {
  cor += Math.ceil(ST().g / 3);
  coins += Math.round(ST().g * 20 * ST().cm);
  setState("over");
  won = 1;
  SV.coins += coins;
  SV.sh += shd;
  SV.co += cor;
  bankChips();
  SV.clr[SV.sel] = 1;
  SV.sb[SV.sel] = Math.max(SV.sb[SV.sel] || 0, wave);
  save();
  overT = 0.6;
  shown = 0;
}
// 放棄本局並結算
function quit() {
  if (state !== "play" && state !== "shop") return;
  if (!train) {
    bankChips();
    SV.coins += coins;
    SV.sh += shd;
    SV.co += cor;
    SV.sb[SV.sel] = Math.max(SV.sb[SV.sel] || 0, wave);
    save();
  }
  state = "over";
  shown = 1;
  $("sh").classList.add("h");
  showOv(train ? 0 : 1);
  endTrain();
}
// 暫停：清除輸入並顯示暫停選單
function pause() {
  if (state !== "play") return;
  setState("pause");
  xPause();
  for (const k in keys) keys[k] = false;
  mouse.down = false;
  tm.id = null;
  ta.id = null;
  ta.act = false;
  drag = null;
  $("ps").classList.remove("h");
}
// 從暫停回到戰鬥
function resume() {
  if (state !== "pause") return;
  setState("play");
  $("ps").classList.add("h");
}
// 切換暫停
function togglePause() {
  if (state === "play") pause();
  else if (state === "pause") resume();
}
$("qt").onclick = pause;
$("rs").onclick = resume;
$("qb").onclick = () => {
  $("ps").classList.add("h");
  setState("play");
  quit();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
const CH = [
  {
    n: "增傷",
    c: "#ff5a5a",
    d: "傷害 +20%",
    w: 3,
    fn: (o) => {
      o.dmg *= 1.2;
    },
  },
  {
    n: "速射",
    c: "#ffd23a",
    d: "射擊間隔 -25%、回彈 -8%",
    w: 3,
    fn: (o) => {
      o.cd *= 0.75;
      o.rs *= 0.92;
    },
  },
  {
    n: "擴容",
    c: "#4dffd8",
    d: "彈匣 +50%",
    w: 3,
    fn: (o) => {
      o.ms0 = Math.round(o.ms0 * 1.5);
    },
  },
  {
    n: "精準",
    c: "#7ab8ff",
    d: "散射 -60%",
    w: 3,
    fn: (o) => {
      o.acc *= 0.4;
      o.mp *= 0.4;
      o.sp *= 0.5;
      o.rcg = (o.rcg || 0) * 0.4;
    },
  },
  {
    n: "重擊",
    c: "#ffb040",
    d: "擊退 x2.2",
    w: 3,
    fn: (o) => {
      o.kb *= 2.2;
    },
  },
  {
    n: "破牆",
    c: "#c9a0ff",
    d: "破牆 +1",
    w: 3,
    fn: (o) => {
      o.wd = (o.wd || 0) + 1;
    },
  },
  {
    n: "穿透",
    c: "#e0e0ff",
    d: "子彈穿透敵人",
    w: 2,
    fn: (o) => {
      o.pierce = 1;
    },
  },
  {
    n: "爆裂",
    c: "#ff7a3d",
    d: "命中小範圍爆炸（35% 傷害）",
    w: 2,
    fn: (o) => {
      o.xb = 1;
    },
  },
  {
    n: "連鎖",
    c: "#6aa8ff",
    d: "命中連鎖電擊",
    w: 2,
    fn: (o) => {
      o.ch = 1;
    },
  },
  {
    n: "追蹤",
    c: "#8dff7a",
    d: "子彈微幅偏向飛行路徑旁最近的敵人",
    w: 2,
    fn: (o) => {
      o.hm = 1;
    },
  },
  {
    n: "反彈",
    c: "#a0ffa0",
    d: "撞牆反彈 +2 次",
    w: 2,
    fn: (o) => {
      o.bn = (o.bn || 0) + 2;
    },
  },
  {
    n: "燃燒",
    c: "#ff5a2a",
    d: "命中後持續燃燒",
    w: 1,
    fn: (o) => {
      o.bu = 1;
    },
  },
  {
    n: "冰霜",
    c: "#7af0ff",
    d: "命中減速敵人",
    w: 1,
    fn: (o) => {
      o.fr = 1;
    },
  },
  {
    n: "吸血",
    c: "#ff4d9a",
    d: "命中回血（傷害 2.5%，每發最多 2）",
    w: 1,
    fn: (o) => {
      o.lk = 1;
    },
  },
];

const RC = ["#b8c4d0", "#4dff88", "#4d9bff", "#c060ff", "#ffb020"],
  RN = ["普通", "優良", "稀有", "史詩", "傳說"];
[0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2].forEach((r, i) => {
  CH[i].r = r;
});
// 功能：處理「spl」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const spl = (o, k, f) => {
  if (o.mine || o.web || o.gren || o.tox) {
    o.r *= 1 + 0.12 * k;
    return;
  }
  if (o.slash) {
    o.rg *= 1 + 0.08 * k;
    return;
  }
  const n = o.n1;
  o.n1 = n + k;
  o.dmg *= (n / (n + k)) * f;
  if (o.n1 > 1 && o.sp < 0.1 + 0.03 * k) o.sp = 0.1 + 0.03 * k;
};
CH.push(
  {
    n: "迅彈",
    c: "#9fe8ff",
    r: 0,
    d: "子彈速度 +25%",
    fn: (o) => {
      o.v *= 1.25;
    },
  },
  {
    n: "長程",
    c: "#9fffb0",
    r: 0,
    d: "射程 +35%",
    fn: (o) => {
      o.life *= 1.35;
    },
  },
  {
    n: "補給",
    c: "#ffe9a0",
    r: 0,
    d: "彈藥回復 +18%",
    fn: (o) => {
      o.rs *= 0.85;
    },
  },
  {
    n: "分裂",
    c: "#8ff0ff",
    r: 1,
    d: "多 1 發子彈，總傷害 -15%（無彈體武器改為範圍 +12%）",
    fn: (o) => spl(o, 1, 0.85),
  },
  {
    n: "巨彈",
    c: "#ffb27a",
    r: 1,
    d: "子彈變大 50%、傷害 +15%、擊退 +20%",
    fn: (o) => {
      o.r *= 1.5;
      o.dmg *= 1.15;
      o.kb *= 1.2;
    },
  },
  {
    n: "暴擊",
    c: "#ff8a8a",
    r: 2,
    d: "30% 機率造成 2.5 倍傷害（白色子彈）",
    fn: (o) => {
      o.cr = (o.cr || 0) + 0.3;
      o.cm = Math.max(o.cm || 0, 2.5);
    },
  },
  {
    n: "重裝",
    c: "#ffb040",
    r: 2,
    d: "傷害 +45%、彈匣 -30%",
    fn: (o) => {
      o.dmg *= 1.45;
      o.ms0 = Math.max(1, Math.round(o.ms0 * 0.7));
    },
  },
  {
    n: "彈幕",
    c: "#7ab8ff",
    r: 2,
    d: "多 2 發子彈，總傷害 -25%（無彈體武器改為範圍 +24%）",
    fn: (o) => spl(o, 2, 0.75),
  },
  {
    n: "狂暴",
    c: "#ff4d4d",
    r: 3,
    d: "傷害 +55%、射擊間隔 -15%",
    fn: (o) => {
      o.dmg *= 1.55;
      o.cd *= 0.85;
    },
  },
  {
    n: "滿載",
    c: "#4dffd8",
    r: 3,
    d: "彈匣 x2、彈藥回復 +33%",
    fn: (o) => {
      o.ms0 = Math.round(o.ms0 * 2);
      o.rs *= 0.75;
    },
  },
  {
    n: "雷霆",
    c: "#ffe14a",
    r: 3,
    d: "連鎖電擊 + 小範圍爆炸，傷害 +10%",
    fn: (o) => {
      o.ch = 1;
      o.xb = 1;
      o.dmg *= 1.1;
    },
  },
  {
    n: "烈焰風暴",
    c: "#ff6a2a",
    r: 3,
    d: "穿透敵人並點燃，傷害 +10%",
    fn: (o) => {
      o.pierce = 1;
      o.bu = 1;
      o.dmg *= 1.1;
    },
  },
  {
    n: "極寒領域",
    c: "#7af0ff",
    r: 3,
    d: "命中減速，連續 6 發凍結敵人，傷害 +10%",
    fn: (o) => {
      o.fr = 1;
      o.fz4 = 1;
      o.dmg *= 1.1;
    },
  },
  {
    n: "毀滅者",
    c: "#ff3d6a",
    r: 4,
    d: "傷害 +45%、穿透、爆炸、破牆 +1、擊退 +50%，彈匣 -20%",
    fn: (o) => {
      o.dmg *= 1.45;
      o.pierce = 1;
      o.xb = 1;
      o.wd = (o.wd || 0) + 1;
      o.kb *= 1.5;
      o.ms0 = Math.max(1, Math.round(o.ms0 * 0.8));
    },
  },
  {
    n: "永動",
    c: "#4dffa0",
    r: 4,
    d: "彈匣 x2、彈藥回復 +67%、射擊間隔 -15%",
    fn: (o) => {
      o.ms0 = Math.round(o.ms0 * 2);
      o.rs *= 0.6;
      o.cd *= 0.85;
    },
  },
  {
    n: "天罰",
    c: "#fff070",
    r: 4,
    d: "28% 暴擊，暴擊造成 3.5 倍傷害（白色子彈）",
    fn: (o) => {
      o.cr = (o.cr || 0) + 0.28;
      o.cm = Math.max(o.cm || 0, 3.5);
    },
  },
  {
    n: "混沌",
    c: "#d070ff",
    r: 4,
    d: "追蹤、穿透、撞牆反彈 +3 次，傷害 +30%",
    fn: (o) => {
      o.hm = 1;
      o.pierce = 1;
      o.bn = (o.bn || 0) + 3;
      o.dmg *= 1.3;
    },
  },
);
const TW = [
  [56, 28, 11, 4.2, 0.8],
  [24, 36, 26, 11, 3],
  [0, 30, 42, 22, 6],
];
// 功能：依機率與稀有度抽取芯片。
function rollChip(b, mt) {
  const w = (TW[+b || 0] || TW[0]).slice();
  for (let t = 0; t < (mt || 0); t++) w[t] = 0;
  let r = Math.random() * w.reduce((a, x) => a + x, 0),
    t = 0;
  for (; t < 4; t++) {
    r -= w[t];
    if (r <= 0) break;
  }
  const pool = [];
  CH.forEach((c, i) => {
    if (c.r === t) pool.push(i);
  });
  return pool[Math.floor(Math.random() * pool.length)];
}
let SLI = -1,
  wsNote = "",
  lastPk = null;
// 功能：處理「chipEl」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chipEl(i, o) {
  o = o || {};
  const c = CH[i],
    d = document.createElement("div");
  d.className = "chc r" + c.r + (o.on ? " on" : "") + (o.dim ? " dim" : "");
  d.style.setProperty("--rc", RC[c.r]);
  d.append(mkIcon("chip", c.c, 22));
  const t = document.createElement("div");
  t.className = "chb";
  t.innerHTML =
    `<b>${c.n}<span class="chr">${RN[c.r]}</span></b><small>${c.d}</small>` +
    (o.sub ? `<small class="chsub">${o.sub}</small>` : "");
  d.append(t);
  if (o.tag) {
    const e = document.createElement("em");
    e.textContent = o.tag;
    d.append(e);
  }
  return d;
}
// 功能：處理「chipToast」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chipToast(i) {
  const c = CH[i];
  let el = document.getElementById("cts");
  if (!el) {
    el = document.createElement("div");
    el.id = "cts";
    document.body.append(el);
  }
  const e = document.createElement("div");
  e.className = "chtoast";
  e.style.setProperty("--rc", RC[c.r]);
  e.textContent = "獲得 [" + RN[c.r] + "] " + c.n;
  el.append(e);
  setTimeout(() => e.remove(), 2700);
  while (el.children.length > 3) el.firstChild.remove();
  if (c.r >= 3)
    try {
      flash(RC[c.r], 0.22, 0.3);
    } catch (x) {}
}
// 功能：處理「chipSum」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chipSum() {
  if (!chp.length) return "";
  const n = [0, 0, 0, 0, 0];
  chp.forEach((i) => {
    n[CH[i].r]++;
  });
  return (
    "（" +
    n
      .map((v, t) => (v ? RN[t] + " " + v : ""))
      .filter(Boolean)
      .reverse()
      .join(" · ") +
    "）"
  );
}
// 功能：處理「chipWhere」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chipWhere(i) {
  return Object.keys(SV.mods)
    .filter((k) => (SV.mods[k] || []).includes(i))
    .map((k) => (ALLW[+k] ? ALLW[+k].n : ""))
    .filter(Boolean)
    .join("、");
}
// 功能：將芯片效果合併至武器數值。
function chipApply(w, list) {
  const o = normalizeWeaponProperties(Object.assign({}, w));
  for (const c of list) if (CH[c]) CH[c].fn(o);
  const e = (o.dmg * o.n1) / (w.dmg * w.n1 || 1);
  if (e > 2) o.dmg *= (2 + (e - 2) * 0.5) / e;
  if (o.cr > 0.6) o.cr = 0.6;
  return o;
}
// 功能：處理「modW」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function modW(w) {
  const o = chipApply(w, (train ? TM : SV.mods)[w.id] || []);
  if (o.bm) o.ms0 = 1;
  return o;
}

// 功能：處理「chipAvail」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chipAvail(i) {
  let u = 0;
  for (const k in SV.mods) for (const c of SV.mods[k]) if (c === i) u++;
  return (SV.chips[i] || 0) - u;
}
const CHS = [
  {
    n: "游擊者",
    c: "#22e6ff",
    hp: 0,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 0,
    d: "均衡型，沒有弱點",
  },
  {
    n: "重裝兵",
    c: "#ffb040",
    hp: 50,
    Lspd: -3.75,
    dr: 0.85,
    sc: 1,
    kh: 0,
    p: 900,
    d: "血量 +50、受到傷害 -15%，移動 -15%",
  },
  {
    n: "疾風",
    c: "#9dff3d",
    hp: -20,
    Lspd: 6.25,
    Ldsh: 5,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 900,
    d: "移動 +25%、衝刺冷卻 -30%，血量 -20",
  },
  {
    n: "工程師",
    c: "#7ab8ff",
    hp: 0,
    Lreg: 4,
    Lmag: 2.5,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 1100,
    d: "彈藥回復 +32%、彈匣 +25%",
  },
  {
    n: "刺客",
    c: "#ff5a5a",
    hp: -15,
    Lspd: 2,
    Ldsh: 1.7,
    Ldmg: 4.2,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 1300,
    d: "傷害 +25%、移動 +8%，血量 -15",
  },
  {
    n: "術士",
    c: "#d070ff",
    hp: 0,
    Ldmg: 1.3,
    dr: 1,
    sc: 1.6,
    kh: 3,
    p: 1600,
    d: "大招充能 +60%、擊殺回復 3 血量",
  },
];
let CHR = CHS[0];
// 功能：處理「chR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chR(el) {
  el.innerHTML = "";
  const h = document.createElement("div");
  h.className = "sec";
  h.textContent = "腳色";
  el.append(h);
  const g = document.createElement("div");
  g.className = "grid";
  CHS.forEach((c, i) => {
    const own = SV.chars.includes(i),
      b = document.createElement("div");
    b.className = "it wb" + (SV.char === i ? " s" : "");
    b.style.setProperty("--wc", c.c);
    b.style.opacity = own ? 1 : 0.6;
    b.innerHTML = `<span><b>${c.n}</b> <small>${c.d}</small></span><em style="color:${own ? c.c : CC.coins}">${SV.char === i ? "出戰中" : own ? "選擇" : c.p + " 金幣"}</em>`;
    b.onclick = () => {
      if (own) SV.char = i;
      else if (SV.coins >= c.p) {
        SV.coins -= c.p;
        SV.chars.push(i);
        SV.char = i;
      } else return;
      save();
      window.upd();
    };
    g.append(b);
  });
  el.append(g);
}
// 功能：處理「bankChips」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bankChips() {
  for (const c of chp) SV.chips[c] = (SV.chips[c] || 0) + 1;
}
let TM = {},
  trK = "",
  trHd = null;
// 功能：處理「trRebuild」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function trRebuild() {
  const id = WP[pl.w].id,
    m = modW(ALLW[id]);
  m.ms = Math.round(m.ms0 * (1 + 0.1 * UL("mag")));
  m.am = m.ms;
  WP[pl.w] = m;
}
// 功能：處理「trChip」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function trChip(i) {
  const id = WP[pl.w].id,
    a = (TM[id] || []).slice(),
    k = a.indexOf(i);
  if (k >= 0) a.splice(k, 1);
  else {
    a.push(i);
    if (a.length > 2) a.shift();
  }
  TM[id] = a;
  trRebuild();
}
// 功能：處理「trMark」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function trMark() {
  const id = WP[pl.w].id,
    k = id + ":" + (TM[id] || []).join(",");
  if (k === trK) return;
  trK = k;
  const on = TM[id] || [];
  document.querySelectorAll("#tr [data-chip]").forEach((b) => {
    const i = +b.dataset.chip;
    b.style.background = on.includes(i) ? RC[CH[i].r] + "55" : "#ffffff0d";
  });
}
let MWI = -1,
  lastPack = "";
// 功能：處理「wsR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function wsR(el) {
  el.innerHTML = "";
  const own = SV.own,
    dv = (c, h) => {
      const d = document.createElement("div");
      d.className = c;
      if (h !== undefined) d.innerHTML = h;
      return d;
    };
  if (MWI < 0 || !own.includes(MWI)) MWI = LO[0] !== undefined ? LO[0] : own[0];
  // 功能：取得指定武器的改裝資料。
  const gm = (i) => {
      const m = (SV.mods[i] || []).slice();
      while (m.length < 2) m.push(-1);
      return m;
    },
    has = (v) => CH[v] !== undefined && v >= 0,
    nextEmpty = (m) => (!has(m[0]) ? 0 : !has(m[1]) ? 1 : -1);
  const m = gm(MWI);
  if (SLI < 0 || SLI > 1) {
    const k = nextEmpty(m);
    SLI = k < 0 ? 0 : k;
  }
  el.append(dv("sec", "芯片改裝"));
  el.append(dv("hint", "① 選槍　② 選槽位　③ 點下方芯片安裝（顏色 = 稀有度）"));
  const wg = dv("chw");
  for (const i of own) {
    const mm = gm(i),
      b = dv("chp" + (i === MWI ? " on" : ""));
    b.style.setProperty("--wc", ALLW[i].c);
    b.append(mkIcon("ammo", ALLW[i].c, 16));
    const nm = document.createElement("span");
    nm.textContent = ALLW[i].n;
    b.append(nm);
    const pips = dv("pips");
    mm.forEach((ci) => {
      const p = document.createElement("i");
      if (has(ci)) {
        p.style.background = RC[CH[ci].r];
        p.style.borderColor = RC[CH[ci].r];
      }
      pips.append(p);
    });
    b.append(pips);
    if (LO.includes(i)) {
      const t = document.createElement("span");
      t.className = "ord";
      t.textContent = "出戰" + (LO.indexOf(i) + 1);
      b.append(t);
    }
    b.onclick = () => {
      MWI = i;
      SLI = -1;
      wsNote = "";
      window.upd();
    };
    wg.append(b);
  }
  el.append(wg);
  const sl = dv("chsl");
  for (let k = 0; k < 2; k++) {
    const ci = m[k],
      c = has(ci) ? CH[ci] : null,
      d = dv("chs" + (k === SLI ? " on" : "") + (c ? "" : " em"));
    d.style.setProperty("--rc", c ? RC[c.r] : "#6a7590");
    if (c) {
      d.append(dv("chn", k + 1));
      d.append(mkIcon("chip", c.c, 22));
      d.append(
        dv(
          "chb",
          `<b>${c.n}<span class="chr">${RN[c.r]}</span></b><small>${c.d}</small>`,
        ),
      );
      const x = document.createElement("button");
      x.className = "chx";
      x.textContent = "拆下";
      x.onclick = (ev) => {
        ev.stopPropagation();
        const q = gm(MWI);
        q[k] = -1;
        SV.mods[MWI] = q;
        SLI = k;
        wsNote = "";
        save();
        window.upd();
      };
      d.append(x);
    } else {
      d.append(dv("chn", k + 1));
      d.append(
        dv(
          "chb",
          `<b>槽位 ${k + 1}</b><small>${k === SLI ? "▶ 點下方芯片安裝到這裡" : "空槽 · 點此選取"}</small>`,
        ),
      );
    }
    d.onclick = () => {
      SLI = k;
      wsNote = "";
      window.upd();
    };
    sl.append(d);
  }
  el.append(sl);
  const base = ALLW[MWI],
    cur = chipApply(base, m.filter(has));
  // 功能：計算並顯示武器的屬性統計。
  const stat = (o) => {
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
  const sb = stat(base),
    sc = stat(cur),
    rows = [
      ["每次射擊傷害", "dmg", 1],
      ["射速（發/秒）", "rate", 1],
      ["彈匣", "ms", 0],
      ["整匣總傷害", "burst", 0],
      ["持續輸出（傷害/秒）", "dps", 1],
    ],
    st = dv("chst");
  for (const [nm, k, dp] of rows) {
    const a0 = sb[k],
      a1 = sc[k],
      pc = a0 > 0 ? (a1 / a0 - 1) * 100 : 0,
      f = (v) => (dp ? v.toFixed(v < 100 ? 1 : 0) : String(Math.round(v))),
      cl = Math.abs(pc) < 0.5 ? "" : pc > 0 ? " up" : " dn";
    st.append(
      dv("l", nm),
      dv("v", f(a0)),
      dv("v" + cl, (Math.abs(pc) < 0.5 ? "" : "→ ") + f(a1)),
      dv(
        "v" + cl,
        Math.abs(pc) < 0.5 ? "—" : (pc > 0 ? "+" : "") + Math.round(pc) + "%",
      ),
    );
  }
  el.append(st);
  if (wsNote) el.append(dv("hint warn", wsNote));
  const owned = CH.map((c, i) => i).filter((i) => SV.chips[i] > 0),
    total = Object.values(SV.chips).reduce((a, b) => a + b, 0);
  el.append(
    dv("sec", `芯片庫存 · ${total} 枚 · 圖鑑 ${owned.length}/${CH.length}`),
  );
  const lg = dv("chlg");
  RN.forEach((n, t) => {
    const sp = document.createElement("span");
    sp.style.color = RC[t];
    sp.textContent = "● " + n;
    lg.append(sp);
  });
  el.append(lg);
  if (!owned.length) {
    el.append(dv("hint", "還沒有芯片：打 Boss 或到商城買芯片包"));
    return;
  }
  for (let t = 4; t >= 0; t--) {
    const ids = owned.filter((i) => CH[i].r === t);
    if (!ids.length) continue;
    const hd = dv(
      "chg",
      `<b>${RN[t]}</b><small>${ids.length} / ${CH.filter((c) => c.r === t).length} 種</small>`,
    );
    hd.style.color = RC[t];
    el.append(hd);
    const g = dv("chgrid");
    ids.forEach((i) => {
      const av = chipAvail(i),
        tot = SV.chips[i],
        card = chipEl(i, {
          dim: av <= 0,
          on: m.includes(i),
          tag: "x" + av + (tot > av ? "/" + tot : ""),
          sub: av <= 0 ? "已裝備：" + chipWhere(i) : "",
        });
      card.onclick = () => {
        if (av <= 0) {
          wsNote =
            "「" +
            CH[i].n +
            "」已全部裝備中（" +
            chipWhere(i) +
            "），請先拆下。";
          window.upd();
          return;
        }
        const q = gm(MWI);
        q[SLI] = i;
        SV.mods[MWI] = q;
        const k = nextEmpty(q);
        if (k >= 0) SLI = k;
        wsNote = "";
        save();
        window.upd();
      };
      g.append(card);
    });
    el.append(g);
  }
}
// 功能：處理「csR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function csR(el) {
  el.innerHTML = "";
  // 功能：建立角色或裝備比較介面中的數值列。
  const dv = (c, h) => {
    const d = document.createElement("div");
    d.className = c;
    if (h !== undefined) d.innerHTML = h;
    return d;
  };
  el.append(
    dv(
      "sec",
      "芯片包（晶核）· 持有芯片 " +
        Object.values(SV.chips).reduce((a, b) => a + b, 0),
    ),
  );
  const PK = [
      { n: "普通芯片包", cost: 30, k: 1, b: 0, g: 0 },
      { n: "精選芯片包", cost: 80, k: 3, b: 1, g: 0 },
      { n: "頂級芯片包", cost: 200, k: 3, b: 2, g: 1 },
    ],
    g = dv("chpk");
  for (const p of PK) {
    const o = TW[p.b],
      sum = o.reduce((a, x) => a + x, 0),
      d = dv(
        "chpack" + (SV.co < p.cost ? " dim" : ""),
        `<div class="top"><b>${p.n}</b><small>${p.k} 枚${p.g ? " · 保底 1 枚史詩以上" : ""}</small><em style="color:${CC.co}">${p.cost} 晶核</em></div><div class="odds">${o.map((v, t) => (v ? `<span style="color:${RC[t]}">${RN[t]} ${+((v / sum) * 100).toFixed(1)}%</span>` : "")).join("")}</div>`,
      );
    d.style.setProperty("--wc", CC.co);
    d.onclick = () => {
      if (SV.co < p.cost) return;
      SV.co -= p.cost;
      const got = [];
      for (let q = 0; q < p.k; q++) got.push(rollChip(p.b));
      if (p.g && !got.some((i) => CH[i].r >= 3))
        got[got.length - 1] = rollChip(p.b, 3);
      lastPk = [];
      for (const i of got) {
        lastPk.push({ i, nw: !(SV.chips[i] > 0) });
        SV.chips[i] = (SV.chips[i] || 0) + 1;
      }
      save();
      window.upd();
    };
    g.append(d);
  }
  el.append(g);
  if (lastPk) {
    el.append(dv("sec", "本次獲得"));
    const gr = dv("chgrid");
    lastPk.forEach((x) => gr.append(chipEl(x.i, { tag: x.nw ? "NEW" : "" })));
    el.append(gr);
  }
}
// 功能：處理「jit」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function jit(x, y) {
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * TAU,
      r = 8 + Math.random() * 30,
      qx = x + Math.cos(a) * r,
      qy = y + Math.sin(a) * r;
    if (!blocked(qx, qy, 6)) return { x: qx, y: qy };
  }
  return { x, y };
}
let BK2 = 0;
// 功能：處理「cur」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function cur(t, x, y, v) {
  if (pk.length >= 80 && !BK2) return;
  const j = jit(x, y);
  pk.push({ x: j.x, y: j.y, t, v, life: 14 });
}
// 功能：處理「collectPk」相關操作與狀態更新。
function collectPk(q, n) {
  const p = pl;
  if (q.t === "coin") coins += q.v;
  else if (q.t === "shard") shd += q.v;
  else if (q.t === "core") cor += q.v;
  else if (q.t === "chip") (chp.push(q.v), chipToast(q.v));
  else if (q.t === "heal") p.hp = Math.min(p.mhp, p.hp + 30);
  else if (q.t === "ammo") {
    for (const w of WP) w.am = Math.min(w.ms, w.am + w.ms * 0.4);
    for (const w of WP) w.um = Math.min(100, (w.um || 0) + 25);
  } else if (q.t === "shield") p.sh = Math.min(60, p.sh + 30);
  else p.boost = Math.min(10, Math.max(0, p.boost) + 6);
  burst(q.x, q.y, PC[q.t], n || 14, 200, 2.5, 0.5);
}
// 功能：處理「vacAll」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function vacAll() {
  for (const q of pk) {
    q.vac = 1;
    q.vs = 60;
    q.dl = Math.random() * 0.45;
    q.life = 99;
  }
  fxs.push({
    k: "cring",
    x: pl.x,
    y: pl.y,
    r: 170,
    t: 0.7,
    max: 0.7,
    col: "#ffffff",
  });
}
// 功能：處理「ucost」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function ucost(u, lv) {
  return UC[u.k] === "sh"
    ? Math.round(UB[u.k] * (1 + lv))
    : Math.round(UB[u.k] * (1 + lv * 0.9));
}
// 購買武器
function buyW(i) {
  const K = WPC[i];
  if (SV[K] >= WPR[i]) {
    SV[K] -= WPR[i];
    SV.own.push(i);
    save();
    window.upd();
  }
}
// 功能：處理「coin」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function coin(x, y, v) {
  cur("coin", x, y, v);
}
const AIMR = 170,
  NEWT = () =>
    TH.map((v, i) => (v === wave ? i : -1))
      .filter((i) => i >= 0)
      .concat(NE.filter((x) => x[1] === wave).map((x) => x[0])),
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
EN[26] = "爆彈客";
EN[27] = "追蹤者";
EN[28] = "治療者";
EN[29] = "陷阱師";
// 功能：處理「cone」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function cone() {
  const w = WP[pl.w],
    mf = Math.min(1, Math.hypot(pl.vx, pl.vy) / (PSPD * 1.4));
  return w.acc + w.mp * mf + pl.rc + (w.n1 === 1 ? w.sp / 2 : 0);
}
let drag = null;
// 功能：處理「LAY」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function LAY() {
  const u = HU,
    n = WP.length,
    sz = 58 * u,
    g = 10 * u,
    bm = 22 * u,
    hw = n * sz + (n - 1) * g,
    x0 = W / 2 - hw / 2,
    sy = H - sz - bm,
    por = H > W * 1.05,
    isz = 46 * u,
    ig = 8 * u,
    ni = BAG().length;
  let ix, iy;
  if (por) {
    ix = W / 2 - (ni * isz + Math.max(0, ni - 1) * ig) / 2;
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
function slotR(i) {
  const L = LAY();
  return { x: L.x0 + i * (L.sz + L.g), y: L.sy, w: L.sz };
}

const ITM = {
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
  },
  ITK = Object.keys(ITM);
let itCd = 0;
// 功能：取得背包中有效且符合槽位上限的道具清單。
const BAG = () => (SV.bagSel || []).filter((k) => ITM[k]).slice(0, 3);
// 功能：使用指定背包道具並套用效果。
function useItem(k) {
  if (state !== "play" || !k || !ITM[k] || itCd > 0) return;
  if (!train && !(SV.items[k] > 0)) return;
  const p = pl;
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
    for (const e of en)
      if (e.hp > 0 && !isB(e) && Math.hypot(e.x - p.x, e.y - p.y) < 240)
        e.stn = Math.max(e.stn || 0, 1);
  } else p.boost = Math.min(10, Math.max(0, p.boost) + 10);
  if (!train) {
    SV.items[k]--;
    save();
  }
  itCd = 0.5;
  burst(p.x, p.y, ITM[k].c, 18, 220, 2.5, 0.5);
  fxs.push({
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
function itemR(i) {
  const L = LAY();
  return { x: L.ix + i * (L.isz + L.ig), y: L.iy, w: L.isz };
}
// 功能：判斷「itemAt」所需的條件或位置。
function itemAt(x, y) {
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
function drawItems() {
  if (state !== "play") return;
  const b = BAG(),
    u = HU;
  for (let i = 0; i < b.length; i++) {
    const k = b[i],
      t = ITM[k],
      r = itemR(i),
      n = train ? "∞" : SV.items[k] || 0,
      dim = !train && !n;
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
function slotAt(x, y) {
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
function slotDown(x, y, id) {
  const ii = itemAt(x, y);
  if (ii >= 0) {
    useItem(BAG()[ii]);
    return true;
  }
  const i = slotAt(x, y);
  if (i < 0) return false;
  drag = { from: i, x, y, id };
  return true;
}
// 功能：處理「slotUp」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function slotUp(x, y) {
  if (!drag) return;
  const d = drag,
    to = slotAt(x, y);
  drag = null;
  if (to < 0) return;
  if (to === d.from) pl.w = to;
  else {
    [WP[d.from], WP[to]] = [WP[to], WP[d.from]];
    if (!train) [LO[d.from], LO[to]] = [LO[to], LO[d.from]];
    if (pl.w === d.from) pl.w = to;
    else if (pl.w === to) pl.w = d.from;
    try {
      localStorage.setItem("neonShardLO", JSON.stringify(LO));
    } catch (e) {}
  }
}
/* ===== NEON SHARD · 新版選單（資料與工具） ===== */
const XCAT = [
  ["精準", [0, 2, 8, 11]],
  ["速射", [3, 9, 12, 13]],
  ["近距", [1, 4, 22]],
  ["爆破", [5, 7, 10, 23]],
  ["控場", [16, 17, 18, 19]],
  ["特殊", [6, 14, 15, 20, 21]],
];
// 功能：取得指定武器的分類名稱與武器索引。
const wCat = (i) => {
  for (const c of XCAT) if (c[1].includes(i)) return c[0];
  return "其他";
};
// 功能：取得武器描述中的模式欄位。
const wMode = (i) => (WD[i] || "").split("·")[0];
// 功能：取得武器描述中的補充說明。
const wNote = (i) => (WD[i] || "").split("·").slice(1).join("·");
const XS = {
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
const CI = { coins: "coin", sh: "shard", co: "core" };
// 功能：建立介面標題或區塊標籤。
const xh = (c, t, tag) => {
  const d = document.createElement(tag || "div");
  if (c) d.className = c;
  if (t !== undefined) d.innerHTML = t;
  return d;
};
// 功能：建立帶有文字與點擊回呼的介面按鈕。
const xbt = (c, t, f, dis) => {
  const b = xh(c, t, "button");
  b.type = "button";
  if (f) b.onclick = f;
  if (dis) b.disabled = true;
  return b;
};
// 功能：建立指定類型的介面圖示。
const xic = (t, c, s) => {
  const w = xh("x-ic");
  w.append(mkIcon(t, c, s || 24));
  return w;
};
// 功能：保存目前選定的武器配置。
const xSaveLO = () => {
  try {
    localStorage.setItem("neonShardLO", JSON.stringify(LO));
  } catch (e) {}
};
// 功能：切換至指定介面分頁或遊戲狀態。
const xGo = (t) => {
  if (t !== XS.t) {
    XS.t = t;
    XS.fresh = 1;
  }
  window.upd();
};
// 功能：更新指定介面欄位的內容。
const xSub = (k, v) => {
  XS[k] = v;
  XS.fresh = 1;
  window.upd();
};
// 功能：依目前篩選條件整理清單並建立篩選介面。
const xFlt = (list, cur, fn) => {
  const f = xh("x-flt");
  for (const n of list)
    f.append(xbt("x-f" + (cur === n ? " on" : ""), n, () => fn(n)));
  return f;
};
// 功能：計算武器的傷害、射速、彈速與每秒傷害等數值。
const wStat = (o) => {
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
let XM = null;
// 功能：本行宣告多個相關輔助函式；「xmax」及同列工具供後續邏輯共用。
const xmax = () =>
  XM ||
  (XM = (() => {
    const a = ALLW.map((w) => wStat(w)),
      mx = (k) => Math.max(...a.map((s) => s[k])) || 1;
    return {
      dmg: mx("dmg"),
      rate: mx("rate"),
      ms: mx("ms"),
      dps: mx("dps"),
    };
  })());
// 功能：依顯示需求格式化數值與小數位數。
const xfmt = (v, dp) =>
  dp ? v.toFixed(v < 100 ? 1 : 0) : String(Math.round(v));
// 功能：處理介面系統「xEquip」相關的資料、互動或顯示。
function xEquip(i, sl) {
  const a = LO.slice(),
    o = a.indexOf(i);
  if (o >= 0) {
    if (sl >= a.length) {
      a.splice(o, 1);
      a.push(i);
    } else [a[o], a[sl]] = [a[sl], a[o]];
  } else {
    if (sl >= a.length) a.push(i);
    else a[sl] = i;
  }
  LO = a;
  xSaveLO();
  window.upd();
}
// 功能：處理介面系統「xUnequip」相關的資料、互動或顯示。
function xUnequip(i) {
  if (LO.length < 2) return;
  LO = LO.filter((x) => x !== i);
  if (XS.sl >= LO.length) XS.sl = LO.length - 1;
  xSaveLO();
  window.upd();
}
// 功能：建立介面側欄內容或操作項目。
const xSide = (c, f) => {
  const s = xh("x-side"),
    i = xh("x-sc");
  i.dataset.sc = "r";
  i.append(...c);
  s.append(i);
  if (f) s.append(f);
  return s;
};
// 功能：加總目前已裝備或持有的芯片數量。
const xChipTotal = () => Object.values(SV.chips).reduce((a, b) => a + b, 0);

// 功能：處理介面系統「xEmb」相關的資料、互動或顯示。
function xEmb() {
  // 功能：繪製指定邊數與半徑的多邊形。
  const poly = (x, y, n, r, off) => {
    const o = [];
    for (let k = 0; k < n; k++) {
      const a = ((off + (360 / n) * k) * Math.PI) / 180;
      o.push(
        (x + r * Math.cos(a)).toFixed(1) +
          "," +
          (y + r * Math.sin(a)).toFixed(1),
      );
    }
    return o.join(" ");
  };
  const L = [
    ["p", 12, 22, 6, 80, -90, "#ff3d9a", 1.8, 90, 1],
    ["p", 182, 52, 4, 48, -45, "#ffd23a", 1.8, 70, -1],
    ["p", 178, 186, 3, 66, -90, "#9dff3d", 1.8, 80, 1],
    ["c", 22, 178, 42, "#22e6ff", 1.6, "3 7", 100, -1],
    ["p", 96, 190, 4, 12, -90, "#ff9a3d", 1.8, 20, -1],
  ];
  let g = "";
  for (const l of L) {
    const st = `transform-origin:${l[1]}px ${l[2]}px;`;
    if (l[0] === "c")
      g += `<g class="xg" style="${st}--d:${l[7]}s;--r:${l[8] > 0 ? "normal" : "reverse"}"><circle cx="${l[1]}" cy="${l[2]}" r="${l[3]}" fill="none" stroke="${l[4]}" stroke-width="${l[5]}" stroke-dasharray="${l[6]}" stroke-linecap="round"/></g>`;
    else
      g += `<g class="xg" style="${st}--d:${l[8]}s;--r:${l[9] > 0 ? "normal" : "reverse"}"><polygon points="${poly(l[1], l[2], l[3], l[4], l[5])}" fill="none" stroke="${l[6]}" stroke-width="${l[7]}" stroke-linejoin="round"/></g>`;
  }
  return `<svg class="x-emb" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${g}</svg>`;
}
/* ---------- 大廳 ---------- */
function xLobby(v) {
  const st = ST(),
    ch = CHS[SV.char] || CHS[0],
    cl = SV.clr.filter(Boolean).length;
  const cols = [0, 1, 2].map((k) =>
    LO[k] !== undefined ? ALLW[LO[k]].c : "#3a4573",
  );
  const pt = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return [
      (100 + 88 * Math.cos(a)).toFixed(1),
      (100 + 88 * Math.sin(a)).toFixed(1),
    ];
  });
  let fc = "";
  for (let k = 0; k < 6; k++) {
    const p = pt[k],
      q = pt[(k + 1) % 6],
      c = cols[k % 3];
    fc += `<polygon points="100,100 ${p.join(",")} ${q.join(",")}" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/>`;
  }
  const hero = xh(
    "x-pn x-hero",
    `${xEmb()}<div class="x-wm">NEON SHARD</div><div class="x-tag">霓虹幾何，瞄準與閃避</div><div class="x-hs"><span><b>${best}</b>最高分</span><span><b>${cl}/8</b>關卡通關</span><span><b>${SV.own.length}/${ALLW.length}</b>槍械解鎖</span></div>`,
  );
  const lst = xh("x-pair");
  const r1 = xbt(
    "x-cd",
    `<span class="x-tx"><small>關卡</small><b>${st.n}</b><small style="color:${st.c}">${st.g ? "目標 " + st.g + " 波" : "無盡模式"}</small></span>`,
    () => xGo("k"),
  );
  r1.style.setProperty("--a", st.c);
  const r2 = xbt(
    "x-cd",
    `<span class="x-tx"><small>角色</small><b>${ch.n}</b><small>${ch.d}</small></span>`,
    () => xGo("b"),
  );
  r2.style.setProperty("--a", ch.c);
  lst.append(r1, r2);
  const sl = xh("x-slots");
  for (let k = 0; k < 3; k++) {
    const i = LO[k],
      w = i !== undefined ? ALLW[i] : null,
      d = xbt("x-sl" + (w ? "" : " em"), "", () => {
        XS.sl = k;
        if (w) XS.ws = i;
        xGo("b");
      });
    d.style.setProperty("--a", w ? w.c : "#4a5688");
    d.append(xh("n", String(k + 1)));
    if (w) {
      d.append(xic("ammo", w.c, 26), xh("", "<b>" + w.n + "</b>"));
    } else d.append(xh("", "<small>空槽</small>"));
    sl.append(d);
  }
  const go = xbt(
    "x-btn pri blk x-big",
    XS.over ? "再次出戰" : "開始戰鬥",
    start,
  );
  const two = xh("x-two");
  two.style.marginTop = "0";
  two.style.gridTemplateColumns = "1fr 1fr 1fr";
  two.append(
    xbt("x-btn", "教學模式", startTutorial),
    xbt("x-btn", "訓練場", startTrain),
    xbt("x-btn", "兌換碼", rdOpen),
  );
  const foot = xh("x-foot");
  foot.append(go, two);
  const side = xSide(
    [
      xh("x-h", "本次出戰"),
      lst,
      xh("x-h", "出戰槍械<small>點選前往備戰調整</small>"),
      sl,
    ],
    foot,
  );
  const w = xh("x-split");
  w.append(hero, side);
  v.append(w);
}

/* ---------- 備戰 ---------- */
function xLoad(v) {
  const own = SV.own;
  if (!ALLW[XS.ws]) XS.ws = LO[0] || 0;
  if (XS.sl > 2 || XS.sl < 0) XS.sl = 0;
  const L = xh("x-sc");
  L.dataset.sc = "l";
  L.append(xh("x-h", "角色"));
  const cg = xh("x-chr");
  CHS.forEach((c, i) => {
    const ow = SV.chars.includes(i),
      on = SV.char === i;
    const d = xbt(
      "x-cd" + (on ? " on" : "") + (ow ? "" : " lk"),
      `<b>${c.n}</b><small>${c.d}</small><span class="rt">${on ? "出戰中" : ow ? "選擇" : "未解鎖"}</span>`,
      () => {
        if (ow) {
          SV.char = i;
          save();
          window.upd();
        } else {
          XS.sh = "ch";
          xGo("m");
        }
      },
    );
    d.style.setProperty("--a", c.c);
    cg.append(d);
  });
  L.append(
    cg,
    xh("x-h", "出戰槍械<small>先選槍位，再從槍械庫選槍裝入</small>"),
  );
  const sl = xh("x-slots");
  for (let k = 0; k < 3; k++) {
    const i = LO[k],
      w = i !== undefined ? ALLW[i] : null,
      d = xbt(
        "x-sl" + (w ? "" : " em") + (k === XS.sl ? " on" : ""),
        "",
        () => {
          XS.sl = k;
          if (w) XS.ws = i;
          window.upd();
        },
      );
    d.style.setProperty("--a", w ? w.c : "#4a5688");
    d.append(xh("n", String(k + 1)));
    if (w) d.append(xic("ammo", w.c, 26), xh("", "<b>" + w.n + "</b>"));
    else d.append(xh("", "<small>空槽</small>"));
    sl.append(d);
  }
  L.append(
    sl,
    xh("x-h", `槍械庫<small>${own.length} / ${ALLW.length} 已解鎖</small>`),
  );
  L.append(
    xFlt(["全部", "已擁有", "未解鎖", ...XCAT.map((c) => c[0])], XS.lc, (n) =>
      xSub("lc", n),
    ),
  );
  const wg = xh("x-grid"),
    isCat = XCAT.some((c) => c[0] === XS.lc);
  ALLW.forEach((w, i) => {
    const ow = own.includes(i),
      k = LO.indexOf(i);
    if (XS.lc === "已擁有" && !ow) return;
    if (XS.lc === "未解鎖" && ow) return;
    if (isCat && wCat(i) !== XS.lc) return;
    const d = xbt(
      "x-cd" + (XS.ws === i ? " on" : "") + (ow ? "" : " lk"),
      "",
      () => {
        XS.ws = i;
        window.upd();
      },
    );
    d.style.setProperty("--a", w.c);
    d.append(
      xic("ammo", w.c, 26),
      xh("x-tx", `<b>${w.n}</b><small>${wCat(i)} · ${wMode(i)}</small>`),
      xh(
        "rt",
        k >= 0
          ? `<span style="color:var(--c)">出戰 ${k + 1}</span>`
          : ow
            ? ""
            : `<span style="color:${CC[WPC[i]]}">${WPR[i]} 金幣</span>`,
      ),
    );
    wg.append(d);
  });
  if (!wg.children.length) wg.append(xh("x-empty", "沒有符合條件的槍械"));
  L.append(wg);
  const i = XS.ws,
    w = ALLW[i],
    ow = own.includes(i),
    k = LO.indexOf(i),
    s = wStat(modW(w)),
    M = xmax();
  const dt = xh("x-pn x-dt");
  dt.style.setProperty("--a", w.c);
  const hd = xh("x-dh");
  hd.append(
    xic("ammo", w.c, 40),
    xh(
      "x-tx",
      `<span class="big">${w.n}</span><small>${wCat(i)} · ${wMode(i)}${k >= 0 ? " · 出戰 " + (k + 1) + " 號位" : ""}</small>`,
    ),
  );
  dt.append(hd, xh("x-ds", wNote(i) || WD[i] || ""));
  const sb = xh("x-sb");
  for (const [n, key, dp] of [
    ["單發傷害", "dmg", 1],
    ["射速", "rate", 1],
    ["彈匣", "ms", 0],
    ["持續輸出", "dps", 1],
  ])
    sb.append(
      xh("l", n),
      xh(
        "x-bar",
        `<i style="width:${Math.max(3, Math.min(100, (s[key] / M[key]) * 100))}%"></i>`,
      ),
      xh("v", xfmt(s[key], dp)),
    );
  dt.append(sb);
  const m = (SV.mods[i] || []).filter((c) => CH[c] !== undefined && c >= 0);
  dt.append(xh("x-h", "已裝芯片"));
  dt.append(
    xh(
      "x-ds",
      m.length
        ? m
            .map((c) => `<span style="color:${RC[CH[c].r]}">${CH[c].n}</span>`)
            .join("、")
        : "尚未安裝芯片",
    ),
  );
  const ac = xh("x-foot");
  if (!ow) {
    const can = SV[WPC[i]] >= WPR[i];
    ac.append(
      xbt("x-btn gld blk", `解鎖 · ${WPR[i]} 金幣`, () => buyW(i), !can),
    );
    if (!can) ac.append(xh("x-hint", `還差 ${WPR[i] - SV[WPC[i]]} 金幣`));
  } else {
    if (k < 0)
      ac.append(
        xbt("x-btn pri blk", `裝入 ${XS.sl + 1} 號位`, () => xEquip(i, XS.sl)),
      );
    else {
      if (k !== XS.sl)
        ac.append(
          xbt("x-btn pri blk", `移到 ${XS.sl + 1} 號位`, () =>
            xEquip(i, XS.sl),
          ),
        );
      ac.append(xbt("x-btn blk", "移出出戰", () => xUnequip(i), LO.length < 2));
    }
    ac.append(
      xbt("x-btn blk", "前往改裝芯片", () => {
        MWI = i;
        SLI = -1;
        wsNote = "";
        xGo("i");
      }),
    );
  }
  const R = xSide([dt], ac);
  const wr = xh("x-split sd");
  wr.append(L, R);
  v.append(wr);
}

/* ---------- 背包（芯片改裝與庫存） ---------- */
function xBag(v) {
  const own = SV.own,
    has = (c) => c !== undefined && c >= 0 && CH[c] !== undefined,
    gm = (i) => {
      const m = (SV.mods[i] || []).slice();
      while (m.length < 2) m.push(-1);
      return m;
    },
    ne = (m) => (!has(m[0]) ? 0 : !has(m[1]) ? 1 : -1);
  if (MWI < 0 || !own.includes(MWI)) MWI = LO[0] !== undefined ? LO[0] : own[0];
  const m = gm(MWI);
  if (SLI < 0 || SLI > 1) {
    const k = ne(m);
    SLI = k < 0 ? 0 : k;
  }
  const L = xh("x-sc");
  L.dataset.sc = "l";
  L.append(xh("x-h", "改裝台<small>選槍，選槽位，再點右側芯片</small>"));
  const wl = xh("x-wrap");
  for (const i of own) {
    const mm = gm(i),
      b = xbt("x-wb" + (i === MWI ? " on" : ""), "", () => {
        MWI = i;
        SLI = -1;
        wsNote = "";
        window.upd();
      });
    b.style.setProperty("--a", ALLW[i].c);
    b.append(mkIcon("ammo", i === MWI ? "#06101a" : ALLW[i].c, 16));
    b.insertAdjacentHTML(
      "beforeend",
      `<span>${ALLW[i].n}</span><span class="x-pp">${mm.map((c) => `<i class="${has(c) ? "f" : ""}" style="${has(c) ? "--p:" + RC[CH[c].r] : ""}"></i>`).join("")}</span>${LO.includes(i) ? `<em>${LO.indexOf(i) + 1}</em>` : ""}`,
    );
    wl.append(b);
  }
  L.append(wl, xh("x-h", `槽位<small>${ALLW[MWI].n}</small>`));
  const sg = xh("x-lst");
  for (let k = 0; k < 2; k++) {
    const ci = m[k],
      c = has(ci) ? CH[ci] : null,
      d = xh("x-cd" + (k === SLI ? " on" : ""));
    d.tabIndex = 0;
    d.setAttribute("role", "button");
    d.style.setProperty("--a", c ? RC[c.r] : "#4a5688");
    d.append(xh("x-no", String(k + 1)));
    if (c) {
      d.append(
        xic("chip", c.c, 24),
        xh(
          "x-tx",
          `<b>${c.n}<span class="x-tg">${RN[c.r]}</span></b><small>${c.d}</small>`,
        ),
        xbt("x-btn sm", "拆下", (ev) => {
          ev.stopPropagation();
          const q = gm(MWI);
          q[k] = -1;
          SV.mods[MWI] = q;
          SLI = k;
          wsNote = "";
          save();
          window.upd();
        }),
      );
    } else
      d.append(
        xh(
          "x-tx",
          `<b>槽位 ${k + 1}</b><small>${k === SLI ? "請點右側芯片安裝到這裡" : "空槽，點此選取"}</small>`,
        ),
      );
    d.onclick = () => {
      SLI = k;
      wsNote = "";
      window.upd();
    };
    sg.append(d);
  }
  const base = ALLW[MWI],
    cur = chipApply(base, m.filter(has)),
    sb = wStat(base),
    sc = wStat(cur),
    st = xh("x-cmp");
  for (const [nm, k, dp] of [
    ["單發傷害", "dmg", 1],
    ["射速（發／秒）", "rate", 1],
    ["彈匣", "ms", 0],
    ["整匣總傷害", "burst", 0],
    ["持續輸出（傷害／秒）", "dps", 1],
  ]) {
    const a0 = sb[k],
      a1 = sc[k],
      pc = a0 > 0 ? (a1 / a0 - 1) * 100 : 0,
      cl = Math.abs(pc) < 0.5 ? "" : pc > 0 ? " up" : " dn";
    st.append(
      xh("l", nm),
      xh("v", xfmt(a0, dp)),
      xh("v" + cl, (cl ? "→ " : "") + xfmt(a1, dp)),
      xh("v" + cl, cl ? (pc > 0 ? "+" : "") + Math.round(pc) + "%" : "—"),
    );
  }
  L.append(sg, xh("x-h", "效果對比<small>改裝前 → 改裝後</small>"), st);
  if (wsNote) L.append(xh("x-note", wsNote));
  const R = xh("x-sc");
  R.dataset.sc = "r";
  R.append(
    xh("x-h", "消耗品<small>最多帶 3 種 · 局內按 4／5／6 或點道具欄</small>"),
  );
  {
    const l = xh("x-lst");
    for (const k of ITK) {
      const t = ITM[k],
        n = SV.items[k] || 0,
        on = (SV.bagSel || []).includes(k),
        d = xh("x-cd" + (on ? " on" : ""));
      d.style.setProperty("--a", t.c);
      d.append(
        xic(t.ic, t.c, 24),
        xh("x-tx", `<b>${t.n}</b><small>${t.d}</small>`),
        xh("rt", "×" + n),
        xbt("x-btn sm" + (on ? " pri" : ""), on ? "已攜帶" : "攜帶", () => {
          let a = (SV.bagSel || []).filter((x) => ITM[x]);
          if (a.includes(k)) a = a.filter((x) => x !== k);
          else {
            if (a.length >= 3) a.shift();
            a.push(k);
          }
          SV.bagSel = a;
          save();
          window.upd();
        }),
      );
      l.append(d);
    }
    R.append(l);
  }
  const owned = CH.map((c, i) => i).filter((i) => SV.chips[i] > 0);
  R.append(
    xh(
      "x-h",
      `芯片庫存<small>${xChipTotal()} 枚 · 圖鑑 ${owned.length}/${CH.length}</small>`,
    ),
  );
  const fl = xh("x-flt");
  fl.append(
    xbt("x-f" + (XS.rf < 0 ? " on" : ""), "全部", () => xSub("rf", -1)),
  );
  for (let t = 4; t >= 0; t--) {
    const b = xbt("x-f" + (XS.rf === t ? " on" : ""), RN[t], () =>
      xSub("rf", t),
    );
    b.style.setProperty("--a", RC[t]);
    fl.append(b);
  }
  R.append(fl);
  const ids = owned
    .filter((i) => XS.rf < 0 || CH[i].r === XS.rf)
    .sort((a, b) => CH[b].r - CH[a].r || a - b);
  if (!owned.length) {
    const e = xh(
      "x-empty",
      "還沒有芯片。擊敗 Boss 會掉落芯片，也能用晶核到商城開芯片包。",
    );
    e.append(
      xbt("x-btn pri", "前往芯片包", () => {
        XS.sh = "pk";
        xGo("m");
      }),
    );
    R.append(e);
  } else if (!ids.length) R.append(xh("x-empty", "這個稀有度還沒有芯片"));
  else {
    const g = xh("x-lst");
    for (const i of ids) {
      const c = CH[i],
        av = chipAvail(i),
        tot = SV.chips[i];
      const d = xbt(
        "x-cd x-chp" + (av <= 0 ? " dim" : "") + (m.includes(i) ? " on" : ""),
        "",
        () => {
          if (av <= 0) {
            wsNote =
              "「" + c.n + "」已全部裝備中（" + chipWhere(i) + "），請先拆下。";
            window.upd();
            return;
          }
          const q = gm(MWI);
          q[SLI] = i;
          SV.mods[MWI] = q;
          const k = ne(q);
          if (k >= 0) SLI = k;
          wsNote = "";
          save();
          window.upd();
        },
      );
      d.style.setProperty("--a", RC[c.r]);
      d.append(
        xic("chip", c.c, 24),
        xh(
          "x-tx",
          `<b>${c.n}<span class="x-tg">${RN[c.r]}</span></b><small>${c.d}${av <= 0 ? " · 已裝備於 " + chipWhere(i) : ""}</small>`,
        ),
        xh("rt", "×" + av + (tot > av ? "／" + tot : "")),
      );
      g.append(d);
    }
    R.append(g);
  }
  const wr = xh("x-split");
  wr.append(L, R);
  v.append(wr);
}

const XB = [
  [
    "哨兵",
    "#ff4d4d",
    "訓練場最終波；無盡模式第 5、45 波",
    "身上的裝甲會持續旋轉，只有缺口那一側才能造成像樣的傷害，打在裝甲上幾乎無效。招式有環形彈幕、朝你瞄準的扇形彈幕，以及一道道連續掃過前方大範圍的雷射。要隨時繞到缺口方向再開火，血量越低彈幕越密、轉得越快。",
  ],
  [
    "巨像",
    "#ffb040",
    "霓虹街區最終波；無盡模式第 10 波",
    "招式有直線蓄力衝撞、在你所在位置附近投下一批炸彈，以及把周圍的方塊撕下來當石頭砸向你（附近沒有方塊時，改在自己周圍丟出一圈炸彈）。衝撞若撞上牆壁會暈眩一段時間，是最好的輸出時機，可以引它撞牆。後期階段衝撞會連續追擊，還會召喚自爆小怪。",
  ],
  [
    "棱鏡",
    "#4dffd8",
    "數據峽谷最終波；無盡模式第 15 波",
    "會分出環繞自己的分身，分身還在時本體處於無敵狀態（身上有深灰圈）：分身很脆弱，先擊碎它們才打得到本體。本體與分身會同時朝你發射雷射，後期本體的雷射條數會增加，雷射碰到牆壁還會反彈。另一種招式是預判你的移動方向，在你前方落下炸彈。分身被清光後，它會在之後的招式或階段轉換時重新分出分身。",
  ],
  [
    "核心",
    "#d070ff",
    "虛空核心最終波；無盡模式第 20 波",
    "本體在節點還在時是無敵的，要先打掉環繞身邊的節點，每個節點的彈幕各不相同（環形、扇形、追蹤彈）。本體自己會放出旋轉螺旋彈幕、環形炸彈、追蹤光球，也會召喚小怪。節點全部被打掉後本體會暈眩一段時間，讓你盡情輸出，之後節點會重新生成。",
  ],
  [
    "雷霆",
    "#ffe14a",
    "冰封港灣最終波；無盡模式第 25 波",
    "招式有高速衝撞（後期會連續衝刺）、鎖定你所在橫向位置的落雷，以及讓地板以棋盤格分批通電，通電前格子會先亮起預警，站在沒亮的安全格就不會受傷。每一招都伴隨環形彈幕，要先看預警再走位。",
  ],
  [
    "蜂后",
    "#9dff3d",
    "毒蜂巢穴最終波；無盡模式第 30 波",
    "身邊還有小蜂時本體處於無敵狀態（身上有深灰圈），必須先清掉小蜂。小蜂是會衝向你自爆的單位，被清光後它會再叫出新一批。它還會發射扇形彈幕與追蹤針，並在你腳下留下毒池，毒池會逐漸擴大壓縮可站立的空間，要邊清蜂邊移動。",
  ],
  [
    "虛空",
    "#7a7aff",
    "虛空裂隙最終波；無盡模式第 35 波",
    "大部分時間處於隱身狀態，此時受到的傷害大幅降低；只有放出大招後才會短暫現形，那是主要輸出時機。招式有強力引力場搭配環形彈幕、瞬移到你身旁後連射三道雷射，以及放出一對傳送門，你和子彈都能穿過傳送門，之後還會接旋轉彈幕。",
  ],
  [
    "終焉",
    "#ff2a8a",
    "終焉之塔最終波；無盡模式第 40 波",
    "依血量分成四個階段，每個階段套用不同 Boss 的特色：第一階段是旋轉裝甲加環形與扇形彈幕；第二階段加入棋盤格通電地板；第三階段分出分身，分身還在時本體無敵，並一起發射雷射；最後階段毒池持續擴大、旋轉彈幕更密、整體進入狂暴，速度明顯加快。全程也會召喚各類小怪干擾。",
  ],
];
/* ---------- 關卡 ---------- */
function xStage(v) {
  const L = xh("x-sc");
  L.dataset.sc = "l";
  L.append(xh("x-h", "關卡"));
  const g = xh("x-lst");
  STG.forEach((s, i) => {
    const ok = i === 0 || SV.clr[i - 1];
    const d = xbt(
      "x-cd" + (SV.sel === i ? " on" : "") + (ok ? "" : " lk"),
      `<span class="x-tx"><b>${s.n}</b><small>${s.g ? "目標 " + s.g + " 波 · BOSS " + BN[i] : "無盡模式 · 每 5 波一隻 BOSS"}</small></span><span class="rt">${ok ? (SV.clr[i] ? "已通關" : SV.sb[i] ? "最佳 " + SV.sb[i] + " 波" : "") : "通關上一關解鎖"}</span>`,
      () => {
        if (!ok) return;
        SV.sel = i;
        save();
        window.upd();
      },
    );
    d.style.setProperty("--a", s.c);
    g.append(d);
  });
  L.append(g);
  const s = ST(),
    i = SV.sel;
  const dt = xh("x-pn x-dt");
  dt.style.setProperty("--a", s.c);
  dt.innerHTML = `<div class="x-stn">${s.n}</div><div class="x-kv4"><span>目標<b>${s.g ? s.g + " 波" : "無盡"}</b></span><span>敵人血量<b>×${s.hm}</b></span><span>金幣加成<b>×${s.cm}</b></span><span>最佳紀錄<b>${SV.sb[i] ? SV.sb[i] + " 波" : "—"}</b></span></div>`;
  if (s.g && XB[i]) {
    const b = XB[i],
      bx = xh("x-boss");
    bx.append(
      xic("e" + (14 + i), b[1], 34),
      xh(
        "x-tx",
        `<b style="color:${b[1]}">${b[0]}</b><small>${b[2]}</small><p>${b[3]}</p>`,
      ),
    );
    dt.append(bx);
  } else
    dt.append(
      xh(
        "x-ds",
        "沒有終點，波數越高敵人越強。每 5 波會出現一隻 BOSS，撐得越久，最佳波數越高。",
      ),
    );
  const ac = xh("x-foot");
  ac.append(
    xbt("x-btn pri blk", "出戰此關", start),
    xbt("x-btn blk", "前往備戰", () => xGo("b")),
  );
  const R = xSide([dt], ac);
  const w = xh("x-split sd");
  w.append(L, R);
  v.append(w);
}

/* ---------- 商城 ---------- */
const XPK = [
  { n: "普通芯片包", cost: 30, k: 1, b: 0, g: 0 },
  { n: "精選芯片包", cost: 80, k: 3, b: 1, g: 0 },
  { n: "頂級芯片包", cost: 200, k: 3, b: 2, g: 1 },
];
// 功能：處理介面系統「xShop」相關的資料、互動或顯示。
function xShop(v) {
  const subs = [
    ["up", "永久升級"],
    ["wp", "槍械"],
    ["it", "消耗品"],
    ["ch", "角色"],
    ["pk", "芯片包"],
  ];
  const fl = xh("x-flt");
  subs.forEach(([k, n]) =>
    fl.append(xbt("x-f" + (XS.sh === k ? " on" : ""), n, () => xSub("sh", k))),
  );
  v.append(fl);
  const box = xh("x-doc");
  v.append(box);
  // 功能：處理「cost」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const cost = (K, c, can, fn, txt) => {
    const b = xbt("x-btn sm " + (can ? "pri" : ""), `${c} ${CN[K]}`, fn, !can);
    b.prepend(mkIcon(CI[K], can ? "#04101a" : CC[K], 14));
    return b;
  };
  if (XS.sh === "up") {
    box.append(
      xh("x-sub", "碎片用於基礎強化，晶核用於進階強化。升級永久生效。"),
    );
    const l = xh("x-lst");
    UPD.forEach((u) => {
      const lv = SV.up[u.k] || 0,
        K = UC[u.k],
        c = ucost(u, lv),
        mx = lv >= u.m,
        can = !mx && SV[K] >= c;
      const d = xh("x-cd x-up");
      d.style.setProperty("--a", CC[K]);
      d.append(
        xh(
          "x-tx",
          `<b>${u.n}</b><small>每級 ${u.d} · Lv ${lv}/${u.m}</small><span class="x-pp">${Array.from({ length: u.m }, (_, q) => `<i class="${q < lv ? "f" : ""}" style="--p:${CC[K]}"></i>`).join("")}</span>`,
        ),
      );
      d.append(
        mx
          ? xh("rt", "已滿級")
          : cost(K, c, can, () => {
              if (!can) return;
              SV[K] -= c;
              SV.up[u.k] = lv + 1;
              save();
              window.upd();
            }),
      );
      l.append(d);
    });
    box.append(l);
  } else if (XS.sh === "wp") {
    const miss = ALLW.map((w, i) => i).filter((i) => !SV.own.includes(i));
    box.append(
      xh(
        "x-sub",
        `用金幣解鎖新槍械，已解鎖 ${SV.own.length} / ${ALLW.length}。`,
      ),
    );
    box.append(
      xFlt(["全部", ...XCAT.map((c) => c[0])], XS.sc, (n) => xSub("sc", n)),
    );
    const l = xh("x-lst"),
      sh = miss.filter((i) => XS.sc === "全部" || wCat(i) === XS.sc);
    if (!miss.length) l.append(xh("x-empty", "已全部解鎖"));
    else if (!sh.length) l.append(xh("x-empty", "這個分類已全部解鎖"));
    sh.forEach((i) => {
      const w = ALLW[i],
        can = SV[WPC[i]] >= WPR[i],
        d = xh("x-cd");
      d.style.setProperty("--a", w.c);
      d.append(
        xic("ammo", w.c, 26),
        xh(
          "x-tx",
          `<b>${w.n}</b><small>${wCat(i)} · ${wMode(i)} · ${wNote(i)}</small>`,
        ),
      );
      const b = xbt(
        "x-btn sm " + (can ? "gld" : ""),
        `${WPR[i]} 金幣`,
        () => buyW(i),
        !can,
      );
      b.prepend(mkIcon("coin", can ? "#1a1200" : CC.coins, 14));
      d.append(b);
      l.append(d);
    });
    box.append(l);
  } else if (XS.sh === "it") {
    box.append(
      xh(
        "x-sub",
        "消耗品用金幣購買，每種最多持有 9 個，用掉就會減少。到「背包」選擇出戰攜帶。",
      ),
    );
    const l = xh("x-lst");
    for (const k of ITK) {
      const t = ITM[k],
        n = SV.items[k] || 0,
        can = SV.coins >= t.p && n < 9,
        d = xh("x-cd");
      d.style.setProperty("--a", t.c);
      d.append(
        xic(t.ic, t.c, 26),
        xh("x-tx", `<b>${t.n}</b><small>${t.d} · 持有 ${n}/9</small>`),
      );
      const b = xbt(
        "x-btn sm " + (can ? "gld" : ""),
        n >= 9 ? "已滿" : `${t.p} 金幣`,
        () => {
          if (SV.coins < t.p || (SV.items[k] || 0) >= 9) return;
          SV.coins -= t.p;
          SV.items[k] = (SV.items[k] || 0) + 1;
          save();
          window.upd();
        },
        !can,
      );
      b.prepend(mkIcon("coin", can ? "#1a1200" : CC.coins, 14));
      d.append(b);
      l.append(d);
    }
    box.append(l);
  } else if (XS.sh === "ch") {
    box.append(xh("x-sub", "不同角色有各自的特性與取捨。"));
    const l = xh("x-lst");
    CHS.forEach((c, i) => {
      const ow = SV.chars.includes(i),
        on = SV.char === i,
        can = SV.coins >= c.p,
        d = xh("x-cd" + (on ? " on" : ""));
      d.style.setProperty("--a", c.c);
      d.append(xh("x-tx", `<b>${c.n}</b><small>${c.d}</small>`));
      if (on) d.append(xh("rt", "出戰中"));
      else if (ow)
        d.append(
          xbt("x-btn sm pri", "選擇", () => {
            SV.char = i;
            save();
            window.upd();
          }),
        );
      else {
        const b = xbt(
          "x-btn sm " + (can ? "gld" : ""),
          `${c.p} 金幣`,
          () => {
            if (SV.coins < c.p) return;
            SV.coins -= c.p;
            SV.chars.push(i);
            SV.char = i;
            save();
            window.upd();
          },
          !can,
        );
        b.prepend(mkIcon("coin", can ? "#1a1200" : CC.coins, 14));
        d.append(b);
      }
      l.append(d);
    });
    box.append(l);
  } else {
    box.append(
      xh("x-sub", `用晶核開芯片包，目前持有 ${xChipTotal()} 枚芯片。`),
    );
    const l = xh("x-lst");
    for (const p of XPK) {
      const o = TW[p.b],
        sum = o.reduce((a, x) => a + x, 0),
        can = SV.co >= p.cost,
        d = xh("x-cd");
      d.style.setProperty("--a", CC.co);
      d.append(
        xic("chip", "#ff4dff", 28),
        xh(
          "x-tx",
          `<b>${p.n}</b><small>${p.k} 枚${p.g ? " · 保底 1 枚史詩以上" : ""}</small><small>${o
            .map((q, t) =>
              q
                ? `<span style="color:${RC[t]}">${RN[t]} ${+((q / sum) * 100).toFixed(1)}%</span>`
                : "",
            )
            .filter(Boolean)
            .join("　")}</small>`,
        ),
      );
      d.append(
        cost("co", p.cost, can, () => {
          if (SV.co < p.cost) return;
          SV.co -= p.cost;
          const got = [];
          for (let q = 0; q < p.k; q++) got.push(rollChip(p.b));
          if (p.g && !got.some((i) => CH[i].r >= 3))
            got[got.length - 1] = rollChip(p.b, 3);
          lastPk = [];
          for (const i of got) {
            lastPk.push({ i, nw: !(SV.chips[i] > 0) });
            SV.chips[i] = (SV.chips[i] || 0) + 1;
          }
          save();
          window.upd();
        }),
      );
      l.append(d);
    }
    box.append(l);
    if (lastPk && lastPk.length) {
      box.append(xh("x-h", "本次獲得"));
      const g = xh("x-lst");
      for (const x of lastPk) {
        const c = CH[x.i],
          d = xh("x-cd x-chp");
        d.style.setProperty("--a", RC[c.r]);
        d.append(
          xic("chip", c.c, 24),
          xh(
            "x-tx",
            `<b>${c.n}<span class="x-tg">${RN[c.r]}</span></b><small>${c.d}</small>`,
          ),
          xh("rt", x.nw ? "NEW" : ""),
        );
        g.append(d);
      }
      box.append(g);
    }
  }
}

// 功能：處理介面系統「xEnemyCmp」相關的資料、互動或顯示。
function xEnemyCmp(t, c, d) {
  const id = +String(t).slice(1),
    E = ELITE[id],
    nm = (typeof EN !== "undefined" && EN[id]) || d.split(" · ")[0];
  const bk = xh("x-elbk"),
    w = xh("x-elw");
  bk.append(w);
  w.append(xh("", "<h3>" + d.split(" · ")[0] + "　原版 / 精英版</h3>", "div"));
  const g = xh("x-elg");
  const a = xh("x-elc");
  a.style.setProperty("--a", c);
  const ia = xh("x-ic");
  ia.append(mkIcon(t, c, 44));
  a.append(
    xh("tp", "原本"),
    ia,
    xh("", "<b>" + d.split(" · ")[0] + "</b>"),
    xh("", "<p>" + d + "</p>"),
  );
  const b = xh("x-elc el");
  b.style.setProperty("--a", c);
  if (E) {
    const ib = xh("x-ic");
    ib.append(mkEIcon(t, c, 44));
    b.append(
      xh(
        "tp",
        '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg> 精英',
      ),
      ib,
      xh("", "<b>" + E.n + "</b>"),
      xh("", "<ul>" + E.fx.map((s) => "<li>" + s + "</li>").join("") + "</ul>"),
    );
  } else {
    const ib = xh("x-ic");
    ib.append(mkEIcon(t, c, 44));
    b.append(
      xh(
        "tp",
        '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg> 精英',
      ),
      ib,
      xh("", "<b>尚未加入</b>"),
      xh("", "<p>這隻怪的精英版還在製作中。</p>"),
    );
  }
  g.append(a, b);
  w.append(g);
  w.append(
    xh(
      "",
      '<p style="font-size:11px;color:var(--mu)">精英怪只會出現在 Boss 關和 Boss 前一關，出現時畫面會提示。</p>',
    ),
  );
  const x = xh("x-elx", "關閉", "button");
  x.onclick = () => bk.remove();
  w.append(x);
  bk.onclick = (ev) => {
    if (ev.target === bk) bk.remove();
  };
  document.body.append(bk);
}

// 功能：處理「trPick」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function trPick(i, name, col, go) {
  const bk = xh("x-elbk"),
    w = xh("x-elw");
  bk.append(w);
  w.append(xh("", "<h3>召喚 " + name + "　選擇型態</h3>"));
  const tri =
    '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const g = xh("x-elg"),
    E = ELITE[i];
  // 功能：建立或生成「mk」所需的遊戲資料。
  const mk = (el) => {
    const c = xh("x-elc" + (el ? " el" : ""), "", "button");
    c.style.cssText =
      "text-align:left;color:inherit;font:inherit;border:0;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start";
    c.style.setProperty("--a", col);
    const ic = xh("x-ic");
    ic.append(el ? mkEIcon("e" + i, col, 44) : mkIcon("e" + i, col, 44));
    c.append(
      xh("tp", el ? tri + " 精英" : "普通"),
      ic,
      xh("", "<b>" + (el ? E.n : name) + "</b>"),
    );
    if (el)
      c.append(
        xh(
          "",
          "<ul>" + E.fx.map((t) => "<li>" + t + "</li>").join("") + "</ul>",
        ),
      );
    c.onclick = () => {
      bk.remove();
      go(el);
    };
    return c;
  };
  g.append(mk(0), mk(1));
  w.append(g);
  const x = xh("x-elx", "取消", "button");
  x.onclick = () => bk.remove();
  w.append(x);
  bk.onclick = (ev) => {
    if (ev.target === bk) bk.remove();
  };
  document.body.append(bk);
}
/* ---------- 圖鑑（介紹） ---------- */
function xCodex(v) {
  const subs = [
    ["i", "簡介"],
    ["o", "操作"],
    ["p", "道具"],
    ["e", "敵人"],
    ["b", "Boss"],
  ];
  const fl = xh("x-flt");
  subs.forEach(([k, n]) =>
    fl.append(xbt("x-f" + (XS.cx === k ? " on" : ""), n, () => xSub("cx", k))),
  );
  v.append(fl);
  const box = xh("x-doc");
  v.append(box);
  // 功能：本行宣告多個相關輔助函式；「ul」及同列工具供後續邏輯共用。
  const ul = (a) =>
    `<ul class="x-ul">${a.map((t) => `<li>${t}</li>`).join("")}</ul>`;
  if (XS.cx === "i") {
    box.append(
      xh(
        "x-lead",
        "在霓虹方塊構成的戰場上，一邊瞄準、一邊閃避。清光每一波敵人，擊敗關底 Boss，再把戰利品帶回來強化自己。",
      ),
    );
    box.append(
      xh(
        "",
        '<ol class="x-seq"><li><b>備戰</b>選一名角色，帶上 3 把槍（依點選順序為 1 至 3 號），也可以替槍裝上芯片。</li><li><b>出戰</b>清掉每一波敵人。敵人攻擊前會先出現紅色預警，看到就走位。命中敵人會累積 SUPER 能量，每波之間可在補給站用積分補血、補彈。</li><li><b>結算</b>不論勝負都會帶回金幣、碎片、晶核與芯片，拿去升級、解鎖槍械和改裝。</li></ol>',
      ),
    );
    box.append(xh("x-h", "貨幣與戰利品"));
    const l = xh("x-lst");
    [
      ["coin", "金幣", "解鎖槍械與角色"],
      ["shard", "碎片", "基礎永久升級，由方塊與敵人掉落"],
      ["core", "晶核", "進階升級與芯片包，由強敵與 Boss 掉落"],
      [
        "chip",
        "芯片",
        "Boss 掉落，裝在槍上強化。顏色代表稀有度（灰、綠、藍、紫、金）",
      ],
    ].forEach(([t, n, d]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", PC[t]);
      r.append(xic(t, PC[t], 26), xh("x-tx", `<b>${n}</b><small>${d}</small>`));
      l.append(r);
    });
    box.append(
      l,
      xh("x-h", "小技巧"),
      xh(
        "",
        ul([
          "所有出戰槍的彈藥會同時回復，切換武器後的第一發傷害 +30%，輪流使用最有效率。",
          "子彈會打碎方塊，可以開路，也會拆掉自己的掩體。",
          "衝刺期間無敵，可以直接穿過彈幕。",
        ]),
      ),
    );
  } else if (XS.cx === "o") {
    box.append(
      xh("x-h", "電腦"),
      xh(
        "",
        ul([
          "<kbd>WASD</kbd> 移動，滑鼠瞄準，按住左鍵射擊",
          "<kbd>Shift</kbd> 衝刺（衝刺期間無敵）",
          "<kbd>空白鍵</kbd> 釋放 SUPER",
          "<kbd>1</kbd>–<kbd>3</kbd>、<kbd>Q</kbd>、滾輪切換槍械",
          "<kbd>F</kbd> 全螢幕，<kbd>P</kbd> / <kbd>Esc</kbd> 暫停",
        ]),
      ),
    );
    box.append(
      xh("x-h", "手機"),
      xh(
        "",
        ul([
          "左半邊畫面是移動搖桿",
          "右半邊拖曳瞄準，放開時發射",
          "SUPER、DASH、換槍使用畫面上的按鈕",
          "點選畫面下方槍欄換槍，拖曳可互換位置",
        ]),
      ),
    );
    box.append(
      xh("x-h", "自動瞄準"),
      xh(
        "",
        ul([
          "分三段：關、輔助、強（在暫停選單裡調整）",
          "輔助只修正你瞄準方向附近的敵人，其他方向照你瞄的打",
          "強的修正範圍更大，但同樣只會修正準星方向附近的敵人",
        ]),
      ),
    );
    box.append(
      xh("x-h", "戰鬥提示"),
      xh(
        "",
        ul([
          "紅色虛線代表 0.45 秒後開火，快閃開",
          "命中敵人會累積 SUPER 能量",
          "子彈會打碎方塊",
        ]),
      ),
    );
  } else if (XS.cx === "p") {
    const g = xh("x-lst");
    LEG_A.forEach(([t, n]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", PC[t]);
      r.append(xic(t, PC[t], 26), xh("x-tx", n));
      g.append(r);
    });
    box.append(g);
  } else if (XS.cx === "e") {
    const g = xh("x-lst"),
      n = LEG_B.length - 2;
    LEG_B.slice(0, n).forEach(([t, c, d]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", c);
      r.append(xic(t, c, 26), xh("x-tx", d));
      if (ELITE[+t.slice(1)])
        r.append(
          xh(
            "rt",
            '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg>',
          ),
        );
      r.onclick = () => xEnemyCmp(t, c, d);
      g.append(r);
    });
    box.append(g, xh("x-h", "子彈"));
    const g2 = xh("x-lst");
    LEG_B.slice(n).forEach(([t, c, d]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", c);
      r.append(xic(t, c, 26), xh("x-tx", d));
      g2.append(r);
    });
    box.append(g2);
  } else {
    box.append(
      xh("x-h", "所有 Boss 共通規則"),
      xh(
        "",
        ul([
          "每次攻擊前都有預警（紅色虛線或紅圈），攻擊後有短暫後搖。護盾、裝甲、隱身等減傷在後搖中依然有效。",
          "Boss 身上出現深灰色圓環代表無敵，打中只會冒灰色粒子，不要浪費彈藥，先處理護盾來源。",
          "打在護盾或裝甲上會填滿血條下方的黃色破綻條，填滿後進入 BREAK：Boss 暈眩、不再行動，通過護盾的傷害會被放大。",
          "血量降到門檻會進入下一階段，招式更多更密，切換階段時 Boss 會短暫完全無敵。",
          "Boss 不會閃避子彈，會撕碎擋路的方塊。擊殺後場上掉落物會自動吸到你身上。",
        ]),
      ),
    );
    box.append(xh("x-h", "Boss 一覽"));
    const g = xh("x-lst");
    XB.forEach((b, i) => {
      const d = xh("x-cd");
      d.style.setProperty("--a", b[1]);
      d.style.alignItems = "flex-start";
      d.append(
        xic("e" + (14 + i), b[1], 30),
        xh(
          "x-tx",
          `<b style="color:${b[1]}">${b[0]}</b><small>${b[2]}</small><small style="color:#bcc8ee;margin-top:4px">${b[3]}</small>`,
        ),
      );
      g.append(d);
    });
    box.append(g);
  }
}
/* ---------- 帳號頁面 -------------------- */
function xAccount(v){}

/* ---------- 結算 / 暫停 / 補給 ---------- */
function xResult(over) {
  const m = $("xm");
  if (!over) {
    m.classList.remove("on");
    m.innerHTML = "";
    return;
  }
  const nr = score >= best && score > 0,
    s = chipSum();
  m.innerHTML = `<div class="x-rs${won ? "" : " lose"}"><h2>${won ? "通關成功" : "戰鬥結束"}${nr ? '<span class="nr">新紀錄</span>' : ""}</h2><div class="x-kv"><span>分數<b>${score}</b></span><span>抵達波數<b>${wave}</b></span><span>芯片<b>+${chp.length}</b></span><span>金幣<b style="color:${CC.coins}">+${coins}</b></span><span>碎片<b style="color:${CC.sh}">+${shd}</b></span><span>晶核<b style="color:${CC.co}">+${cor}</b></span></div>${s ? `<div class="x-chs">芯片 ${s.replace(/^（|）$/g, "")}</div>` : ""}<div class="x-two"><button class="x-btn" id="xrb">回大廳</button><button class="x-btn pri" id="xrg">再次出戰</button></div></div>`;
  $("xrb").onclick = () => m.classList.remove("on");
  $("xrg").onclick = () => {
    m.classList.remove("on");
    start();
  };
  m.classList.add("on");
}
// 功能：處理介面系統「xPause」相關的資料、互動或顯示。
function xPause() {
  const e = $("psi");
  if (e)
    e.textContent = train
      ? "訓練場 · 不計入進度"
      : `第 ${wave} 波 · 分數 ${score} · 本局金幣 ${coins}`;
}

/* ---------- 版面總管 ---------- */
const XFIT = { h: 1, b: 1, i: 1, k: 1 };
// 功能：處理介面系統「xRender」相關的資料、互動或顯示。
function xRender() {
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
    h: ["大廳", `最高分 ${best}`],
    b: ["備戰", `${(CHS[SV.char] || CHS[0]).n} · 出戰 ${LO.length} / 3 把`],
    i: ["背包", `芯片 ${xChipTotal()} 枚 · 槍械 ${SV.own.length} 把`],
    k: ["關卡", `已通關 ${cl} / 8`],
    m: ["商城", "強化、解鎖與芯片包"],
    c: ["圖鑑", "玩法、操作與敵人資料"],
    a: ["帳號", `歡迎回來，${accoutInfo.name}`],
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
function buildHome() {
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

const ECOL = [
  "#ff3d9a",
  "#ff9a3d",
  "#b45cff",
  "#9dff3d",
  "#4de1ff",
  "#ff4dff",
  "#3dffb0",
  "#ff2a4a",
  "#c0c8ff",
  "#ffd23a",
  "#ff9ad5",
  "#7a7aff",
  "#ff7a5a",
  "#d4ff3d",
];
ECOL[26] = "#ff9f2a";
ECOL[27] = "#e04dff";
ECOL[28] = "#6dffb0";
ECOL[29] = "#c0a060";
// 功能：處理「endTrain」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function endTrain() {
  train = false;
  $("tr").classList.add("h");
  $("trt").classList.add("h");
}
// 進入訓練場
function startTrain() {
  train = true;
  TM = JSON.parse(JSON.stringify(SV.mods));
  trK = "";
  god = true;
  fz = false;
  inf = true;
  WP.splice(0, WP.length, modW(ALLW[0]), modW(ALLW[1]), modW(ALLW[3]));
  setup();
  en.length = 0;
  pk.length = 0;
  bl.length = 0;
  zones.length = 0;
  wave = 1;
  banner = 0;
  $("ov").classList.add("h");
  setState("play");
  trBuild();
  $("tr").classList.remove("h");
  $("trt").classList.remove("h");
}
// 功能：處理「trBuild」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function trBuild() {
  const el = $("tr");
  if (el.children.length) return;
  let rowEl;
  // 功能：處理「sec」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const sec = (t) => {
      rowEl = document.createElement("div");
      rowEl.className = "tr-row";
      const l = document.createElement("div");
      l.className = "tr-l";
      l.textContent = t;
      rowEl.append(l);
      el.append(rowEl);
    },
    grid = () => {
      const g = document.createElement("div");
      g.className = "tr-b";
      rowEl.append(g);
      return g;
    },
    btn = (g, ic, col, txt, fn) => {
      const b = document.createElement("button");
      b.style.borderColor = col;
      if (ic) b.append(mkIcon(ic, col, 16));
      b.append(txt);
      b.onclick = () => fn(b);
      g.append(b);
    };
  {
    const hd = document.createElement("div");
    hd.className = "sec";
    hd.style.cssText =
      "cursor:move;touch-action:none;margin:0 0 6px;text-align:center";
    hd.textContent = "訓練面板 · 拖曳移動";
    let o = null;
    hd.addEventListener("pointerdown", (e) => {
      const r = el.getBoundingClientRect();
      o = {
        id: e.pointerId,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
      };
      el.style.right = "auto";
      el.style.transform = "none";
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      try {
        hd.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    });
    hd.addEventListener("pointermove", (e) => {
      if (!o || e.pointerId !== o.id) return;
      const w = el.offsetWidth,
        h = el.offsetHeight;
      el.style.left =
        Math.max(0, Math.min(innerWidth - w, e.clientX - o.dx)) + "px";
      el.style.top =
        Math.max(0, Math.min(innerHeight - Math.min(h, 60), e.clientY - o.dy)) +
        "px";
    });
    // 功能：處理「up」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
    const up = (e) => {
      if (o && e.pointerId === o.id) o = null;
    };
    hd.addEventListener("pointerup", up);
    hd.addEventListener("pointercancel", up);
    trHd = hd;
  }
  sec("武器");
  let g = grid();
  ALLW.forEach((w, i) =>
    btn(g, "ammo", w.c, w.n, () => {
      const m = modW(w);
      m.ms = Math.round(m.ms0 * (1 + 0.1 * UL("mag")));
      m.am = m.ms;
      WP[pl.w] = m;
    }),
  );
  sec("敵人");
  g = grid();
  EN.forEach((n, i) =>
    btn(g, "e" + i, ECOL[i], n, () => {
      // 功能：處理「go」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
      const go = (el) => {
        const a = pl.aim;
        let p = {
          x: pl.x + Math.cos(a) * 220,
          y: pl.y + Math.sin(a) * 220,
        };
        if (blocked(p.x, p.y, 16)) p = empty(150, pl) || p;
        const m = mkEn(i, p.x, p.y);
        if (el) elify(m, 1);
        en.push(m);
        burst(p.x, p.y, el ? EL_COL : "#ffffff", el ? 16 : 8, 120, 2, 0.5);
      };
      if (ELITE[i]) trPick(i, n, ECOL[i], go);
      else go(0);
    }),
  );
  BN.forEach((n, i) =>
    btn(
      g,
      "e" + (14 + i),
      [
        "#ff4d4d",
        "#ffb040",
        "#4dffd8",
        "#d070ff",
        "#ffe14a",
        "#9dff3d",
        "#7a7aff",
        "#ff2a8a",
      ][i],
      n,
      () => {
        const a = pl.aim;
        let p = {
          x: pl.x + Math.cos(a) * 260,
          y: pl.y + Math.sin(a) * 260,
        };
        if (blocked(p.x, p.y, 16)) p = empty(200, pl) || p;
        en.push(mkEn(14 + i, p.x, p.y));
        burst(p.x, p.y, "#ffffff", 12, 160, 2, 0.5);
      },
    ),
  );
  btn(g, "e22", "#9aa0ab", "肉盾", spawnDummy);
  sec("芯片");
  g = grid();
  CH.map((c, i) => i)
    .sort((a, b) => CH[b].r - CH[a].r || a - b)
    .forEach((i) => {
      const c = CH[i];
      btn(g, "chip", RC[c.r], c.n, () => trChip(i));
      g.lastChild.dataset.chip = i;
      g.lastChild.title = RN[c.r] + " · " + c.d;
    });
  sec("控制");
  g = grid();
  btn(g, null, "#22e6ff", "清除敵人", () => {
    en.length = 0;
  });
  btn(g, null, "#3dff8f", "回血", () => {
    pl.hp = pl.mhp;
  });
  btn(g, null, "#ffe14a", "無敵：開", (b) => {
    god = !god;
    b.textContent = "無敵：" + (god ? "開" : "關");
  });
  btn(g, null, "#4dffd8", "無限彈藥／大招：開", (b) => {
    inf = !inf;
    b.textContent = "無限彈藥／大招：" + (inf ? "開" : "關");
  });
  btn(g, null, "#ff9a3d", "凍結：關", (b) => {
    fz = !fz;
    b.textContent = "凍結：" + (fz ? "開" : "關");
  });
  btn(g, null, "#ff3d9a", "離開", () => quit());
  {
    const rows = [...el.querySelectorAll(".tr-row")],
      tb = document.createElement("div"),
      tg = document.createElement("div");
    tb.className = "tr-row";
    tb.style.order = -1;
    trHd.className = "tr-l";
    trHd.style.cssText = "cursor:move;touch-action:none;color:#22e6ff";
    trHd.textContent = "訓練 ≡";
    tg.className = "tr-b";
    tb.append(trHd, tg);
    // 功能：處理「show」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
    const show = (k) => {
      window._trTab = k;
      rows.forEach((r, i) => (r.style.display = i === k ? "flex" : "none"));
      [...tg.children].forEach((b, i) => {
        b.style.background = i === k ? "#22e6ff33" : "#ffffff0d";
      });
    };
    ["武器", "敵人", "芯片", "控制"].forEach((n, i) => {
      const b = document.createElement("button");
      b.style.borderColor = "#22e6ff";
      b.textContent = n;
      b.onclick = () => show(i);
      tg.append(b);
    });
    el.append(tb);
    show(window._trTab || 0);
  }
  $("trt").onclick = () => el.classList.toggle("h");
}
// 波次間補給站
function openShop() {
  setState("shop");
  shopR();
  $("sh").classList.remove("h");
}
// 重繪補給站按鈕
function shopR() {
  const L = [
      ["hp", "回復 50% 血量", 120, "heal", "立即回復"],
      ["sh", "護盾 +40", 100, "shield", "護盾上限 60"],
      ["am", "全槍補滿彈藥", 150, "ammo", "所有出戰槍"],
      ["ul", "大招充滿", 200, "ult", "立刻可釋放 SUPER"],
      ["dm", "本局傷害 +10%", 250, "chip", "最多 5 次"],
    ],
    el = $("shl");
  el.innerHTML = "";
  $("shc").textContent = "第 " + wave + " 波完成 · 積分 " + pts;
  for (const [k, n, b, ic, ds] of L) {
    const c = Math.round(b * (1 + wave * 0.08)),
      col = PC[ic] || "#ffe14a",
      d = xbt(
        "x-cd",
        `<span class="x-tx"><b>${n}</b><small>${k === "dm" ? ds + "（已購 " + RUN.dmg + "）" : ds}</small></span><span class="rt" style="color:var(--g)">${c} 積分</span>`,
      );
    d.style.setProperty("--a", col);
    d.prepend(xic(ic, col, 26));
    d.disabled = pts < c || (k === "dm" && RUN.dmg >= 5);
    d.onclick = () => {
      if (pts < c) return;
      pts -= c;
      if (k === "hp") pl.hp = Math.min(pl.mhp, pl.hp + pl.mhp / 2);
      else if (k === "sh") pl.sh = Math.min(60, pl.sh + 40);
      else if (k === "am") {
        for (const w of WP) w.am = w.ms;
      } else if (k === "ul") pl.ult = 100;
      else RUN.dmg++;
      shopR();
    };
    el.append(d);
  }
}
$("shg").onclick = () => {
  $("sh").classList.add("h");
  setState("play");
  startWave();
};
// 功能：繪製或建立「drawBuffs」所需的畫面元素。
function drawBuffs(x, yb, u) {
  const p = pl,
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
function bar(x, y, w, h, f, col, ic, txt) {
  const u = HU,
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
function ammoBar(x, y, w, h) {
  const u = HU,
    wp = WP[pl.w],
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

let dd = null,
  sd = null;
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
function drawSuperDir() {
  if (pl.ult < 100 || state !== "play") return;
  let a,
    q,
    al = 1;
  const dg = sd ? Math.hypot(sd.x - sd.sx, sd.y - sd.sy) : 0;
  if (sd && dg > 18 * HU) {
    a = Math.atan2(sd.y - sd.sy, sd.x - sd.sx);
    q = Math.min(1, dg / (90 * HU));
  } else if (!sd && mouse.has && !touchOn) {
    a = pl.aim;
    q = Math.max(
      0,
      Math.min(
        1,
        Math.hypot(mouse.x / S + camx - pl.x, mouse.y / S + camy - pl.y) / 330,
      ),
    );
    al = 0.3;
  } else return;
  const id = WP[pl.w].id,
    um = ultMods() || { v: 1, life: 1, r: 1 },
    col = "#ffe14a",
    ox = pl.x,
    oy = pl.y,
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
  cx.translate(-camx * S, -camy * S);
  cx.scale(S, S);
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
      for (const e of en
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
function drawDashDir() {
  if (!dd) return;
  const dx = dd.x - dd.sx,
    dy = dd.y - dd.sy;
  if (Math.hypot(dx, dy) <= 18 * HU) return;
  const a = Math.atan2(dy, dx),
    px = (pl.x - camx) * S,
    py = (pl.y - camy) * S,
    L = Math.max(60, 71 * S),
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
function ring(el, f, col, flash) {
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
function drawBars() {
  if (train) trMark();
  if (state !== "play") return;
  const L = LAY(),
    u = L.u,
    p = pl,
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
    p.ult >= 100 && Math.floor(time * 6) % 2,
  );
  ring(
    $("bD"),
    1 - Math.max(0, p.dashCd) / (1.2 * (1 - 0.06 * UL("dsh"))),
    "#22e6ff",
    false,
  );
}
// 功能：繪製或建立「drawLast」所需的畫面元素。
function drawLast() {
  if (state !== "play" || en.length > 3 || !en.length) return;
  const u = HU,
    mx = W / 2,
    my = H / 2;
  for (const e of en) {
    const sx = (e.x - camx) * S,
      sy = (e.y - camy) * S,
      on = sx > 20 * u && sx < W - 20 * u && sy > 20 * u && sy < H - 20 * u;
    cx.save();
    cx.strokeStyle = e.col;
    cx.fillStyle = e.col + "88";
    cx.shadowColor = e.col;
    cx.shadowBlur = 10;
    cx.lineWidth = 2;
    if (on) {
      cx.setLineDash([6, 6]);
      cx.beginPath();
      cx.arc(sx, sy, (e.r + 10) * S + Math.sin(time * 6) * 2, 0, TAU);
      cx.stroke();
    } else {
      const a = Math.atan2(sy - my, sx - mx),
        dx = Math.cos(a),
        dy = Math.sin(a),
        k = Math.min(
          (W / 2 - 30 * u) / (Math.abs(dx) || 1e-6),
          (H / 2 - 30 * u - safeT / 2) / (Math.abs(dy) || 1e-6),
        ),
        px = mx + dx * k,
        py = my + dy * k;
      cx.translate(px, py);
      cx.rotate(a);
      cx.globalAlpha = 0.7 + 0.3 * Math.sin(time * 6);
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
        Math.round(Math.hypot(e.x - pl.x, e.y - pl.y) / T),
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
function setAA(v) {
  AA = v;
  tgLast = null;
  $("aa").textContent = "自瞄：" + ["關", "輔助", "強"][AA];
  $("aa").classList.toggle("off", !AA);
  [0, 1, 2].forEach((i) => {
    const b = $("aa" + i);
    if (b) b.classList.toggle("pri", i === AA);
  });
  const h = $("aah");
  if (h) h.textContent = AAH[AA];
  try {
    localStorage.setItem("neonShardAA", String(AA));
  } catch (e) {}
}
[0, 1, 2].forEach((i) => {
  $("aa" + i).onclick = () => setAA(i);
});
{
  let v0 = 1;
  try {
    const q = localStorage.getItem("neonShardAA");
    if (q !== null && +q >= 0 && +q <= 2) v0 = +q;
  } catch (e) {}
  setAA(v0);
}
// 功能：繪製或建立「drawSlots」所需的畫面元素。
function drawSlots() {
  if (state !== "play") return;
  const u = HU;
  for (let i = 0; i < WP.length; i++) {
    const r = slotR(i),
      w = WP[i],
      sel = i === pl.w;
    cx.save();
    cx.globalAlpha = drag && drag.from === i ? 0.35 : 1;
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
      const mm = (train ? TM : SV.mods)[w.id] || [];
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
        um >= 100 && Math.floor(time * 6) % 2 ? "#ffffff" : "#ffe14a";
      cx.fillRect(r.x + 5, r.y + r.w - 5, ((r.w - 10) * um) / 100, 3);
    }
    cx.restore();
  }
  if (drag) {
    const w = WP[drag.from],
      s = 58 * u;
    cx.save();
    cx.globalAlpha = 0.9;
    cx.strokeStyle = w.c;
    cx.fillStyle = w.c + "44";
    cx.shadowColor = w.c;
    cx.shadowBlur = 14;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.rect(drag.x - s / 2, drag.y - s / 2, s, s);
    cx.fill();
    cx.stroke();
    icon(cx, "ammo", drag.x, drag.y, s * 0.24, w.c);
    cx.restore();
  }
}

// ===== 判定線共用工具：射線檢測 / 扇形區域 / 彈跳路徑 =====
// pu: 0=碰到任何方塊就停, 1=只被不可破壞方塊擋住(穿牆彈), 2=完全不受阻擋
let RAYAX = 0;
// 精確格線射線(DDA)：回傳到第一個擋住的方塊「邊界」的精確距離，線尾會剛好貼在牆面上
// RAYAX: 0=撞到左右面, 1=撞到上下面 (彈跳反射用)
function rayK(x, y, a, m, pu) {
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
        RAYAX = 0;
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
        RAYAX = 0;
        return t;
      }
    } else {
      t = ty;
      if (t >= m) return m;
      ty += tdy;
      j += sy;
      if (bl(cell(i, j))) {
        RAYAX = 1;
        return t;
      }
    }
  }
}
// 扇形/圓形範圍：除了等角取樣，還對每個牆角多射兩條射線(角度±1e-4)，輪廓才會貼合牆面轉角、不會有縫
const FANC = new Map();
let FANT = -1;
// 功能：處理「fanPts」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function fanPts(x, y, a0, a1, R, pu) {
  if (FANT !== time) {
    FANC.clear();
    FANT = time;
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
function fanG(x, y, a0, a1, R, pu, fill, stroke) {
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
function bouncePath(x, y, a, len, nb) {
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
    if (RAYAX === 0) dx = -dx;
    else dy = -dy;
    px += dx * 0.01;
    py += dy * 0.01;
  }
  return { p: P, b };
}
// 功能：處理「aimBullet」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function aimBullet(w, a, c, pu, Rt) {
  const x = pl.x,
    y = pl.y,
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
function drawAimLegacy() {
  const w = WP[pl.w];
  let a = pl.aim;
  if (w.slash) {
    const t = aimT();
    if (t) a = Math.atan2(t.y - pl.y, t.x - pl.x);
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
    cx.moveTo(pl.x, pl.y);
    cx.arc(pl.x, pl.y, w.rg, a - w.sw / 2, a + w.sw / 2);
    cx.closePath();
    cx.fill();
    cx.globalAlpha = 0.6;
    cx.lineWidth = 2;
    cx.stroke();
    cx.globalAlpha = 0.3;
    cx.setLineDash([4, 6]);
    cx.beginPath();
    cx.arc(pl.x, pl.y, w.rg + 14, a - w.sw / 2, a + w.sw / 2);
    cx.stroke();
    {
      cx.setLineDash([]);
      cx.globalAlpha = 0.8;
      const ea = a + w.sw / 2,
        ex = pl.x + Math.cos(ea) * (w.rg + 14),
        ey = pl.y + Math.sin(ea) * (w.rg + 14);
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
          ? Math.max(0, pl.q * 260)
          : Math.max(0, Math.min(pl.q * 260, ray(pl.x, pl.y, a, 260) - 12)),
      mx0 = pl.x + Math.cos(a) * d,
      my0 = pl.y + Math.sin(a) * d,
      [mx, my] = w.tur ? turLand(mx0, my0, 18) : [mx0, my0];
    cx.globalAlpha = 0.5;
    cx.lineWidth = 2;
    cx.setLineDash([6, 8]);
    cx.beginPath();
    cx.moveTo(pl.x, pl.y);
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
    fanG(pl.x, pl.y, 0, TAU, Rt, pu, 0, 1);
    cx.setLineDash([]);
    cx.globalAlpha = 0.08;
    fanG(pl.x, pl.y, 0, TAU, Rt, pu, 1, 0);
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
const AIM_LINE_EXTENSIONS = new Map();
function registerAimLineExtension({
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

function drawAim() {
  const weapon = WP[pl?.w];
  if (!weapon || !pl) return;
  const context = {
    weapon,
    player: pl,
    canvas: cx,
    state,
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

// 範圍爆炸：傷害敵人並破壞範圍內方塊
function explode(b) {
  const R = b.ex,
    big = R >= 100;
  if (b.soft) {
    burst(b.x, b.y, b.col, 22, 240, 2.8, 0.45);
    burst(b.x, b.y, "#ffe0b0", 6, 160, 2, 0.3);
    fxs.push({
      k: "w",
      x: b.x,
      y: b.y,
      r: R * 0.9,
      t: 0.3,
      max: 0.3,
      col: b.col,
    });
    shake = Math.max(shake, 4);
  } else {
    burst(
      b.x,
      b.y,
      b.col,
      big ? 80 : 26 + R / 4,
      big ? 420 : 300,
      big ? 7 : 3 + R / 40,
      big ? 1 : 0.6,
    );
    if (big) {
      burst(b.x, b.y, "#ffffff", 30, 360, 4, 0.5);
      fxs.push({
        k: "w",
        x: b.x,
        y: b.y,
        r: R * 1.3,
        t: 0.45,
        max: 0.45,
        col: b.col,
      });
      shake = Math.max(shake, 16);
    } else shake = Math.max(shake, R < 60 ? 3 : 6);
  }
  for (const e of en) {
    if (e.hp <= 0) continue;
    const dx = e.x - b.x,
      dy = e.y - b.y,
      d = Math.hypot(dx, dy);
    if (d < R + e.r) {
      {
        const dd = dm(e, b.dmg, Math.atan2(b.y - e.y, b.x - e.x));
        e.hp -= dd;
        e.hf = dd > 0 ? 1 : 0;
        if (dd > 0 && b.cw !== undefined) chgU(b.cw, dd * 0.25);
        if (dd > 0 && (b.bu || b.fr || b.fz4 || b.lk || b.ch)) {
          chipHit(e, dd, b);
          b.ch = 0;
          b.lk = 0;
        }
        if (dd <= 0) burst(e.x, e.y, "#9aa0ab", 12, 200, 2, 0.35);
      }
      e.kx += ((dx / (d || 1)) * b.kb) / e.m;
      e.ky += ((dy / (d || 1)) * b.kb) / e.m;
      if (e.hp <= 0) kill(e);
    }
  }
  for (let j = Math.floor((b.y - R) / T); j <= Math.floor((b.y + R) / T); j++)
    for (let i = Math.floor((b.x - R) / T); i <= Math.floor((b.x + R) / T); i++)
      if (Math.hypot((i + 0.5) * T - b.x, (j + 0.5) * T - b.y) < R + 8)
        hitCell(i, j, Math.floor(b.wd));
}
// 功能：處理「angD」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const angD = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// 功能：處理「quickT」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function quickT() {
  if (!AA) return null;
  let b = null,
    bd = 9999;
  const R = AA === 2 ? AIMR * 2.4 : AIMR * 1.9;
  for (const e of en) {
    if (e.hp <= 0) continue;
    const D = Math.hypot(e.x - pl.x, e.y - pl.y);
    if (D > R + e.r || D >= bd) continue;
    if (ray(pl.x, pl.y, Math.atan2(e.y - pl.y, e.x - pl.x), D) < D - e.r - 6)
      continue;
    bd = D;
    b = e;
  }
  return b;
}
// 自動瞄準：在範圍與視線內挑最近的敵人
function aimT() {
  if (!AA) return null;
  let b = null,
    bs = 9;
  const R = AIMR * (AA === 2 ? 1.5 : 1.15),
    ex = AA === 2 ? 0.26 : 0.09;
  for (const e of en) {
    if (e.hp <= 0) continue;
    const D = Math.hypot(e.x - pl.x, e.y - pl.y);
    if (D > R + e.r) continue;
    const a = Math.atan2(e.y - pl.y, e.x - pl.x),
      tol = Math.min(Math.atan2(e.r + 8, Math.max(D, 1)), 0.32) + ex,
      df = angD(a, pl.aim);
    if (df > tol) continue;
    if (ray(pl.x, pl.y, a, D) < D - e.r - 6) continue;
    const sc = df / tol + (D / R) * 0.55 - (e === tgLast ? 0.08 : 0);
    if (sc < bs) {
      bs = sc;
      b = e;
    }
  }
  tgLast = b;
  return b;
}
// 子彈穿牆縫修正：把這一幀的移動切成 4px 小段檢查，並且嚴格判定斜角穿縫（只改判定，不改顯示）
function seamHit(x0, y0, x1, y1) {
  const dx = x1 - x0,
    dy = y1 - y0,
    L = Math.hypot(dx, dy);
  if (L < 1e-6) return null;
  const n = Math.max(1, Math.ceil(L / 4)),
    ux = dx / L,
    uy = dy / L;
  let px = x0,
    py = y0,
    pi = Math.floor(px / T),
    pj = Math.floor(py / T);
  for (let k = 1; k <= n; k++) {
    const x = x0 + (dx * k) / n,
      y = y0 + (dy * k) / n,
      ci = Math.floor(x / T),
      cj = Math.floor(y / T);
    if (ci !== pi || cj !== pj) {
      if (cell(ci, cj) !== 0) return [x, y, ci, cj];
      if (ci !== pi && cj !== pj) {
        const bx = (ci > pi ? ci : pi) * T,
          by = (cj > pj ? cj : pj) * T,
          tx = (bx - px) / (x - px || 1e-9),
          ty = (by - py) / (y - py || 1e-9),
          ni = tx < ty ? ci : pi,
          nj = tx < ty ? pj : cj;
        if (cell(ni, nj) !== 0) {
          const t = tx < ty ? tx : ty;
          return [
            px + (x - px) * t + ux * 0.5,
            py + (y - py) * t + uy * 0.5,
            ni,
            nj,
          ];
        }
      }
      pi = ci;
      pj = cj;
    }
    px = x;
    py = y;
  }
  return null;
}
// 大招蓄能：每把槍各自一條(w.um 0~100)，並有各自的蓄能效率 UE[武器id]
//        手槍 霰彈 狙擊 衝鋒 噴火 重炮 導引 環爆 光線 雙槍 榴彈 穿甲 彈跳 電弧 地雷 迴旋 寒霜 重力 電荷 蛛網 砲塔 毒罐 斬擊 集束
const UE = [
  1, 0.8, 1.3, 1, 1.6, 1.1, 1, 0.7, 1.5, 1.1, 1.1, 1, 1, 1.2, 1.2, 1.2, 1.8, 1,
  1.1, 1, 1.5, 1, 0.9, 1.1,
];
// 增加大招蓄能
function chgU(wo, amt) {
  const w = wo === undefined ? WP[pl.w] : typeof wo === "number" ? WP[wo] : wo;
  if (!w) return;
  w.um = Math.min(100, (w.um || 0) + amt * (CHR.sc || 1) * (UE[w.id] ?? 1));
}
// 功能：處理「BMR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const BMR = (b) => 17 * (b.ult ? 2.5 : 1.7);
// 功能：處理「boom」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function boom(b, dt) {
  if (!b.spd0) b.spd0 = Math.hypot(b.vx, b.vy) || 1;
  if (!b.t2 && b.age > b.l0 * 0.35) {
    b.t2 = 1;
    b.hit.length = 0;
    b.life = 12;
    b.returnSlow = 1;
  }
  if (b.t2 && b.returnSlow) {
    const dx = pl.x - b.x,
      dy = pl.y - b.y,
      sp = b.spd0,
      d = Math.hypot(dx, dy) || 1;
    b.vx = (dx / d) * sp;
    b.vy = (dy / d) * sp;
    if (d < pl.r + b.r + 10) {
      b.life = 0;
      const w = WP[b.wi];
      if (w) w.am = 1;
      return;
    }
  }
}
// 功能：處理「homeP」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function homeP(b, dt) {
  const dx = pl.x - b.x,
    dy = pl.y - b.y,
    sp = Math.hypot(b.vx, b.vy),
    a = Math.atan2(b.vy, b.vx);
  let df = Math.atan2(dy, dx) - a;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  const na =
    a + Math.max(-(b.hr || 1.4) * dt, Math.min((b.hr || 1.4) * dt, df));
  b.vx = Math.cos(na) * sp;
  b.vy = Math.sin(na) * sp;
}
// 功能：處理「home」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function home(b, dt) {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 1) return;
  const c = b.vx / sp,
    s = b.vy / sp,
    L = Math.min(230, Math.max(0, b.life) * sp);
  let bd = 1e9,
    t = null;
  for (const e of en) {
    if (e.hp <= 0 || (b.hit && b.hit.includes(e))) continue;
    const dx = e.x - b.x,
      dy = e.y - b.y,
      u = dx * c + dy * s;
    if (u < -e.r) continue;
    const cr = Math.abs(-dx * s + dy * c),
      d = (u > L ? Math.hypot(u - L, cr) : cr) - e.r;
    if (d < (b.hml || 50) && d < bd) {
      bd = d;
      t = e;
    }
  }
  if (!t) return;
  const a = Math.atan2(b.vy, b.vx);
  let df = Math.atan2(t.y - b.y, t.x - b.x) - a;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  const na =
    a + Math.max(-(b.hmr || 1.1) * dt, Math.min((b.hmr || 1.1) * dt, df));
  b.vx = Math.cos(na) * sp;
  b.vy = Math.sin(na) * sp;
}
const D4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
  D8 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
  fdW = new Int16Array(N * N),
  wideC = (x, y) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const a = x + dx,
          b = y + dy;
        if (a < 0 || b < 0 || a >= N || b >= N || grid[a + b * N] !== 0)
          return false;
      }
    return true;
  };
// 廣度優先搜尋，產生「到玩家的步數」路徑場（w=1 時要求寬通道）
function bfs(F, w) {
  F.fill(-1);
  const s0 = Math.floor(pl.x / T) + Math.floor(pl.y / T) * N,
    q = [s0];
  F[s0] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h],
      i = c % N,
      j = (c / N) | 0;
    for (const [dx, dy] of D4) {
      const x = i + dx,
        y = j + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const n = x + y * N;
      if (F[n] >= 0 || grid[n] !== 0) continue;
      if (w && !wideC(x, y)) continue;
      F[n] = F[c] + 1;
      q.push(n);
    }
  }
}
/* Worker 內容：以函式寫成再 toString()，方便閱讀與維護 */
function flowWorkerMain() {
  const D4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  onmessage = (e) => {
    const { grid, n, sx, sy } = e.data;
    // 功能：處理「wide」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
    const wide = (x, y) => {
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const a = x + dx,
            b = y + dy;
          if (a < 0 || b < 0 || a >= n || b >= n || grid[a + b * n] !== 0)
            return false;
        }
      return true;
    };
    // 功能：處理「run」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
    const run = (w) => {
      const F = new Int16Array(n * n).fill(-1),
        q = new Int32Array(n * n);
      let h = 0,
        t = 0;
      const s0 = sx + sy * n;
      F[s0] = 0;
      q[t++] = s0;
      while (h < t) {
        const c = q[h++],
          i = c % n,
          j = (c / n) | 0;
        for (const [dx, dy] of D4) {
          const x = i + dx,
            y = j + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const k = x + y * n;
          if (F[k] >= 0 || grid[k] !== 0) continue;
          if (w && !wide(x, y)) continue;
          F[k] = F[c] + 1;
          q[t++] = k;
        }
      }
      return F;
    };
    const a = run(0),
      b = run(1);
    postMessage({ a, b }, [a.buffer, b.buffer]); // transfer：零複製回傳
  };
}
let flowWorker = null,
  flowBusy = false;
try {
  flowWorker = new Worker(
    URL.createObjectURL(
      new Blob(["(" + flowWorkerMain.toString() + ")()"], {
        type: "text/javascript",
      }),
    ),
  );
  flowWorker.onmessage = (e) => {
    fd.set(e.data.a);
    fdW.set(e.data.b);
    flowBusy = false;
  };
  flowWorker.onerror = () => {
    flowWorker = null;
    flowBusy = false;
  }; // 失敗就退回主執行緒
} catch (_) {
  flowWorker = null;
}
// 更新路徑場（Worker 非同步計算，失敗則退回主執行緒）
function flow() {
  if (!flowWorker) {
    bfs(fd, 0);
    bfs(fdW, 1);
    return;
  }
  if (flowBusy) return; // 上一次還沒算完就略過，避免訊息堆積
  flowBusy = true;
  flowWorker.postMessage({
    grid: grid.slice(),
    n: N,
    sx: Math.floor(pl.x / T),
    sy: Math.floor(pl.y / T),
  });
}
// 敵人尋路：有視線直接追，否則沿路徑場下降方向走
function nav(e, a, d) {
  // 功能：處理「vis」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const vis = (x, y) => {
    const L = Math.hypot(x - e.x, y - e.y);
    if (L < 4) return true;
    const b = Math.atan2(y - e.y, x - e.x),
      px = -Math.sin(b) * e.r * 0.8,
      py = Math.cos(b) * e.r * 0.8;
    return (
      ray(e.x, e.y, b, L) >= L - 4 &&
      ray(e.x + px, e.y + py, b, L) >= L - 4 &&
      ray(e.x - px, e.y - py, b, L) >= L - 4
    );
  };
  if (vis(pl.x, pl.y)) return a;
  let F = e.r >= 15 ? fdW : fd,
    ci = Math.floor(e.x / T),
    cj = Math.floor(e.y / T);
  if (F[ci + cj * N] < 0) F = fd;
  if (F[ci + cj * N] < 0) return a;
  let fx = null,
    fy = null,
    tx = null,
    ty = null;
  for (let s = 0; s < 8; s++) {
    let best = F[ci + cj * N],
      ni = -1,
      nj = -1;
    for (const [dx, dy] of D8) {
      const x = ci + dx,
        y = cj + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const n = x + y * N;
      if (F[n] < 0 || F[n] >= best) continue;
      if (
        dx &&
        dy &&
        (grid[ci + dx + cj * N] !== 0 || grid[ci + (cj + dy) * N] !== 0)
      )
        continue;
      best = F[n];
      ni = x;
      nj = y;
    }
    if (ni < 0) break;
    ci = ni;
    cj = nj;
    const wx = (ci + 0.5) * T,
      wy = (cj + 0.5) * T;
    if (fx === null) {
      fx = wx;
      fy = wy;
    }
    if (vis(wx, wy)) {
      tx = wx;
      ty = wy;
    } else if (tx !== null) break;
    if (F[ci + cj * N] === 0) break;
  }
  if (tx === null) {
    tx = fx;
    ty = fy;
  }
  if (tx === null) return a;
  return Math.atan2(ty - e.y, tx - e.x);
}
// 功能：處理「flk」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function flk(e, a, d) {
  if (e.fo === undefined) e.fo = (Math.random() - 0.5) * 1.2;
  return a + e.fo * Math.max(0, Math.min(1, (d - 70) / 260));
}
const LEAD = {
  1: [400, null, 1],
  2: [235, null, 1],
  4: [300, null, 1],
  7: [1e5, null, 0.6],
  3: [1e5, 0.55, 1],
  13: [1e5, 0.5, 1],
  5: [1e5, 0.5, 1],
  29: [1e5, 0.5, 1],
};
// 功能：處理「leadAt」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function leadAt(e, sp, td, acc) {
  const vx = pl.avx || 0,
    vy = pl.avy || 0;
  if (vx * vx + vy * vy < 100) return [pl.x, pl.y];
  const qx = pl.x - e.x + vx * td,
    qy = pl.y - e.y + vy * td,
    a = vx * vx + vy * vy - sp * sp,
    b = 2 * (qx * vx + qy * vy),
    c = qx * qx + qy * qy;
  let t = 0;
  if (Math.abs(a) < 1e-3) t = b < 0 ? -c / b : 0;
  else {
    const D = b * b - 4 * a * c;
    if (D >= 0) {
      const r1 = (-b - Math.sqrt(D)) / (2 * a),
        r2 = (-b + Math.sqrt(D)) / (2 * a),
        lo = Math.min(r1, r2),
        hi = Math.max(r1, r2);
      t = lo > 0 ? lo : hi;
    }
  }
  if (!(t > 0) || t > 1.6) t = Math.min(1, Math.sqrt(c) / sp);
  let tx = pl.x + vx * (td + t) * acc,
    ty = pl.y + vy * (td + t) * acc;
  const L0 = Math.hypot(tx - pl.x, ty - pl.y);
  if (L0 > 260) {
    tx = pl.x + ((tx - pl.x) * 260) / L0;
    ty = pl.y + ((ty - pl.y) * 260) / L0;
  }
  if (L0 > 1) {
    const g = Math.atan2(ty - pl.y, tx - pl.x),
      Lc = Math.max(
        0,
        Math.min(
          Math.hypot(tx - pl.x, ty - pl.y),
          ray(pl.x, pl.y, g, 300) - pl.r,
        ),
      );
    tx = pl.x + Math.cos(g) * Lc;
    ty = pl.y + Math.sin(g) * Lc;
  }
  return [tx, ty];
}
// 功能：處理「bLead」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bLead(e, a) {
  const P = leadAt(e, 420 * BS, 0.25, 0.55);
  let df = Math.atan2(P[1] - e.y, P[0] - e.x) - a;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  return a + Math.max(-0.3, Math.min(0.3, df)) * Math.min(1, 0.4 + wave * 0.02);
}
// 功能：處理「aiExtra」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function aiExtra(e, dt) {
  if (isB(e) || e.t >= 30 || dt <= 0) return;
  if (e.iq === undefined) e.iq = Math.random();
  const dd = Math.hypot(pl.x - e.x, pl.y - e.y);
  if ((e.t === 0 || e.t === 12 || e.t === 26) && !(e.rec > 0) && !(e.un > 0)) {
    const mvd = Math.hypot(e.x - e.px, e.y - e.py);
    if (mvd < e.sp * dt * 0.12 && dd > e.r + pl.r + 34) {
      e.sk = (e.sk || 0) + dt;
      if (e.sk > 0.5) {
        e.sk = 0;
        e.un = 0.45;
        e.ua =
          Math.atan2(pl.y - e.y, pl.x - e.x) +
          (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.6);
      }
    } else e.sk = Math.max(0, (e.sk || 0) - dt * 2);
  }
  const aw = Math.min(0.8, 0.1 + wave * 0.035) * e.iq;
  if (aw > 0.25)
    for (const z of zones) {
      if (z.k !== "mine" || (z.th && z.th.t > 0)) continue;
      const ex = e.x - z.x,
        ey = e.y - z.y,
        dz = Math.hypot(ex, ey),
        R = z.r * 0.7 + e.r + 26;
      if (dz < R && dz > 1) {
        const k = (e.sp * aw * 1.1 * dt) / dz;
        mv(e, ex * k, ey * k);
      }
    }
}
// 敵人預判並閃避玩家子彈
function dodge(e, dt) {
  if (isB(e) || e.t >= 30) return;
  if (e.dtm > 0) {
    e.dtm -= dt;
    mv(e, e.dvx * dt, e.dvy * dt);
  }
  e.rt -= dt;
  if (e.dgn > 0) e.dgn = Math.max(0, e.dgn - dt * 0.8);
  if (e.rt > 0 || e.tele > 0 || e.dash > 0 || e.dtm > 0 || e.rec > 0) return;
  e.rt = 0.16 + Math.random() * 0.2;
  const [sk0, ms] = DG[e.t] || [0.2, 0.3],
    sk = (sk0 + Math.min(0.12, wave * 0.01)) / (1 + (e.dgn || 0) * 0.8);
  let th = null,
    ts = 9,
    c0 = 0,
    pr = false;
  for (const b of bl) {
    if (!b.own) continue;
    const s2 = b.vx * b.vx + b.vy * b.vy,
      rx = e.x - b.x,
      ry = e.y - b.y,
      t = (rx * b.vx + ry * b.vy) / s2;
    if (t < 0.04 || t > 0.45) continue;
    const cr = (rx * b.vy - ry * b.vx) / Math.sqrt(s2);
    if (Math.abs(cr) < e.r + b.r + 12 && t < ts) {
      ts = t;
      th = b;
      c0 = cr;
    }
  }
  if (!th && time - (pl.lf || -9) < 0.3) {
    const ax = Math.cos(pl.aim),
      ay = Math.sin(pl.aim),
      rx = e.x - pl.x,
      ry = e.y - pl.y,
      u = rx * ax + ry * ay,
      cr = rx * ay - ry * ax;
    if (
      u > 20 &&
      u < 380 &&
      Math.abs(cr) < e.r + 16 &&
      ray(pl.x, pl.y, pl.aim, u) >= u - e.r - 6
    ) {
      th = { vx: ax * 600, vy: ay * 600 };
      c0 = cr;
      pr = true;
    }
  }
  if (!th || Math.random() > sk * (pr ? 0.45 : 1)) return;
  const sp = Math.hypot(th.vx, th.vy) || 1;
  let sg = Math.abs(c0) < 1 ? (Math.random() < 0.5 ? 1 : -1) : -Math.sign(c0);
  if (Math.random() < ms) sg = -sg;
  const spd = Math.max(110, Math.min(210, e.sp * 2.1));
  let dx2 = (-th.vy / sp) * sg,
    dy2 = (th.vx / sp) * sg;
  if (blocked(e.x + dx2 * 30, e.y + dy2 * 30, e.r)) {
    dx2 = -dx2;
    dy2 = -dy2;
    if (blocked(e.x + dx2 * 30, e.y + dy2 * 30, e.r)) {
      dx2 = th.vx / sp;
      dy2 = th.vy / sp;
      if (blocked(e.x + dx2 * 30, e.y + dy2 * 30, e.r)) return;
    }
  }
  e.dvx = dx2 * spd;
  e.dvy = dy2 * spd;
  e.dtm = 0.25;
  e.dgn = (e.dgn || 0) + 1;
}
let HF = 0,
  HC = "#ff1e3c",
  chp = [],
  FL = null,
  bti = 0,
  bcol = "#ff4d4d",
  bossIn = 0,
  bossT = 0,
  ptxt = 0,
  phn = 1;
// 功能：處理「flash」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function flash(col, t, a) {
  FL = { col, t, max: t, a };
}
let TSt = 0,
  TSv = 1;
// 功能：處理「slowmo」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function slowmo(v, t) {
  if (TSt <= 0) TSv = 1;
  TSv = Math.min(TSv, v);
  TSt = Math.max(TSt, t);
}
// 功能：處理「bossRays」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossRays(x, y, col, t, n, len) {
  fxs.push({
    k: "rays",
    x,
    y,
    col,
    t,
    max: t,
    n,
    len,
    rot: Math.random() * TAU,
  });
}
// 功能：處理「bossBolts」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossBolts(x, y, col, n) {
  for (let k = 0; k < n; k++) {
    const t = 0.35 + Math.random() * 0.25;
    fxs.push({
      k: "bolt",
      x: x + (Math.random() - 0.5) * 300,
      y: y + (Math.random() - 0.5) * 40,
      y0: y - 760,
      col,
      t,
      max: t,
      seed: Math.random() * 90 + 3,
    });
  }
}
// 功能：處理「bossIntro」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossIntro(e) {
  for (let k = 0; k < 3; k++)
    fxs.push({
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
function bossDeath(e) {
  slowmo(0.25, 0.9);
  bossRays(e.x, e.y, "#ffffff", 1.2, 20, 920);
  bossRays(e.x, e.y, e.col, 1.7, 12, 720);
  for (let k = 0; k < 3; k++)
    fxs.push({
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
        fxs.push({
          k: "w",
          x: px,
          y: py,
          r: 110 + Math.random() * 90,
          t: 0.45,
          max: 0.45,
          col,
        });
        shake = Math.max(shake, 10);
      },
    });
  SQ.push({
    t: 1.15,
    fn: () => {
      burst(x, y, "#ffffff", 120, 520, 6, 1.2);
      bossBolts(x, y, col, 6);
      flash("#ffffff", 0.35, 0.5);
      shake = Math.max(shake, 26);
    },
  });
}
// 功能：處理「bossAura」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossAura(e) {
  const f = Math.max(0, e.hp / e.mhp),
    pu = 0.5 + 0.5 * Math.sin(time * 3),
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
    const a = time * sp + (k / n) * TAU,
      rr = e.r + 18 + Math.sin(time * 2 + k) * 5;
    cx.save();
    cx.translate(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
    cx.rotate(a + time * 2);
    cx.globalAlpha = 0.85;
    cx.fillRect(-3, -3, 6, 6);
    cx.restore();
  }
  if (f < 0.35) {
    cx.strokeStyle = "#ff3a3a";
    cx.globalAlpha = 0.4 + 0.4 * Math.sin(time * 14);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.arc(e.x, e.y, e.r + 30 + Math.sin(time * 9) * 4, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}
// 功能：處理「phaseFx」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function phaseFx(e, ph) {
  slowmo(0.3, 0.5);
  bl = bl.filter((b) => b.own);
  fxs.push(
    { k: "w", x: e.x, y: e.y, r: 420, t: 0.7, max: 0.7, col: e.col },
    { k: "w", x: e.x, y: e.y, r: 260, t: 0.5, max: 0.5, col: "#ffffff" },
  );
  burst(e.x, e.y, e.col, 70, 420, 5, 0.9);
  shake = 24;
  flash(e.col, 0.5, 0.5);
  e.rec = 0.7;
  ptxt = 1.6;
  phn = ph + 1;
}
// 功能：繪製或建立「drawWarn」所需的畫面元素。
function drawWarn() {
  const u = HU;
  if (bossIn > 0) {
    const y = H * 0.4;
    cx.save();
    cx.globalAlpha = Math.min(1, bossIn * 1.2);
    cx.fillStyle = "#ff2a4a22";
    cx.fillRect(0, y - 34 * u, W, 68 * u);
    cx.fillStyle = "#ff2a4a33";
    for (let sx = -((time * 90) % 70); sx < W; sx += 70) {
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
    cx.lineTo(W, y - 34 * u);
    cx.moveTo(0, y + 34 * u);
    cx.lineTo(W, y + 34 * u);
    cx.stroke();
    cx.globalAlpha = Math.min(1, bossIn) * (0.6 + 0.4 * Math.sin(time * 16));
    cx.fillStyle = "#ff2a4a";
    cx.shadowColor = "#ff2a4a";
    cx.shadowBlur = 22;
    cx.font = `bold ${38 * u}px ui-monospace,monospace`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("WARNING", W / 2, y - 4 * u);
    cx.font = `bold ${15 * u}px ui-monospace,monospace`;
    cx.fillText("BOSS " + BN[bossT], W / 2, y + 22 * u);
    cx.restore();
  }
  if (ptxt > 0) {
    cx.save();
    cx.globalAlpha = Math.min(1, ptxt * 1.5);
    cx.fillStyle = bcol;
    cx.shadowColor = bcol;
    cx.shadowBlur = 20;
    cx.font = `bold ${30 * u}px ui-monospace,monospace`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText("PHASE " + phn, W / 2, H * 0.32);
    cx.restore();
  }
}
// 功能：繪製或建立「drawAtmos」所需的畫面元素。
function drawAtmos() {
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (bti > 0.01) {
    const g = cx.createRadialGradient(
      W / 2,
      H / 2,
      Math.min(W, H) * 0.3,
      W / 2,
      H / 2,
      Math.max(W, H) * 0.75,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, bcol + "88");
    cx.globalAlpha = bti * (0.7 + 0.3 * Math.sin(time * 2.5));
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);
    cx.globalAlpha = 1;
  }
  if (HF > 0.01) {
    cx.globalAlpha = Math.min(0.2, HF * 0.28);
    cx.fillStyle = HC;
    cx.fillRect(0, 0, W, H);
    cx.globalAlpha = 1;
  }
  {
    const lowF =
        state === "play" && pl.hp > 0 && pl.hp / pl.mhp < 0.3
          ? (0.3 + 0.2 * Math.sin(time * 6)) *
            (1 - (pl.hp / pl.mhp / 0.3) * 0.5)
          : 0,
      hv = Math.max(HF, lowF);
    if (hv > 0.01) {
      const g2 = cx.createRadialGradient(
          W / 2,
          H / 2,
          Math.min(W, H) * 0.25,
          W / 2,
          H / 2,
          Math.max(W, H) * 0.72,
        ),
        col = lowF > HF ? "#ff1e3c" : HC;
      g2.addColorStop(0, "rgba(0,0,0,0)");
      g2.addColorStop(1, col + "dd");
      cx.globalAlpha = Math.min(1, hv);
      cx.fillStyle = g2;
      cx.fillRect(0, 0, W, H);
      cx.globalAlpha = hv * 0.16;
      cx.fillStyle = col;
      cx.fillRect(0, 0, W, H);
      cx.globalAlpha = 1;
    }
  }
  if (FL) {
    cx.globalAlpha = (FL.a * FL.t) / FL.max;
    cx.fillStyle = FL.col;
    cx.fillRect(0, 0, W, H);
    cx.globalAlpha = 1;
  }
}
const BN = ["哨兵", "巨像", "棱鏡", "核心", "雷霆", "蜂后", "虛空", "終焉"],
  isB = (e) => e.t >= 14 && e.t < 26,
  EXT = {
    18: [30, 1800, 150, "#ffe14a", 4500, 3],
    19: [40, 2200, 95, "#9dff3d", 5000, 4],
    20: [36, 2400, 85, "#7a7aff", 5500, 4],
    21: [44, 3500, 65, "#ff2a8a", 9000, 6],
    30: [26, 1, 0, "#4dffd8", 0, 3],
    31: [18, 300, 0, "#d070ff", 200, 9],
    26: [12, 28, 210, "#ff9f2a", 140, 1],
    27: [13, 45, 70, "#e04dff", 230, 1],
    28: [14, 60, 60, "#6dffb0", 260, 1],
    29: [14, 55, 65, "#c0a060", 240, 1],
  },
  BK = [3, 3, 2, 4, 3, 3, 3, 4],
  BPF = [130, 130, 260, 0, 200, 150, 0, 180];
let MVF = 0;
// 功能：處理「pRing」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const pRing = (e, n, sp, d, o) => {
    for (let k = 0; k < n; k++) eb(e, (o || 0) + (k / n) * TAU, sp, d);
  },
  pFan = (e, a, c, sp, d, s) => {
    for (let k = 0; k < c; k++)
      eb(e, a + (c > 1 ? (k / (c - 1) - 0.5) * s : 0), sp, d);
  },
  pBomb = (x, y, r, t, d, col) =>
    zones.push(
      thr(
        { k: "bomb", x, y, r, t, max: t, col, dmg: d },
        TS ? TS.x : x,
        TS ? TS.y : y,
        Math.min(0.7, t * 0.7),
      ),
    ),
  pHom = (e, n, sp, d) => {
    for (let k = 0; k < n; k++) eb(e, Math.random() * TAU, sp, d, 2);
  },
  pSum = (e, n, ts) => {
    for (let k = 0; k < n; k++) {
      const p = emptyNear(e, 90, 20 * T) || { x: e.x, y: e.y };
      if (en.length < 34) {
        const m = mkEn(ts[(Math.random() * ts.length) | 0], p.x, p.y);
        m.gl = e.col;
        en.push(m);
      }
    }
  },
  lat = (e, t, fn) =>
    later(t, () => {
      if (e.hp > 0 && state === "play") fn();
    });
// 功能：處理「dm」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function dm(e, d, ang) {
  if (e.inv > 0) return 0;
  if (e.frz > 0) d *= 1.5;
  return isB(e) ? bd(e, d, ang) : d;
}
// 功能：處理「bInv」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const bInv = (e) => {
  const i = e.t - 14;
  return (
    e.inv > 0 ||
    (i === 3 && en.some((n) => n.t === 31 && n.hp > 0)) ||
    (i === 5 && en.some((n) => n.bee && n.hp > 0)) ||
    ((i === 2 || (i === 7 && e.ph === 2)) &&
      en.some((n) => n.t === 30 && n.hp > 0))
  );
};
// 功能：處理「bd」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bd(e, d, ang) {
  const i = e.t - 14;
  if (e.inv > 0) return 0;
  if (e.dummy) return d;
  let m = 1,
    sh = false;
  if (
    (i === 0 || (i === 7 && e.ph === 0)) &&
    ang !== undefined &&
    Math.abs(
      Math.atan2(Math.sin(ang - (e.open || 0)), Math.cos(ang - (e.open || 0))),
    ) > 0.9
  )
    m *= 0.08;
  if (i === 3 && en.some((n) => n.t === 31 && n.hp > 0)) {
    m = 0;
    sh = true;
  }
  if (i === 5 && en.some((n) => n.bee && n.hp > 0)) {
    m = 0;
    sh = true;
  }
  if (
    (i === 2 || (i === 7 && e.ph === 2)) &&
    en.some((n) => n.t === 30 && n.hp > 0)
  ) {
    m = 0;
    sh = true;
  }
  if (i === 6 && !(e.vis > 0)) m *= 0.25;
  if (e.vul > 0) return d * m * 1.5;
  const r = d * m;
  e.sg = (e.sg || 0) + (sh ? d * 0.25 : r);
  if (e.sg > e.mhp * 0.12) {
    e.sg = 0;
    e.vul = 3;
    slowmo(0.4, 0.28);
    burst(e.x, e.y, "#ffe14a", 30, 300, 4, 0.7);
    shake = Math.max(shake, 12);
    flash("#ffe14a", 0.2, 0.25);
    fxs.push({
      k: "w",
      x: e.x,
      y: e.y,
      r: 200,
      t: 0.5,
      max: 0.5,
      col: "#ffe14a",
    });
  }
  return r;
}
// 功能：處理「frz」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function frz(e) {
  e.fv = 0;
  if (isB(e)) {
    e.fr = 2.5;
    return;
  }
  e.stn = 2;
  e.frz = 2;
  burst(e.x, e.y, "#9ae6ff", 16, 160, 3, 0.5);
}
// 功能：引爆電荷並結算範圍傷害、暈眩與特效。
function detonate(e) {
  e.cg = 0;
  fxs.push(
    {
      k: "w",
      x: e.x,
      y: e.y,
      r: 150,
      t: 0.35,
      max: 0.35,
      col: "#ffe14a",
    },
    {
      k: "mx",
      x: e.x,
      y: e.y,
      r: 150,
      t: 0.45,
      max: 0.45,
      col: "#ffe14a",
      rot: Math.random() * TAU,
    },
    {
      k: "rays",
      x: e.x,
      y: e.y,
      len: 150,
      n: 9,
      rot: Math.random() * TAU,
      t: 0.3,
      max: 0.3,
      col: "#fff4a6",
    },
  );
  burst(e.x, e.y, "#ffe14a", 34, 300, 3, 0.55);
  ftxt(e.x, e.y - e.r - 20, "電荷引爆！", "#fff4a6", 15);
  shake = Math.max(shake, 8);
  flash("#ffe14a", 0.15, 0.2);
  let n = 0;
  e.hp -= dm(e, 40 * dmM());
  e.hf = 1;
  if (e.hp <= 0) kill(e);
  for (const o of en) {
    if (o === e || o.hp <= 0 || Math.hypot(o.x - e.x, o.y - e.y) > 150)
      continue;
    if (!isB(o)) {
      o.stn = Math.max(o.stn || 0, 1);
      ftxt(o.x, o.y - o.r - 20, "暈眩", "#ffe14a", 12);
    }
    if (n < 3) {
      n++;
      o.hp -= dm(o, 30 * dmM());
      o.hf = 1;
      zig(e.x, e.y, o.x, o.y, "#ffe14a", 0.22, 3.5, 1);
      burst(o.x, o.y, "#ffe14a", 8, 180, 2, 0.3);
      if (o.hp <= 0) kill(o);
    }
  }
}
// 功能：處理「tiles」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tiles(e, ph) {
  const x0 = Math.round(pl.x / 70) * 70 - 175,
    y0 = Math.round(pl.y / 70) * 70 - 175,
    Wv = ph > 1 ? 3 : 2;
  for (let wv = 0; wv < Wv; wv++) {
    const list = [];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++) {
        const dg =
          wv === 0
            ? (r + c) % 2 === 0
            : wv === 1
              ? (r + c) % 2 === 1
              : Math.random() < 0.5;
        if (dg) list.push([x0 + c * 70, y0 + r * 70]);
      }
    lat(e, wv * 0.7, () => {
      for (const [x, y] of list)
        fxs.push({ k: "t", x, y, w: 70, t: 0.9, max: 0.9, col: e.col });
    });
    lat(e, wv * 0.7 + 0.9, () => {
      for (const [x, y] of list)
        if (
          pl.x > x &&
          pl.x < x + 70 &&
          pl.y > y &&
          pl.y < y + 70 &&
          pl.dashT <= 0
        )
          hurt(24);
      shake = Math.max(shake, 6);
      flash(e.col, 0.15, 0.2);
    });
  }
}
// 功能：處理「rocks」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function rocks(e, n) {
  const cs = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++)
      if (grid[j * N + i] > 0) {
        const D = Math.hypot((i + 0.5) * T - e.x, (j + 0.5) * T - e.y);
        if (D < 300) cs.push([D, i, j]);
      }
  cs.sort((a, b) => a[0] - b[0]);
  for (const [D, i, j] of cs.slice(0, n)) {
    grid[j * N + i] = 0;
    const x = (i + 0.5) * T,
      y = (j + 0.5) * T,
      a = Math.atan2(pl.y - y, pl.x - x);
    burst(x, y, "#ffb040", 10, 160, 3, 0.5);
    bl.push({
      x,
      y,
      vx: Math.cos(a) * 220 * BS,
      vy: Math.sin(a) * 220 * BS,
      r: 10,
      own: 0,
      dmg: 16,
      life: 3 / BS,
      col: "#ffb040",
    });
  }
  return cs.length;
}
// 功能：處理「emptyNear」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function emptyNear(e, a, b) {
  for (let k = 0; k < 150; k++) {
    const an = Math.random() * TAU,
      d = a + Math.random() * (b - a),
      x = e.x + Math.cos(an) * d,
      y = e.y + Math.sin(an) * d;
    if (!blocked(x, y, 16)) return { x, y };
  }
  return null;
}
// 功能：處理「beeWave」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function beeWave(e) {
  for (let q = 0; q < 6; q++) {
    if (en.length >= 34) break;
    const p = emptyNear(e, 90, 20 * T) || { x: e.x, y: e.y },
      m = mkEn(26, p.x, p.y);
    m.bee = 1;
    m.col = e.col;
    m.gl = e.col;
    en.push(m);
  }
}
// 功能：處理「poison」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function poison(e) {
  for (let q = 0; q < 3 + (e.ph || 0); q++) {
    const ax = Math.random() * TAU,
      o = q ? 60 + Math.random() * 100 : 0;
    zones.push(
      thr(
        {
          k: "slowz",
          x: pl.x + Math.cos(ax) * o,
          y: pl.y + Math.sin(ax) * o,
          r: 55,
          t: 13,
          max: 13,
          col: e.col,
          grow: 11,
          dps: 3,
        },
        e.x,
        e.y,
        0.5,
      ),
    );
  }
}
// 功能：處理「portals」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function portals(e) {
  zones = zones.filter((z) => z.k !== "portal");
  const ang = Math.random() * TAU,
    a = {
      k: "portal",
      x: pl.x + Math.cos(ang) * 190,
      y: pl.y + Math.sin(ang) * 190,
      r: 30,
      t: 14,
      max: 14,
      col: "#ffb040",
    },
    b = {
      k: "portal",
      x: pl.x - Math.cos(ang) * 190,
      y: pl.y - Math.sin(ang) * 190,
      r: 30,
      t: 14,
      max: 14,
      col: "#4dffd8",
    };
  if (blocked(a.x, a.y, 10) || blocked(b.x, b.y, 10)) return;
  a.o = b;
  b.o = a;
  zones.push(a, b);
}
// 功能：處理「bossPhase」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossPhase(e, ph, i) {
  if (i === 2 || (i === 7 && ph === 2)) {
    for (const c of en) if (c.t === 30) c.hp = 0;
    for (let q = 0; q < 3; q++) {
      const m = mkEn(30, e.x, e.y);
      m.gl = e.col;
      m.ci = q;
      m.hp = m.mhp = 1;
      m.dk = 1;
      m.col = e.col;
      m.sc = 0;
      en.push(m);
    }
  }
  if (i === 3) {
    for (const c of en) if (c.t === 31) c.hp = 0;
    e.nal = 3;
    for (let q = 0; q < 3; q++) {
      const m = mkEn(31, e.x, e.y);
      m.gl = e.col;
      m.ni = q;
      m.hp = m.mhp = e.mhp * 0.1;
      en.push(m);
    }
  }
  if (i === 5) beeWave(e);
  if (i === 6) portals(e);
  if (i === 7 && ph === 3) {
    e.sp *= 1.3;
    poison(e);
  }
}
// 功能：處理「cloneAI」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function cloneAI(e, dt) {
  const b = en.find(isB);
  if (!b || b.hp <= 0) {
    e.hp = 0;
    return;
  }
  e.oa = (e.oa || e.ci * 2.1) + dt * 0.7;
  e.x = b.x + Math.cos(e.oa) * 150;
  e.y = b.y + Math.sin(e.oa) * 150;
  if (e.tele > 0) e.tele -= dt;
}
// 功能：處理「nodeAI」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function nodeAI(e, dt) {
  const b = en.find(isB);
  if (!b || b.hp <= 0) {
    e.hp = 0;
    return;
  }
  e.oa = (e.oa || e.ni * 2.09) + dt * 0.8;
  e.x = b.x + Math.cos(e.oa) * 150;
  e.y = b.y + Math.sin(e.oa) * 150;
  e.cd -= dt;
  if (e.cd <= 0) {
    e.cd = 2.4;
    const A = Math.atan2(pl.y - e.y, pl.x - e.x);
    if (e.ni === 0) pRing(e, 10, 170, 8, time);
    else if (e.ni === 1) pFan(e, A, 5, 260, 10, 0.7);
    else pHom(e, 3, 140, 9);
  }
}
// 功能：處理「dk」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const dk = (c) => {
  const n = parseInt(c.slice(1), 16),
    r = (((n >> 16) & 255) * 0.4) | 0,
    g = (((n >> 8) & 255) * 0.4) | 0,
    b = ((n & 255) * 0.4) | 0;
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
};
// 功能：繪製或建立「drawBossFx」所需的畫面元素。
function drawBossFx(e) {
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
    cx.arc(e.x, e.y, e.r + 12 + Math.sin(time * 10) * 3, 0, TAU);
    cx.stroke();
  }
  cx.restore();
}
// 功能：處理「bossFire3」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossFire3(e, ph, a, i) {
  TS = e;
  e.rec = Math.max(0.25, 0.5 - 0.08 * ph);
  const k = e.atk,
    A = e.aim;
  if (i === 0) {
    if (k === 0) {
      pRing(e, 12 + ph * 5, 170 + ph * 20, 9, time);
      if (ph > 0)
        lat(e, 0.35, () =>
          pRing(e, 12 + ph * 5, 150 + ph * 20, 9, time + 0.26),
        );
    } else if (k === 1)
      pFan(e, A, 5 + ph * 2, 260 + ph * 30, 12, 0.18 * (4 + ph * 2));
    else {
      for (let q = 0; q < 14 + ph * 2; q++)
        lat(e, q * 0.07, () => beam(e, A - 1.2 + (q * 2.4) / (13 + ph * 2)));
    }
  } else if (i === 1) {
    if (k === 0) {
      e.dash = 0.8 + ph * 0.1;
      e.dn = ph > 1 ? 1 : 0;
    } else if (k === 1) {
      const n = 2 + ph;
      for (let q = 0; q < n; q++) {
        const o = q ? 150 : 0,
          ax = Math.random() * TAU;
        pBomb(
          e.tx + Math.cos(ax) * o * Math.random(),
          e.ty + Math.sin(ax) * o * Math.random(),
          85,
          1 + q * 0.15,
          26,
          e.col,
        );
      }
    } else {
      if (!rocks(e, 3 + ph * 2) || ph > 1)
        for (let q = 0; q < 8; q++) {
          const t = (q / 8) * TAU;
          pBomb(
            e.x + Math.cos(t) * 140,
            e.y + Math.sin(t) * 140,
            60,
            1,
            22,
            e.col,
          );
        }
      if (ph > 0) pSum(e, 1 + ph, [0, 0, 26]);
    }
  } else if (i === 2) {
    if (k === 0) {
      const src = [e, ...en.filter((c) => c.t === 30 && c.hp > 0)];
      src.forEach((s, idx) => {
        const ang = Math.atan2(pl.y - s.y, pl.x - s.x),
          n = idx ? 1 : [1, 3, 5, 7][ph];
        for (let q = 0; q < n; q++) beam(s, ang + (q - (n - 1) / 2) * 0.22, 1);
      });
    } else {
      if (!en.some((c) => c.t === 30 && c.hp > 0)) bossPhase(e, ph, 2);
      const n = 4 + ph * 2;
      for (let q = 0; q < n; q++) {
        const o = q ? Math.random() * 140 : 0,
          ax = Math.random() * TAU;
        pBomb(
          pl.x + pl.vx * 0.6 + Math.cos(ax) * o,
          pl.y + pl.vy * 0.6 + Math.sin(ax) * o,
          55,
          1 + q * 0.08,
          20,
          e.col,
        );
      }
    }
  } else if (i === 3) {
    if (k === 0) {
      e.spi = 2.2 + ph * 0.5;
      e.st2 = 0;
    } else if (k === 1) pSum(e, 3 + ph, [0, 1, 2, 3, 4, 10]);
    else if (k === 2) {
      const n = 6 + ph * 2;
      for (let q = 0; q < n; q++) {
        const t = (q / n) * TAU;
        pBomb(
          e.x + Math.cos(t) * 130,
          e.y + Math.sin(t) * 130,
          70,
          1.1,
          22,
          e.col,
        );
      }
    } else pHom(e, 6 + ph * 2, 140, 10);
  } else if (i === 4) {
    if (k === 0) {
      e.dash = 0.5 + ph * 0.08;
      e.dn = ph > 0 ? 1 : 0;
    } else if (k === 1) {
      const n = 4 + ph * 2;
      for (let q = 0; q < n; q++) {
        const x = pl.x + (q - (n - 1) / 2) * 70 + (Math.random() - 0.5) * 30,
          y0 = pl.y - 300;
        fxs.push({
          k: "l",
          x,
          y: y0,
          a: Math.PI / 2,
          len: 600,
          t: 0.8,
          max: 0.8,
          col: e.col,
        });
        lat(e, 0.8, () => {
          fxs.push({
            k: "l",
            x,
            y: y0,
            a: Math.PI / 2,
            len: 600,
            t: 0.15,
            max: 0.15,
            col: "#ffffff",
          });
          if (Math.abs(pl.x - x) < 22 && pl.dashT <= 0) hurt(22);
          shake = Math.max(shake, 8);
        });
      }
    } else {
      tiles(e, ph);
      pRing(e, 10 + ph * 2, 240, 10, time);
    }
  } else if (i === 5) {
    if (k === 0) {
      if (!en.some((n) => n.bee && n.hp > 0)) beeWave(e);
      pFan(e, A, 5, 250, 10, 0.9);
    } else if (k === 1) {
      poison(e);
      pBomb(pl.x, pl.y, 60, 1, 20, e.col);
    } else pHom(e, 5 + ph * 2, 150, 10);
  } else if (i === 6) {
    if (k === 0) {
      zones.push({
        k: "pull",
        x: e.x,
        y: e.y,
        r: 280,
        t: 3,
        max: 3,
        col: e.col,
      });
      pRing(e, 14 + ph * 3, 150, 9, time);
      e.vis = 3;
    } else if (k === 1) {
      const ang = Math.random() * TAU,
        bx = pl.x + Math.cos(ang) * 160,
        by = pl.y + Math.sin(ang) * 160;
      if (!blocked(bx, by, 20)) {
        e.x = bx;
        e.y = by;
      }
      e.aim = Math.atan2(pl.y - e.y, pl.x - e.x);
      e.vis = 1.5;
      for (let q = -1; q <= 1; q++)
        lat(e, 0.2 + q * 0.05, () => beam(e, e.aim + q * 0.3));
    } else {
      portals(e);
      e.spi = 2 + ph * 0.4;
      e.st2 = 0;
    }
  } else {
    if (ph === 1 && (k === 0 || k === 2)) tiles(e, ph);
    else if (ph === 2 && k === 2) {
      const src = [e, ...en.filter((c) => c.t === 30 && c.hp > 0)];
      src.forEach((s, idx) => {
        const ang = Math.atan2(pl.y - s.y, pl.x - s.x),
          n = idx ? 1 : 5;
        for (let q = 0; q < n; q++) beam(s, ang + (q - (n - 1) / 2) * 0.22, 1);
      });
    } else if (k === 1 || (ph === 3 && k === 3)) {
      e.spi = 2.2 + ph * 0.5;
      e.st2 = 0;
    } else if (k === 3) pSum(e, 3 + ph, [0, 1, 2, 3, 4, 10, 27]);
    else {
      pRing(e, 14 + ph * 4, 180, 9, time);
      pFan(e, A, 5 + ph, 270, 12, 1.1);
      if (ph > 1) pHom(e, 4, 140, 10);
    }
    if (ph === 3 && k === 0) poison(e);
  }
}
// 功能：處理「bossAI3」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossAI3(e, dt, d, a) {
  const i = e.t - 14,
    hf = e.hp / e.mhp,
    ph = hf < 0.25 ? 3 : hf < 0.5 ? 2 : hf < 0.75 ? 1 : 0;
  if (!e.init) {
    e.init = 1;
    e.open = 0;
    e.lph = 0;
    bossPhase(e, 0, i);
  }
  if (ph > e.lph) {
    e.lph = ph;
    e.inv = 5;
    phaseFx(e, ph);
    bossPhase(e, ph, i);
  }
  e.ph = ph;
  if (i === 0 || (i === 7 && ph === 0)) e.open += dt * (0.5 + 0.2 * ph);
  if (e.vis > 0) e.vis -= dt;
  if (i === 3 && e.nal > 0 && !en.some((n) => n.t === 31 && n.hp > 0)) {
    e.nal = 0;
    e.vul = 5;
    flash("#d070ff", 0.3, 0.3);
    lat(e, 5.2, () => bossPhase(e, e.ph, 3));
  }
  if (e.vul > 0) {
    e.vul -= dt;
    return;
  }
  if (d < e.r + pl.r + 2 && e.cc <= 0 && pl.dashT <= 0) {
    hurt(e.dash > 0 ? 28 : 16);
    e.cc = 0.7;
  }
  if (e.dash > 0) {
    e.dash -= dt;
    const c = Math.cos(e.aim),
      s = Math.sin(e.aim),
      sp = i === 4 ? 520 : i === 7 ? 440 : 420;
    if (mvB(e, c * sp * dt, s * sp * dt)) {
      e.dash = 0;
      if (i === 1) {
        e.vul = 3;
        shake = 20;
        burst(e.x, e.y, "#ffb040", 40, 320, 4, 0.8);
        flash("#ffb040", 0.25, 0.3);
        return;
      }
    }
    if (e.dash <= 0) {
      if (e.dn > 0) {
        e.dn--;
        e.aim = a;
        e.dash = 0.6;
      } else e.rec = 0.7;
    }
    return;
  }
  if (e.spi > 0) {
    e.spi -= dt;
    e.st2 -= dt;
    if (e.st2 <= 0) {
      e.st2 = 0.09;
      e.rot = (e.rot || 0) + 0.45;
      const n = 3 + ph;
      for (let k = 0; k < n; k++)
        eb(e, e.rot + (k / n) * TAU, 190 + ph * 20, 8);
    }
    return;
  }
  if (e.tele > 0) {
    e.tele -= dt;
    if (e.tele <= 0) bossFire3(e, ph, a, i);
    return;
  }
  const pref = BPF[i],
    na = nav(e, a, d),
    sp = e.sp * dt * (1 + 0.12 * ph);
  if (pref > 0) {
    if (d > pref + 30) mvB(e, Math.cos(na) * sp, Math.sin(na) * sp);
    else if (d < pref - 40) mvB(e, -Math.cos(a) * sp, -Math.sin(a) * sp);
    else if (i === 2 || i === 4)
      mvB(e, -Math.sin(a) * sp * 0.6, Math.cos(a) * sp * 0.6);
  }
  e.cd -= dt;
  if (e.cd <= 0) {
    e.cd = Math.max(0.7, 1.7 - 0.3 * ph) * (i === 7 ? 0.85 : 1);
    e.tele = Math.max(0.35, 0.6 - 0.08 * ph);
    e.tx = e.x;
    e.ty = e.y;
    e.aim = a;
    e.atk = (e.na = (e.na || 0) + 1) % BK[i];
    if ((i === 1 && e.atk === 1) || (i === 6 && e.atk === 0)) {
      e.tx = pl.x;
      e.ty = pl.y;
    }
    if ((i === 2 && e.atk === 0) || (i === 7 && ph === 2 && e.atk === 2))
      for (const c of en)
        if (c.t === 30) {
          c.tele = e.tele;
          c.aim = Math.atan2(pl.y - c.y, pl.x - c.x);
          c.tx = c.x;
          c.ty = c.y;
        }
  }
}
const BN_OLD = 0;
// 功能：處理「mvB」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function mvB(e, x, y) {
  const r = e.r;
  e.r = 16;
  const b = mv(e, x, y);
  e.r = r;
  if (b && Math.random() < 0.1) {
    const l = Math.hypot(x, y) || 1;
    hitCell(
      Math.floor((e.x + (x / l) * 24) / T),
      Math.floor((e.y + (y / l) * 24) / T),
    );
  }
  return b;
}
// 功能：處理「beam」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function beam(e, ang, rf) {
  const L = ray(e.x, e.y, ang, 800),
    c = Math.cos(ang),
    s = Math.sin(ang),
    dx = pl.x - e.x,
    dy = pl.y - e.y,
    u = dx * c + dy * s;
  for (let q = 0; q < L; q += 14)
    burst(e.x + c * q, e.y + s * q, e.col, 1, 40, 3, 0.3);
  if (u > 0 && u < L && Math.abs(-dx * s + dy * c) < pl.r + 8) hurt(22);
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
function tLine(x, y, a, L) {
  const l = Math.min(L, ray(x, y, a, L));
  cx.moveTo(x, y);
  cx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
}
// 功能：處理「tCirc」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tCirc(x, y, r) {
  cx.moveTo(x + r, y);
  cx.arc(x, y, r, 0, TAU);
}
// 功能：處理「tFan」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tFan(x, y, a, n, sp, L) {
  for (let q = 0; q < n; q++)
    tLine(x, y, a + (n > 1 ? (q / (n - 1) - 0.5) * sp : 0), L);
}
// 功能：處理「teleBeams」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function teleBeams(s, n) {
  const a = Math.atan2(pl.y - s.y, pl.x - s.x);
  for (let q = 0; q < n; q++)
    tLine(s.x, s.y, a + (q - (n - 1) / 2) * 0.22, 800);
}
// 功能：處理「tTiles」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tTiles() {
  const x0 = Math.round(pl.x / 70) * 70 - 175,
    y0 = Math.round(pl.y / 70) * 70 - 175;
  cx.rect(x0, y0, 350, 350);
}
// 功能：處理「bossTele」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function bossTele(e) {
  const i = e.t - 14,
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
      const x = pl.x + pl.vx * 0.6,
        y = pl.y + pl.vy * 0.6;
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
        const x = pl.x + (q - (n - 1) / 2) * 70;
        tLine(x, pl.y - 300, Math.PI / 2, 600);
      }
    } else tTiles();
  } else if (i === 5) {
    if (k === 0) tFan(e.x, e.y, A, 5, 0.9, 520);
    else if (k === 1) tCirc(pl.x, pl.y, 60);
    else tCirc(e.x, e.y, R + 40);
  } else if (i === 6) {
    if (k === 0) tCirc(e.x, e.y, 280);
    else if (k === 1) tCirc(pl.x, pl.y, 160);
    else tCirc(pl.x, pl.y, 190);
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
// 功能：繪製或建立「drawBoss」所需的畫面元素。
function drawBoss() {
  const e = en.find(isB);
  if (!e) return;
  if (e.dummy) {
    drawDummyBar(e);
    return;
  }
  const u = HU,
    w = Math.min(W * 0.4, 420),
    x = W / 2 - w / 2,
    y = safeT + 14 * u,
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
  cx.fillRect(x + ((time * 130) % (w + 80)) - 40, y, 26, 12 * u);
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
  cx.fillText("BOSS " + BN[e.t - 14], W / 2, y - 4);
  const sgf = e.vul > 0 ? 1 : Math.min(1, (e.sg || 0) / (e.mhp * 0.12));
  cx.fillStyle = "#05060dcc";
  cx.fillRect(x, y + 12 * u + 4, w, 5 * u);
  cx.fillStyle = e.vul > 0 ? "#ffffff" : "#ffe14a";
  cx.fillRect(x, y + 12 * u + 4, w * sgf, 5 * u);
  if (e.vul > 0) {
    cx.fillStyle = "#ffe14a";
    cx.textBaseline = "top";
    cx.fillText("BREAK!", W / 2, y + 20 * u);
  }
}
// 功能：處理「chg」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function chg(e, dt, d, a) {
  const E = e.el;
  if (e.dash > 0) {
    e.dash -= dt;
    let c = Math.cos(e.aim),
      s = Math.sin(e.aim);
    if (mv(e, c * (E ? 340 : 300) * dt, s * (E ? 340 : 300) * dt)) {
      const cx0 = Math.floor((e.x + c * (e.r + 6)) / T),
        cy0 = Math.floor((e.y + s * (e.r + 6)) / T);
      if (E && !e.bn && e.dash > 0.05) {
        e.bn = 1;
        const bx = blocked(e.x + c * 8, e.y, e.r),
          by = blocked(e.x, e.y + s * 8, e.r);
        if (bx) c = -c;
        if (by) s = -s;
        if (!bx && !by) {
          c = -c;
          s = -s;
        }
        e.aim = Math.atan2(s, c);
        burst(e.x, e.y, EL_COL, 10, 200, 2, 0.3);
      } else e.dash = 0;
      hitCell(cx0, cy0);
    }
    burst(e.x, e.y, e.col, 1, 30, 3, 0.25);
    if (e.dash <= 0) {
      e.rec = E ? 0.7 : 0.9;
      if (E)
        zones.push({
          k: "slowz",
          x: e.x,
          y: e.y,
          r: 60,
          t: 1.2,
          max: 1.2,
          col: e.col,
        });
    }
  } else if (e.tele > 0) {
    e.tele -= dt;
    if (E) {
      if (Math.random() < 0.3) burst(e.x, e.y, EL_COL, 1, 60, 2, 0.3);
      for (const o of en) {
        if (o === e || o.hp <= 0 || isB(o) || o.t >= 30 || o.dummy) continue;
        const ox = e.x - o.x,
          oy = e.y - o.y,
          od = Math.hypot(ox, oy);
        if (od < 240 && od > e.r + o.r + 10)
          mv(o, (ox / od) * 110 * dt, (oy / od) * 110 * dt);
      }
    }
    if (e.tele <= 0) {
      e.dash = E ? 0.55 : 0.5;
      e.bn = 0;
    }
  } else {
    const na = nav(e, a, d);
    mv(e, Math.cos(na) * e.sp * dt, Math.sin(na) * e.sp * dt);
    e.cd -= dt;
    if (e.cd <= 0 && d < (E ? 450 : 420) && ray(e.x, e.y, a, d) >= d - 6) {
      e.cd = E ? 2 + Math.random() * 0.8 : 2.4 + Math.random();
      e.tele = E ? 0.35 : 0.45;
      e.aim = a;
      e.tx = e.x;
      e.ty = e.y;
    }
  }
  if (d < e.r + pl.r + 2 && e.cc <= 0 && pl.dashT <= 0) {
    hurt(e.dash > 0 ? (E ? 28 : 22) : E ? 16 : 12);
    e.cc = 0.7;
  }
}

// 功能：處理「mineBoom」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function mineBoom(z) {
  explode({
    x: z.x,
    y: z.y,
    ex: z.r,
    dmg: z.dmg,
    kb: z.kb || 300,
    wd: z.wd === undefined ? 2 : z.wd,
    col: z.col,
    soft: 1,
    cw: z.ult ? undefined : z.wi,
    bu: z.bu,
    fr: z.fr,
    fz4: z.fz4,
    lk: z.lk,
    ch: z.ch,
  });
  z.t = 0;
}
// 功能：處理「zoneParticle」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function zoneParticle(z, k, col) {
  if (pt.length >= 700) return;
  const n =
    k === "ice" ? 5 + ((Math.random() * 5) | 0) : 1 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n && pt.length < 700; i++) {
    const a = Math.random() * TAU,
      r = z.r * Math.sqrt(Math.random()),
      ice = k === "ice",
      life = ice ? 0.55 + Math.random() * 0.55 : 0.09 + Math.random() * 0.09;
    pt.push({
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
// 功能：處理「thr」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function thr(z, x0, y0, d) {
  if (z.k === "bomb") {
    z.t = Math.max(0.3, z.t - d);
    z.max = z.t;
  }
  z.th = { x0, y0, t: d, max: d };
  return z;
}
let TS = null;
// 更新地面區域（炸彈倒數、牽引力場等）
function updZ(dt) {
  for (const z of zones) {
    if (z.th && z.th.t > 0) {
      z.th.t -= dt;
      if (z.th.t <= 0) {
        burst(z.x, z.y, z.col, 10, 140, 2, 0.35);
        if (z.bnc) {
          z.bnc = 0;
          const a =
              Math.atan2(pl.y - z.y, pl.x - z.x) + (Math.random() - 0.5) * 1.4,
            nx = z.x + Math.cos(a) * 55,
            ny = z.y + Math.sin(a) * 55;
          z.th = { x0: z.x, y0: z.y, t: 0.3, max: 0.3 };
          if (!blocked(nx, ny, 8)) {
            z.x = nx;
            z.y = ny;
          }
        }
      }
      continue;
    }
    z.t -= dt;
    if (z.k === "bomb" && z.t <= 0 && !z.td) {
      z.td = 1;
      for (const o of zones)
        if (
          o.k === "tur" &&
          o.hp > 0 &&
          Math.hypot(o.x - z.x, o.y - z.y) < z.r + 13
        )
          o.hp -= z.dmg;
    }
    if (z.grow) z.r += z.grow * dt;
    if (z.k === "flame") {
      if (
        z.t > 0 &&
        Math.hypot(pl.x - z.x, pl.y - z.y) < z.r + pl.r &&
        pl.dashT <= 0 &&
        pl.flT !== time &&
        state === "play" &&
        !(train && god)
      ) {
        pl.flT = time;
        let q = z.dps * dt * (CHR.dr || 1);
        if (pl.sh > 0) {
          const a = Math.min(pl.sh, q);
          pl.sh -= a;
          q -= a;
        }
        pl.hp -= q;
        pl.hf = 0.1;
        if (pl.hp <= 0) {
          pl.hp = 0.1;
          hurt(5);
        }
      }
      continue;
    }
    if (z.k === "slowz") {
      if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r && pl.dashT <= 0) {
        pl.slow = Math.max(pl.slow, 0.35);
        if (z.trg && !z.fd) {
          z.fd = 1;
          z.t = Math.min(z.t, 0.4);
          if (z.trg === 1)
            zones.push({
              k: "bomb",
              x: z.x,
              y: z.y,
              r: 60,
              t: 0.35,
              max: 0.35,
              col: "#ff8a3a",
              dmg: 18,
            });
          else {
            pl.slowL = 2;
            pl.slow = 2.6;
            burst(z.x, z.y, z.col, 12, 140, 2, 0.4);
          }
        }
        if (z.dps && !(train && god)) {
          pl.hp -= z.dps * dt * (CHR.dr || 1);
          if (pl.hp <= 0) {
            pl.hp = 0.1;
            hurt(5);
          }
        }
      }
    } else if (z.k === "web") {
      for (const e of en)
        if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r) {
          e.wb = 0.25;
          if (z.wi !== undefined) chgU(z.wi, 3 * dt);
          chipTick(e, dt, z, 0);
        }
      for (const b of bl)
        if (!b.own && b.life > 0 && Math.hypot(b.x - z.x, b.y - z.y) < z.r) {
          if (!b.sp0) b.sp0 = Math.hypot(b.vx, b.vy);
          const sp = Math.hypot(b.vx, b.vy) || 1,
            m = b.sp0 * 0.3;
          if (sp > m) {
            b.vx *= m / sp;
            b.vy *= m / sp;
          }
          b.inweb = time;
        }
    } else if (z.k === "storm") {
      z.x = pl.x;
      z.y = pl.y;
      z.fxT = (z.fxT || 0) - dt;
      if (z.fxT <= 0) {
        z.fxT = 0.24;
        zoneParticle(z, "ice", Math.random() < 0.5 ? "#ffe14a" : "#fff4a6");
      }
      for (const e of en)
        if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r) {
          e.fv = (e.fv || 0) + dt * 5;
          if (e.fv >= 6) frz(e);
        }
    } else if (z.k === "cloud") {
      z.fxT = (z.fxT || 0) - dt;
      if (z.fxT <= 0) {
        z.fxT = 0.06;
        zoneParticle(z, "elec", "#ffe14a");
        if (Math.random() < 0.7) zoneParticle(z, "elec", "#fff4a6");
      }
      z.am = (z.am || 0) - dt;
      if (z.am <= 0) {
        z.am = 0.3 + Math.random() * 0.3;
        cloudSpark(z);
      }
      z.sk = (z.sk || 0) - dt;
      if (z.sk <= 0) {
        z.sk = 1 + Math.random() * 0.8;
        cloudSky(z);
      }
      z.nx = (z.nx || 0) - dt;
      if (z.nx <= 0) {
        z.nx = 0.3;
        const c = en.filter(
          (e) => e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r,
        );
        if (c.length) {
          const e = c[(Math.random() * c.length) | 0];
          strikeFx(e);
          if (!isB(e)) e.stn = Math.max(e.stn || 0, 0.8);
          {
            const d0 = dm(e, 35 * dmM() * (z.dm || 1));
            e.hp -= d0;
            chipHit(e, d0, z);
          }
          e.hf = 1;
          burst(e.x, e.y, "#ffe14a", 8, 160, 2, 0.3);
          if (e.hp <= 0) kill(e);
        }
      }
    } else if (z.k === "portal") {
      if ((pl.pT || 0) < time && Math.hypot(pl.x - z.x, pl.y - z.y) < z.r) {
        pl.x = z.o.x;
        pl.y = z.o.y;
        pl.pT = time + 1;
        burst(pl.x, pl.y, z.o.col, 14, 160, 2, 0.4);
      }
      for (const b of bl) {
        if ((b.pT || 0) >= time || Math.hypot(b.x - z.x, b.y - z.y) >= z.r)
          continue;
        const sp = Math.hypot(b.vx, b.vy) || 1;
        b.x = z.o.x + (b.vx / sp) * (z.r + 6);
        b.y = z.o.y + (b.vy / sp) * (z.r + 6);
        b.pT = time + 0.3;
      }
    } else if (z.k === "gpull") {
      gpTick(z, dt);
      for (const e of en)
        if (e.hp > 0 && !isB(e)) {
          const dx = z.x - e.x,
            dy = z.y - e.y,
            d = Math.hypot(dx, dy);
          if (d < z.r && d > 6) {
            MVF = 1;
            mv(e, (dx / d) * 110 * dt, (dy / d) * 110 * dt);
            MVF = 0;
          }
        }
      if (z.ult)
        for (const b of bl) {
          if (!b.own || b.life <= 0) continue;
          const dx = z.x - b.x,
            dy = z.y - b.y,
            d = Math.hypot(dx, dy);
          if (d < z.r && d > 5) {
            const f = 900;
            b.vx += (dx / d) * f * dt;
            b.vy += (dy / d) * f * dt;
          }
        }
    } else if (z.k === "mine") {
      let go = false;
      if (z.fuse !== undefined) {
        z.fuse -= dt;
        go = z.fuse <= 0;
      } else if (z.arm > 0) z.arm -= dt;
      else
        for (const e of en)
          if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.7 + e.r) {
            go = true;
            break;
          }
      if (go) mineBoom(z);
    } else if (z.k === "tur") {
      if (z.hp <= 0 && z.t > 0) {
        z.t = 0;
        burst(z.x, z.y, z.col, 16, 220, 3, 0.5);
        shake = Math.max(shake, 3);
      }
      for (const e of en) {
        if (
          e.hp > 0 &&
          Math.hypot(e.x - z.x, e.y - z.y) < e.r + (z.r || 14) + 1
        )
          z.hp -= (8 + wave * 0.4) * dt;
      }
      z.cd -= dt;
      let tb = null,
        td = 1e9;
      for (const e of en) {
        if (e.hp <= 0) continue;
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (
          d < z.rg + e.r &&
          d < td &&
          ray(z.x, z.y, Math.atan2(e.y - z.y, e.x - z.x), d) >= d - e.r - 6
        ) {
          td = d;
          tb = e;
        }
      }
      if (tb) {
        z.ang = Math.atan2(tb.y - z.y, tb.x - z.x);
        if (z.cd <= 0) {
          z.cd = z.fi;
          if (z.big) {
            const lt = 0.6,
              px = Math.max(20, Math.min(MW - 20, tb.x + (tb.mvx || 0) * lt)),
              py = Math.max(20, Math.min(MW - 20, tb.y + (tb.mvy || 0) * lt));
            zones.push(
              thr(
                {
                  k: "gren",
                  x: px,
                  y: py,
                  r: z.br,
                  t: 0.5,
                  max: 0.5,
                  col: z.col,
                  dmg: z.gd,
                  kb: 500,
                  wd: 2,
                  ult: 1,
                  ...zfl(z.w),
                },
                z.x,
                z.y,
                0.45,
              ),
            );
            burst(z.x, z.y, z.col, 10, 160, 2.5, 0.3);
            shake = Math.max(shake, 3);
          } else {
            const n0 = bl.length,
              tn = Math.max(1, z.w.n1 || 1);
            for (let k = 0; k < tn; k++)
              wBul(
                z.w,
                z.x + Math.cos(z.ang) * 14,
                z.y + Math.sin(z.ang) * 14,
                z.ang +
                  (tn > 1
                    ? (k / (tn - 1) - 0.5) * Math.max(0.1, z.w.sp || 0)
                    : 0),
                z.dmul,
              );
            if (z.ult) for (let q = n0; q < bl.length; q++) bl[q].ult = 1;
          }
        }
      }
    } else if (z.k === "tox") {
      z.nx = (z.nx || 0) - dt;
      const dps = z.dmg / z.max;
      z.cht = (z.cht || 0) - dt;
      if (z.ch && z.cht <= 0) {
        z.cht = 0.4;
        chainZone(z, dps * 0.4);
      }
      for (const e of en) {
        if (e.hp > 0 && Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r * 0.5) {
          const dd = dm(e, dps * dt);
          e.hp -= dd;
          if (!z.ult) chgU(z.wi, dd * 0.12);
          chipTick(e, dt, z, dd);
          if (e.hp <= 0) kill(e);
        }
      }
      if (z.nx <= 0) {
        z.nx = 0.2;
        burst(
          z.x + (Math.random() - 0.5) * z.r * 1.4,
          z.y + (Math.random() - 0.5) * z.r * 1.4,
          z.col,
          1,
          25,
          3,
          0.7,
        );
      }
    } else if (z.k === "gren") {
      if (z.t <= 0)
        explode({
          x: z.x,
          y: z.y,
          ex: z.r,
          dmg: z.dmg,
          kb: z.kb,
          wd: z.wd,
          col: z.col,
          bu: z.bu,
          fr: z.fr,
          fz4: z.fz4,
          lk: z.lk,
          ch: z.ch,
        });
    } else if (z.k === "pull") {
      const dx = z.x - pl.x,
        dy = z.y - pl.y,
        d = Math.hypot(dx, dy),
        E = z.el;
      if (d < z.r && d > 8 && pl.dashT <= 0) {
        const k = (E ? 150 : 120) * (1 - ((E ? 0.35 : 0.4) * d) / z.r),
          cp = E ? 50 : 55;
        pl.pvx += (dx / d) * k * dt;
        pl.pvy += (dy / d) * k * dt;
        const sp = Math.hypot(pl.pvx, pl.pvy);
        if (sp > cp) {
          pl.pvx *= cp / sp;
          pl.pvy *= cp / sp;
        }
      }
      if (E) {
        if (d < z.r && pl.dashT <= 0 && state === "play" && !(train && god)) {
          pl.hp -= z.dps * dt * (CHR.dr || 1);
          if (pl.hp <= 0) {
            pl.hp = 0.1;
            hurt(5);
          }
        }
        if (z.t <= 0 && !z.bst) {
          z.bst = 1;
          burst(z.x, z.y, z.col, 30, 300, 3, 0.6);
          fxs.push({
            k: "w",
            x: z.x,
            y: z.y,
            r: z.r,
            t: 0.4,
            max: 0.4,
            col: z.col,
          });
          shake = Math.max(shake, 6);
          if (d < z.r + pl.r && pl.dashT <= 0) {
            hurt(10);
            const a = Math.atan2(pl.y - z.y, pl.x - z.x);
            pl.pvx = Math.cos(a) * 200;
            pl.pvy = Math.sin(a) * 200;
          }
        }
      }
    } else if (z.t <= 0) {
      burst(z.x, z.y, z.col, 30, 300, 3, 0.6);
      burst(z.x, z.y, "#ffffff", 10, 200, 2, 0.3);
      shake = Math.max(shake, 9);
      if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r + pl.r) hurt(z.dmg);
      for (
        let j = Math.floor((z.y - z.r) / T);
        j <= Math.floor((z.y + z.r) / T);
        j++
      )
        for (
          let i = Math.floor((z.x - z.r) / T);
          i <= Math.floor((z.x + z.r) / T);
          i++
        )
          if (Math.hypot((i + 0.5) * T - z.x, (j + 0.5) * T - z.y) < z.r + 10)
            hitCell(i, j);
    }
  }
  zones = zones.filter((z) => z.t > 0);
}
let pendEn = [];
// 敵人死亡：加分、掉落、特效
function kill(e) {
  if (e.dk) return;
  e.dk = 1;
  if (CHR.kh) pl.hp = Math.min(pl.mhp, pl.hp + CHR.kh);
  if (isB(e)) {
    BK2 = 1;
    for (const c of en) if (c.t === 30 || c.t === 31 || c.bee) c.hp = 0;
    zones = zones.filter((z) => z.k !== "portal" && z.k !== "slowz");
    for (let k = 0; k < 8; k++) cur("coin", e.x, e.y, 4);
    for (let k = 0; k < 3; k++) cur("core", e.x, e.y, 1);
    for (let k = 0; k < 5; k++) cur("shard", e.x, e.y, 2);
    if (Math.random() < 0.22) cur("chip", e.x, e.y, rollChip(1));
    bossDeath(e);
    shake = 20;
    burst(e.x, e.y, e.col, 90, 420, 6, 1);
    flash("#ffffff", 0.7, 0.8);
    fxs.push(
      { k: "w", x: e.x, y: e.y, r: 600, t: 0.9, max: 0.9, col: e.col },
      {
        k: "w",
        x: e.x,
        y: e.y,
        r: 380,
        t: 0.6,
        max: 0.6,
        col: "#ffffff",
      },
    );
  }
  if (e.t === 12 && (e.gen || 0) < 2) {
    const g = (e.gen || 0) + 1,
      L = e.el ? 3 : 2,
      ph = Math.random() * TAU;
    for (let k = 0; k < L; k++) {
      const aa = e.el ? ph + (k / L) * TAU : k ? 0 : Math.PI,
        m = mkEn(
          12,
          e.x + (e.el ? Math.cos(aa) * 18 : k ? 16 : -16),
          e.y + (e.el ? Math.sin(aa) * 18 : 0),
        );
      m.gen = g;
      m.r = (e.el ? [20, 12, 8] : [20, 13, 9])[g] * (e.el ? 1.2 : 1);
      m.hp = m.mhp = e.mhp * (e.el ? [0, 0.3, 0.35] : [0, 0.4, 0.45])[g];
      m.sc = [300, 120, 50][g];
      m.sp *= 1 + (e.el ? 0.35 : 0.3) * g;
      if (e.el) {
        m.el = 1;
        m.m *= 1.6;
        m.kx = Math.cos(aa) * 220;
        m.ky = Math.sin(aa) * 220;
      } else {
        m.kx = (k ? 1 : -1) * 220;
        m.ky = 0;
      }
      m.rec = 0.25;
      m.inv = 0.4;
      if (!blocked(m.x, m.y, m.r)) pendEn.push(m);
    }
    burst(e.x, e.y, e.col, 18, 220, 3, 0.4);
    if (e.el) {
      fxs.push({
        k: "w",
        x: e.x,
        y: e.y,
        r: 130,
        t: 0.35,
        max: 0.35,
        col: EL_COL,
      });
      burst(e.x, e.y, EL_COL, 22, 260, 3, 0.45);
      const dx = pl.x - e.x,
        dy = pl.y - e.y,
        dd = Math.hypot(dx, dy) || 1;
      if (dd < 130 && pl.dashT <= 0) {
        const v = 170 * (1 - dd / 130) + 40;
        pl.pvx += (dx / dd) * v;
        pl.pvy += (dy / dd) * v;
      }
    }
  }
  score += e.sc;
  pts += Math.round(e.sc / 8);
  burst(e.x, e.y, e.col, 24, 280, 3, 0.7);
  if (e.el) {
    const sm = (e.gen || 0) > 0;
    burst(e.x, e.y, EL_COL, sm ? 10 : 50, sm ? 220 : 380, sm ? 2.5 : 4.5, 0.8);
    if (!sm) {
      burst(e.x, e.y, "#ffffff", 14, 260, 2.5, 0.5);
      fxs.push(
        {
          k: "w",
          x: e.x,
          y: e.y,
          r: 230,
          t: 0.55,
          max: 0.55,
          col: EL_COL,
        },
        {
          k: "w",
          x: e.x,
          y: e.y,
          r: 150,
          t: 0.4,
          max: 0.4,
          col: "#ffffff",
        },
        {
          k: "w",
          x: e.x,
          y: e.y,
          r: 80,
          t: 0.28,
          max: 0.28,
          col: EL_COL,
        },
      );
      shake = Math.max(shake, 11);
      flash(EL_COL, 0.15, 0.2);
    }
  }
  shake = Math.max(shake, 5);
  drop(e.x, e.y, 0.35);
  coin(
    e.x,
    e.y,
    Math.max(
      1,
      Math.round(
        (e.sc / 50) * (1 + 0.1 * UL("gold")) * (1 + wave * 0.05) * ST().cm,
      ),
    ),
  );
  if (e.sc >= 250 && Math.random() < 0.3) cur("core", e.x, e.y, 1);
  if (e.sc >= 250 && Math.random() < 0.015) cur("chip", e.x, e.y, rollChip(0));
  if (Math.random() < 0.2) cur("shard", e.x, e.y, 1);
  if (isB(e)) {
    vacAll();
    BK2 = 0;
  }
}
// 整體模擬一步（dt 秒）
function update(dt) {
  if (pendEn.length) {
    for (const m of pendEn) en.push(m);
    pendEn.length = 0;
  }
  time += dt;
  HF = Math.max(0, HF - dt * 1.8);
  bossIn = Math.max(0, bossIn - dt);
  ptxt = Math.max(0, ptxt - dt);
  if (FL) {
    FL.t -= dt;
    if (FL.t <= 0) FL = null;
  }
  const BB = en.find((e) => isB(e) && !e.dummy);
  if (BB) bcol = BB.col;
  if (BB && state === "play") {
    const hf = BB.hp / BB.mhp;
    if (hf < 0.35 && Math.random() < dt * 1.3)
      fxs.push({
        k: "w",
        x: BB.x,
        y: BB.y,
        r: BB.r * 3.2,
        t: 0.8,
        max: 0.8,
        col: "#ff4a4a",
      });
    if (Math.hypot(BB.mvx || 0, BB.mvy || 0) > 170 && pt.length < 480)
      pt.push({
        x: BB.x,
        y: BB.y,
        vx: 0,
        vy: 0,
        life: 0.28,
        max: 0.28,
        col: BB.col,
        sz: BB.r * 0.85,
      });
  }
  bti += ((BB ? 1 : 0) - bti) * Math.min(1, dt * 2);
  if (BB && state === "play" && pt.length < 500 && Math.random() < 0.7)
    pt.push({
      x: camx + (Math.random() * W) / S,
      y: camy + (Math.random() * H) / S,
      vx: (Math.random() - 0.5) * 40,
      vy: -30 - Math.random() * 50,
      life: 2.4,
      max: 2.4,
      col: BB.col,
      sz: 1.5 + Math.random() * 3,
    });
  shake = Math.max(0, shake - dt * 40);
  if (state === "play") {
    updPl(dt);
    pl.avx =
      (pl.avx || 0) + ((pl.vx || 0) - (pl.avx || 0)) * Math.min(1, dt * 5);
    pl.avy =
      (pl.avy || 0) + ((pl.vy || 0) - (pl.avy || 0)) * Math.min(1, dt * 5);
    for (let i = SQ.length - 1; i >= 0; i--) {
      const s = SQ[i];
      s.t -= dt;
      if (s.t <= 0) {
        SQ.splice(i, 1);
        s.fn();
      }
    }
    for (const f of fxs) f.t -= dt;
    fxs = fxs.filter((f) => f.t > 0);
    fT -= dt;
    if (fT <= 0) {
      fT = 0.25;
      flow();
    }
    for (const e of en) {
      if (e.inv > 0) e.inv -= dt;
      if (e.bu > 0) {
        e.bu -= dt;
        e.hp -= dm(e, 10 * dt);
        if (Math.random() < 0.3) burst(e.x, e.y, "#ff7a3d", 1, 40, 2, 0.3);
        if (e.hp <= 0) kill(e);
      }
      if (e.fr > 0) {
        e.fr -= dt;
        if (Math.random() < 0.2) burst(e.x, e.y, "#7af0ff", 1, 30, 2, 0.3);
      }
      if (e.wb > 0) e.wb -= dt;
      if (e.frz > 0) e.frz -= dt;
      if (e.inv > 0) e.inv -= dt;
      if (e.fv > 0) e.fv = Math.max(0, e.fv - dt * 0.6);
      if (e.cgt > 0) {
        e.cgt -= dt;
        if (e.cgt <= 0) e.cg = 0;
      }
      if (e.root > 0) {
        e.root -= dt;
        if (Math.random() < 0.2) burst(e.x, e.y, "#c0a060", 1, 20, 2, 0.3);
      }
      if (e.stn > 0) {
        e.stn -= dt;
        if (Math.random() < 0.3) burst(e.x, e.y, "#ffe14a", 1, 40, 2, 0.3);
      } else if (!(train && fz) && !e.dummy) {
        const ft = isB(e) || e.t >= 30 ? null : fTarget(e),
          real = pl;
        if (ft) {
          pl = Object.create(real);
          pl.x = ft.x;
          pl.y = ft.y;
          pl.vx = 0;
          pl.vy = 0;
        }
        try {
          updEn(
            e,
            dt * (e.fr > 0 ? 0.55 : 1) * (e.wb > 0 ? (isB(e) ? 0.7 : 0.35) : 1),
          );
          dodge(e, dt);
          aiExtra(e, dt);
        } finally {
          pl = real;
        }
      }
      if (dt > 0) {
        e.mvx = ((e.x - e.px) / dt) * 0.3 + e.mvx * 0.7;
        e.mvy = ((e.y - e.py) / dt) * 0.3 + e.mvy * 0.7;
      }
      e.px = e.x;
      e.py = e.y;
      if (e.kx || e.ky) {
        MVF = 1;
        mv(e, e.kx * dt, e.ky * dt);
        MVF = 0;
        const f = Math.pow(0.0025, dt);
        e.kx *= f;
        e.ky *= f;
      }
    }
    for (let i = 0; i < en.length; i++)
      for (let j = i + 1; j < en.length; j++) {
        const a = en[i],
          b = en[j],
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy),
          m = a.r + b.r;
        const ms = isB(a) || isB(b) ? m : m * 1.35;
        if (d < ms && d > 0) {
          const k = ((ms - d) / 2 / d) * (d < m ? 1 : 0.1);
          mv(a, -dx * k, -dy * k);
          mv(b, dx * k, dy * k);
        }
      }
    for (const b of bl) {
      if (b.sp0 && b.inweb !== undefined && b.inweb < time - 0.05) {
        const s0 = Math.hypot(b.vx, b.vy) || 1;
        b.vx *= b.sp0 / s0;
        b.vy *= b.sp0 / s0;
        b.inweb = undefined;
      }
      if (b.hm) home(b, dt);
      if (b.hm2) homeP(b, dt);
      if (b.acc && !b.acd && Math.hypot(pl.x - b.x, pl.y - b.y) < 150) {
        b.acd = 1;
        b.vx *= 1.5;
        b.vy *= 1.5;
      }
      if (b.spl && b.age > 1 && b.life > 0) {
        b.life = 0;
        const a1 = Math.atan2(b.vy, b.vx),
          s1 = Math.hypot(b.vx, b.vy);
        for (const sg of [-0.5, 0.5])
          bl.push({
            eff: 2,
            hm2: true,
            hr: 1.4,
            x: b.x,
            y: b.y,
            vx: Math.cos(a1 + sg) * s1,
            vy: Math.sin(a1 + sg) * s1,
            r: 4,
            own: 0,
            dmg: 8,
            life: 2.5,
            col: "#e04dff",
          });
        burst(b.x, b.y, EL_COL, 8, 120, 2, 0.3);
      }
      if (b.bm) boom(b, dt);
      if (b.life <= 0) continue;
      const px0 = b.x,
        py0 = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (!(b.bm && b.t2 && b.returnSlow)) b.life -= dt;
      b.age = (b.age || 0) + dt;
      if (b.fl && b.l0)
        b.r = (b.r0 || (b.r0 = b.r)) * (1 + 2 * Math.min(1, b.age / b.l0));
      let i = Math.floor(b.x / T),
        j = Math.floor(b.y / T),
        v = cell(i, j);
      if (!(b.bm && b.t2)) {
        if (v === 0) {
          const sw = seamHit(px0, py0, b.x, b.y);
          if (sw) {
            b.x = sw[0];
            b.y = sw[1];
            i = sw[2];
            j = sw[3];
            v = cell(i, j);
          }
        } else if (!b.pierce && !b.sn && !b.bm && !(b.bn > 0) && !(b.pw > 0)) {
          const ddx = b.x - px0,
            ddy = b.y - py0,
            LL = Math.hypot(ddx, ddy);
          if (
            LL > 1e-6 &&
            cell(Math.floor(px0 / T), Math.floor(py0 / T)) === 0
          ) {
            const tt = rayK(px0, py0, Math.atan2(ddy, ddx), LL, 0);
            if (tt < LL) {
              const qx = px0 + (ddx / LL) * (tt + 0.05),
                qy = py0 + (ddy / LL) * (tt + 0.05),
                qi = Math.floor(qx / T),
                qj = Math.floor(qy / T);
              if (cell(qi, qj) !== 0) {
                b.x = qx;
                b.y = qy;
                i = qi;
                j = qj;
                v = cell(i, j);
              }
            }
          }
        }
      }
      if (v !== 0 && b.bm && !b.t2) {
        if (v > 0) hitCell(i, j, b.ult ? 5 : 3);
        const ox = b.x - b.vx * dt,
          oy = b.y - b.vy * dt;
        b.x = ox;
        b.y = oy;
        if (b.t2 !== 1) {
          b.t2 = 1;
          b.hit.length = 0;
          b.life = 12;
          b.returnSlow = 1;
          b.vx = -b.vx;
          b.vy = -b.vy;
        } else {
          b.vx = -b.vx;
          b.vy = -b.vy;
        }
        const bs = Math.hypot(b.vx, b.vy) || 1;
        b.spd0 = b.spd0 || bs;
        b.vx = (b.vx / bs) * b.spd0;
        b.vy = (b.vy / bs) * b.spd0;
        continue;
      }
      if (b.bm && b.t2 && v > 0) {
        const key = j * N + i;
        if (!b.hit.includes(key)) {
          hitCell(i, j, b.ult ? 5 : 3);
          b.hit.push(key);
        }
      }
      if (v !== 0 && b.bn > 0) {
        b.bn--;
        const ox = b.x - b.vx * dt,
          oy = b.y - b.vy * dt;
        if (v > 0) hitCell(i, j, 1);
        if (cell(i, Math.floor(oy / T)) === 0) b.vy = -b.vy;
        else if (cell(Math.floor(ox / T), j) === 0) b.vx = -b.vx;
        else {
          b.vx = -b.vx;
          b.vy = -b.vy;
        }
        b.x = ox;
        b.y = oy;
        continue;
      }
      if (b.pw > 0 && v !== 0) b.pwin = 1;
      else if (b.pwin && v === 0) {
        b.pw--;
        b.pwin = 0;
      }
      if (!(b.bm && b.t2) && !(b.pw > 0 && v !== 0)) {
        if (v < 0 && !b.sn) {
          b.life = 0;
          burst(b.x, b.y, "#b45cff", 4, 100, 2, 0.25);
        } else if (v > 0) {
          const wn =
            b.wd === undefined
              ? 1
              : Math.floor(b.wd) + (Math.random() < b.wd % 1 ? 1 : 0);
          if (b.pierce) {
            if (b.lc !== j * N + i) {
              b.lc = j * N + i;
              hitCell(i, j, wn);
            }
          } else {
            hitCell(i, j, wn);
            b.life = 0;
          }
        }
      }
      if (b.life <= 0) continue;
      if (b.own) {
        for (const e of en) {
          if (e.hp <= 0 || ((b.pierce || b.pe) && b.hit.includes(e))) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + (b.bm ? BMR(b) : b.r)) {
            const dd = dm(e, b.dmg, Math.atan2(b.y - e.y, b.x - e.x));
            e.hp -= dd;
            e.hf = dd > 0 ? 1 : 0;
            {
              const n = Math.hypot(b.vx, b.vy) || 1;
              e.kx += ((b.vx / n) * b.kb) / e.m;
              e.ky += ((b.vy / n) * b.kb) / e.m;
            }
            if (b.ch) {
              let t2 = null,
                bd = 140;
              for (const o of en)
                if (o !== e && o.hp > 0) {
                  const d2 = Math.hypot(o.x - e.x, o.y - e.y);
                  if (d2 < bd) {
                    bd = d2;
                    t2 = o;
                  }
                }
              if (t2) {
                t2.hp -= dm(t2, b.dmg * 0.5);
                t2.hf = 1;
                fxs.push({
                  k: "l",
                  x: e.x,
                  y: e.y,
                  a: Math.atan2(t2.y - e.y, t2.x - e.x),
                  len: bd,
                  t: 0.15,
                  max: 0.15,
                  col: "#7ab8ff",
                });
                if (t2.hp <= 0) kill(t2);
              }
            }
            if (b.xb)
              explode({
                x: b.x,
                y: b.y,
                ex: 48,
                dmg: b.dmg * 0.35,
                kb: 120,
                wd: 0,
                col: b.col || "#ffb040",
              });
            if (b.bu) e.bu = 3;
            if (b.fr) e.fr = 2;
            if (b.lk && pl.hp < pl.mhp)
              pl.hp = Math.min(pl.mhp, pl.hp + Math.min(2, b.dmg * 0.025));
            if (b.fz4) {
              e.fv = (e.fv || 0) + 1;
              e.fr = 1.2;
              if (e.fv >= 6) frz(e);
            }
            if (b.cg) {
              e.cg = (e.cg || 0) + 1;
              e.cgt = 6;
              if (e.cg >= 3) detonate(e);
              else chgHit(e);
            }
            if (!b.ult) chgU(b.wi, b.dmg * 0.25);
            if (dd > 0) {
              burst(b.x, b.y, e.col, 6, 160, 2, 0.3);
              if (isB(e) && Math.random() < 0.5)
                burst(b.x, b.y, "#ffffff", 4, 260, 1.6, 0.25);
            } else burst(b.x, b.y, "#9aa0ab", 10, 200, 2, 0.35);
            shake = Math.max(shake, 2.5);
            if (e.hp <= 0) kill(e);
            if (b.pierce || b.pe) b.hit.push(e);
            else {
              b.life = 0;
              break;
            }
          }
        }
      } else if (
        pl.dashT <= 0 &&
        Math.hypot(pl.x - b.x, pl.y - b.y) < pl.r + b.r
      ) {
        b.life = 0;
        hurt(b.dmg);
        if (b.eff === 1) pl.slow = 2.2;
        if (b.eff === 3) {
          pl.slowL = pl.slow > 0 ? Math.min(2, (pl.slowL || 1) + 1) : 1;
          pl.slow = 2.6;
          burst(pl.x, pl.y, "#bfefff", 8, 120, 2, 0.4);
          if (b.efz) {
            zones.push({
              k: "slowz",
              x: b.x,
              y: b.y,
              r: 55,
              t: 1.5,
              max: 1.5,
              col: "#bfefff",
            });
            fxs.push({
              k: "w",
              x: b.x,
              y: b.y,
              r: 55,
              t: 0.35,
              max: 0.35,
              col: "#bfefff",
            });
          }
        }
      }
    }
    for (const z of zones)
      if (z.k === "tur" && z.hp > 0 && !(z.th && z.th.t > 0))
        for (const b of bl)
          if (
            !b.own &&
            b.life > 0 &&
            Math.hypot(b.x - z.x, b.y - z.y) < (z.r || 14) - 1 + b.r
          ) {
            z.hp -= b.dmg;
            b.life = 0;
            burst(b.x, b.y, "#ff6a6a", 3, 80, 2, 0.25);
          }
    for (const b of bl)
      if (b.life <= 0) {
        if (b.ex) explode(b);
        else if (b.cs) frag(b);
        else if (b.gp) {
          const gk =
            Math.min(1.5, Math.sqrt((b.r || 7) / 7)) * (b.xb ? 1.25 : 1);
          zones.push({
            k: "gpull",
            x: b.x,
            y: b.y,
            r: 120 * gk,
            t: 1.8,
            max: 1.8,
            col: b.col || "#b0a0ff",
            dps: b.dmg * 0.35,
            bu: b.bu,
            fr: b.fr,
            fz4: b.fz4,
            lk: b.lk,
            ch: b.ch,
            xb: b.xb,
          });
        }
      }
    bl = bl.filter((b) => b.life > 0);
    updLZ(dt);
    en = en.filter((e) => e.hp > 0);
    updZ(dt);
    updEW(dt);
    pkT -= dt;
    if (pkT <= 0) {
      pkT = 7;
      if (pk.filter((q) => PN.includes(q.t)).length < 8) {
        const p = empty(120, pl);
        if (p)
          pk.push({
            x: p.x,
            y: p.y,
            t: PN[(Math.random() * 4) | 0],
            life: 18,
          });
      }
    }
    if (!train && !TUT.on && en.length === 0) {
      waveT -= dt;
      if (waveT <= 0) {
        waveT = 1.8;
        if (ST().g && wave >= ST().g) win();
        else openShop();
      }
    } else waveT = 1.8;
    banner = Math.max(0, banner - dt);
    const tx = Math.max(0, Math.min(MW - W / S, pl.x - W / S / 2)),
      ty = Math.max(0, Math.min(MW - H / S, pl.y - H / S / 2));
    const k = Math.min(1, dt * 10);
    camx += (tx - camx) * k;
    camy += (ty - camy) * k;
    if (W / S >= MW) camx = (MW - W / S) / 2;
    if (H / S >= MW) camy = (MW - H / S) / 2;
  }
  if (state === "over") {
    bl = bl.filter((b) => b.life > 0);
    overT -= dt;
    if (overT <= 0 && !shown) {
      shown = 1;
      showOv(1);
    }
  }
  for (let i = pt.length - 1; i >= 0; i--) {
    const p = pt[i];
    p.life -= dt;
    p.age = (p.age || 0) + dt;
    if (p.life <= 0) {
      pt.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    if (p.k === "ice") p.vy = Math.min(p.vy + 2 * dt, -12);
    else p.vy *= 0.96;
    if (p.f) p.rot += p.vr * dt;
  }
}
// 繪製整個場景（地圖、物件、特效、HUD）
function render() {
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx.fillStyle = "#05060d";
  cx.fillRect(0, 0, W, H);
  const VW = W / S,
    VH = H / S,
    ox = (Math.random() - 0.5) * shake * 0.6,
    oy = (Math.random() - 0.5) * shake * 0.6;
  cx.setTransform(
    DPR * S,
    0,
    0,
    DPR * S,
    -(camx + ox) * DPR * S,
    -(camy + oy) * DPR * S,
  );
  cx.fillStyle = "#080a17";
  cx.fillRect(0, 0, MW, MW);
  if (bti > 0.01) {
    cx.globalAlpha = bti * 0.12;
    cx.fillStyle = bcol;
    cx.fillRect(0, 0, MW, MW);
    cx.globalAlpha = 1;
  }
  const i0 = Math.max(0, Math.floor(camx / T)),
    i1 = Math.min(N - 1, Math.ceil((camx + VW) / T)),
    j0 = Math.max(0, Math.floor(camy / T)),
    j1 = Math.min(N - 1, Math.ceil((camy + VH) / T));
  cx.strokeStyle = bti > 0.05 ? bcol : "rgba(60,200,255,.07)";
  cx.globalAlpha = bti > 0.05 ? 0.09 + 0.05 * Math.sin(time * 3) * bti : 1;
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
      const v = grid[j * N + i];
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
  cx.strokeStyle = bti > 0.05 ? bcol : "#b45cff";
  cx.lineWidth = 3;
  cx.strokeRect(0, 0, MW, MW);
  for (const q of pk) {
    const by = Math.sin(time * 3 + q.x) * 2;
    if (q.life < 4 && Math.floor(time * 8) % 2) continue;
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
      cx.arc(q.x, q.y + by, 14 + Math.sin(time * 5) * 2, 0, TAU);
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
  for (const z of zones) {
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
      cx.arc(z.x, z.y, z.r * (1 + 0.03 * Math.sin(time * 4)), 0, TAU);
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
        rot = time * 2.2;
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
        const ph = (time * (0.35 + ((i * 37) % 10) * 0.05) + i * 0.6180339) % 1,
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
        sh = 0.8 + 0.2 * Math.sin(time * 3 + z.x * 0.01),
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
  for (const z of zones) {
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
  for (const f of fxs) {
    if (f.fp) {
      f.x = pl.x;
      f.y = pl.y;
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
              (q === 14 ? 0 : Math.sin(f.seed * (q + 1) + time * 60) * 22);
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
  for (const e of en)
    if (e.tele > 0) {
      const al = Math.max(
        0.2,
        0.3 +
          0.7 *
            (1 -
              e.tele /
                (isB(e) ? 0.6 : (e.el && ELITE[e.t].tl) || TL[e.t] || 0.45)),
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
      else if (LN.includes(e.t)) {
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
        cx.arc(e.tx, e.ty, (e.el && ELITE[e.t].rg) || RG[e.t] || 30, 0, TAU);
      cx.stroke();
    }
  for (const e of en)
    if (e.lz > 0) {
      const c = Math.cos(e.lza),
        s = Math.sin(e.lza),
        w = Math.min(1, e.lz / 0.15),
        x2 = e.x + c * e.lzL,
        y2 = e.y + s * e.lzL,
        fl = 0.85 + 0.15 * Math.sin(time * 60);
      cx.save();
      cx.globalCompositeOperation = "lighter";
      cx.lineCap = "round";
      cx.beginPath();
      cx.moveTo(e.x, e.y);
      cx.lineTo(x2, y2);
      cx.globalAlpha = 0.4 * w * fl;
      cx.strokeStyle = e.col;
      cx.lineWidth = (pl.r + 10) * 1.6;
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
  for (const g of egh) {
    cx.save();
    cx.globalAlpha = 0.55 * Math.min(1, g.t / 0.3);
    cx.translate(g.x, g.y);
    cx.rotate(Math.atan2(pl.y - g.y, pl.x - g.x));
    cx.shadowColor = g.col;
    cx.shadowBlur = 14;
    icon(cx, "e11", 0, 0, 13, g.col);
    cx.restore();
  }
  for (const e of en)
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
    state === "play" &&
    ((ta.act && Math.hypot(ta.x - ta.sx, ta.y - ta.sy) > CZ) ||
      (mouse.has && !touchOn))
  )
    drawAim();
  if (AA && state === "play") {
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
      cx.moveTo(pl.x, pl.y);
      cx.lineTo(t.x, t.y);
      cx.stroke();
    }
    if (pl.ult >= 100 && !sd) {
      const u = ultT();
      if (u) {
        cx.setLineDash([6, 5]);
        cx.strokeStyle = "#ff4d4d";
        cx.globalAlpha = 0.9;
        cx.beginPath();
        cx.arc(u.x, u.y, u.r + 12 + Math.sin(time * 8) * 2, 0, TAU);
        cx.stroke();
      }
    }
    cx.restore();
  }
  for (const e of en) {
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
    if (e.t === 30) cx.globalAlpha = 0.8 + 0.2 * Math.sin(time * 9);
    const col = e.hf > 0 ? "#ffffff" : e.col;
    cx.shadowColor = e.gl || e.col;
    cx.shadowBlur = e.gl ? 26 : 14;
    cx.rotate(e.t === 2 ? time * 0.8 : e.ang);
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
  if (state !== "over" || shown < 2) {
    cx.save();
    const p = pl,
      col = p.hf > 0 ? "#ffffff" : CHR.c;
    cx.translate(p.x, p.y);
    cx.globalAlpha = p.dashT > 0 ? 0.45 : 1;
    cx.shadowColor = col;
    cx.shadowBlur = 16;
    cx.strokeStyle = col;
    cx.fillStyle = col + "33";
    cx.lineWidth = 2.5;
    cx.beginPath();
    cx.arc(0, 0, p.r, 0, TAU);
    cx.fill();
    cx.stroke();
    cx.rotate(p.aim);
    cx.beginPath();
    cx.moveTo(p.r + 9, 0);
    cx.lineTo(2, -7);
    cx.lineTo(2, 7);
    cx.closePath();
    cx.stroke();
    cx.rotate(-p.aim);
    if (p.sh > 0) {
      cx.strokeStyle = "#4d9bff";
      cx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 6);
      cx.beginPath();
      cx.arc(0, 0, p.r + 7, 0, TAU);
      cx.stroke();
    }
    cx.restore();
  }
  drawLZ();
  for (const b of bl) {
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
        spin = time * 30 + (b.age || 0) * 12,
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
          const a = time * 3 + (q * TAU) / 3,
            tx = b.x - b.vx * tl * (0.35 + q * 0.22) + Math.cos(a) * b.r * 1.5,
            ty = b.y - b.vy * tl * (0.35 + q * 0.22) + Math.sin(a) * b.r * 1.5,
            sz = 1.2 + Math.sin(time * 8 + q) * 0.5;
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
        cx.globalAlpha = 0.12 + 0.08 * Math.sin(time * 40);
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
  for (const p of pt) {
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
      const flick = Math.sin(time * 95 + p.seed) * 0.5 + 0.5,
        dx = Math.sin(p.seed + time * 37) * p.sz * 0.35,
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
            : Math.sin(p.seed + j * 8.7 + time * 48) * p.sz * 0.8,
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
          bx + p.sz * (0.8 + Math.sin(time * 53 + p.seed)),
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
function row(i, t, col, f, txt) {
  const u = HU,
    y = safeT + 16 * u + i * 25 * u,
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
function hud() {
  itCd = Math.max(0, itCd - 0.017);
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const u = HU,
    p = pl;
  drawBars();

  cx.textAlign = "right";
  cx.textBaseline = "top";
  cx.font = `bold ${16 * u}px ui-monospace,monospace`;
  const X = W - 12 * u;
  let y = safeT + 8 * u;
  cx.fillStyle = "#22e6ff";
  cx.fillText(
    train ? "TRAINING" : "WAVE " + wave + (ST().g ? "/" + ST().g : ""),
    X,
    y,
  );
  cx.fillStyle = "#ff3d9a";
  cx.fillText("ENEMY " + en.length, X, y + 22 * u);
  cx.fillStyle = "#ffe14a";
  cx.fillText("SCORE " + score, X, y + 44 * u);
  cx.fillStyle = "#ffffff99";
  cx.font = `${12 * u}px ui-monospace,monospace`;
  cx.fillText("BEST " + Math.max(best, score), X, y + 68 * u);
  cx.fillStyle = "#ffd23a";
  cx.fillText("COIN " + coins, X, y + 86 * u);
  cx.fillStyle = "#4de1ff";
  cx.fillText("SHARD " + shd, X, y + 102 * u);
  cx.fillStyle = "#ff4dff";
  cx.fillText("CORE " + cor, X, y + 118 * u);
  cx.fillStyle = "#ffffff";
  cx.fillText("PTS " + pts, X, y + 134 * u);
  if (banner > 0 && state === "play") {
    cx.save();
    cx.globalAlpha = Math.min(1, banner);
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.font = `bold ${40 * u}px ui-monospace,monospace`;
    cx.fillStyle = "#22e6ff";
    cx.shadowColor = "#22e6ff";
    cx.shadowBlur = 20;
    cx.fillText("WAVE " + wave, W / 2, H * 0.25);
    if (en.some(isB)) {
      cx.font = `bold ${18 * u}px ui-monospace,monospace`;
      cx.fillStyle = "#ff4d4d";
      cx.fillText(
        "BOSS: " + (BN[en.find(isB).t - 14] || "肉盾"),
        W / 2,
        H * 0.25 + 34 * u,
      );
    } else if (wave > 1 && NEWT().length) {
      cx.font = `bold ${18 * u}px ui-monospace,monospace`;
      cx.fillStyle = "#ffe14a";
      cx.fillText(
        "NEW: " +
          NEWT()
            .map((i) => EN[i])
            .join(" / "),
        W / 2,
        H * 0.25 + 34 * u,
      );
    }
    if (eliteN) {
      cx.font = `bold ${16 * u}px ui-monospace,monospace`;
      cx.fillStyle = EL_COL;
      cx.shadowColor = EL_COL;
      cx.shadowBlur = 18;
      cx.fillText(
        "⚠ 精英怪出現：" +
          Object.entries(eliteL)
            .map(([k, v]) => k + " ×" + v)
            .join("、"),
        W / 2,
        H * 0.25 + 62 * u,
      );
    }
    cx.restore();
  }
  if (touchOn && state === "play") {
    cx.lineWidth = 2;
    const m = tm.id !== null,
      a = ta.id !== null,
      R = 50 * u,
      kr = 20 * u;
    cx.strokeStyle = m ? "rgba(34,230,255,.5)" : "rgba(34,230,255,.2)";
    cx.beginPath();
    cx.arc(m ? tm.sx : 100 * u, m ? tm.sy : H - 100 * u, R, 0, TAU);
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
    cx.arc(a ? ta.sx : W - 92 * u, a ? ta.sy : H - 92 * u, R, 0, TAU);
    cx.stroke();
    if (a) {
      cx.save();
      cx.setLineDash([4, 4]);
      cx.beginPath();
      cx.arc(ta.sx, ta.sy, CZ, 0, TAU);
      cx.stroke();
      cx.restore();
    }
    if (a) {
      const dx = ta.x - ta.sx,
        dy = ta.y - ta.sy,
        d = Math.hypot(dx, dy) || 1,
        k = Math.min(d, R) / d;
      cx.fillStyle =
        Math.hypot(ta.x - ta.sx, ta.y - ta.sy) > CZ
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
}
// 顯示主頁/結算畫面
function showOv(over) {
  XS.over = over ? 1 : 0;
  XS.t = "h";
  XS.fresh = 1;
  if (window.upd) window.upd();
  $("ov").classList.remove("h");
  xResult(over);
}
// 按下出戰：套用裝備、初始化並進入 play
function start() {
  TUT.on = false;
  applyLO();
  setup();
  setState("play");
  $("ov").classList.add("h");
}
$("go").onclick = start;
const fsB = $("fs"),
  fsOK = document.fullscreenEnabled || document.webkitFullscreenEnabled;
if (!fsOK) fsB.style.display = "none";
// 功能：處理「toggleFS」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function toggleFS() {
  if (!fsOK) return;
  const d = document,
    r = d.documentElement;
  try {
    let p;
    if (d.fullscreenElement || d.webkitFullscreenElement)
      p = (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else p = (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}
fsB.onclick = toggleFS;
addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) ult();
  } else if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat)
    dash();
  else if (/^Digit[1-9]$/.test(e.code)) {
    const dn = +e.code[5];
    if (dn >= 4 && dn <= 6 && !e.repeat) useItem(BAG()[dn - 4]);
    else if (dn <= WP.length) pl.w = dn - 1;
  } else if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat)
    togglePause();
  else if (e.code === "KeyQ" && !e.repeat) pl.w = (pl.w + 1) % WP.length;
  else if (e.code === "KeyF" && !e.repeat) toggleFS();
  else if (
    e.code === "Enter" &&
    state !== "play" &&
    !$("ov").classList.contains("h")
  )
    start();
});
addEventListener("keyup", (e) => {
  keys[e.code] = false;
});
addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
  mouse.down = false;
});
cv.addEventListener("mousemove", (e) => {
  if (drag) {
    drag.x = e.clientX;
    drag.y = e.clientY;
  }
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.has = true;
});
cv.addEventListener("mousedown", (e) => {
  if (e.button === 0 && state === "play" && slotDown(e.clientX, e.clientY))
    return;
  if (e.button === 0) {
    mouse.down = true;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.has = true;
    if (state === "play" && !WP[pl.w].auto) {
      pl.aim = Math.atan2(mouse.y / S + camy - pl.y, mouse.x / S + camx - pl.x);
      shoot();
    }
  }
});
addEventListener("mouseup", (e) => {
  if (e.button === 0) {
    mouse.down = false;
    slotUp(e.clientX, e.clientY);
  }
});
cv.addEventListener("contextmenu", (e) => e.preventDefault());
// 功能：處理「setTouch」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function setTouch() {
  if (!touchOn) {
    touchOn = true;
    $("bS").classList.add("on");
    $("bD").classList.add("on");
    $("bW").classList.add("on");
  }
}
cv.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    setTouch();
    for (const t of e.changedTouches) {
      const x = t.clientX,
        y = t.clientY;
      if (state === "play" && slotDown(x, y, t.identifier)) continue;
      if (x < W / 2) {
        if (tm.id === null)
          Object.assign(tm, { id: t.identifier, sx: x, sy: y, x, y });
      } else if (ta.id === null) {
        Object.assign(ta, {
          id: t.identifier,
          sx: x,
          sy: y,
          x,
          y,
          act: true,
          out: 0,
          fired: 0,
          t0: performance.now(),
          a: pl ? pl.aim : 0,
        });
      }
    }
  },
  { passive: false },
);
cv.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (drag && t.identifier === drag.id) {
        drag.x = t.clientX;
        drag.y = t.clientY;
      }
      if (t.identifier === tm.id) {
        tm.x = t.clientX;
        tm.y = t.clientY;
      }
      if (t.identifier === ta.id) {
        ta.x = t.clientX;
        ta.y = t.clientY;
        const dx = ta.x - ta.sx,
          dy = ta.y - ta.sy;
        if (Math.hypot(dx, dy) > 8 * HU) ta.a = Math.atan2(dy, dx);
        if (Math.hypot(dx, dy) > CZ) ta.out = 1;
      }
    }
  },
  { passive: false },
);
// 功能：處理「tend」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const tend = (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (drag && t.identifier === drag.id) slotUp(t.clientX, t.clientY);
    if (t.identifier === tm.id) tm.id = null;
    if (t.identifier === ta.id) {
      if (e.type === "touchend" && state === "play") {
        const dq = Math.hypot(ta.x - ta.sx, ta.y - ta.sy);
        if (dq > CZ) {
          if (!WP[pl.w].auto || !ta.fired) {
            pl.aim = ta.a;
            pl.q = Math.max(0, Math.min(1, (dq - CZ) / (90 * HU - CZ)));
            shoot(true);
          }
        } else if (!ta.out && !ta.fired) shoot(true, true);
      }
      ta.fired = 0;
      ta.id = null;
      ta.act = false;
    }
  }
};
cv.addEventListener("touchend", tend, { passive: false });
cv.addEventListener("touchcancel", tend, { passive: false });
{
  const b = $("bS");
  let ds = null;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setTouch();
    ds = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
    sd = ds;
    try {
      b.setPointerCapture(e.pointerId);
    } catch (_) {}
  });
  b.addEventListener("pointermove", (e) => {
    if (ds && e.pointerId === ds.id) {
      ds.x = e.clientX;
      ds.y = e.clientY;
      if (Math.hypot(ds.x - ds.sx, ds.y - ds.sy) > 18 * HU) ds.out = 1;
    }
  });
  b.addEventListener("pointerup", (e) => {
    if (!ds || e.pointerId !== ds.id) return;
    const dx = ds.x - ds.sx,
      dy = ds.y - ds.sy,
      d = Math.hypot(dx, dy),
      out = ds.out;
    ds = null;
    sd = null;
    if (d > 18 * HU) ult(Math.atan2(dy, dx), Math.min(1, d / (90 * HU)));
    else if (!out) ult();
  });
  b.addEventListener("pointercancel", () => {
    ds = null;
    sd = null;
  });
}
{
  const b = $("bD");
  let ds = null;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setTouch();
    ds = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
    dd = ds;
    b.setPointerCapture(e.pointerId);
  });
  b.addEventListener("pointermove", (e) => {
    if (ds && e.pointerId === ds.id) {
      ds.x = e.clientX;
      ds.y = e.clientY;
      if (Math.hypot(ds.x - ds.sx, ds.y - ds.sy) > 18 * HU) ds.out = 1;
    }
  });
  b.addEventListener("pointerup", (e) => {
    if (!ds || e.pointerId !== ds.id) return;
    const dx = ds.x - ds.sx,
      dy = ds.y - ds.sy,
      out = ds.out;
    ds = null;
    dd = null;
    if (Math.hypot(dx, dy) > 18 * HU) dash(Math.atan2(dy, dx));
    else if (!out) dash();
  });
  b.addEventListener("pointercancel", () => {
    ds = null;
    dd = null;
  });
}
$("bW").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  setTouch();
  pl.w = (pl.w + 1) % WP.length;
});
addEventListener(
  "wheel",
  (e) => {
    if (state === "play")
      pl.w = (pl.w + (e.deltaY > 0 ? 1 : WP.length - 1)) % WP.length;
  },
  { passive: true },
);
$("bS").classList.add("on");
$("bD").classList.add("on");
if (matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints > 0)
  setTouch();
/* ===== 兌換碼：解密後改寫存檔（金幣 / 碎片 / 晶核 / 關卡進度）===== */
const RK = "2595dfeff027a3760fa9425b0664a2a5";
// 功能：處理「rdHex」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function rdHex(s) {
  const a = new Uint8Array(s.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16);
  return a;
}
// 功能：處理「sha256」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function sha256(m) {
  const P = [];
  for (let c = 2; P.length < 64; c++) {
    let ok = 1;
    for (let d = 2; d * d <= c; d++)
      if (c % d === 0) {
        ok = 0;
        break;
      }
    if (ok) P.push(c);
  }
  const K = P.map((p) => Math.floor((Math.cbrt(p) % 1) * 4294967296)),
    h = P.slice(0, 8).map(
      (p) => Math.floor((Math.sqrt(p) % 1) * 4294967296) | 0,
    );
  const l = m.length,
    n = ((l + 9 + 63) >> 6) << 6,
    b = new Uint8Array(n);
  b.set(m);
  b[l] = 128;
  const dv = new DataView(b.buffer);
  dv.setUint32(n - 4, (l * 8) >>> 0);
  dv.setUint32(n - 8, Math.floor((l * 8) / 4294967296));
  const w = new Uint32Array(64),
    rr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3),
        s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0],
      b2 = h[1],
      c = h[2],
      d = h[3],
      e = h[4],
      f = h[5],
      g = h[6],
      hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25),
        ch = (e & f) ^ (~e & g),
        t1 = (hh + S1 + ch + K[i] + w[i]) | 0,
        S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22),
        mj = (a & b2) ^ (a & c) ^ (b2 & c),
        t2 = (S0 + mj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b2;
      b2 = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b2) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }
  const out = new Uint8Array(32),
    ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v >>> 0));
  return out;
}
// 功能：處理「hmac」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function hmac(k, m) {
  const ip = new Uint8Array(64 + m.length),
    op = new Uint8Array(96);
  for (let i = 0; i < 64; i++) {
    const kb = k[i] || 0;
    ip[i] = kb ^ 54;
    op[i] = kb ^ 92;
  }
  ip.set(m, 64);
  op.set(sha256(ip), 64);
  return sha256(op);
}
const RB32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  rdTxt = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
// 功能：處理「rdB32」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function rdB32(s) {
  let bits = 0,
    v = 0;
  const out = [];
  for (const ch of s) {
    const k = RB32.indexOf(ch);
    if (k < 0) return null;
    v = (v << 5) | k;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
      v &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}
// 功能：處理「rdDecode」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function rdDecode(code) {
  const s = String(code)
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "");
  if (s.length !== 32) return { e: "格式不正確，請確認有輸入完整的 32 個字元" };
  const b = rdB32(s);
  if (!b || b.length !== 20) return { e: "格式不正確" };
  const nonce = b.slice(0, 2),
    ct = b.slice(2, 15),
    mac = b.slice(15, 20),
    key = rdHex(RK);
  const ks = hmac(key, Uint8Array.from([...rdTxt("NS1K"), ...nonce])),
    pt = Uint8Array.from(ct, (x, i) => x ^ ks[i]);
  const m = hmac(key, Uint8Array.from([...rdTxt("NS1M"), ...nonce, ...pt]));
  let bad = 0;
  for (let i = 0; i < 5; i++) bad |= m[i] ^ mac[i];
  if (bad) return { e: "驗證失敗：這不是有效的兌換碼" };
  const dv = new DataView(pt.buffer);
  return {
    add: !!(pt[0] & 128),
    stages: pt[0] & 127,
    gold: dv.getUint32(1),
    shards: dv.getUint32(5),
    cores: dv.getUint32(9),
    id:
      [...mac].map((x) => x.toString(16).padStart(2, "0")).join("") +
      [...nonce].map((x) => x.toString(16).padStart(2, "0")).join(""),
  };
}
// 功能：處理「redeem」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function redeem(code) {
  const r = rdDecode(code);
  if (r.e) return { ok: false, msg: r.e };
  SV.used = SV.used || [];
  if (r.add && SV.used.includes(r.id))
    return { ok: false, msg: "這組兌換碼已經在這個瀏覽器使用過了" };
  const u = Math.min(r.stages, STG.length);
  if (r.add) {
    SV.coins += r.gold;
    SV.sh += r.shards;
    SV.co += r.cores;
    SV.used.push(r.id);
  } else {
    SV.coins = r.gold;
    SV.sh = r.shards;
    SV.co = r.cores;
  }
  if (u > 0) {
    if (r.add) {
      for (let i = 0; i < u - 1; i++) SV.clr[i] = true;
    } else {
      SV.clr = [];
      for (let i = 0; i < STG.length; i++) SV.clr[i] = i < u - 1;
    }
    if (SV.sel >= u && !r.add) SV.sel = u - 1;
  }
  save();
  if (window.upd) window.upd();
  return {
    ok: true,
    msg:
      (r.add ? "已增加" : "已設定為") +
      "：金幣 " +
      r.gold.toLocaleString() +
      "、碎片 " +
      r.shards.toLocaleString() +
      "、晶核 " +
      r.cores.toLocaleString() +
      (u > 0
        ? "；解鎖關卡 " +
          u +
          " 關（" +
          (r.add ? "取較高者" : "依兌換碼設定") +
          "）"
        : "；關卡進度不變"),
  };
}
// 功能：處理「rdOpen」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function rdOpen() {
  let el = $("rd");
  if (!el) {
    el = document.createElement("div");
    el.id = "rd";
    el.innerHTML =
      '<div class="rdc"><h3>兌換碼</h3><p>輸入禮包代碼，兌換獎勵</p><input id="rdi" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false"><div id="rdm"></div><div class="rdb"><button class="x-btn pri" id="rdo">兌換</button><button class="x-btn" id="rdx">關閉</button></div></div>';
    document.body.append(el);
    const inp = $("rdi"),
      go = () => {
        const r = redeem(inp.value),
          m = $("rdm");
        m.textContent = r.msg;
        m.style.color = r.ok ? "#3dff8f" : "#ff6a8a";
        if (r.ok) inp.value = "";
      };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") go();
    });
    inp.addEventListener("keyup", (e) => e.stopPropagation());
    $("rdo").onclick = go;
    $("rdx").onclick = () => {
      el.style.display = "none";
    };
    el.addEventListener("mousedown", (e) => {
      if (e.target === el) el.style.display = "none";
    });
  }
  el.style.display = "flex";
  $("rdm").textContent = "";
  setTimeout(() => $("rdi").focus(), 50);
}
resize();
legend();
buildHome();
applyLO();
setup();
setState("menu");
showOv(0);
let last = performance.now();
// 主迴圈：計算 dt、更新、繪製、排下一幀
function loop(n) {
  const rd = Math.min(0.033, (n - last) / 1000);
  last = n;
  let dt = rd;
  if (state === "over" || state === "menu") TSt = 0;
  if (TSt > 0) {
    TSt -= rd;
    dt = rd * TSv;
    if (TSt <= 0) TSv = 1;
  }
  if (state !== "menu" && state !== "pause") update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* =====================================================================
 * 教學模式：15 步引導，完成條件由「操作統計」自動判定
 *   - localStorage 鍵 neonShardTutorialDone：沒有就是第一次遊玩，載入後自動進入教學
 *   - 每一步可有 setup（佈置場景）、keep（資源被消耗時補回）、p（進度 0~1）
 *   - 可 跳過 / 上一步 / 離開；教學中血量不會歸零、不會結算獎勵、不會出現隨機波次
 * ===================================================================== */
const TUT_KEY = "neonShardTutorialDone";
const TUT = {
  on: false,
  done: false,
  step: 0,
  adv: 0,
  st: {},
  walls: [],
  px: 0,
  py: 0,
  aim: 0,
  w: 0,
};
let tutorialSeen = false;
try {
  tutorialSeen = localStorage.getItem(TUT_KEY) === "1";
} catch (e) {}
// 功能：保存教學已完成的狀態。
function markTutorialDone() {
  tutorialSeen = true;
  try {
    localStorage.setItem(TUT_KEY, "1");
  } catch (e) {}
}
// 功能：處理「tutCount」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const tutCount = (k, n = 1) => {
  if (TUT.on) TUT.st[k] = (TUT.st[k] || 0) + n;
};
// 功能：處理「tutNew」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const tutNew = () => ({
  moved: 0,
  aimed: 0,
  shots: 0,
  auto: 0,
  switches: 0,
  dashes: 0,
  walls: 0,
  kills: 0,
  supers: 0,
  pauses: 0,
  emptied: 0,
});
// 功能：計算玩家面向方向上指定距離的座標。
const tutAhead = (d) => ({
  x: pl.x + Math.cos(pl.aim) * d,
  y: pl.y + Math.sin(pl.aim) * d,
}); // 玩家面向前方 d 像素處

/** 生成教學敵人；frozen=靜止靶（不會移動），位置被牆擋住時改找空地 */
function tutEnemy(t, x, y, frozen) {
  let p = { x, y };
  if (blocked(p.x, p.y, 18)) p = empty(150, pl) || p;
  const e = mkEn(t, p.x, p.y);
  if (frozen) e.sp = 0;
  en.push(e);
  burst(p.x, p.y, "#ffffff", 8, 120, 2, 0.5);
}
// 功能：處理「tutDummies」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const tutDummies = (n) => {
  for (let k = 0; k < n; k++) {
    const a = tutAhead(190);
    tutEnemy(0, a.x, a.y + (k - (n - 1) / 2) * 70, true);
  }
};
/** 敵人被清光但條件未達成時補怪（以 kills 為目標） */
const tutRespawn = (type, need, frozen) => () => {
  if (en.length === 0 && (TUT.st.kills || 0) < need) {
    const a = tutAhead(240);
    tutEnemy(type, a.x, a.y, frozen);
  }
};

const TUT_STEPS = [
  {
    title: "移動",
    text: "按 W A S D 在場地中移動，走一小段路。",
    mb: "用左半邊螢幕的虛擬搖桿移動，走一小段路。",
    p: (s) => s.moved / 200,
  },
  {
    title: "瞄準",
    text: "移動滑鼠，讓角色前方的三角形箭頭跟著轉，轉約一圈。",
    mb: "在右半邊螢幕拖曳手指，箭頭會朝拖曳方向轉動，轉約一圈。",
    p: (s) => s.aimed / 6,
  },
  {
    title: "射擊",
    text: "按滑鼠左鍵射擊 5 次（按住可連射的槍會持續開火）。",
    mb: "在右半邊螢幕拖曳瞄準，放開手指就會發射，射擊 5 次。",
    p: (s) => s.shots / 5,
  },
  {
    title: "彈藥",
    text: "每次射擊都會消耗彈藥（畫面下方右側的彈藥條）。把目前彈匣打光，再等它自動回復一發。",
    setup() {
      const w = WP[pl.w];
      w.am = w.ms;
    },
    noRefill: true,
    p: (s) =>
      s.emptied
        ? WP[pl.w].am >= 1
          ? 1
          : 0.7
        : Math.min(0.6, (s.shots / WP[pl.w].ms) * 0.6),
  },
  {
    title: "換槍",
    text: "按 1 / 2 / 3、Q 或滑鼠滾輪切換武器，切換 2 次。每把槍的射速、彈匣與擊退都不同（只裝備 1 把槍會自動略過）。",
    mb: "點畫面下方的槍欄切換武器（可拖曳互換位置），切換 2 次。",
    p: (s) => (WP.length < 2 ? 1 : s.switches / 2),
  },
  {
    title: "自動瞄準",
    text: "角色周圍的虛線圈內，會自動瞄準最近的敵人（黃色圈標示）。大致朝靶射擊 3 次；按 R 可開關自動瞄準。",
    setup() {
      AA = true;
      const a = tutAhead(130);
      tutEnemy(0, a.x, a.y, true);
    },
    keep: tutRespawn(0, 99, true),
    p: (s) => s.auto / 3,
  },
  {
    title: "衝刺",
    text: "按 Shift 衝刺 2 次。衝刺期間完全無敵，能直接穿過子彈，但有冷卻時間。",
    mb: "點右下角 DASH 鈕衝刺 2 次（按住並拖曳可指定方向）。",
    p: (s) => s.dashes / 2,
  },
  {
    title: "破牆",
    text: "彩色方塊能被子彈打碎，顏色越暖越脆弱；紫色叉叉牆打不壞。打碎前方 3 塊牆。",
    setup() {
      const a = tutAhead(T * 3),
        ci = Math.floor(a.x / T),
        cj = Math.floor(a.y / T),
        horiz = Math.abs(Math.cos(pl.aim)) < Math.abs(Math.sin(pl.aim));
      TUT.walls = [];
      for (let d = -1; d <= 1; d++) {
        const i = ci + (horiz ? d : 0),
          j = cj + (horiz ? 0 : d);
        if (cell(i, j) === 0) {
          grid[i + j * N] = 2;
          TUT.walls.push(i + j * N);
        }
      }
      while (TUT.walls.length < 3) {
        const q = empty(150, pl);
        if (!q) break;
        const i = Math.floor(q.x / T),
          j = Math.floor(q.y / T);
        grid[i + j * N] = 2;
        TUT.walls.push(i + j * N);
      } // 前方被擋時改放別處
    },
    p: (s) => s.walls / 3,
  },
  {
    title: "擊敗敵人",
    text: "擊敗 2 個靜止的追擊靶。命中會把敵人擊退，擊退力強的武器更容易拉開距離。",
    setup() {
      tutDummies(2);
    },
    keep: () => {
      if (en.length === 0 && (TUT.st.kills || 0) < 2)
        tutDummies(2 - (TUT.st.kills || 0));
    },
    p: (s) => s.kills / 2,
  },
  {
    title: "閃避狙擊",
    text: "狙擊敵人開火前會出現紅色虛線（約 0.45 秒）。看到就側移或衝刺閃開，再把它擊倒。",
    setup() {
      const a = tutAhead(260);
      tutEnemy(1, a.x, a.y, false);
    },
    keep: tutRespawn(1, 1, false),
    p: (s) => s.kills,
  },
  {
    title: "閃避散射",
    text: "散射敵人一次射出 5 發扇形子彈，紅色虛線就是彈道。往彈道之間的縫隙移動，或衝刺穿過去，再擊倒它。",
    setup() {
      const a = tutAhead(260);
      tutEnemy(2, a.x, a.y, false);
    },
    keep: tutRespawn(2, 1, false),
    p: (s) => s.kills,
  },
  {
    title: "地面炸彈",
    text: "投擲敵人會在你腳下丟出紅色圓圈炸彈，圈填滿就爆炸，也會炸毀方塊。看到圈就離開，再擊倒它。",
    setup() {
      const a = tutAhead(260);
      tutEnemy(3, a.x, a.y, false);
    },
    keep: tutRespawn(3, 1, false),
    p: (s) => s.kills,
  },
  {
    title: "SUPER 大招",
    text: "命中敵人會累積 SUPER 能量，每把槍各自累積，蓄滿後可一次轟出強力攻擊。這次已幫你蓄滿，按空白鍵施放。",
    mb: "這次已幫你蓄滿 SUPER。點 SUPER 鈕施放（按住拖曳可指定方向）。",
    setup() {
      tutDummies(2);
      pl.ult = 100;
    },
    keep: () => {
      if ((TUT.st.supers || 0) < 1 && pl.ult < 100) pl.ult = 100;
      if (en.length === 0 && (TUT.st.supers || 0) < 1) tutDummies(2);
    },
    p: (s) => s.supers,
  },
  {
    title: "暫停",
    text: "按 P 或 Esc 暫停，再按一次繼續。暫停選單可放棄本局。這一步請暫停後繼續遊戲。",
    mb: "點左上角的暫停鈕，再按「繼續」。",
    p: (s) => s.pauses,
  },
  {
    title: "補血",
    text: "血量被降低了。走到綠色十字上回復血量，撿取物掉在地上一段時間後會消失。",
    setup() {
      pl.hp = 40;
      const a = tutAhead(110);
      pk.push({ x: a.x, y: a.y, t: "heal", life: 90 });
    },
    keep: () => {
      if (pl.hp < 65 && !pk.some((q) => q.t === "heal")) {
        const a = tutAhead(110);
        pk.push({ x: a.x, y: a.y, t: "heal", life: 90 });
      }
    },
    p: () => Math.max(0, (pl.hp - 40) / 25),
  },
];

// 功能：處理「tutEnter」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tutEnter(i) {
  TUT.step = i;
  TUT.adv = 0;
  TUT.st = tutNew();
  en.length = 0;
  bl.length = 0;
  zones.length = 0;
  pk.length = 0;
  SQ.length = 0;
  for (let j = 1; j < N - 1; j++)
    for (let k = 1; k < N - 1; k++) grid[k + j * N] = 0; // 每步都從乾淨場地開始（上一步也能重來）
  pl.hp = Math.max(pl.hp, pl.mhp * 0.6);
  const st = TUT_STEPS[i];
  if (st.setup) st.setup();
  tutUI();
}
// 功能：處理「tutAdvance」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tutAdvance() {
  if (!TUT.on || TUT.done) return;
  if (TUT.step >= TUT_STEPS.length - 1) {
    TUT.done = true;
    en.length = 0;
    bl.length = 0;
    pk.length = 0;
    markTutorialDone();
    tutUI();
    return;
  }
  tutEnter(TUT.step + 1);
}
// 功能：處理「tutBack」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tutBack() {
  if (TUT.on && !TUT.done && TUT.step > 0) tutEnter(TUT.step - 1);
  else if (TUT.on && TUT.done) {
    TUT.done = false;
    tutEnter(TUT.step);
  }
}
// 功能：處理「tutTick」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tutTick(dt) {
  if (!TUT.on || state !== "play" || TUT.done) return;
  pkT = 999;
  const st = TUT_STEPS[TUT.step];
  if (!st.noRefill)
    for (const w of WP) w.am = w.ms; // 教學中彈藥補滿（彈藥那一步除外）
  else if (WP[pl.w].am < 1) TUT.st.emptied = 1;
  tutCount("moved", Math.hypot(pl.x - TUT.px, pl.y - TUT.py));
  let da = pl.aim - TUT.aim;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  tutCount("aimed", Math.abs(da));
  if (pl.w !== TUT.w) tutCount("switches");
  TUT.px = pl.x;
  TUT.py = pl.y;
  TUT.aim = pl.aim;
  TUT.w = pl.w;
  if (TUT.adv > 0) {
    TUT.adv -= dt;
    if (TUT.adv <= 0) tutAdvance();
    return;
  }
  if (st.p(TUT.st) >= 1) {
    TUT.adv = 0.9;
    return;
  } // 達標：顯示 ✓ 後再進下一步
  if (st.keep) st.keep();
}
// 功能：初始化並啟動教學流程。
function startTutorial() {
  applyLO();
  setup();
  AA = true;
  Object.assign(TUT, { on: true, done: false });
  TUT.px = pl.x;
  TUT.py = pl.y;
  TUT.aim = pl.aim;
  TUT.w = pl.w;
  wave = 1;
  banner = 0;
  pkT = 999;
  tutEnter(0);
  $("ov").classList.add("h");
  setState("play");
  tutUI();
}
// 功能：處理「exitTutorial」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function exitTutorial() {
  markTutorialDone();
  TUT.on = false;
  en.length = 0;
  bl.length = 0;
  pk.length = 0;
  tutUI();
  setState("menu");
  showOv(0);
}
// 功能：處理「tutToBattle」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tutToBattle() {
  markTutorialDone();
  TUT.on = false;
  tutUI();
  start();
}

/* 操作統計：包裝既有函式，不改動原本邏輯 */
{
  const _shoot = shoot;
  shoot = function () {
    const w = WP[pl.w],
      a = w.am,
      t = TUT.on && AA && aimT();
    const r = _shoot.apply(this, arguments);
    if (w.am < a) {
      tutCount("shots");
      if (t) tutCount("auto");
    }
    return r;
  };
  const _dash = dash;
  dash = function () {
    const c = pl.dashCd;
    _dash.apply(this, arguments);
    if (c <= 0 && pl.dashCd > 0) tutCount("dashes");
  };
  const _ult = ult;
  ult = function () {
    const u = pl.ult;
    _ult.apply(this, arguments);
    if (u >= 100 && pl.ult < 100) tutCount("supers");
  };
  const _kill = kill;
  kill = function (e) {
    const f = e && e.dk;
    _kill.apply(this, arguments);
    if (!f) tutCount("kills");
  };
  const _hit = hitCell;
  hitCell = function (i, j) {
    const b = cell(i, j),
      r = _hit.apply(this, arguments);
    if (b > 0 && cell(i, j) === 0) tutCount("walls");
    return r;
  };
  const _hurt = hurt;
  hurt = function (d) {
    if (TUT.on) {
      if (pl.hp < 30) pl.hp = 30;
      d = Math.min(d, (pl.hp - 1) / 1.2);
    }
    return _hurt.call(this, d);
  }; // 教學中傷害封頂，不會死亡
  const _resume = resume;
  resume = function () {
    const was = state === "pause";
    _resume.apply(this, arguments);
    if (was) tutCount("pauses");
  };
  const _quit = quit;
  quit = function () {
    if (TUT.on) {
      $("ps").classList.add("h");
      exitTutorial();
      return;
    }
    return _quit.apply(this, arguments);
  }; // 暫停選單的「放棄」＝離開教學
  const _hud = hud;
  hud = function () {
    _hud();
    drawTutPanel();
  };
  const _upd = update;
  update = function (dt) {
    _upd(dt);
    tutTick(dt);
  };
}

// 功能：處理「wrapTut」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function wrapTut(text, maxW) {
  const out = [];
  let line = "";
  for (const ch of text) {
    if (cx.measureText(line + ch).width > maxW) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  out.push(line);
  return out;
}
// 功能：繪製或建立「drawTutPanel」所需的畫面元素。
function drawTutPanel() {
  if (!TUT.on || state !== "play") return;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const u = HU,
    n = TUT_STEPS.length,
    st = TUT_STEPS[TUT.step],
    w = Math.min(W - 24, 400 * u),
    x = W / 2 - w / 2,
    y = safeT + 10,
    F = 'system-ui,"Noto Sans TC",sans-serif';
  cx.save();
  cx.font = 13 * u + "px " + F;
  const body = TUT.done
    ? "你已學會所有基本操作！正式戰鬥小提醒：每波結束會進補給站，用戰利品強化；金幣可到商城永久升級；想自由試槍、練習打各種敵人，可到「訓練場」。"
    : touchOn && st.mb
      ? st.mb
      : st.text;
  const lines = wrapTut(body, w - 24 * u),
    h = (46 + lines.length * 19 + (TUT.done ? 4 : 18)) * u;
  cx.fillStyle = "#05060ddd";
  cx.fillRect(x, y, w, h);
  cx.strokeStyle = "#ffe14a88";
  cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  cx.textAlign = "left";
  cx.textBaseline = "top";
  cx.fillStyle = TUT.adv > 0 ? "#3dff8f" : "#ffe14a";
  cx.font = "bold " + 14 * u + "px " + F;
  cx.fillText(
    TUT.done
      ? "教學完成！"
      : "教學 " +
          (TUT.step + 1) +
          "/" +
          n +
          " · " +
          st.title +
          (TUT.adv > 0 ? "  ✓" : ""),
    x + 12 * u,
    y + 8 * u,
  );
  for (let i = 0; i < n; i++) {
    cx.fillStyle =
      TUT.done || i < TUT.step
        ? "#3dff8f"
        : i === TUT.step
          ? "#ffe14a"
          : "#ffffff33";
    cx.fillRect(
      x + 12 * u + i * ((w - 24 * u) / n),
      y + 28 * u,
      (w - 24 * u) / n - 3 * u,
      3 * u,
    );
  }
  cx.fillStyle = "#d8f4ff";
  cx.font = 13 * u + "px " + F;
  lines.forEach((l, i) => cx.fillText(l, x + 12 * u, y + 38 * u + i * 19 * u));
  if (!TUT.done) {
    const f = Math.max(0, Math.min(1, st.p(TUT.st))),
      by = y + h - 14 * u;
    cx.fillStyle = "#ffffff22";
    cx.fillRect(x + 12 * u, by, w - 24 * u, 6 * u);
    cx.fillStyle = f >= 1 ? "#3dff8f" : "#ffe14a";
    cx.fillRect(x + 12 * u, by, (w - 24 * u) * f, 6 * u);
  }
  cx.restore();
}

/* 教學控制鈕（鍵盤：N 跳過 / B 上一步 / X 離開 / Enter 開始戰鬥；觸控用畫面按鈕）。主頁入口在 xLobby 的按鈕列 */
let tutBox = null,
  tutBackBtn = null,
  tutSkipBtn = null,
  tutStartBtn = null;
// 功能：處理「tutUI」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tutUI() {
  if (!tutBox) return;
  tutBox.style.display = TUT.on ? "flex" : "none";
  tutBackBtn.style.display =
    TUT.on && (TUT.step > 0 || TUT.done) ? "block" : "none";
  tutSkipBtn.style.display = TUT.on && !TUT.done ? "block" : "none";
  tutStartBtn.style.display = TUT.on && TUT.done ? "block" : "none";
}
// 功能：處理「tutorialButton」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
function tutorialButton() {
  tutBox = document.createElement("div");
  tutBox.style.cssText =
    "position:fixed;z-index:25;left:max(10px,env(safe-area-inset-left));top:calc(max(10px,env(safe-area-inset-top)) + 54px);display:none;flex-direction:column;gap:6px";
  // 功能：建立或生成「mk」所需的遊戲資料。
  const mk = (t, fn) => {
    const b = document.createElement("button");
    b.className = "sb";
    b.textContent = t;
    b.onclick = fn;
    tutBox.append(b);
    return b;
  };
  tutBackBtn = mk("上一步 (B)", tutBack);
  tutSkipBtn = mk("跳過此步 (N)", tutAdvance);
  mk("離開教學 (X)", exitTutorial);
  tutStartBtn = mk("開始戰鬥 (Enter)", tutToBattle);
  document.body.append(tutBox);
  tutUI();
}
addEventListener("keydown", (e) => {
  if (!TUT.on || e.repeat) return;
  if (e.code === "KeyN") tutAdvance();
  else if (e.code === "KeyB") tutBack();
  else if (e.code === "KeyX") exitTutorial();
  else if (e.code === "Enter" && TUT.done) tutToBattle();
});
tutorialButton(); // 放在檔尾：所有 let/const 都已初始化（避免暫時性死區）
if (!tutorialSeen) startTutorial(); // 第一次遊玩：自動進入教學

/*
 * NEON SHARD 擴充 API。
 * 其他模組載入完成後可透過 window.NEON_SHARD_API 註冊狀態與瞄準線擴充。
 * getWeaponDefinitions() 回傳原始設定陣列；請在正式玩法規則中加入必要的伺服器端驗證。
 */
Object.defineProperty(window, "NEON_SHARD_API", {
  configurable: true,
  value: Object.freeze({
    registerStateTransition,
    registerStateHook,
    registerStateGuard,
    registerAimLineExtension,
    getState: () => state,
    getWeaponDefinitions: () => WEAPON_DEFINITIONS,
  }),
});
