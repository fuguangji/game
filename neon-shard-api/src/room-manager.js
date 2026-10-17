/**
 * 房間規則（不依賴 WebSocket，方便單獨測試）。
 * 玩家以 { id, name, send(data), close(code, reason) } 抽象化連線，因此規則層完全不認識 socket。
 */
export const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const ATTACK_COOLDOWN_MS = 450;
const PVP_RANGE = 0.12;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const publicPlayer = ({ id, name, x, y, hp }) => ({ id, name, x, y, hp });

function makeRoom(code, mode) {
  return {
    code, mode, players: new Map(), bossHp: 1000,
    mobs: [{ id: "m1", x: 0.22, y: 0.28, hp: 30 }, { id: "m2", x: 0.75, y: 0.62, hp: 30 }, { id: "m3", x: 0.66, y: 0.25, hp: 30 }],
  };
}

const snapshot = (room) => ({ type: "room", code: room.code, mode: room.mode, players: [...room.players.values()].map(publicPlayer), bossHp: room.bossHp, mobs: room.mobs });

function broadcast(room, data) {
  for (const player of room.players.values()) {
    try { player.send(data); } catch { /* 單一連線送不出去不影響其他人 */ }
  }
}

export class RoomManager {
  #rooms = new Map();
  #maxRoomSize;
  #maxRooms;
  #now;

  constructor({ maxRoomSize = 4, maxRooms = 200, now = Date.now } = {}) {
    this.#maxRoomSize = maxRoomSize;
    this.#maxRooms = maxRooms;
    this.#now = now;
  }

  get roomCount() { return this.#rooms.size; }

  createPlayer({ id, name, send, close = () => {} }) {
    return { id, name: String(name).slice(0, 20), send, close, x: 0.5, y: 0.5, hp: 100, lastAttack: 0, room: null };
  }

  /** @returns {{ok: true} | {ok: false, message: string}} */
  join(player, { code, mode }) {
    const normalized = typeof code === "string" ? code.toUpperCase() : "";
    if (!ROOM_CODE.test(normalized)) return { ok: false, message: "房間代碼需為 4–8 位英數字" };
    const wantedMode = mode === "boss" ? "boss" : "arena";
    if (player.room) this.leave(player);
    let room = this.#rooms.get(normalized);
    if (!room) {
      if (this.#rooms.size >= this.#maxRooms) return { ok: false, message: "伺服器房間數已達上限，請稍後再試" };
      room = makeRoom(normalized, wantedMode);
    }
    const sameUser = room.players.get(player.id); // 同一帳號在別的分頁／裝置已在房內
    const occupied = room.players.size - (sameUser ? 1 : 0);
    if (room.mode !== wantedMode || occupied >= this.#maxRoomSize) return { ok: false, message: "房間不存在相容模式或已滿" };
    this.#rooms.set(normalized, room);
    if (sameUser && sameUser !== player) { // 以最新的連線為準，舊連線被請出
      room.players.delete(player.id);
      sameUser.room = null;
      sameUser.close(4409, "signed in elsewhere");
    }
    player.room = room;
    room.players.set(player.id, player);
    broadcast(room, snapshot(room));
    return { ok: true };
  }

  /** 離開房間。必須是「同一個連線物件」才會刪除，避免舊連線關閉時把新連線踢出房間 */
  leave(player) {
    const room = player.room;
    if (!room) return;
    player.room = null;
    if (room.players.get(player.id) === player) room.players.delete(player.id);
    if (!room.players.size) this.#rooms.delete(room.code);
    else broadcast(room, snapshot(room));
  }

  move(player, x, y) {
    const room = player.room;
    if (!room || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    player.x = clamp01(x);
    player.y = clamp01(y);
    broadcast(room, { type: "move", id: player.id, x: player.x, y: player.y });
    return true;
  }

  attack(player) {
    const room = player.room;
    const t = this.#now();
    if (!room || t - player.lastAttack < ATTACK_COOLDOWN_MS) return false;
    player.lastAttack = t;
    if (room.mode === "boss") {
      room.bossHp = Math.max(0, room.bossHp - 20);
    } else {
      const target = [...room.players.values()]
        .filter((o) => o.id !== player.id && o.hp > 0)
        .map((o) => ({ o, d: Math.hypot(o.x - player.x, o.y - player.y) }))
        .filter((e) => e.d <= PVP_RANGE)
        .sort((a, b) => a.d - b.d)[0]?.o;
      if (target) target.hp = Math.max(0, target.hp - 20);
      else { const mob = room.mobs.find((m) => m.hp > 0); if (mob) mob.hp = Math.max(0, mob.hp - 10); }
    }
    broadcast(room, { type: "combat", bossHp: room.bossHp, mobs: room.mobs, players: [...room.players.values()].map(publicPlayer) });
    return true;
  }
}
