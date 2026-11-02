/**
 * 房間規則（不依賴 WebSocket，方便單獨測試）。
 * 玩家以 { id, name, send(data), close(code, reason) } 抽象化連線，因此規則層完全不認識 socket。
 *
 * 兩種玩法（協定裡的 mode 名稱沿用 arena / boss）：
 *   arena = 競爭模式：玩家互相對戰（PvP），也可以打場上的弱敵人得分。血量由「伺服器」決定，
 *           一個人被打到 0 就淘汰；剩最後一人、或時間到時以分數排名。
 *   boss  = 合作模式：大家打同一個 Boss，共用一條血量。各人的畫面各自模擬 Boss 行為，
 *           只有「Boss 血量」與「玩家是否倒下」透過伺服器共享。
 *
 * 房間流程：lobby（大廳，房主按開始）→ playing（對戰中）→ ended（結算，房主可重置回大廳）。
 * 對戰中不能加入新玩家。
 *
 * 防作弊的立場：傷害是「用戶端回報」的（伺服器沒有模擬整個遊戲），所以每個回報都經過
 * 上限、頻率（令牌桶）、距離與狀態檢查；它防的是「明顯離譜的值」，不是完整的伺服器權威模擬。
 */
import { TokenBucket } from "./rate-limiter.js";

export const ROOM_CODE = /^[A-Z0-9]{4,8}$/;

/** 玩法設定（集中成常數，部署後可依實測微調） */
export const MATCH_RULES = Object.freeze({
  /** 玩家血量（伺服器單位；競爭模式的血量就是這個值） */
  playerHp: 100,
  /** 合作模式 Boss 的共用血量（伺服器單位；各端回報的是「Boss 最大血量的千分比」） */
  bossPool: 1000,
  /** 競爭模式時間上限（毫秒），時間到以分數排名 */
  arenaTimeLimitMs: 150_000,
  /** 開始對戰所需的最少人數 */
  minPlayers: Object.freeze({ arena: 2, boss: 1 }),
  /** 單次 hit 回報的傷害上限（血量單位） */
  maxHitDamage: 40,
  /** 每位玩家每秒最多能造成的對戰傷害（令牌桶：容量／每秒補充） */
  hitBudget: Object.freeze({ capacity: 80, perSecond: 60 }),
  /** 回報傷害時，攻擊者與目標在伺服器記錄的位置最遠允許距離（座標為 0~1 的比例；彈道可以飛很遠，所以很寬鬆） */
  hitRange: 0.9,
  /** 單次 bossDamage 回報上限（千分比） */
  maxBossDamagePerReport: 150,
  /** 每位玩家每秒最多能對 Boss 造成的傷害（千分比；令牌桶） */
  bossBudget: Object.freeze({ capacity: 200, perSecond: 120 }),
  /** 彈道轉發：最短間隔與單次數量上限 */
  shotIntervalMs: 60,
  maxShotsPerReport: 6,
  /** 競技場弱敵人：血量與重生時間 */
  mobHp: 30,
  mobRespawnMs: 6000,
  /** 分數：擊倒玩家、擊倒弱敵人各得幾分 */
  scorePerKill: 3,
  scorePerMob: 1,
  /** 舊版 attack（只在大廳可用）的冷卻與範圍 */
  attackCooldownMs: 450,
  pvpRange: 0.12,
});

const SPAWNS = [[0.2, 0.2], [0.8, 0.8], [0.8, 0.2], [0.2, 0.8]];
const MOB_SPAWNS = [[0.22, 0.28], [0.75, 0.62], [0.66, 0.25]];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const publicPlayer = ({ id, name, x, y, hp, kills, score, alive }) => ({ id, name, x, y, hp, kills, score, alive });
const publicMob = ({ id, x, y, hp }) => ({ id, x, y, hp });

function freshMobs() {
  return MOB_SPAWNS.map(([x, y], i) => ({ id: `m${i + 1}`, x, y, hp: MATCH_RULES.mobHp, respawnAt: 0 }));
}

