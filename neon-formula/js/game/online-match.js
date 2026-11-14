/**
 * game/online-match — 線上對戰（競爭模式 / 合作模式）的遊戲端控制器
 *
 * 架構：伺服器（neon-shard-api）管房間、血量與勝負；每個玩家的畫面仍在本機模擬。
 *   競爭模式（arena，協定名稱沿用）：
 *     - 沒有波次；所有人在同一張地圖（伺服器給種子，大家產生一樣的地圖）互相對戰。
 *     - 我的「普通武器子彈」打到別人的幽靈 → 回報給伺服器（hit），伺服器扣血並廣播；
 *       我自己的血量只聽伺服器的（本地傷害一律忽略），血量歸零就淘汰。
 *     - 場上有 3 隻伺服器管的弱敵人，打倒得分。剩最後一人或時間到結算。
 *   合作模式（boss）：
 *     - 大家各自在自己的畫面打同一隻 Boss（行為各自模擬），但 Boss 血量共用一條：
 *       本地 Boss 掉的血回報給伺服器（bossDamage，Boss 最大血量的千分比），伺服器彙總後廣播，
 *       各端把本地 Boss 血量拉到共用值。Boss 歸零全員勝利；所有人都倒下則失敗。
 *
 * 已知限制（誠實說明）：
 *   - 隊友／對手以「幽靈」呈現，只同步位置與子彈外觀；技能、爆炸、地面效果不會傷害對手，也看不到對方的技能特效。
 *   - 傷害是用戶端回報，伺服器只做上限／頻率／距離檢查（防離譜，不是防外掛）。
 *   - 每位玩家的武器、角色、芯片是各自的存檔；為了公平可以之後加上「統一配置」。
 */
import { bossCatalog } from "../config/index.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { $, MW, N, T } from "../core/viewport.js";
import { bossIntro } from "./boss-visuals.js";
import { hurt, mkEn, setup } from "./battle.js";
import { kill } from "./enemy-death.js";
import { onlineState } from "./online-state.js";
import { SV } from "./progress.js";
import { applyLO } from "./weapons.js";
import { burst } from "./world-helpers.js";

/** 競爭模式：普通武器子彈的傷害 × 這個倍率 = 回報給伺服器的血量傷害（伺服器玩家血量是 100）。【可調】 */
export const VERSUS_DAMAGE_SCALE = 0.4;
/** 線上對戰固定使用的關卡索引（所有人必須一樣，地圖才會一致）。【可調】 */
export const ONLINE_STAGE_INDEX = 1;
/** 合作模式：Boss 血量每多一位玩家增加的比例（2 人 = ×1.6）。【可調】 */
export const COOP_BOSS_HP_PER_EXTRA_PLAYER = 0.6;
/** 合作模式使用的波數（影響 Boss 血量與強度倍率）。【可調】 */
export const COOP_BOSS_WAVE = 5;
/** 位置、傷害回報與彈道轉發的間隔（模擬時間，秒） */
const MOVE_EVERY = 0.1;
const DAMAGE_EVERY = 0.2;
const SHOT_EVERY = 0.08;
const GHOST_R = 12;
const MOB_R = 11;
const COLORS = ["#22e6ff", "#ff3d9a", "#ffe14a", "#9dff3d"];
const REMOTE_SHOT_LIFE = 0.9;

/** 帶種子的亂數（mulberry32）：讓所有玩家產生一樣的地圖 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 從指定位置往外找最近的空地（伺服器給的出生點可能剛好在牆裡） */
export function nearestFree(px, py) {
  const ci = Math.max(1, Math.min(N - 2, (px / T) | 0));
  const cj = Math.max(1, Math.min(N - 2, (py / T) | 0));
  for (let r = 0; r < N; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
        if (G.grid[j * N + i] === 0) return { x: (i + 0.5) * T, y: (j + 0.5) * T };
      }
    }
  }
  return { x: 22.5 * T, y: 22.5 * T };
}

