/**
 * Render API 用戶端。Firebase SDK 管理登入狀態與 ID Token 更新；
 * 本類別只負責附加 Token、逾時、錯誤處理，以及 401 時強制更新 Token 後重試一次。
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
  #timeoutMs;
  #fetch;
  #getToken;
  #refreshing = null;

  constructor({ baseUrl, getToken, timeoutMs = 25_000, fetchImpl = (...a) => globalThis.fetch(...a) }) {
    if (typeof getToken !== "function") throw new TypeError("ApiClient 需要 Firebase ID Token provider。");
    this.#base = String(baseUrl || "").replace(/\/$/, "");
    this.#getToken = getToken;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  async request(path, { method = "GET", body, auth = true } = {}) {
    if (!this.#base) throw new ApiError("尚未設定雲端伺服器網址。", { code: "NO_API_BASE" });
    try {
      return await this.#send(path, { method, body, auth, forceRefresh: false });
    } catch (error) {
      if (!(auth && error instanceof ApiError && error.status === 401)) throw error;
      const token = await this.#refreshToken();
      if (!token) throw error;
      // 只重試一次；Render 的拒絕不會擅自登出 Firebase 共用帳號。
      return this.#send(path, { method, body, auth, forceRefresh: true, token });
    }
  }

  async #refreshToken() {
    this.#refreshing ??= Promise.resolve(this.#getToken(true)).catch(() => null).finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async #send(path, { method, body, auth, forceRefresh, token: suppliedToken }) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = suppliedToken ?? await this.#getToken(forceRefresh);
      if (!token) throw new ApiError("請先登入遊戲帳號，再使用雲端功能。", { status: 401, code: "NOT_SIGNED_IN" });
      headers.Authorization = `Bearer ${token}`;
    }
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
}
