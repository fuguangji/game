/**
 * 敵方子彈設定。每一種子彈有名稱、速度、傷害、效果；資料表是 #私有欄位，外部讀不到也改不了。
 * 發射時用 bulletCatalog.get("SNIPER_SHOT") 取得唯讀的 BulletDefinition。
 */
import { assertNumber } from "./creature-definition.js";

/** 子彈命中玩家後的附加效果 */
export const BulletEffect = Object.freeze({
  NONE: 0,
  SLOW: 1, // 減速一段時間
  HOMING: 2, // 子彈會追蹤玩家
  STACKING_SLOW: 3, // 可疊加的減速
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export class BulletDefinition {
  #id;
  #speed;
  #damage;
  #radius;
  #lifetimeSeconds;
  #lifetimeScalesWithSpeedScale;
  #effect;
  #color;

  /**
   * @param {object} d
   * @param {string} d.id 子彈名稱
   * @param {number} d.speed 基礎速度（還會乘上全域子彈速度倍率）
   * @param {number} d.damage 對玩家的傷害
   * @param {number} [d.radius] 碰撞半徑
   * @param {number} [d.lifetimeSeconds] 存活時間（秒）
   * @param {boolean} [d.lifetimeScalesWithSpeedScale] 存活時間是否隨速度倍率調整（讓射程不變）
   * @param {number} [d.effect] BulletEffect 之一
   * @param {string|null} [d.color] 固定顏色；null 表示沿用發射者的顏色
   */
  constructor(d) {
    this.#id = String(d.id);
    this.#speed = assertNumber(`子彈 ${d.id} speed`, d.speed, { min: 0 });
    this.#damage = assertNumber(`子彈 ${d.id} damage`, d.damage, { min: 0 });
    this.#radius = assertNumber(`子彈 ${d.id} radius`, d.radius ?? 5, { min: 1 });
    this.#lifetimeSeconds = assertNumber(`子彈 ${d.id} lifetimeSeconds`, d.lifetimeSeconds ?? 3, { min: 0.1 });
    this.#lifetimeScalesWithSpeedScale = Boolean(d.lifetimeScalesWithSpeedScale);
    const effect = d.effect ?? BulletEffect.NONE;
    if (!Object.values(BulletEffect).includes(effect)) throw new RangeError(`子彈 ${d.id} effect = ${String(effect)}`);
    this.#effect = effect;
    if (d.color != null && !HEX_COLOR.test(d.color)) throw new TypeError(`子彈 ${d.id} color = ${String(d.color)}`);
    this.#color = d.color ?? null;
  }

  get id() { return this.#id; }
  get speed() { return this.#speed; }
  get damage() { return this.#damage; }
  get radius() { return this.#radius; }
  get lifetimeSeconds() { return this.#lifetimeSeconds; }
  get lifetimeScalesWithSpeedScale() { return this.#lifetimeScalesWithSpeedScale; }
  get effect() { return this.#effect; }
  get color() { return this.#color; }
  get isHoming() { return this.#effect === BulletEffect.HOMING; }
}

export class BulletCatalog {
  /** 全域子彈速度倍率（玩家與敵方子彈共用；調慢讓畫面比較好閃避） */
  static #SPEED_SCALE = 0.7;

  /** 具名的敵方子彈；元素順序依「發射者」整理，讀起來就是一份設計表 */
  static #PRESETS = [
    // 狙擊敵人（type 1）
    { id: "SNIPER_SHOT", speed: 400, damage: 20 },
    { id: "SNIPER_ELITE_SHOT", speed: 480, damage: 28 },
    // 散射敵人（type 2）與精英的扇形彈
    { id: "SPREAD_PELLET", speed: 235, damage: 9 },
    { id: "SPREAD_ELITE_PELLET", speed: 250, damage: 11 },
    // 緩速敵人（type 4）
    { id: "SLOW_ORB", speed: 300, damage: 6, effect: BulletEffect.SLOW },
    { id: "SLOW_ELITE_ORB", speed: 320, damage: 8, effect: BulletEffect.STACKING_SLOW },
    // 環射敵人（type 10）
    { id: "RING_PELLET", speed: 190, damage: 8 },
    { id: "RING_ELITE_HEAVY_PELLET", speed: 210, damage: 10 },
    { id: "RING_ELITE_FAST_PELLET", speed: 260, damage: 6 },
    // 瞬移敵人（type 11）
    { id: "BLINK_BURST_PELLET", speed: 300, damage: 12 },
    { id: "BLINK_BURST_ELITE_PELLET", speed: 320, damage: 14 },
    // 追蹤者（type 27）：追蹤光球
    { id: "TRACKER_ORB_HEAVY", speed: 165, damage: 14, effect: BulletEffect.HOMING },
    { id: "TRACKER_ORB_LIGHT", speed: 150, damage: 12, effect: BulletEffect.HOMING },
    // 其他特殊來源
    { id: "WALL_TURRET_SHOT", speed: 160, damage: 6, radius: 4, color: "#ffb21a" }, // 精英築牆敵人的砲塔
    { id: "GHOST_SHOT", speed: 320, damage: 14 }, // 精英瞬移敵人留下的殘影
    { id: "BOSS_ROCK", speed: 220, damage: 16, radius: 10, color: "#ffb040", lifetimeSeconds: 3, lifetimeScalesWithSpeedScale: true },
  ];

  #definitions = new Map();

  constructor() {
    for (const row of BulletCatalog.#PRESETS) {
      if (this.#definitions.has(row.id)) throw new Error(`重複的子彈名稱：${row.id}`);
      this.#definitions.set(row.id, new BulletDefinition(row));
    }
  }

  get speedScale() { return BulletCatalog.#SPEED_SCALE; }

  has(id) { return this.#definitions.has(id); }

  /** 取得唯讀的子彈設定；名稱不存在會丟出錯誤（拼錯名稱要立刻發現，而不是射出奇怪的子彈） */
  get(id) {
    const def = this.#definitions.get(id);
    if (!def) throw new RangeError(`未知的子彈：${String(id)}`);
    return def;
  }

  /** 所有子彈名稱（副本） */
  ids() { return [...this.#definitions.keys()]; }

  /** 臨時組合一個子彈（Boss 的速度、傷害會隨階段變動，不適合預先具名） */
  custom({ speed, damage, effect = BulletEffect.NONE, radius = 5, lifetimeSeconds = 3, color = null }) {
    return new BulletDefinition({ id: "custom", speed, damage, effect, radius, lifetimeSeconds, color });
  }
}
