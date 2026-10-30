/**
 * game/status-effects — 玩家身上的狀態效果（減速、易傷、劇毒…）
 *
 * 想新增一種效果：只要在下面的 STATUS 表加一項，其餘（倒數、HUD 小圖示、角色光環、
 * 速度／受傷倍率）都會自動生效，不必再改 player.js、hud.js、render.js、battle.js。
 *
 * 每一項可以有：
 *   label           顯示名稱
 *   color           HUD 圖示與角色光環的顏色
 *   icon            HUD 圖示（icons.js 有的名稱）
 *   defaultDuration 預設持續秒數（也是 HUD 倒數條的滿格）
 *   maxStacks       最多疊幾層（預設 1）
 *   speedMul(n)     n 層時的移動速度倍率（可省略）
 *   damageTakenMul(n) n 層時的受到傷害倍率（可省略）
 *   damageDealtMul(n, p) 造成傷害的倍率（可省略；p 是玩家，可讀 p.heat 之類的欄位）
 *   skillDamageMul(n, tag) 術式技能傷害倍率（tag 是技能屬性，例如 "water"）
 *   skillCostMul(n)  技能能量消耗倍率（0 = 免費）
 *   backlashMul(n)   術式反噬倍率（0 = 無視反噬）
 *   blocks           ["skill", "attack", "move"]：生效期間禁止施放術式（skill）、禁止普通攻擊（attack）、禁止移動（move）
 *   immuneTo         另一個狀態名稱；玩家身上有那個狀態時，這個狀態施加不上去
 *   onApply(p) / onExpire(p)  從無到有、到期或被解除時各呼叫一次
 *   onTick(p, s, dt, api)  每幀呼叫（s = 狀態 { t 剩餘秒數, n 層數, acc 計時用 }；api.hurt 可扣血）
 *
 * 怎麼施加：
 *   子彈：在 config/bullet-catalog.js 的子彈加 status: { name: "poison", duration: 5, stack: true }
 *   程式：applyStatus(G.pl, "poison", { duration: 5, stack: true })
 *   解除：clearStatus(G.pl, "poison")
 */
import { TAU } from "../core/viewport.js";

