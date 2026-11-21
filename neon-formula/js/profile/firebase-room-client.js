import { FIREBASE_CONFIG, FIREBASE_ICE_SERVERS } from "./firebase-config.js";

// 只在玩家真的開始線上遊玩時才載入瀏覽器 SDK，避免 Node 單元測試與本機匯入檢查去載入 HTTPS 網址。
let initializeApp, getApps, getAuth, signInAnonymously, getDatabase;
let ref, get, set, update, remove, push, runTransaction, onValue, onChildAdded, onDisconnect;
let sdkLoadPromise;
async function loadFirebaseSdk() {
  if (!sdkLoadPromise) {
    sdkLoadPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js"),
    ]).then(([appSdk, authSdk, dbSdk]) => {
      ({ initializeApp, getApps } = appSdk);
      ({ getAuth, signInAnonymously } = authSdk);
      ({ getDatabase, ref, get, set, update, remove, push, runTransaction, onValue, onChildAdded, onDisconnect } = dbSdk);
    }).catch((error) => {
      sdkLoadPromise = null;
      throw error;
    });
  }
  await sdkLoadPromise;
}

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const MODES = new Set(["arena", "boss"]);
const SDK_APP_NAME = "neon-shard-online";
/** 對方（遠端）可以送來的訊息類型。只有這些會變成事件；其他一律丟棄，避免對方偽造 room / state / problem 這類「本機自己的」事件 */
const REMOTE_TYPES = new Set(["move", "attack", "hello", "ping", "pong"]);
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_CANDIDATE_CHARS = 2048;
const CONNECT_TIMEOUT_MS = 25_000;

function emit(target, type, detail = {}) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => chars[n % chars.length]).join("");
}
function randomSid() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/**
 * Realtime Database 不接受 undefined（寫入會丟「contains undefined in property …」），
 * 而 RTCIceCandidate.toJSON() 在部分瀏覽器會給出 undefined 的 usernameFragment／sdpMid。
 * 這裡把所有 undefined 換成 null（RTDB 會把 null 視為「不存在」），陣列內的也一併處理。
 */
export function toDbValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return Number.isNaN(value) ? null : value;
  if (Array.isArray(value)) return value.map(toDbValue);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const clean = toDbValue(item);
    if (clean !== null) out[key] = clean;
  }
  return out;
}

/** 整理要送進資料庫的 ICE 候選資料（只留標準欄位，並限制長度） */
export function candidateToDb(candidate, sid) {
  const raw = typeof candidate?.toJSON === "function" ? candidate.toJSON() : candidate;
  if (!raw || typeof raw.candidate !== "string" || !raw.candidate || raw.candidate.length > MAX_CANDIDATE_CHARS) return null;
  return toDbValue({
    candidate: raw.candidate,
    sdpMid: raw.sdpMid ?? null,
    sdpMLineIndex: Number.isInteger(raw.sdpMLineIndex) ? raw.sdpMLineIndex : null,
    usernameFragment: raw.usernameFragment ?? null,
    sid,
  });
}

/** 從資料庫讀回的候選資料轉成 addIceCandidate 要的格式；格式不對回傳 null */
export function candidateFromDb(value) {
  if (!value || typeof value.candidate !== "string" || value.candidate.length > MAX_CANDIDATE_CHARS) return null;
  const init = { candidate: value.candidate };
  if (typeof value.sdpMid === "string") init.sdpMid = value.sdpMid;
  if (Number.isInteger(value.sdpMLineIndex)) init.sdpMLineIndex = value.sdpMLineIndex;
  if (typeof value.usernameFragment === "string") init.usernameFragment = value.usernameFragment;
  return init;
}

/**
 * ICE 伺服器：預設只有 STUN（對稱型 NAT 連不上）。需要 TURN 時，在載入遊戲前設定
 *   window.NEON_SHARD_ICE_SERVERS = [{ urls: "turn:example.com:3478", username: "…", credential: "…" }];
 * 格式不對的項目會被忽略。
 */
