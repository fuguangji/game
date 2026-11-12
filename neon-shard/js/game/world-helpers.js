/** game/world-helpers — 地圖格子、碰撞、射線、移動、粒子與掉落等世界基礎工具 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { profile } from "../core/render-profile.js";
import { MW, N, T, TAU } from "../core/viewport.js";
import { PN } from "../game-config.js";
import { coin, cur, jit } from "./pickups.js";
import { ST, SV } from "./progress.js";
import { breakTile, placeTiles } from "./tiles.js";

// 功能：讀取地圖格；超出地圖邊界時視為不可通行。
export const cell = (i, j) =>
  i < 0 || j < 0 || i >= N || j >= N ? -1 : G.grid[j * N + i];

// 功能：判斷指定座標是否落在實心地圖格。
export const solidAt = (x, y) => cell(Math.floor(x / T), Math.floor(y / T)) !== 0;

// 功能：以角色碰撞半徑檢查四角是否被地形阻擋。
export const blocked = (x, y, r) =>
  solidAt(x - r, y - r) ||
  solidAt(x + r, y - r) ||
  solidAt(x - r, y + r) ||
  solidAt(x + r, y + r);

// 功能：處理「turLand」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function turLand(x, y, r, m) {
  m = m || 20;
  x = Math.max(m, Math.min(MW - m, x));
  y = Math.max(m, Math.min(MW - m, y));
  if (!blocked(x, y, r)) return [x, y];
  for (let d = 8; d <= 160; d += 8)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU,
        nx = Math.max(m, Math.min(MW - m, x + Math.cos(a) * d)),
        ny = Math.max(m, Math.min(MW - m, y + Math.sin(a) * d));
      if (!blocked(nx, ny, r)) return [nx, ny];
    }
  return [x, y];
}

// 功能：處理「mv」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function mv(e, dx, dy) {
  if (e.root > 0 && !G.MVF) return true;
  let b = false;
  if (!blocked(e.x + dx, e.y, e.r)) e.x += dx;
  else b = true;
  if (!blocked(e.x, e.y + dy, e.r)) e.y += dy;
  else b = true;
  return b;
}

// 功能：處理「ray」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ray(x, y, a, m) {
  let l = 0;
  const c = Math.cos(a),
    s = Math.sin(a);
  while (l < m && !solidAt(x + c * l, y + s * l)) l += 8;
  return l;
}

// 功能：將敵人索引轉換為對應色相的 HSLA 顏色字串。
export const hc = (v, a) => `hsla(${150 + (v - 1) * 15},48%,46%,${a})`;

// 隨機產生地圖：外框不可破、中央安全區、其餘依關卡密度放可破壞牆
export function genMap() {
  G.grid = new Int8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (i == 0 || j == 0 || i == N - 1 || j == N - 1) v = -1;
      else if (Math.max(Math.abs(i - 22), Math.abs(j - 22)) > 5) {
        const r = Math.random();
        v = r < 0.035 ? -1 : r < 0.035 + ST().dn ? 6 : 0;
      }
      G.grid[j * N + i] = v;
    }
  openSealedPockets();
  placeTiles(ST(), SV.sel); // 特殊方塊圖層（見 tiles.js）
}

/**
 * 從出生點洪水填色：被「打不破的外牆」整圈封住、走不進去的空地，一律補成可打破的牆。
 * 否則敵人、補給可能刷在玩家永遠到不了的孤島裡（波次打不完、掉落物拿不到）。
 */
function openSealedPockets() {
  const seen = new Uint8Array(N * N), stack = [22 * N + 22];
  seen[22 * N + 22] = 1;
  while (stack.length) {
    const idx = stack.pop(), i = idx % N, j = (idx - i) / N;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni;
      if (seen[n] || G.grid[n] === -1) continue; // 可打破的牆算「走得進去」
      seen[n] = 1;
      stack.push(n);
    }
  }
  for (let k = 0; k < N * N; k++) if (G.grid[k] === 0 && !seen[k]) G.grid[k] = 6;
}

// 功能：尋找符合距離條件且未被障礙物阻擋的位置。
export function empty(minD, ref, maxD) {
  for (let k = 0; k < 400; k++) {
    const i = (1 + Math.random() * (N - 2)) | 0,
      j = (1 + Math.random() * (N - 2)) | 0;
    if (G.grid[j * N + i] === 0) {
      const x = (i + 0.5) * T,
        y = (j + 0.5) * T,
        dd = ref ? Math.hypot(x - ref.x, y - ref.y) : 0;
      if (!ref || (dd >= minD && (!maxD || dd <= maxD))) return { x, y };
    }
  }
  return maxD ? empty(minD, ref) : null;
}

