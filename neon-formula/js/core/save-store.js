/**
 * 存檔存取層：所有 localStorage 讀寫都走這裡。
 * - 隱私模式 / 容量滿 / 資料損毀時不會讓遊戲當掉，改回傳預設值
 * - 讀取時可附驗證函式，不合格的資料一律當作不存在
 */
export const KEYS = Object.freeze({
  loadout: "neonFormulaLO",
  best: "neonFormulaBest",
  save: "neonFormulaSave",
  autoAim: "neonFormulaAA",
  tutorialDone: "neonFormulaTutorialDone",
  shopGuideDone: "neonFormulaShopGuideDone",
  starterGift: "neonFormulaStarterGift",
  trainingTip: "neonFormulaTrainingTip",
  settings: "neonFormulaSettings",
  cloudSync: "neonFormulaCloudSync",
});

const LEGACY_KEYS = Object.freeze({
  [KEYS.loadout]: "neonShardLO",
  [KEYS.best]: "neonShardBest",
  [KEYS.save]: "neonShardSave",
  [KEYS.autoAim]: "neonShardAA",
  [KEYS.tutorialDone]: "neonShardTutorialDone",
  [KEYS.shopGuideDone]: "neonShardShopGuideDone",
  [KEYS.starterGift]: "neonShardStarterGift",
  [KEYS.trainingTip]: "neonShardTrainingTip",
  [KEYS.settings]: "neonShardSettings",
  [KEYS.cloudSync]: "neonShardCloudSync",
});

export const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 某些瀏覽器在隱私模式下存取 localStorage 會直接丟例外
  }
}

export class SaveStore {
  #storage;

  constructor(storage = defaultStorage()) {
    this.#storage = storage;
  }

  getString(key, fallback = null) {
    try {
      const value = this.#storage?.getItem(key);
      if (value !== null && value !== undefined) return value;
      const legacyKey = LEGACY_KEYS[key];
      if (!legacyKey) return fallback;
      const legacyValue = this.#storage?.getItem(legacyKey);
      if (legacyValue === null || legacyValue === undefined) return fallback;
      try {
        this.#storage?.setItem(key, legacyValue);
        this.#storage?.removeItem(legacyKey);
      } catch {
        // Keep returning the legacy value if storage blocks migration.
      }
      return legacyValue;
    } catch {
      return fallback;
    }
  }

  setString(key, value) {
    try {
      this.#storage?.setItem(key, String(value));
      const legacyKey = LEGACY_KEYS[key];
      if (legacyKey) {
        try {
          this.#storage?.removeItem(legacyKey);
        } catch {
          // The new value is already saved; a stale legacy key is harmless.
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 讀取數字；非有限數、超出範圍都回傳 fallback */
  remove(key) {
    try {
      this.#storage?.removeItem(key);
      const legacyKey = LEGACY_KEYS[key];
      if (legacyKey) this.#storage?.removeItem(legacyKey);
      return true;
    } catch {
      return false;
    }
  }

  getNumber(key, { min = -Infinity, max = Infinity, integer = false, fallback = null } = {}) {
    const raw = this.getString(key);
    if (raw === null || raw.trim() === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) return fallback;
    if (integer && !Number.isInteger(n)) return fallback;
    return n;
  }

  setNumber(key, value) {
    return Number.isFinite(value) && this.setString(key, value);
  }

  /** 讀取 JSON；解析失敗或驗證不過都回傳 fallback */
  getJSON(key, validate = () => true, fallback = null) {
    const raw = this.getString(key);
    if (raw === null) return fallback;
    try {
      const v = JSON.parse(raw);
      return validate(v) ? v : fallback;
    } catch {
      return fallback;
    }
  }

  setJSON(key, value) {
    try {
      return this.setString(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }
}

export const store = new SaveStore();
