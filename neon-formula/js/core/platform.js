/**
 * core/platform — 操作平台（電腦／手機）
 *
 * 整個遊戲只問這裡「現在是手機還是電腦」，不再各自猜：
 *   - 設定 controlMode = auto：依裝置判斷（主要指標為手指 → 手機），
 *     之後若偵測到真正的滑鼠移動就切成電腦、偵測到手指觸控就切成手機（觸控螢幕筆電也能正常用）。
 *   - 設定 controlMode = desktop / mobile：固定使用該配置。
 * 平台改變時：更新 <html data-platform>（CSS 依此分版面）、同步 G.touchOn（舊程式沿用）、通知訂閱者
 * （輸入層據此啟用／停用對應的輸入處理，教學與首頁簡圖依此換內容）。
 */
import { G } from "./game-state.js";
import { settings } from "./settings-store.js";

const listeners = new Set();
let current = "desktop";
let detected = "desktop";

const mq = (q) => (typeof matchMedia === "function" ? matchMedia(q) : { matches: false });

/** 依裝置特徵判斷（不看使用者設定） */
export function detectPlatform() {
  const coarse = mq("(pointer:coarse)").matches;
  const canHover = mq("(hover:hover)").matches && mq("(pointer:fine)").matches;
  const touchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;
  return coarse || (touchPoints > 0 && !canHover) ? "mobile" : "desktop";
}

function resolve() {
  const mode = settings.get("controlMode");
  return mode === "auto" ? detected : mode;
}

function apply(next) {
  if (next === current) return;
  current = next;
  G.touchOn = next === "mobile";
  if (document.documentElement.dataset.platform !== next) document.documentElement.dataset.platform = next; // 同值不重設：避免整頁重算樣式
  for (const fn of [...listeners]) {
    try { fn(next); } catch (e) { console.error("platform listener failed", e); }
  }
}

export const platform = {
  /** 目前平台："mobile" | "desktop" */
  get mode() { return current; },
  get isMobile() { return current === "mobile"; },
  /** 平台改變時呼叫（回傳取消訂閱函式） */
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** 自動模式下由輸入層回報「剛剛用了手指／滑鼠」，用來處理觸控螢幕筆電、外接滑鼠的平板 */
  noteInput(kind) {
    if (settings.get("controlMode") !== "auto") return;
    detected = kind === "touch" ? "mobile" : "desktop";
    apply(resolve());
  },
  /** 啟動：判斷一次並掛上設定變更監聽 */
  init() {
    detected = detectPlatform();
    settings.addEventListener("change", (e) => {
      if (e.detail.name === "controlMode" || e.detail.name === null) apply(resolve());
    });
    current = ""; // 強制第一次套用
    apply(resolve());
  },
};
