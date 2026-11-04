/**
 * Render 休眠喚醒心跳。
 * 頁面開啟時立即請求 /api/health，之後每 10 秒一次；同一時間只保留一個請求。
 * 瀏覽器切回前景或網路恢復時立即補發。此請求不帶登入 Token，也不攜帶 Cookie。
 */
export class ServerHeartbeat {
  #url;
  #fetch;
  #intervalMs;
  #timeoutMs;
  #setInterval;
  #clearInterval;
  #document;
  #window;
  #timer = null;
  #pending = null;

  constructor({
    baseUrl,
    intervalMs = 10_000,
    timeoutMs = 75_000,
    fetchImpl = (...args) => globalThis.fetch(...args),
    setIntervalImpl = (...args) => globalThis.setInterval(...args),
    clearIntervalImpl = (...args) => globalThis.clearInterval(...args),
    documentRef = globalThis.document,
    windowRef = globalThis.window,
  } = {}) {
    this.#url = String(baseUrl || "").replace(/\/$/, "");
    this.#fetch = fetchImpl;
    this.#intervalMs = Math.max(1_000, Number(intervalMs) || 10_000);
    this.#timeoutMs = Math.max(10_000, Number(timeoutMs) || 75_000);
    this.#setInterval = setIntervalImpl;
    this.#clearInterval = clearIntervalImpl;
    this.#document = documentRef;
    this.#window = windowRef;
  }

  start() {
    if (this.#timer !== null || !this.#url) return this;
    this.ping();
    this.#timer = this.#setInterval(() => this.ping(), this.#intervalMs);
    this.#document?.addEventListener("visibilitychange", this.#onVisibility);
    this.#window?.addEventListener("online", this.#onOnline);
    return this;
  }

  stop() {
    if (this.#timer !== null) this.#clearInterval(this.#timer);
    this.#timer = null;
    this.#document?.removeEventListener("visibilitychange", this.#onVisibility);
    this.#window?.removeEventListener("online", this.#onOnline);
  }

  ping() {
    if (!this.#url) return Promise.resolve(false);
    if (this.#pending) return this.#pending;
    this.#pending = Promise.resolve()
      .then(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
        try {
          const response = await this.#fetch(`${this.#url}/api/health`, {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
            credentials: "omit",
            signal: controller.signal,
          });
          return Boolean(response?.ok);
        } finally {
          clearTimeout(timeout);
        }
      })
      .catch(() => false)
      .finally(() => { this.#pending = null; });
    return this.#pending;
  }

  #onVisibility = () => {
    if (this.#document?.visibilityState !== "hidden") this.ping();
  };

  #onOnline = () => { this.ping(); };
}
