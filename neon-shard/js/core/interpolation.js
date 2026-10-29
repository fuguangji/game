/**
 * core/interpolation — 動態補償（渲染插值）
 *
 * 模擬以固定頻率（預設 60 Hz）前進，繪製則依螢幕更新率（60／90／120／144 Hz…）。
 * 兩者不同步時，直接畫「最新一次模擬的結果」會看起來一頓一頓。這裡的做法：
 *   1. 每次模擬前（snapshot）記下所有會移動的物件「上一個狀態」的位置；
 *   2. 繪製前（apply）把位置暫時換成「上一個狀態 → 目前狀態」之間的插值（alpha = 距離下次模擬還有多遠）；
 *   3. 繪製後（restore）立刻還原，模擬看到的永遠是真實位置，插值不會污染遊戲邏輯。
 * 代價是畫面比模擬晚最多一個模擬步長（60 Hz 時 ≤ 16.7 ms）；換來在任何更新率下都平順。
 *
 * 瞬移（衝刺落點、傳送門、擊退暴衝）不能插值——一步位移超過 JUMP 像素就直接用新位置。
 * 新生成的物件還沒有上一個狀態，第一幀也直接用目前位置。
 */
import { G } from "./game-state.js";

const JUMP = 160;
const JUMP2 = JUMP * JUMP;

/** 暫存被改寫的物件與原座標（重複使用，避免每幀配置記憶體） */
const refs = [];
const savedX = [];
const savedY = [];
let used = 0;
let savedCamX = 0;
let savedCamY = 0;
let savedTime = 0;
let active = false;

function mark(list) {
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    e._ix = e.x;
    e._iy = e.y;
  }
}

/** 每次模擬「之前」呼叫：把目前位置記成上一個狀態 */
export function snapshot() {
  if (G.pl) { G.pl._ix = G.pl.x; G.pl._iy = G.pl.y; }
  if (G.en) mark(G.en);
  if (G.bl) mark(G.bl);
  if (G.pt) mark(G.pt);
  G.camPx = G.camx;
  G.camPy = G.camy;
}

function lerpList(list, alpha) {
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e._ix === undefined) continue;
    const dx = e.x - e._ix, dy = e.y - e._iy;
    if ((dx === 0 && dy === 0) || dx * dx + dy * dy > JUMP2) continue;
    refs[used] = e; savedX[used] = e.x; savedY[used] = e.y; used++;
    e.x = e._ix + dx * alpha;
    e.y = e._iy + dy * alpha;
  }
}

/**
 * 繪製「之前」呼叫。alpha ∈ [0,1)；stepSeconds 是一個模擬步長（用來把動畫時鐘也推進到畫面時間）。
 * 沒有可插值的狀態時什麼都不做。必須與 restore() 成對使用。
 */
export function apply(alpha, stepSeconds) {
  if (active) restore();
  if (!(alpha > 0 && alpha < 1) || !G.pl || G.camPx === undefined) return;
  active = true;
  used = 0;
  lerpList([G.pl], alpha);
  lerpList(G.en, alpha);
  lerpList(G.bl, alpha);
  lerpList(G.pt, alpha);
  savedCamX = G.camx; savedCamY = G.camy;
  const cdx = G.camx - G.camPx, cdy = G.camy - G.camPy;
  if (cdx * cdx + cdy * cdy <= JUMP2) { // 鏡頭瞬移（重新開局）時不插值
    G.camx = G.camPx + cdx * alpha;
    G.camy = G.camPy + cdy * alpha;
  }
  savedTime = G.time;
  G.time += alpha * stepSeconds; // 脈動、閃爍等動畫用 G.time：也推進到「畫面時間」，低模擬頻率下才不會卡頓
}

/** 繪製「之後」呼叫（放在 finally 裡）：把所有座標換回真實值 */
export function restore() {
  if (!active) return;
  for (let i = 0; i < used; i++) {
    refs[i].x = savedX[i];
    refs[i].y = savedY[i];
    refs[i] = undefined;
  }
  used = 0;
  G.camx = savedCamX; G.camy = savedCamY;
  G.time = savedTime;
  active = false;
}

/** 讓下一次繪製不插值（切換場景、重新開局、鏡頭瞬移後呼叫） */
export function resetInterpolation() {
  restore();
  G.camPx = undefined;
  G.camPy = undefined;
}
