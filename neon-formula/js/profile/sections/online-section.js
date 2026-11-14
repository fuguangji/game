import { h } from "../../core/dom-utils.js";
import { ONLINE_MODES } from "../realtime-client.js";
import { ProfileSection } from "./profile-section.js";

const STATUS_TEXT = Object.freeze({ idle: "尚未連線", connecting: "連線中…", lobby: "已在房間", playing: "對戰中", ended: "對戰已結束" });

/**
 * 線上聯機大廳：選擇玩法（競爭 / 合作）→ 輸入房間代碼 → 連線並加入 → 房主按「開始對戰」。
 * 連線與對戰全部由 bridge.online（game/online-match.js）管理，這個頁面只是它的檢視；
 * 所以頁面被重新繪製（例如存檔變動）或切到別的分頁時連線不會中斷，開始對戰後這個頁面會被整個隱藏。
 * 需要登入；登出時自動中斷。
 */
export class OnlineSection extends ProfileSection {
  #el;
  #deps;
  #match;
  #abort = new AbortController();
  #gate = h("div", { class: "ns-feature-status" }, "請先到「雲端同步」登入遊戲帳號，才能使用線上聯機。");
  #panel;
  #modeButtons = new Map();
  #help = h("p", { class: "ns-feature-help" });
  #code = h("input", { maxLength: 8, placeholder: "房間代碼（4–8 位英數字）", value: "NEON01", autocomplete: "off", "aria-label": "房間代碼" });
  #join;
  #start;
  #leave;
  #status = h("p", { class: "ns-feature-status", role: "status" }, "尚未連線");
  #roster = h("ul", { class: "ns-online-roster" });
  #mode = "arena";

  /** @param {import('../profile-page.js').ProfileDeps} deps */
  constructor(deps) {
    super({ id: "online", title: "線上聯機" });
    this.#deps = deps;
    this.#match = deps.bridge.online;
    const btn = (label, fn, primary) => h("button", { type: "button", class: "ns-feature-btn" + (primary ? " primary" : ""), onclick: fn }, label);
    for (const mode of Object.values(ONLINE_MODES)) {
      const b = h("button", { type: "button", class: "ns-feature-btn", "aria-pressed": "false", onclick: () => this.#pickMode(mode.id) }, mode.label);
      this.#modeButtons.set(mode.id, b);
    }
    this.#join = btn("連線並加入", () => this.#connect(), true);
    this.#start = btn("開始對戰", () => this.#match.start(), true);
    this.#leave = btn("離開房間", () => this.#match.disconnect());
    this.#panel = h("div", { class: "ns-online" },
      h("div", { class: "ns-feature-row", role: "group", "aria-label": "玩法" }, ...this.#modeButtons.values()),
      this.#help,
      h("div", { class: "ns-feature-row" }, this.#code),
      h("div", { class: "ns-feature-row" }, this.#join, this.#start, this.#leave),
      this.#status, this.#roster);
    this.#el = h("section", { class: "ns-feature-card" }, h("h3", {}, "線上聯機"), this.#gate, this.#panel);
    deps.accountService.addEventListener("change", () => this.#syncGate(), { signal: this.#abort.signal });
    this.#match?.addEventListener("change", () => this.#render(), { signal: this.#abort.signal });
    const s = this.#match?.state;
    if (s && s.status !== "idle") { this.#mode = s.mode ?? "arena"; if (s.code) this.#code.value = s.code; }
    this.#syncGate();
    this.#render();
  }

  get element() { return this.#el; }

  onShow() { this.#syncGate(); this.#render(); }

  /** 離開頁面或被重新繪製時不中斷連線（連線屬於 bridge.online） */
  onHide() {}

  destroy() { this.#abort.abort(); }

  #pickMode(id) {
    if (this.#match?.state.status !== "idle") return;
    this.#mode = id;
    this.#render();
  }

  #syncGate() {
    const signedIn = this.#deps.accountService.signedIn;
    this.#gate.hidden = signedIn;
    this.#panel.hidden = !signedIn;
    if (!signedIn && this.#match?.state.status !== "idle") this.#match.disconnect();
  }

  #connect() {
    this.#match.connect({ mode: this.#mode, code: this.#code.value.trim() }).catch(() => { /* 錯誤訊息由 state.message 顯示 */ });
  }

  #render() {
    const m = this.#match;
    if (!m) return;
    const s = m.state;
    const idle = s.status === "idle";
    const mode = ONLINE_MODES[idle ? this.#mode : s.mode ?? this.#mode] ?? ONLINE_MODES.arena;
    for (const [id, b] of this.#modeButtons) {
      b.setAttribute("aria-pressed", String(id === mode.id));
      b.classList.toggle("primary", id === mode.id);
      b.disabled = !idle;
    }
    this.#help.textContent = `${mode.help}（${mode.minPlayers === 1 ? "1 人即可開始" : `至少 ${mode.minPlayers} 人`}，最多 4 人）`;
    this.#code.disabled = !idle;
    this.#join.disabled = s.status === "connecting" || !idle;
    const inLobby = s.status === "lobby";
    const canStart = inLobby && m.isHost && s.phase === "lobby" && s.players.length >= mode.minPlayers;
    this.#start.hidden = !inLobby || !m.isHost;
    this.#start.disabled = !canStart;
    this.#leave.disabled = idle;
    const base = idle ? STATUS_TEXT.idle : s.status === "lobby" ? `已加入 ${s.code} · ${mode.label} · ${s.players.length}/4 人` : STATUS_TEXT[s.status] ?? "";
    const hint = inLobby ? (m.isHost ? (canStart ? "你是房主，準備好就按「開始對戰」。" : `等待玩家加入（需要至少 ${mode.minPlayers} 人）…`) : s.phase === "lobby" ? "等待房主開始對戰…" : "房主還沒有重置房間，請稍候…") : "";
    this.#status.textContent = [base, hint, s.message].filter(Boolean).join("　");
    this.#roster.replaceChildren(...s.players.map((p) => h("li", {}, `${p.id === s.hostId ? "★ " : ""}${p.name}${p.id === m.myId ? "（你）" : ""}`)));
  }
}
