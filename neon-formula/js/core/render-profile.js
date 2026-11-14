/**
 * core/render-profile — 畫質檔位與渲染設定
 *
 * 把使用者的設定（畫質、解析度、發光、粒子、震動）與「目前自動檔位」合成一份實際生效的數值，
 * 並提供自動降級／升級（quality = auto 時依幀時間調整）。
 *   - 發光（ctx.shadowBlur）是 Canvas 2D 最貴的效果之一：這裡把 shadowBlur 的寫入統一乘上 glow 倍率，
 *     不必改動六十幾處繪圖程式；倍率為 0 時瀏覽器完全不會計算陰影。
 *   - 解析度比例乘進 G.DPR，畫布像素變少但 CSS 大小不變。
 *   - 粒子密度由 burst() 乘上 profile.particles（含自動粒子預算）。
 */
import { G } from "./game-state.js";
import { settings } from "./settings-store.js";

/** 畫質檔位（由低到高） */
export const TIERS = Object.freeze([
  Object.freeze({ id: "low", label: "低", glow: 0, particles: 0.35, scale: 0.7, shake: 0.5, aura: false }),
  Object.freeze({ id: "medium", label: "中", glow: 0.5, particles: 0.65, scale: 0.85, shake: 1, aura: true }),
  Object.freeze({ id: "high", label: "高", glow: 1, particles: 1, scale: 1, shake: 1, aura: true }),
]);

const PARTICLE_DENSITY = Object.freeze({ low: 0.35, normal: 0.8, high: 1 });

/** 實際生效的渲染設定（唯讀快照；refresh() 後會換成新的物件） */
export const profile = { glow: 1, particles: 1, scale: 1, shake: 1, aura: true, tier: 2, tierId: "high" };

let autoTier = 2;
const listeners = new Set();

const tierIndexOf = (id) => TIERS.findIndex((t) => t.id === id);

/** 目前使用的檔位：手動選的，或自動調整中的 */
export function currentTierIndex() {
  const q = settings.get("quality");
  return q === "auto" ? autoTier : tierIndexOf(q);
}

/** 重新計算 profile（設定或平台改變、自動檔位變動後呼叫） */
export function refreshProfile() {
  const ti = currentTierIndex();
  const t = TIERS[ti];
  const density = settings.get("particleDensity");
  const prevScale = profile.scale;
  profile.tier = ti;
  profile.tierId = t.id;
  profile.glow = settings.get("glowEffects") ? t.glow : 0;
  profile.particles = (density === "auto" ? t.particles : PARTICLE_DENSITY[density]) * particleBudget;
  profile.shake = settings.get("screenShake") ? t.shake : 0;
  profile.scale = Math.max(0.4, Math.min(1, settings.get("renderScale") * t.scale));
  profile.aura = t.aura;
  if (profile.scale !== prevScale) for (const fn of listeners) fn(profile);
}

/** 解析度比例改變時呼叫（viewport 據此重設畫布） */
export function onScaleChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * 把 ctx.shadowBlur 改成「寫入時乘上 profile.glow」。
 * 讀取時還原成原本的值，所以 `const b0 = cx.shadowBlur; …; cx.shadowBlur = b0` 這類寫法仍然正確。
 */
export function installGlowControl(ctx) {
  const proto = Object.getPrototypeOf(ctx);
  const desc = proto && Object.getOwnPropertyDescriptor(proto, "shadowBlur");
  if (!desc?.get || !desc?.set) return false;
  let raw = 0;
  Object.defineProperty(ctx, "shadowBlur", {
    configurable: true,
    get() { return profile.glow > 0 ? desc.get.call(this) / profile.glow : raw; },
    set(v) { raw = v; desc.set.call(this, v * profile.glow); },
  });
  return true;
}

/* ───────────── 自動調整 ─────────────
 * 自動畫質「不再」為了效能降低畫質：卡頓時由 SimGovernor（core/sim-governor.js）調整模擬頻率與粒子預算，
 * 畫面品質（發光、解析度、光環）維持在「高」。只有當程式面的手段都用到底、仍然很吃力時，才一次降一檔
 * （degradeAutoTier，由主程式在收到 governor 的「最後手段」通知時呼叫）。
 */

/** 粒子預算（0~1），由 SimGovernor 設定；乘進 profile.particles */
let particleBudget = 1;

export function setParticleBudget(b) {
  const next = Math.max(0.2, Math.min(1, b));
  if (next === particleBudget) return;
  particleBudget = next;
  refreshProfile();
}

/** 最後手段：自動畫質下降一檔（手動指定畫質時不動作）。回傳是否真的降了 */
export function degradeAutoTier() {
  if (settings.get("quality") !== "auto" || autoTier <= 0) return false;
  autoTier--;
  refreshProfile();
  return true;
}

/** 自動檔位的起點：手機、電腦都從「高」開始（畫質優先；吃力時先由 SimGovernor 處理） */
export function initRenderProfile(ctx) {
  autoTier = TIERS.length - 1;
  refreshProfile();
  if (ctx) installGlowControl(ctx);
  settings.addEventListener("change", (e) => {
    if (e.detail.name === "quality" || e.detail.name === null) autoTier = TIERS.length - 1;
    refreshProfile();
  });
}

/** 測試用：讀目前自動檔位 */
export const autoTierIndex = () => autoTier;
export const _setAutoTierForTest = (i) => { autoTier = i; refreshProfile(); };
export { G as _G };
