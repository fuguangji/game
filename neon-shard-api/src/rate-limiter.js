/**
 * 令牌桶：容量 capacity，每秒補充 refillPerSecond 個令牌。
 * 用來限制單一連線的訊息頻率（允許短暫爆發，但長期不能超過補充速度）。
 */
export class TokenBucket {
  #capacity;
  #refillPerMs;
  #now;
  #tokens;
  #last;

  constructor({ capacity, refillPerSecond, now = Date.now }) {
    if (!(capacity > 0) || !(refillPerSecond > 0)) throw new RangeError("capacity 與 refillPerSecond 必須大於 0");
    this.#capacity = capacity;
    this.#refillPerMs = refillPerSecond / 1000;
    this.#now = now;
    this.#tokens = capacity;
    this.#last = now();
  }

  /** 嘗試取出 cost 個令牌；不夠就回傳 false（訊息應被丟棄） */
  tryRemove(cost = 1) {
    const t = this.#now();
    this.#tokens = Math.min(this.#capacity, this.#tokens + (t - this.#last) * this.#refillPerMs);
    this.#last = t;
    if (this.#tokens < cost) return false;
    this.#tokens -= cost;
    return true;
  }
}
