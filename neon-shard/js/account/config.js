/**
 * 部署設定（整個前端只有這個檔案需要填）。詳見 README.md「部署前要填的常數」。
 *
 * 所有值都可以在載入遊戲前用全域變數覆寫（例如在 index.html 的 <head> 加一段 <script>），方便本機測試：
 *   window.NEON_SHARD_API_BASE        後端網址
 *   window.NEON_SHARD_FIREBASE_KEY    Firebase Web API Key
 */

/** 後端（neon-shard-api，部署在 Render）的網址。【待填】部署後換成你的 Render 網址 */
const DEFAULT_API_BASE = "https://neon-shard-api.onrender.com";

/** Firebase Web API Key（Firebase Console → 專案設定 → 一般 → 你的應用程式 → Web）。這是公開值，不是密鑰。【待填】 */
const DEFAULT_FIREBASE_API_KEY = "REPLACE_ME";

export function safeApiBase(candidate, fallback = DEFAULT_API_BASE) {
  try {
    const url = new URL(String(candidate));
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin + url.pathname.replace(/\/$/, "");
  } catch { /* 不是合法網址 */ }
  return fallback;
}

const injectedBase = typeof window !== "undefined" ? window.NEON_SHARD_API_BASE : undefined;
const injectedKey = typeof window !== "undefined" ? window.NEON_SHARD_FIREBASE_KEY : undefined;

export const API_BASE = injectedBase ? safeApiBase(injectedBase) : DEFAULT_API_BASE;
export const FIREBASE_API_KEY = typeof injectedKey === "string" && injectedKey ? injectedKey : DEFAULT_FIREBASE_API_KEY;

/** Firebase Auth 的 REST 端點（瀏覽器直接連 Google；密碼不會經過 Render） */
export const FIREBASE_AUTH_ENDPOINTS = Object.freeze({
  signUp: "https://identitytoolkit.googleapis.com/v1/accounts:signUp",
  signIn: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
  refresh: "https://securetoken.googleapis.com/v1/token",
});

/** 是否已填好 Firebase 金鑰（沒填時登入畫面會直接說明，而不是丟出看不懂的錯誤） */
export const firebaseConfigured = () => FIREBASE_API_KEY !== "REPLACE_ME" && FIREBASE_API_KEY.length > 10;
