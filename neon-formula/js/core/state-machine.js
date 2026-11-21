/**
 * 有限狀態機：集中管理「選單 / 戰鬥 / 暫停 / 補給 / 結算」的合法轉移。
 * - 轉移表由本類別私有持有，外部只能透過 addTransition / addGuard / onEnter / onExit 擴充
 * - 所有擴充函式都回傳「取消」函式，模組卸載時可還原
 * - 單一回呼或守門函式丟出例外，只會被記錄，不會讓遊戲當掉
 * - strict = true 時非法轉移直接拒絕；false 時只警告（維持原本行為）
 */
export const GameStates = Object.freeze({
  MENU: "menu",
  PLAY: "play",
  PAUSE: "pause",
  SHOP: "shop",
  OVER: "over",
});

const DEFAULT_TRANSITIONS = {
  menu: ["play"],
  play: ["pause", "shop", "over", "menu"],
  pause: ["play", "over", "menu"],
  shop: ["play", "over"],
  over: ["play", "menu"],
};

export class StateMachine {
  #state;
  /** @type {Map<string, Map<string, 0|1>>} from -> (to -> 1 允許 / 0 明確禁止) */
  #graph = new Map();
  #guards = new Set();
  #enter = new Map();
  #exit = new Map();
  strict;

  constructor(initial, transitions, { strict = false } = {}) {
    for (const [from, list] of Object.entries(transitions)) {
      this.#ensure(from);
      for (const to of list) this.addTransition(from, to);
    }
    if (!this.#graph.has(initial)) throw new Error(`未知的初始狀態：${initial}`);
    this.#state = initial;
    this.strict = strict;
  }

  /** 目前狀態（唯讀） */
  get state() {
    return this.#state;
  }

  is(...names) {
    return names.includes(this.#state);
  }

  can(next) {
    return this.#graph.get(this.#state)?.get(next) === 1;
  }

  #ensure(name) {
    if (!this.#graph.has(name)) this.#graph.set(name, new Map());
    return this.#graph.get(name);
  }

  /** 新增（或用 allowed=false 禁止）一條轉移；回傳還原函式 */
  addTransition(from, to, allowed = true) {
    const edges = this.#ensure(from);
    this.#ensure(to);
    const previous = edges.get(to);
    edges.set(to, allowed ? 1 : 0);
    return () => {
      if (previous === undefined) edges.delete(to);
      else edges.set(to, previous);
    };
  }

  /** 守門函式：回傳 false 即拒絕轉移 */
  addGuard(guard) {
    if (typeof guard !== "function") throw new TypeError("guard 必須是函式");
    this.#guards.add(guard);
    return () => this.#guards.delete(guard);
  }

  #hook(map, state, fn) {
    if (typeof fn !== "function") throw new TypeError("callback 必須是函式");
    this.#ensure(state);
    if (!map.has(state)) map.set(state, new Set());
    map.get(state).add(fn);
    return () => map.get(state)?.delete(fn);
  }

  onEnter(state, fn) {
    return this.#hook(this.#enter, state, fn);
  }

  onExit(state, fn) {
    return this.#hook(this.#exit, state, fn);
  }

  #run(map, phase, state, ...args) {
    for (const fn of map.get(state) || []) {
      try {
        fn(...args);
      } catch (error) {
        console.error(`[state] ${phase} hook failed for "${state}"`, error);
      }
    }
  }

  /** 驗證並執行狀態轉移；回傳是否成功（同狀態視為成功但不觸發事件） */
  transition(next) {
    if (next === this.#state) return true;
    const previous = this.#state;
    for (const guard of this.#guards) {
      try {
        if (guard(previous, next) === false) return false;
      } catch (error) {
        console.error("[state] transition guard failed", error);
        return false;
      }
    }
    const edge = this.#graph.get(previous)?.get(next);
    if (edge === 0) return false;
    if (!edge) {
      console.warn(`[state] 非法轉移 ${previous} -> ${next}`);
      if (this.strict) return false;
    }
    this.#run(this.#exit, "exit", previous, next);
    this.#state = next;
    this.#run(this.#enter, "enter", next, previous);
    return true;
  }
}

/** 全域唯一的遊戲狀態機 */
export const fsm = new StateMachine(GameStates.MENU, DEFAULT_TRANSITIONS);

/* ---- 對外擴充 API（window.NEON_SHARD_API 使用，名稱與原本相同） ---- */
export function registerStateTransition(from, to, allowed = true) {
  return fsm.addTransition(from, to, allowed);
}
export function registerStateHook(stateName, phase, callback) {
  if (phase !== "enter" && phase !== "exit") throw new TypeError('phase 必須是 "enter" 或 "exit"');
  return phase === "enter" ? fsm.onEnter(stateName, callback) : fsm.onExit(stateName, callback);
}
export function registerStateGuard(guard) {
  return fsm.addGuard(guard);
}