export const STATUS = Object.freeze({
  slow: {
    label: "減速", color: "#4de1ff", icon: "slow", defaultDuration: 2.2, maxStacks: 2,
    speedMul: (n) => (n >= 2 ? 0.3 : 0.5),
  },
  vuln: {
    label: "易傷", color: "#ff4d6a", icon: "shard", defaultDuration: 3,
    damageTakenMul: () => 1.15,
  },
  poison: {
    label: "劇毒", color: "#7dff3d", icon: "core", defaultDuration: 5, maxStacks: 3,
    /** 每 0.5 秒扣血，層數越多越痛；用安靜扣血，不會每次都震動閃紅 */
    onTick(p, s, dt, api) {
      s.acc += dt;
      while (s.acc >= 0.5) {
        s.acc -= 0.5;
        api.hurt(1.5 * s.n, { quiet: true });
      }
    },
  },
  fast: {
    label: "加速", color: "#ffb84d", icon: "fast", defaultDuration: 2.2, maxStacks: 2,
    speedMul: (n) => 2,
  },
  burn: {
    label: "灼燒", color: "#ff4d4d", icon: "fire", defaultDuration: 3, maxStacks: 3,
    /** 每 0.5 秒扣血，層數越多越痛；用安靜扣血，不會每次都震動閃紅 */
    onTick(p, s, dt, api) {
      s.acc += dt;
      while (s.acc >= 0.5) {
        s.acc -= 0.5;
        api.hurt(0.7 * s.n, { quiet: true });
      }
    },
    /** 受傷倍率：灼燒時受到的傷害會更痛 */
    damageTakenMul: (n) => 1 + 0.1 * n,
  },
  /* ───── 術式系統（見 techniques.js）使用的狀態 ───── */
  seal: {
    label: "術式熔斷", color: "#ff9a3d", icon: "pull", defaultDuration: 4,
    blocks: ["skill"], immuneTo: "sealImmune",
  },
  soulseal: {
    label: "靈魂熔斷", color: "#c070ff", icon: "slow", defaultDuration: 4,
    blocks: ["skill", "attack", "move"], immuneTo: "sealImmune", speedMul: () => 0,
  },
  sealImmune: { label: "熔斷無效", color: "#9fe8ff", icon: "shield", defaultDuration: 60 },
  heated: {
    label: "升溫", color: "#ff7a3d", icon: "ult", defaultDuration: 8,
    damageDealtMul: (n, p) => 1 + ((p.heat || 0) / 100) * 0.8,
    onTick: (p, s, dt) => { p.heat = Math.min(100, (p.heat || 0) + 12 * dt); },
  },
  guard: { label: "防護", color: "#8fe3cf", icon: "shield", defaultDuration: 3, damageTakenMul: () => 0.5 },
  /** 霜雪風域：域內敵人的攻擊幾乎無效（受到的敵方傷害 ×0.0001）；術式反噬不走 hurt()，所以照常 */
  domainGuard: { label: "風域庇護", color: "#cfe8ff", icon: "shield", defaultDuration: 0.25, damageTakenMul: () => 0.0001 },
  ignoreBacklash: {
    label: "無視反噬", color: "#b6ff9d", icon: "core", defaultDuration: 30, backlashMul: () => 0,
    /** 期間最大生命值略減（-15%），結束後還原 */
    onApply: (p) => { p.mhpBase = p.mhp; p.mhp = Math.round(p.mhp * 0.85); p.hp = Math.min(p.hp, p.mhp); },
    onExpire: (p) => { if (p.mhpBase) { p.mhp = p.mhpBase; p.mhpBase = 0; } },
  },
  /** 時柳：預支能量。期間技能免費，結束時能量耗盡而昏迷（靈魂熔斷 4 秒） */
  borrow: {
    label: "預支", color: "#7ad6ff", icon: "ult", defaultDuration: 10, skillCostMul: () => 0,
    onExpire: (p) => applyStatus(p, "soulseal", { duration: 4 }),
  },
  /** 轉態：術式場內所有水屬性技能傷害 +200%（×3） */
  waterBoost: { label: "轉態", color: "#6ad8ff", icon: "core", defaultDuration: 12, skillDamageMul: (n, tag) => (tag === "water" ? 3 : 1) },
  /** 百花齊放：場內所有人術式反噬 +10% */
  bloom: { label: "花域", color: "#ff9ad0", icon: "heal", defaultDuration: 0.25, backlashMul: () => 1.1 },
  stealth: { label: "隱身", color: "#ff8a3d", icon: "speed", defaultDuration: 8 },
});

const defOf = (name) => {
  const def = STATUS[name];
  if (!def) throw new RangeError(`未知的狀態效果：${String(name)}（可用：${Object.keys(STATUS).join("、")}）`);
  return def;
};

/** 玩家身上的狀態容器（舊存檔、教學關的玩家物件沒有時會自動補上） */
const box = (p) => (p.st ??= {});

/** 現在有沒有這個狀態 */
export const hasStatus = (p, name) => (p.st?.[name]?.t ?? 0) > 0;

/**
 * 施加狀態。持續時間取「現有剩餘」與「這次給的」較長者（不會被短的覆蓋縮短）。
 * @param {object} p 玩家
 * @param {string} name STATUS 裡的名稱
 * @param {{duration?: number, stack?: boolean, stacks?: number}} [opts]
 *   stack: true → 已生效時再疊一層（不超過 maxStacks）；stacks: 直接指定層數
 */
