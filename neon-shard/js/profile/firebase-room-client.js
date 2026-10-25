import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, push, runTransaction,
  onValue, onChildAdded, onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";
import { FIREBASE_CONFIG, FIREBASE_ICE_SERVERS } from "./firebase-config.js";

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const MODES = new Set(["arena", "boss"]);
const SDK_APP_NAME = "neon-shard-online";

function emit(target, type, detail = {}) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => chars[n % chars.length]).join("");
}
function validConfig() {
  return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "REPLACE_ME"
    && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.projectId !== "REPLACE_ME"
    && FIREBASE_CONFIG.databaseURL && !FIREBASE_CONFIG.databaseURL.includes("REPLACE_ME");
}

/**
 * Firebase Realtime Database is used only for room metadata and WebRTC signaling.
 * Gameplay packets travel through an encrypted WebRTC DataChannel, not Firebase.
 */
export class FirebaseRoomClient extends EventTarget {
  #auth;
  #db;
  #pc = null;
  #channel = null;
  #roomCode = null;
  #role = null;
  #mode = null;
  #unsubscribers = [];
  #candidateQueue = [];
  #closed = false;

  constructor() {
    super();
    if (!validConfig()) throw new Error("Firebase 尚未設定：請依 dev.md 填入 firebase-config.js。");
    const app = getApps().find((item) => item.name === SDK_APP_NAME)
      ?? initializeApp(FIREBASE_CONFIG, SDK_APP_NAME);
    this.#auth = getAuth(app);
    this.#db = getDatabase(app);
  }

