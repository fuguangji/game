/** game/tutorial — 教學模式（TutorialController） */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { $, N, T, cx } from "../core/viewport.js";
import { blocked, burst, cell, empty, mkEn, setup } from "./battle.js";
import { SQ } from "./ultimates.js";
import { WP, applyLO } from "./weapons.js";
import { showOv, start } from "../ui/render.js";
import { startShopGuide } from "../ui/shop-guide.js";

/* =====================================================================
 * 教學模式（TutorialController）：15 步引導，完成條件由「操作統計」自動判定
 *   - 以事件匯流排訂閱遊戲事件（射擊、衝刺、擊殺…），不再改寫任何核心函式
 *   - localStorage 鍵 KEYS.tutorialDone：沒有就是第一次遊玩，啟動後自動進入教學
 *   - 每一步可有 setup（佈置場景）、keep（資源被消耗時補回）、progress（進度 0~1）
 *   - 教學中血量不會歸零、不會結算獎勵、不會出現隨機波次
 * ===================================================================== */
const TUTORIAL_FONT = 'system-ui,"Noto Sans TC",sans-serif';

/** 玩家面向前方 d 像素處的座標 */
const aheadOfPlayer = (d) => ({
  x: G.pl.x + Math.cos(G.pl.aim) * d,
  y: G.pl.y + Math.sin(G.pl.aim) * d,
});

/** 生成教學敵人；frozen = 靜止靶（不會移動）；位置被牆擋住時改找空地 */
export function spawnTutorialEnemy(type, x, y, frozen) {
  let p = { x, y };
  if (blocked(p.x, p.y, 18)) p = empty(150, G.pl) || p;
  const e = mkEn(type, p.x, p.y);
  if (frozen) e.sp = 0;
  G.en.push(e);
  burst(p.x, p.y, "#ffffff", 8, 120, 2, 0.5);
}

export function spawnDummies(count) {
  for (let k = 0; k < count; k++) {
    const a = aheadOfPlayer(190);
    spawnTutorialEnemy(0, a.x, a.y + (k - (count - 1) / 2) * 70, true);
  }
}

/** 敵人被清光但條件未達成時，補怪（以 kills 為目標） */
const respawnUntilKilled = (type, need, frozen) => (ctl) => {
  if (G.en.length === 0 && (ctl.stats.kills || 0) < need) {
    const a = aheadOfPlayer(240);
    spawnTutorialEnemy(type, a.x, a.y, frozen);
  }
};

const spawnHealPack = () => {
  const a = aheadOfPlayer(110);
  G.pk.push({ x: a.x, y: a.y, t: "heal", life: 90 });
};

/** 教學步驟（資料）。text = 電腦說明，mb = 觸控裝置說明（沒有就共用 text） */
let TUTORIAL_STEPS; // 初始化在 init()

export class TutorialController {
  #active = false;
  #done = false;
  #step = 0;
  #advanceTimer = 0;
  #stats = TutorialController.emptyStats();
  #walls = [];
  #last = { x: 0, y: 0, aim: 0, w: 0 };
  #seen;
  #box = null;
  #backBtn = null;
  #skipBtn = null;
  #startBtn = null;
  #guideBtn = null;

  constructor() {
    this.#seen = store.getString(KEYS.tutorialDone) === "1";
  }

  static emptyStats() {
    return { moved: 0, aimed: 0, shots: 0, auto: 0, switches: 0, dashes: 0, walls: 0, kills: 0, supers: 0, pauses: 0, emptied: 0 };
  }

