/**
 * 個人設定（會存在本機的顯示偏好）。
 * 只接受已宣告的欄位與正確型別；損毀或被改過的資料會被忽略並回到預設值。
 * 自動瞄準模式沿用原本的存放方式（KEYS.autoAim），不在這裡重複保存。
 */
import { KEYS, isPlainObject, store as defaultStore } from "./save-store.js";

/** 所有設定與預設值（唯讀） */
export const SETTING_DEFAULTS = Object.freeze({
  showAura: true, // 顯示職業代表色粒子光環
  showSkin: true, // 顯示自訂角色外觀
});

export class SettingsStore extends EventTarget {
  #saveStore;
  #values;

  constructor(saveStore = defaultStore) {
    super();
    this.#saveStore = saveStore;
    this.#values = { ...SETTING_DEFAULTS };
    const saved = saveStore.getJSON(KEYS.settings, isPlainObject, {});
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      if (typeof saved[key] === typeof SETTING_DEFAULTS[key]) this.#values[key] = saved[key];
    }
  }

  get(name) {
    if (!(name in SETTING_DEFAULTS)) throw new RangeError(`未知的設定：${String(name)}`);
    return this.#values[name];
  }

  /** 設定一個欄位；型別不符會丟出錯誤（不會悄悄存進奇怪的值） */
  set(name, value) {
    if (!(name in SETTING_DEFAULTS)) throw new RangeError(`未知的設定：${String(name)}`);
    if (typeof value !== typeof SETTING_DEFAULTS[name]) throw new TypeError(`設定 ${name} 需要 ${typeof SETTING_DEFAULTS[name]}`);
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
