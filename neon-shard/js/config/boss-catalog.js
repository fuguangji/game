/**
 * Boss 設定：8 隻 Boss 與它們召喚的小單位。資料表是 #私有欄位，外部只能取得唯讀的 BossDefinition。
 */
import { CreatureDefinition, assertNumber } from "./creature-definition.js";

/** Boss 的種類編號從這裡開始：第 0 隻 Boss 的 typeId = 14 */
export const FIRST_BOSS_TYPE_ID = 14;

export class BossDefinition extends CreatureDefinition {
  #index;
  #attackPatternCount;
  #preferredDistance;

  /** @param {ConstructorParameters<typeof CreatureDefinition>[0] & {index:number, attackPatternCount:number, preferredDistance:number}} d */
  constructor(d) {
    super(d);
    this.#index = assertNumber(`Boss ${d.typeId} index`, d.index, { min: 0, integer: true });
    this.#attackPatternCount = assertNumber(`Boss ${d.typeId} attackPatternCount`, d.attackPatternCount, { min: 1, integer: true });
    this.#preferredDistance = assertNumber(`Boss ${d.typeId} preferredDistance`, d.preferredDistance, { min: 0 });
    Object.freeze(this);
  }

  /** 第幾隻 Boss（0 起算，也是關卡對應編號） */
  get index() { return this.#index; }
  /** 一輪攻擊循環有幾種招式 */
  get attackPatternCount() { return this.#attackPatternCount; }
  /** 想與玩家保持的距離；0 = 貼身追擊 */
  get preferredDistance() { return this.#preferredDistance; }
}

export class BossCatalog {
  static #BOSSES = [
    { name: "哨兵", radius: 34, maxHealth: 1750, moveSpeed: 90, color: "#ff4d4d", scoreValue: 1500, mass: 3,
      attackPatternCount: 3, preferredDistance: 130, shape: { sides: 6, innerRatio: 1 }, telegraphRadius: 70, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "巨像", radius: 38, maxHealth: 2250, moveSpeed: 100, color: "#ffb040", scoreValue: 2000, mass: 4,
      attackPatternCount: 3, preferredDistance: 130, shape: { sides: 4, innerRatio: 1 }, telegraphRadius: 90, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "棱鏡", radius: 30, maxHealth: 1625, moveSpeed: 140, color: "#4dffd8", scoreValue: 2200, mass: 3,
      attackPatternCount: 2, preferredDistance: 260, shape: { sides: 8, innerRatio: 0.45 }, usesLineTelegraph: true, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "核心", radius: 40, maxHealth: 3000, moveSpeed: 50, color: "#d070ff", scoreValue: 4000, mass: 5,
      attackPatternCount: 4, preferredDistance: 0, shape: { sides: 12, innerRatio: 0.7 }, telegraphRadius: 100, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "雷霆", radius: 30, maxHealth: 1800, moveSpeed: 150, color: "#ffe14a", scoreValue: 4500, mass: 3,
      attackPatternCount: 3, preferredDistance: 200, shape: { sides: 3, innerRatio: 1 }, telegraphRadius: 80 },
    { name: "蜂后", radius: 40, maxHealth: 2200, moveSpeed: 95, color: "#9dff3d", scoreValue: 5000, mass: 4,
      attackPatternCount: 3, preferredDistance: 150, shape: { sides: 10, innerRatio: 0.55 }, telegraphRadius: 90 },
    { name: "虛空", radius: 36, maxHealth: 2400, moveSpeed: 85, color: "#7a7aff", scoreValue: 5500, mass: 4,
      attackPatternCount: 3, preferredDistance: 0, shape: { sides: 5, innerRatio: 1 }, telegraphRadius: 100 },
    { name: "終焉", radius: 44, maxHealth: 3500, moveSpeed: 65, color: "#ff2a8a", scoreValue: 9000, mass: 6,
      attackPatternCount: 4, preferredDistance: 180, shape: { sides: 16, innerRatio: 0.5 }, telegraphRadius: 110 },
  ];

  /** Boss 召喚的小單位（分身節點、護盾核心）；編號固定為 30、31 */
  static #MINIONS = [
    { typeId: 30, name: "分身節點", radius: 26, maxHealth: 1, moveSpeed: 0, color: "#4dffd8", scoreValue: 0, mass: 3,
      shape: { sides: 8, innerRatio: 0.45 }, usesLineTelegraph: true },
    { typeId: 31, name: "護盾核心", radius: 18, maxHealth: 300, moveSpeed: 0, color: "#d070ff", scoreValue: 200, mass: 9,
      shape: { sides: 5, innerRatio: 0.5 } },
  ];

  /** @type {BossDefinition[]} */
  #bosses = [];
  /** @type {Map<number, CreatureDefinition>} */
  #minions = new Map();

  constructor() {
    BossCatalog.#BOSSES.forEach((row, index) => this.#bosses.push(new BossDefinition({ ...row, index, typeId: FIRST_BOSS_TYPE_ID + index })));
    for (const row of BossCatalog.#MINIONS) this.#minions.set(row.typeId, new CreatureDefinition(row));
  }

  get count() { return this.#bosses.length; }

  /** 第 index 隻 Boss；超出範圍會丟出錯誤 */
  get(index) {
    const boss = this.#bosses[index];
    if (!boss) throw new RangeError(`未知的 Boss 編號：${String(index)}`);
    return boss;
  }

  /** 第 index 隻 Boss；超出範圍回傳 null（選單、HUD 這類「可能沒有 Boss」的地方使用） */
  find(index) { return this.#bosses[index] ?? null; }

  /** 以種類編號查詢；不是 Boss 回傳 null */
  findByType(typeId) { return this.#bosses[typeId - FIRST_BOSS_TYPE_ID] ?? null; }

  findMinion(typeId) { return this.#minions.get(typeId) ?? null; }

  /** 所有 Boss（副本陣列） */
  all() { return [...this.#bosses]; }

  /** 所有 Boss 名稱（副本陣列，依出場順序） */
  names() { return this.#bosses.map((b) => b.name); }
}
