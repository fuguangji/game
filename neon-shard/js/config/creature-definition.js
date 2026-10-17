/**
 * 所有「會動的敵方單位」（一般敵人、Boss、Boss 召喚物）共用的基礎設定。
 * 實例建立後不可修改；屬性只能透過唯讀的 getter 讀取。
 */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function assertNumber(label, value, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`設定錯誤：${label} = ${String(value)}（需為 ${min} ~ ${max} 的${integer ? "整數" : "有限數"}）`);
  }
  return value;
}

/** 閃避能力：skill = 看到子彈後嘗試閃避的機率，mistakeChance = 閃錯方向的機率 */
export const DEFAULT_DODGE = Object.freeze({ skill: 0.2, mistakeChance: 0.3 });

export class CreatureDefinition {
  #typeId;
  #name;
  #radius;
  #maxHealth;
  #moveSpeed;
  #color;
  #scoreValue;
  #mass;
  #shape;
  #telegraphRadius;
  #usesLineTelegraph;
  #dodge;

  /**
   * @param {object} d
   * @param {number} d.typeId 單位種類編號（遊戲內部以它辨識敵人）
   * @param {string} d.name 顯示名稱
   * @param {number} d.radius 碰撞半徑（像素）
   * @param {number} d.maxHealth 基礎最大血量（還會乘上波數與關卡倍率）
   * @param {number} d.moveSpeed 基礎移動速度（還會乘上全域敵人速度倍率）
   * @param {string} d.color 代表色（#rrggbb）
   * @param {number} d.scoreValue 擊殺得分
   * @param {number} d.mass 質量：越大越不容易被擊退
   * @param {{sides:number, innerRatio:number}|null} [d.shape] 圖示形狀：邊數與內縮比例；null 表示用預設三角形
   * @param {number|null} [d.telegraphRadius] 範圍預警圈半徑
   * @param {boolean} [d.usesLineTelegraph] 預警是否畫成一條直線
   * @param {{skill:number, mistakeChance:number}|null} [d.dodge] 閃避能力；null 表示使用預設值
   */
  constructor(d) {
    this.#typeId = assertNumber("typeId", d.typeId, { min: 0, integer: true });
    this.#name = String(d.name ?? "");
    const label = `單位 ${this.#typeId}`;
    this.#radius = assertNumber(`${label} radius`, d.radius, { min: 1 });
    this.#maxHealth = assertNumber(`${label} maxHealth`, d.maxHealth, { min: 1 });
    this.#moveSpeed = assertNumber(`${label} moveSpeed`, d.moveSpeed, { min: 0 });
    if (!HEX_COLOR.test(d.color)) throw new TypeError(`設定錯誤：${label} color = ${String(d.color)}`);
    this.#color = d.color;
    this.#scoreValue = assertNumber(`${label} scoreValue`, d.scoreValue, { min: 0 });
    this.#mass = assertNumber(`${label} mass`, d.mass, { min: 0.1 });
    this.#shape = d.shape
      ? Object.freeze({ sides: assertNumber(`${label} shape.sides`, d.shape.sides, { min: 3, integer: true }), innerRatio: assertNumber(`${label} shape.innerRatio`, d.shape.innerRatio, { min: 0.1, max: 1 }) })
      : null;
    this.#telegraphRadius = d.telegraphRadius == null ? null : assertNumber(`${label} telegraphRadius`, d.telegraphRadius, { min: 1 });
    this.#usesLineTelegraph = Boolean(d.usesLineTelegraph);
    this.#dodge = d.dodge
      ? Object.freeze({ skill: assertNumber(`${label} dodge.skill`, d.dodge.skill, { min: 0, max: 1 }), mistakeChance: assertNumber(`${label} dodge.mistakeChance`, d.dodge.mistakeChance, { min: 0, max: 1 }) })
      : null;
  }

  get typeId() { return this.#typeId; }
  get name() { return this.#name; }
  get radius() { return this.#radius; }
  get maxHealth() { return this.#maxHealth; }
  get moveSpeed() { return this.#moveSpeed; }
  get color() { return this.#color; }
  get scoreValue() { return this.#scoreValue; }
  get mass() { return this.#mass; }
  /** @returns {Readonly<{sides:number, innerRatio:number}>|null} */
  get shape() { return this.#shape; }
  get telegraphRadius() { return this.#telegraphRadius; }
  get usesLineTelegraph() { return this.#usesLineTelegraph; }
  /** 沒有特別設定時回傳全域預設值 */
  get dodge() { return this.#dodge ?? DEFAULT_DODGE; }
}
