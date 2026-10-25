import { h } from "../../core/dom-utils.js";
import { FirebaseRoomClient } from "../firebase-room-client.js";
import { ProfileSection } from "./profile-section.js";

const POSITION_SYNC_MS = 100;

export class OnlineSection extends ProfileSection {
  #el;
  #deps;
  #client = null;
  #timer = null;
  #abort = new AbortController();
  #mode = h("select", { "aria-label": "遊戲模式" },
    h("option", { value: "arena" }, "競技場：PvP"),
    h("option", { value: "boss" }, "合作 Boss 討伐"));
  #code = h("input", {
    maxLength: 6,
    placeholder: "6 位房間代碼",
    value: "",
    autocomplete: "off",
    "aria-label": "房間代碼",
    autocapitalize: "characters",
    spellcheck: "false",
  });
  #attack;
  #status = h("p", { class: "ns-feature-status", role: "status", "aria-live": "polite" }, "尚未連線");
  #room = h("p", { class: "ns-feature-status" });
  #remote = h("p", { class: "ns-feature-help" }, "尚未收到對方資料。");

  constructor(deps) {
    super({ id: "online", title: "線上聯機" });
    this.#deps = deps;
    const btn = (label, fn, primary = false) => h("button", {
      type: "button",
      class: "ns-feature-btn" + (primary ? " primary" : ""),
      onclick: fn,
    }, label);
    this.#attack = btn("傳送攻擊輸入", () => {
      const sent = this.#client?.attack();
      this.#status.textContent = sent
        ? "已把攻擊輸入送到對方。"
        : "資料通道尚未連線。";
    });
    this.#attack.disabled = true;
    const codeRow = h("div", { class: "ns-feature-row" }, this.#mode, this.#code);
    const actions = h("div", { class: "ns-feature-row" },
      btn("建立房間（我是房主）", () => this.#createRoom(), true),
      btn("加入房間", () => this.#joinRoom(), true),
      this.#attack,
      btn("中斷連線", () => this.#disconnect()));
    const panel = h("div", { class: "ns-online" },
      h("p", { class: "ns-feature-help" },
        "建立房間後把代碼給另一位玩家；兩人使用相同模式。Firebase 負責配對與 WebRTC 訊號，遊戲封包直接走 P2P。房主關閉頁面時房間結束。"),
      codeRow, actions, this.#status, this.#room, this.#remote);
    this.#el = h("section", { class: "ns-feature-card" },
      h("h3", {}, "雙人線上聯機"), panel);
  }

  get element() { return this.#el; }
  onShow() {}
  onHide() { this.#disconnect(); }
  destroy() {
    this.#abort.abort();
    this.#disconnect();
  }

  async #createRoom() {
    await this.#start("host");
  }

  async #joinRoom() {
    await this.#start("guest");
  }

  async #start(role) {
    this.#disconnect();
    let client;
    try {
      client = new FirebaseRoomClient();
    } catch (error) {
      this.#status.textContent = error?.message || "Firebase 初始化失敗。";
      return;
    }
    this.#client = client;
    const listen = (type, fn) => client.addEventListener(type, fn, { signal: this.#abort.signal });
    listen("state", (event) => {
      const state = event.detail.state;
      this.#attack.disabled = state !== "connected";
      if (state === "connected") this.#status.textContent = "P2P 已連線，可以傳送測試輸入。";
      else if (state === "disconnected") this.#status.textContent = "P2P 連線中斷。";
    });
    listen("problem", (event) => { this.#status.textContent = event.detail.message; });
    listen("room", (event) => {
      const room = event.detail;
      if (room.code) this.#code.value = room.code;
      const modeLabel = room.mode === "boss" ? "合作 Boss" : "競技場";
      this.#room.textContent = `房間 ${room.code || this.#code.value} · ${modeLabel} · ${room.role === "host" ? "房主" : "加入者"} · ${room.players ?? (room.status === "connected" ? 2 : 1)}/2 人 · ${room.status}`;
    });
    listen("message", (event) => {
      const msg = event.detail.message;
      if (msg.type === "move" && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
        this.#remote.textContent = `已收到對方位置資料：x=${msg.x.toFixed(3)}, y=${msg.y.toFixed(3)}（比例座標）。`;
      } else if (msg.type === "attack") {
        this.#remote.textContent = "已收到對方的攻擊輸入封包。";
      } else {
        this.#remote.textContent = `已收到資料封包：${msg.type}`;
      }
    });

    this.#status.textContent = "正在登入 Firebase 並建立 WebRTC 連線…";
    try {
      const options = { mode: this.#mode.value };
      if (role === "host") {
        const code = await client.createRoom(options);
        this.#code.value = code;
        this.#status.textContent = "房間已建立。把 6 位代碼傳給另一位玩家，並保持此頁面開啟。";
      } else {
        await client.joinRoom({ ...options, code: this.#code.value });
        this.#status.textContent = "已加入房間，正在協商 P2P 連線…";
      }
    } catch (error) {
      this.#status.textContent = error?.message || "連線失敗，請檢查 Firebase 設定與資料庫規則。";
      await client.close();
      if (this.#client === client) this.#client = null;
      return;
    }

    this.#timer = setInterval(() => {
      if (!this.#el.isConnected) return this.destroy();
      const pos = this.#deps.bridge.getPlayerPosition();
      if (pos) client.move(pos.x, pos.y);
    }, POSITION_SYNC_MS);
  }

  #disconnect() {
    clearInterval(this.#timer);
    this.#timer = null;
    const client = this.#client;
    this.#client = null;
    this.#attack.disabled = true;
    if (client) void client.close();
  }
}
