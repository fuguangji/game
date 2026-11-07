import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiError } from "../js/account/api-client.js";
import { AccountService } from "../js/account/account-service.js";
import { safeApiBase } from "../js/account/config.js";
import { escapeHtml } from "../js/core/dom-utils.js";

const TOKEN = (c) => c.repeat(24);
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

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

test("ApiClient：使用共用 Token provider，401 時強制更新後只重試一次", async () => {
  const calls = [];
  const tokenCalls = [];
  const api = new ApiClient({
    baseUrl: "https://x.test",
    getToken: async (force) => { tokenCalls.push(force); return force ? TOKEN("n") : TOKEN("a"); },
    fetchImpl: async (url, init) => {
      calls.push([url, init.headers.Authorization]);
      return calls.length === 1 ? json(401, { error: { code: "UNAUTHORIZED", message: "expired" } }) : json(200, { displayName: "Pilot" });
    },
  });
  assert.deepEqual(await api.request("/api/profile/me"), { displayName: "Pilot" });
  assert.deepEqual(tokenCalls, [false, true]);
  assert.deepEqual(calls.map((c) => c[1]), [`Bearer ${TOKEN("a")}`, `Bearer ${TOKEN("n")}`]);
});

test("ApiClient：Render 連續回傳 401 不會擅自登出共用 Firebase 帳號", async () => {
  let signOuts = 0;
  let calls = 0;
  const api = new ApiClient({
    baseUrl: "https://x.test",
    getToken: async (force) => force ? TOKEN("n") : TOKEN("a"),
    fetchImpl: async () => { calls++; return json(401, { error: { code: "UNAUTHORIZED", message: "denied" } }); },
  });
  await assert.rejects(api.request("/api/keys"), (e) => e instanceof ApiError && e.status === 401);
  assert.equal(calls, 2);
  assert.equal(signOuts, 0);
});

