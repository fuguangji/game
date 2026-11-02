/**
 * Firebase Authentication（REST）：註冊、登入、更新 token。
 * 後端（neon-shard-api）只驗證 Firebase ID token，帳號密碼由瀏覽器直接交給 Google；
 * 這裡不需要載入 Firebase SDK（少一個 100KB 以上的外部腳本）。
 */
import { ApiError } from "./api-client.js";
import { FIREBASE_API_KEY, FIREBASE_AUTH_ENDPOINTS } from "./config.js";

/** Firebase 錯誤代碼 → 白話說明與 HTTP 風格狀態（讓 friendlyError 沿用既有判斷） */
const ERROR_MAP = Object.freeze({
  EMAIL_EXISTS: { status: 409, code: "EMAIL_EXISTS", message: "這個電子郵件已經註冊過了，請切換到「登入」。" },
  INVALID_LOGIN_CREDENTIALS: { status: 401, code: "INVALID_CREDENTIALS", message: "電子郵件或密碼不正確。" },
  INVALID_PASSWORD: { status: 401, code: "INVALID_CREDENTIALS", message: "電子郵件或密碼不正確。" },
  EMAIL_NOT_FOUND: { status: 401, code: "INVALID_CREDENTIALS", message: "電子郵件或密碼不正確。" },
  INVALID_EMAIL: { status: 400, code: "INVALID_EMAIL", message: "電子郵件格式不正確。" },
  WEAK_PASSWORD: { status: 400, code: "WEAK_PASSWORD", message: "密碼太弱，至少需要 8 個字元。" },
  USER_DISABLED: { status: 403, code: "USER_DISABLED", message: "這個帳號已被停用。" },
  TOO_MANY_ATTEMPTS_TRY_LATER: { status: 429, code: "TOO_MANY_ATTEMPTS", message: "嘗試次數太多了，請稍後再試。" },
  TOKEN_EXPIRED: { status: 401, code: "SESSION_EXPIRED", message: "登入已過期，請重新登入。" },
  INVALID_REFRESH_TOKEN: { status: 401, code: "SESSION_EXPIRED", message: "登入已過期，請重新登入。" },
  USER_NOT_FOUND: { status: 401, code: "SESSION_EXPIRED", message: "登入已過期，請重新登入。" },
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: { status: 401, code: "SESSION_EXPIRED", message: "登入已過期，請重新登入。" },
});

function toApiError(body, httpStatus) {
  const raw = String(body?.error?.message ?? "");
  const key = raw.split(" : ")[0].trim(); // 例："WEAK_PASSWORD : Password should be at least 6 characters"
  const mapped = ERROR_MAP[key];
  if (mapped) return new ApiError(mapped.message, { status: mapped.status, code: mapped.code });
  if (key === "API_KEY_INVALID" || /API key not valid/i.test(raw)) {
    return new ApiError("Firebase API Key 不正確，請檢查 js/account/config.js。", { code: "FIREBASE_KEY_INVALID" });
  }
  return new ApiError(raw || `登入服務回應錯誤（${httpStatus}）。`, { status: httpStatus, code: key || "FIREBASE_ERROR" });
}

export class FirebaseAuthClient {
  #fetch;
  #timeoutMs;
  #now;
  #key;

  constructor({ apiKey = FIREBASE_API_KEY, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 15_000, now = Date.now } = {}) {
    this.#key = apiKey;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#now = now;
  }

  async #post(url, { json, form }) {
    if (!this.#key || this.#key === "REPLACE_ME") {
      throw new ApiError("尚未設定 Firebase API Key（js/account/config.js）。", { code: "FIREBASE_NOT_CONFIGURED" });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await this.#fetch(`${url}?key=${encodeURIComponent(this.#key)}`, {
        method: "POST",
        headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded" },
        body: json ? JSON.stringify(json) : new URLSearchParams(form).toString(),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (cause) {
      if (cause?.name === "AbortError") throw new ApiError("登入服務沒有回應，請稍後再試。", { code: "TIMEOUT", cause });
      throw new ApiError("無法連線到登入服務，請檢查網路後再試。", { code: "NETWORK", cause });
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw toApiError(body, response.status);
    return body;
  }

  /** 註冊與登入回傳格式相同 */
  #fromIdentity(r) {
    return {
      accessToken: r.idToken,
      refreshToken: r.refreshToken,
      userId: r.localId,
      expiresAt: this.#now() + (Number(r.expiresIn) || 3600) * 1000,
    };
  }

  async signUp(email, password) {
    return this.#fromIdentity(await this.#post(FIREBASE_AUTH_ENDPOINTS.signUp, { json: { email, password, returnSecureToken: true } }));
  }

  async signIn(email, password) {
    return this.#fromIdentity(await this.#post(FIREBASE_AUTH_ENDPOINTS.signIn, { json: { email, password, returnSecureToken: true } }));
  }

  /** 用 refreshToken 換新的 ID token */
  async refresh(refreshToken) {
    const r = await this.#post(FIREBASE_AUTH_ENDPOINTS.refresh, { form: { grant_type: "refresh_token", refresh_token: refreshToken } });
    return {
      accessToken: r.id_token,
      refreshToken: r.refresh_token,
      userId: r.user_id,
      expiresAt: this.#now() + (Number(r.expires_in) || 3600) * 1000,
    };
  }
}
