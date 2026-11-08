/**
 * 同源遊戲共用登入狀態入口。
 * Firebase SDK 自行還原 browser-local persistence；這裡只發布非敏感的使用者識別資料，
 * 不讀寫 Cookie/localStorage/sessionStorage，也不把 ID Token 暴露給遊戲頁。
 */
import { observeAuth } from "./shared-auth.js";

let resolveReady;
const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
const state = {
  ready: false,
  user: null,
  error: null,
  readyPromise,
};

window.SITE_AUTH = state;

function publish(user, error = null) {
  const identity = user ? {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
  } : null;
  state.user = identity;
  state.error = error ? String(error.message || error) : null;
  state.ready = true;
  const detail = { ready: true, user: identity, error: state.error };
  resolveReady(detail);
  window.dispatchEvent(new CustomEvent("site:auth-state", { detail }));
}

try {
  await observeAuth(
    (user) => publish(user),
    (error) => publish(null, error),
  );
} catch (error) {
  publish(null, error);
}
