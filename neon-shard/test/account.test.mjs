import test from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../js/account/session-store.js";
import { ApiClient, ApiError } from "../js/account/api-client.js";
import { AccountService } from "../js/account/account-service.js";
import { safeApiBase } from "../js/account/config.js";
import { escapeHtml } from "../js/core/dom-utils.js";

const TOKEN = (c) => c.repeat(24);
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m }; };
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

function makeSessions(initial) {
  const sessions = new SessionStore(memStorage());
  if (initial) sessions.set(initial);
  return sessions;
}
const live = { accessToken: TOKEN("a"), refreshToken: TOKEN("r"), userId: "u1" };

test("SessionStore：損毀或缺欄位的資料視為未登入", () => {
  const st = memStorage();
  st.setItem("neonShardAuthSession", "{broken");
  assert.equal(new SessionStore(st).current, null);
  st.setItem("neonShardAuthSession", JSON.stringify({ accessToken: "short", refreshToken: "x" }));
  assert.equal(new SessionStore(st).current, null);
  const s = new SessionStore(st);
  s.set(live);
  assert.equal(new SessionStore(st).current.userId, "u1");
  // API currently returns an opaque refresh token shorter than 20 chars.
  assert.equal(SessionStore.isValid({ accessToken: TOKEN("a"), refreshToken: "r".repeat(12), userId: "u1" }), true);
  assert.throws(() => s.set({ accessToken: "x" }), TypeError);
  s.clear();
  assert.equal(new SessionStore(st).current, null);
});

test("safeApiBase：只接受 https 或本機 http，其餘退回預設", () => {
  assert.equal(safeApiBase("https://api.example.com/"), "https://api.example.com");
  assert.equal(safeApiBase("http://localhost:8787"), "http://localhost:8787");
  assert.equal(safeApiBase("http://evil.example.com"), "https://neon-shard-api.onrender.com");
  assert.equal(safeApiBase("javascript:alert(1)"), "https://neon-shard-api.onrender.com");
  assert.equal(safeApiBase("not a url"), "https://neon-shard-api.onrender.com");
});

test("escapeHtml：暱稱中的 HTML 會被跳脫", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml(null), "");
});

test("ApiClient：401 會自動 refresh 並用新 token 重試一次", async () => {
  const sessions = makeSessions(live);
  const calls = [];
  const api = new ApiClient({ baseUrl: "https://x.test", sessions, fetchImpl: async (url, init) => {
    calls.push([url, init.headers.Authorization]);
    if (url.endsWith("/api/auth/refresh")) return json(200, { user: { id: "u1" }, session: { accessToken: TOKEN("n"), refreshToken: TOKEN("m") } });
    return calls.filter((c) => c[0].endsWith("/api/profile/me")).length === 1 ? json(401, { error: { code: "UNAUTHORIZED", message: "expired" } }) : json(200, { displayName: "Pilot" });
  } });
  assert.deepEqual(await api.request("/api/profile/me"), { displayName: "Pilot" });
  assert.equal(sessions.current.accessToken, TOKEN("n"));
  assert.equal(calls.at(-1)[1], `Bearer ${TOKEN("n")}`);
});

test("ApiClient：refresh 失敗 → 清除 session、通知上層、丟出 SESSION_EXPIRED", async () => {
  const sessions = makeSessions(live);
  let expired = 0;
  const api = new ApiClient({ baseUrl: "https://x.test", sessions, fetchImpl: async () => json(401, { error: { code: "X", message: "no" } }) });
  api.onSessionExpired = () => expired++;
  await assert.rejects(api.request("/api/keys"), (e) => e instanceof ApiError && e.code === "SESSION_EXPIRED");
  assert.equal(sessions.current, null);
  assert.equal(expired, 1);
});

test("ApiClient：同時多個 401 只會送出一次 refresh", async () => {
  const sessions = makeSessions(live);
  let refreshes = 0;
  const api = new ApiClient({ baseUrl: "https://x.test", sessions, fetchImpl: async (url, init) => {
    if (url.endsWith("/refresh")) { refreshes++; await new Promise((r) => setTimeout(r, 10)); return json(200, { user: { id: "u1" }, session: { accessToken: TOKEN("n"), refreshToken: TOKEN("m") } }); }
    return init.headers.Authorization === `Bearer ${TOKEN("n")}` ? json(200, { ok: 1 }) : json(401, {});
  } });
  await Promise.all([api.request("/a"), api.request("/b"), api.request("/c")]);
  assert.equal(refreshes, 1);
});