  get active() { return this.#active; }
  get isDone() { return this.#done; }
  get stats() { return this.#stats; }
  set walls(list) { this.#walls = [...list]; }
  get walls() { return [...this.#walls]; }

  /** 啟動：建立畫面按鈕、訂閱事件；第一次遊玩時自動進入教學 */
  init() {
    this.#buildUi();
    bus.on(GameEvents.PLAYER_SHOT, ({ autoAim }) => { this.#count("shots"); if (autoAim) this.#count("auto"); });
    bus.on(GameEvents.PLAYER_DASH, () => this.#count("dashes"));
    bus.on(GameEvents.SKILL_CAST, () => this.#count("skills"));
    bus.on(GameEvents.ULTIMATE_USED, () => this.#count("supers"));
    bus.on(GameEvents.ENEMY_KILLED, () => this.#count("kills"));
    bus.on(GameEvents.WALL_BROKEN, () => this.#count("walls"));
    bus.on(GameEvents.GAME_RESUMED, () => this.#count("pauses"));
    bus.on(GameEvents.PLAYER_HURT, (ev) => { // 教學中傷害封頂，不會死亡
      if (!this.#active) return;
      if (G.pl.hp < 30) G.pl.hp = 30;
      ev.damage = Math.min(ev.damage, (G.pl.hp - 1) / 1.2);
    });
    bus.on(GameEvents.QUIT_REQUESTED, (ev) => { // 暫停選單的「放棄」＝離開教學
      if (!this.#active) return;
      ev.cancel = true;
      $("ps").classList.add("h");
      this.exit();
    });
    bus.on(GameEvents.TICK, (dt) => this.#tick(dt));
    bus.on(GameEvents.HUD_DRAWN, () => this.#drawPanel());
    addEventListener("keydown", (e) => {
      if (!this.#active || e.repeat) return;
      if (e.code === "KeyN") this.advance();
      else if (e.code === "KeyB") this.back();
      else if (e.code === "KeyX") this.exit();
      else if (e.code === "Enter" && this.#done) this.toBattle();
    });
    if (!this.#seen) this.start(); // 第一次遊玩：自動進入教學
  }

  start() {
    applyLO();
    setup();
    G.AA = 1;
    this.#active = true;
    this.#done = false;
    this.#last = { x: G.pl.x, y: G.pl.y, aim: G.pl.aim, w: G.pl.w };
    G.wave = 1;
    G.banner = 0;
    G.pkT = 999;
    this.enter(0);
    $("ov").classList.add("h");
    fsm.transition("play");
    this.#syncUi();
  }

  /** 進入第 i 步：每步都從乾淨場地開始（所以上一步也能重來） */
  enter(i) {
    this.#step = i;
    this.#advanceTimer = 0;
    this.#stats = TutorialController.emptyStats();
    G.en.length = 0; G.bl.length = 0; G.zones.length = 0; G.pk.length = 0; SQ.length = 0;
    for (let j = 1; j < N - 1; j++) for (let k = 1; k < N - 1; k++) G.grid[k + j * N] = 0;
    G.tile = null; // 教學關是乾淨的空地，不要特殊方塊
    G.pl.hp = Math.max(G.pl.hp, G.pl.mhp * 0.6);
    if (G.pl) G.pl.sels = {}; // 每一步開始都回到「普通攻擊」，避免上一步選了技能後這一步打不出普通攻擊
    TUTORIAL_STEPS[i].setup?.(this);
    this.#syncUi();
  }

  advance() {
    if (!this.#active || this.#done) return;
    if (this.#step >= TUTORIAL_STEPS.length - 1) {
      this.#done = true;
      G.en.length = 0; G.bl.length = 0; G.pk.length = 0;
      this.#markDone();
      this.#syncUi();
      return;
    }
    this.enter(this.#step + 1);
  }

  back() {
    if (!this.#active) return;
    if (this.#done) { this.#done = false; this.enter(this.#step); }
    else if (this.#step > 0) this.enter(this.#step - 1);
  }

  exit() {
    this.#markDone();
    this.#active = false;
    G.en.length = 0; G.bl.length = 0; G.pk.length = 0;
    this.#syncUi();
    fsm.transition("menu");
    showOv(0);
  }

  toBattle() {
    this.#markDone();
    this.#active = false;
    this.#syncUi();
    start();
  }

  #markDone() {
    this.#seen = true;
    store.setString(KEYS.tutorialDone, "1");
  }

  #count(key, amount = 1) {
    if (this.#active) this.#stats[key] = (this.#stats[key] || 0) + amount;
  }

  #tick(dt) {
    if (!this.#active || !fsm.is("play") || this.#done) return;
    G.pkT = 999; // 教學中不隨機掉補給
    const step = TUTORIAL_STEPS[this.#step];
    if (!step.noRefill) for (const w of WP) w.am = w.ms; // 彈藥補滿（彈藥那一步除外）
    else if (WP[G.pl.w].am < 1) this.#stats.emptied = 1;
    this.#count("moved", Math.hypot(G.pl.x - this.#last.x, G.pl.y - this.#last.y));
    let da = G.pl.aim - this.#last.aim;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.#count("aimed", Math.abs(da));
    if (G.pl.w !== this.#last.w) this.#count("switches");
    this.#last = { x: G.pl.x, y: G.pl.y, aim: G.pl.aim, w: G.pl.w };
    if (this.#advanceTimer > 0) {
      this.#advanceTimer -= dt;
      if (this.#advanceTimer <= 0) this.advance();
      return;
    }
    if (step.progress(this.#stats) >= 1) { this.#advanceTimer = 0.9; return; } // 達標：顯示 ✓ 後再進下一步
    step.keep?.(this);
  }

  /* ---------- 畫面 ---------- */
  #buildUi() {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:25;left:max(10px,env(safe-area-inset-left));top:calc(max(10px,env(safe-area-inset-top)) + 54px);display:none;flex-direction:column;gap:6px";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.className = "sb";
      b.textContent = label;
      b.onclick = fn;
      box.append(b);
      return b;
    };
    this.#backBtn = mk("上一步 (B)", () => this.back());
    this.#skipBtn = mk("跳過此步 (N)", () => this.advance());
    mk("離開教學 (X)", () => this.exit());
    this.#startBtn = mk("開始戰鬥 (Enter)", () => this.toBattle());
    this.#guideBtn = mk("繼續：商店與芯片導覽", () => this.#startShopGuide());
    document.body.append(box);
    this.#box = box;

    this.#syncUi();
  }

  #syncUi() {
    if (!this.#box) return;
    this.#box.style.display = this.#active ? "flex" : "none";
    this.#backBtn.style.display = this.#active && (this.#step > 0 || this.#done) ? "block" : "none";
    this.#skipBtn.style.display = this.#active && !this.#done ? "block" : "none";
    this.#startBtn.style.display = this.#active && this.#done ? "block" : "none";
    this.#guideBtn.style.display = this.#active && this.#done ? "block" : "none";
  }

  /** 戰鬥教學結束後，回到選單並開始「商店與芯片」互動導覽（要真的買一次、裝一次） */
  #startShopGuide() {
    if (!this.#active || !this.#done) return;
    this.#markDone();
    this.#active = false;
    this.#syncUi();
    fsm.transition("menu");
    showOv(0);
    startShopGuide();
  }

  #wrap(text, maxWidth) {
    const lines = [];
    let line = "";
    for (const ch of text) {
      if (cx.measureText(line + ch).width > maxWidth) { lines.push(line); line = ch; }
      else line += ch;
    }
    lines.push(line);
    return lines;
  }

  #drawPanel() {
    if (!this.#active || !fsm.is("play")) return;
    cx.setTransform(G.DPR, 0, 0, G.DPR, 0, 0);
    const u = G.HU, n = TUTORIAL_STEPS.length, step = TUTORIAL_STEPS[this.#step];
    const w = Math.min(G.W - 24, 400 * u), x = G.W / 2 - w / 2, y = G.safeT + 10;
    cx.save();
    cx.font = 13 * u + "px " + TUTORIAL_FONT;
    const body = this.#done
      ? "你已學會基本戰鬥！接著點「繼續：商店與芯片導覽」，我們會帶你實際買一包芯片並裝到槍上（約 1 分鐘）；也可以直接開始正式戰鬥。"
      : G.touchOn && step.mb ? step.mb : step.text;
    const lines = this.#wrap(body, w - 24 * u);
    const h = (46 + lines.length * 19 + (this.#done ? 4 : 18)) * u;
    cx.fillStyle = "#05060ddd"; cx.fillRect(x, y, w, h);
    cx.strokeStyle = "#ffe14a88"; cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    cx.textAlign = "left"; cx.textBaseline = "top";
    cx.fillStyle = this.#advanceTimer > 0 ? "#3dff8f" : "#ffe14a";
    cx.font = "bold " + 14 * u + "px " + TUTORIAL_FONT;
    cx.fillText(this.#done ? "教學完成！" : "教學 " + (this.#step + 1) + "/" + n + " · " + step.title + (this.#advanceTimer > 0 ? "  ✓" : ""), x + 12 * u, y + 8 * u);
    const seg = (w - 24 * u) / n;
    for (let i = 0; i < n; i++) {
      cx.fillStyle = this.#done || i < this.#step ? "#3dff8f" : i === this.#step ? "#ffe14a" : "#ffffff33";
      cx.fillRect(x + 12 * u + i * seg, y + 28 * u, seg - 3 * u, 3 * u);
    }
    cx.fillStyle = "#d8f4ff"; cx.font = 13 * u + "px " + TUTORIAL_FONT;
    lines.forEach((l, i) => cx.fillText(l, x + 12 * u, y + (38 + i * 19) * u));
    if (!this.#done) {
      const f = Math.max(0, Math.min(1, step.progress(this.#stats))), by = y + h - 14 * u;
      cx.fillStyle = "#ffffff22"; cx.fillRect(x + 12 * u, by, w - 24 * u, 6 * u);
      cx.fillStyle = f >= 1 ? "#3dff8f" : "#ffe14a"; cx.fillRect(x + 12 * u, by, (w - 24 * u) * f, 6 * u);
    }
    cx.restore();
  }
}

export let tutorial; // 初始化在 init()
/** 主頁「教學模式」按鈕的入口 */
export function startTutorial() {
  tutorial.start();
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {
TUTORIAL_STEPS = Object.freeze([
  { title: "移動", text: "按 W A S D 在場地中移動。嘗試走一小段路吧！", mb: "用左半邊螢幕的虛擬搖桿移動。嘗試走一小段路吧！", progress: (s) => s.moved / 200 },
  { title: "瞄準", text: "移動滑鼠可以讓角色前方的瞄準線跟著轉，試著轉約一圈吧！", mb: "在右半邊螢幕拖曳手指，瞄準線就會朝拖曳方向轉動，試著轉約一圈！", progress: (s) => s.aimed / 6 },
  { title: "射擊", text: "按滑鼠左鍵就能射擊（按住的話可連射的槍會持續開火）。嘗試開火五次吧！", mb: "在右半邊螢幕拖曳瞄準，放開手指就會發射，嘗試射擊 5 次吧！", progress: (s) => s.shots / 5 },
  {
    title: "彈藥數量",
    text: "每次射擊都會消耗彈藥（畫面下方右側的彈藥條）！。試著把目前彈匣打光，再等它自動回復一發！",
    noRefill: true,
    setup: () => { const w = WP[G.pl.w]; w.am = w.ms; },
    progress: (s) => s.emptied ? (WP[G.pl.w].am >= 1 ? 1 : 0.7) : Math.min(0.6, (s.shots / WP[G.pl.w].ms) * 0.6),
  },
  {
    title: "換槍",
    text: "按 1 / 2 或 Q 切換武器（可以在「備戰」裝備第 2 把術式武器；只裝備 1 把會自動略過）。嘗試換幾次吧！",
    mb: "點畫面下方的槍欄切換武器（可拖曳互換位置），試著切換 2 次。",
    progress: (s) => (WP.length < 2 ? 1 : s.switches / 2),
  },
  {
    title: "術式技能",
    text: "術式武器除了普通攻擊，還有技能。畫面下方顯示「目前選定」的那一格：滾動滑鼠滾輪切換（普通攻擊 ↔ 各技能），選到技能後按滑鼠左鍵就會發動；也可以直接按 Z X C V B N。技能消耗能量，能量會自己回復。試著發動 2 次！",
    mb: "點畫面下方的 ◀ ▶ 切換「目前選定」的格子，選到技能後，在右半邊拖曳瞄準再放開就會發動（也可以直接點那個技能格）。試著發動 2 次！",
    setup: () => { G.pl.en = G.pl.enMax; },
    keep: () => { if (G.pl.en < 30) G.pl.en = 30; },
    progress: (s) => s.skills / 2,
  },
  {
    title: "自動瞄準",
    text: "角色周圍的瞄準虛線圈內，會自動瞄準最近的敵人（顯示黃色圈）。試著大致朝靶射擊 3 次；按 R 可切換自動瞄準模式，也可以到「個人檔案→設定」來設置",
    setup: () => { G.AA = 1; const a = aheadOfPlayer(130); spawnTutorialEnemy(0, a.x, a.y, true); },
    keep: respawnUntilKilled(0, 99, true),
    progress: (s) => s.auto / 3,
  },
  { title: "衝刺", text: "按 Shift 就可以衝刺！衝刺期間完全無敵，能直接穿過槍林彈雨，但有冷卻時間，按 Shift 衝刺 2 次試試吧！", mb: "點右下角 DASH 鈕可以衝刺（按住並拖曳可指定方向），試著衝刺 2 次！", progress: (s) => s.dashes / 2 },
  {
    title: "破牆",
    text: "彩色方塊能被子彈打碎。顏色越偏暖色，牆壁的損壞度越高；紫色叉叉牆無論任何武器都打不壞。嘗試看看打碎前方 3 塊牆吧！",
    setup: (ctl) => {
      const a = aheadOfPlayer(T * 3);
      const ci = Math.floor(a.x / T), cj = Math.floor(a.y / T);
      const horizontal = Math.abs(Math.cos(G.pl.aim)) < Math.abs(Math.sin(G.pl.aim));
      const placed = [];
      for (let d = -1; d <= 1; d++) {
        const i = ci + (horizontal ? d : 0), j = cj + (horizontal ? 0 : d);
        if (cell(i, j) === 0) { G.grid[i + j * N] = 2; placed.push(i + j * N); }
      }
      while (placed.length < 3) { // 前方被擋時改放別處
        const q = empty(150, G.pl);
        if (!q) break;
        const i = Math.floor(q.x / T), j = Math.floor(q.y / T);
        G.grid[i + j * N] = 2;
        placed.push(i + j * N);
      }
      ctl.walls = placed;
    },
    progress: (s) => s.walls / 3,
  },
  {
    title: "擊敗敵人",
    text: "我們來試著擊敗 2 個靜止的追擊靶！命中會把敵人擊退，擊退力強的武器更容易拉開距離喔！",
    setup: () => spawnDummies(2),
    keep: (ctl) => { if (G.en.length === 0 && (ctl.stats.kills || 0) < 2) spawnDummies(2 - (ctl.stats.kills || 0)); },
    progress: (s) => s.kills / 2,
  },
  {
    title: "閃避狙擊",
    text: "狙擊敵人開火前會出現紅色虛線（約 0.45 秒）。看到就移動或衝刺閃開，再把它擊倒！",
    setup: () => { const a = aheadOfPlayer(260); spawnTutorialEnemy(1, a.x, a.y, false); },
    keep: respawnUntilKilled(1, 1, false),
    progress: (s) => s.kills,
  },
  {
    title: "閃避散射",
    text: "散射敵人一次射出 5 發扇形子彈，紅色虛線就是彈道。往彈道之間的縫隙移動，或衝刺穿過去，再擊倒它。",
    setup: () => { const a = aheadOfPlayer(260); spawnTutorialEnemy(2, a.x, a.y, false); },
    keep: respawnUntilKilled(2, 1, false),
    progress: (s) => s.kills,
  },
  {
    title: "地面炸彈",
    text: "投擲敵人會在你腳下丟出紅色圓圈炸彈，圈填滿就爆炸，也會炸毀方塊。看到圈就離開，再擊倒它。",
    setup: () => { const a = aheadOfPlayer(260); spawnTutorialEnemy(3, a.x, a.y, false); },
    keep: respawnUntilKilled(3, 1, false),
    progress: (s) => s.kills,
  },
  {
    title: "術式場",
    text: "命中敵人會累積大招能量，每把武器各自累積，蓄滿後可以展開「術式場」，在範圍內改寫戰場規則。這次已幫你蓄滿，按空白鍵展開（展開中有些術式場會鎖住技能或接管數字鍵，仔細看說明）。",
    mb: "這次已幫你蓄滿。點 SUPER 鈕展開術式場。",
    setup: () => { spawnDummies(2); G.pl.ult = 100; },
    keep: (ctl) => {
      if ((ctl.stats.supers || 0) < 1 && G.pl.ult < 100) G.pl.ult = 100;
      if (G.en.length === 0 && (ctl.stats.supers || 0) < 1) spawnDummies(2);
    },
    progress: (s) => s.supers,
  },
  { title: "暫停", text: "按 P 或 Esc 暫停，再按一次繼續。暫停選單可放棄本局。這一步請暫停後繼續遊戲。", mb: "點左上角的暫停鈕，再按「繼續」。", progress: (s) => s.pauses },
  { title: "彈幕", text: "來體驗看看用衝刺和移動來閃避彈幕吧！我們已經鎖住你的血量了，試試看擊敗他們！",
    setup: (ctl) => {
      const a = aheadOfPlayer(260);
      spawnTutorialEnemy(2, a.x, a.y, false);
      spawnTutorialEnemy(2, a.x, a.y, false);
      spawnTutorialEnemy(2, a.x, a.y, false);
      spawnTutorialEnemy(2, a.x, a.y, false);
    },
    keep: (ctl) => {respawnUntilKilled(2,4, false)},
    progress: (s) => s.kills / 4,
  },
  {
    title: "補血",
    text: "血量被降低了。走到綠色十字上回復血量，撿取物掉在地上一段時間後會消失。",
    setup: () => { if (G.pl.hp >= 100) G.pl.hp = 40; spawnHealPack(); },
    keep: () => { if (G.pl.hp < 65 && !G.pk.some((q) => q.t === "heal")) spawnHealPack(); },
    progress: () => Math.max(0, (G.pl.hp - 40) / 25),
  },
]);
tutorial = new TutorialController();
}

