/**
 * core/render-profile — 畫質檔位與渲染設定
 *
 * 把使用者的設定（畫質、解析度、發光、粒子、震動）與「目前自動檔位」合成一份實際生效的數值，
 * 並提供自動降級／升級（quality = auto 時依幀時間調整）。
 *   - 發光（ctx.shadowBlur）是 Canvas 2D 最貴的效果之一：這裡把 shadowBlur 的寫入統一乘上 glow 倍率，
 *     不必改動六十幾處繪圖程式；倍率為 0 時瀏覽器完全不會計算陰影。
 *   - 解析度比例乘進 G.DPR，畫布像素變少但 CSS 大小不變。
 *   - 粒子密度由 burst() 乘上 profile.particles。
 */
import { G } from "./game-state.js";
import { platform } from "./platform.js";
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
  profile.particles = density === "auto" ? t.particles : PARTICLE_DENSITY[density];
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

/* ───────────── 自動畫質 ───────────── */
const gov = { bestFrame: 1000, slow: 0, fast: 0, cooldown: 0, frameAvg: 16.7, costAvg: 4, blockedUp: 0 };

/**
 * 每個繪製幀回報一次：frameMs = 與上一幀的間隔，costMs = 這一幀繪製花的時間。
 * 只在 quality = auto 時動作。「持續偏慢」才降、「持續有餘裕」才升，且升降之間有冷卻，避免來回震盪。
 */
export function reportFrame(frameMs, costMs, targetMs) {
  if (frameMs > 250) return; // 切分頁、暫停之類的長空檔，不是效能問題
  const k = 1 - Math.exp(-frameMs / 600); // 以時間（約 0.6 秒）為單位的移動平均，慢的時候也能很快收斂
  gov.frameAvg += (frameMs - gov.frameAvg) * k;
  gov.costAvg += (costMs - gov.costAvg) * k;
  gov.bestFrame = Math.min(gov.bestFrame * 1.0005, Math.max(4, frameMs));
  if (settings.get("quality") !== "auto") return;
  const dt = frameMs / 1000;
  gov.cooldown = Math.max(0, gov.cooldown - dt);
  gov.blockedUp = Math.max(0, gov.blockedUp - dt);
  // 預算 = 目標幀時間，但高更新率螢幕（144 Hz 等）要用它的實際幀時間；一直很慢的裝置 bestFrame 也很大，所以取較小者，才抓得到「一直都慢」
  const budget = Math.min(targetMs, Math.max(gov.bestFrame, 6.9));
  const struggling = gov.frameAvg > budget * 1.3 || gov.costAvg > budget * 0.85;
  const comfy = gov.frameAvg < budget * 1.12 && gov.costAvg < budget * 0.4;
  gov.slow = struggling ? gov.slow + dt : Math.max(0, gov.slow - dt * 2);
  gov.fast = comfy ? gov.fast + dt : 0;
  if (gov.slow > 1.5 && gov.cooldown === 0 && autoTier > 0) {
    const severe = gov.frameAvg > budget * 3; // 慘到 3 倍以上：不必等，連降
    autoTier--; gov.slow = 0; gov.cooldown = severe ? 1 : 4; gov.blockedUp = 30; // 剛因為太慢降下來：30 秒內不要再升
    refreshProfile();
  } else if (gov.fast > 10 && gov.cooldown === 0 && gov.blockedUp === 0 && autoTier < TIERS.length - 1) {
    autoTier++; gov.fast = 0; gov.cooldown = 10;
    refreshProfile();
  }
}

/** 自動檔位的起點：手機從「中」開始，電腦從「高」開始 */
export function initRenderProfile(ctx) {
  autoTier = platform.isMobile ? 1 : 2;
  refreshProfile();
  if (ctx) installGlowControl(ctx);
  settings.addEventListener("change", (e) => {
    const n = e.detail.name;
    if (n === "quality" && settings.get("quality") === "auto") autoTier = platform.isMobile ? 1 : 2;
    refreshProfile();
  });
  platform.onChange(() => { if (settings.get("quality") === "auto") { autoTier = platform.isMobile ? 1 : 2; refreshProfile(); } });
}

/** 測試用：讀目前自動檔位 */
export const autoTierIndex = () => autoTier;
export const _setAutoTierForTest = (i) => { autoTier = i; refreshProfile(); };
export { G as _G };
