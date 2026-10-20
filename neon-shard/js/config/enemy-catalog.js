/**
 * 一般敵人設定。每種敵人的所有屬性集中在同一筆資料（以前散在 9 張以編號對照的表裡）。
 * 資料表是 #私有欄位：外部只能透過方法取得唯讀的 EnemyDefinition，無法讀取或修改原始表。
 */
import { CreatureDefinition, assertNumber } from "./creature-definition.js";

export class EnemyDefinition extends CreatureDefinition {
  #unlockWave;
  #preferredDistance;
  #attackCooldown;
  #recoveryTime;
  #telegraphDuration;

  /**
   * @param {ConstructorParameters<typeof CreatureDefinition>[0] & {
   *   unlockWave: number, preferredDistance?: number|null, attackCooldown?: number|null,
   *   recoveryTime?: number|null, telegraphDuration?: number|null }} d
   */
  constructor(d) {
    super(d);
    const label = `敵人 ${d.typeId}`;
    this.#unlockWave = assertNumber(`${label} unlockWave`, d.unlockWave, { min: 1, integer: true });
    const optional = (name, v, min) => (v == null ? null : assertNumber(`${label} ${name}`, v, { min }));
    this.#preferredDistance = optional("preferredDistance", d.preferredDistance, 1);
    this.#attackCooldown = optional("attackCooldown", d.attackCooldown, 0.1);
    this.#recoveryTime = optional("recoveryTime", d.recoveryTime, 0);
    this.#telegraphDuration = optional("telegraphDuration", d.telegraphDuration, 0.05);
    Object.freeze(this);
  }

