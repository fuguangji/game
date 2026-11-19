/**
 * 線上模式用戶端：管理 WebSocket 的連線、驗證、加入房間與訊息收發。
 * - 連線只有一條：重新連線會先關掉舊的，且舊連線遲到的事件一律忽略（不會有「幽靈連線」）
 * - 伺服器訊息先檢查格式；壞掉的 JSON 或未知類型只會被丟棄，不會丟出未處理例外
 * - 位置同步有節流（預設 80ms 一次），並限制座標在 0~1
 * - 意外斷線會自動重連（指數退避、每次重新取得登入 token、重連後自動回到同一個房間）；
 *   伺服器會替對戰中的玩家保留位置 30 秒，所以短暫的網路抖動不會被當成退出
 * - 在房間裡每隔幾秒量一次來回延遲（ping / pong）
 */
export const RealtimeStates = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  AUTHENTICATING: "authenticating",
  JOINING: "joining",
  IN_ROOM: "in-room",
  RECONNECTING: "reconnecting",
  CLOSED: "closed",
});

/** 重連的等待時間（毫秒）：約 25 秒內嘗試 6 次；伺服器保留位置 30 秒，超過就放棄 */
export const RECONNECT_DELAYS = Object.freeze([500, 1000, 2000, 4000, 8000, 10000]);
/** 這些關閉代碼代表「重連也沒用」：主動關閉、驗證失敗、被別處登入頂掉、訊息太頻繁、伺服器沒設定 */
const NO_RETRY_CODES = new Set([1000, 1013, 4401, 4409, 4429]);
export const GAVE_UP_CODE = 4000;
const PING_MS = 5000;

