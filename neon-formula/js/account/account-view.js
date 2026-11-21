/**
 * 雲端帳號畫面：只負責顯示與收集輸入，所有邏輯交給 AccountService。
 *
 * 設計重點（以「第一次看到這個頁面的玩家」為準）：
 * - 先講清楚「這是選用功能」與「忘記密碼的後果」，再給表單
 * - 登入／建立帳號用分頁切換；欄位即時提示，送出前先在本機檢查，不會白跑一趟伺服器
 * - 錯誤訊息翻成白話（密碼錯、帳號已存在、太多次嘗試、伺服器喚醒中…）
 * - 覆蓋本機存檔前，先把「雲端」與「本機」的進度並排給玩家比對
 * - 使用 <form>：按 Enter 可送出、瀏覽器能檢查必填、密碼管理員能辨識欄位
 * - 所有使用者文字都走 textContent，不會有 XSS；樣式在 css/ui-kit.css
 */
import { h } from "../core/dom-utils.js";
import { accountPageUrl } from "./config.js";
import { choiceDialog, confirmDialog } from "../ui/feedback.js";

const MIN_PASSWORD = 8;

/**
 * 「去帳號中心登入」的標記：離開遊戲前寫進 sessionStorage，回來時用來顯示「已登入」或「沒有完成登入」的提示。
 * 只是提示用（不含任何憑證），超過 30 分鐘視為過期；sessionStorage 不可用時整個功能靜默略過。
 */
export const LOGIN_REDIRECT_FLAG = "neonShardLoginRedirect";
const LOGIN_REDIRECT_TTL_MS = 30 * 60_000;
const flagStore = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };
export function markLoginRedirect(now = Date.now()) {
  try { flagStore()?.setItem(LOGIN_REDIRECT_FLAG, String(now)); } catch { /* 無痕模式等情況：略過 */ }
}
/** 取出並清掉標記；有標記且沒過期回傳 true */
export function takeLoginRedirect(now = Date.now()) {
  const store = flagStore();
  if (!store) return false;
  try {
    const at = Number(store.getItem(LOGIN_REDIRECT_FLAG));
    store.removeItem(LOGIN_REDIRECT_FLAG);
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < LOGIN_REDIRECT_TTL_MS;
  } catch { return false; }
}
const SLOW_SERVER_MS = 6000; // 超過這麼久還沒回應，就說明可能是伺服器在喚醒

/** 把存檔整理成一行白話摘要（用在覆蓋前的比對） */
export function summarizeSave(save) {
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const cleared = Array.isArray(save?.clr) ? save.clr.filter(Boolean).length : 0;
  return `金幣 ${n(save?.coins)} · 碎片 ${n(save?.sh)} · 晶核 ${n(save?.co)} · 通關 ${cleared} 關`;
}

/**
 * 把 API 錯誤翻成玩家看得懂的話。伺服器訊息不認得時照原文顯示（不要吞掉有用的資訊）。
 * @param {unknown} error
 * @param {"login"|"signup"|"other"} action
 */
export function friendlyError(error, action = "other") {
  const message = error?.message || "操作失敗，請稍後再試。";
  const status = Number(error?.status) || 0;
  if (status === 429) return "嘗試次數太多了，請等幾分鐘再試一次。";
  if (action === "login" && status === 401) return "電子郵件或密碼不正確，請再確認一次。";
  if (action === "signup" && /already|exist|registered|已.*註冊|已存在/i.test(message)) return "這個電子郵件已經註冊過了，請切換到「登入」。";
  if (status >= 500) return "伺服器暫時出了點問題，請稍後再試。你的本機存檔不受影響。";
  return message;
}

/** 同步狀態 → 顯示文字與徽章樣式 */
export const SYNC_LABELS = Object.freeze({
  off: ["未登入", "warn"],
  locked: ["需要解鎖", "warn"],
  idle: ["待命", "ok"],
  syncing: ["同步中…", "busy"],
  synced: ["已同步", "ok"],
  pending: ["雲端有新進度", "warn"],
  conflict: ["需要你決定", "bad"],
  offline: ["離線，稍後重試", "warn"],
  error: ["同步失敗", "bad"],
});

