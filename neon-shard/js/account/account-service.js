/**
 * 帳號服務：登入、金鑰解鎖、雲端存檔上傳／下載的商業邏輯（不碰 DOM，方便測試）。
 * 狀態改變時會發出 "change" 事件，畫面只需要訂閱它。
 */
import { ApiError } from "./api-client.js";

const GUEST = "訪客";

export class AccountService extends EventTarget {
  #api;
  #auth;
  #sessions;
  #crypto;
  #keys = null;
  #profile = null;

  /**
   * @param {{api: import('./api-client.js').ApiClient, auth: import('./firebase-auth.js').FirebaseAuthClient, sessions: import('./session-store.js').SessionStore,
   *          crypto: {createAccountKeys:Function, unlockAccountKeys:Function, encryptSave:Function, decryptSave:Function, signSaveRequest:Function}}} o
   */
  constructor({ api, auth, sessions, crypto }) {
    super();
    this.#api = api;
    this.#auth = auth;
    this.#sessions = sessions;
    this.#crypto = crypto;
    api.onSessionExpired = () => this.#reset("登入已過期，請重新登入。");
  }

  get signedIn() { return this.#sessions.current !== null; }
  get unlocked() { return this.#keys !== null; }
  get profile() { return this.#profile; }
  get displayName() { return this.#profile?.displayName || GUEST; }
  get userId() { return this.#sessions.current?.userId ?? this.#profile?.userId ?? null; }

  #emit(notice = "") {
    this.dispatchEvent(new CustomEvent("change", { detail: { notice } }));
  }

  #reset(notice) {
    this.#keys = null;
    this.#profile = null;
    this.#emit(notice);
  }

  async #loadProfile() {
    this.#profile = await this.#api.request("/api/profile/me");
    const s = this.#sessions.current;
    if (s && !s.userId) this.#sessions.set({ ...s, userId: this.#profile.userId });
    return this.#profile;
  }

  async #unlockOrCreateKeys(userId, password) {
    const record = await this.#api.request("/api/keys");
    if (record.registered) {
      this.#keys = await this.#crypto.unlockAccountKeys(userId, password, record);
    } else {
      const created = await this.#crypto.createAccountKeys(userId, password);
      await this.#api.request("/api/keys", { method: "PUT", body: created.registration });
      this.#keys = created.keys;
    }
  }

  /** 頁面載入後若還有 session，補抓暱稱（不需要密碼；金鑰仍需使用者輸入密碼解鎖） */
  async restore() {
    if (!this.signedIn || this.#profile) return;
    try {
      await this.#loadProfile();
      this.#emit();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "SESSION_EXPIRED")) console.warn("[account] restore failed", error);
    }
  }

  /** 喚醒休眠中的免費主機（Render 閒置後第一個請求要 30～60 秒）。不需要登入；失敗也不要緊 */
  #lastWarm = 0;
  #warmPromise = null;
  warmUp({ force = false } = {}) {
    if (this.#warmPromise) return this.#warmPromise;
    if (!force && Date.now() - this.#lastWarm < 300_000) return Promise.resolve(false);
    this.#lastWarm = Date.now();
    this.#warmPromise = this.#api.request("/api/health", { auth: false })
      .then(() => true)
      .catch(() => false)
      .finally(() => { this.#warmPromise = null; });
    return this.#warmPromise;
  }

  /**
   * 取得一個「至少還有 60 秒有效」的 ID token（給 WebSocket 等不走 ApiClient 的連線使用）。
   * 快過期就先更新；更新失敗代表登入已過期，回傳 null。
   */
  async getFreshAccessToken() {
    const s = this.#sessions.current;
    if (!s) return null;
    if (!s.expiresAt || s.expiresAt - Date.now() < 60_000) {
      if (!(await this.#api.refresh())) return null;
    }
    return this.#sessions.current?.accessToken ?? null;
  }

  /** 登入後讓後端建立（或讀取）這個帳號的資料，再取得個人檔案 */
  async #bootstrapProfile(displayName) {
    await this.#api.request("/api/identity/me"); // 後端第一次看到這個 UID 時才會建立 Firestore 資料與暱稱
    if (displayName) await this.#api.request("/api/profile", { method: "PUT", body: { displayName } });
    return this.#loadProfile();
  }

  /** @returns {Promise<{needsEmailConfirmation: boolean}>} Firebase 版不需要信箱確認，固定回傳 false（保留欄位讓畫面不用改） */
  async signUp({ email, password, displayName }) {
    // Firebase 直接驗證帳密；同時喚醒 Render，避免登入後才開始等待冷啟動。
    const wakePromise = this.warmUp({ force: true });
    const session = await this.#auth.signUp(email, password);
    this.#sessions.set(session);
    await wakePromise;
    try {
      await this.#bootstrapProfile(displayName);
      await this.#unlockOrCreateKeys(session.userId, password);
    } catch (error) {
      // 暱稱被占用等失敗：Firebase 帳號已建立，保留登入狀態讓玩家可以直接改暱稱；金鑰尚未設定則下次登入會補上
      this.#emit();
      throw error;
    }
    this.#emit();
    return { needsEmailConfirmation: false };
  }

  async logIn({ email, password }) {
    // Firebase 直接驗證帳密；Render 喚醒與 Firebase 驗證並行。
    const wakePromise = this.warmUp({ force: true });
    const session = await this.#auth.signIn(email, password);
    this.#sessions.set(session);
    await wakePromise;
    await this.#bootstrapProfile(null);
    await this.#unlockOrCreateKeys(session.userId, password);
    this.#emit();
  }

  /** 已有 session 但金鑰未解鎖（例如重新整理頁面後）時，用密碼解鎖 */
  async unlock(password) {
    const profile = await this.#loadProfile().catch(async (error) => {
      if (error?.code !== "PROFILE_NOT_FOUND") throw error;
      return this.#bootstrapProfile(null); // 帳號剛在 Firebase 建立、後端還沒有資料
    });
    const record = await this.#api.request("/api/keys");
    if (!record.registered) throw new ApiError("帳號尚未完成金鑰設定；請登出後重新登入。", { code: "KEYS_NOT_REGISTERED" });
    this.#keys = await this.#crypto.unlockAccountKeys(profile.userId, password, record);
    this.#emit();
  }

  async logOut() {
    try {
      await this.#api.request("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.warn("[account] logout request failed", error); // 伺服器登出失敗也要清掉本機登入
    } finally {
      this.#sessions.clear();
      this.#reset();
    }
  }

  #requireUnlocked() {
    const userId = this.userId;
    if (!this.signedIn || !userId) throw new ApiError("尚未登入，請重新登入。", { code: "NOT_SIGNED_IN" });
    if (!this.#keys) throw new ApiError("加密金鑰尚未解鎖。", { code: "LOCKED" });
    return userId;
  }

  /** @returns {Promise<number>} 新的雲端存檔版本 */
  async uploadSave(save) {
    const userId = this.#requireUnlocked();
    const summary = {
      format: "neon-shard-save-v1",
      savedAt: new Date().toISOString(),
      summary: { coins: Number(save.coins) || 0, shards: Number(save.sh) || 0, cores: Number(save.co) || 0 },
      payloadType: "encrypted-full-save",
    };
    const sensitiveEnvelope = await this.#crypto.encryptSave(userId, this.#keys, save);
    let revision = null;
    try {
      revision = (await this.#api.request("/api/player-data")).revision;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "SAVE_NOT_FOUND")) throw error; // 用錯誤碼判斷，不比對訊息字串
    }
    const method = revision === null ? "POST" : "PUT";
    const body = { saveData: summary, sensitiveEnvelope, keyId: sensitiveEnvelope.keyId, signedAt: Date.now() };
    if (revision !== null) body.expectedRevision = revision;
    body.signature = await this.#crypto.signSaveRequest(this.#keys, { userId, method, path: "/api/player-data", body });
    try {
      return (await this.#api.request("/api/player-data", { method, body })).revision;
    } catch (error) {
      if (error instanceof ApiError && error.code === "REVISION_CONFLICT") {
        throw new ApiError("雲端存檔剛被其他裝置更新。請先「下載雲端存檔」確認內容，再決定是否上傳。", { status: 409, code: error.code });
      }
      throw error;
    }
  }

  /** @returns {Promise<{save: object, revision: number}>} */
  async downloadSave() {
    const userId = this.#requireUnlocked();
    const remote = await this.#api.request("/api/player-data");
    const save = await this.#crypto.decryptSave(userId, this.#keys, remote.sensitiveEnvelope);
    if (!save || typeof save !== "object" || Array.isArray(save)) throw new ApiError("解密後的存檔格式不正確，已取消覆蓋。", { code: "BAD_SAVE" });
    return { save, revision: remote.revision };
  }
}
