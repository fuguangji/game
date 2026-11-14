/**
 * core/sim-governor — 自動調頻（取代「模擬頻率」手動設定）
 *
 * 目標：卡頓時先動「程式面」的成本，不動畫質（發光、解析度、光環）。
 *   1. 模擬頻率：負載高時從 60 Hz 往下（45 → 30），負載輕鬆時慢慢升回。
 *      畫面由動態補償（core/interpolation.js）補出中間位置，降頻不會讓畫面變得一頓一頓。
 *   2. 粒子預算：負載高時減少「新生粒子」與粒子上限（粒子又小又短命，少一些肉眼幾乎看不出來）；
 *      不會刪掉畫面上已存在的粒子，也不影響遊戲判定。
 * 兩者都用「降得快、升得慢」＋冷卻時間，避免來回震盪。
 *
 * 純邏輯、不碰 DOM，時間由呼叫端傳入，所以可以用假時鐘測試。
 */

/** 模擬頻率階梯（Hz，由高到低）。最高 60：更高的螢幕更新率由動態補償處理，不必多算模擬。 */
export const SIM_RATES = Object.freeze([60, 45, 30]);

/** 粒子預算階梯（乘在粒子密度與上限上；1 = 完整） */
export const PARTICLE_BUDGETS = Object.freeze([1, 0.75, 0.5, 0.3]);

/** 可調整的門檻（集中在這裡，方便日後微調） */
export const GOVERNOR_TUNING = Object.freeze({
  /** 幀時間平均超過「預算 × 此倍數」視為吃力 */
  strugglingFrameRatio: 1.25,
  /** 一幀裡（模擬＋繪製）耗時超過預算的這個比例也視為吃力 */
  strugglingCostRatio: 0.85,
  /** 幀時間在預算內、且耗時低於預算的這個比例才算輕鬆 */
  comfyFrameRatio: 1.1,
  comfyCostRatio: 0.5,
  /** 連續吃力這麼久（秒）才降一級 */
  downAfterSeconds: 0.9,
  /** 連續輕鬆這麼久（秒）才升一級 */
  upAfterSeconds: 8,
  /** 降級後的冷卻（秒）；剛降過的這段時間內不升 */
  downCooldownSeconds: 2,
  blockUpAfterDownSeconds: 20,
  /** 升級後的冷卻（秒） */
  upCooldownSeconds: 6,
  /** 模擬佔整幀耗時超過此比例，才認為「降模擬頻率」有幫助（否則先減粒子） */
  simShareToLowerRate: 0.3,
  /** 兩種手段都用到底、仍然吃力超過這麼久（秒），才允許通知上層做最後手段（降畫質檔） */
  lastResortSeconds: 6,
});

export class SimGovernor {
  #t;
  #rateIdx = 0;
  #budgetIdx = 0;
  #frameAvg = 16.7;
  #costAvg = 4;
  #simShare = 0.3;
  #best = 1000;
  #slow = 0;
  #fast = 0;
  #cool = 0;
  #blockUp = 0;
  #floorSlow = 0;
  #lastResortFlag = false;
  #fixedRate = 0;
  #onChange;

  /**
   * @param {{ tuning?: Partial<typeof GOVERNOR_TUNING>, onChange?: (g: SimGovernor) => void }} [o]
   */
  constructor({ tuning = {}, onChange = () => {} } = {}) {
    this.#t = { ...GOVERNOR_TUNING, ...tuning };
    this.#onChange = onChange;
  }