/** 衝突時顯示給玩家的說明：兩邊的進度並排 */
export function conflictBody(conflict) {
  return `這台裝置\n${summarizeSave(conflict.local)}\n\n雲端（版本 ${conflict.remote.revision}）\n${summarizeSave(conflict.remote.save)}\n\n這台裝置第一次和這個帳號同步，兩邊卻都已經有進度。請選擇怎麼處理：`;
}

export class AccountView {
  static #current = null;

  #container;
  #service;
  #bridge;
  #abort = new AbortController();
  #keysRegistered = null; // 這個帳號是否已設定過加密金鑰：null = 還不知道
  #keysChecking = false;
  #keysUid = null;
  #busy = false;
  #notice = { text: "", error: false };
  #statusEl = null;
  #lastSync = null;
  #asking = false;
  #listeners = new Set();

  /**
   * @param {HTMLElement} container
   * @param {import('./account-service.js').AccountService} service
   * @param {{getSave:() => object, applySave:(save:object) => void}} bridge 遊戲端提供的存檔存取
   */
  static mount(container, service, bridge) {
    AccountView.#current?.destroy(); // 同一時間只保留一個畫面，避免舊畫面繼續監聽
    const view = new AccountView(container, service, bridge);
    AccountView.#current = view;
    view.#start();
    return view;
  }

  constructor(container, service, bridge) {
    this.#container = container;
    this.#service = service;
    this.#bridge = bridge;
  }

