/**
 * core/input-mobile — 手機輸入：虛擬搖桿、瞄準搖桿、按鈕、技能瞄準
 *
 *   左半邊拖曳 = 移動搖桿。右半邊拖曳 = 瞄準搖桿，放開 = 發射。
 *   SUPER／DASH 是畫面上的按鈕（按住拖曳可指定方向）。槍欄在畫面下方，點選換槍、拖曳互換。
 *
 * 技能「先選定、再瞄準、放開才發動」（解決以前點技能格就直接發動的誤觸）：
 *   1. 點右側技能鈕 → 只是「選定」那一格（再點一次取消選定）；
 *   2. 右半邊拖曳瞄準搖桿，畫面上出現技能落點預覽；
 *   3. 放開手指 → 在搖桿死區外放開才施放；把搖桿拖回中心再放開 = 取消，不會施放。
 *   施放成功後預設自動切回普通攻擊（設定「手機：技能施放後自動切回普通攻擊」）；
 *   蓄力類技能（再按一次才釋放）在釋放前保持選定。
 * 只在平台是「手機」時啟用（見 input.js）。
 */
import { GameEvents, bus } from "./event-bus.js";
import { G } from "./game-state.js";
import { fsm } from "./state-machine.js";
import { $, cv } from "./viewport.js";
import { settings } from "./settings-store.js";
import { mouse, shoot, ta, tm, ult } from "../game/battle.js";
import { slotDown, slotUp } from "../game/pickups.js";
import { dash } from "../game/player.js";
import { WP } from "../game/weapons.js";
import { castSelected, isChargingSelected, selectSlot, skillSelected } from "../game/techniques.js";

let abort = null;

/** 瞄準搖桿目前的推動程度：0~1（死區內 = 0） */
const stickPower = () => Math.max(0, Math.min(1, (Math.hypot(ta.x - ta.sx, ta.y - ta.sy) - G.CZ) / (90 * G.HU - G.CZ)));

/** 放開瞄準搖桿：技能 → 死區外才施放；普通攻擊 → 原本的發射邏輯 */
export function releaseAim(isEnd) {
  if (!isEnd || fsm.state !== "play") return;
  const dq = Math.hypot(ta.x - ta.sx, ta.y - ta.sy);
  if (skillSelected()) {
    if (dq <= G.CZ) { bus.emit(GameEvents.SKILL_CANCELLED); return; } // 拖回中心放開 = 取消
    G.pl.aim = ta.a;
    G.pl.q = stickPower();
    const ok = castSelected();
    if (ok && settings.get("skillReturnBasic") && !isChargingSelected()) selectSlot(0);
    return;
  }
  if (dq > G.CZ) {
    if (!WP[G.pl.w].auto || !ta.fired) {
      G.pl.aim = ta.a;
      G.pl.q = stickPower();
      shoot(true);
    }
  } else if (!ta.out && !ta.fired) shoot(true, true);
}

function onTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (G.drag && t.identifier === G.drag.id) slotUp(t.clientX, t.clientY);
    if (t.identifier === tm.id) tm.id = null;
    if (t.identifier === ta.id) {
      releaseAim(e.type === "touchend");
      ta.fired = 0;
      ta.id = null;
      ta.act = false;
    }
  }
}

/** 畫面上圓形按鈕的拖曳手勢：點一下 = 直接觸發；拖出去 = 指定方向，放開才觸發 */
function dragButton(el, slot, onTap, onDrag, signal) {
  let ds = null;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ds = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
    G[slot] = ds;
    try { el.setPointerCapture(e.pointerId); } catch { /* 部分瀏覽器沒有 pointer capture */ }
  }, { signal });
  el.addEventListener("pointermove", (e) => {
    if (!ds || e.pointerId !== ds.id) return;
    ds.x = e.clientX;
    ds.y = e.clientY;
    if (Math.hypot(ds.x - ds.sx, ds.y - ds.sy) > 18 * G.HU) ds.out = 1;
  }, { signal });
  el.addEventListener("pointerup", (e) => {
    if (!ds || e.pointerId !== ds.id) return;
    const dx = ds.x - ds.sx, dy = ds.y - ds.sy, d = Math.hypot(dx, dy), out = ds.out;
    ds = null;
    G[slot] = null;
    if (d > 18 * G.HU) onDrag(Math.atan2(dy, dx), d);
    else if (!out) onTap();
  }, { signal });
  el.addEventListener("pointercancel", () => { ds = null; G[slot] = null; }, { signal });
}

export function enableMobile() {
  if (abort) return;
  abort = new AbortController();
  const { signal } = abort;
  mouse.has = false;
  mouse.down = false;

  cv.addEventListener("touchstart", (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      if (fsm.state === "play" && slotDown(x, y, t.identifier)) continue;
      if (x < G.W / 2) {
        if (tm.id === null) Object.assign(tm, { id: t.identifier, sx: x, sy: y, x, y });
      } else if (ta.id === null) {
        Object.assign(ta, { id: t.identifier, sx: x, sy: y, x, y, act: true, out: 0, fired: 0, t0: performance.now(), a: G.pl ? G.pl.aim : 0 });
      }
    }
  }, { passive: false, signal });

  cv.addEventListener("touchmove", (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (G.drag && t.identifier === G.drag.id) { G.drag.x = t.clientX; G.drag.y = t.clientY; }
      if (t.identifier === tm.id) { tm.x = t.clientX; tm.y = t.clientY; }
      if (t.identifier === ta.id) {
        ta.x = t.clientX;
        ta.y = t.clientY;
        const dx = ta.x - ta.sx, dy = ta.y - ta.sy;
        if (Math.hypot(dx, dy) > 8 * G.HU) ta.a = Math.atan2(dy, dx);
        if (Math.hypot(dx, dy) > G.CZ) ta.out = 1;
      }
    }
  }, { passive: false, signal });

  cv.addEventListener("touchend", onTouchEnd, { passive: false, signal });
  cv.addEventListener("touchcancel", onTouchEnd, { passive: false, signal });

  dragButton($("bS"), "sd", () => ult(), (a, d) => ult(a, Math.min(1, d / (90 * G.HU))), signal);
  dragButton($("bD"), "dd", () => dash(), (a) => dash(a), signal);
  $("bW").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    G.pl.w = (G.pl.w + 1) % WP.length;
  }, { signal });

  $("bS").classList.add("on");
  $("bD").classList.add("on");
}

export function disableMobile() {
  abort?.abort();
  abort = null;
  tm.id = null;
  ta.id = null;
  ta.act = false;
  G.sd = null;
  G.dd = null;
  G.drag = null;
  $("bS").classList.remove("on");
  $("bD").classList.remove("on");
}
