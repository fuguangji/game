/** NEON SHARD Render API 設定；Firebase Web 設定統一由 repo root account/firebase-config.js 管理。 */
const DEFAULT_API_BASE = "https://neon-shard-api.onrender.com";

export function safeApiBase(candidate, fallback = DEFAULT_API_BASE) {
  try {
    const url = new URL(String(candidate));
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin + url.pathname.replace(/\/$/, "");
  } catch { /* 不是合法網址 */ }
  return fallback;
}

const injectedBase = typeof window !== "undefined" ? window.NEON_SHARD_API_BASE : undefined;
export const API_BASE = injectedBase ? safeApiBase(injectedBase) : DEFAULT_API_BASE;

/** 帳號中心（共用登入頁）的預設網址：GitHub Pages 專案站台是 /game/，帳號中心在 /game/account/ */
export const DEFAULT_ACCOUNT_URL = "https://fuguangji.github.io/game/account/";

/**
 * 帳號中心網址。優先順序：
 *   1. window.NEON_SHARD_ACCOUNT_URL（測試或自訂網域時覆寫；只接受 https 或本機 http）
 *   2. 依目前頁面位置推算：遊戲在 <站台>/neon-shard/，帳號中心在 <站台>/account/
 *      （部署在 /game/neon-shard/ 時就是 /game/account/；不再寫死成網域根目錄的 /account/）
 *   3. 沒有瀏覽器環境（測試、Node）時用 DEFAULT_ACCOUNT_URL
 * @param {{returnTo?: string, locationHref?: string, override?: string}} [o]
 */
export function accountPageUrl({ returnTo, locationHref = globalThis.location?.href, override = globalThis.window?.NEON_SHARD_ACCOUNT_URL } = {}) {
  let target;
  const accept = (candidate, base) => {
    try {
      const url = new URL(String(candidate), base);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url;
    } catch { /* 不是合法網址 */ }
    return null;
  };
  if (override) target = accept(override, locationHref || DEFAULT_ACCOUNT_URL);
  if (!target && locationHref) target = accept("../account/", locationHref);
  if (!target) target = new URL(DEFAULT_ACCOUNT_URL);
  target.search = "";
  target.hash = "";
  if (returnTo) {
    const back = accept(returnTo, target.href);
    if (back && back.origin === target.origin) target.searchParams.set("returnTo", back.href); // 只允許回到同一個網站，避免被導去別處
  }
  return target.href;
}
