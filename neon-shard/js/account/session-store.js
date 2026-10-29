/**
 * 登入工作階段（sessionStorage）。
 * 只接受格式正確的資料；損毀、被改過或缺欄位的內容一律視為「未登入」。
 */
export const SESSION_KEY = "neonShardAuthSession";

export class SessionStore {
  #storage;
  #key;
  #value;

  constructor(storage = SessionStore.defaultStorage(), key = SESSION_KEY) {
    this.#storage = storage;
    this.#key = key;
    this.#value = this.#read();
  }

  static defaultStorage() {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  }

  static isValid(v) {
    return (
      v !== null && typeof v === "object" &&
      typeof v.accessToken === "string" && v.accessToken.length >= 20 && v.accessToken.length <= 8192 &&
      typeof v.refreshToken === "string" && v.refreshToken.length >= 8 && v.refreshToken.length <= 4096 &&
      (v.userId === undefined || typeof v.userId === "string")
    );
  }

  #read() {
    try {
      const v = JSON.parse(this.#storage?.getItem(this.#key) ?? "null");
      return SessionStore.isValid(v) ? v : null;
    } catch {
      return null;
    }
  }

  /** 目前的 session（唯讀拷貝），沒有就是 null */
  get current() {
    return this.#value ? { ...this.#value } : null;
  }

  set(value) {
    if (!SessionStore.isValid(value)) throw new TypeError("session 格式不正確");
    this.#value = { accessToken: value.accessToken, refreshToken: value.refreshToken, userId: value.userId, expiresAt: value.expiresAt };
    try { this.#storage?.setItem(this.#key, JSON.stringify(this.#value)); } catch { /* 隱私模式：只留在記憶體 */ }
  }

  clear() {
    this.#value = null;
    try { this.#storage?.removeItem(this.#key); } catch { /* ignore */ }
  }
}