  get connected() { return this.#channel?.readyState === "open"; }
  get roomCode() { return this.#roomCode; }
  get role() { return this.#role; }

  async #ensureAuth() {
    if (!this.#auth.currentUser) await signInAnonymously(this.#auth);
    if (!this.#auth.currentUser) throw new Error("Firebase 匿名登入失敗，請確認已啟用 Anonymous Authentication。");
    return this.#auth.currentUser.uid;
  }

  async createRoom({ mode = "boss" } = {}) {
    if (!MODES.has(mode)) throw new Error("不支援的遊戲模式。");
    await this.close();
    this.#closed = false;
    const uid = await this.#ensureAuth();
    let code = "";
    let roomRef;
    let created = false;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      code = randomCode();
      roomRef = ref(this.#db, `rooms/${code}`);
      const result = await runTransaction(roomRef, (current) => {
        if (current !== null) return;
        return {
          hostUid: uid,
          guestUid: null,
          mode,
          status: "waiting",
          createdAt: Date.now(),
        };
      }, { applyLocally: false });
      created = result.committed;
    }
    if (!created) throw new Error("暫時無法建立唯一房間代碼，請再試一次。");

    this.#roomCode = code;
    this.#role = "host";
    this.#mode = mode;
    await onDisconnect(ref(this.#db, `rooms/${code}/status`)).set("closed");
    this.#watchRoom();
    await this.#setupPeer();
    const offer = await this.#pc.createOffer();
    await this.#pc.setLocalDescription(offer);
    await set(ref(this.#db, `rooms/${code}/offer`), {
      type: offer.type,
      sdp: offer.sdp,
    });
    this.#watchRemoteCandidates("guestCandidates");
    emit(this, "room", { code, mode, role: "host", status: "waiting" });
    return code;
  }

  async joinRoom({ code, mode = "boss" } = {}) {
    if (!MODES.has(mode)) throw new Error("不支援的遊戲模式。");
    code = String(code ?? "").trim().toUpperCase();
    if (!ROOM_CODE.test(code)) throw new Error("房間代碼必須是 6 位英數字（不含易混淆字元）。");
    await this.close();
    this.#closed = false;
    const uid = await this.#ensureAuth();
    const roomRef = ref(this.#db, `rooms/${code}`);
    const initial = await get(roomRef);
    if (!initial.exists()) throw new Error("找不到房間；請確認代碼，並請房主保持頁面開啟。");
    const room = initial.val();
    if (room.status === "closed") throw new Error("房主已離線，這個房間已結束。");
    if (room.mode !== mode) throw new Error("房間模式不同，請選擇與房主相同的模式。");
    if (room.hostUid === uid) throw new Error("同一個瀏覽器不能加入自己建立的房間。");

    const guestSlot = await runTransaction(ref(this.#db, `rooms/${code}/guestUid`), (current) => {
      if (current !== null) return;
      return uid;
    }, { applyLocally: false });
    if (!guestSlot.committed) throw new Error("房間已滿（最多 2 人）。");

    this.#roomCode = code;
    this.#role = "guest";
    this.#mode = mode;
    this.#watchRoom();
    await this.#setupPeer();
    this.#watchRemoteCandidates("hostCandidates");
    this.#unsubscribers.push(onValue(ref(this.#db, `rooms/${code}/offer`), async (snapshot) => {
      if (!snapshot.exists() || this.#closed || this.#pc?.remoteDescription) return;
      try {
        await this.#pc.setRemoteDescription(snapshot.val());
        await this.#flushCandidates();
        const answer = await this.#pc.createAnswer();
        await this.#pc.setLocalDescription(answer);
        await set(ref(this.#db, `rooms/${code}/answer`), {
          type: answer.type,
          sdp: answer.sdp,
        });
        emit(this, "room", { code, mode, role: "guest", status: "connecting" });
      } catch (error) {
        emit(this, "problem", { message: error?.message || "無法建立 WebRTC 回應。" });
      }
    }));
    emit(this, "room", { code, mode, role: "guest", status: "connecting" });
    return code;
  }

  async #setupPeer() {
    const code = this.#roomCode;
    this.#pc = new RTCPeerConnection({ iceServers: FIREBASE_ICE_SERVERS });
    this.#pc.onicecandidate = (event) => {
      if (!event.candidate || this.#closed) return;
      const side = this.#role === "host" ? "hostCandidates" : "guestCandidates";
      push(ref(this.#db, `rooms/${code}/${side}`), event.candidate.toJSON())
        .catch((error) => emit(this, "problem", { message: error?.message || "ICE 候選資料傳送失敗。" }));
    };
    this.#pc.onconnectionstatechange = () => {
      const state = this.#pc?.connectionState ?? "closed";
      emit(this, "state", { state });
      if (state === "failed") emit(this, "problem", { message: "P2P 連線失敗；部分網路需要設定 TURN 中繼服務，詳見 dev.md。" });
      if (state === "disconnected") emit(this, "problem", { message: "對方連線中斷，正在等待恢復…" });
    };
    this.#pc.ondatachannel = (event) => this.#attachChannel(event.channel);
    if (this.#role === "host") this.#attachChannel(this.#pc.createDataChannel("neon-shard-game", { ordered: true }));
    else this.#attachChannel(null);

    if (this.#role === "host") {
      this.#unsubscribers.push(onValue(ref(this.#db, `rooms/${code}/answer`), async (snapshot) => {
        if (!snapshot.exists() || this.#closed || this.#pc?.remoteDescription) return;
        try {
          await this.#pc.setRemoteDescription(snapshot.val());
          await this.#flushCandidates();
        } catch (error) {
          emit(this, "problem", { message: error?.message || "無法設定遠端連線描述。" });
        }
      }));
    }
  }

  #attachChannel(channel) {
    if (!channel) return;
    this.#channel = channel;
    channel.onopen = () => {
      emit(this, "state", { state: "connected" });
      if (this.#role === "host" && this.#roomCode) {
        update(ref(this.#db, `rooms/${this.#roomCode}`), { status: "connected" }).catch(() => {});
      }
      emit(this, "room", { code: this.#roomCode, mode: this.#mode, role: this.#role, status: "connected" });
    };
    channel.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message.type !== "string") return;
      emit(this, "message", { message });
      emit(this, message.type, message);
    };
    channel.onclose = () => emit(this, "state", { state: "disconnected" });
    channel.onerror = () => emit(this, "problem", { message: "WebRTC 資料通道發生錯誤。" });
  }

  #watchRoom() {
    const roomRef = ref(this.#db, `rooms/${this.#roomCode}`);
    this.#unsubscribers.push(onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (!this.#closed) emit(this, "problem", { message: "房間已關閉。" });
        this.#pc?.close();
        return;
      }
      const room = snapshot.val();
      if (room.status === "closed") {
        emit(this, "problem", { message: "房主已離線，房間結束。" });
        this.#pc?.close();
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
    this.#unsubscribers.push(onChildAdded(candidateRef, async (snapshot) => {
      if (this.#closed || !snapshot.exists()) return;
      const candidate = snapshot.val();
      if (!candidate?.candidate) return;
      try {
        if (this.#pc?.remoteDescription) await this.#pc.addIceCandidate(candidate);
        else this.#candidateQueue.push(candidate);
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
      this.#channel.send(JSON.stringify({ ...message, sentAt: Date.now() }));
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
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      try { unsubscribe(); } catch {}
    }
    const code = this.#roomCode;
    const role = this.#role;
    this.#channel?.close();
    this.#pc?.close();
    this.#channel = null;
    this.#pc = null;
    this.#candidateQueue = [];
    if (code && role === "host") {
      try {
        await onDisconnect(ref(this.#db, `rooms/${code}/status`)).cancel();
        await remove(ref(this.#db, `rooms/${code}`));
      } catch {}
    }
    this.#roomCode = null;
    this.#role = null;
    this.#mode = null;
    emit(this, "state", { state: "closed" });
  }
}