const initial = () => ({
  status: "idle", // idle → connecting → lobby → playing → ended
  phase: "lobby", // 伺服器房間階段（lobby / playing / ended）
  mode: null,
  code: "",
  hostId: null,
  players: [],
  bossHp: 0,
  bossPool: 1000,
  mobs: [],
  endsAt: 0,
  result: null,
  message: "",
});

export class OnlineMatch extends EventTarget {
  #createClient = null;
  #backToMenuHook = null;
  #client = null;
  #state = initial();
  #ghosts = new Map();
  #shots = [];
  #mobs = [];
  #moveAcc = 0;
  #dmgAcc = 0;
  #shotAcc = 0;
  #hudAcc = 0;
  #pendingBoss = 0;
  #pendingHits = new Map();
  #shotQueue = [];
  #lastBossHp = 0;
  #lastServerHp = 100;
  #sentDied = false;
  #savedStage = null;

  /** @param {{createClient: () => import('../profile/realtime-client.js').RealtimeClient, backToMenu?: () => void}} o */
  configure({ createClient, backToMenu = null }) { this.#createClient = createClient; this.#backToMenuHook = backToMenu; }

  get state() { return this.#state; }
  get myId() { return this.#client?.playerId ?? null; }
  get isHost() { return Boolean(this.myId) && this.#state.hostId === this.myId; }
  get inBattle() { return onlineState.active; }
  /** 繪製與 HUD 用：幽靈玩家（不含自己） */
  get ghosts() { return this.#ghosts; }
  get mobs() { return this.#mobs; }

  #set(patch) {
    this.#state = { ...this.#state, ...patch };
    this.dispatchEvent(new CustomEvent("change", { detail: this.#state }));
  }

  /* ───────── 連線與大廳 ───────── */

  async connect({ mode, code }) {
    if (!this.#createClient) throw new Error("線上聯機尚未設定。");
    this.disconnect();
    const client = this.#createClient();
    this.#client = client;
    this.#wire(client);
    this.#set({ ...initial(), status: "connecting", mode, code: String(code).toUpperCase(), message: "連線中…（免費主機閒置後需要 30～60 秒喚醒）" });
    try {
      await client.connect({ mode, code });
    } catch (error) {
      if (this.#client === client) { this.#client = null; this.#set({ ...initial(), message: error.message }); }
      throw error;
    }
  }

  /** 中斷連線；若正在對戰，同時結束戰鬥回到選單 */
  disconnect() {
    const client = this.#client;
    this.#client = null;
    client?.close();
    const wasBattle = onlineState.active;
    this.#endBattle();
    this.#set({ ...initial() });
    if (wasBattle) this.#backToMenu();
  }

  start() { this.#client?.start(); }
  resetRoom() { this.#client?.reset(); }

  /** 結算畫面按「回到大廳」：離開對戰、保留在房間（房主可再開一場） */
  returnToLobby() {
    const room = this.#state;
    this.#endBattle();
    this.#set({ status: room.status === "ended" || room.status === "playing" ? "lobby" : room.status, phase: this.isHost ? "lobby" : room.phase, result: null, message: "" });
    this.#backToMenu();
    if (this.isHost) this.resetRoom();
  }

  #backToMenu() {
    if (fsm.state !== "menu") fsm.transition("menu");
    this.#backToMenuHook?.(); // 顯示大廳並切到個人檔案分頁（由 ui/account.js 提供）
  }

  #wire(client) {
    const alive = () => this.#client === client;
    const on = (type, fn) => client.addEventListener(type, (e) => { if (alive()) fn(e.detail); });
    on("state", (d) => {
      if (d.state === "closed") {
        const wasBattle = onlineState.active;
        this.#client = null;
        if (wasBattle) {
          if (fsm.state === "play") fsm.transition("over");
          G.shown = 1;
          this.#set({ status: "ended", result: null, message: "與伺服器的連線中斷了。" });
        } else this.#set({ ...initial(), message: `連線已關閉（${d.code ?? ""}）。` });
      }
    });
    on("problem", (d) => this.#set({ message: d.message }));
    on("room", (d) => this.#onRoom(d));
    on("started", (d) => this.#beginBattle(d));
    on("move", (d) => this.#onMove(d));
    on("shot", (d) => this.#onShot(d));
    on("combat", (d) => this.#onCombat(d));
    on("eliminated", (d) => this.#onEliminated(d));
    on("end", (d) => this.#finish(d.result));
  }

  #onRoom(d) {
    const me = this.myId;
    const status = d.phase === "playing" ? "playing" : d.phase === "ended" ? "ended" : "lobby";
    for (const p of d.players) if (p.id !== me) this.#upsertGhost(p);
    for (const id of [...this.#ghosts.keys()]) if (!d.players.some((p) => p.id === id)) this.#ghosts.delete(id);
    this.#mobs = d.mobs ?? [];
    // 對戰中收到「大廳」快照（例如房主重置）時不要把畫面拉回大廳狀態
    const keepBattle = onlineState.active && status === "lobby";
    this.#set({
      status: keepBattle ? this.#state.status : status, mode: d.mode, code: d.code, hostId: d.hostId, players: d.players,
      phase: d.phase, bossHp: d.bossHp, mobs: d.mobs ?? [], endsAt: d.endsAt ?? 0, message: this.#state.status === "connecting" ? "" : this.#state.message,
    });
  }

  #upsertGhost(p) {
    const g = this.#ghosts.get(p.id) ?? { id: p.id, x: p.x * MW, y: p.y * MW, tx: p.x * MW, ty: p.y * MW, col: COLORS[this.#ghosts.size % COLORS.length], alive: true };
    Object.assign(g, { name: p.name, hp: p.hp, alive: p.alive !== false, kills: p.kills ?? 0, score: p.score ?? 0 });
    if (Number.isFinite(p.x) && !onlineState.active) { g.tx = p.x * MW; g.ty = p.y * MW; g.x = g.tx; g.y = g.ty; }
    this.#ghosts.set(p.id, g);
  }

  #onMove(d) {
    if (d.id === this.myId) return;
    const g = this.#ghosts.get(d.id);
    if (!g) return;
    g.tx = d.x * MW;
    g.ty = d.y * MW;
    if (Number.isFinite(d.hp)) g.hp = d.hp;
  }

  #onShot(d) {
    const g = this.#ghosts.get(d.id);
    if (!g || !onlineState.active) return;
    for (const s of d.shots) {
      if (this.#shots.length > 120) break;
      this.#shots.push({ x: s.x * MW, y: s.y * MW, vx: s.vx * MW, vy: s.vy * MW, life: REMOTE_SHOT_LIFE, col: g.col });
    }
  }

  #onCombat(d) {
    const me = this.myId;
    for (const p of d.players ?? []) {
      if (p.id === me) {
        if (onlineState.pvp) this.#applyServerHp(p.hp);
        continue;
      }
      this.#upsertGhost(p);
    }
    this.#mobs = d.mobs ?? this.#mobs;
    this.#set({ players: d.players ?? this.#state.players, bossHp: d.bossHp, mobs: d.mobs ?? this.#mobs });
    if (onlineState.coop) this.#syncBoss(d.bossHp);
  }

  #onEliminated(d) {
    const g = this.#ghosts.get(d.id);
    if (g) {
      g.alive = false;
      if (onlineState.active) burst(g.x, g.y, g.col, 30, 260, 3, 0.8);
    }
  }

  /* ───────── 對戰開始／結束 ───────── */

  #beginBattle(msg) {
    if (!this.#client || onlineState.active) return;
    const arena = msg.mode === "arena";
    onlineState.active = true;
    onlineState.mode = msg.mode;
    onlineState.pvp = arena;
    onlineState.coop = !arena;
    this.#savedStage = SV.sel;
    SV.sel = ONLINE_STAGE_INDEX; // 所有人用同一關，地圖才會一致
    this.#shots.length = 0;
    this.#pendingHits.clear();
    this.#shotQueue.length = 0;
    this.#pendingBoss = 0;
    this.#sentDied = false;
    this.#lastServerHp = 100;
    this.#moveAcc = this.#dmgAcc = this.#shotAcc = this.#hudAcc = 0;

    applyLO();
    const realRandom = Math.random;
    Math.random = seededRandom(msg.seed ?? 1);
    try { setup(); } finally { Math.random = realRandom; }
    G.en.length = 0;
    G.pendEn.length = 0;
    G.wave = arena ? 1 : COOP_BOSS_WAVE;
    G.banner = 0;
    G.waveT = 1.8;

    const spawn = msg.spawns?.[this.myId] ?? { x: 0.5, y: 0.5 };
    const at = nearestFree(spawn.x * MW, spawn.y * MW);
    G.pl.x = at.x;
    G.pl.y = at.y;
    G.camx = G.pl.x - G.W / G.S / 2;
    G.camy = G.pl.y - G.H / G.S / 2;
    for (const g of this.#ghosts.values()) { g.alive = true; }

    if (!arena) this.#spawnRaidBoss(msg);
    fsm.transition("play");
    $("ov").classList.add("h");
    onlineState.onPauseRequest = () => this.dispatchEvent(new CustomEvent("leave-request"));
    this.#set({ status: "playing", mode: msg.mode, bossPool: msg.bossPool ?? 1000, endsAt: msg.endsAt ?? 0, result: null, message: "" });
  }

  #spawnRaidBoss(msg) {
    const bi = (msg.seed ?? 0) % bossCatalog.count;
    const center = nearestFree(MW / 2, MW / 2);
    const boss = mkEn(bossCatalog.get(bi).typeId, center.x, center.y);
    const extra = Math.max(0, (msg.playerCount ?? 1) - 1);
    boss.mhp *= 1 + COOP_BOSS_HP_PER_EXTRA_PLAYER * extra;
    boss.hp = boss.mhp;
    boss.raid = true;
    G.en.push(boss);
    bossIntro(boss);
    G.bossT = bi;
    G.bossIn = 2.4;
    G.banner = 3;
    this.#lastBossHp = boss.hp;
  }

  #raidBoss() { return G.en.find((e) => e.raid); }

  #finish(result) {
    if (!onlineState.active) { this.#set({ status: "ended", result }); return; }
    const victory = Boolean(result?.victory);
    if (onlineState.coop && victory) {
      const boss = this.#raidBoss();
      if (boss) { burst(boss.x, boss.y, boss.col, 60, 380, 3, 1.1); boss.hp = 0; G.en.length = 0; }
      G.won = 1;
    }
    if (fsm.state === "play" || fsm.state === "pause") fsm.transition("over");
    G.shown = 1; // 不顯示單人結算畫面，改用線上結算面板
    this.#set({ status: "ended", result });
  }

  #endBattle() {
    if (!onlineState.active) return;
    onlineState.active = false;
    onlineState.mode = null;
    onlineState.pvp = false;
    onlineState.coop = false;
    onlineState.onPauseRequest = null;
    if (this.#savedStage !== null) { SV.sel = this.#savedStage; this.#savedStage = null; }
    G.en.length = 0;
    this.#shots.length = 0;
    this.#pendingHits.clear();
    this.#shotQueue.length = 0;
  }

  /* ───────── 競爭模式：血量與命中 ───────── */

  #applyServerHp(hp) {
    const lost = ((this.#lastServerHp - hp) / 100) * G.pl.mhp;
    this.#lastServerHp = hp;
    if (!(lost > 0) || fsm.state !== "play") return;
    G.HF = Math.min(1, Math.max(G.HF, 0.3 + lost / 45));
    G.HC = "#ff1e3c";
    G.pl.hf = 0.2;
    G.shake = Math.max(G.shake, Math.min(20, 3 + lost * 0.4));
    burst(G.pl.x, G.pl.y, "#ff3d6a", 10, 200, 2.5, 0.5);
    G.pl.hp -= lost;
    if (hp <= 0 || G.pl.hp <= 0) {
      G.pl.hp = 1;
      G.pl.sh = 0;
      G.pl.dashT = 0;
      onlineState.applying = true;
      try { hurt(1e9); } finally { onlineState.applying = false; }
    }
  }

  /** 我的子彈打到幽靈或弱敵人（由 simulation 在每顆我方子彈的碰撞檢查後呼叫） */
  bulletVsGhosts(b, bulletR) {
    if (!onlineState.pvp) return;
    const pierce = b.pierce || b.pe;
    for (const g of this.#ghosts.values()) {
      if (!g.alive || b.life <= 0) continue;
      const dx = g.x - b.x, dy = g.y - b.y, r = GHOST_R + bulletR;
      if (dx * dx + dy * dy >= r * r || (pierce && b.hit?.includes(g))) continue;
      this.#claim(g.id, b.dmg);
      burst(b.x, b.y, g.col, 6, 160, 2, 0.3);
      if (pierce && b.hit) b.hit.push(g); else { b.life = 0; return; }
    }
    for (const m of this.#mobs) {
      if (m.hp <= 0 || b.life <= 0) continue;
      const dx = m.x * MW - b.x, dy = m.y * MW - b.y, r = MOB_R + bulletR;
      if (dx * dx + dy * dy >= r * r || (pierce && b.hit?.includes(m))) continue;
      this.#claim(m.id, b.dmg);
      burst(b.x, b.y, "#ff8a5c", 6, 160, 2, 0.3);
      if (pierce && b.hit) b.hit.push(m); else { b.life = 0; return; }
    }
  }

  #claim(target, gameDamage) {
    this.#pendingHits.set(target, (this.#pendingHits.get(target) ?? 0) + gameDamage * VERSUS_DAMAGE_SCALE);
  }

  /* ───────── 合作模式：Boss 血量共享 ───────── */

  #syncBoss(sharedPool) {
    const boss = this.#raidBoss();
    if (!boss || !Number.isFinite(sharedPool)) return;
    const target = (sharedPool / this.#state.bossPool) * boss.mhp;
    if (target < boss.hp) {
      boss.hp = Math.max(0, target);
      boss.hf = 1;
      this.#lastBossHp = boss.hp;
      if (boss.hp <= 0) kill(boss);
    }
  }

  /* ───────── 每個模擬步驟（由 simulation.update 呼叫）───────── */

  tick(dt) {
    if (!onlineState.active) return;
    const client = this.#client;
    const k = Math.min(1, dt * 12);
    for (const g of this.#ghosts.values()) { g.x += (g.tx - g.x) * k; g.y += (g.ty - g.y) * k; }
    let w = 0;
    for (const s of this.#shots) {
      s.life -= dt;
      if (s.life <= 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      this.#shots[w++] = s;
    }
    this.#shots.length = w;
    if (fsm.state === "over") G.shown = 1; // 線上對戰不顯示單人結算畫面
    if (!client) return;

    // 位置（合作模式附帶自己的血量比例，給隊友的血條用）
    this.#moveAcc += dt;
    if (this.#moveAcc >= MOVE_EVERY && G.pl && fsm.state === "play") {
      this.#moveAcc = 0;
      client.move(G.pl.x / MW, G.pl.y / MW, onlineState.coop ? G.pl.hp / G.pl.mhp : undefined);
    }

    // 我的新子彈 → 轉發給其他人看（只有外觀）
    for (const b of G.bl) {
      if (!b.own || b._net) continue;
      b._net = 1;
      if (b.bm || b.fl || this.#shotQueue.length >= 6) continue;
      this.#shotQueue.push({ x: b.x / MW, y: b.y / MW, vx: b.vx / MW, vy: b.vy / MW });
    }
    this.#shotAcc += dt;
    if (this.#shotAcc >= SHOT_EVERY && this.#shotQueue.length) {
      this.#shotAcc = 0;
      client.shots(this.#shotQueue);
      this.#shotQueue.length = 0;
    }

    // 傷害回報
    this.#dmgAcc += dt;
    if (onlineState.coop) {
      const boss = this.#raidBoss();
      if (boss) {
        const lost = this.#lastBossHp - boss.hp;
        if (lost > 0) this.#pendingBoss += (lost / boss.mhp) * this.#state.bossPool;
        this.#lastBossHp = boss.hp;
      }
      if (this.#dmgAcc >= DAMAGE_EVERY && this.#pendingBoss > 0) {
        this.#dmgAcc = 0;
        const send = Math.min(150, this.#pendingBoss);
        if (client.bossDamage(send)) this.#pendingBoss -= send;
        else if (!client.inRoom) this.#pendingBoss = 0;
      }
      if (fsm.state === "over" && !this.#sentDied && this.#state.status === "playing") { this.#sentDied = true; client.died(); }
    } else if (this.#dmgAcc >= DAMAGE_EVERY) {
      this.#dmgAcc = 0;
      for (const [target, dmg] of this.#pendingHits) {
        const send = Math.min(40, dmg);
        client.hit(target, send);
        if (dmg - send > 0.5) this.#pendingHits.set(target, dmg - send); else this.#pendingHits.delete(target);
      }
    }

    // 畫面外的 HUD（倒數、存活人數）每 0.25 秒更新一次
    this.#hudAcc += dt;
    if (this.#hudAcc >= 0.25) { this.#hudAcc = 0; this.dispatchEvent(new CustomEvent("hud")); }
  }

  /* ───────── 繪製（世界座標；由 ui/render.js 在繪製子彈之後呼叫）───────── */

  drawWorld(cx) {
    if (!onlineState.active) return;
    cx.save();
    cx.lineWidth = 1.5;
    for (const m of this.#mobs) {
      if (m.hp <= 0) continue;
      const x = m.x * MW, y = m.y * MW;
      cx.globalAlpha = 0.9;
      cx.fillStyle = "#ff8a5c33";
      cx.strokeStyle = "#ff8a5c";
      cx.beginPath();
      cx.arc(x, y, MOB_R, 0, Math.PI * 2);
      cx.fill();
      cx.stroke();
      cx.fillStyle = "#06100d";
      cx.fillRect(x - 12, y - MOB_R - 7, 24, 3);
      cx.fillStyle = "#ff8a5c";
      cx.fillRect(x - 12, y - MOB_R - 7, 24 * Math.max(0, m.hp / 30), 3);
    }
    cx.font = "11px sans-serif";
    cx.textAlign = "center";
    for (const g of this.#ghosts.values()) {
      cx.globalAlpha = g.alive ? 0.95 : 0.3;
      cx.fillStyle = `${g.col}33`;
      cx.strokeStyle = g.col;
      cx.beginPath();
      cx.arc(g.x, g.y, GHOST_R, 0, Math.PI * 2);
      cx.fill();
      cx.stroke();
      cx.fillStyle = g.col;
      cx.beginPath();
      cx.arc(g.x, g.y, 3, 0, Math.PI * 2);
      cx.fill();
      cx.fillText(g.name ?? "", g.x, g.y - GHOST_R - 12);
      cx.fillStyle = "#06100d";
      cx.fillRect(g.x - 14, g.y - GHOST_R - 8, 28, 3);
      cx.fillStyle = g.col;
      cx.fillRect(g.x - 14, g.y - GHOST_R - 8, 28 * Math.max(0, Math.min(1, (g.hp ?? 0) / 100)), 3);
    }
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = "lighter";
    for (const s of this.#shots) {
      cx.fillStyle = s.col;
      cx.beginPath();
      cx.arc(s.x, s.y, 2.6, 0, Math.PI * 2);
      cx.fill();
    }
    cx.restore();
  }

  /** 測試用：目前記錄的暫存狀態 */
  _debug() { return { pendingBoss: this.#pendingBoss, pendingHits: new Map(this.#pendingHits), shots: this.#shots.length, queue: this.#shotQueue.length }; }
}

export const onlineMatch = new OnlineMatch();
