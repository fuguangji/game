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