  /** 帳號狀態改變時通知（畫面被移除後會自動停止） */
  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  destroy() {
    this.#abort.abort();
    this.#listeners.clear();
    if (AccountView.#current === this) AccountView.#current = null;
  }

  #start() {
    this.#service.addEventListener("change", (e) => {
      if (!this.#container.isConnected) return this.destroy();
      const uid = this.#service.userId ?? null;
      if (uid !== this.#keysUid) { this.#keysUid = uid; this.#keysRegistered = null; }
      if (e.detail?.notice) this.#notice = { text: e.detail.notice, error: true };
      this.render();
      for (const fn of this.#listeners) fn();
    }, { signal: this.#abort.signal });
    const sync = this.#bridge.cloudSync;
    sync?.addEventListener("status", () => {
      if (!this.#container.isConnected) return this.destroy();
      this.render();
      if (sync.status === "conflict") this.#askConflict();
    }, { signal: this.#abort.signal });
    this.render();
    if (sync?.status === "conflict") this.#askConflict();
    if (typeof window !== "undefined" && window.location?.origin) {
      this.#service.restore().catch((error) => this.#setNotice(error?.message || "共用登入服務初始化失敗。", true));
    }
  }

  /** 衝突：兩邊都有進度、沒有共同的底。讓玩家三選一（一次只會開一個對話框） */
  async #askConflict() {
    const sync = this.#bridge.cloudSync;
    if (!sync?.conflict || this.#asking) return;
    this.#asking = true;
    try {
      const choice = await choiceDialog({
        title: "這台裝置和雲端都有進度",
        body: conflictBody(sync.conflict),
        choices: [
          { value: "merge", label: "合併兩邊（建議）", primary: true, hint: "保留兩邊的進度：武器與角色取聯集、通關與最佳波數取較高、貨幣取較大值。" },
          { value: "cloud", label: "以雲端為準", danger: true, hint: "這台裝置目前的進度會被取代。" },
          { value: "local", label: "以這台裝置為準", danger: true, hint: "雲端上的進度會被取代。" },
        ],
        cancelText: "先不處理（自動同步暫停）",
      });
      if (!choice) return this.#setNotice("衝突還沒處理，自動同步暫停中。本機存檔沒有任何變動。", true);
      await this.#run(async () => {
        await sync.resolveConflict(choice);
        this.#setNotice(choice === "merge" ? "已合併兩邊的進度並同步。" : choice === "cloud" ? "已用雲端進度取代這台裝置。" : "已用這台裝置的進度取代雲端。");
      }, { busyText: "處理中…" });
    } finally {
      this.#asking = false;
      this.render();
    }
  }

  #setNotice(text, error = false) {
    this.#notice = { text, error };
    if (this.#statusEl) {
      this.#statusEl.textContent = text;
      this.#statusEl.classList.toggle("err", error);
    }
  }

  /**
   * 執行一個動作：期間鎖住所有控制項並顯示進行中文字，錯誤翻成白話顯示在狀態列。
   * @param {() => Promise<void>} work
   * @param {{busyText?: string, action?: "login"|"signup"|"other"}} [options]
   */
  async #run(work, { busyText = "處理中…", action = "other" } = {}) {
    if (this.#busy) return;
    this.#busy = true;
    const buttons = [...this.#container.querySelectorAll("button,input")];
    for (const el of buttons) el.disabled = true;
    this.#container.classList.add("is-busy");
    this.#setNotice(busyText);
    const slowTimer = setTimeout(() => {
      this.#setNotice("伺服器還在回應中。免費主機閒置後需要 30～60 秒才會醒來，請稍候，先不要關閉頁面。");
    }, SLOW_SERVER_MS);
    try {
      await work();
    } catch (error) {
      this.#setNotice(friendlyError(error, action), true);
    } finally {
      clearTimeout(slowTimer);
      this.#busy = false;
      this.#container.classList.remove("is-busy");
      for (const el of buttons) el.disabled = false;
    }
  }

  render() {
    this.#statusEl = h("p", { class: "ns-status" + (this.#notice.error ? " err" : ""), role: "status", "aria-live": "polite" }, this.#notice.text);
    const panel = h("section", { class: "ns-account" });
    if (!this.#service.authReady) {
      panel.append(
        h("header", { class: "ns-intro" },
          h("h2", {}, "正在確認登入狀態…"),
          h("p", {}, "正在還原這個網站共用的 Firebase 登入工作階段，請稍候。")),
        this.#statusEl);
    } else if (!this.#service.signedIn) this.#renderSignedOut(panel);
    else this.#renderSignedIn(panel);
    this.#container.replaceChildren(panel);
  }

  /* ---------- 共用小零件 ---------- */

  /** 一個表單欄位：標籤、輸入框、說明、錯誤訊息（錯誤用 role=alert，螢幕閱讀器會唸） */
  #field({ label, type, autocomplete, help = "", password = false, ...attrs }) {
    const id = `ns-f-${Math.random().toString(36).slice(2, 8)}`;
    const input = h("input", { class: "ns-input", id, type, autocomplete, required: true, "aria-describedby": `${id}-d`, ...attrs });
    const note = h("small", { class: "ns-note", id: `${id}-d` }, help);
    const error = h("small", { class: "ns-err", role: "alert" });
    const row = h("div", { class: "ns-input-row" }, input);
    if (password) {
      const toggle = h("button", { type: "button", class: "ns-eye", "aria-pressed": "false", onclick: () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.textContent = show ? "隱藏" : "顯示";
        toggle.setAttribute("aria-pressed", String(show));
      } }, "顯示");
      row.append(toggle);
    }
    const wrap = h("div", { class: "ns-field" }, h("label", { class: "ns-label", for: id }, label), row, note, error);
    return {
      wrap, input, note,
      setHelp: (text, ok = false) => { note.textContent = text; note.classList.toggle("ok", ok); },
      fail: (message) => { error.textContent = message; input.setAttribute("aria-invalid", message ? "true" : "false"); },
    };
  }

  /* ---------- 未登入 ---------- */
  #renderSignedOut(panel) {
    panel.append(
      h("header", { class: "ns-intro" },
        h("h2", {}, "雲端存檔 ", h("span", { class: "ns-pill" }, "選用")),
        h("p", {}, "不登入也能完整遊玩，進度會保存在這台裝置。登入後，可以在不同裝置之間接關。"),
        h("ul", { class: "ns-points" },
          h("li", {}, "🔒 存檔內容會先在這台裝置加密，再上傳。"),
          h("li", {}, "📱 換手機或電腦時，登入後就能接關，兩台裝置各自玩的進度還會自動合併。"),
          h("li", { class: "warn" }, "⚠️ 忘記雲端存檔的加密密碼就解不開存檔，請把它記好。"))),
      h("div", { class: "ns-syncbox" },
        h("h3", {}, "登入請到帳號中心"),
        h("p", { class: "ns-syncmsg" }, "註冊、登入、忘記密碼都在共用的帳號中心處理。登入完成會自動回到遊戲，遊戲只讀取登入狀態，不會看到你的密碼。"),
        h("button", { type: "button", class: "x-btn pri blk", onclick: () => this.#goToAccountCenter() }, "前往帳號中心登入／註冊")),
      this.#statusEl);
  }

  /** 導向帳號中心登入；登入完成後帳號中心會依 returnTo 送回目前這一頁（見 config.js 的 accountPageUrl） */
  #goToAccountCenter() {
    const url = accountPageUrl({ returnTo: globalThis.location?.href });
    markLoginRedirect();
    this.#setNotice("正在前往帳號中心…");
    (this.#bridge.navigate ?? ((target) => globalThis.location.assign(target)))(url);
  }

  /* ---------- 已登入 ---------- */
  #renderSignedIn(panel) {
    const svc = this.#service;
    const name = svc.profile?.displayName || "玩家";
    const badges = h("div", { class: "ns-badges" },
      h("span", { class: "ns-badge ok" }, "已登入"),
      h("span", { class: "ns-badge " + (svc.unlocked ? "ok" : "warn") }, svc.unlocked ? "金鑰已解鎖" : "需要輸入密碼解鎖"));
    const head = h("header", { class: "ns-me" },
      h("div", { class: "ns-avatar-dot", "aria-hidden": "true" }, [...name][0] ?? "?"),
      h("div", {}, h("h2", {}, name), badges));
    const logout = h("button", { type: "button", class: "x-btn sm", onclick: () => this.#run(async () => {
      await svc.logOut();
      this.#setNotice("已登出。這台裝置上的本機存檔仍然保留。");
    }, { busyText: "登出中…" }) }, "登出");

    if (!svc.unlocked) {
      if (this.#keysRegistered === null) {
        this.#checkKeys();
        panel.append(head, h("p", { class: "ns-note" }, "正在確認雲端存檔的設定…"), h("div", { class: "ns-row" }, logout), this.#statusEl);
        return;
      }
      if (this.#keysRegistered === false) return this.#renderKeySetup(panel, head, logout);
      const password = this.#field({ label: "雲端存檔加密密碼", type: "password", password: true, autocomplete: "current-password", maxLength: 256,
        help: "每次開啟遊戲都要解鎖一次。密碼只在這台裝置的記憶體中使用，不會被送出或儲存。這是你設定雲端存檔時輸入的密碼（建議與帳號密碼相同）。" });
      panel.append(head, h("form", { class: "ns-form", onsubmit: (e) => {
        e.preventDefault();
        if (!password.input.value) { password.fail("請輸入密碼。"); password.input.focus(); return; }
        this.#run(async () => {
          await svc.unlock(password.input.value);
          this.#setNotice("已解鎖，可以同步存檔了。");
        }, { busyText: "解鎖中…" });
      } }, password.wrap, h("div", { class: "ns-row" }, h("button", { type: "submit", class: "x-btn pri" }, "解鎖"), logout)), this.#statusEl);
      return;
    }

    if (this.#bridge.cloudSync) return this.#renderSyncPanel(panel, head, logout);

    const upload = h("button", { type: "button", class: "x-btn pri", onclick: () => this.#run(async () => {
      const revision = await svc.uploadSave(this.#bridge.getSave());
      this.#lastSync = { text: `${this.#clock()} 已上傳（雲端版本 ${revision}）` };
      this.#setNotice(`上傳完成：${summarizeSave(this.#bridge.getSave())}`);
      this.render();
    }, { busyText: "正在加密並上傳…" }) }, "上傳目前存檔");

    const download = h("button", { type: "button", class: "x-btn", onclick: () => this.#run(async () => {
      this.#setNotice("正在取得雲端存檔…");
      const { save, revision } = await svc.downloadSave(); // 先取回並解密，此時還沒動到本機
      const confirmed = await confirmDialog({
        title: "用雲端存檔覆蓋本機？",
        body: `雲端（版本 ${revision}）\n${summarizeSave(save)}\n\n這台裝置\n${summarizeSave(this.#bridge.getSave())}\n\n覆蓋後無法復原。如果這台裝置的進度比較新，請按取消，改用「上傳目前存檔」。`,
        confirmText: "用雲端覆蓋本機", cancelText: "取消", danger: true,
      });
      if (!confirmed) return this.#setNotice("已取消，本機存檔沒有任何變動。");
      this.#bridge.applySave(save);
      this.#lastSync = { text: `${this.#clock()} 已載入雲端存檔（版本 ${revision}）` };
      this.#setNotice(`已載入：${summarizeSave(save)}`);
      this.render();
    }, { busyText: "正在下載並解密…" }) }, "從雲端載入");

    panel.append(head,
      h("div", { class: "ns-sync" },
        h("div", { class: "ns-sync-card" }, h("h3", {}, "備份到雲端"), h("p", {}, "把這台裝置目前的進度存到雲端，會取代雲端上較舊的版本。"), upload),
        h("div", { class: "ns-sync-card" }, h("h3", {}, "從雲端載入"), h("p", {}, "把雲端的進度載入這台裝置（換裝置時用）。覆蓋前會先讓你比對兩邊的進度。"), download)),
      h("p", { class: "ns-meta" }, `這台裝置：${summarizeSave(this.#bridge.getSave())}`, this.#lastSync ? h("br") : null, this.#lastSync?.text ?? null),
      this.#statusEl,
      h("div", { class: "ns-row ns-foot" }, logout, h("small", { class: "ns-note" }, "登出不會刪除這台裝置上的本機存檔。")));
  }

  /** 查這個帳號有沒有設定過加密金鑰（決定顯示「解鎖」還是「第一次設定」） */
  #checkKeys() {
    if (this.#keysChecking) return;
    this.#keysChecking = true;
    const uid = this.#service.userId;
    this.#service.keysRegistered()
      .then((registered) => { if (this.#service.userId === uid) this.#keysRegistered = registered; })
      .catch((error) => {
        // 查不到（離線、伺服器睡著）：先顯示一般的解鎖畫面，避免卡在「確認中」；若其實還沒設定，解鎖時會得到明確的錯誤
        if (this.#service.userId === uid) this.#keysRegistered = true;
        this.#setNotice(error?.message || "暫時無法確認雲端存檔設定。", true);
      })
      .finally(() => { this.#keysChecking = false; if (this.#container.isConnected) this.render(); });
  }

  /** 在帳號中心註冊的新帳號：第一次使用雲端存檔，設定加密密碼（要輸入兩次，打錯就等於把存檔鎖死，所以不能省） */
  #renderKeySetup(panel, head, logout) {
    const svc = this.#service;
    const password = this.#field({ label: "雲端存檔加密密碼", type: "password", password: true, autocomplete: "new-password", maxLength: 256, minLength: MIN_PASSWORD,
      help: `至少 ${MIN_PASSWORD} 個字元。存檔會先用它在這台裝置加密才上傳。` });
    const confirm = this.#field({ label: "再輸入一次", type: "password", password: true, autocomplete: "new-password", maxLength: 256, minLength: MIN_PASSWORD });
    password.input.addEventListener("input", () => {
      const left = MIN_PASSWORD - password.input.value.length;
      password.fail("");
      if (left > 0) password.setHelp(`還差 ${left} 個字元。`);
      else password.setHelp("✓ 長度足夠。", true);
    });
    confirm.input.addEventListener("input", () => confirm.fail(""));
    const submit = h("button", { type: "submit", class: "x-btn pri" }, "設定並啟用雲端存檔");
    panel.append(head,
      h("header", { class: "ns-intro" },
        h("h2", {}, "第一次使用雲端存檔"),
        h("p", {}, "請設定一組加密密碼。建議和帳號密碼相同，比較不會忘。"),
        h("ul", { class: "ns-points" }, h("li", { class: "warn" }, "⚠️ 忘記這組密碼就無法解開雲端存檔，任何人（包括我們）都救不回來。"))),
      h("form", { class: "ns-form", novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        password.fail(""); confirm.fail("");
        if (password.input.value.length < MIN_PASSWORD) { password.fail(`密碼至少要 ${MIN_PASSWORD} 個字元。`); password.input.focus(); return; }
        if (password.input.value !== confirm.input.value) { confirm.fail("兩次輸入的密碼不一樣。"); confirm.input.focus(); return; }
        this.#run(async () => {
          await svc.unlock(password.input.value, { createIfMissing: true });
          this.#keysRegistered = true;
          this.#setNotice("加密密碼設定完成，雲端存檔已啟用。");
        }, { busyText: "正在產生加密金鑰…" });
      } }, password.wrap, confirm.wrap, h("div", { class: "ns-row" }, submit, logout)),
      this.#statusEl);
  }

  /* ---------- 已登入：自動同步面板 ---------- */
  #renderSyncPanel(panel, head, logout) {
    const sync = this.#bridge.cloudSync, settings = this.#bridge.settings;
    const [label, tone] = SYNC_LABELS[sync.status] ?? SYNC_LABELS.idle;
    const last = sync.lastSyncAt ? `上次同步 ${this.#clock(sync.lastSyncAt)}${sync.revision != null ? `（雲端版本 ${sync.revision}）` : ""}` : "這台裝置還沒有同步過";
    const syncNow = h("button", { type: "button", class: "x-btn pri", onclick: () => this.#run(async () => {
      await sync.sync({ reason: "manual" });
      if (sync.status === "conflict") return; // 對話框由狀態事件開啟
      this.#setNotice(sync.status === "synced" ? "已是最新：這台裝置和雲端一致。" : sync.message || "完成。", sync.status === "error" || sync.status === "offline");
    }, { busyText: "同步中…" }) }, "立即同步");
    const auto = settings ? h("label", { class: "ns-switch" },
      h("input", { type: "checkbox", checked: settings.get("cloudAutoSync"), onchange: (e) => {
        settings.set("cloudAutoSync", e.target.checked);
        this.#setNotice(e.target.checked ? "已開啟自動同步：進度有變動時會自動加密上傳。" : "已關閉自動同步，之後請手動按「立即同步」。");
        if (e.target.checked) sync.poke("manual");
      } }),
      h("span", {}, "自動同步（進度有變動時自動上傳，回到遊戲時自動檢查雲端）")) : null;

    const resolve = sync.status === "conflict"
      ? h("button", { type: "button", class: "x-btn dng", onclick: () => this.#askConflict() }, "處理衝突…")
      : null;

    const upload = h("button", { type: "button", class: "x-btn", onclick: () => this.#run(async () => {
      const ok = await confirmDialog({
        title: "用這台裝置覆蓋雲端？",
        body: `這台裝置\n${summarizeSave(this.#bridge.getSave())}\n\n會直接取代雲端上的存檔，不做合併。`,
        confirmText: "覆蓋雲端", cancelText: "取消", danger: true,
      });
      if (!ok) return this.#setNotice("已取消，雲端沒有任何變動。");
      const revision = await sync.forceUpload();
      this.#setNotice(`上傳完成（雲端版本 ${revision}）：${summarizeSave(this.#bridge.getSave())}`);
    }, { busyText: "正在加密並上傳…" }) }, "強制上傳（覆蓋雲端）");

    const download = h("button", { type: "button", class: "x-btn", onclick: () => this.#run(async () => {
      this.#setNotice("正在取得雲端存檔…");
      const { save, revision } = await this.#service.downloadSave();
      const ok = await confirmDialog({
        title: "用雲端存檔覆蓋本機？",
        body: `雲端（版本 ${revision}）\n${summarizeSave(save)}\n\n這台裝置\n${summarizeSave(this.#bridge.getSave())}\n\n覆蓋後無法復原，也不做合併。`,
        confirmText: "用雲端覆蓋本機", cancelText: "取消", danger: true,
      });
      if (!ok) return this.#setNotice("已取消，本機存檔沒有任何變動。");
      await sync.forcePull();
      this.#setNotice(`已載入：${summarizeSave(save)}`);
    }, { busyText: "正在下載並解密…" }) }, "強制載入（覆蓋本機）");

    panel.append(head,
      h("div", { class: "ns-syncbox" },
        h("h3", {}, "雲端同步"),
        h("div", { class: "ns-syncline" }, h("span", { class: `ns-badge ${tone}` }, label), h("small", { class: "ns-note" }, last)),
        sync.message ? h("p", { class: "ns-syncmsg" }, sync.message) : null,
        h("p", { class: "ns-meta" }, `這台裝置：${summarizeSave(this.#bridge.getSave())}`),
        auto,
        h("div", { class: "ns-row" }, syncNow, resolve),
        h("details", { class: "ns-adv" }, h("summary", {}, "進階：強制覆蓋"),
          h("div", { class: "ns-sync" }, h("div", { class: "ns-sync-card" }, h("p", {}, "不做比對與合併，直接用這台裝置覆蓋雲端。"), upload), h("div", { class: "ns-sync-card" }, h("p", {}, "不做比對與合併，直接用雲端覆蓋這台裝置。"), download)))),
      this.#statusEl,
      h("div", { class: "ns-row ns-foot" }, logout, h("small", { class: "ns-note" }, "登出不會刪除這台裝置上的本機存檔。")));
  }

  #clock(at) {
    return new Date(at ?? Date.now()).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }
}
