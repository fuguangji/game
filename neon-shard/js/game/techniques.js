/**
 * game/techniques — 術式系統：能量、技能、術式場
 *
 * 一把「術式武器」除了普通攻擊外，還有：
 *   skills   最多 6 個技能，按 Z X C V B N（手機用畫面上的技能鈕）
 *   domains  術式場：第 1 個用大招鍵（空白鍵／SUPER，需大招蓄滿），第 2 個用 E（同樣需蓄滿）
 *
 * 新增一套術式：在 js/techniques/ 新增一個檔案呼叫 registerTechnique({...})，再到 js/techniques/index.js 引入。
 * 技能與術式場的效果都用下面的 kit（工具箱）組合：範圍傷害 aoe、扇形 cone、射線 beam、持續效果 addFx…
 *
 * 名詞（對照遊戲內的實作）：
 *   能量        p.en（上限 p.enMax），每秒自動回復；技能消耗能量
 *   術式熔斷    狀態 seal：無法普通攻擊、無法施放術式（status-effects.js / enemy-effects.js）
 *   靈魂熔斷    狀態 soulseal：無法操縱（不能移動、不能攻擊）；Boss 免疫
 *   術式反噬    施放技能時對自己造成的傷害（最大生命值的比例；不會致死，最少留 1 點）
 *   次術式場    不需要大招蓄能的範圍效果（用 addFx 做的圓形區域）
 *   1 公尺      METER = 48 像素
 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { MW, T, TAU } from "../core/viewport.js";
import { syncTechniqueUi } from "../ui/technique-ui.js";
import { toast } from "../ui/feedback.js";
import { ULN, hitCell, mouse } from "./battle.js";
import { dm } from "./boss.js";
import { applyEnemyFx, hasEnemyFx } from "./enemy-effects.js";
import { kill } from "./enemy-death.js";
import { aimT, angD, chgU } from "./physics.js";
import { UL } from "./progress.js";
import { backlashMultiplier, damageDealtMultiplier, hasStatus, isBlocked, skillCostMultiplier, skillDamageMultiplier } from "./status-effects.js";
import { ALLWEAPON, WP } from "./weapons.js";
import { burst, mv, ray } from "./world-helpers.js";

export const METER = 48;
export const SKILL_KEYS = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN"];
export const SKILL_LABELS = ["Z", "X", "C", "V", "B", "N"];
const ENERGY_REGEN = 14; // 每秒回復的能量

/* ───────────── 註冊表 ───────────── */
const TECHNIQUES = [];
let byWeaponId = null;

/**
 * 註冊一套術式。
 * @param {{weapon: string, color: string, skills: Skill[], domains?: Domain[], meter?: {name: string, color: string, value: (p: object) => number}, tick?: (p: object, dt: number) => void}} def
 *   weapon  對應的武器名稱（weapons.js 裡的 name；編號自動對應，不必記）
 * Skill:  { name, cost?: number | (ctx) => number, cd?: 秒, backlash?: 最大生命比例, hpCost?: 最大生命比例,
 *           desc?: 說明, canCast?(ctx): boolean, cast(ctx) }
 * Domain: { name, color?, energyFrac?: 需要並消耗的能量比例, hpFrac?: 消耗的生命比例, backlash?, desc?, cast(ctx) }
 */
export function registerTechnique(def) {
  if (typeof def?.weapon !== "string") throw new TypeError("術式需要 weapon（武器名稱）");
  if (!Array.isArray(def.skills) || def.skills.length > SKILL_KEYS.length) throw new RangeError(`術式「${def.weapon}」的技能最多 ${SKILL_KEYS.length} 個`);
  for (const s of def.skills) if (typeof s.name !== "string" || typeof s.cast !== "function") throw new TypeError(`術式「${def.weapon}」有技能缺少 name 或 cast`);
  if ((def.domains ?? []).length > 2) throw new RangeError(`術式「${def.weapon}」的術式場最多 2 個`);
  for (const d of def.domains ?? []) if (typeof d.name !== "string" || typeof d.cast !== "function") throw new TypeError(`術式「${def.weapon}」有術式場缺少 name 或 cast`);
  if (TECHNIQUES.some((t) => t.weapon === def.weapon)) throw new Error(`重複的術式：${def.weapon}`);
  TECHNIQUES.push({ domains: [], ...def });
  byWeaponId = null;
}

