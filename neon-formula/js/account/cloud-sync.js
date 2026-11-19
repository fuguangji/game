/**
 * 雲端同步引擎：把「上傳／下載」兩顆按鈕變成會自己跑的同步。
 *
 * 它做的事：
 *   - 本機存檔有變動 → 等一小段時間（去抖）→ 自動加密上傳
 *   - 登入、解鎖、回到分頁、恢復網路、每隔幾分鐘 → 檢查雲端有沒有別台裝置的新進度
 *   - 兩邊都有新進度 → 用「上次同步的存檔」當底做三方合併（見 save-merge.js），不必玩家二選一
 *   - 第一次同步、兩邊都有進度又沒有共同的底 → 不敢自動決定，停在「衝突」讓玩家選
 *   - 網路失敗 → 標示離線，指數退避後自動重試；登入／金鑰問題 → 不亂重試，等玩家處理
 *   - 戰鬥中不會把雲端進度塞進本機（會打斷遊戲），等回到選單再套用
 *
 * 狀態（status）：off 未登入 · locked 需要解鎖 · idle 待命 · syncing 同步中 · synced 已同步
 *               pending 雲端有新進度，等回到選單 · conflict 需要玩家選擇 · offline 離線，稍後重試 · error 出錯
 *
 * 引擎本身不碰遊戲全域狀態：存檔存取（bridge）、帳號（service）、儲存（storage）、計時器都由外面注入，所以可以完整測試。
 */
import { ApiError } from "./api-client.js";
import { isPristine, mergeSaves, sameSave } from "./save-merge.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 300_000;

const isNetworkError = (e) => e instanceof ApiError && (["NETWORK", "TIMEOUT"].includes(e.code) || e.status === 429 || e.status >= 500);
const isSessionError = (e) => e instanceof ApiError && ["AUTH_CHANGED", "NOT_SIGNED_IN", "LOCKED"].includes(e.code);

export class CloudSync extends EventTarget {
  #service;
  #bridge;
  #storage;
  #defaults;
  #now;
  #setTimer;
  #clearTimer;
  #debounceMs;
  #autoEnabled;

  #status = "off";
  #message = "";
  #lastSyncAt = 0;
  #running = null;
  #again = false;
  #debounce = null;
  #retry = null;
  #fails = 0;
  #pending = null; // { save, revision }：雲端有新進度，等 canApply
  #conflict = null; // { local, remote: { save, revision } }
  #wasReady = false;
  #uid = null;

