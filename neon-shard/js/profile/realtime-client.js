/**
 * 線上模式用戶端：管理 WebSocket 的連線、驗證、加入房間與訊息收發。
 * - 連線只有一條：重新連線會先關掉舊的，且舊連線遲到的事件一律忽略（不會有「幽靈連線」）
 * - 伺服器訊息先檢查格式；壞掉的 JSON 或未知類型只會被丟棄，不會丟出未處理例外
 * - 位置同步有節流（預設 80ms 一次），並限制座標在 0~1
 */
export const RealtimeStates = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  AUTHENTICATING: "authenticating",
  JOINING: "joining",
  IN_ROOM: "in-room",
  CLOSED: "closed",
});

const ROOM_CODE = /^[A-Za-z0-9]{4,8}$/;
const MODES = new Set(["arena", "boss"]);
const KNOWN = new Set(["authenticated", "error", "room", "combat", "move", "started", "shot", "eliminated", "end"]);

/** 玩法：協定名稱 → 顯示名稱。arena = 競爭（玩家對戰），boss = 合作（共享 Boss 血量） */
export const ONLINE_MODES = Object.freeze({
  arena: Object.freeze({ id: "arena", label: "競爭模式", short: "對戰", help: "玩家互相對戰，也能打場上的弱敵人得分；血量由伺服器決定，淘汰到剩最後一人（或時間到）分勝負。", minPlayers: 2 }),
  boss: Object.freeze({ id: "boss", label: "合作模式", short: "合作", help: "大家一起打同一隻 Boss，共用一條血量；各人的畫面各自模擬 Boss，血量與倒下的人由伺服器同步。", minPlayers: 1 }),
});

/** https://x → wss://x/api/realtime（http → ws，只用於本機開發） */
export function toRealtimeUrl(apiBase) {
  return String(apiBase).replace(/\/$/, "").replace(/^http/, "ws") + "/api/realtime";
}

export class RealtimeClient extends EventTarget {
  #url;
  #getToken;
  #WebSocket;
  #minMoveMs;
  #now;
  #socket = null;
  #state = RealtimeStates.IDLE;
  #pendingJoin = null;
  #lastMoveAt = 0;
  #playerId = null;

  /**
   * @param {{url:string, getToken:() => Promise<string|null>, WebSocketImpl?:typeof WebSocket, minMoveIntervalMs?:number, now?:() => number}} o
   */
  constructor({ url, getToken, WebSocketImpl = globalThis.WebSocket, minMoveIntervalMs = 80, now = Date.now }) {
    super();
    this.#url = url;
    this.#getToken = getToken;
    this.#WebSocket = WebSocketImpl;
    this.#minMoveMs = minMoveIntervalMs;
    this.#now = now;
  }

  get state() { return this.#state; }
  get inRoom() { return this.#state === RealtimeStates.IN_ROOM; }
  /** 伺服器確認身分後的玩家 id（Firebase UID） */
  get playerId() { return this.#playerId; }

  #setState(state, detail = {}) {
    this.#state = state;
    this.dispatchEvent(new CustomEvent("state", { detail: { state, ...detail } }));
  }

  /** 連線並加入房間；失敗會丟出 Error（訊息可直接顯示給玩家） */
  async connect({ mode, code }) {
    if (!MODES.has(mode)) throw new Error("不支援的玩法。");
    if (!ROOM_CODE.test(code)) throw new Error("房間代碼需為 4–8 位英數字。");
    this.close();
    this.#setState(RealtimeStates.CONNECTING);
    const token = await this.#getToken();
    if (!token) {
      this.#setState(RealtimeStates.IDLE);
      throw new Error("找不到有效的登入資訊，請先到「帳號」分頁登入。");
    }
    const ws = new this.#WebSocket(this.#url);
    this.#socket = ws;
    this.#pendingJoin = { mode, code: code.toUpperCase() };
    const live = () => this.#socket === ws; // 只處理目前這條連線的事件
    ws.onopen = () => { if (!live()) return; this.#setState(RealtimeStates.AUTHENTICATING); ws.send(JSON.stringify({ type: "auth", token })); };
    ws.onmessage = (event) => { if (live()) this.#handle(ws, event.data); };
    ws.onerror = () => { if (live()) this.dispatchEvent(new CustomEvent("problem", { detail: { message: "連線失敗：請確認網路、伺服器是否啟動中，以及登入狀態。" } })); };
    ws.onclose = (event) => { if (!live()) return; this.#socket = null; this.#setState(RealtimeStates.CLOSED, { code: event.code }); };
  }

  #handle(ws, raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg.type !== "string" || !KNOWN.has(msg.type)) return;
    if (msg.type === "authenticated") {
      this.#playerId = typeof msg.playerId === "string" ? msg.playerId : null;
      this.#setState(RealtimeStates.JOINING);
      ws.send(JSON.stringify({ type: "join", ...this.#pendingJoin }));
    } else if (msg.type === "error") {
      this.dispatchEvent(new CustomEvent("problem", { detail: { message: String(msg.message ?? "伺服器回報錯誤") } }));
    } else if (msg.type === "room") {
      if (this.#state !== RealtimeStates.IN_ROOM) this.#setState(RealtimeStates.IN_ROOM);
      this.dispatchEvent(new CustomEvent("room", { detail: msg }));
    } else {
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg })); // combat / move
    }
  }

  #send(payload) {
    if (this.#socket?.readyState !== 1) return false;
    this.#socket.send(JSON.stringify(payload));
    return true;
  }

  /** 位置同步（座標為 0~1 的畫面比例）；太頻繁的呼叫會被忽略 */
  move(x, y, hp) {
    if (!this.inRoom || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const t = this.#now();
    if (t - this.#lastMoveAt < this.#minMoveMs) return false;
    this.#lastMoveAt = t;
    const msg = { type: "move", x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    if (Number.isFinite(hp)) msg.hp = Math.max(0, Math.min(1, hp)); // 合作模式：自己的血量比例（只用於隊友血條）
    return this.#send(msg);
  }

  /** 舊版攻擊（只在大廳可用） */
  attack() {
    return this.inRoom && this.#send({ type: "attack" });
  }

  /** 房主開始對戰 */
  start() { return this.inRoom && this.#send({ type: "start" }); }

  /** 房主在結算後回到大廳 */
  reset() { return this.inRoom && this.#send({ type: "reset" }); }

  /** 彈道（只給其他人看的視覺效果；座標與速度皆為 0~1 比例） */
  shots(list) { return this.inRoom && list.length > 0 && this.#send({ type: "shot", shots: list.slice(0, 6) }); }

  /** 競爭模式：回報打中了某位玩家或弱敵人 */
  hit(target, dmg) { return this.inRoom && Number.isFinite(dmg) && dmg > 0 && this.#send({ type: "hit", target: String(target), dmg }); }

  /** 合作模式：回報對 Boss 造成的傷害（Boss 最大血量的千分比） */
  bossDamage(amount) { return this.inRoom && Number.isFinite(amount) && amount > 0 && this.#send({ type: "bossDamage", amount }); }

  /** 合作模式：自己倒下了 */
  died() { return this.inRoom && this.#send({ type: "died" }); }

  close() {
    const ws = this.#socket;
    this.#socket = null; // 先清掉，舊連線之後的事件都會被忽略
    this.#pendingJoin = null;
    this.#playerId = null;
    if (ws) { try { ws.close(1000, "client closing"); } catch { /* ignore */ } }
    if (this.#state !== RealtimeStates.IDLE && this.#state !== RealtimeStates.CLOSED) this.#setState(RealtimeStates.CLOSED, { code: 1000 });
  }
}