const table = () => {
  if (byWeaponId) return byWeaponId;
  byWeaponId = new Map();
  const defs = ALLWEAPON.getWeapon();
  for (const t of TECHNIQUES) {
    const id = defs.findIndex((w) => w.name === t.weapon);
    if (id < 0) throw new Error(`術式「${t.weapon}」找不到對應的武器，請到 weapons.js 新增同名武器`);
    byWeaponId.set(id, t);
  }
  return byWeaponId;
};

/** 某把武器的術式；沒有回傳 null */
export const techniqueOf = (weaponId) => table().get(weaponId) ?? null;
/** 目前手上武器的術式 */
export const currentTechnique = () => {
  const w = WP[G.pl.w];
  return w ? techniqueOf(w.id) : null;
};
/** 目前武器有幾個術式場（大招鍵是否改為展開術式場，由這個決定） */
export const domainCount = () => currentTechnique()?.domains.length ?? 0;

/** 把第 1 個術式場的名稱設成該武器的大招名稱（SUPER 鈕上的文字）；main.js 在武器初始化後呼叫 */
export function initTechniques() {
  for (const [id, t] of table()) if (t.domains[0]) ULN[id] = t.domains[0].name;
}

/** 全部術式（測試與文件用） */
export const allTechniques = () => [...TECHNIQUES];

/* ───────────── 玩家資源 ───────────── */
function ensure(p) {
  p.en ??= 100;
  p.enMax ??= 100;
  p.cdw ??= {};
  p.heat ??= 0;
}

let lastNotice = "";
let lastNoticeAt = 0;
const deny = (msg) => {
  const now = performance.now();
  if (msg !== lastNotice || now - lastNoticeAt > 800) toast(msg, { type: "warn", duration: 1400 });
  lastNotice = msg;
  lastNoticeAt = now;
  return false;
};

/** 術式反噬：對自己造成最大生命比例的傷害（受反噬倍率影響，不會致死） */
export function selfBacklash(frac) {
  const p = G.pl, a = frac * p.mhp * backlashMultiplier(p);
  if (a <= 0) return 0;
  p.hp = Math.max(1, p.hp - a);
  G.HF = Math.max(G.HF, 0.25);
  G.HC = "#ff1e3c";
  burst(p.x, p.y, "#ff3d6a", 6, 140, 2, 0.4);
  return a;
}

/** 直接消耗生命（技能的「代價」，不受反噬倍率影響；呼叫前先確認血量夠） */
const loseHp = (amount) => { G.pl.hp -= amount; };

/* ───────────── 瞄準資訊 ───────────── */
function aimPoint(p) {
  if (mouse.has) return { x: mouse.x / G.S + G.camx, y: mouse.y / G.S + G.camy };
  const t = aimT();
  if (t) return { x: t.x, y: t.y };
  return { x: p.x + Math.cos(p.aim) * 260, y: p.y + Math.sin(p.aim) * 260 };
}

const alive = (e) => e.hp > 0 && !e.dk;

function makeCtx() {
  const p = G.pl, pt = aimPoint(p);
  const dist = Math.hypot(pt.x - p.x, pt.y - p.y);
  let target = null, best = 140;
  for (const e of G.en) {
    if (!alive(e)) continue;
    const d = Math.hypot(e.x - pt.x, e.y - pt.y) - e.r;
    if (d < best) { best = d; target = e; }
  }
  return { p, aim: p.aim, x: pt.x, y: pt.y, dist, target };
}