export function applyStatus(p, name, { duration, stack = false, stacks } = {}) {
  const def = defOf(name);
  if (def.immuneTo && hasStatus(p, def.immuneTo)) return; // 例如「熔斷無效」期間施加不上熔斷
  const s = (box(p)[name] ??= { t: 0, n: 0, acc: 0 });
  const active = s.t > 0;
  const want = stacks ?? (stack ? (active ? s.n : 0) + 1 : Math.max(1, active ? s.n : 0));
  s.n = Math.min(def.maxStacks ?? 1, Math.max(1, want));
  s.t = Math.max(active ? s.t : 0, duration ?? def.defaultDuration);
  if (!active) def.onApply?.(p);
}

export function clearStatus(p, name) {
  const s = p.st?.[name];
  if (!s) return;
  const wasActive = s.t > 0;
  s.t = 0; s.n = 0; s.acc = 0;
  if (wasActive) STATUS[name]?.onExpire?.(p);
}

export function clearAllStatuses(p) {
  for (const name of Object.keys(p.st ?? {})) clearStatus(p, name);
}

/** 目前生效中的狀態：[{ name, def, state }]，HUD 與光環用 */
export function activeStatuses(p) {
  return Object.keys(p.st ?? {}).filter((name) => STATUS[name] && p.st[name].t > 0).map((name) => ({ name, def: STATUS[name], state: p.st[name] }));
}

/** 每幀倒數並執行 onTick。api = { hurt }（由 player.js 傳入，避免這個模組反過來依賴戰鬥模組） */
export function tickStatuses(p, dt, api) {
  for (const { def, state } of activeStatuses(p)) {
    state.t -= dt;
    def.onTick?.(p, state, dt, api);
    if (state.t <= 0) { state.t = 0; state.n = 0; state.acc = 0; def.onExpire?.(p); }
  }
}

/** 所有生效狀態的移動速度倍率相乘 */
export const speedMultiplier = (p) => activeStatuses(p).reduce((m, { def, state }) => m * (def.speedMul?.(state.n) ?? 1), 1);

/** 所有生效狀態造成傷害的倍率相乘（射擊、近戰、技能都會套用） */
export const damageDealtMultiplier = (p) => activeStatuses(p).reduce((m, { def, state }) => m * (def.damageDealtMul?.(state.n, p) ?? 1), 1);

/** 術式技能傷害倍率（tag 是技能屬性，例如 "water"） */
export const skillDamageMultiplier = (p, tag) => activeStatuses(p).reduce((m, { def, state }) => m * (def.skillDamageMul?.(state.n, tag) ?? 1), 1);

/** 技能能量消耗倍率 */
export const skillCostMultiplier = (p) => activeStatuses(p).reduce((m, { def, state }) => m * (def.skillCostMul?.(state.n) ?? 1), 1);

/** 術式反噬倍率（0 = 無視反噬） */
export const backlashMultiplier = (p) => activeStatuses(p).reduce((m, { def, state }) => m * (def.backlashMul?.(state.n) ?? 1), 1);

/** 有沒有被某類效果禁止：what = "skill"（施放術式與術式場）、"attack"（普通攻擊）或 "move"（移動） */
export const isBlocked = (p, what) => activeStatuses(p).some(({ def }) => def.blocks?.includes(what));

/** 所有生效狀態的受傷倍率相乘 */
export const damageTakenMultiplier = (p) => activeStatuses(p).reduce((m, { def, state }) => m * (def.damageTakenMul?.(state.n) ?? 1), 1);

/** 在角色身上畫光環（座標原點在角色中心）：每個狀態一圈，疊越多層圈越粗 */
export function drawStatusAuras(cx, p, time) {
  activeStatuses(p).forEach(({ def, state }, i) => {
    cx.save();
    cx.strokeStyle = def.color;
    cx.globalAlpha = 0.45 + 0.25 * Math.sin(time * 7 + i);
    cx.lineWidth = 1 + state.n * 0.6;
    cx.setLineDash([5, 4]);
    cx.lineDashOffset = -time * 20 * (i % 2 ? -1 : 1);
    cx.beginPath();
    cx.arc(0, 0, p.r + 9 + i * 4, 0, TAU);
    cx.stroke();
    cx.restore();
  });
}