function makeRoom(code, mode, hostId) {
  return {
    code, mode, hostId, phase: "lobby", players: new Map(),
    bossHp: MATCH_RULES.bossPool, mobs: freshMobs(), startedAt: 0, endsAt: 0, result: null,
  };
}

const snapshot = (room) => ({
  type: "room", code: room.code, mode: room.mode, phase: room.phase, hostId: room.hostId,
  players: [...room.players.values()].map(publicPlayer), bossHp: room.bossHp, mobs: room.mobs.map(publicMob), endsAt: room.endsAt,
});

const combatMessage = (room, extra = {}) => ({
  type: "combat", bossHp: room.bossHp, mobs: room.mobs.map(publicMob), players: [...room.players.values()].map(publicPlayer), ...extra,
});

function broadcast(room, data, except = null) {
  for (const player of room.players.values()) {
    if (player === except) continue;
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
    const bucket = ({ capacity, perSecond }) => new TokenBucket({ capacity, refillPerSecond: perSecond, now: this.#now });
    return {
      id, name: String(name).slice(0, 20), send, close, x: 0.5, y: 0.5, hp: MATCH_RULES.playerHp, kills: 0, score: 0, alive: true,
      lastAttack: 0, lastShot: 0, room: null,
      hitBucket: bucket(MATCH_RULES.hitBudget),
      bossBucket: bucket(MATCH_RULES.bossBudget),
    };
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
      room = makeRoom(normalized, wantedMode, player.id);
    }
    const sameUser = room.players.get(player.id); // 同一帳號在別的分頁／裝置已在房內
    const occupied = room.players.size - (sameUser ? 1 : 0);
    if (room.mode !== wantedMode || occupied >= this.#maxRoomSize) return { ok: false, message: "房間不存在相容模式或已滿" };
    if (room.phase !== "lobby" && !sameUser) return { ok: false, message: "這個房間的對戰已經開始，請等下一場或換一個房間代碼" };
    this.#rooms.set(normalized, room);
    if (sameUser && sameUser !== player) { // 以最新的連線為準，舊連線被請出；沿用舊連線的對戰狀態
      room.players.delete(player.id);
      sameUser.room = null;
      Object.assign(player, { hp: sameUser.hp, kills: sameUser.kills, score: sameUser.score, alive: sameUser.alive, x: sameUser.x, y: sameUser.y });
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
    if (!room.players.size) { this.#rooms.delete(room.code); return; }
    if (room.hostId === player.id) room.hostId = room.players.keys().next().value;
    if (room.phase === "playing") this.#checkEnd(room);
    broadcast(room, snapshot(room));
  }

  /** 房主按下開始 */
  start(player) {
    const room = player.room;
    if (!room) return { ok: false, message: "還沒加入房間" };
    if (room.hostId !== player.id) return { ok: false, message: "只有房主可以開始" };
    if (room.phase !== "lobby") return { ok: false, message: "對戰已經開始或尚未重置" };
    const need = MATCH_RULES.minPlayers[room.mode];
    if (room.players.size < need) return { ok: false, message: `至少需要 ${need} 位玩家才能開始` };
    const now = this.#now();
    room.phase = "playing";
    room.startedAt = now;
    room.endsAt = room.mode === "arena" ? now + MATCH_RULES.arenaTimeLimitMs : 0;
    room.bossHp = MATCH_RULES.bossPool;
    room.mobs = freshMobs();
    room.result = null;
    const spawns = {};
    let i = 0;
    for (const p of room.players.values()) {
      const [x, y] = SPAWNS[i++ % SPAWNS.length];
      Object.assign(p, { x, y, hp: MATCH_RULES.playerHp, kills: 0, score: 0, alive: true });
      spawns[p.id] = { x, y };
    }
    broadcast(room, { type: "started", mode: room.mode, spawns, endsAt: room.endsAt, playerCount: room.players.size, bossPool: MATCH_RULES.bossPool, seed: Math.floor(Math.random() * 2 ** 31) });
    broadcast(room, snapshot(room));
    return { ok: true };
  }

  /** 房主在結算後把房間重置回大廳 */
  reset(player) {
    const room = player.room;
    if (!room || room.hostId !== player.id || room.phase === "playing") return false;
    room.phase = "lobby";
    room.endsAt = 0;
    room.result = null;
    room.bossHp = MATCH_RULES.bossPool;
    room.mobs = freshMobs();
    for (const p of room.players.values()) Object.assign(p, { hp: MATCH_RULES.playerHp, kills: 0, score: 0, alive: true });
    broadcast(room, snapshot(room));
    return true;
  }

  move(player, x, y, hpRatio) {
    const room = player.room;
    if (!room || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (room.phase === "playing" && !player.alive) return false; // 淘汰的玩家不再同步位置
    player.x = clamp01(x);
    player.y = clamp01(y);
    // 合作模式的血量由各端自己回報（只用於隊友血條顯示）；競爭模式血量以伺服器為準，忽略回報值
    const coop = room.mode === "boss" && room.phase === "playing";
    if (coop && Number.isFinite(hpRatio)) player.hp = Math.round(clamp01(hpRatio) * MATCH_RULES.playerHp);
    broadcast(room, { type: "move", id: player.id, x: player.x, y: player.y, ...(coop ? { hp: player.hp } : {}) });
    return true;
  }

  /** 轉發彈道（純視覺，不影響傷害）。回傳是否有轉發 */
  shots(player, list) {
    const room = player.room;
    if (!room || room.phase !== "playing" || !player.alive || !Array.isArray(list)) return false;
    const t = this.#now();
    if (t - player.lastShot < MATCH_RULES.shotIntervalMs) return false;
    const clean = [];
    for (const s of list.slice(0, MATCH_RULES.maxShotsPerReport)) {
      if (!s || ![s.x, s.y, s.vx, s.vy].every(Number.isFinite)) continue;
      clean.push({ x: clamp01(s.x), y: clamp01(s.y), vx: Math.max(-3, Math.min(3, s.vx)), vy: Math.max(-3, Math.min(3, s.vy)) });
    }
    if (!clean.length) return false;
    player.lastShot = t;
    broadcast(room, { type: "shot", id: player.id, shots: clean }, player);
    return true;
  }

  /** 競爭模式：回報「我打中了 target」。target 是玩家 id 或弱敵人 id（m1…） */
  hit(player, target, dmg) {
    const room = player.room;
    if (!room || room.mode !== "arena" || room.phase !== "playing" || !player.alive) return false;
    if (typeof target !== "string" || target === player.id || !Number.isFinite(dmg) || dmg <= 0) return false;
    const mob = room.mobs.find((m) => m.id === target);
    const victim = mob ? null : room.players.get(target);
    if (mob ? mob.hp <= 0 : !victim?.alive) return false;
    const subject = mob ?? victim;
    if (Math.hypot(subject.x - player.x, subject.y - player.y) > MATCH_RULES.hitRange) return false;
    const amount = Math.min(MATCH_RULES.maxHitDamage, dmg);
    if (!player.hitBucket.tryRemove(amount)) return false; // 超過每秒傷害上限
    if (mob) {
      mob.hp = Math.max(0, mob.hp - amount);
      if (mob.hp === 0) { mob.respawnAt = this.#now() + MATCH_RULES.mobRespawnMs; player.score += MATCH_RULES.scorePerMob; }
    } else {
      victim.hp = Math.max(0, victim.hp - amount);
      if (victim.hp === 0) {
        victim.alive = false;
        player.kills += 1;
        player.score += MATCH_RULES.scorePerKill;
        broadcast(room, { type: "eliminated", id: victim.id, by: player.id });
      }
    }
    broadcast(room, combatMessage(room, { by: player.id, target }));
    if (victim && !victim.alive) this.#checkEnd(room);
    return true;
  }

  /** 合作模式：回報「我對 Boss 造成了 amount 千分比的傷害」 */
  bossDamage(player, amount) {
    const room = player.room;
    if (!room || room.mode !== "boss" || room.phase !== "playing" || !player.alive || !Number.isFinite(amount) || amount <= 0) return false;
    const clamped = Math.min(MATCH_RULES.maxBossDamagePerReport, amount);
    if (!player.bossBucket.tryRemove(clamped)) return false;
    room.bossHp = Math.max(0, room.bossHp - clamped);
    player.score += clamped; // 合作模式的分數 = 造成的傷害（結算顯示貢獻）
    broadcast(room, combatMessage(room, { by: player.id }));
    if (room.bossHp === 0) this.#end(room, { victory: true });
    return true;
  }

  /** 合作模式：自己倒下了（所有人都倒下就是失敗） */
  died(player) {
    const room = player.room;
    if (!room || room.phase !== "playing" || !player.alive || room.mode !== "boss") return false;
    player.alive = false;
    player.hp = 0;
    broadcast(room, { type: "eliminated", id: player.id, by: null });
    this.#checkEnd(room);
    return true;
  }

  /** 舊版攻擊：只在大廳可用（開始前的練習），對戰中請用 hit / bossDamage */
  attack(player) {
    const room = player.room;
    const t = this.#now();
    if (!room || room.phase !== "lobby" || t - player.lastAttack < MATCH_RULES.attackCooldownMs) return false;
    player.lastAttack = t;
    if (room.mode === "boss") {
      room.bossHp = Math.max(0, room.bossHp - 20);
    } else {
      const target = [...room.players.values()]
        .filter((o) => o.id !== player.id && o.hp > 0)
        .map((o) => ({ o, d: Math.hypot(o.x - player.x, o.y - player.y) }))
        .filter((e) => e.d <= MATCH_RULES.pvpRange)
        .sort((a, b) => a.d - b.d)[0]?.o;
      if (target) target.hp = Math.max(0, target.hp - 20);
      else { const mob = room.mobs.find((m) => m.hp > 0); if (mob) mob.hp = Math.max(0, mob.hp - 10); }
    }
    broadcast(room, combatMessage(room));
    return true;
  }

  /** 定時呼叫（約每 0.5 秒）：時間到、弱敵人重生 */
  tick() {
    const t = this.#now();
    for (const room of this.#rooms.values()) {
      if (room.phase !== "playing" || room.mode !== "arena") continue;
      let changed = false;
      for (const mob of room.mobs) {
        if (mob.hp <= 0 && mob.respawnAt && t >= mob.respawnAt) { mob.hp = MATCH_RULES.mobHp; mob.respawnAt = 0; changed = true; }
      }
      if (room.endsAt && t >= room.endsAt) { this.#end(room, {}); continue; }
      if (changed) broadcast(room, combatMessage(room));
    }
  }

  #checkEnd(room) {
    if (room.phase !== "playing") return;
    const alive = [...room.players.values()].filter((p) => p.alive).length;
    if (room.mode === "arena") { if (alive <= 1) this.#end(room, {}); }
    else if (alive === 0) this.#end(room, { victory: false });
  }

  #end(room, { victory }) {
    if (room.phase !== "playing") return;
    room.phase = "ended";
    const ranked = [...room.players.values()].sort((a, b) => (b.alive - a.alive) || (b.score - a.score) || (b.hp - a.hp));
    room.result = {
      mode: room.mode,
      ...(room.mode === "boss" ? { victory: Boolean(victory) } : { winnerId: ranked[0]?.id ?? null }),
      scores: ranked.map((p) => ({ id: p.id, name: p.name, kills: p.kills, score: Math.round(p.score), hp: p.hp, alive: p.alive })),
    };
    broadcast(room, { type: "end", result: room.result });
    broadcast(room, snapshot(room));
  }
}