export function resolveIceServers(extra = globalThis.window?.NEON_SHARD_ICE_SERVERS) {
  const list = [...FIREBASE_ICE_SERVERS];
  if (Array.isArray(extra)) {
    for (const item of extra) {
      const urls = Array.isArray(item?.urls) ? item.urls : [item?.urls];
      if (!urls.length || !urls.every((u) => typeof u === "string" && /^(stun|stuns|turn|turns):/.test(u))) continue;
      const server = { urls: item.urls };
      if (typeof item.username === "string") server.username = item.username;
      if (typeof item.credential === "string") server.credential = item.credential;
      list.push(server);
    }
  }
  return list;
}

function validConfig() {
  return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "REPLACE_ME"
    && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.projectId !== "REPLACE_ME"
    && FIREBASE_CONFIG.databaseURL && !FIREBASE_CONFIG.databaseURL.includes("REPLACE_ME");
}

const isPermissionDenied = (error) => /permission[_ ]denied/i.test(`${error?.code ?? ""} ${error?.message ?? ""}`);

/**
 * Firebase Realtime Database 只負責房間資料與 WebRTC 訊號交換；遊戲封包走加密的 WebRTC DataChannel，不經過 Firebase。
 *
 * 連線流程（每一次「配對」有一個 sid，避免舊的 offer / answer / 候選資料混進新的連線）：
 *   房主：建立房間 → 建 PeerConnection → 寫 offer(sid) → 等 answer(sid) → 交換 ICE → DataChannel 開啟
 *   訪客：佔位 guestUid → 讀 offer → 寫 answer(sid) → 交換 ICE
 *   訪客離開（或斷線）時釋放 guestUid，房主偵測到後重新產生 offer，房間可以再讓人加入。
 */
export class FirebaseRoomClient extends EventTarget {
  #auth;
  #db;
  #pc = null;
  #channel = null;
  #roomCode = null;
  #role = null;
  #mode = null;
  #uid = null;
  #sid = null;
  #unsubscribers = [];
  #peerUnsubscribers = [];
  #candidateQueue = [];
  #closed = false;
  #generation = 0;
  #guestSeen = false;
  #renegotiating = false;
  #connectTimer = null;