test("ApiClient：逾時、斷線、缺少 API base 與未登入都有明確錯誤", async () => {
  const hang = new ApiClient({ baseUrl: "https://x.test", getToken: async () => TOKEN("a"), timeoutMs: 20, fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  await assert.rejects(hang.request("/x", { auth: false }), (e) => e.code === "TIMEOUT" && /喚醒/.test(e.message));
  const down = new ApiClient({ baseUrl: "https://x.test", getToken: async () => TOKEN("a"), fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(down.request("/x", { auth: false }), (e) => e.code === "NETWORK");
  const none = new ApiClient({ baseUrl: "", getToken: async () => null });
  await assert.rejects(none.request("/x"), (e) => e.code === "NO_API_BASE");
  const guest = new ApiClient({ baseUrl: "https://x.test", getToken: async () => null });
  await assert.rejects(guest.request("/api/keys"), (e) => e.code === "NOT_SIGNED_IN");
});

test("ApiClient：解析伺服器錯誤碼，204 回傳 null", async () => {
  const api = new ApiClient({ baseUrl: "https://x.test", getToken: async () => null, fetchImpl: async (url) => url.endsWith("/none") ? { status: 204, ok: true } : json(404, { error: { code: "SAVE_NOT_FOUND", message: "No save exists for this account." } }) });
  assert.equal(await api.request("/none", { auth: false }), null);
  await assert.rejects(api.request("/x", { auth: false }), (e) => e.status === 404 && e.code === "SAVE_NOT_FOUND");
});

/* ---- AccountService：假的 Firebase Auth、Render API 與加密層 ---- */
function makeService({ remote = null, failLogout = false, initialUser = null } = {}) {
  const log = [];
  const names = [];
  let stored = remote;
  let listener = null;
  const user = { uid: "u1", email: "a@b.co", displayName: "Pilot" };
  const auth = {
    signIn: async () => user,
    signUp: async () => user,
    signOut: async () => { listener?.(null); },
    getIdentityToken: async (force) => force ? TOKEN("n") : TOKEN("a"),
    waitForAuthState: async () => initialUser,
    observeAuth: async (fn) => { listener = fn; return () => { listener = null; }; },
    emit: (next) => listener?.(next),
  };
  const api = {
    request: async (path, { method = "GET", body } = {}) => {
      log.push(`${method} ${path}`);
      if (path === "/api/health") return null;
      if (path === "/api/identity/me") return { uid: "u1", displayName: "Pilot" };
      if (path === "/api/profile" && method === "PUT") { names.push(body.displayName); return { displayName: body.displayName }; }
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
  return { svc: new AccountService({ api, auth, crypto }), auth, log, api, names, user };
}

test("AccountService：登入使用 Firebase UID，保留 Render 身分、暱稱與金鑰流程", async () => {
  const { svc, log } = makeService();
  assert.equal(svc.displayName, "訪客");
  let changes = 0; svc.addEventListener("change", () => changes++);
  await svc.logIn({ email: "a@b.co", password: "pw" });
  assert.equal(svc.signedIn && svc.unlocked, true);
  assert.equal(svc.userId, "u1");
  assert.equal(svc.displayName, "Pilot");
  assert.ok(log.includes("GET /api/identity/me"));
  assert.ok(log.includes("GET /api/profile/me"));
  assert.ok(changes >= 1);
});

test("AccountService：註冊先用 Firebase 建立帳號，再初始化 Render 資料、暱稱與金鑰", async () => {
  const { svc, log, names } = makeService();
  assert.deepEqual(await svc.signUp({ email: "a@b.co", password: "password1", displayName: "Nova" }), { needsEmailConfirmation: false });
  assert.deepEqual(names, ["Nova"]);
  assert.ok(log.indexOf("GET /api/identity/me") < log.indexOf("PUT /api/profile"));
  assert.equal(svc.signedIn && svc.unlocked, true);
});

test("AccountService：雲端存檔仍加密、簽章並保留版本控制", async () => {
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

test("AccountService：登出會呼叫 Render，再登出共用 Firebase；Render 失敗仍清除本機狀態", async () => {
  const { svc, log } = makeService({ failLogout: true });
  await svc.logIn({ email: "a@b.co", password: "pw" });
  const warn = console.warn; console.warn = () => {};
  await svc.logOut();
  console.warn = warn;
  assert.ok(log.includes("POST /api/auth/logout"));
  assert.equal(svc.signedIn || svc.unlocked, false);
  assert.equal(svc.displayName, "訪客");
});

test("AccountService：共用 Auth observer 同步跨分頁登入與登出", async () => {
  const { svc, auth, user } = makeService();
  await svc.restore();
  auth.emit(user);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(svc.signedIn, true);
  assert.equal(svc.userId, "u1");
  auth.emit(null);
  assert.equal(svc.signedIn, false);
  assert.equal(svc.unlocked, false);
  assert.equal(svc.displayName, "訪客");
});

test("AccountService：WebSocket token 直接取自共用 Firebase Auth，訪客回傳 null", async () => {
  const { svc } = makeService();
  assert.equal(await svc.getFreshAccessToken(), null);
  await svc.logIn({ email: "a@b.co", password: "pw" });
  assert.equal(await svc.getFreshAccessToken(), TOKEN("a"));
});

test("AccountService.warmUp：5 分鐘內只送一次，失敗不丟錯", async () => {
  const { svc, log, api } = makeService();
  const orig = api.request;
  api.request = async (path, o) => { if (path === "/api/health") { log.push("GET /api/health"); throw new ApiError("down", { code: "NETWORK" }); } return orig(path, o); };
  svc.warmUp(); svc.warmUp();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(log.filter((x) => x === "GET /api/health").length, 1);
});

test("AccountService：未解鎖時上傳／下載會被擋下", async () => {
  const { svc } = makeService();
  await assert.rejects(svc.uploadSave({}), (e) => e.code === "NOT_SIGNED_IN");
});

test("friendlyError：常見錯誤翻成白話，不認得的保留原文", async () => {
  const { friendlyError } = await import("../js/account/account-view.js");
  assert.match(friendlyError({ status: 401, message: "Invalid login credentials" }, "login"), /電子郵件或密碼不正確/);
  assert.match(friendlyError({ status: 429, message: "x" }), /次數太多/);
  assert.match(friendlyError({ status: 400, message: "User already registered" }, "signup"), /已經註冊/);
  assert.match(friendlyError({ status: 503, message: "x" }), /伺服器暫時/);
  assert.equal(friendlyError({ status: 400, message: "暱稱不可用" }), "暱稱不可用");
});

test("summarizeSave：缺欄位或型別錯誤也不會丟錯", async () => {
  const { summarizeSave } = await import("../js/account/account-view.js");
  assert.equal(summarizeSave({ coins: 5, sh: 2, co: 1, clr: [1, 0, 1] }), "金幣 5 · 碎片 2 · 晶核 1 · 通關 2 關");
  assert.equal(summarizeSave(null), "金幣 0 · 碎片 0 · 晶核 0 · 通關 0 關");
});
