/** core/input — 鍵盤、滑鼠、觸控輸入 */
import { G } from "./game-state.js";
import { fsm } from "./state-machine.js";
import { $, cv } from "./viewport.js";
import { keys, mouse, shoot, ta, tm, ult } from "../game/battle.js";
import { BAG, slotDown, slotUp, useItem } from "../game/pickups.js";
import { dash } from "../game/player.js";
import { togglePause } from "../game/progress.js";
import { WP } from "../game/weapons.js";
import { start } from "../ui/render.js";
import { techDigit, techKey } from "../game/techniques.js";

export let fsB, fsOK; // 初始化在 init()
// 功能：處理「toggleFS」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
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
// 功能：處理「setTouch」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function setTouch() {
  if (!G.touchOn) {
    G.touchOn = true;
    $("bS").classList.add("on");
    $("bD").classList.add("on");
    $("bW").classList.add("on");
  }
}
// 功能：處理「tend」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const tend = (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (G.drag && t.identifier === G.drag.id) slotUp(t.clientX, t.clientY);
    if (t.identifier === tm.id) tm.id = null;
    if (t.identifier === ta.id) {
      if (e.type === "touchend" && fsm.state === "play") {
        const dq = Math.hypot(ta.x - ta.sx, ta.y - ta.sy);
        if (dq > G.CZ) {
          if (!WP[G.pl.w].auto || !ta.fired) {
            G.pl.aim = ta.a;
            G.pl.q = Math.max(0, Math.min(1, (dq - G.CZ) / (90 * G.HU - G.CZ)));
            shoot(true);
          }
        } else if (!ta.out && !ta.fired) shoot(true, true);
      }
      ta.fired = 0;
      ta.id = null;
      ta.act = false;
    }
  }
};

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {
fsB = $("fs");
fsOK = document.fullscreenEnabled || document.webkitFullscreenEnabled;

if (!fsOK) fsB.style.display = "none";

fsB.onclick = toggleFS;

addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) ult();
  } else if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat)
    dash();
  else if (techKey(e.code)) e.preventDefault();
  else if (/^Digit[1-9]$/.test(e.code)) {
    const dn = +e.code[5];
    if (techDigit(dn, e.shiftKey)) return; // 塵流懸圖：數字鍵接管成同心圓控制
    if (dn >= 4 && dn <= 6 && !e.repeat) useItem(BAG()[dn - 4]);
    else if (dn <= WP.length) G.pl.w = dn - 1;
  } else if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat)
    togglePause();
  else if (e.code === "KeyQ" && !e.repeat) G.pl.w = (G.pl.w + 1) % WP.length;
  else if (e.code === "KeyF" && !e.repeat) toggleFS();
  else if (
    e.code === "Enter" &&
    fsm.state !== "play" &&
    !$("ov").classList.contains("h") &&
    !(e.target instanceof Element && e.target.closest("input, textarea, select, button, form, [contenteditable='true']"))
  )
    start();
});

addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
  mouse.down = false;
});

cv.addEventListener("mousemove", (e) => {
  if (G.drag) {
    G.drag.x = e.clientX;
    G.drag.y = e.clientY;
  }
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.has = true;
});

cv.addEventListener("mousedown", (e) => {
  if (e.button === 0 && fsm.state === "play" && slotDown(e.clientX, e.clientY))
    return;
  if (e.button === 0) {
    mouse.down = true;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.has = true;
    if (fsm.state === "play" && !WP[G.pl.w].auto) {
      G.pl.aim = Math.atan2(mouse.y / G.S + G.camy - G.pl.y, mouse.x / G.S + G.camx - G.pl.x);
      shoot();
    }
  }
});

addEventListener("mouseup", (e) => {
  if (e.button === 0) {
    mouse.down = false;
    slotUp(e.clientX, e.clientY);
  }
});

cv.addEventListener("contextmenu", (e) => e.preventDefault());

