/**
 * 個人設定（會存在本機的顯示與操作偏好）。
 * 只接受已宣告的欄位與合法的值；損毀或被改過的資料會被忽略並回到預設值。
 * 自動瞄準模式沿用原本的存放方式（KEYS.autoAim），不在這裡重複保存。
 *
 * 每個欄位用一份規格描述：預設值，加上 oneOf（列舉）或 min/max（數值範圍）。
 * 規格集中在 SETTING_SPEC，要新增設定只需要在這裡加一行。
 */
import { KEYS, isPlainObject, store as defaultStore } from "./save-store.js";

/** 設定規格（唯讀）。oneOf = 只接受列出的值；min/max = 數值範圍 */
export const SETTING_SPEC = Object.freeze({
  /* 顯示 */
  showAura: Object.freeze({ def: true }), // 顯示職業代表色粒子光環
  showSkin: Object.freeze({ def: true }), // 顯示自訂角色外觀

  /* 操作 */
  controlMode: Object.freeze({ def: "auto", oneOf: ["auto", "desktop", "mobile"] }), // 操作配置：自動偵測／電腦／手機
  skillReturnBasic: Object.freeze({ def: true }), // 手機：技能施放後自動切回普通攻擊

  /* 畫面與效能 */
  quality: Object.freeze({ def: "auto", oneOf: ["auto", "low", "medium", "high"] }), // 畫質（自動 = 依幀時間動態調整）
  renderScale: Object.freeze({ def: 1, min: 0.5, max: 1 }), // 渲染解析度比例（1 = 原生）
  fpsCap: Object.freeze({ def: 0, oneOf: [0, 30, 60, 90, 120] }), // 繪製幀率上限（0 = 跟隨螢幕）
  simRate: Object.freeze({ def: 60, oneOf: [30, 60, 120] }), // 模擬頻率（每秒更新次數，與繪製幀率無關）
  interpolation: Object.freeze({ def: true }), // 動態補償：在兩次模擬之間做位置插值
  glowEffects: Object.freeze({ def: true }), // 發光特效（陰影模糊，最吃效能）
  particleDensity: Object.freeze({ def: "auto", oneOf: ["auto", "low", "normal", "high"] }), // 粒子密度
  screenShake: Object.freeze({ def: true }), // 畫面震動
  showFps: Object.freeze({ def: false }), // 顯示效能資訊
});

/** 所有設定與預設值（唯讀） */
export const SETTING_DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SETTING_SPEC).map(([k, s]) => [k, s.def])));

/** 這個值是否符合該欄位的規格（型別、列舉、範圍） */
function valid(name, value) {
  const spec = SETTING_SPEC[name];
  if (typeof value !== typeof spec.def) return false;
  if (spec.oneOf) return spec.oneOf.includes(value);
  if (typeof value === "number") return Number.isFinite(value) && value >= spec.min && value <= spec.max;
  return true;
}

export class SettingsStore extends EventTarget {
  #saveStore;
  #values;

  constructor(saveStore = defaultStore) {
    super();
    this.#saveStore = saveStore;
    this.#values = { ...SETTING_DEFAULTS };
    const saved = saveStore.getJSON(KEYS.settings, isPlainObject, {});
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      if (valid(key, saved[key])) this.#values[key] = saved[key];
    }
  }

  get(name) {
    if (!(name in SETTING_DEFAULTS)) throw new RangeError(`未知的設定：${String(name)}`);
    return this.#values[name];
  }

  /** 設定一個欄位；型別或範圍不符會丟出錯誤（不會悄悄存進奇怪的值） */
  set(name, value) {
    if (!(name in SETTING_DEFAULTS)) throw new RangeError(`未知的設定：${String(name)}`);
    if (typeof value !== typeof SETTING_DEFAULTS[name]) throw new TypeError(`設定 ${name} 需要 ${typeof SETTING_DEFAULTS[name]}`);
    if (!valid(name, value)) throw new RangeError(`設定 ${name} 不接受這個值：${String(value)}`);
    if (this.#values[name] === value) return;
    this.#values[name] = value;
    this.#saveStore.setJSON(KEYS.settings, this.#values);
    this.dispatchEvent(new CustomEvent("change", { detail: { name, value } }));
  }

  /** 目前所有設定的副本 */
  all() { return { ...this.#values }; }

  reset() {
    this.#values = { ...SETTING_DEFAULTS };
    this.#saveStore.setJSON(KEYS.settings, this.#values);
    this.dispatchEvent(new CustomEvent("change", { detail: { name: null } }));
  }
}

export const settings = new SettingsStore();
