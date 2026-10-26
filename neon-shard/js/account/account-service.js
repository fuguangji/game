/**
 * 帳號服務：登入、金鑰解鎖、雲端存檔上傳／下載的商業邏輯（不碰 DOM，方便測試）。
 * 狀態改變時會發出 "change" 事件，畫面只需要訂閱它。
 */
import { ApiError } from "./api-client.js";

const GUEST = "訪客";

export class AccountService extends EventTarget {
  #api;
  #sessions;
  #crypto;
  #keys = null;
  #profile = null;
  #sharedAuth = null;
  #sharedUser = null;
  #sharedAuthStarted = false;
  #sharedAuthUnsubscribe = null;

  /**
   * @param {{api: import('./api-client.js').ApiClient, sessions: import('./session-store.js').SessionStore,
   *          crypto: {createAccountKeys:Function, unlockAccountKeys:Function, encryptSave:Function, decryptSave:Function, signSaveRequest:Function}}} o
   */
  constructor({ api, sessions, crypto, sharedAuth = null }) {
    super();
    this.#api = api;
    this.#sessions = sessions;
    this.#crypto = crypto;
    this.#sharedAuth = sharedAuth;
    api.onSessionExpired = () => this.#reset("登入已過期，請重新登入。");
  }

  get signedIn() { return this.#sharedUser !== null || this.#sessions.current !== null; }
  get unlocked() { return this.#keys !== null; }
  get profile() { return this.#profile; }
  get displayName() { return this.#profile?.displayName || GUEST; }
  get userId() { return this.#sharedUser?.uid ?? this.#sessions.current?.userId ?? this.#profile?.userId ?? null; }

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
    if (this.#sharedAuth && !this.#sharedAuthStarted) {
      this.#sharedAuthStarted = true;
      try {
        const unsubscribe = await this.#sharedAuth.observeAuth(async (user) => {
          this.#sharedUser = user;
          if (!user) {
            this.#keys = null;
            this.#profile = null;
            this.#emit();
            return;
          }
          try {
            await this.#sharedAuth.verifyIdentity();
            await this.#loadProfile();
          } catch (error) {
            console.warn("[account] shared identity bootstrap failed", error);
          }
          this.#emit();
        }, (error) => console.warn("[account] shared auth state error", error));
        this.#sharedAuthUnsubscribe = unsubscribe;
      } catch (error) {
        this.#sharedAuthStarted = false;
        console.warn("[account] shared auth initialization failed", error);
      }
    }
    if (!this.signedIn || this.#profile) return;
    try {
      await this.#loadProfile();
      this.#emit();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "SESSION_EXPIRED")) console.warn("[account] restore failed", error);
    }
  }

  /** @returns {Promise<{needsEmailConfirmation: boolean}>} */
  async signUp({ email, password, displayName }) {
    const result = await this.#api.request("/api/auth/signup", { method: "POST", auth: false, body: { email, password, displayName } });
    if (!result.session) return { needsEmailConfirmation: true };
    this.#sessions.set({ ...result.session, userId: result.user.id });
    await this.#unlockOrCreateKeys(result.user.id, password);
    await this.#loadProfile();
    this.#emit();
    return { needsEmailConfirmation: false };
  }

  async logIn({ email, password }) {
    const result = await this.#api.request("/api/auth/login", { method: "POST", auth: false, body: { email, password } });
    this.#sessions.set({ ...result.session, userId: result.user.id });
    await this.#unlockOrCreateKeys(result.user.id, password);
    await this.#loadProfile();
    this.#emit();
  }

  /** 使用共用 Firebase 身分建立或解鎖雲端存檔加密金鑰。 */
  async initializeOrUnlockKeys(password) {
    const userId = this.userId;
    if (!this.signedIn || !userId) throw new ApiError("尚未登入，請先登入共用帳號。", { code: "NOT_SIGNED_IN" });
    if (!this.#sharedUser) throw new ApiError("目前不是 Firebase 共用帳號工作階段，請重新登入。", { code: "NOT_SHARED_SESSION" });
    await this.#sharedAuth.verifyIdentity();
    await this.#unlockOrCreateKeys(userId, password);
    await this.#loadProfile();
    this.#emit();
  }

  /** 已有 session 但金鑰未解鎖（例如重新整理頁面後）時，用密碼解鎖 */
  async unlock(password) {
    const profile = await this.#loadProfile();
    const record = await this.#api.request("/api/keys");
    if (!record.registered) throw new ApiError("帳號尚未完成金鑰設定；請登出後重新登入。", { code: "KEYS_NOT_REGISTERED" });
    this.#keys = await this.#crypto.unlockAccountKeys(profile.userId, password, record);
    this.#emit();
  }

  async logOut() {
    try {
      if (this.#sharedUser && this.#sharedAuth) await this.#sharedAuth.signOut();
      else await this.#api.request("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.warn("[account] logout request failed", error);
    } finally {
      this.#sharedUser = null;
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
