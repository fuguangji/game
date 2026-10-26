/** game/weapons — 私有武器資料庫、舊欄位相容與出戰配置 */
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { modW } from "./chips.js";
import { SV } from "./progress.js";

/**
 * 武器資料庫。
 * 定義表與別名表皆為 class 私有靜態欄位，外部無法直接取得或修改。
 * 公開查詢只回傳凍結資料；戰鬥中的可變副本由 modW() 產生。
 */
class WeaponCatalog {
  static #definitions = [
    {
      name: "青羽鎩",
      color: "#7fe0d0",
      projectilesPerShot: 1,
      spreadAngle: 0,
      damage: 38,
      projectileSpeed: 1000,
      projectileLifetime: 0.1,
      fireCooldown: 0.32,
      knockback: 500,
      projectileRadius: 4,
      accuracySpread: 0,
      muzzleParameter: 0,
      wallDamage: 0.5,
      automaticFire: 1,
      aimPreviewMode: "l",
      meleeArcEnabled: 1,
      meleeRange: 112,
      meleeSweepAngle: 1.9,
      id: 0,
      magazineCapacity: 60,
      ammoInMagazine: 60,
      reloadDuration: 0.6,
      description:
        "術式·近戰連斬｜琉璃焰／衰變／托克馬克／轉能／中子射線流｜術式場：電子軌域",
    },
    {
      name: "未雨鎩",
      color: "#6ab8ff",
      projectilesPerShot: 1,
      spreadAngle: 0,
      damage: 30,
      projectileSpeed: 1000,
      projectileLifetime: 0.1,
      fireCooldown: 0.22,
      knockback: 350,
      projectileRadius: 4,
      accuracySpread: 0,
      muzzleParameter: 0,
      wallDamage: 0.5,
      automaticFire: 1,
      aimPreviewMode: "l",
      meleeArcEnabled: 1,
      meleeRange: 96,
      meleeSweepAngle: 1.7,
      id: 1,
      magazineCapacity: 60,
      ammoInMagazine: 60,
      reloadDuration: 0.6,
      description:
        "術式·輕快近戰｜時柳／渦流／脈衝／璃／負片｜術式場：絕對霜域、轉態",
    },
    {
      name: "閃霰劍",
      color: "#ffd98a",
      projectilesPerShot: 1,
      spreadAngle: 0,
      damage: 46,
      projectileSpeed: 1000,
      projectileLifetime: 0.1,
      fireCooldown: 0.45,
      knockback: 650,
      projectileRadius: 4,
      accuracySpread: 0,
      muzzleParameter: 0,
      wallDamage: 0.5,
      automaticFire: 1,
      aimPreviewMode: "l",
      meleeArcEnabled: 1,
      meleeRange: 130,
      meleeSweepAngle: 2.6,
      id: 2,
      magazineCapacity: 60,
      ammoInMagazine: 60,
      reloadDuration: 0.6,
      description:
        "術式·大範圍近戰｜霓／溢射／日全蝕／冕／二極體／霞｜術式場：朗",
    },
    {
      name: "塵流懸液",
      color: "#c9b8a0",
      projectilesPerShot: 1,
      spreadAngle: 0,
      damage: 12,
      projectileSpeed: 640,
      projectileLifetime: 0.7,
      fireCooldown: 0.16,
      ammoCost: 1,
      knockback: 160,
      projectileRadius: 3.5,
      accuracySpread: 0.02,
      muzzleParameter: 0.05,
      wallDamage: 0.6,
      automaticFire: 1,
      aimPreviewMode: "l",
      id: 3,
      magazineCapacity: 40,
      ammoInMagazine: 40,
      reloadDuration: 1.2,
      description: "術式·輕型塵彈｜簡筆／裂解｜術式場：塵流懸圖（9 層同心圓）",
    },
    {
      name: "噐體熔融",
      color: "#ff8a5a",
      projectilesPerShot: 3,
      spreadAngle: 0.5,
      damage: 10,
      projectileSpeed: 560,
      projectileLifetime: 0.35,
      fireCooldown: 0.5,
      ammoCost: 1,
      knockback: 200,
      projectileRadius: 3.5,
      accuracySpread: 0.02,
      muzzleParameter: 0.05,
      wallDamage: 0.6,
      automaticFire: 0,
      aimPreviewMode: "c",
      id: 4,
      magazineCapacity: 12,
      ammoInMagazine: 12,
      reloadDuration: 1.6,
      description:
        "術式·近距熔渣霰射｜基本熔斷／塑·熔／汽焊／助焊劑｜術式場：爐心熔毀",
    },
    {
      name: "銘骨衍枝曲",
      color: "#8fd070",
      projectilesPerShot: 1,
      spreadAngle: 0,
      damage: 14,
      projectileSpeed: 760,
      projectileLifetime: 0.8,
      fireCooldown: 0.28,
      ammoCost: 1,
      knockback: 140,
      projectileRadius: 3,
      accuracySpread: 0.02,
      muzzleParameter: 0.05,
      wallDamage: 0.6,
      automaticFire: 1,
      aimPreviewMode: "l",
      pierceCount: 1,
      id: 5,
      magazineCapacity: 18,
      ammoInMagazine: 18,
      reloadDuration: 1.4,
      description:
        "術式·竹針連射（可穿透）｜鐫刻／竹綻／柳／白楊｜術式場：百花齊放",
    },
    {
      name: "驥隱流楓",
      color: "#e08a4a",
      projectilesPerShot: 1,
      spreadAngle: 0,
      damage: 26,
      projectileSpeed: 1000,
      projectileLifetime: 0.1,
      fireCooldown: 0.18,
      knockback: 200,
      projectileRadius: 4,
      accuracySpread: 0,
      muzzleParameter: 0,
      wallDamage: 0.5,
      automaticFire: 1,
      aimPreviewMode: "l",
      meleeArcEnabled: 1,
      meleeRange: 90,
      meleeSweepAngle: 1.5,
      id: 6,
      magazineCapacity: 60,
      ammoInMagazine: 60,
      reloadDuration: 0.6,
      description:
        "術式·疾風近戰｜紊流隱舞曲／鏡川殘卷／鳶尾天平非穩態／瑟颯峽村｜術式場：霜雪風域",
    },
    {
      name: "符咒",
      color: "#5edfff",
      projectilesPerShot: 1,
      spreadAngle: 0.1,
      damage: 17,
      projectileSpeed: 1000,
      projectileLifetime: 0.7,
      fireCooldown: 0.12,
      ammoCost: 1,
      knockback: 160,
      projectileRadius: 3.5,
      accuracySpread: 0.02,
      muzzleParameter: 0.05,
      wallDamage: 0.1,
      clusterShotEnabled: 1,
      aimPreviewMode: "l",
      id: 7,
      chainLightningEnabled: 1,
      flameMode: 1,
      freezeOnHit: 1,
      magazineCapacity: 15,
      ammoInMagazine: 15,
      reloadDuration: 1.2,
      description: "術式·遠程符咒｜冰／火／雷／毒｜術式場：噬血符",
    },
    {
      weapon: "泱懸伏鏢",
      color: "#501aa7",
      projectilesPerShot: 1,
      spreadAngle: 0.1,
      damage: 17,
      projectileSpeed: 1000,
      projectileLifetime: 0.7,
      fireCooldown: 0.12,
      ammoCost: 1,
      knockback: 160,
      projectileRadius: 3.5,
      accuracySpread: 0.02,
      muzzleParameter: 0.05,
      wallDamage: 0.1,
      clusterShotEnabled: 1,
      aimPreviewMode: "l",
      id: 8,
      chainLightningEnabled: 1,
      generadegrenadeMode: 1,
      magazineCapacity: 15,
      ammoInMagazine: 15,
      reloadDuration: 1.2,
      description:
        "術式·飛鏢|伏鏡/懸流/怖鋒引/賜伏|術式場:泱鉉",
    },
  ];

  // 舊欄位縮寫 → 正式欄位名稱；僅供本 class 內部正規化。
  static #aliases = {
    n: "name",
    c: "color",
    n1: "projectilesPerShot",
    sp: "spreadAngle",
    dmg: "damage",
    v: "projectileSpeed",
    life: "projectileLifetime",
    cd: "fireCooldown",
    cost: "ammoCost",
    kb: "knockback",
    r: "projectileRadius",
    pierce: "pierceCount",
    hm: "homingEnabled",
    acc: "accuracySpread",
    mp: "muzzleParameter",
    wd: "wallDamage",
    auto: "automaticFire",
    ad: "aimPreviewMode",
    laser: "laserMode",
    ex: "explosionRadius",
    pa: "pierceWalls",
    bn: "bounceCount",
    bm: "boomerangEnabled",
    ch: "chainLightningEnabled",
    mine: "mineMode",
    fz4: "freezeOnHit",
    gp: "gravityFieldEnabled",
    cg: "chargeStackEnabled",
    web: "webMode",
    tur: "turretMode",
    tox: "poisonCloudMode",
    slash: "meleeArcEnabled",
    rg: "meleeRange",
    sw: "meleeSweepAngle",
    cs: "clusterShotEnabled",
    gren: "grenadeMode",
    fl: "flameMode",
    rcg: "legacyRcg",
    ms0: "magazineCapacity",
    ms: "ammoInMagazine",
    rs: "reloadDuration",
  };

  static #initialized = false;
  static #empty = Object.freeze([]);

  /** 將舊欄位轉為正式欄位，並保留非列舉的 getter/setter 相容別名。 */
  static normalize(weapon) {
    for (const [legacyName, canonicalName] of Object.entries(this.#aliases)) {
      if (Object.prototype.hasOwnProperty.call(weapon, legacyName)) {
        if (weapon[canonicalName] === undefined)
          weapon[canonicalName] = weapon[legacyName];
        delete weapon[legacyName];
      }
      if (!Object.prototype.hasOwnProperty.call(weapon, legacyName)) {
        Object.defineProperty(weapon, legacyName, {
          configurable: true,
          enumerable: false,
          get() {
            return this[canonicalName];
          },
          set(value) {
            this[canonicalName] = value;
          },
        });
      }
    }
    return weapon;
  }

  /** 完成一次性正規化與凍結；重複呼叫不會重複處理。 */
  static initialize() {
    if (this.#initialized) return;
    for (const weapon of this.#definitions) {
      this.normalize(weapon);
      Object.freeze(weapon);
    }
    Object.freeze(this.#definitions);
    this.#initialized = true;
  }

  /** 唯讀查詢：回傳凍結陣列或單筆凍結定義，不暴露可變資料表。 */
  static get(id) {
    if (!this.#initialized) return id === undefined ? this.#empty : null;
    return id === undefined
      ? this.#definitions
      : (this.#definitions[id] ?? null);
  }

  static get count() {
    return this.#initialized ? this.#definitions.length : 0;
  }
}

/** 戰鬥用可變武器副本；維持原陣列參照以相容既有模組。 */
export const WP = [];
export let WD = Object.freeze([]);

/** 舊戰鬥程式仍可使用縮寫欄位，但定義資料本身不可修改。 */
export function normalizeWeaponProperties(weapon) {
  return WeaponCatalog.normalize(weapon);
}

/** 對外提供唯讀查詢介面；定義陣列與每筆定義皆已凍結。 */
export const ALLWEAPON = Object.freeze({
  getWeapon(id) {
    return WeaponCatalog.get(id);
  },
  getWeaponById(id) {
    return WeaponCatalog.get(id);
  },
  getWeaponCount() {
    return WeaponCatalog.count;
  },
});

/** 依擁有清單清理出戰配置，再建立戰鬥專用副本。 */
/** 最多同時出戰幾把武器 */
export const MAX_LOADOUT = 2;
/** 新手起始武器的編號（免費、預設擁有；對應 WPR 價格 0 與 progress.js 的預設 own） */
export const STARTER_WEAPON = 7;

export function applyLO() {
  G.LO = G.LO.filter((id) => SV.own.includes(id)).slice(0, MAX_LOADOUT);
  if (!G.LO.length) G.LO = [SV.own[0]];
  WP.splice(0, WP.length, ...G.LO.map((id) => modW(WeaponCatalog.get(id))));
}

/** 由 main.js 按既有順序呼叫，避免模組循環引用造成初始化順序問題。 */
let initialized = false;
export function init() {
  if (initialized) return;

  WeaponCatalog.initialize();
  WD = Object.freeze(WeaponCatalog.get().map((weapon) => weapon.description));

  // 預設出戰配置；若有合法存檔，則以存檔覆蓋。
  G.LO = [STARTER_WEAPON];
  const saved = store.getJSON(
    KEYS.loadout,
    (value) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= MAX_LOADOUT &&
      value.every((id) => WeaponCatalog.get(id) !== null),
  );
  if (saved) G.LO = saved;

  initialized = true;
}