test("ApiClient：逾時與斷線會給出可讀的錯誤（伺服器喚醒中不會永遠卡住）", async () => {
  const sessions = makeSessions();
  const hang = new ApiClient({ baseUrl: "https://x.test", sessions, timeoutMs: 20, fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  await assert.rejects(hang.request("/x", { auth: false }), (e) => e.code === "TIMEOUT" && /喚醒/.test(e.message));
  const down = new ApiClient({ baseUrl: "https://x.test", sessions, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(down.request("/x", { auth: false }), (e) => e.code === "NETWORK");
  const none = new ApiClient({ baseUrl: "", sessions });
  await assert.rejects(none.request("/x"), (e) => e.code === "NO_API_BASE");
});

test("ApiClient：解析伺服器錯誤碼，204 回傳 null", async () => {
  const sessions = makeSessions();
  const api = new ApiClient({ baseUrl: "https://x.test", sessions, fetchImpl: async (url) => url.endsWith("/none") ? { status: 204, ok: true } : json(404, { error: { code: "SAVE_NOT_FOUND", message: "No save exists for this account." } }) });
  assert.equal(await api.request("/none", { auth: false }), null);
  await assert.rejects(api.request("/x", { auth: false }), (e) => e.status === 404 && e.code === "SAVE_NOT_FOUND");
});

/* ---- AccountService（用假的 API 與假的加密） ---- */
function makeService({ remote = null, failLogout = false } = {}) {
  const sessions = makeSessions();
  const log = [];
  let stored = remote;
  const api = {
    onSessionExpired: null,
    request: async (path, { method = "GET", body } = {}) => {
      log.push(`${method} ${path}`);
      if (path === "/api/auth/login") return { user: { id: "u1" }, session: { accessToken: TOKEN("a"), refreshToken: TOKEN("r") } };
      if (path === "/api/keys" && method === "GET") return { registered: true };
      if (path === "/api/profile/me") return { userId: "u1", displayName: "Pilot" };
      if (path === "/api/auth/logout") { if (failLogout) throw new ApiError("down", { code: "NETWORK" }); return null; }
      if (path === "/api/player-data" && method === "GET") { if (!stored) throw new ApiError("No save", { status: 404, code: "SAVE_NOT_FOUND" }); return stored; }
      if (path === "/api/player-data") { if (body.expectedRevision === 99) throw new ApiError("conflict", { status: 409, code: "REVISION_CONFLICT" }); stored = { revision: (stored?.revision ?? 0) + 1, sensitiveEnvelope: body.sensitiveEnvelope }; return { revision: stored.revision }; }
      throw new Error("unexpected " + path);
    },
  };
  const crypto = {
    unlockAccountKeys: async () => ({ k: 1 }), createAccountKeys: async () => ({ keys: { k: 1 }, registration: {} }),
    encryptSave: async (uid, keys, save) => ({ keyId: "k1", blob: JSON.stringify(save) }),
    decryptSave: async (uid, keys, env) => JSON.parse(env.blob), signSaveRequest: async () => "sig",
  };
  return { svc: new AccountService({ api, sessions, crypto }), sessions, log, api };
}

test("AccountService：登入 → 取得暱稱並解鎖；未登入時暱稱為「訪客」", async () => {
  const { svc } = makeService();
  assert.equal(svc.displayName, "訪客");
  let changes = 0; svc.addEventListener("change", () => changes++);
  await svc.logIn({ email: "a@b.co", password: "pw" });
  assert.equal(svc.signedIn && svc.unlocked, true);
  assert.equal(svc.displayName, "Pilot");
  assert.ok(changes >= 1);
});

test("AccountService：沒有雲端存檔用錯誤碼判斷後 POST；已有存檔 PUT 並帶 expectedRevision", async () => {
  const { svc, log } = makeService();
  await svc.logIn({ email: "a@b.co", password: "pw" });
  assert.equal(await svc.uploadSave({ coins: 5 }), 1);
  assert.ok(log.includes("POST /api/player-data"));
  assert.equal(await svc.uploadSave({ coins: 6 }), 2);
  assert.ok(log.includes("PUT /api/player-data"));
  assert.deepEqual((await svc.downloadSave()).save, { coins: 6 });
});

test("AccountService：版本衝突給出可讀訊息；下載到非物件資料會拒絕", async () => {
  const c = makeService({ remote: { revision: 99, sensitiveEnvelope: { blob: "[]" } } });
  await c.svc.logIn({ email: "a@b.co", password: "pw" });
  await assert.rejects(c.svc.uploadSave({ coins: 1 }), (e) => e.code === "REVISION_CONFLICT" && /其他裝置/.test(e.message));
  await assert.rejects(c.svc.downloadSave(), (e) => e.code === "BAD_SAVE");
});

test("AccountService：登出一定清掉本機狀態，即使伺服器登出失敗", async () => {
  const { svc, sessions } = makeService({ failLogout: true });
  await svc.logIn({ email: "a@b.co", password: "pw" });
  const warn = console.warn; console.warn = () => {};
  await svc.logOut();
  console.warn = warn;
  assert.equal(sessions.current, null);
  assert.equal(svc.signedIn || svc.unlocked, false);
  assert.equal(svc.displayName, "訪客");
});

test("AccountService：session 過期時重設狀態並通知畫面（修正過去頁面卡在已登入的問題）", async () => {
  const { svc, api } = makeService();
  await svc.logIn({ email: "a@b.co", password: "pw" });
  let notice = "";
  svc.addEventListener("change", (e) => { notice = e.detail.notice; });
  api.onSessionExpired();
  assert.match(notice, /過期/);
  assert.equal(svc.unlocked, false);
  assert.equal(svc.displayName, "訪客");
});

test("AccountService：未解鎖時上傳／下載會被擋下", async () => {
  const { svc } = makeService();
  await assert.rejects(svc.uploadSave({}), (e) => e.code === "NOT_SIGNED_IN");
});
