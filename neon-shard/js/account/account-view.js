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
import { confirmDialog } from "../ui/feedback.js";

const NICKNAME_PATTERN = /^[^<>&"'`%_\\\u0000-\u001f\u007f]{1,24}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
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
  #lastSync = null;
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
    if (!this.#service.signedIn) this.#renderSignedOut(panel);
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

  #seg() {
    const options = [["login", "登入"], ["signup", "建立帳號"]];
    return h("div", { class: "ns-seg", role: "tablist", "aria-label": "登入或建立帳號" },
      ...options.map(([mode, text]) => h("button", {
        type: "button", role: "tab", class: "ns-seg-btn" + (this.#mode === mode ? " on" : ""), "aria-selected": String(this.#mode === mode),
        onclick: () => { if (this.#mode === mode) return; this.#mode = mode; this.#notice = { text: "", error: false }; this.render(); this.#container.querySelector("input")?.focus(); },
      }, text)));
  }

  /* ---------- 未登入 ---------- */
  #renderSignedOut(panel) {
    const signup = this.#mode === "signup";
    const email = this.#field({ label: "電子郵件", type: "email", autocomplete: "email", maxLength: 254, help: signup ? "用來登入與接收驗證信。" : "" });
    const password = this.#field({
      label: "密碼", type: "password", password: true, maxLength: 256, minLength: signup ? MIN_PASSWORD : 1,
      autocomplete: signup ? "new-password" : "current-password",
      help: signup ? `至少 ${MIN_PASSWORD} 個字元。這個密碼同時保護你的雲端存檔，請記好。` : "",
    });
    const nickname = signup ? this.#field({ label: "遊戲暱稱", type: "text", autocomplete: "nickname", maxLength: 24, help: "1～24 個字，會顯示在個人檔案。不能包含 < > & \" ' ` % _ \\" }) : null;

    // 即時提示：邊打邊告訴玩家還缺什麼，而不是按下送出才被罵
    if (signup) {
      password.input.addEventListener("input", () => {
        const left = MIN_PASSWORD - password.input.value.length;
        password.fail("");
        if (left > 0) password.setHelp(`還差 ${left} 個字元。`);
        else password.setHelp("✓ 長度足夠。這個密碼同時保護你的雲端存檔，請記好。", true);
      });
      nickname.input.addEventListener("input", () => {
        const value = nickname.input.value.trim();
        nickname.fail("");
        if (value && !NICKNAME_PATTERN.test(value)) nickname.setHelp("暱稱含有不允許的符號，請移除。");
        else nickname.setHelp(`${value.length} / 24 字`, !!value);
      });
    }
    email.input.addEventListener("input", () => email.fail(""));

    const validate = () => {
      const problems = [];
      if (!EMAIL_PATTERN.test(email.input.value.trim())) problems.push([email, "請輸入正確的電子郵件，例如 name@example.com。"]);
      if (!password.input.value) problems.push([password, "請輸入密碼。"]);
      else if (signup && password.input.value.length < MIN_PASSWORD) problems.push([password, `密碼至少要 ${MIN_PASSWORD} 個字元。`]);
      if (signup && !NICKNAME_PATTERN.test(nickname.input.value.trim())) problems.push([nickname, "暱稱需為 1～24 個字，且不能包含 < > & \" ' ` % _ \\ 或控制字元。"]);
      for (const f of [email, password, nickname]) f?.fail("");
      for (const [field, message] of problems) field.fail(message);
      problems[0]?.[0].input.focus();
      return problems.length === 0;
    };

    const submit = h("button", { type: "submit", class: "x-btn pri blk" }, signup ? "建立帳號" : "登入");
    const form = h("form", { class: "ns-form", novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      if (!validate()) { this.#setNotice("請先修正標示的欄位。", true); return; }
      this.#run(async () => {
        const creds = { email: email.input.value.trim(), password: password.input.value };
        if (signup) {
          const { needsEmailConfirmation } = await this.#service.signUp({ ...creds, displayName: nickname.input.value.trim() });
          this.#setNotice(needsEmailConfirmation ? "帳號已建立！請到信箱點擊驗證連結，完成後回到這裡「登入」。" : "帳號建立完成，存檔加密金鑰已準備好。");
        } else {
          await this.#service.logIn(creds);
          this.#setNotice("登入成功，可以開始同步存檔了。");
        }
      }, { busyText: signup ? "正在建立帳號並產生加密金鑰…" : "登入中…", action: signup ? "signup" : "login" });
    } }, email.wrap, password.wrap, nickname?.wrap, submit);

    panel.append(
      h("header", { class: "ns-intro" },
        h("h2", {}, "雲端存檔 ", h("span", { class: "ns-pill" }, "選用")),
        h("p", {}, "不登入也能完整遊玩，進度會保存在這台裝置。登入後，可以在不同裝置之間接關。"),
        h("ul", { class: "ns-points" },
          h("li", {}, "🔒 存檔內容會先在這台裝置加密，再上傳。"),
          h("li", {}, "📱 換手機或電腦時，登入後按「從雲端載入」就能接關。"),
          h("li", { class: "warn" }, "⚠️ 忘記密碼可能就解不開雲端存檔，請把密碼記好。"))),
      this.#seg(),
      form,
      this.#statusEl);
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
      const password = this.#field({ label: "登入密碼", type: "password", password: true, autocomplete: "current-password", maxLength: 256,
        help: "重新整理頁面後，加密金鑰需要用密碼重新解鎖。密碼只在這台裝置的記憶體中使用，不會被儲存。" });
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

  #clock() {
    return new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }
}
