/**
 * 雲端 API 網址。可在載入遊戲前用 window.NEON_SHARD_API_BASE 覆寫（例如本機測試）。
 * 只接受 https，或本機開發用的 http://localhost / 127.0.0.1，避免登入資料走明文或被導向奇怪的網址。
 */
const DEFAULT_API_BASE = "https://neon-shard-api.onrender.com";

export function safeApiBase(candidate, fallback = DEFAULT_API_BASE) {
  try {
    const url = new URL(String(candidate));
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin + url.pathname.replace(/\/$/, "");
  } catch { /* 不是合法網址 */ }
  return fallback;
}

const injected = typeof window !== "undefined" ? window.NEON_SHARD_API_BASE : undefined;
export const API_BASE = injected ? safeApiBase(injected) : DEFAULT_API_BASE;
