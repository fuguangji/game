/**
 * Boss 設定：Boss 與它們召喚的小單位。資料表是 #私有欄位，外部只能取得唯讀的 BossDefinition。
 * 新增 Boss 只要在 #BOSSES 末尾加一列：種類編號自動配發，數量沒有上限。
 */
import { CreatureDefinition, assertNumber } from "./creature-definition.js";

/** Boss 的種類編號從這裡往上自動配發（與一般敵人 100 起、小單位 30/31 互不重疊，由 config/index.js 啟動時檢查） */
export const BOSS_ID_BASE = 1000;

export class BossDefinition extends CreatureDefinition {
  #index;
  #attackPatternCount;
  #preferredDistance;
  #description;

  /** @param {ConstructorParameters<typeof CreatureDefinition>[0] & {index:number, attackPatternCount:number, preferredDistance:number, description?:string}} d */
  constructor(d) {
    super(d);
    this.#index = assertNumber(`Boss ${d.typeId} index`, d.index, { min: 0, integer: true });
    this.#attackPatternCount = assertNumber(`Boss ${d.typeId} attackPatternCount`, d.attackPatternCount, { min: 1, integer: true });
    this.#preferredDistance = assertNumber(`Boss ${d.typeId} preferredDistance`, d.preferredDistance, { min: 0 });
    if (d.description != null && typeof d.description !== "string") throw new TypeError(`Boss ${d.typeId} description 必須是字串`);
    this.#description = d.description ?? null;
    Object.freeze(this);
  }

