/**
 * core/game-loop — 固定步長主迴圈（模擬與繪製分離）
 *
 *   模擬（step）：以固定頻率（simRate，預設 60 Hz）前進。每一步的 dt 永遠相同，所以物理與冷卻不受螢幕更新率影響，
 *                 掉幀時用「補跑幾步」追上，而不是像以前一樣把 dt 放大（子彈穿牆）或直接變慢動作。
 *   繪製（draw）：每個 requestAnimationFrame 一次，可獨立設定幀率上限，並帶 alpha（0~1）給動態補償插值。
 *
 * 保護機制：
 *   - 一次最多補跑 MAX_STEPS 步；落後更多就放棄追趕（寧可慢動作，也不要卡死在補跑迴圈）。
 *   - 單幀間隔上限 MAX_FRAME：切分頁回來不會一口氣跑幾百步。
 *   - 選單／暫停不模擬，只低頻繪製。
 * 所有外部相依都從建構子注入，所以可以在 Node 裡用假時鐘測試。
 */
const MAX_FRAME = 0.25;
const MAX_STEPS = 6;

export class GameLoop {
  #deps;
  #acc = 0;
  #last = 0;
  #nextDraw = 0;
  #raf = 0;
  #running = false;
  #dirty = false; // 閒置（不模擬）時，是否還欠一次繪製（開機時不補畫：首頁被不透明的介面蓋住）
  #sleeping = false; // 閒置且沒有欠繪製：連 requestAnimationFrame 都不排，CPU 完全休息
  #wasSim = false; // 開機時視為「本來就在閒置」，不補畫第一幀
  /** 給效能面板用的統計（每秒更新） */
  stats = { fps: 0, sps: 0, drawMs: 0, stepMs: 0, steps: 0, dropped: 0 };
  #win = { t: 0, frames: 0, sims: 0, draw: 0, step: 0 };

  /**
   * @param {object} deps
   * @param {() => number} deps.simRate 目前模擬頻率（Hz）
   * @param {() => number} deps.fpsCap 繪製幀率上限（0 = 不限）
   * @param {() => boolean} deps.simulating 這一幀要不要模擬（戰鬥中才要）
   * @param {() => number} deps.idleFps 不模擬時的繪製頻率（選單、暫停）；0 = 不重畫，只在進入閒置、invalidate() 時畫一次
   * @param {(dt:number) => void} deps.beforeStep 每次模擬前（記錄插值用的上一個狀態）
   * @param {(dt:number) => void} deps.step 模擬一步
   * @param {(alpha:number, stepDt:number) => void} deps.draw 繪製
   * @param {(frameMs:number, drawMs:number, targetMs:number) => void} [deps.onFrame] 每個繪製幀的效能回報
   * @param {() => number} [deps.now]
   * @param {(fn:(t:number)=>void) => number} [deps.schedule]
   */
  constructor(deps) {
    this.#deps = {
      now: () => performance.now(),
      schedule: (fn) => requestAnimationFrame(fn),
      onFrame: () => {},
      ...deps,
    };
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#last = this.#deps.now();
    this.#nextDraw = this.#last;
    this.#raf = this.#deps.schedule((t) => this.#frame(t));
  }

  stop() { this.#running = false; }

  /** 要求重畫一次（視窗縮放、換畫面後呼叫）；休眠中會自動醒來 */
  invalidate() { this.#dirty = true; this.wake(); }

  /** 從休眠醒來（狀態改變、有輸入時呼叫；沒在休眠就什麼都不做） */
  wake() {
    if (!this.#sleeping || !this.#running) return;
    this.#sleeping = false;
    this.#last = this.#deps.now();
    this.#raf = this.#deps.schedule((t) => this.#frame(t));
  }

  /** 清掉累積的時間（開局、離開選單時呼叫，避免一次補跑） */
  resetClock() { this.#acc = 0; this.#last = this.#deps.now(); }

  /** 處理一個 rAF 回呼（公開給測試，用假時鐘一步一步推進） */
  frame(now) { this.#frame(now, true); }

  #frame(now, manual = false) {
    const d = this.#deps;
    if (!manual && !this.#running) return;
    const frameMs = Math.max(0, now - this.#last);
    this.#last = now;
    const stepDt = 1 / Math.max(1, d.simRate());
    const simulating = d.simulating();

    let steps = 0;
    const t0 = d.now();
    if (simulating) {
      this.#acc += Math.min(frameMs / 1000, MAX_FRAME);
      while (this.#acc >= stepDt && steps < MAX_STEPS) {
        d.beforeStep(stepDt);
        d.step(stepDt);
        this.#acc -= stepDt;
        steps++;
      }
      if (steps === MAX_STEPS && this.#acc >= stepDt) { this.#acc %= stepDt; this.stats.dropped++; }
    } else {
      this.#acc = 0;
    }
    const stepMs = d.now() - t0;

    // 繪製節流：玩家設的幀率上限；不模擬（選單、暫停）時用低頻率，或完全不重畫（畫面被不透明的介面蓋住時，重畫只是浪費）
    if (this.#wasSim && !simulating) this.#dirty = true; // 剛進入閒置：補畫最後一幀
    this.#wasSim = simulating;
    const cap = simulating ? d.fpsCap() : d.idleFps();
    let draw = true;
    if (!simulating && cap <= 0) {
      draw = this.#dirty;
      this.#dirty = false;
    } else if (cap > 0) {
      const interval = 1000 / cap;
      if (now + 1.5 < this.#nextDraw) draw = false; // 還沒到下一次繪製時間（容許 1.5ms 的 rAF 時間抖動）
      else {
        const next = this.#nextDraw + interval;
        this.#nextDraw = next < now ? now + interval : next; // 落後太多就重新對齊，不要連續補畫
      }
    } else this.#nextDraw = now;

    let drawMs = 0;
    if (draw) {
      const t1 = d.now();
      d.draw(simulating ? this.#acc / stepDt : 1, stepDt);
      drawMs = d.now() - t1;
      d.onFrame(frameMs, drawMs, cap > 0 ? 1000 / cap : 1000 / 60);
    }
    this.#tally(now, draw, steps, drawMs, stepMs);
    if (manual || !this.#running) return;
    if (!simulating && d.idleFps() <= 0 && !this.#dirty) this.#sleeping = true; // 閒置且畫面已是最新：休眠，等 wake()
    else this.#raf = d.schedule((t) => this.#frame(t));
  }

  #tally(now, drew, steps, drawMs, stepMs) {
    const w = this.#win;
    if (!w.t) w.t = now;
    if (drew) { w.frames++; w.draw += drawMs; }
    w.sims += steps;
    w.step += stepMs;
    if (now - w.t >= 1000) {
      const sec = (now - w.t) / 1000;
      this.stats.fps = Math.round(w.frames / sec);
      this.stats.sps = Math.round(w.sims / sec);
      this.stats.drawMs = w.frames ? w.draw / w.frames : 0;
      this.stats.stepMs = w.sims ? w.step / w.sims : 0;
      this.stats.steps = steps;
      Object.assign(w, { t: now, frames: 0, sims: 0, draw: 0, step: 0 });
    }
  }
}
