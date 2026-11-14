/**
 * 事件匯流排：讓遊戲核心「宣告發生了什麼」，其他系統（教學、成就…）自行訂閱。
 * 取代原本直接改寫（猴子補丁）核心函式的做法：
 *  - 核心函式不會再被別人替換，行為可預期
 *  - 某個監聽者丟出例外，不會中斷遊戲，也不會影響其他監聽者
 */
export const GameEvents = Object.freeze({
  PLAYER_SHOT: "player:shot", // { autoAim: boolean }
  PLAYER_DASH: "player:dash",
  SKILL_CAST: "technique:cast",
  SKILL_SELECTED: "technique:selected", // { slot }  選定了某個技能格（手機：點技能鈕；電腦：滾輪）
  SKILL_CANCELLED: "technique:cancelled", // 手機：瞄準後把搖桿拖回中心放開，取消施放
  PLAYER_HURT: "player:hurt", // { damage }  監聽者可修改 damage
  ULTIMATE_USED: "ultimate:used",
  ENEMY_KILLED: "enemy:killed", // { enemy }
  WALL_BROKEN: "wall:broken",
  GAME_RESUMED: "game:resumed",
  QUIT_REQUESTED: "game:quit-requested", // { cancel }  監聽者可設 cancel = true 攔截
  TICK: "frame:tick", // dt（秒）
  HUD_DRAWN: "frame:hud-drawn",
});

export class EventBus {
  #listeners = new Map();

  /** 訂閱事件，回傳取消訂閱函式 */
  on(event, fn) {
    if (typeof fn !== "function") throw new TypeError("監聽者必須是函式");
    const set = this.#listeners.get(event) || new Set();
    set.add(fn);
    this.#listeners.set(event, set);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.#listeners.get(event)?.delete(fn);
  }

  /** 觸發事件；單一監聽者出錯只記錄，不影響遊戲與其他監聽者 */
  emit(event, payload) {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] ${event} 監聽者錯誤`, err);
      }
    }
  }
}

export const bus = new EventBus();