  /**
   * @param {object} deps
   * @param {object} deps.service    AccountService（signedIn / unlocked / userId / uploadSave / downloadSave / addEventListener）
   * @param {object} deps.bridge     { getSave(): 本機存檔, applySave(save): 套用到本機, normalize(save): 補預設值與遷移, canApply(): 現在能不能改本機 }
   * @param {object} deps.storage    { get(): meta|null, set(meta), clear() }：保存「上次同步」資訊
   * @param {object} deps.defaults   預設存檔（新玩家的樣子）
   * @param {() => boolean} [deps.autoEnabled]  是否啟用自動同步（設定頁的開關）
   */
  constructor({ service, bridge, storage, defaults, autoEnabled = () => true, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), debounceMs = 8_000 }) {
    super();
    this.#service = service;
    this.#bridge = bridge;
    this.#storage = storage;
    this.#defaults = defaults;
    this.#autoEnabled = autoEnabled;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#debounceMs = debounceMs;
    service.addEventListener?.("change", () => this.#onAccountChange());
    this.#refreshStatusFromAccount();
  }

  get status() { return this.#status; }
  get message() { return this.#message; }
  get lastSyncAt() { return this.#lastSyncAt; }
  get revision() { return this.#meta()?.revision ?? null; }
  get conflict() { return this.#conflict; }
  get pending() { return this.#pending; }
  get busy() { return this.#running !== null; }

  /* ───────────── 狀態 ───────────── */

  #set(status, message = "") {
    this.#status = status;
    this.#message = message;
    this.dispatchEvent(new CustomEvent("status", { detail: { status, message, lastSyncAt: this.#lastSyncAt, revision: this.revision } }));
  }

  #refreshStatusFromAccount() {
    if (!this.#service.signedIn) return this.#set("off");
    if (!this.#service.unlocked) return this.#set("locked");
    if (this.#status === "off" || this.#status === "locked") this.#set("idle");
  }

  /** 帳號狀態改變：換了人就重置；剛解鎖就立刻同步一次 */
  #onAccountChange() {
    const uid = this.#service.userId ?? null;
    if (uid !== this.#uid) {
      this.#uid = uid;
      this.#pending = null;
      this.#conflict = null;
      this.#fails = 0;
      this.#cancelTimers();
    }
    const ready = this.#service.signedIn && this.#service.unlocked;
    if (!ready) {
      this.#wasReady = false;
      this.#cancelTimers();
      return this.#refreshStatusFromAccount();
    }
    if (!this.#wasReady) {
      this.#wasReady = true;
      this.#set("idle");
      if (this.#autoEnabled()) this.sync({ reason: "unlock" });
    }
  }

  /* ───────────── 「上次同步」資訊（每個帳號各一份） ───────────── */

  #meta(userId = this.#service.userId) {
    const meta = this.#storage.get();
    return meta && meta.userId === userId && Number.isInteger(meta.revision) && meta.base && typeof meta.base === "object" ? meta : null;
  }

  #saveMeta(userId, revision, base) {
    this.#storage.set({ userId, revision, base: clone(base), at: this.#now() });
    this.#lastSyncAt = this.#now();
  }

  /** 登出時由外面呼叫：忘掉「上次同步」資訊，避免下一位用這台裝置登入的人拿到別人的合併底 */
  forget() {
    this.#storage.clear();
    this.#pending = null;
    this.#conflict = null;
    this.#cancelTimers();
  }

  /* ───────────── 觸發時機 ───────────── */

  #cancelTimers() {
    if (this.#debounce) this.#clearTimer(this.#debounce);
    if (this.#retry) this.#clearTimer(this.#retry);
    this.#debounce = this.#retry = null;
  }

  /** 本機存檔剛改過：安排一次上傳（連續改動只會上傳一次） */
  markDirty() {
    if (!this.#autoEnabled() || !this.#service.signedIn || !this.#service.unlocked) return;
    if (this.#status === "conflict") return; // 衝突沒解決前不動雲端
    if (this.#debounce) this.#clearTimer(this.#debounce);
    this.#debounce = this.#setTimer(() => { this.#debounce = null; this.sync({ reason: "dirty" }); }, this.#debounceMs);
  }

  /** 要離開分頁了：如果有「等去抖」的上傳，現在就送，不要等到計時結束（那時分頁可能已經被凍結） */
  flush() {
    if (!this.#debounce) return;
    this.#clearTimer(this.#debounce);
    this.#debounce = null;
    if (this.#autoEnabled() && this.#service.signedIn && this.#service.unlocked) this.sync({ reason: "dirty" });
  }

  /** 回到分頁、恢復網路、回到選單等時機：檢查雲端有沒有新進度，也處理等待中的套用 */
  poke(reason = "poll") {
    if (!this.#autoEnabled()) return;
    if (this.#pending && this.#bridge.canApply()) return void this.#applyPending();
    if (this.#service.signedIn && this.#service.unlocked && this.#status !== "conflict" && this.#status !== "syncing") this.sync({ reason });
  }

  /** 現在能不能安全地改本機存檔；回到選單時由遊戲端呼叫，用來套用先前被延後的雲端進度 */
  async #applyPending() {
    const pending = this.#pending;
    if (!pending) return;
    await this.sync({ reason: "pending" });
  }

  /* ───────────── 同步 ───────────── */

  /**
   * 立刻同步一次（同一時間只會跑一個；跑的途中又被呼叫，會在這次結束後再補跑一次）
   * @param {{reason?: "manual"|"unlock"|"dirty"|"poll"|"pending"}} [options]
   */
  sync({ reason = "manual" } = {}) {
    if (this.#running) { this.#again = true; return this.#running; }
    this.#running = this.#doSync(reason).finally(() => {
      this.#running = null;
      if (this.#again) { this.#again = false; this.#debounce ??= this.#setTimer(() => { this.#debounce = null; this.sync({ reason: "poll" }); }, 300); }
    });
    return this.#running;
  }

  async #doSync(reason) {
    const svc = this.#service;
    if (!svc.signedIn) return this.#set("off");
    if (!svc.unlocked) return this.#set("locked");
    if (this.#status === "conflict" && reason !== "manual") return;
    const userId = svc.userId;
    const sameUser = () => svc.signedIn && svc.unlocked && svc.userId === userId;
    // 自動觸發、而且本機沒有變動：不必打擾伺服器（雲端有沒有新進度由 poll 負責檢查）
    if (reason === "dirty") {
      const meta = this.#meta(userId);
      if (meta && sameSave(this.#bridge.normalize(this.#bridge.getSave()), meta.base)) return this.#set("synced");
    }
    this.#set("syncing");
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const outcome = await this.#attempt(userId);
        if (!sameUser()) throw new ApiError("登入帳號已變更。", { code: "AUTH_CHANGED" });
        if (outcome !== "retry") return this.#finish(outcome);
      }
      throw new ApiError("雲端存檔一直被其他裝置更新，請稍後再試。", { code: "REVISION_CONFLICT", status: 409 });
    } catch (error) {
      this.#fail(error);
    }
  }

  #finish(outcome) {
    this.#fails = 0;
    if (this.#retry) { this.#clearTimer(this.#retry); this.#retry = null; }
    if (outcome === "conflict") return this.#set("conflict", "這台裝置和雲端都有進度，需要你決定怎麼處理。");
    if (outcome === "pending") return this.#set("pending", "雲端有新的進度，回到主選單後會自動載入。");
    this.#set("synced", "");
  }

  #fail(error) {
    if (isSessionError(error)) return this.#refreshStatusFromAccount();
    if (isNetworkError(error)) {
      this.#fails++;
      const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.#fails - 1));
      this.#set("offline", `連不上雲端，${Math.round(wait / 1000)} 秒後自動重試。進度仍保存在這台裝置。`);
      if (this.#retry) this.#clearTimer(this.#retry);
      if (this.#autoEnabled()) this.#retry = this.#setTimer(() => { this.#retry = null; this.sync({ reason: "poll" }); }, wait);
      return;
    }
    this.#set("error", error?.message || "同步失敗。");
  }

  /** 一輪「取得雲端 → 比對 → 上傳／套用」。回傳 "done" | "pending" | "conflict" | "retry"（上傳時撞到版本衝突，要重來） */
  async #attempt(userId) {
    const svc = this.#service, bridge = this.#bridge;
    const local = bridge.normalize(bridge.getSave());
    const meta = this.#meta(userId);

    let remote = null;
    try {
      const got = await svc.downloadSave();
      remote = { save: bridge.normalize(got.save), revision: got.revision };
    } catch (error) {
      if (error?.code !== "SAVE_NOT_FOUND") throw error;
    }

    // 雲端還沒有存檔
    if (!remote) {
      if (isPristine(local, this.#defaults)) return "done"; // 本機也是空的，沒東西可傳
      return this.#upload(userId, local, null);
    }

    // 兩邊一樣
    if (sameSave(local, remote.save)) {
      this.#saveMeta(userId, remote.revision, local);
      return "done";
    }

    // 上次同步之後，雲端沒有被別人動過 → 只需要處理本機的變動
    if (meta && meta.revision === remote.revision) {
      if (sameSave(local, meta.base)) return "done";
      return this.#upload(userId, local, remote.revision);
    }

    // 雲端有新進度
    if (meta) {
      const localUnchanged = sameSave(local, meta.base);
      if (localUnchanged) return this.#adopt(userId, remote);
      const { save: merged } = mergeSaves({ base: meta.base, local, remote: remote.save, defaults: this.#defaults });
      return this.#adoptMergedAndUpload(userId, merged, local, remote);
    }

    // 沒有共同的底：只有一邊有進度就用那一邊；兩邊都有就交給玩家
    if (isPristine(local, this.#defaults)) return this.#adopt(userId, remote);
    if (isPristine(remote.save, this.#defaults)) return this.#upload(userId, local, remote.revision);
    this.#conflict = { local, remote };
    return "conflict";
  }

  async #upload(userId, save, expectedRevision) {
    try {
      const revision = await this.#service.uploadSave(save, { expectedRevision });
      this.#saveMeta(userId, revision, save);
      this.#conflict = null;
      return "done";
    } catch (error) {
      if (error?.code === "REVISION_CONFLICT" || error?.code === "SAVE_ALREADY_EXISTS") return "retry";
      throw error;
    }
  }

  /** 把雲端進度套用到本機（本機沒有未同步的變動時）。戰鬥中先擱著 */
  #adopt(userId, remote) {
    if (!this.#bridge.canApply()) { this.#pending = remote; return "pending"; }
    this.#bridge.applySave(remote.save);
    this.#saveMeta(userId, remote.revision, this.#bridge.normalize(this.#bridge.getSave()));
    this.#pending = null;
    this.#conflict = null;
    return "done";
  }

  /** 兩邊都有變動：合併後套用到本機並上傳合併結果 */
  async #adoptMergedAndUpload(userId, merged, local, remote) {
    if (sameSave(merged, local) === false && !this.#bridge.canApply()) { this.#pending = remote; return "pending"; }
    if (!sameSave(merged, local)) this.#bridge.applySave(merged);
    this.#pending = null;
    if (sameSave(merged, remote.save)) {
      this.#saveMeta(userId, remote.revision, merged);
      return "done";
    }
    return this.#upload(userId, merged, remote.revision);
  }

  /* ───────────── 玩家的決定 ───────────── */

  /**
   * 解決衝突。choice：
   *   "cloud" 以雲端為準（本機進度被覆蓋）　"local" 以本機為準（雲端進度被覆蓋）
   *   "merge" 合併兩邊（沒有共同的底，所以貨幣取較大值，武器、角色取聯集，通關與最佳波數取較大值）
   */
  async resolveConflict(choice) {
    const c = this.#conflict;
    if (!c) return;
    const userId = this.#service.userId;
    if (choice === "cloud" || choice === "merge") {
      if (!this.#bridge.canApply()) throw new ApiError("請先回到主選單再處理（戰鬥中不能替換存檔）。", { code: "BUSY" });
    }
    this.#set("syncing");
    try {
      let outcome;
      if (choice === "cloud") outcome = this.#adopt(userId, c.remote);
      else if (choice === "local") outcome = await this.#upload(userId, c.local, c.remote.revision);
      else if (choice === "merge") {
        const { save } = mergeSaves({ base: null, local: c.local, remote: c.remote.save, defaults: this.#defaults });
        outcome = await this.#adoptMergedAndUpload(userId, save, c.local, c.remote);
      } else throw new RangeError(`未知的選擇：${choice}`);
      if (outcome === "retry") { this.#conflict = null; return this.sync({ reason: "manual" }); }
      this.#conflict = null;
      this.#finish(outcome);
    } catch (error) {
      this.#fail(error);
      throw error;
    }
  }

  /** 進階：不比對，直接用本機覆蓋雲端（會先確認取得最新版本號，避免蓋掉別台剛上傳的） */
  async forceUpload() {
    const userId = this.#service.userId;
    this.#set("syncing");
    try {
      let revision = null;
      try { revision = (await this.#service.downloadSave()).revision; } catch (e) { if (e?.code !== "SAVE_NOT_FOUND") throw e; }
      const local = this.#bridge.normalize(this.#bridge.getSave());
      const result = await this.#upload(userId, local, revision);
      if (result === "retry") throw new ApiError("雲端存檔剛被其他裝置更新，請再按一次。", { status: 409, code: "REVISION_CONFLICT" });
      this.#finish("done");
      return this.revision;
    } catch (error) { this.#fail(error); throw error; }
  }

  /** 進階：不比對，直接用雲端覆蓋本機 */
  async forcePull() {
    const userId = this.#service.userId;
    this.#set("syncing");
    try {
      const got = await this.#service.downloadSave();
      if (!this.#bridge.canApply()) throw new ApiError("請先回到主選單再載入雲端存檔。", { code: "BUSY" });
      const remote = { save: this.#bridge.normalize(got.save), revision: got.revision };
      this.#adopt(userId, remote);
      this.#finish("done");
      return remote.revision;
    } catch (error) { this.#fail(error); throw error; }
  }
}