  get connected() { return this.#channel?.readyState === "open"; }
  get roomCode() { return this.#roomCode; }
  get role() { return this.#role; }

  async #ensureAuth() {
    if (!validConfig()) throw new Error("Firebase 尚未設定：請依 dev.md 填入 firebase-config.js。");
    await loadFirebaseSdk();
    if (!this.#auth || !this.#db) {
      const app = getApps().find((item) => item.name === SDK_APP_NAME)
        ?? initializeApp(FIREBASE_CONFIG, SDK_APP_NAME);
      this.#auth = getAuth(app);
      this.#db = getDatabase(app);
    }
    // 重新整理頁面後，SDK 要先把存在瀏覽器裡的登入狀態讀回來；沒等這一步 currentUser 一律是 null，
    // 會每次都建立新的匿名帳號，結果同一個玩家重新整理後被當成另一個人（舊座位卡死、房間顯示已滿）。
    if (typeof this.#auth.authStateReady === "function") await this.#auth.authStateReady();
    if (!this.#auth.currentUser) await signInAnonymously(this.#auth);
    if (!this.#auth.currentUser) throw new Error("Firebase 匿名登入失敗，請確認已啟用 Anonymous Authentication。");
    this.#uid = this.#auth.currentUser.uid;
    return this.#uid;
  }

  /** 非同步流程中途被 close() 打斷時，丟出錯誤讓呼叫端結束 */
  #assertAlive(generation) {
    if (this.#closed || generation !== this.#generation) throw new Error("已取消連線。");
  }

  async createRoom({ mode = "boss" } = {}) {
    if (!MODES.has(mode)) throw new Error("不支援的遊戲模式。");
    // 先「同步」關掉舊連線並領新的世代編號，再等舊連線收尾；
    // 這樣在任何 await 之前被呼叫的 close() 都不會被這裡的重設蓋掉。
    const previous = this.close();
    this.#closed = false;
    const generation = ++this.#generation;
    await previous;
    let createdCode = null;
    try {
      const uid = await this.#ensureAuth();
      this.#assertAlive(generation);
      let code = "";
      let created = false;
      for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
        code = randomCode();
        const result = await runTransaction(ref(this.#db, `rooms/${code}`), (current) => {
          if (current !== null) return; // 代碼已被使用：放棄這次交易
          return { hostUid: uid, mode, status: "waiting", createdAt: Date.now() };
        }, { applyLocally: false });
        created = result.committed;
      }
      if (!created) throw new Error("暫時無法建立唯一房間代碼，請再試一次。");
      createdCode = code;
      this.#assertAlive(generation);

      this.#roomCode = code;
      this.#role = "host";
      this.#mode = mode;
      // 房主離線（關分頁、斷網）時整間房一起刪掉，不留下殘骸房間
      await onDisconnect(ref(this.#db, `rooms/${code}`)).remove();
      this.#watchRoom();
      this.#watchGuestSlot();
      await this.#startHostPairing();
      emit(this, "room", { code, mode, role: "host", status: "waiting", players: 1 });
      return code;
    } catch (error) {
      await this.#abandon(generation, "host", createdCode);
      throw error;
    }
  }

  async joinRoom({ code, mode = "boss" } = {}) {
    if (!MODES.has(mode)) throw new Error("不支援的遊戲模式。");
    code = String(code ?? "").trim().toUpperCase();
    if (!ROOM_CODE.test(code)) throw new Error("房間代碼必須是 6 位英數字（不含易混淆字元）。");
    const previous = this.close();
    this.#closed = false;
    const generation = ++this.#generation;
    await previous;
    let takenCode = null;
    try {
      const uid = await this.#ensureAuth();
      this.#assertAlive(generation);
      const roomRef = ref(this.#db, `rooms/${code}`);
      let initial;
      try {
        initial = await get(roomRef);
      } catch (error) {
        // 資料庫規則只讓「還在等人的房間」被陌生人讀取；滿員或已關閉的房間會被擋下
        if (isPermissionDenied(error)) throw new Error("找不到可加入的房間：代碼錯誤、房間已滿，或房主已離線。");
        throw error;
      }
      this.#assertAlive(generation);
      if (!initial.exists()) throw new Error("找不到房間；請確認代碼，並請房主保持頁面開啟。");
      const room = initial.val();
      if (room.status === "closed") throw new Error("房主已離線，這個房間已結束。");
      if (room.mode !== mode) throw new Error("房間模式不同，請選擇與房主相同的模式。");
      if (room.hostUid === uid) throw new Error("同一個瀏覽器不能加入自己建立的房間。");

      // 搶座位。若座位上已經是自己（重新整理頁面後回來），視為重新加入，不算「已滿」
      const slot = await runTransaction(ref(this.#db, `rooms/${code}/guestUid`), (current) => {
        if (current === null || current === uid) return uid;
        return; // 被別人佔走了
      }, { applyLocally: false });
      if (!slot.committed) throw new Error("房間已滿（最多 2 人）。");
      takenCode = code;
      this.#assertAlive(generation);

      this.#roomCode = code;
      this.#role = "guest";
      this.#mode = mode;
      // 訪客離線時自動釋放座位，房主才能讓下一位加入
      await onDisconnect(ref(this.#db, `rooms/${code}/guestUid`)).remove();
      this.#watchRoom();
      this.#watchOffer();
      emit(this, "room", { code, mode, role: "guest", status: "connecting", players: 2 });
      return code;
    } catch (error) {
      await this.#abandon(generation, "guest", takenCode);
      throw error;
    }
  }

  /**
   * 建立／加入流程失敗或被取消時的善後。
   * 目前這個流程還是「現役」就直接 close()；若已被另一次 close() 或新的連線取代，
   * 就只清掉「這個流程自己」建立的資料（房間或座位），不碰新連線的狀態。
   */
  async #abandon(generation, role, code) {
    if (generation === this.#generation) { await this.close(); return; }
    if (!code || !this.#db) return;
    if (role === "host") {
      try { await remove(ref(this.#db, `rooms/${code}`)); } catch { /* 房間已不存在 */ }
    } else if (this.#roomCode !== code) { // 新的連線若正在用同一間房，座位屬於新連線，不能放掉
      try { await remove(ref(this.#db, `rooms/${code}/guestUid`)); } catch { /* 略過 */ }
    }
  }

  /* ───────────── 房主：配對與重新配對 ───────────── */

  async #startHostPairing() {
    const code = this.#roomCode;
    this.#sid = randomSid();
    this.#candidateQueue = [];
    this.#setupPeer();
    const offer = await this.#pc.createOffer();
    await this.#pc.setLocalDescription(offer);
    await set(ref(this.#db, `rooms/${code}/offer`), toDbValue({ type: offer.type, sdp: offer.sdp, sid: this.#sid }));
    this.#peerUnsubscribers.push(onValue(ref(this.#db, `rooms/${code}/answer`), async (snapshot) => {
      if (!snapshot.exists() || this.#closed || this.#pc?.remoteDescription) return;
      const answer = snapshot.val();
      if (answer?.sid !== this.#sid || answer.type !== "answer" || typeof answer.sdp !== "string") return; // 上一次配對遺留的 answer
      try {
        await this.#pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
        await this.#flushCandidates();
      } catch (error) {
        emit(this, "problem", { message: error?.message || "無法設定遠端連線描述。" });
      }
    }));
    this.#watchRemoteCandidates("guestCandidates");
    this.#armConnectTimeout();
  }

  /** 訪客離開後：清掉舊的連線資料，重新產生 offer，讓房間可以再讓人加入 */
  async #restartHostPairing() {
    if (this.#renegotiating || this.#closed || this.#role !== "host") return;
    this.#renegotiating = true;
    const generation = this.#generation;
    try {
      this.#teardownPeer();
      const code = this.#roomCode;
      await Promise.all(["offer", "answer", "hostCandidates", "guestCandidates"].map((node) => remove(ref(this.#db, `rooms/${code}/${node}`))));
      this.#assertAlive(generation);
      await set(ref(this.#db, `rooms/${code}/status`), "waiting");
      await this.#startHostPairing();
      emit(this, "room", { code, mode: this.#mode, role: "host", status: "waiting", players: 1 });
    } catch (error) {
      if (!this.#closed) emit(this, "problem", { message: error?.message || "無法重新開放房間。" });
    } finally {
      this.#renegotiating = false;
    }
  }

  /** 房主監看訪客座位：有人坐下 → 之後變空 = 訪客離開 */
  #watchGuestSlot() {
    this.#unsubscribers.push(onValue(ref(this.#db, `rooms/${this.#roomCode}/guestUid`), (snapshot) => {
      if (this.#closed) return;
      if (snapshot.exists()) { this.#guestSeen = true; return; }
      if (this.#guestSeen) {
        this.#guestSeen = false;
        emit(this, "peer-left", {});
        this.#restartHostPairing();
      }
    }));
  }

  /* ───────────── 訪客：回應 offer ───────────── */

  #watchOffer() {
    const code = this.#roomCode;
    this.#unsubscribers.push(onValue(ref(this.#db, `rooms/${code}/offer`), async (snapshot) => {
      if (!snapshot.exists() || this.#closed) return;
      const offer = snapshot.val();
      if (offer?.type !== "offer" || typeof offer.sdp !== "string" || typeof offer.sid !== "string") return;
      if (offer.sid === this.#sid) return; // 這一次配對已經回應過了
      // 房主重新產生 offer（例如上一位訪客離開後）：丟掉舊連線，重新配對
      this.#teardownPeer();
      this.#sid = offer.sid;
      try {
        this.#setupPeer();
        this.#watchRemoteCandidates("hostCandidates");
        await this.#pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
        await this.#flushCandidates();
        const answer = await this.#pc.createAnswer();
        await this.#pc.setLocalDescription(answer);
        await set(ref(this.#db, `rooms/${code}/answer`), toDbValue({ type: answer.type, sdp: answer.sdp, sid: this.#sid }));
        this.#armConnectTimeout();
        emit(this, "room", { code, mode: this.#mode, role: "guest", status: "connecting", players: 2 });
      } catch (error) {
        emit(this, "problem", { message: error?.message || "無法建立 WebRTC 回應。" });
      }
    }));
  }

  /* ───────────── 共用：PeerConnection、資料通道、ICE ───────────── */

  #setupPeer() {
    const code = this.#roomCode;
    const sid = this.#sid;
    const pc = new RTCPeerConnection({ iceServers: resolveIceServers() });
    this.#pc = pc;
    pc.onicecandidate = (event) => {
      if (!event.candidate || this.#closed || this.#pc !== pc) return;
      const payload = candidateToDb(event.candidate, sid);
      if (!payload) return;
      const side = this.#role === "host" ? "hostCandidates" : "guestCandidates";
      push(ref(this.#db, `rooms/${code}/${side}`), payload)
        .catch((error) => emit(this, "problem", { message: error?.message || "ICE 候選資料傳送失敗。" }));
    };
    pc.onconnectionstatechange = () => {
      if (this.#pc !== pc) return;
      const state = pc.connectionState ?? "closed";
      emit(this, "state", { state });
      if (state === "connected") this.#clearConnectTimeout();
      if (state === "failed") emit(this, "problem", { message: "P2P 連線失敗；部分網路需要設定 TURN 中繼服務，詳見 dev.md。" });
      if (state === "disconnected") emit(this, "problem", { message: "對方連線中斷，正在等待恢復…" });
    };
    pc.ondatachannel = (event) => { if (this.#pc === pc) this.#attachChannel(event.channel); };
    if (this.#role === "host") this.#attachChannel(pc.createDataChannel("neon-shard-game", { ordered: true }));
  }

  /** 結束目前這一次配對（PeerConnection、通道、候選資料監聽），但保留房間與房間監聽 */
  #teardownPeer() {
    this.#clearConnectTimeout();
    for (const unsubscribe of this.#peerUnsubscribers.splice(0)) {
      try { unsubscribe(); } catch { /* 已解除 */ }
    }
    const channel = this.#channel, pc = this.#pc;
    this.#channel = null;
    this.#pc = null;
    this.#candidateQueue = [];
    if (channel) { channel.onopen = channel.onmessage = channel.onclose = channel.onerror = null; try { channel.close(); } catch { /* 已關閉 */ } }
    if (pc) { pc.onicecandidate = pc.onconnectionstatechange = pc.ondatachannel = null; try { pc.close(); } catch { /* 已關閉 */ } }
  }

  #armConnectTimeout() {
    this.#clearConnectTimeout();
    if (this.#closed) return;
    this.#connectTimer = setTimeout(() => {
      if (!this.#closed && !this.connected) emit(this, "problem", { message: "P2P 連線逾時；對方可能在嚴格防火牆後，需要 TURN 中繼服務。" });
    }, CONNECT_TIMEOUT_MS);
    this.#connectTimer?.unref?.(); // Node（測試）不要被這個計時器拖住結束
  }

  #clearConnectTimeout() {
    if (this.#connectTimer) clearTimeout(this.#connectTimer);
    this.#connectTimer = null;
  }

  #attachChannel(channel) {
    if (!channel) return;
    this.#channel = channel;
    channel.onopen = () => {
      if (this.#channel !== channel) return;
      this.#clearConnectTimeout();
      emit(this, "state", { state: "connected" });
      if (this.#role === "host" && this.#roomCode) {
        set(ref(this.#db, `rooms/${this.#roomCode}/status`), "connected").catch(() => {});
      }
      emit(this, "room", { code: this.#roomCode, mode: this.#mode, role: this.#role, status: "connected", players: 2 });
    };
    channel.onmessage = (event) => {
      if (this.#channel !== channel) return;
      const raw = event.data;
      if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return;
      let message;
      try { message = JSON.parse(raw); } catch { return; }
      if (!message || typeof message.type !== "string" || !REMOTE_TYPES.has(message.type)) return;
      if (message.type === "move" && !(Number.isFinite(message.x) && Number.isFinite(message.y))) return;
      emit(this, "message", { message });
      emit(this, message.type, message);
    };
    channel.onclose = () => { if (this.#channel === channel) emit(this, "state", { state: "disconnected" }); };
    channel.onerror = () => { if (this.#channel === channel) emit(this, "problem", { message: "WebRTC 資料通道發生錯誤。" }); };
  }

  #watchRoom() {
    const roomRef = ref(this.#db, `rooms/${this.#roomCode}`);
    this.#unsubscribers.push(onValue(roomRef, (snapshot) => {
      if (this.#closed) return;
      if (!snapshot.exists()) {
        emit(this, "problem", { message: "房間已關閉。" });
        this.#teardownPeer();
        return;
      }
      const room = snapshot.val();
      if (room.status === "closed") {
        emit(this, "problem", { message: "房主已離線，房間結束。" });
        this.#teardownPeer();
      }
      emit(this, "room", {
        code: this.#roomCode,
        mode: room.mode,
        role: this.#role,
        status: room.status,
        players: room.guestUid ? 2 : 1,
      });
    }));
  }

  #watchRemoteCandidates(path) {
    const candidateRef = ref(this.#db, `rooms/${this.#roomCode}/${path}`);
    this.#peerUnsubscribers.push(onChildAdded(candidateRef, async (snapshot) => {
      if (this.#closed || !snapshot.exists()) return;
      const value = snapshot.val();
      if (this.#sid && value?.sid !== this.#sid) return; // 別次配對的候選資料
      const init = candidateFromDb(value);
      if (!init) return;
      try {
        if (this.#pc?.remoteDescription) await this.#pc.addIceCandidate(init);
        else this.#candidateQueue.push(init);
      } catch (error) {
        emit(this, "problem", { message: error?.message || "無法加入遠端網路候選資料。" });
      }
    }));
  }

  async #flushCandidates() {
    if (!this.#pc?.remoteDescription) return;
    const queue = this.#candidateQueue.splice(0);
    for (const candidate of queue) {
      try { await this.#pc.addIceCandidate(candidate); }
      catch (error) { emit(this, "problem", { message: error?.message || "無法加入遠端網路候選資料。" }); }
    }
  }

  send(message) {
    if (!this.connected || !message || typeof message.type !== "string") return false;
    try {
      const text = JSON.stringify({ ...message, sentAt: Date.now() });
      if (text.length > MAX_MESSAGE_BYTES) return false;
      this.#channel.send(text);
      return true;
    } catch {
      return false;
    }
  }

  move(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return this.send({ type: "move", x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
  }

  attack() { return this.send({ type: "attack" }); }

  async close() {
    this.#closed = true;
    this.#generation += 1; // 讓所有進行中的 await 流程知道自己已被取消
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      try { unsubscribe(); } catch { /* 已解除 */ }
    }
    this.#teardownPeer();
    const code = this.#roomCode;
    const role = this.#role;
    this.#roomCode = null;
    this.#role = null;
    this.#mode = null;
    this.#sid = null;
    this.#guestSeen = false;
    this.#renegotiating = false;
    if (code && this.#db) {
      // 每一步各自處理錯誤：前一步失敗不能讓後面的清理被跳過
      if (role === "host") {
        try { await onDisconnect(ref(this.#db, `rooms/${code}`)).cancel(); } catch { /* 連線已斷 */ }
        try { await remove(ref(this.#db, `rooms/${code}`)); } catch { /* 房間已不存在或沒有權限 */ }
      } else if (role === "guest") {
        // 順序很重要：規則只允許「還坐在座位上的人」清自己的連線資料，所以最後才釋放座位
        try { await remove(ref(this.#db, `rooms/${code}/answer`)); } catch { /* 略過 */ }
        try { await remove(ref(this.#db, `rooms/${code}/guestCandidates`)); } catch { /* 略過 */ }
        try { await onDisconnect(ref(this.#db, `rooms/${code}/guestUid`)).cancel(); } catch { /* 略過 */ }
        try { await remove(ref(this.#db, `rooms/${code}/guestUid`)); } catch { /* 略過 */ }
      }
    }
    emit(this, "state", { state: "closed" });
  }
}
