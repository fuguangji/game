/**
 * core/input-desktop — 電腦輸入：鍵盤、滑鼠、滾輪
 *
 *   WASD 移動、滑鼠瞄準、左鍵發動「目前選定」的格子（普通攻擊可按住連射）、Shift 衝刺、空白鍵術式場、
 *   滾輪切換選定格、Z X C V B N 直接施放技能、1–2／Q 換槍。
 * 只在平台是「電腦」時啟用（見 input.js）；切到手機配置時整組監聽一次移除，不會留下殘餘狀態。
 * 暫停（P／Esc）、全螢幕（F）、Enter 開始這類兩個平台共用的快捷鍵放在 input.js。
 */
import { G } from "./game-state.js";
import { fsm } from "./state-machine.js";
import { cv } from "./viewport.js";
import { keys, mouse, shoot, ult } from "../game/battle.js";
import { BAG, slotDown, slotUp, useItem } from "../game/pickups.js";
import { dash } from "../game/player.js";
import { WP } from "../game/weapons.js";
import { castSelected, cycleSlot, skillSelected, techDigit, techKey } from "../game/techniques.js";

let abort = null;

/** 把畫面座標換成世界座標的瞄準角度，順便記下滑鼠位置 */
function aimAtMouse(e) {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.has = true;
  G.pl.aim = Math.atan2(mouse.y / G.S + G.camy - G.pl.y, mouse.x / G.S + G.camx - G.pl.x);
}

export function enableDesktop() {
  if (abort) return;
  abort = new AbortController();
  const { signal } = abort;

  addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) ult();
    } else if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) dash();
    else if (techKey(e.code)) e.preventDefault();
    else if (/^Digit[1-9]$/.test(e.code)) {
      const dn = +e.code[5];
      if (techDigit(dn, e.shiftKey)) return; // 塵流懸圖：數字鍵接管成同心圓控制
      if (dn >= 4 && dn <= 6 && !e.repeat) useItem(BAG()[dn - 4]);
      else if (dn <= WP.length) G.pl.w = dn - 1;
    } else if (e.code === "KeyQ" && !e.repeat) G.pl.w = (G.pl.w + 1) % WP.length;
  }, { signal });

  addEventListener("keyup", (e) => { keys[e.code] = false; }, { signal });

  addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
  }, { signal });

  cv.addEventListener("mousemove", (e) => {
    if (G.drag) { G.drag.x = e.clientX; G.drag.y = e.clientY; }
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.has = true;
  }, { signal });

  cv.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const playing = fsm.state === "play";
    if (playing && slotDown(e.clientX, e.clientY)) return;
    if (playing && skillSelected()) { // 選定的是技能：左鍵按下就發動（不連發，蓄力類技能才能「再按一次釋放」）
      aimAtMouse(e);
      castSelected();
      return;
    }
    mouse.down = true;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.has = true;
    if (playing && !WP[G.pl.w].auto) {
      aimAtMouse(e);
      shoot();
    }
  }, { signal });

  addEventListener("mouseup", (e) => {
    if (e.button === 0) {
      mouse.down = false;
      slotUp(e.clientX, e.clientY);
    }
  }, { signal });

  cv.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });

  addEventListener("wheel", (e) => {
    if (fsm.state !== "play") return;
    if (!cycleSlot(e.deltaY > 0 ? 1 : -1)) G.pl.w = (G.pl.w + (e.deltaY > 0 ? 1 : WP.length - 1)) % WP.length; // 沒有技能的武器：維持切換武器
  }, { passive: true, signal });
}

export function disableDesktop() {
  abort?.abort();
  abort = null;
  for (const k in keys) keys[k] = false;
  mouse.down = false;
  mouse.has = false;
}