const ROOM_CODE = /^[A-Za-z0-9]{4,8}$/;
const MODES = new Set(["arena", "boss"]);
const KNOWN = new Set(["authenticated", "error", "room", "combat", "move", "started", "shot", "eliminated", "end", "pong"]);

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
  #setTimer;
  #clearTimer;
  #delays;
  #wantOpen = false; // 玩家想保持連線（主動 close() 後為 false，就不會重連）
  #attempt = 0;
  #retryTimer = null;
  #pingTimer = null;
  #latency = null;
  #wasReconnecting = false;
  #generation = 0;

  /**
   * @param {{url:string, getToken:() => Promise<string|null>, WebSocketImpl?:typeof WebSocket, minMoveIntervalMs?:number, now?:() => number}} o
   */
  constructor({ url, getToken, WebSocketImpl = globalThis.WebSocket, minMoveIntervalMs = 80, now = Date.now, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), reconnectDelays = RECONNECT_DELAYS }) {
    super();
    this.#url = url;
    this.#getToken = getToken;
    this.#WebSocket = WebSocketImpl;
    this.#minMoveMs = minMoveIntervalMs;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#delays = reconnectDelays;
  }

  get state() { return this.#state; }
  get inRoom() { return this.#state === RealtimeStates.IN_ROOM; }
  /** 伺服器確認身分後的玩家 id（Firebase UID） */
  get playerId() { return this.#playerId; }
  /** 最近一次量到的來回延遲（毫秒）；還沒量到是 null */
  get latency() { return this.#latency; }

  #setState(state, detail = {}) {
    this.#state = state;
    this.dispatchEvent(new CustomEvent("state", { detail: { state, ...detail } }));
  }

  /** 連線並加入房間；失敗會丟出 Error（訊息可直接顯示給玩家） */
  async connect({ mode, code }) {
    if (!MODES.has(mode)) throw new Error("不支援的玩法。");
    if (!ROOM_CODE.test(code)) throw new Error("房間代碼需為 4–8 位英數字。");
    this.close();
    this.#wantOpen = true;
    this.#attempt = 0;
    this.#wasReconnecting = false;
    this.#pendingJoin = { mode, code: code.toUpperCase() };
    const generation = ++this.#generation;
    this.#setState(RealtimeStates.CONNECTING);
    const token = await this.#getToken();
    if (generation !== this.#generation) return; // 等 token 的時候已經被 close() 或新的 connect() 取代
    if (!token) {
      this.#wantOpen = false;
      this.#pendingJoin = null;
      this.#setState(RealtimeStates.IDLE);
      throw new Error("找不到有效的登入資訊，請先到「帳號」分頁登入。");
    }
    this.#open(token);
  }

  /** 建立一條 WebSocket（第一次連線與每一次重連都走這裡） */
  #open(token) {
    const ws = new this.#WebSocket(this.#url);
    this.#socket = ws;
    const live = () => this.#socket === ws; // 只處理目前這條連線的事件
    ws.onopen = () => { if (!live()) return; this.#setState(RealtimeStates.AUTHENTICATING); ws.send(JSON.stringify({ type: "auth", token })); };
    ws.onmessage = (event) => { if (live()) this.#handle(ws, event.data); };
    ws.onerror = () => { if (live() && this.#wantOpen && this.#attempt === 0) this.dispatchEvent(new CustomEvent("problem", { detail: { message: "連線失敗：請確認網路、伺服器是否啟動中，以及登入狀態。" } })); };
    ws.onclose = (event) => {
      if (!live()) return;
      this.#socket = null;
      this.#stopPing();
      this.#latency = null;
      if (this.#wantOpen && this.#pendingJoin && !NO_RETRY_CODES.has(event.code)) this.#scheduleRetry(event.code);
      else this.#setState(RealtimeStates.CLOSED, { code: event.code });
    };
  }

  /** 意外斷線：過一會兒重連；試完所有次數還是不行就放棄 */
  #scheduleRetry(code) {
    if (this.#attempt >= this.#delays.length) {
      this.#wantOpen = false;
      this.#setState(RealtimeStates.CLOSED, { code: GAVE_UP_CODE, lastCode: code });
      return;
    }
    const inMs = this.#delays[this.#attempt++];
    this.#wasReconnecting = true;
    this.#setState(RealtimeStates.RECONNECTING, { attempt: this.#attempt, of: this.#delays.length, inMs, lastCode: code });
    const generation = this.#generation;
    this.#retryTimer = this.#setTimer(async () => {
      this.#retryTimer = null;
      if (!this.#wantOpen || generation !== this.#generation) return;
      let token = null;
      try { token = await this.#getToken(); } catch { /* 取不到 token 當作失敗，下面處理 */ }
      if (!this.#wantOpen || generation !== this.#generation) return;
      if (!token) { // 登入過期或已登出：重連沒有意義
        this.#wantOpen = false;
        this.#setState(RealtimeStates.CLOSED, { code: 4401 });
        return;
      }
      this.#setState(RealtimeStates.CONNECTING, { attempt: this.#attempt, of: this.#delays.length });
      this.#open(token);
    }, inMs);
  }

  #startPing() {
    this.#stopPing();
    const tick = () => {
      this.#pingTimer = this.#setTimer(tick, PING_MS);
      this.#send({ type: "ping", t: this.#now() });
    };
    tick();
  }

  #stopPing() {
    if (this.#pingTimer) this.#clearTimer(this.#pingTimer);
    this.#pingTimer = null;
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
      if (this.#state !== RealtimeStates.IN_ROOM) {
        this.#setState(RealtimeStates.IN_ROOM);
        this.#attempt = 0;
        this.#startPing();
        if (this.#wasReconnecting) { this.#wasReconnecting = false; this.dispatchEvent(new CustomEvent("reconnected")); }
      }
      this.dispatchEvent(new CustomEvent("room", { detail: msg }));
    } else if (msg.type === "pong") {
      const rtt = this.#now() - Number(msg.t);
      if (Number.isFinite(rtt) && rtt >= 0 && rtt < 60_000) {
        this.#latency = Math.round(rtt);
        this.dispatchEvent(new CustomEvent("latency", { detail: { ms: this.#latency } }));
      }
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
    this.#wantOpen = false;
    this.#generation++;
    this.#pendingJoin = null;
    this.#playerId = null;
    this.#latency = null;
    this.#wasReconnecting = false;
    this.#stopPing();
    if (this.#retryTimer) this.#clearTimer(this.#retryTimer);
    this.#retryTimer = null;
    if (ws) { try { ws.close(1000, "client closing"); } catch { /* ignore */ } }
    if (this.#state !== RealtimeStates.IDLE && this.#state !== RealtimeStates.CLOSED) this.#setState(RealtimeStates.CLOSED, { code: 1000 });
  }
}
