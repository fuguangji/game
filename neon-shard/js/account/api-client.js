/**
 * API 用戶端：逾時、錯誤碼、token 自動更新都在這裡處理，畫面層只需要處理 ApiError。
 */
export class ApiError extends Error {
  constructor(message, { status = 0, code = "", cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  #base;
  #sessions;
  #timeoutMs;
  #fetch;
  #refreshing = null;
  /** session 無法更新（已過期）時呼叫，讓上層回到登入畫面 */
  onSessionExpired = () => {};

  /**
   * @param {{baseUrl:string, sessions:import('./session-store.js').SessionStore, timeoutMs?:number, fetchImpl?:typeof fetch}} o
   */
  constructor({ baseUrl, sessions, timeoutMs = 25_000, fetchImpl = (...a) => globalThis.fetch(...a), getAuthToken = null }) {
    this.#base = String(baseUrl || "").replace(/\/$/, "");
    this.#sessions = sessions;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;\n    this.#getAuthToken = typeof getAuthToken === "function" ? getAuthToken : null;
  }

  async request(path, { method = "GET", body, auth = true } = {}) {
    if (!this.#base) throw new ApiError("尚未設定雲端伺服器網址。", { code: "NO_API_BASE" });
    try {
      return await this.#send(path, { method, body, auth });
    } catch (error) {
      if (!(auth && error instanceof ApiError && error.status === 401)) throw error;
      if (this.#getAuthToken) {
        try {
          const refreshedToken = await this.#getAuthToken(true);
          if (refreshedToken) return this.#send(path, { method, body, auth });
        } catch { /* token refresh failed; expire below */ }
        this.#expire();
        throw new ApiError("登入已過期，請重新登入。", { status: 401, code: "SESSION_EXPIRED" });
      }
      if (!this.#sessions.current) throw error;
      if (!(await this.#refresh())) {
        this.#expire();
        throw new ApiError("登入已過期，請重新登入。", { status: 401, code: "SESSION_EXPIRED" });
      }
      return this.#send(path, { method, body, auth }); // 用新 token 重試一次
    }
  }

  async #send(path, { method, body, auth }) {
    const headers = { "Content-Type": "application/json" };
    const session = this.#sessions.current;
    if (auth && this.#getAuthToken) {
      const token = await this.#getAuthToken(false);
      if (token) headers.Authorization = `Bearer ${token}`;
    } else if (auth && session) headers.Authorization = `Bearer ${session.accessToken}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await this.#fetch(this.#base + path, {
        method, headers, cache: "no-store", signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      if (cause?.name === "AbortError") {
        throw new ApiError("伺服器沒有回應。免費主機閒置後需要 30～60 秒喚醒，請稍後再試一次。", { code: "TIMEOUT", cause });
      }
      throw new ApiError("無法連線到伺服器，請檢查網路後再試。", { code: "NETWORK", cause });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(result?.error?.message || `API 請求失敗（${response.status}）`, {
        status: response.status, code: result?.error?.code || "",
      });
    }
    return result;
  }

  /** 單一飛行：同時多個請求遇到 401 只會送出一次 refresh */
  #refresh() {
    this.#refreshing ??= (async () => {
      const current = this.#sessions.current;
      if (!current) return false;
      try {
        const result = await this.#send("/api/auth/refresh", { method: "POST", auth: false, body: { refreshToken: current.refreshToken } });
        this.#sessions.set({ ...result.session, userId: result.user?.id ?? current.userId });
        return true;
      } catch {
        return false;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }

  #expire() {
    this.#sessions.clear();
    try { this.onSessionExpired(); } catch (error) { console.error(error); }
  }
}
