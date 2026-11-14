/** game/pathfinding — 路徑場與敵人尋路 */
import { FlowFieldService } from "../core/flow-field.js";
import { G } from "../core/game-state.js";
import { N, T } from "../core/viewport.js";
import { ray } from "./battle.js";

let D4, D8, fdW, wideC; // 初始化在 init()
// 廣度優先搜尋，產生「到玩家的步數」路徑場（w=1 時要求寬通道）
// 佇列用事先配置好的 Int32Array（原本每次都 new 一個會長大的陣列，並且每格都解構 [dx, dy]）；結果與原版完全相同
let bfsQueue = null;
export function bfs(F, w) {
  F.fill(-1);
  if (!bfsQueue || bfsQueue.length < N * N) bfsQueue = new Int32Array(N * N);
  const q = bfsQueue,
    grid = G.grid,
    s0 = Math.floor(G.pl.x / T) + Math.floor(G.pl.y / T) * N;
  let head = 0,
    tail = 0;
  q[tail++] = s0;
  F[s0] = 0;
  while (head < tail) {
    const c = q[head++],
      i = c % N,
      j = (c / N) | 0,
      next = F[c] + 1;
    for (let k = 0; k < 4; k++) {
      const x = i + BFS_DX[k],
        y = j + BFS_DY[k];
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const n = x + y * N;
      if (F[n] >= 0 || grid[n] !== 0) continue;
      if (w && !wideC(x, y)) continue;
      F[n] = next;
      q[tail++] = n;
    }
  }
}
const BFS_DX = [1, -1, 0, 0],
  BFS_DY = [0, 0, 1, -1];
/** 路徑場計算服務（Worker 非同步，失敗時退回主執行緒） */
let flowService; // 初始化在 init()
// 更新路徑場
export function flow() {
  flowService.request(
    { grid: G.grid, n: N, sx: Math.floor(G.pl.x / T), sy: Math.floor(G.pl.y / T) },
    G.fd,
    fdW,
    () => {
      bfs(G.fd, 0);
      bfs(fdW, 1);
    },
  );
}
// 視線：從敵人 e 到 (x, y) 之間沒有牆（敵人身體寬度的左中右三條射線都要通）。提到函式外，避免每次呼叫 nav 都建立一個新的函式物件
function vis(e, x, y) {
  const L = Math.hypot(x - e.x, y - e.y);
  if (L < 4) return true;
  const b = Math.atan2(y - e.y, x - e.x),
    px = -Math.sin(b) * e.r * 0.8,
    py = Math.cos(b) * e.r * 0.8;
  return (
    ray(e.x, e.y, b, L) >= L - 4 &&
    ray(e.x + px, e.y + py, b, L) >= L - 4 &&
    ray(e.x - px, e.y - py, b, L) >= L - 4
  );
}
// 敵人尋路：有視線直接追，否則沿路徑場下降方向走
export function nav(e, a, d) {
  if (vis(e, G.pl.x, G.pl.y)) return a;
  let F = e.r >= 15 ? fdW : G.fd,
    ci = Math.floor(e.x / T),
    cj = Math.floor(e.y / T);
  if (F[ci + cj * N] < 0) F = G.fd;
  if (F[ci + cj * N] < 0) return a;
  let fx = null,
    fy = null,
    tx = null,
    ty = null;
  for (let s = 0; s < 8; s++) {
    let best = F[ci + cj * N],
      ni = -1,
      nj = -1;
    for (const [dx, dy] of D8) {
      const x = ci + dx,
        y = cj + dy;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const n = x + y * N;
      if (F[n] < 0 || F[n] >= best) continue;
      if (
        dx &&
        dy &&
        (G.grid[ci + dx + cj * N] !== 0 || G.grid[ci + (cj + dy) * N] !== 0)
      )
        continue;
      best = F[n];
      ni = x;
      nj = y;
    }
    if (ni < 0) break;
    ci = ni;
    cj = nj;
    const wx = (ci + 0.5) * T,
      wy = (cj + 0.5) * T;
    if (fx === null) {
      fx = wx;
      fy = wy;
    }
    if (vis(e, wx, wy)) {
      tx = wx;
      ty = wy;
    } else if (tx !== null) break;
    if (F[ci + cj * N] === 0) break;
  }
  if (tx === null) {
    tx = fx;
    ty = fy;
  }
  if (tx === null) return a;
  return Math.atan2(ty - e.y, tx - e.x);
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {
D4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
D8 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
fdW = new Int16Array(N * N);
wideC = (x, y) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const a = x + dx,
          b = y + dy;
        if (a < 0 || b < 0 || a >= N || b >= N || G.grid[a + b * N] !== 0)
          return false;
      }
    return true;
  };
flowService = new FlowFieldService();
}

