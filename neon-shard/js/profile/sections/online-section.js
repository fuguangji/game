import { h } from "../../core/dom-utils.js";
import { RealtimeClient, RealtimeStates, toRealtimeUrl } from "../realtime-client.js";
import { ProfileSection } from "./profile-section.js";

const POSITION_SYNC_MS = 100;

/** 線上聯機：加入房間、同步位置、攻擊。需要登入；離開個人檔案頁面時會自動中斷連線。 */
export class OnlineSection extends ProfileSection {
  #el;
  #deps;
  #client = null;
  #timer = null;
  #abort = new AbortController();
  #gate = h("div", { class: "ns-feature-status" }, "請先到「雲端同步」登入遊戲帳號，才能使用線上聯機。");
  #panel;
  #mode = h("select", { "aria-label": "遊戲模式" }, h("option", { value: "arena" }, "競技場：弱敵人 + PvP"), h("option", { value: "boss" }, "合作 Boss 討伐"));
  #code = h("input", { maxLength: 8, placeholder: "房間代碼（4–8 位英數字）", value: "NEON01", autocomplete: "off", "aria-label": "房間代碼" });
  #attack;
  #status = h("p", { class: "ns-feature-status" }, "尚未連線");
  #room = h("p", { class: "ns-feature-status" });

  /** @param {import('../profile-page.js').ProfileDeps} deps */
  constructor(deps) {
    super({ id: "online", title: "線上聯機" });
    this.#deps = deps;
    const btn = (label, fn, primary) => h("button", { type: "button", class: "ns-feature-btn" + (primary ? " primary" : ""), onclick: fn }, label);
    this.#attack = btn("攻擊", () => this.#client?.attack());
    this.#attack.disabled = true;
    this.#panel = h("div", { class: "ns-online" },
      h("p", { class: "ns-feature-help" }, "選擇競技場或合作 Boss，輸入相同房間代碼即可加入同一房間。離開此頁面會自動中斷連線。"),
      h("div", { class: "ns-feature-row" }, this.#mode, this.#code),
      h("div", { class: "ns-feature-row" }, btn("連線並加入", () => this.#connect(), true), this.#attack, btn("中斷連線", () => this.#disconnect())),
      this.#status, this.#room);
    this.#el = h("section", { class: "ns-feature-card" }, h("h3", {}, "線上聯機"), this.#gate, this.#panel);
    deps.accountService.addEventListener("change", () => this.#syncGate(), { signal: this.#abort.signal });
    this.#syncGate();
  }

  get element() { return this.#el; }

  onShow() { this.#syncGate(); }

  onHide() { this.#disconnect(); }

  destroy() {
    this.#abort.abort();
    this.#disconnect();
  }

  #syncGate() {
    const signedIn = this.#deps.accountService.signedIn;
    this.#gate.hidden = signedIn;
    this.#panel.hidden = !signedIn;
    if (!signedIn) this.#disconnect();
  }

  async #connect() {
    this.#disconnect();
    const { accountService, apiBase, bridge } = this.#deps;
    const client = new RealtimeClient({ url: toRealtimeUrl(apiBase), getToken: () => accountService.getFreshAccessToken() });
    this.#client = client;
    const on = (type, fn) => client.addEventListener(type, fn);
    on("state", (e) => {
      this.#attack.disabled = e.detail.state !== RealtimeStates.IN_ROOM;
      if (e.detail.state === RealtimeStates.CLOSED) this.#status.textContent = `連線已關閉（${e.detail.code ?? ""}）。`;
    });
    on("problem", (e) => { this.#status.textContent = e.detail.message; });
    const show = (d) => {
      this.#room.textContent = `玩家：${(d.players ?? []).map((p) => `${p.name}（HP ${p.hp}）`).join("、")}\nBoss HP：${d.bossHp}\n敵人 HP：${(d.mobs ?? []).map((m) => m.hp).join(" / ")}`;
    };
    on("room", (e) => { this.#status.textContent = `已加入 ${e.detail.code} · ${e.detail.mode === "boss" ? "合作 Boss" : "競技場"} · ${e.detail.players.length}/4 人`; show(e.detail); });
    on("combat", (e) => show(e.detail));
    this.#status.textContent = "連線中…（免費主機閒置後需要 30～60 秒喚醒）";
    try {
      await client.connect({ mode: this.#mode.value, code: this.#code.value.trim() });
    } catch (error) {
      this.#status.textContent = error.message;
      return;
    }
    // 位置同步：頁面不在畫面上（被移除）時自動停止
    this.#timer = setInterval(() => {
      if (!this.#el.isConnected) return this.destroy();
      const pos = bridge.getPlayerPosition();
      if (pos) client.move(pos.x, pos.y);
    }, POSITION_SYNC_MS);
    this.#timer.unref?.();
  }

  #disconnect() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#client?.close();
    this.#client = null;
    this.#attack.disabled = true;
  }
}
