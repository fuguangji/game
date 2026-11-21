/**
 * 登入流程：登入在共用的帳號中心完成，遊戲從同源的共用登入狀態讀取，並在本機設定／解鎖加密金鑰。
 *   1. 帳號中心登入／登出 → 遊戲（先開著或之後才開）都讀得到
 *   2. 加密金鑰：第一次設定、解鎖、密碼錯誤
 *   3. 遊戲內的登入畫面：只有「前往帳號中心」，沒有密碼欄位；導向網址與回來後的提示
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../js/account/api-client.js";
import { AccountService } from "../js/account/account-service.js";
import { AccountView, LOGIN_REDIRECT_FLAG, markLoginRedirect, takeLoginRedirect } from "../js/account/account-view.js";
import { FakeElement, fakeDocument, installFakeDom } from "./fake-dom.mjs";

installFakeDom();

/* ───────────── 假的「共用登入」：和 account/shared-auth.js 同樣的介面，狀態放在「瀏覽器本機持久化」裡 ───────────── */
function makeBrowser() {
  const persisted = { user: null }; // 同源頁面共用的那一份（模擬 Firebase browser-local persistence）
  const observers = new Set(); // 所有已載入共用登入的頁面（帳號中心、遊戲…），跨分頁會被通知
  const notify = () => { for (const fn of [...observers]) fn(persisted.user); };
  /** 每個「頁面」各自一份 auth 介面（像各自載入一次 shared-auth.js），但背後是同一份持久化狀態 */
  const page = () => ({
    signIn: async (email) => { persisted.user = { uid: "u1", email, displayName: "Pilot" }; notify(); return persisted.user; },
    signUp: async (email) => { persisted.user = { uid: "u2", email, displayName: "New" }; notify(); return persisted.user; },
    signOut: async () => { persisted.user = null; notify(); },
    getIdentityToken: async () => `token-for-${persisted.user?.uid}`,
    waitForAuthState: async () => persisted.user, // 重新整理後：從持久化還原
    observeAuth: async (fn) => { observers.add(fn); return () => observers.delete(fn); },
  });
  return { page, persisted };
}