  /** 目前模擬頻率（Hz） */
  get rate() { return this.#fixedRate || SIM_RATES[this.#rateIdx]; }

  /** 目前粒子預算（0~1） */
  get particleBudget() { return PARTICLE_BUDGETS[this.#budgetIdx]; }

  /** 兩種手段都用到底仍然吃力：上層可以考慮最後手段（一次只會通知一次，直到恢復） */
  get needsLastResort() { return this.#lastResortFlag; }

  /** 上層已處理最後手段：清掉旗標並重新計時（若仍吃力，隔 lastResortSeconds 後會再通知） */
  acknowledgeLastResort() { this.#lastResortFlag = false; this.#floorSlow = 0; }

  /** 測試或除錯用：固定模擬頻率（0 = 回到自動） */
  forceRate(hz) { this.#fixedRate = hz > 0 ? hz : 0; }

  /** 回到最高檔（開新局、切換裝置模式時呼叫；不清平均值，免得又得重新量測） */
  reset() {
    const changed = this.#rateIdx !== 0 || this.#budgetIdx !== 0;
    this.#rateIdx = 0;
    this.#budgetIdx = 0;
    this.#slow = this.#fast = this.#floorSlow = 0;
    this.#cool = 2;
    this.#lastResortFlag = false;
    if (changed) this.#onChange(this);
  }

  /**
   * 每個繪製幀回報一次。
   * @param {number} frameMs 與上一幀的間隔
   * @param {number} drawMs 這一幀繪製耗時
   * @param {number} stepMs 這一幀模擬總耗時（所有補跑的步數加總）
   * @param {number} budgetMs 目標幀時間（例如 16.7）
   * @param {boolean} [simulating=true] 沒在模擬（選單、暫停）時不評估
   */
  report(frameMs, drawMs, stepMs, budgetMs, simulating = true) {
    if (!simulating || frameMs > 250 || frameMs <= 0) return; // 切分頁或靜止畫面：不是效能問題
    const t = this.#t;
    const k = 1 - Math.exp(-frameMs / 600);
    this.#frameAvg += (frameMs - this.#frameAvg) * k;
    const cost = drawMs + stepMs;
    this.#costAvg += (cost - this.#costAvg) * k;
    this.#simShare += ((cost > 0 ? stepMs / cost : 0) - this.#simShare) * k;
    this.#best = Math.min(this.#best * 1.0005, Math.max(4, frameMs));

    const dt = frameMs / 1000;
    this.#cool = Math.max(0, this.#cool - dt);
    this.#blockUp = Math.max(0, this.#blockUp - dt);

    // 高更新率螢幕（144 Hz）要用它實際的幀時間；一直很慢的裝置 best 也大，取較小者才抓得到「一直都慢」
    const budget = Math.min(budgetMs, Math.max(this.#best, 6.9));
    const struggling = this.#frameAvg > budget * t.strugglingFrameRatio || this.#costAvg > budget * t.strugglingCostRatio;
    const comfy = this.#frameAvg < budget * t.comfyFrameRatio && this.#costAvg < budget * t.comfyCostRatio;
    this.#slow = struggling ? this.#slow + dt : Math.max(0, this.#slow - dt * 2);
    this.#fast = comfy ? this.#fast + dt : 0;

    if (this.#slow > t.downAfterSeconds && this.#cool === 0) {
      if (this.#stepDown()) {
        this.#slow = 0;
        this.#cool = t.downCooldownSeconds;
        this.#blockUp = t.blockUpAfterDownSeconds;
        this.#floorSlow = 0;
        this.#onChange(this);
      } else {
        this.#floorSlow += dt; // 已經沒有程式面的手段可用
        if (this.#floorSlow > t.lastResortSeconds && !this.#lastResortFlag) {
          this.#lastResortFlag = true;
          this.#onChange(this);
        }
      }
    } else if (this.#fast > t.upAfterSeconds && this.#cool === 0 && this.#blockUp === 0) {
      if (this.#stepUp()) {
        this.#fast = 0;
        this.#cool = t.upCooldownSeconds;
        this.#onChange(this);
      }
    }
    if (!struggling) this.#floorSlow = Math.max(0, this.#floorSlow - dt);
  }

  /** 降一級：模擬佔比高 → 先降頻；否則先減粒子。回傳是否真的有降 */
  #stepDown() {
    const canRate = this.#rateIdx < SIM_RATES.length - 1;
    const canBudget = this.#budgetIdx < PARTICLE_BUDGETS.length - 1;
    const simHeavy = this.#simShare > this.#t.simShareToLowerRate;
    if (simHeavy && canRate) { this.#rateIdx++; return true; }
    if (canBudget) { this.#budgetIdx++; return true; }
    if (canRate) { this.#rateIdx++; return true; }
    return false;
  }

  /** 升一級：先把粒子補回來（便宜且看得到），再升模擬頻率 */
  #stepUp() {
    if (this.#budgetIdx > 0) { this.#budgetIdx--; return true; }
    if (this.#rateIdx > 0) { this.#rateIdx--; return true; }
    return false;
  }
}
