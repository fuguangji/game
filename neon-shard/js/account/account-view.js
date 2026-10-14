/**
 * 雲端帳號畫面：只負責顯示與收集輸入，所有邏輯交給 AccountService。
 * - 使用 <form>：按 Enter 可送出、瀏覽器能檢查必填、密碼管理員能辨識欄位
 * - 訊息（成功 / 錯誤）會保留，不會因為重新繪製而消失
 * - 所有使用者文字都走 textContent，不會有 XSS
 */
import { h } from "../core/dom-utils.js";

const NICKNAME_PATTERN = /^[^<>&"'`%_\\\u0000-\u001f\u007f]{1,24}$/u;
const STYLE_ID = "ns-account-style";
const CSS = ".ns-account{display:grid;gap:12px;max-width:620px}.ns-account h2{margin:0;color:var(--t)}.ns-form{display:grid;gap:12px}.ns-field{display:grid;gap:6px;color:var(--t);font-size:14px}.ns-input{box-sizing:border-box;width:100%;min-width:0;padding:12px;border:1px solid #ffffff30;border-radius:10px;background:#101923;color:var(--t);font:inherit}.ns-row{display:flex;gap:8px;flex-wrap:wrap}.ns-account button:disabled,.ns-account input:disabled{opacity:.55;cursor:wait}";

export class AccountView {
  static #current = null;

  #container;
  #service;
  #bridge;
  #abort = new AbortController();
  #mode = "login";
  #busy = false;
  #notice = { text: "", error: false };
  #statusEl = null;
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
    if (!document.getElementById(STYLE_ID)) document.head.append(h("style", { id: STYLE_ID }, CSS));
    this.#service.addEventListener("change", (e) => {
      if (!this.#container.isConnected) return this.destroy();
      if (e.detail?.notice) this.#notice = { text: e.detail.notice, error: true };
      this.render();
      for (const fn of this.#listeners) fn();
    }, { signal: this.#abort.signal });
    this.render();
    this.#service.restore();
  }

  #setNotice(text, error = false) {
    this.#notice = { text, error };
    if (this.#statusEl) {
      this.#statusEl.textContent = text;
      this.#statusEl.style.color = error ? "#ff7b88" : "var(--t)";
    }
  }

  /** 執行一個動作：期間鎖住所有控制項，錯誤顯示在狀態列 */
  async #run(work) {
    if (this.#busy) return;
    this.#busy = true;
    const toggle = (disabled) => this.#container.querySelectorAll("button,input").forEach((el) => { el.disabled = disabled; });
    toggle(true);
    this.#setNotice("處理中…");
    try {
      await work();
    } catch (error) {
      this.#setNotice(error?.message || "操作失敗，請稍後再試。", true);
    } finally {
      this.#busy = false;
      toggle(false);
    }
  }

  render() {
    const svc = this.#service;
    this.#statusEl = h("p", { class: "x-sub", role: "status", "aria-live": "polite" }, this.#notice.text);
    this.#statusEl.style.color = this.#notice.error ? "#ff7b88" : "var(--t)";
    const panel = h("section", { class: "ns-account" });
    if (!svc.signedIn) this.#renderSignedOut(panel);
    else this.#renderSignedIn(panel);
    panel.append(h("p", { class: "x-hint" }, "安全提醒：忘記密碼且沒有舊密碼或其他恢復方式時，可能無法解密敏感存檔。不要在共用裝置上保持登入。"));
    this.#container.replaceChildren(panel);
  }

  #field(label, type, autocomplete, extra = {}) {
    const input = h("input", { class: "ns-input", type, autocomplete, required: true, ...extra });
    return { wrap: h("label", { class: "ns-field" }, h("span", {}, label), input), input };
  }

  #renderSignedOut(panel) {
    const signup = this.#mode === "signup";
    const email = this.#field("電子郵件", "email", "email", { maxLength: 254 });
    const password = this.#field(signup ? "密碼（至少 8 字元）" : "密碼", "password", signup ? "new-password" : "current-password", { maxLength: 256, minLength: signup ? 8 : 1 });
    const nickname = signup ? this.#field("遊戲暱稱（1–24 字元，不可含 < > & \" ' ` % _ \\）", "text", "nickname", { maxLength: 24 }) : null;
    const form = h("form", { class: "ns-form", onsubmit: (e) => {
      e.preventDefault();
      this.#run(async () => {
        const creds = { email: email.input.value.trim(), password: password.input.value };
        if (signup) {
          const displayName = nickname.input.value.trim();
          if (!NICKNAME_PATTERN.test(displayName)) throw new Error("暱稱需為 1–24 字元，且不可包含 < > & \" ' ` % _ \\ 或控制字元。");
          const { needsEmailConfirmation } = await this.#service.signUp({ ...creds, displayName });
          this.#setNotice(needsEmailConfirmation ? "帳號已建立。請先完成電子郵件驗證，再回到這裡登入。" : "帳號建立完成，金鑰已加密封裝。");
        } else {
          await this.#service.logIn(creds);
          this.#setNotice("登入成功，帳號加密金鑰已解鎖。");
        }
      });
    } },
    h("h2", {}, "雲端帳號"),
    h("p", { class: "x-sub" }, signup ? "建立帳號後可在其他裝置登入並同步存檔。私鑰只會以密碼衍生的金鑰加密後上傳。" : "登入後可同步雲端存檔。"),
    email.wrap, password.wrap, nickname?.wrap,
    h("div", { class: "ns-row" },
      h("button", { type: "submit", class: "x-btn pri" }, signup ? "建立帳號" : "登入"),
      h("button", { type: "button", class: "x-btn", onclick: () => { this.#mode = signup ? "login" : "signup"; this.#notice = { text: "", error: false }; this.render(); } },
        signup ? "我已有帳號" : "建立新帳號")));
    panel.append(form, this.#statusEl);
  }

  #renderSignedIn(panel) {
    const svc = this.#service;
    panel.append(h("h2", {}, "雲端存檔"),
      h("p", { class: "x-sub" }, svc.profile?.displayName ? `已登入：${svc.profile.displayName}` : "已保留登入工作階段。"));
    if (!svc.unlocked) {
      const password = this.#field("登入密碼（只在本裝置記憶體中使用）", "password", "current-password", { maxLength: 256 });
      panel.append(h("form", { class: "ns-form", onsubmit: (e) => {
        e.preventDefault();
        this.#run(async () => { await svc.unlock(password.input.value); this.#setNotice("金鑰已解鎖；可以同步存檔。"); });
      } }, password.wrap, h("div", { class: "ns-row" },
        h("button", { type: "submit", class: "x-btn pri" }, "解鎖金鑰"),
        h("button", { type: "button", class: "x-btn", onclick: () => this.#run(() => svc.logOut()) }, "登出"))), this.#statusEl);
      return;
    }
    panel.append(h("p", { class: "x-sub" }, "加密金鑰已在目前分頁解鎖。存檔內容使用 ECDH + HKDF-SHA-256 + AES-256-GCM 加密。"),
      h("div", { class: "ns-row" },
        h("button", { type: "button", class: "x-btn pri", onclick: () => this.#run(async () => {
          const revision = await svc.uploadSave(this.#bridge.getSave());
          this.#setNotice(`雲端存檔完成（版本 ${revision}）。`);
        }) }, "上傳目前存檔"),
        h("button", { type: "button", class: "x-btn", onclick: () => this.#run(async () => {
          if (!window.confirm("這會用雲端存檔覆蓋本機存檔，確定嗎？")) return this.#setNotice("已取消。");
          const { save, revision } = await svc.downloadSave();
          this.#bridge.applySave(save);
          this.#setNotice(`已下載雲端存檔（版本 ${revision}），本機存檔已更新。`);
        }) }, "下載並覆蓋本機存檔"),
        h("button", { type: "button", class: "x-btn", onclick: () => this.#run(() => svc.logOut()) }, "登出")),
      this.#statusEl);
  }
}