  /** 第幾隻 Boss（0 起算，也是關卡對應編號） */
  get index() { return this.#index; }
  /** 一輪攻擊循環有幾種招式 */
  get attackPatternCount() { return this.#attackPatternCount; }
  /** 想與玩家保持的距離；0 = 貼身追擊 */
  get preferredDistance() { return this.#preferredDistance; }
  /** 圖鑑上的 Boss 說明（招式與打法）；沒寫會顯示「尚無說明」 */
  get description() { return this.#description; }
}

export class BossCatalog {
  static #BOSSES = [
    { name: "哨兵",
      description: "身上的裝甲會持續旋轉，只有缺口那一側才能造成像樣的傷害，打在裝甲上幾乎無效。招式有環形彈幕、朝你瞄準的扇形彈幕，以及一道道連續掃過前方大範圍的雷射。要隨時繞到缺口方向再開火，血量越低彈幕越密、轉得越快。", radius: 34, maxHealth: 1750, moveSpeed: 90, color: "#ff4d4d", scoreValue: 1500, mass: 3,
      attackPatternCount: 3, preferredDistance: 130, shape: { sides: 6, innerRatio: 1 }, telegraphRadius: 70, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "巨像",
      description: "招式有直線蓄力衝撞、在你所在位置附近投下一批炸彈，以及把周圍的方塊撕下來當石頭砸向你（附近沒有方塊時，改在自己周圍丟出一圈炸彈）。衝撞若撞上牆壁會暈眩一段時間，是最好的輸出時機，可以引它撞牆。後期階段衝撞會連續追擊，還會召喚自爆小怪。", radius: 38, maxHealth: 2250, moveSpeed: 100, color: "#ffb040", scoreValue: 2000, mass: 4,
      attackPatternCount: 3, preferredDistance: 130, shape: { sides: 4, innerRatio: 1 }, telegraphRadius: 90, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "棱鏡",
      description: "會分出環繞自己的分身，分身還在時本體處於無敵狀態（身上有深灰圈）：分身很脆弱，先擊碎它們才打得到本體。本體與分身會同時朝你發射雷射，後期本體的雷射條數會增加，雷射碰到牆壁還會反彈。另一種招式是預判你的移動方向，在你前方落下炸彈。分身被清光後，它會在之後的招式或階段轉換時重新分出分身。", radius: 30, maxHealth: 1625, moveSpeed: 140, color: "#4dffd8", scoreValue: 2200, mass: 3,
      attackPatternCount: 2, preferredDistance: 260, shape: { sides: 8, innerRatio: 0.45 }, usesLineTelegraph: true, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "核心",
      description: "本體在節點還在時是無敵的，要先打掉環繞身邊的節點，每個節點的彈幕各不相同（環形、扇形、追蹤彈）。本體自己會放出旋轉螺旋彈幕、環形炸彈、追蹤光球，也會召喚小怪。節點全部被打掉後本體會暈眩一段時間，讓你盡情輸出，之後節點會重新生成。", radius: 40, maxHealth: 3000, moveSpeed: 50, color: "#d070ff", scoreValue: 4000, mass: 5,
      attackPatternCount: 4, preferredDistance: 0, shape: { sides: 12, innerRatio: 0.7 }, telegraphRadius: 100, dodge: { skill: 0, mistakeChance: 0 } },
    { name: "雷霆",
      description: "招式有高速衝撞（後期會連續衝刺）、鎖定你所在橫向位置的落雷，以及讓地板以棋盤格分批通電，通電前格子會先亮起預警，站在沒亮的安全格就不會受傷。每一招都伴隨環形彈幕，要先看預警再走位。", radius: 30, maxHealth: 1800, moveSpeed: 150, color: "#ffe14a", scoreValue: 4500, mass: 3,
      attackPatternCount: 3, preferredDistance: 200, shape: { sides: 3, innerRatio: 1 }, telegraphRadius: 80 },
    { name: "蜂后",
      description: "身邊還有小蜂時本體處於無敵狀態（身上有深灰圈），必須先清掉小蜂。小蜂是會衝向你自爆的單位，被清光後它會再叫出新一批。它還會發射扇形彈幕與追蹤針，並在你腳下留下毒池，毒池會逐漸擴大壓縮可站立的空間，要邊清蜂邊移動。", radius: 40, maxHealth: 2200, moveSpeed: 95, color: "#9dff3d", scoreValue: 5000, mass: 4,
      attackPatternCount: 3, preferredDistance: 150, shape: { sides: 10, innerRatio: 0.55 }, telegraphRadius: 90 },
    { name: "虛空",
      description: "大部分時間處於隱身狀態，此時受到的傷害大幅降低；只有放出大招後才會短暫現形，那是主要輸出時機。招式有強力引力場搭配環形彈幕、瞬移到你身旁後連射三道雷射，以及放出一對傳送門，你和子彈都能穿過傳送門，之後還會接旋轉彈幕。", radius: 36, maxHealth: 2400, moveSpeed: 85, color: "#7a7aff", scoreValue: 5500, mass: 4,
      attackPatternCount: 3, preferredDistance: 0, shape: { sides: 5, innerRatio: 1 }, telegraphRadius: 100 },
    { name: "終焉",
      description: "依血量分成四個階段，每個階段套用不同 Boss 的特色：第一階段是旋轉裝甲加環形與扇形彈幕；第二階段加入棋盤格通電地板；第三階段分出分身，分身還在時本體無敵，並一起發射雷射；最後階段毒池持續擴大、旋轉彈幕更密、整體進入狂暴，速度明顯加快。全程也會召喚各類小怪干擾。", radius: 44, maxHealth: 3500, moveSpeed: 65, color: "#ff2a8a", scoreValue: 9000, mass: 6,
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
  /** @type {Map<number, BossDefinition>} */
  #byType = new Map();
  /** @type {Map<number, CreatureDefinition>} */
  #minions = new Map();

  constructor() {
    BossCatalog.#BOSSES.forEach((row, index) => {
      const boss = new BossDefinition({ ...row, index, typeId: row.typeId ?? BOSS_ID_BASE + index });
      this.#bosses.push(boss);
      this.#byType.set(boss.typeId, boss);
    });
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
  findByType(typeId) { return this.#byType.get(typeId) ?? null; }

  findMinion(typeId) { return this.#minions.get(typeId) ?? null; }

  /** 所有小單位（副本陣列） */
  minions() { return [...this.#minions.values()]; }

  /** 所有 Boss（副本陣列） */
  all() { return [...this.#bosses]; }

  /** 所有 Boss 名稱（副本陣列，依出場順序） */
  names() { return this.#bosses.map((b) => b.name); }
}