/** 原地保留符合條件的元素（陣列本身不變、不產生新陣列；取代每步都配置新陣列的 filter） */
export function compactInPlace(arr, keep) {
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const v = arr[r];
    if (keep(v)) arr[w++] = v;
  }
  arr.length = w;
  return arr;
}

/* ───────────── 粒子（物件池）─────────────
 * 戰鬥中每秒會產生與回收數百個粒子；每個都 new 一個物件會讓垃圾回收在戰鬥中途卡一下。
 * 這裡把「死掉的粒子」收回池子，下次 burst() 直接重複使用。
 * 注意：從池子拿出來的物件必須把所有欄位重設（包含插值用的 _ix/_iy，否則第一幀會從舊位置拖出一條線）。
 */
const PARTICLE_POOL = [];
const PARTICLE_POOL_MAX = 1024;
/** 粒子總數上限（完整預算時）；實際上限會隨粒子預算縮小 */
export const PARTICLE_CAP = 700;

/** 目前允許的粒子總數上限（跟著畫質檔與自動粒子預算縮放，最少留 40%） */
export function particleCap() {
  return Math.round(PARTICLE_CAP * Math.max(0.4, Math.min(1, profile.particles)));
}

/** 回收一個粒子（只在確定沒有別處還持有它時呼叫） */
export function releaseParticle(p) {
  if (PARTICLE_POOL.length < PARTICLE_POOL_MAX) PARTICLE_POOL.push(p);
}

function acquireParticle(x, y, vx, vy, life, max, col, sz) {
  const p = PARTICLE_POOL.pop();
  if (!p) return { x, y, vx, vy, life, max, col, sz, age: 0, k: undefined, f: undefined, rot: 0, vr: 0, seed: 0, _ix: undefined, _iy: undefined };
  p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = max; p.col = col; p.sz = sz;
  p.age = 0; p.k = undefined; p.f = undefined; p.rot = 0; p.vr = 0; p.seed = 0; p._ix = undefined; p._iy = undefined;
  return p;
}

// 功能：在指定位置建立粒子爆發特效。
export function burst(x, y, col, n, sp, sz, life) {
  const count = n * profile.particles; // 粒子密度（畫質設定 × 自動粒子預算）
  const cap = particleCap();
  const pt = G.pt;
  for (let i = 0; i < count && pt.length < cap; i++) {
    const a = Math.random() * TAU,
      s = sp * (0.3 + Math.random() * 0.7);
    pt.push(acquireParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.4), life, col, sz * (0.6 + Math.random() * 0.8)));
  }
}

// 功能：建立指定掉落物。
export function drop(x, y, p) {
  if (Math.random() < p && G.pk.filter((q) => PN.includes(q.t)).length < 12)
    G.pk.push({
      ...jit(x, y),
      t: PN[[0, 0, 0, 1, 1, 1, 2, 2, 3, 3][(Math.random() * 10) | 0]],
      life: 18,
    });
}

// 子彈/爆炸命中方塊：扣血、碎裂與掉落
export function hitCell(i, j, n = 1) {
  const v = cell(i, j);
  if (v <= 0) return;
  const nv = Math.max(0, v - n);
  G.grid[j * N + i] = nv;
  const x = (i + 0.5) * T,
    y = (j + 0.5) * T,
    col = hc(v, 1);
  if (nv === 0) {
    bus.emit(GameEvents.WALL_BROKEN);
    breakTile(i, j, x, y, { zones: G.zones }); // 特殊方塊的 onBreak（見 tiles.js）
    for (let k = 0; k < 9 && G.pt.length < PARTICLE_CAP; k++) { // 碎片也受上限約束
      const a = Math.random() * TAU,
        s = 80 + Math.random() * 180;
      G.pt.push({
        x: x + (Math.random() - 0.5) * T * 0.6,
        y: y + (Math.random() - 0.5) * T * 0.6,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.8,
        max: 0.8,
        col,
        sz: 4 + Math.random() * 6,
        f: 1,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
    burst(x, y, col, 10, 180, 2.5, 0.5);
    drop(x, y, 0.1);
    if (Math.random() < 0.15) coin(x, y, 1);
    if (Math.random() < 0.3) cur("shard", x, y, 1);
    G.score += 5;
    G.pts += 2;
    G.shake = Math.max(G.shake, 3);
  } else burst(x, y, col, 5, 120, 2, 0.35);
}
