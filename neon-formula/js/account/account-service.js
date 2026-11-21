/**
 * 帳號服務：共用 Firebase Auth 狀態、Render 身分／個人資料、金鑰解鎖與雲端存檔。
 * 本機遊戲不依賴登入；登入只控制雲端同步與線上聯機。
 */
import { ApiError } from "./api-client.js";

const GUEST = "訪客";

export class AccountService extends EventTarget {
  #api;
  #auth;
  #crypto;
  #user = null;
  #keys = null;
  #profile = null;
  #authReady = null;
  #authStateReady = false;
  #unsubscribeAuth = null;
  #authGeneration = 0;
  #lastWarm = 0;

  constructor({ api, auth, crypto }) {
    super();
    this.#api = api;
    this.#auth = auth;
    this.#crypto = crypto;
  }

  get authReady() { return this.#authStateReady; }
  get signedIn() { return Boolean(this.#user); }
  get unlocked() { return this.#keys !== null; }
  get profile() { return this.#profile; }
  get displayName() { return this.#profile?.displayName || this.#user?.displayName || GUEST; }
  get userId() { return this.#user?.uid ?? this.#profile?.userId ?? null; }

  #emit(notice = "") {
    this.dispatchEvent(new CustomEvent("change", { detail: { notice } }));
  }

  #assertCurrentUser(uid, generation = this.#authGeneration) {
    if (!uid || this.#user?.uid !== uid || this.#authGeneration !== generation) {
      throw new ApiError("登入帳號已變更，請重新操作。", { code: "AUTH_CHANGED" });
    }
  }

  #setUser(user, { restoreProfile = true } = {}) {
    const nextUid = user?.uid ?? null;
    const currentUid = this.#user?.uid ?? null;
    if (nextUid === currentUid) {
      this.#user = user ?? null;
      return false;
    }
    this.#authGeneration++;
    this.#user = user ?? null;
    this.#keys = null;
    this.#profile = null;
    this.#emit();
    if (this.#user && restoreProfile) this.#restoreProfile(this.#user, this.#authGeneration);
    return true;
  }

  async #restoreProfile(user, generation) {
    try {
      await this.#bootstrapProfile(null);
      if (generation === this.#authGeneration && this.#user?.uid === user.uid) this.#emit();
    } catch (error) {
      if (generation === this.#authGeneration && this.#user?.uid === user.uid) {
        this.#emit(error?.message || "無法載入雲端個人資料。");
      }
    }
  }

  /** 等待 Firebase 還原同源持久登入狀態，再訂閱跨分頁登入／登出變化。 */
  async restore() {
    if (!this.#authReady) {
      this.#authReady = (async () => {
        try {
          const user = await this.#auth.waitForAuthState();
          this.#setUser(user, { restoreProfile: false });
          this.#unsubscribeAuth = await this.#auth.observeAuth((nextUser) => this.#setUser(nextUser));
          this.#authStateReady = true;
          this.#emit();
        } catch (error) {
          this.#authStateReady = true;
          this.#emit(error?.message || "共用登入服務初始化失敗。");
          throw error;
        }
      })().catch((error) => {
        this.#authReady = null;
        throw error;
      });
    }
    await this.#authReady;
    if (this.#user && !this.#profile) {
      try { await this.#bootstrapProfile(null); this.#emit(); }
      catch (error) { console.warn("[account] restore failed", error); }
    }
  }

  /** 喚醒休眠中的 Render；不需要登入，失敗不影響本機遊戲。 */
  warmUp() {
    if (Date.now() - this.#lastWarm < 300_000) return;
    this.#lastWarm = Date.now();
    this.#api.request("/api/health", { auth: false }).catch(() => {});
  }

  /** Firebase SDK 會自行管理 token refresh；供 WebSocket 使用的 token 也走同一個來源。 */
  async getFreshAccessToken() {
    const uid = this.#user?.uid;
    const generation = this.#authGeneration;
    if (!uid) return null;
    try {
      const token = await this.#auth.getIdentityToken(false);
      return this.#user?.uid === uid && this.#authGeneration === generation ? token : null;
    } catch { return null; }
  }

  async #loadProfile(uid = this.#user?.uid, generation = this.#authGeneration) {
    this.#assertCurrentUser(uid, generation);
    const profile = await this.#api.request("/api/profile/me");
    this.#assertCurrentUser(uid, generation);
    this.#profile = profile;
    return profile;
  }

  async #unlockOrCreateKeys(userId, password) {
    const generation = this.#authGeneration;
    this.#assertCurrentUser(userId, generation);
    const record = await this.#api.request("/api/keys");
    this.#assertCurrentUser(userId, generation);
    if (record.registered) {
      const keys = await this.#crypto.unlockAccountKeys(userId, password, record);
      this.#assertCurrentUser(userId, generation);
      this.#keys = keys;
    } else {
      const created = await this.#crypto.createAccountKeys(userId, password);
      this.#assertCurrentUser(userId, generation);
      await this.#api.request("/api/keys", { method: "PUT", body: created.registration });
      this.#assertCurrentUser(userId, generation);
      this.#keys = created.keys;
    }
  }

  async #bootstrapProfile(displayName) {
    const uid = this.#user?.uid;
    const generation = this.#authGeneration;
    this.#assertCurrentUser(uid, generation);
    await this.#api.request("/api/identity/me");
    this.#assertCurrentUser(uid, generation);
    if (displayName) {
      await this.#api.request("/api/profile", { method: "PUT", body: { displayName } });
      this.#assertCurrentUser(uid, generation);
    }
    return this.#loadProfile(uid, generation);
  }

  /**
   * 遊戲內註冊／登入（舊流程）。目前遊戲的登入介面改為導向帳號中心（見 account-view.js），
   * 這兩個方法保留給測試與需要內嵌登入的情境，一般畫面不會呼叫。
   */
  async signUp({ email, password, displayName }) {
    const user = await this.#auth.signUp(email, password, displayName);
    this.#setUser(user, { restoreProfile: false });
    try {
      await this.#bootstrapProfile(displayName);
      await this.#unlockOrCreateKeys(user.uid, password);
    } catch (error) {
      this.#emit(error?.message || "帳號已建立，但雲端初始化尚未完成。");
      throw error;
    }
    this.#emit();
    return { needsEmailConfirmation: false };
  }

  async logIn({ email, password }) {
    const user = await this.#auth.signIn(email, password);
    this.#setUser(user, { restoreProfile: false });
    await this.#bootstrapProfile(null);
    await this.#unlockOrCreateKeys(user.uid, password);
    this.#emit();
  }

  /** 這個帳號是否已經設定過雲端存檔的加密金鑰（沒有 = 第一次使用，需要先設定加密密碼） */
  async keysRegistered() {
    if (!this.#user) throw new ApiError("請先登入遊戲帳號。", { code: "NOT_SIGNED_IN" });
    const uid = this.#user.uid;
    const generation = this.#authGeneration;
    const record = await this.#api.request("/api/keys");
    this.#assertCurrentUser(uid, generation);
    return Boolean(record.registered);
  }

  /**
   * 用密碼解鎖本機記憶體中的加密金鑰（密碼只在這台裝置上使用，不會送出，也不會被儲存）。
   * 登入在帳號中心完成時，遊戲拿不到密碼，所以「解鎖」與「第一次設定」都在這裡：
   *   - 已設定過：用密碼解開金鑰；密碼錯誤會丟錯，金鑰維持鎖定。
   *   - 還沒設定：預設丟 KEYS_NOT_REGISTERED（避免玩家打錯密碼就被當成新密碼）；
   *     呼叫端明確傳 { createIfMissing: true }（設定畫面，有確認欄位）才會建立新金鑰並註冊。
   * @returns {Promise<{created: boolean}>}
   */
  async unlock(password, { createIfMissing = false } = {}) {
    if (!this.#user) throw new ApiError("請先登入遊戲帳號。", { code: "NOT_SIGNED_IN" });
    const uid = this.#user.uid;
    const generation = this.#authGeneration;
    const profile = await this.#loadProfile(uid, generation).catch(async (error) => {
      if (error?.code !== "PROFILE_NOT_FOUND") throw error;
      return this.#bootstrapProfile(null);
    });
    this.#assertCurrentUser(uid, generation);
    const record = await this.#api.request("/api/keys");
    this.#assertCurrentUser(uid, generation);
    if (!record.registered) {
      if (!createIfMissing) throw new ApiError("這個帳號還沒有設定雲端存檔的加密密碼。", { code: "KEYS_NOT_REGISTERED" });
      const created = await this.#crypto.createAccountKeys(uid, password);
      this.#assertCurrentUser(uid, generation);
      await this.#api.request("/api/keys", { method: "PUT", body: created.registration });
      this.#assertCurrentUser(uid, generation);
      this.#keys = created.keys;
      this.#emit();
      return { created: true };
    }
    const keys = await this.#crypto.unlockAccountKeys(profile.userId, password, record);
    this.#assertCurrentUser(uid, generation);
    this.#keys = keys;
    this.#emit();
    return { created: false };
  }

  async logOut() {
    try {
      if (this.#user) await this.#api.request("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.warn("[account] Render logout request failed", error);
    } finally {
      try { await this.#auth.signOut(); }
      finally { this.#setUser(null); this.#emit(); }
    }
  }

  #requireUnlocked() {
    const userId = this.userId;
    if (!this.signedIn || !userId) throw new ApiError("尚未登入，請重新登入。", { code: "NOT_SIGNED_IN" });
    if (!this.#keys) throw new ApiError("加密金鑰尚未解鎖。", { code: "LOCKED" });
    return userId;
  }

  /**
   * 加密並上傳存檔。
   * @param {object} save
   * @param {{expectedRevision?: number|null}} [options] 呼叫端已經知道雲端目前的版本號時傳進來，就不必先多打一次 GET：
   *   數字 = 更新那個版本；null = 雲端還沒有存檔（建立第一份）；省略 = 先向伺服器查詢版本（舊行為）
   * @returns {Promise<number>} 新的版本號
   */
  async uploadSave(save, { expectedRevision } = {}) {
    const userId = this.#requireUnlocked();
    const generation = this.#authGeneration;
    const keys = this.#keys;
    const assertSession = () => this.#assertCurrentUser(userId, generation);
    const summary = {
      format: "neon-shard-save-v1",
      savedAt: new Date().toISOString(),
      summary: { coins: Number(save.coins) || 0, shards: Number(save.sh) || 0, cores: Number(save.co) || 0 },
      payloadType: "encrypted-full-save",
    };
    const sensitiveEnvelope = await this.#crypto.encryptSave(userId, keys, save);
    assertSession();
    let revision = null;
    if (expectedRevision === undefined) {
      try {
        revision = (await this.#api.request("/api/player-data")).revision;
        assertSession();
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "SAVE_NOT_FOUND")) throw error;
      }
    } else {
      revision = Number.isInteger(expectedRevision) ? expectedRevision : null;
    }
    assertSession();
    const method = revision === null ? "POST" : "PUT";
    const body = { saveData: summary, sensitiveEnvelope, keyId: sensitiveEnvelope.keyId, signedAt: Date.now() };
    if (revision !== null) body.expectedRevision = revision;
    body.signature = await this.#crypto.signSaveRequest(keys, { userId, method, path: "/api/player-data", body });
    assertSession();
    try {
      const result = await this.#api.request("/api/player-data", { method, body });
      assertSession();
      return result.revision;
    } catch (error) {
      if (error instanceof ApiError && (error.code === "REVISION_CONFLICT" || error.code === "SAVE_ALREADY_EXISTS")) {
        throw new ApiError("雲端存檔剛被其他裝置更新。", { status: 409, code: error.code });
      }
      throw error;
    }
  }

  async downloadSave() {
    const userId = this.#requireUnlocked();
    const generation = this.#authGeneration;
    const keys = this.#keys;
    this.#assertCurrentUser(userId, generation);
    const remote = await this.#api.request("/api/player-data");
    this.#assertCurrentUser(userId, generation);
    const save = await this.#crypto.decryptSave(userId, keys, remote.sensitiveEnvelope);
    this.#assertCurrentUser(userId, generation);
    if (!save || typeof save !== "object" || Array.isArray(save)) throw new ApiError("解密後的存檔格式不正確，已取消覆蓋。", { code: "BAD_SAVE" });
    return { save, revision: remote.revision };
  }
}
