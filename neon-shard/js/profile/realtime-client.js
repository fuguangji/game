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
const KNOWN = new Set(["authenticated", "error", "room", "combat", "move"]);

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
  move(x, y) {
    if (!this.inRoom || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const t = this.#now();
    if (t - this.#lastMoveAt < this.#minMoveMs) return false;
    this.#lastMoveAt = t;
    return this.#send({ type: "move", x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
  }

  attack() {
    return this.inRoom && this.#send({ type: "attack" });
  }

  close() {
    const ws = this.#socket;
    this.#socket = null; // 先清掉，舊連線之後的事件都會被忽略
    this.#pendingJoin = null;
    if (ws) { try { ws.close(1000, "client closing"); } catch { /* ignore */ } }
    if (this.#state !== RealtimeStates.IDLE && this.#state !== RealtimeStates.CLOSED) this.#setState(RealtimeStates.CLOSED, { code: 1000 });
  }
}
