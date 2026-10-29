/** game/tutorial — 教學模式（TutorialController） */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { platform } from "../core/platform.js";
import { $, N, T, cx } from "../core/viewport.js";
import { blocked, burst, cell, empty, mkEn, setup } from "./battle.js";
import { SQ } from "./ultimates.js";
import { WP, applyLO } from "./weapons.js";
import { showOv, start } from "../ui/render.js";
import { startShopGuide } from "../ui/shop-guide.js";
import { commonSteps } from "./tutorial-common.js";
import { desktopSteps } from "./tutorial-desktop.js";
import { mobileSteps } from "./tutorial-mobile.js";

/* =====================================================================
 * 教學模式（TutorialController）：15 步引導，完成條件由「操作統計」自動判定
 *   - 以事件匯流排訂閱遊戲事件（射擊、衝刺、擊殺…），不再改寫任何核心函式
 *   - localStorage 鍵 KEYS.tutorialDone：沒有就是第一次遊玩 → 大廳最上面會出現「開始教學」的建議卡
 *     （不再一載入就自動進入戰鬥：載入時不跑整個遊戲迴圈，首頁才開得快；玩家也能先看一眼首頁再決定）
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

/**
 * 教學步驟（資料）依平台分成兩份獨立的清單：tutorial-desktop.js（鍵盤＋滑鼠）、tutorial-mobile.js（觸控）；
 * 場景型的關卡（破牆、閃避、補血…）放在 tutorial-common.js 共用。開始教學時依目前平台選一份。
 */
export function buildSteps() {
  const helpers = { aheadOfPlayer, spawnTutorialEnemy, spawnDummies, respawnUntilKilled, spawnHealPack };
  helpers.common = commonSteps(helpers);
  return Object.freeze(platform.isMobile ? mobileSteps(helpers) : desktopSteps(helpers));
}

export class TutorialController {
  #active = false;
  #done = false;
  #step = 0;
  #steps = [];
  #advanceTimer = 0;
  #stats = TutorialController.emptyStats();
  #walls = [];
  #last = { x: 0, y: 0, aim: 0, w: 0 };
  #seen;
  #box = null;
  #backBtn = null;
  #skipBtn = null;
  #exitBtn = null;
  #startBtn = null;
  #guideBtn = null;

  constructor() {
    this.#seen = store.getString(KEYS.tutorialDone) === "1";
  }

  static emptyStats() {
    return { moved: 0, aimed: 0, shots: 0, auto: 0, switches: 0, dashes: 0, walls: 0, kills: 0, supers: 0, pauses: 0, emptied: 0, skills: 0, selects: 0, cancels: 0 };
  }

  get active() { return this.#active; }
  get isDone() { return this.#done; }
  /** 玩家是否玩過（或跳過）教學 */
  get seen() { return this.#seen; }
  get stats() { return this.#stats; }
  set walls(list) { this.#walls = [...list]; }
  get walls() { return [...this.#walls]; }

  /** 啟動：建立畫面按鈕、訂閱事件 */
  init() {
    this.#buildUi();
    bus.on(GameEvents.PLAYER_SHOT, ({ autoAim }) => { this.#count("shots"); if (autoAim) this.#count("auto"); });
    bus.on(GameEvents.PLAYER_DASH, () => this.#count("dashes"));
    bus.on(GameEvents.SKILL_CAST, () => this.#count("skills"));
    bus.on(GameEvents.SKILL_SELECTED, () => this.#count("selects"));
    bus.on(GameEvents.SKILL_CANCELLED, () => this.#count("cancels"));
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
  }

  start() {
    this.#steps = buildSteps(); // 開始時依平台決定這次用電腦版或手機版教學
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
    this.#steps[i].setup?.(this);
    this.#syncUi();
  }

  advance() {
    if (!this.#active || this.#done) return;
    if (this.#step >= this.#steps.length - 1) {
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
    const step = this.#steps[this.#step];
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
    this.#exitBtn = mk("離開教學 (X)", () => this.exit());
    this.#startBtn = mk("開始戰鬥 (Enter)", () => this.toBattle());
    this.#guideBtn = mk("繼續：商店與芯片導覽", () => this.#startShopGuide());
    document.body.append(box);
    this.#box = box;

    this.#syncUi();
  }

  #syncUi() {
    if (!this.#box) return;
    this.#box.style.display = this.#active ? "flex" : "none";
    const hint = (label, key) => (platform.isMobile ? label : `${label} (${key})`); // 手機沒有鍵盤，不顯示快捷鍵
    this.#backBtn.textContent = hint("上一步", "B");
    this.#skipBtn.textContent = hint("跳過此步", "N");
    this.#exitBtn.textContent = hint("離開教學", "X");
    this.#startBtn.textContent = hint("開始戰鬥", "Enter");
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
    const u = G.HU, n = this.#steps.length, step = this.#steps[this.#step];
    const w = Math.min(G.W - 24, 400 * u), x = G.W / 2 - w / 2, y = G.safeT + 10;
    cx.save();
    cx.font = 13 * u + "px " + TUTORIAL_FONT;
    const body = this.#done
      ? "你已學會基本戰鬥！接著點「繼續：商店與芯片導覽」，我們會帶你實際買一包芯片並裝到槍上（約 1 分鐘）；也可以直接開始正式戰鬥。"
      : step.text;
    const lines = this.#wrap(body, w - 24 * u);
    cx.font = 12 * u + "px " + TUTORIAL_FONT;
    const tipLines = !this.#done && step.tip ? this.#wrap("💡 " + step.tip, w - 24 * u) : [];
    cx.font = 13 * u + "px " + TUTORIAL_FONT;
    const h = (46 + lines.length * 19 + (tipLines.length ? 6 + tipLines.length * 17 : 0) + (this.#done ? 4 : 18)) * u;
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
    if (tipLines.length) {
      cx.fillStyle = "#8fe3cf"; cx.font = 12 * u + "px " + TUTORIAL_FONT;
      tipLines.forEach((l, i) => cx.fillText(l, x + 12 * u, y + (38 + lines.length * 19 + 6 + i * 17) * u));
    }
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
tutorial = new TutorialController();
}

