/**
 * ui/perf-overlay — 效能資訊（設定「顯示效能資訊」）
 * 左上角一個小方塊：繪製幀率、模擬頻率、單幀繪製／模擬耗時、目前畫質檔位與解析度比例。
 * 只在開啟時才建立與更新（每 0.5 秒一次），關閉時完全沒有成本。
 */
import { profile } from "../core/render-profile.js";
import { settings } from "../core/settings-store.js";

let el = null;
let lastUpdate = 0;

/** 每個繪製幀呼叫一次；沒開啟時只讀一個設定就返回 */
export function updatePerfOverlay(stats, now) {
  if (!settings.get("showFps")) {
    if (el) { el.remove(); el = null; }
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;z-index:40;left:max(6px,env(safe-area-inset-left));top:calc(max(6px,env(safe-area-inset-top)) + 4px);padding:4px 7px;border-radius:6px;background:#000000b3;color:#9dffb4;font:11px/1.35 ui-monospace,monospace;white-space:pre;pointer-events:none";
    document.body.append(el);
  }
  if (now - lastUpdate < 500) return;
  lastUpdate = now;
  el.textContent = `${stats.fps} FPS · 模擬 ${stats.sps} Hz\n繪製 ${stats.drawMs.toFixed(1)} ms · 模擬 ${stats.stepMs.toFixed(2)} ms\n畫質 ${profile.tierId} · 解析度 ×${profile.scale.toFixed(2)}`;
}