/* ───────────── 工具箱 ───────────── */
/** 技能傷害換算：升級、本局加成、狀態倍率（升溫等）、屬性倍率（轉態：水 ×3） */
export function scaleDamage(d, tag) {
  const p = G.pl;
  return d * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) * damageDealtMultiplier(p) * skillDamageMultiplier(p, tag);
}

/** 範圍內的存活敵人 */
export const enemiesIn = (x, y, r) => G.en.filter((e) => alive(e) && Math.hypot(e.x - x, e.y - y) < r + e.r);
/** 範圍內的敵方子彈 */
export const bulletsIn = (x, y, r) => G.bl.filter((b) => b.own === 0 && b.life > 0 && Math.hypot(b.x - x, b.y - y) < r);

/**
 * 對單一敵人造成技能傷害（含 Boss 護甲、擊殺、大招充能）。
 * opts: { tag, from: {x, y} 傷害來源（決定擊退方向，預設玩家）, kb 擊退力道, ult 大招充能比例 }
 */
export function hitEnemy(e, dmg, { tag, from = G.pl, kb = 0, ult = 0.12 } = {}) {
  if (!alive(e)) return 0;
  const dd = dm(e, scaleDamage(dmg, tag), Math.atan2(from.y - e.y, from.x - e.x));
  e.hp -= dd;
  e.hf = dd > 0 ? 1 : 0;
  if (dd > 0 && ult) chgU(undefined, dd * ult);
  if (kb) {
    const a = Math.atan2(e.y - from.y, e.x - from.x);
    e.kx += (Math.cos(a) * kb) / e.m;
    e.ky += (Math.sin(a) * kb) / e.m;
  }
  if (e.hp <= 0) kill(e);
  return dd;
}

/** 對敵人施加效果清單：[["seal", { duration: 5 }], …] */
const applyFxList = (e, fx = []) => { for (const [name, o] of fx) applyEnemyFx(e, name, o); };

/** 灼燒（沿用舊的 e.bu 欄位） */
export const burn = (e, sec) => { e.bu = Math.max(e.bu || 0, sec); };

/** 視覺：擴散環 */
export const ring = (x, y, r, col, t = 0.4) => G.fxs.push({ k: "w", x, y, r, t, max: t, col });

/**
 * 圓形範圍傷害。opts: { tag, kb, fx: [[效果名, 選項]], burn: 秒, walls: 破牆力道, from }
 * @returns {object[]} 被命中的敵人
 */
export function aoe(x, y, r, dmg, { tag, kb = 0, fx, burn: sec, walls = 0, from = { x, y }, ult } = {}) {
  const hits = enemiesIn(x, y, r);
  for (const e of hits) {
    if (dmg > 0) hitEnemy(e, dmg, { tag, kb, from, ult });
    else if (kb) { const a = Math.atan2(e.y - from.y, e.x - from.x); e.kx += (Math.cos(a) * kb) / e.m; e.ky += (Math.sin(a) * kb) / e.m; }
    if (alive(e)) { applyFxList(e, fx); if (sec) burn(e, sec); }
  }
  if (walls) wallsIn(x, y, r, walls);
  return hits;
}

/** 範圍破牆 */
export function wallsIn(x, y, r, n) {
  for (let j = Math.floor((y - r) / T); j <= Math.floor((y + r) / T); j++)
    for (let i = Math.floor((x - r) / T); i <= Math.floor((x + r) / T); i++)
      if (Math.hypot((i + 0.5) * T - x, (j + 0.5) * T - y) < r + 8) hitCell(i, j, n);
}

/** 扇形範圍傷害（arc 是整個扇形的弧度）。opts 同 aoe，另有 cutBullets：同時擊落範圍內的敵方子彈 */
export function cone(x, y, ang, range, arc, dmg, { tag, kb = 0, fx, cutBullets = false } = {}) {
  const hits = G.en.filter((e) => alive(e) && Math.hypot(e.x - x, e.y - y) < range + e.r && angD(Math.atan2(e.y - y, e.x - x), ang) <= arc / 2);
  for (const e of hits) {
    hitEnemy(e, dmg, { tag, kb, from: { x, y } });
    if (alive(e)) applyFxList(e, fx);
  }
  if (cutBullets) for (const b of bulletsIn(x, y, range)) if (angD(Math.atan2(b.y - y, b.x - x), ang) <= arc / 2) b.life = 0;
  return hits;
}

