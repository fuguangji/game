/**
 * 存檔存取層：所有 localStorage 讀寫都走這裡。
 * - 隱私模式 / 容量滿 / 資料損毀時不會讓遊戲當掉，改回傳預設值
 * - 讀取時可附驗證函式，不合格的資料一律當作不存在
 */
export const KEYS = Object.freeze({
  loadout: "neonShardLO",
  best: "neonShardBest",
  save: "neonShardSave",
  autoAim: "neonShardAA",
  tutorialDone: "neonShardTutorialDone",
  shopGuideDone: "neonShardShopGuideDone",
  starterGift: "neonShardStarterGift",
  trainingTip: "neonShardTrainingTip",
  settings: "neonShardSettings",
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
      const v = this.#storage?.getItem(key);
      return v === null || v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  }

  setString(key, value) {
    try {
      this.#storage?.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }

  /** 讀取數字；非有限數、超出範圍都回傳 fallback */
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