  /** 第幾波開始出現 */
  get unlockWave() { return this.#unlockWave; }
  /** 想與玩家保持的距離（遠程敵人會前進或後退來維持）；null = 不維持 */
  get preferredDistance() { return this.#preferredDistance; }
  /** 兩次攻擊之間的基礎冷卻（秒） */
  get attackCooldown() { return this.#attackCooldown; }
  /** 攻擊後的僵直時間（秒） */
  get recoveryTime() { return this.#recoveryTime; }
  /** 攻擊前的預警時間（秒）；null = 使用預設 0.45 秒 */
  get telegraphDuration() { return this.#telegraphDuration; }
}

export class EnemyCatalog {
  /** 全域敵人速度倍率 */
  static #SPEED_SCALE = 0.5;

  /** 圖示用的額外形狀（不是敵人，但 e22 這類圖示會用到） */
  static #EXTRA_ICON_SHAPES = { 22: { sides: 40, innerRatio: 1 } };

  static #ROWS = [
    { typeId: 0, name: "追擊", radius: 13, maxHealth: 30, moveSpeed: 125, color: "#ff3d9a", scoreValue: 100, mass: 1, unlockWave: 1,
      dodge: { skill: 0.15, mistakeChance: 0.4 } },
    { typeId: 1, name: "狙擊", radius: 14, maxHealth: 40, moveSpeed: 80, color: "#ff9a3d", scoreValue: 200, mass: 1, unlockWave: 2,
      usesLineTelegraph: true, preferredDistance: 300, attackCooldown: 2.3, recoveryTime: 0.8, dodge: { skill: 0.55, mistakeChance: 0.2 } },
    { typeId: 2, name: "散射", radius: 15, maxHealth: 60, moveSpeed: 70, color: "#b45cff", scoreValue: 250, mass: 1.5, unlockWave: 3,
      usesLineTelegraph: true, preferredDistance: 210, attackCooldown: 2.8, recoveryTime: 0.9, dodge: { skill: 0.3, mistakeChance: 0.3 } },
    { typeId: 3, name: "投擲", radius: 13, maxHealth: 35, moveSpeed: 75, color: "#9dff3d", scoreValue: 220, mass: 1, unlockWave: 4,
      shape: { sides: 5, innerRatio: 1 }, telegraphRadius: 64, telegraphDuration: 0.9, preferredDistance: 260, attackCooldown: 3, recoveryTime: 1.3,
      dodge: { skill: 0.35, mistakeChance: 0.3 } },
    { typeId: 4, name: "緩速", radius: 13, maxHealth: 35, moveSpeed: 80, color: "#4de1ff", scoreValue: 200, mass: 1, unlockWave: 5,
      shape: { sides: 4, innerRatio: 1 }, usesLineTelegraph: true, preferredDistance: 240, attackCooldown: 2.6, recoveryTime: 0.8,
      dodge: { skill: 0.5, mistakeChance: 0.25 } },
    { typeId: 5, name: "牽引", radius: 14, maxHealth: 50, moveSpeed: 60, color: "#ff4dff", scoreValue: 260, mass: 1.2, unlockWave: 8,
      shape: { sides: 12, innerRatio: 0.55 }, telegraphRadius: 130, preferredDistance: 220, attackCooldown: 6, recoveryTime: 1.2,
      dodge: { skill: 0.25, mistakeChance: 0.35 } },
    { typeId: 6, name: "召喚", radius: 16, maxHealth: 70, moveSpeed: 55, color: "#3dffb0", scoreValue: 300, mass: 1.2, unlockWave: 6,
      shape: { sides: 8, innerRatio: 1 }, telegraphRadius: 26, preferredDistance: 300, attackCooldown: 4.5, recoveryTime: 1.1,
      dodge: { skill: 0.2, mistakeChance: 0.35 } },
    { typeId: 7, name: "雷射", radius: 14, maxHealth: 45, moveSpeed: 65, color: "#ff2a4a", scoreValue: 280, mass: 1.5, unlockWave: 10,
      shape: { sides: 6, innerRatio: 0.45 }, usesLineTelegraph: true, preferredDistance: 320, attackCooldown: 3.2, recoveryTime: 1.3,
      dodge: { skill: 0.6, mistakeChance: 0.15 } },
    { typeId: 8, name: "衝鋒", radius: 17, maxHealth: 90, moveSpeed: 90, color: "#c0c8ff", scoreValue: 320, mass: 2.5, unlockWave: 11,
      usesLineTelegraph: true, dodge: { skill: 0.1, mistakeChance: 0.4 } },
    { typeId: 9, name: "築牆", radius: 15, maxHealth: 60, moveSpeed: 60, color: "#ffd23a", scoreValue: 270, mass: 2, unlockWave: 14,
      shape: { sides: 8, innerRatio: 0.5 }, telegraphRadius: 70, preferredDistance: 260, attackCooldown: 5, recoveryTime: 1.2,
      dodge: { skill: 0.3, mistakeChance: 0.3 } },
    { typeId: 10, name: "環射", radius: 14, maxHealth: 55, moveSpeed: 60, color: "#ff9ad5", scoreValue: 290, mass: 1.2, unlockWave: 9,
      shape: { sides: 14, innerRatio: 0.6 }, telegraphRadius: 34, preferredDistance: 200, attackCooldown: 3, recoveryTime: 1,
      dodge: { skill: 0.3, mistakeChance: 0.3 } },
    { typeId: 11, name: "瞬移", radius: 13, maxHealth: 40, moveSpeed: 70, color: "#7a7aff", scoreValue: 300, mass: 1, unlockWave: 12,
      shape: { sides: 10, innerRatio: 0.5 }, telegraphRadius: 24, preferredDistance: 240, attackCooldown: 2.8, recoveryTime: 0.8,
      dodge: { skill: 0.5, mistakeChance: 0.25 } },
    { typeId: 12, name: "分裂", radius: 20, maxHealth: 100, moveSpeed: 75, color: "#ff7a5a", scoreValue: 300, mass: 2, unlockWave: 7,
      shape: { sides: 7, innerRatio: 1 }, dodge: { skill: 0.15, mistakeChance: 0.4 } },
    { typeId: 13, name: "迫擊", radius: 15, maxHealth: 55, moveSpeed: 50, color: "#d4ff3d", scoreValue: 310, mass: 1.5, unlockWave: 13,
      shape: { sides: 16, innerRatio: 0.75 }, telegraphRadius: 90, preferredDistance: 340, attackCooldown: 4.5, recoveryTime: 1.4,
      dodge: { skill: 0.2, mistakeChance: 0.35 } },
    // 後期新增的敵人（沒有指定閃避能力 → 使用預設值）
    { typeId: 26, name: "爆彈客", radius: 12, maxHealth: 28, moveSpeed: 210, color: "#ff9f2a", scoreValue: 140, mass: 1, unlockWave: 6,
      shape: { sides: 3, innerRatio: 1 }, telegraphRadius: 30 },
    { typeId: 27, name: "追蹤者", radius: 13, maxHealth: 45, moveSpeed: 70, color: "#e04dff", scoreValue: 230, mass: 1, unlockWave: 9,
      shape: { sides: 8, innerRatio: 0.6 }, telegraphRadius: 30, preferredDistance: 300, attackCooldown: 3.2, recoveryTime: 0.8 },
    { typeId: 28, name: "治療者", radius: 14, maxHealth: 60, moveSpeed: 60, color: "#6dffb0", scoreValue: 260, mass: 1, unlockWave: 11,
      shape: { sides: 4, innerRatio: 0.55 }, telegraphRadius: 90, preferredDistance: 280, attackCooldown: 4, recoveryTime: 1 },
    { typeId: 29, name: "陷阱師", radius: 14, maxHealth: 55, moveSpeed: 65, color: "#c0a060", scoreValue: 240, mass: 1, unlockWave: 13,
      shape: { sides: 6, innerRatio: 0.5 }, telegraphRadius: 60, preferredDistance: 260, attackCooldown: 4.5, recoveryTime: 0.9 },
      { typeId: 30, name: "毒霧", radius: 15, maxHealth: 45, moveSpeed: 60, color: "#3dff67", scoreValue: 280, mass: 2.3, unlockWave: 1,
      shape: { sides: 15, innerRatio: 1 }, telegraphRadius: 90, preferredDistance: 340, attackCooldown: 5, recoveryTime: 1.4,
      dodge: { skill: 0.2, mistakeChance: 0.7 } },
  ];

  /** @type {Map<number, EnemyDefinition>} */
  #definitions = new Map();

  constructor() {
    for (const row of EnemyCatalog.#ROWS) {
      if (this.#definitions.has(row.typeId)) throw new Error(`重複的敵人編號：${row.typeId}`);
      this.#definitions.set(row.typeId, new EnemyDefinition(row));
    }
  }

  get speedScale() { return EnemyCatalog.#SPEED_SCALE; }
  has(typeId) { return this.#definitions.has(typeId); }
  /** 找不到回傳 null（呼叫端可能傳入 Boss 編號） */
  find(typeId) { return this.#definitions.get(typeId) ?? null; }
  /** 找不到會丟出錯誤 */
  get(typeId) {
    const def = this.#definitions.get(typeId);
    if (!def) throw new RangeError(`未知的敵人編號：${String(typeId)}`);
    return def;
  }
  /** 所有敵人（副本陣列，依編號排序） */
  all() { return [...this.#definitions.values()].sort((a, b) => a.typeId - b.typeId); }
  /** 到第 wave 波為止已解鎖的敵人編號（依編號排序） */
  typesUnlockedBy(wave) { return this.all().filter((d) => wave >= d.unlockWave).map((d) => d.typeId); }
  /** 剛好在第 wave 波首次出現的敵人編號 */
  typesIntroducedAt(wave) { return this.all().filter((d) => d.unlockWave === wave).map((d) => d.typeId); }
  /** 圖示用形狀（敵人、Boss 以外的圖示也能查） */
  extraIconShape(typeId) { return EnemyCatalog.#EXTRA_ICON_SHAPES[typeId] ?? null; }
}
