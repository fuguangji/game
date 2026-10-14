/**
 * 路徑場服務：把「到玩家的步數」BFS 放到 Web Worker 計算，
 * 主執行緒只負責模擬與繪圖；Worker 建立失敗時自動退回主執行緒同步計算。
 */

/** Worker 內執行的函式（以 toString() 注入 Blob，因此必須自給自足，不能引用外部變數） */
function flowWorkerMain() {
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  onmessage = (e) => {
    const { grid, n, sx, sy } = e.data;
    // wide=true 時要求周圍 3x3 都是空地（寬通道）
    const wide = (x, y) => {
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const a = x + dx, b = y + dy;
          if (a < 0 || b < 0 || a >= n || b >= n || grid[a + b * n] !== 0) return false;
        }
      return true;
    };
    const run = (w) => {
      const F = new Int16Array(n * n).fill(-1);
      const q = new Int32Array(n * n);
      let h = 0, t = 0;
      const s0 = sx + sy * n;
      F[s0] = 0;
      q[t++] = s0;
      while (h < t) {
        const c = q[h++], i = c % n, j = (c / n) | 0;
        for (const [dx, dy] of D4) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const k = x + y * n;
          if (F[k] >= 0 || grid[k] !== 0) continue;
          if (w && !wide(x, y)) continue;
          F[k] = F[c] + 1;
          q[t++] = k;
        }
      }
      return F;
    };
    const a = run(0), b = run(1);
    postMessage({ a, b }, [a.buffer, b.buffer]); // transfer：零複製回傳
  };
}

export class FlowFieldService {
  #worker = null;
  #busy = false;
  #targets = null;

  constructor() {
    try {
      const src = "(" + flowWorkerMain.toString() + ")()";
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      this.#worker = new Worker(url);
      this.#worker.onmessage = (e) => {
        if (this.#targets) {
          this.#targets[0].set(e.data.a);
          this.#targets[1].set(e.data.b);
        }
        this.#busy = false;
      };
      this.#worker.onerror = () => this.dispose(); // 失敗就退回主執行緒
    } catch {
      this.#worker = null;
    }
  }

  /** 是否正在使用 Worker */
  get usesWorker() {
    return this.#worker !== null;
  }

  /**
   * 請求更新路徑場。
   * @param {{grid:Int8Array,n:number,sx:number,sy:number}} snapshot 地圖快照與玩家所在格
   * @param {Int16Array} narrow 一般路徑場（會被覆寫）
   * @param {Int16Array} wide 寬通道路徑場（會被覆寫）
   * @param {() => void} fallback 沒有 Worker 時的同步計算
   */
  request(snapshot, narrow, wide, fallback) {
    if (!this.#worker) {
      fallback();
      return;
    }
    if (this.#busy) return; // 上一次還沒算完就略過，避免訊息堆積
    this.#busy = true;
    this.#targets = [narrow, wide];
    this.#worker.postMessage({ ...snapshot, grid: snapshot.grid.slice() });
  }

  dispose() {
    this.#worker?.terminate();
    this.#worker = null;
    this.#busy = false;
  }
}