/**
 * 射線（瞬間命中）。opts: { tag, kb, fx, pierceWalls: 穿牆, first: 只打第一個, walls: 沿途破牆力道, col, burn }
 * @returns {{end: {x: number, y: number}, hits: object[]}}
 */
export function beam(x, y, ang, len, width, dmg, { tag, kb = 0, fx, pierceWalls = false, first = false, walls = 0, col = "#ffffff", burn: sec } = {}) {
  const L = pierceWalls ? len : Math.max(0, Math.min(len, ray(x, y, ang, len)));
  const c = Math.cos(ang), s = Math.sin(ang);
  let hits = [];
  for (const e of G.en) {
    if (!alive(e)) continue;
    const dx = e.x - x, dy = e.y - y, along = dx * c + dy * s, off = Math.abs(-dx * s + dy * c);
    if (along > -e.r && along < L + e.r && off < width / 2 + e.r) hits.push({ e, along });
  }
  hits.sort((a, b) => a.along - b.along);
  if (first) hits = hits.slice(0, 1);
  for (const { e } of hits) {
    hitEnemy(e, dmg, { tag, kb, from: { x, y } });
    if (alive(e)) { applyFxList(e, fx); if (sec) burn(e, sec); }
  }
  if (walls) for (let q = 0; q < L; q += T / 2) hitCell(Math.floor((x + c * q) / T), Math.floor((y + s * q) / T), walls);
  G.fxs.push({ k: "l", x, y, a: ang, len: L, t: 0.3, max: 0.3, col });
  return { end: { x: x + c * L, y: y + s * L }, hits: hits.map((h) => h.e) };
}

/** 讓單位沿某方向前進，撞牆就停下，回傳實際移動距離（轉能、衝刺類技能用） */
export function moveAlong(u, ang, dist) {
  let moved = 0;
  while (moved < dist) {
    const step = Math.min(12, dist - moved), x0 = u.x, y0 = u.y;
    mv(u, Math.cos(ang) * step, Math.sin(ang) * step);
    if (Math.hypot(u.x - x0, u.y - y0) < step * 0.5) break;
    moved += step;
  }
  return moved;
}