function makeApi(state = {}) {
  const log = [];
  state.registered ??= true;
  const api = {
    log, state,
    request: async (path, { method = "GET", body } = {}) => {
      log.push(`${method} ${path}`);
      if (path === "/api/health") return null;
      if (path === "/api/identity/me") return { uid: "x" };
      if (path === "/api/profile/me") return { userId: "u1", displayName: "Pilot" };
      if (path === "/api/profile" && method === "PUT") return { displayName: body.displayName };
      if (path === "/api/keys" && method === "GET") return { registered: state.registered, ...(state.registered ? { blob: "x" } : {}) };
      if (path === "/api/keys" && method === "PUT") { state.registered = true; state.registration = body; return {}; }
      if (path === "/api/auth/logout") return null;
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return api;
}

const cryptoFake = {
  unlockAccountKeys: async (_uid, password) => { if (password !== "correct-horse") throw new ApiError("密碼錯誤，無法解開加密金鑰。", { code: "BAD_PASSWORD" }); return { id: "k1" }; },
  createAccountKeys: async (_uid, password) => ({ keys: { id: "k-new", password }, registration: { keyId: "k-new" } }),
};

const makeService = (browser, apiState) => {
  const api = makeApi(apiState);
  return { service: new AccountService({ api, auth: browser.page(), crypto: cryptoFake }), api };
};

/* ───────────── 1. 共用登入 ───────────── */

test("帳號中心登入 → 已經開著的遊戲頁立刻變成已登入（跨分頁通知）", async () => {
  const browser = makeBrowser();
  const game = makeService(browser).service;
  await game.restore();
  assert.equal(game.signedIn, false);
  const center = makeService(browser).service; // 帳號中心那一頁
  await center.restore();
  await center.logIn({ email: "a@b.co", password: "correct-horse" });
  assert.equal(game.signedIn, true);
  assert.equal(game.userId, "u1");
  assert.equal(game.unlocked, false, "遊戲這邊拿不到密碼 → 金鑰要在遊戲內另外解鎖");
});

test("帳號中心登入、導回遊戲（重新載入頁面）→ 遊戲從共用登入還原，不需要再輸入帳號", async () => {
  const browser = makeBrowser();
  const center = makeService(browser).service;
  await center.restore();
  await center.logIn({ email: "a@b.co", password: "correct-horse" });
  const reloadedGame = makeService(browser).service; // 新載入的頁面
  assert.equal(reloadedGame.signedIn, false, "還原之前是未登入");
  await reloadedGame.restore();
  assert.equal(reloadedGame.signedIn, true);
  assert.equal(reloadedGame.userId, "u1");
  assert.equal(await reloadedGame.getFreshAccessToken(), "token-for-u1", "API / WebSocket 用的 token 來自共用登入");
});

test("在帳號中心登出 → 遊戲頁同步登出，加密金鑰一併清掉", async () => {
  const browser = makeBrowser();
  const center = makeService(browser).service, game = makeService(browser).service;
  await center.restore();
  await center.logIn({ email: "a@b.co", password: "correct-horse" });
  await game.restore();
  await game.unlock("correct-horse");
  assert.equal(game.unlocked, true);
  await center.logOut();
  assert.equal(game.signedIn, false);
  assert.equal(game.unlocked, false, "登出後記憶體裡的金鑰不能留著");
  assert.equal(await game.getFreshAccessToken(), null);
});

/* ───────────── 2. 加密金鑰 ───────────── */

test("金鑰：查得到是否已設定；已設定的帳號用密碼解鎖，密碼錯誤維持鎖定", async () => {
  const browser = makeBrowser();
  const { service } = makeService(browser, { registered: true });
  await service.restore();
  await service.signIn?.call;
  await browser.page().signIn("a@b.co");
  await service.restore();
  assert.equal(await service.keysRegistered(), true);
  await assert.rejects(service.unlock("wrong"), (e) => e.code === "BAD_PASSWORD");
  assert.equal(service.unlocked, false);
  assert.deepEqual(await service.unlock("correct-horse"), { created: false });
  assert.equal(service.unlocked, true);
});

test("金鑰：在帳號中心註冊的新帳號還沒有金鑰 → 預設不會偷偷建立，要明確要求才建立並註冊", async () => {
  const browser = makeBrowser();
  const { service, api } = makeService(browser, { registered: false });
  await browser.page().signIn("new@b.co");
  await service.restore();
  assert.equal(await service.keysRegistered(), false);
  await assert.rejects(service.unlock("whatever-1234"), (e) => e.code === "KEYS_NOT_REGISTERED");
  assert.equal(service.unlocked, false);
  assert.ok(!api.log.includes("PUT /api/keys"), "沒有明確要求就不會建立金鑰");
  assert.deepEqual(await service.unlock("my-new-password", { createIfMissing: true }), { created: true });
  assert.equal(service.unlocked, true);
  assert.deepEqual(api.state.registration, { keyId: "k-new" }, "新金鑰的註冊資料已送到伺服器");
  assert.equal(await service.keysRegistered(), true);
});

test("金鑰：沒登入時查詢或解鎖會得到明確的錯誤", async () => {
  const { service } = makeService(makeBrowser());
  await service.restore();
  await assert.rejects(service.keysRegistered(), (e) => e.code === "NOT_SIGNED_IN");
  await assert.rejects(service.unlock("x"), (e) => e.code === "NOT_SIGNED_IN");
});

/* ───────────── 3. 遊戲內的登入畫面 ───────────── */

function withGlobals(fn) {
  const set = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  return async () => {
    const had = { location: Object.getOwnPropertyDescriptor(globalThis, "location"), sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage") };
    const mem = new Map();
    set("location", { href: "https://fuguangji.github.io/game/neon-shard/", origin: "https://fuguangji.github.io", assign() {} });
    set("sessionStorage", { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) });
    try { await fn({ mem }); }
    finally { // 不論測試怎麼改，都把全域變數還原成進來之前的樣子
      for (const [name, descriptor] of Object.entries(had)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
    }
  };
}

/** 給畫面用的假服務：只有畫面會碰到的成員 */
function fakeViewService(overrides = {}) {
  const svc = new EventTarget();
  const calls = { unlock: [] };
  Object.assign(svc, {
    signedIn: false, unlocked: false, userId: null, profile: null, authReady: true,
    restore: async () => {}, warmUp() {}, downloadSave: async () => { throw new Error("n/a"); }, uploadSave: async () => 1,
    logOut: async () => {},
    keysRegistered: async () => true,
    unlock: async (password, options) => { calls.unlock.push({ password, options }); svc.unlocked = true; svc.dispatchEvent(new CustomEvent("change", { detail: {} })); return { created: !!options?.createIfMissing }; },
  }, overrides);
  svc.calls = calls;
  return svc;
}
const mountView = (service, bridge = {}) => {
  const host = new FakeElement("div");
  fakeDocument.body.append(host);
  const view = AccountView.mount(host, service, { getSave: () => ({}), applySave() {}, ...bridge });
  return { host, view };
};
const buttons = (host) => host.findAll((el) => el.tagName === "BUTTON");
const byText = (host, text) => buttons(host).find((b) => b.textContent.includes(text));
const inputs = (host) => host.findAll((el) => el.tagName === "INPUT");

test("未登入：只有「前往帳號中心登入／註冊」，沒有帳號密碼欄位", withGlobals(() => {
  const { host } = mountView(fakeViewService());
  assert.ok(byText(host, "前往帳號中心登入／註冊"));
  assert.equal(inputs(host).filter((i) => ["password", "email"].includes(i.type)).length, 0, "遊戲內不再輸入密碼");
  assert.ok(!byText(host, "建立帳號"));
}));

test("按下「前往帳號中心」：導向 /game/account/、帶 returnTo 回到目前這一頁，並留下回來時顯示提示的標記", withGlobals(({ mem }) => {
  let target = null;
  const { host } = mountView(fakeViewService(), { navigate: (url) => { target = url; } });
  byText(host, "前往帳號中心登入／註冊").click();
  const url = new URL(target);
  assert.equal(url.origin + url.pathname, "https://fuguangji.github.io/game/account/");
  assert.equal(url.searchParams.get("returnTo"), "https://fuguangji.github.io/game/neon-shard/");
  assert.ok(mem.has(LOGIN_REDIRECT_FLAG), "有標記");
  assert.ok(![...mem.values()].some((v) => /token|password/i.test(v)), "標記裡沒有任何憑證");
}));

test("回來的提示標記：只能取一次、過期（30 分鐘）就失效、沒有標記或壞資料回傳 false", withGlobals(({ mem }) => {
  assert.equal(takeLoginRedirect(), false);
  markLoginRedirect(1_000_000);
  assert.equal(takeLoginRedirect(1_000_000 + 5 * 60_000), true);
  assert.equal(takeLoginRedirect(1_000_000 + 5 * 60_000), false, "取過就清掉");
  markLoginRedirect(1_000_000);
  assert.equal(takeLoginRedirect(1_000_000 + 31 * 60_000), false, "超過 30 分鐘");
  mem.set(LOGIN_REDIRECT_FLAG, "亂寫的");
  assert.equal(takeLoginRedirect(), false);
  assert.equal(mem.has(LOGIN_REDIRECT_FLAG), false, "壞資料也會被清掉");
}));

test("sessionStorage 不可用（無痕模式、被禁用）時，導向仍然可用，不丟例外", withGlobals(() => {
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  let target = null;
  const { host } = mountView(fakeViewService(), { navigate: (url) => { target = url; } });
  assert.doesNotThrow(() => byText(host, "前往帳號中心登入／註冊").click());
  assert.ok(target.includes("/game/account/"));
  assert.equal(takeLoginRedirect(), false);
}));

test("已登入、金鑰已設定：顯示「解鎖」，輸入密碼後呼叫 unlock（不建立新金鑰）", withGlobals(async () => {
  const svc = fakeViewService({ signedIn: true, userId: "u1", profile: { displayName: "Pilot" } });
  const { host } = mountView(svc);
  await new Promise((r) => setImmediate(r));
  assert.ok(byText(host, "解鎖"), "有解鎖按鈕");
  assert.ok(!byText(host, "設定並啟用"), "不是第一次設定");
  const [pw] = inputs(host).filter((i) => i.type === "password");
  pw.value = "correct-horse";
  host.find((el) => el.tagName === "FORM").dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(svc.calls.unlock, [{ password: "correct-horse", options: undefined }]);
}));

test("已登入、金鑰還沒設定（在帳號中心新註冊）：顯示「第一次設定」，兩次密碼不同不會送出，相同才建立金鑰", withGlobals(async () => {
  const svc = fakeViewService({ signedIn: true, userId: "u2", profile: { displayName: "New" }, keysRegistered: async () => false });
  const { host } = mountView(svc);
  await new Promise((r) => setImmediate(r));
  assert.ok(byText(host, "設定並啟用雲端存檔"));
  const [a, b] = inputs(host).filter((i) => i.type === "password");
  const form = () => host.find((el) => el.tagName === "FORM");
  a.value = "short"; b.value = "short";
  form().dispatch("submit");
  a.value = "long-enough-1"; b.value = "different-1";
  form().dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.equal(svc.calls.unlock.length, 0, "太短、或兩次不一致都不會送出");
  a.value = "long-enough-1"; b.value = "long-enough-1";
  form().dispatch("submit");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(svc.calls.unlock, [{ password: "long-enough-1", options: { createIfMissing: true } }]);
}));

test("查不到金鑰狀態（離線）：不會卡在「確認中」，先顯示一般解鎖畫面", withGlobals(async () => {
  const svc = fakeViewService({ signedIn: true, userId: "u1", profile: { displayName: "Pilot" }, keysRegistered: async () => { throw new ApiError("net", { code: "NETWORK" }); } });
  const { host } = mountView(svc);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(byText(host, "解鎖"));
  assert.ok(!host.textContent.includes("正在確認"));
}));