cv.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    setTouch();
    for (const t of e.changedTouches) {
      const x = t.clientX,
        y = t.clientY;
      if (fsm.state === "play" && slotDown(x, y, t.identifier)) continue;
      if (x < G.W / 2) {
        if (tm.id === null)
          Object.assign(tm, { id: t.identifier, sx: x, sy: y, x, y });
      } else if (ta.id === null) {
        Object.assign(ta, {
          id: t.identifier,
          sx: x,
          sy: y,
          x,
          y,
          act: true,
          out: 0,
          fired: 0,
          t0: performance.now(),
          a: G.pl ? G.pl.aim : 0,
        });
      }
    }
  },
  { passive: false },
);

cv.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (G.drag && t.identifier === G.drag.id) {
        G.drag.x = t.clientX;
        G.drag.y = t.clientY;
      }
      if (t.identifier === tm.id) {
        tm.x = t.clientX;
        tm.y = t.clientY;
      }
      if (t.identifier === ta.id) {
        ta.x = t.clientX;
        ta.y = t.clientY;
        const dx = ta.x - ta.sx,
          dy = ta.y - ta.sy;
        if (Math.hypot(dx, dy) > 8 * G.HU) ta.a = Math.atan2(dy, dx);
        if (Math.hypot(dx, dy) > G.CZ) ta.out = 1;
      }
    }
  },
  { passive: false },
);

cv.addEventListener("touchend", tend, { passive: false });

cv.addEventListener("touchcancel", tend, { passive: false });

{
  const b = $("bS");
  let ds = null;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setTouch();
    ds = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
    G.sd = ds;
    try {
      b.setPointerCapture(e.pointerId);
    } catch (_) {}
  });
  b.addEventListener("pointermove", (e) => {
    if (ds && e.pointerId === ds.id) {
      ds.x = e.clientX;
      ds.y = e.clientY;
      if (Math.hypot(ds.x - ds.sx, ds.y - ds.sy) > 18 * G.HU) ds.out = 1;
    }
  });
  b.addEventListener("pointerup", (e) => {
    if (!ds || e.pointerId !== ds.id) return;
    const dx = ds.x - ds.sx,
      dy = ds.y - ds.sy,
      d = Math.hypot(dx, dy),
      out = ds.out;
    ds = null;
    G.sd = null;
    if (d > 18 * G.HU) ult(Math.atan2(dy, dx), Math.min(1, d / (90 * G.HU)));
    else if (!out) ult();
  });
  b.addEventListener("pointercancel", () => {
    ds = null;
    G.sd = null;
  });
}

{
  const b = $("bD");
  let ds = null;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setTouch();
    ds = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
    };
    G.dd = ds;
    b.setPointerCapture(e.pointerId);
  });
  b.addEventListener("pointermove", (e) => {
    if (ds && e.pointerId === ds.id) {
      ds.x = e.clientX;
      ds.y = e.clientY;
      if (Math.hypot(ds.x - ds.sx, ds.y - ds.sy) > 18 * G.HU) ds.out = 1;
    }
  });
  b.addEventListener("pointerup", (e) => {
    if (!ds || e.pointerId !== ds.id) return;
    const dx = ds.x - ds.sx,
      dy = ds.y - ds.sy,
      out = ds.out;
    ds = null;
    G.dd = null;
    if (Math.hypot(dx, dy) > 18 * G.HU) dash(Math.atan2(dy, dx));
    else if (!out) dash();
  });
  b.addEventListener("pointercancel", () => {
    ds = null;
    G.dd = null;
  });
}

$("bW").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  setTouch();
  G.pl.w = (G.pl.w + 1) % WP.length;
});

addEventListener(
  "wheel",
  (e) => {
    if (fsm.state === "play")
      G.pl.w = (G.pl.w + (e.deltaY > 0 ? 1 : WP.length - 1)) % WP.length;
  },
  { passive: true },
);

$("bS").classList.add("on");

$("bD").classList.add("on");

if (matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints > 0)
  setTouch();
}