/** 找最近的敵人（可限制距離與角度） */
export function nearestEnemy(x, y, maxR = 9999, filter = () => true) {
  let best = null, bd = maxR;
  for (const e of G.en) {
    if (!alive(e) || !filter(e)) continue;
    const d = Math.hypot(e.x - x, e.y - y) - e.r;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** 回復玩家生命（最大生命的比例） */
export const healPlayer = (frac) => { G.pl.hp = Math.min(G.pl.mhp, G.pl.hp + frac * G.pl.mhp); };

/** 畫一個圓環（world 座標） */
export function strokeRing(cx, x, y, r, col, { alpha = 0.7, width = 2, dash = null, offset = 0 } = {}) {
  cx.save();
  cx.strokeStyle = col;
  cx.globalAlpha = alpha;
  cx.lineWidth = width;
  if (dash) { cx.setLineDash(dash); cx.lineDashOffset = offset; }
  cx.beginPath();
  cx.arc(x, y, r, 0, TAU);
  cx.stroke();
  cx.restore();
}

/* ───────────── 持續效果與術式場 ───────────── */
/**
 * 加入一個持續效果。fx: { t 持續秒數, update(dt, fx), draw(cx, fx), end(fx), skill?: 技能名稱, release?(fx) }
 * 技能若寫了 release，再按一次同一個技能鍵就會呼叫它（例如托克馬克提前釋放）。
 */
export function addFx(fx) {
  fx.max ??= fx.t;
  G.tq.push(fx);
  return fx;
}

/**
 * 持續範圍場（次術式場、燃燒地面、璃…）：圓形區域，每 every 秒對場內敵人套用一次 aoe。
 * opts:
 *   x, y, r, t, col       位置、半徑、持續秒數、顏色
 *   follow                true = 場跟著玩家移動
 *   every                 傷害／效果的間隔秒數（預設 0.3）
 *   dmg, tag, kb, fx, burn  每次 aoe 的參數（同 aoe；都不寫就只有 each／tick 的效果）
 *   each(dt, fx)          每幀呼叫（例如讓場內敵人無法移動、對場內所有人施加熔斷）
 *   tick(fx)              每個 every 間隔呼叫一次
 *   draw(cx, fx)          額外繪製
 */
export function field({ x, y, r, t, col, follow = false, every = 0.3, dmg = 0, tag, kb = 0, fx, burn: sec, each, tick, draw }) {
  let acc = 0;
  return addFx({
    t, x, y, r,
    update(dt, f) {
      if (follow) { f.x = G.pl.x; f.y = G.pl.y; }
      each?.(dt, f);
      acc += dt;
      if (acc >= every) {
        acc -= every;
        if (dmg || fx || sec || kb) aoe(f.x, f.y, f.r, dmg, { tag, fx, kb, burn: sec, ult: 0.05 });
        tick?.(f);
      }
    },
    draw(cx, f) {
      const a = Math.min(1, f.t / 0.4);
      cx.save();
      cx.globalAlpha = 0.16 * a;
      cx.fillStyle = col;
      cx.beginPath();
      cx.arc(f.x, f.y, f.r, 0, TAU);
      cx.fill();
      cx.restore();
      strokeRing(cx, f.x, f.y, f.r, col, { alpha: 0.6 * a, width: 2, dash: [8, 8], offset: -G.time * 24 });
      draw?.(cx, f);
    },
  });
}

/**
 * 展開術式場（同一時間只有一個）。opts:
 *   x, y, r, t        位置、半徑、持續秒數
 *   color             外圈顏色
 *   lockSkills        true = 期間無法施放其他技能（塵流懸圖）
 *   noRegen           true = 期間能量不回復
 *   blind             true = 場內敵人看不見玩家（霜雪風域）
 *   confine           true = 施術者不得離開場外（霜雪風域）
 *   onDigit(n, shift) 數字鍵被按下時呼叫（回傳 false = 不處理）
 *   update(dt, fx)    每幀（可用 enemiesIn(fx.x, fx.y, fx.r) 找場內敵人）
 *   draw(cx, fx)      自訂繪製（外圈已經幫你畫好）
 */
export function domain({ x, y, r, t, color = "#ffffff", draw, update, ...rest }) {
  endDomain();
  const f = addFx({
    domain: true, x, y, r, t, color, ...rest,
    update(dt, fx) {
      if (fx.confine) {
        const p = G.pl, d = Math.hypot(p.x - fx.x, p.y - fx.y), lim = fx.r - p.r - 4;
        if (d > lim) { p.x = fx.x + ((p.x - fx.x) / d) * lim; p.y = fx.y + ((p.y - fx.y) / d) * lim; }
      }
      update?.(dt, fx);
    },
    draw(cx, fx) {
      const a = Math.min(1, fx.t / 0.6, (fx.max - fx.t) / 0.3 + 0.2);
      strokeRing(cx, fx.x, fx.y, fx.r, fx.color, { alpha: 0.55 * a, width: 3, dash: [14, 10], offset: -G.time * 30 });
      strokeRing(cx, fx.x, fx.y, fx.r * 0.985, fx.color, { alpha: 0.15 * a, width: 10 });
      draw?.(cx, fx);
    },
  });
  G.dom = f;
  ring(x, y, r, color, 0.6);
  G.shake = Math.max(G.shake, 10);
  return f;
}

export function endDomain() {
  if (!G.dom) return;
  G.dom.t = 0; // 下一次 updateTechniques 會呼叫 end 並移除
  G.dom.dead = true;
  G.dom = null;
}

/** 玩家是否在目前術式場內 */
export const insideDomain = (u) => !!G.dom && Math.hypot(u.x - G.dom.x, u.y - G.dom.y) < G.dom.r;

/* ───────────── 施放 ───────────── */
/** 施放第 i 個技能；回傳是否成功 */
export function castSkill(i) {
  if (fsm.state !== "play") return false;
  const tq = currentTechnique(), sk = tq?.skills[i];
  if (!sk) return false;
  const p = G.pl;
  ensure(p);
  // 再按一次 = 釋放（蓄力類技能）
  const running = G.tq.find((f) => f.skill === sk.name && f.release);
  if (running) { running.release(running); return true; }
  if (G.dom?.lockSkills) return deny("術式場展開中，無法使用其他術式");
  if (isBlocked(p, "skill")) return deny("術式熔斷中，無法施放術式");
  if ((p.cdw[sk.name] ?? 0) > 0) return false;
  const ctx = makeCtx();
  const free = G.train && G.inf;
  const cost = free ? 0 : Math.round((typeof sk.cost === "function" ? sk.cost(ctx) : (sk.cost ?? 0)) * skillCostMultiplier(p));
  if (p.en < cost) return deny("能量不足");
  const hpCost = (sk.hpCost ?? 0) * p.mhp;
  if (hpCost && p.hp <= hpCost) return deny("血量不足以支付代價");
  if (sk.canCast && sk.canCast(ctx) === false) return false;
  p.en -= cost;
  p.cdw[sk.name] = free ? 0 : (sk.cd ?? 0);
  if (hpCost) loseHp(hpCost);
  selfBacklash(sk.backlash ?? 0);
  sk.cast(ctx);
  sync(true);
  return true;
}

/** 展開第 n 個術式場（0 = 大招鍵，1 = E）；回傳是否成功 */
export function castDomain(n) {
  if (fsm.state !== "play") return false;
  const tq = currentTechnique(), d = tq?.domains[n];
  if (!d) return false;
  const p = G.pl;
  ensure(p);
  if (isBlocked(p, "skill")) return deny("術式熔斷中，無法展開術式場");
  if (G.dom) return deny("術式場已經展開");
  const free = G.train && G.inf;
  if (!free && p.ult < 100) return deny("術式場尚未蓄滿（造成傷害來蓄能）");
  const needEn = (d.energyFrac ?? 0) * p.enMax;
  if (!free && p.en < needEn) return deny(`能量不足（需要 ${Math.round(needEn)}）`);
  const hpCost = (d.hpFrac ?? 0) * p.mhp;
  if (hpCost && p.hp <= hpCost) return deny("血量不足以支付代價");
  if (!free) { p.ult = 0; p.en -= needEn; }
  if (hpCost) loseHp(hpCost);
  selfBacklash(d.backlash ?? 0);
  bus.emit(GameEvents.ULTIMATE_USED);
  burst(p.x, p.y, d.color ?? tq.color, 40, 320, 3, 0.7);
  d.cast(makeCtx());
  sync(true);
  return true;
}

/** 輸入層呼叫：技能鍵與第 2 術式場鍵（E）；回傳是否已處理 */
export function techKey(code) {
  const i = SKILL_KEYS.indexOf(code);
  if (i >= 0) return currentTechnique()?.skills[i] ? (castSkill(i), true) : false;
  if (code === "KeyE" && domainCount() > 1) return (castDomain(1), true);
  return false;
}

/** 輸入層呼叫：術式場開著且想接管數字鍵（塵流懸圖的同心圓）時回傳 true */
export function techDigit(n, shift = false) {
  if (!G.dom?.onDigit) return false;
  return G.dom.onDigit(n, shift) !== false;
}

/* ───────────── 敵人視線 ───────────── */
/** 敵人「看不見」玩家時追的假位置：玩家隱身、位於迷失場內、或敵人有 blind 效果；否則回傳 null */
export function blindTarget(e) {
  const hidden = hasStatus(G.pl, "stealth") || hasEnemyFx(e, "blind") || (G.dom?.blind && Math.hypot(e.x - G.dom.x, e.y - G.dom.y) < G.dom.r + e.r);
  if (!hidden) return null;
  if (!(e.blT > G.time)) {
    e.blT = G.time + 0.8;
    const a = Math.random() * TAU, d = 120 + Math.random() * 180;
    e.bx = Math.max(30, Math.min(MW - 30, e.x + Math.cos(a) * d));
    e.by = Math.max(30, Math.min(MW - 30, e.y + Math.sin(a) * d));
  }
  return { x: e.bx, y: e.by };
}

/* ───────────── 每幀 ───────────── */
let uiClock = 0;

export function updateTechniques(dt) {
  const p = G.pl;
  ensure(p);
  for (const k in p.cdw) if (p.cdw[k] > 0) p.cdw[k] = Math.max(0, p.cdw[k] - dt);
  if (G.train && G.inf) p.en = p.enMax;
  else if (p.en > p.enMax) p.en = Math.max(p.enMax, p.en - 6 * dt); // 預支的能量慢慢消退
  else if (!G.dom?.noRegen) p.en = Math.min(p.enMax, p.en + ENERGY_REGEN * dt);
  p.heat = Math.max(0, p.heat - 2 * dt);
  currentTechnique()?.tick?.(p, dt);
  for (let i = G.tq.length - 1; i >= 0; i--) {
    const f = G.tq[i];
    f.t -= dt;
    if (!f.dead && f.t > 0) f.update?.(dt, f);
    if (f.t <= 0 || f.dead) {
      f.end?.(f);
      if (G.dom === f) G.dom = null;
      G.tq.splice(i, 1);
    }
  }
  uiClock -= dt;
  if (uiClock <= 0) sync();
}

/** 繪製持續效果與術式場（world 座標）。render.js 呼叫 */
export function drawTechniques(cx) {
  for (const f of G.tq) f.draw?.(cx, f);
}

/** 新的一局：清掉效果（battle.js 的 setup 呼叫） */
export function resetTechniques() {
  G.tq = [];
  G.dom = null;
  uiClock = 0;
}

/* ───────────── 畫面 ───────────── */
function sync(force = false) {
  uiClock = 0.1;
  const tq = fsm.state === "play" ? currentTechnique() : null;
  const p = G.pl;
  if (!tq) return syncTechniqueUi(null);
  ensure(p);
  const free = G.train && G.inf;
  syncTechniqueUi({
    force,
    weapon: tq.weapon,
    color: tq.color,
    en: p.en, enMax: p.enMax,
    meter: tq.meter ? { name: tq.meter.name, color: tq.meter.color, value: tq.meter.value(p) } : null,
    skills: tq.skills.map((s, i) => ({
      name: s.name, key: SKILL_LABELS[i], desc: s.desc ?? "",
      cd: p.cdw[s.name] ?? 0, cdMax: s.cd ?? 0,
      cost: Math.round((typeof s.cost === "function" ? s.cost(makeCtx()) : (s.cost ?? 0)) * skillCostMultiplier(p)),
      active: G.tq.some((f) => f.skill === s.name),
    })),
    domains: tq.domains.map((d, i) => ({ name: d.name, key: i ? "E" : "空白鍵", ready: free || p.ult >= 100, energyFrac: d.energyFrac ?? 0 })),
    ult: p.ult,
    rings: G.dom?.ringUi ? G.dom.ringUi() : null,
    handlers: { skill: castSkill, domain: castDomain, digit: techDigit },
    domainOn: !!G.dom,
    sealed: isBlocked(p, "skill"),
  });
}
