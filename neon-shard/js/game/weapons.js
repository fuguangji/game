/** game/weapons — 武器資料表與出戰配置 */
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { modW } from "./chips.js";
import { SV } from "./progress.js";

export const ALLW = [
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
export const WP = [],
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
const BAL = {
  10: { grenadeMode: 1, damage: 58 },
  4: { damage: 6 },
  6: { damage: 24 },
  8: { damage: 7 },
  11: { damage: 36 },
  17: { damage: 30, reloadDuration: 1.5 },
};

// 武器設定採用可讀性較高的正名；舊欄位以 getter/setter 暫時相容既有戰鬥程式。
let WEAPON_PROPERTY_ALIASES; // 初始化在 init()
export function normalizeWeaponProperties(weapon) {
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
export let WEAPON_DEFINITIONS; // 初始化在 init()
// 功能：讀取並套用保存的武器配置。
export function applyLO() {
  G.LO = G.LO.filter((i) => SV.own.includes(i));
  if (!G.LO.length) G.LO = [SV.own[0]];
  WP.splice(0, WP.length, ...G.LO.map((i) => modW(ALLW[i])));
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

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
WEAPON_PROPERTY_ALIASES = Object.freeze({
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
WEAPON_DEFINITIONS = ALLW;

for (const weaponDefinition of WEAPON_DEFINITIONS) normalizeWeaponProperties(weaponDefinition);

G.LO = [0, 1, 2];

{
  const saved = store.getJSON(
    KEYS.loadout,
    (v) => Array.isArray(v) && v.length > 0 && v.length <= 3 && v.every((i) => ALLW[i]),
  );
  if (saved) G.LO = saved;
}
}

