/**
 * core/input — 輸入分派
 *
 * 電腦與手機的輸入完全分開：
 *   input-desktop.js  鍵盤、滑鼠、滾輪
 *   input-mobile.js   觸控搖桿、按鈕、技能瞄準
 * 這裡只做三件事：
 *   1. 依 platform（見 platform.js）啟用其中一組、停用另一組；
 *   2. 兩個平台共用的快捷鍵（暫停、全螢幕、Enter 開始）與全螢幕按鈕；
 *   3. 「自動」模式下回報剛剛用了手指或滑鼠，讓觸控螢幕筆電、外接滑鼠的平板切得對。
 */
import { G } from "./game-state.js";
import { fsm } from "./state-machine.js";
import { $ } from "./viewport.js";
import { platform } from "./platform.js";
import { settings } from "./settings-store.js";
import { togglePause } from "../game/progress.js";
import { start } from "../ui/render.js";
import { disableDesktop, enableDesktop } from "./input-desktop.js";
import { disableMobile, enableMobile } from "./input-mobile.js";

export let fsB, fsOK; // 初始化在 init()

// 功能：切換全螢幕（瀏覽器不支援時什麼都不做）。
export function toggleFS() {
  if (!fsOK) return;
  const d = document,
    r = d.documentElement;
  try {
    let p;
    if (d.fullscreenElement || d.webkitFullscreenElement)
      p = (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else p = (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}

function useInputFor(mode) {
  if (mode === "mobile") { disableDesktop(); enableMobile(); }
  else { disableMobile(); enableDesktop(); }
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {
  fsB = $("fs");
  fsOK = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (!fsOK) fsB.style.display = "none";
  fsB.onclick = toggleFS;

  // 共用快捷鍵：暫停、全螢幕、Enter 開始（外接鍵盤的手機也能用）
  addEventListener("keydown", (e) => {
    if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat) togglePause();
    else if (e.code === "KeyF" && !e.repeat) toggleFS();
    else if (
      e.code === "Enter" &&
      fsm.state !== "play" &&
      !$("ov").classList.contains("h") &&
      !(e.target instanceof Element && e.target.closest("input, textarea, select, button, form, [contenteditable='true']"))
    ) start();
  });

  // 自動偵測只在「控制模式 = 自動」時需要，而且只聽「另一種」輸入：
  //   目前是電腦 → 只聽手指觸控（觸控螢幕筆電）；目前是手機 → 只聽真正的滑鼠移動（外接滑鼠的平板）。
  // 控制模式固定為電腦或手機後，這組監聽整個拆掉。
  let detectAbort = null;
  let lastTouchAt = 0;
  const syncDetect = () => {
    detectAbort?.abort();
    detectAbort = null;
    if (settings.get("controlMode") !== "auto") return;
    detectAbort = new AbortController();
    const opts = { passive: true, capture: true, signal: detectAbort.signal };
    if (platform.mode === "mobile") {
      // 觸控後 1 秒內的滑鼠事件是瀏覽器模擬的，不算；偵測到真滑鼠後就會切成電腦並重新掛載
      addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") lastTouchAt = performance.now(); }, opts);
      addEventListener("pointermove", (e) => {
        if (e.pointerType === "mouse" && performance.now() - lastTouchAt > 1000) platform.noteInput("mouse");
      }, opts);
    } else {
      addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") platform.noteInput("touch"); }, opts);
    }
  };
  settings.addEventListener("change", (e) => { if (e.detail.name === "controlMode" || e.detail.name === null) syncDetect(); });

  platform.onChange((mode) => { useInputFor(mode); syncDetect(); });
  useInputFor(platform.mode);
  syncDetect();
}
