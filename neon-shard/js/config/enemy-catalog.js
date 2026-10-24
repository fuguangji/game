/**
 * 一般敵人設定。每種敵人的所有屬性集中在同一筆資料（以前散在 9 張以編號對照的表裡）。
 * 資料表是 #私有欄位：外部只能透過方法取得唯讀的 EnemyDefinition，無法讀取或修改原始表。
 */
import { CreatureDefinition, assertNumber } from "./creature-definition.js";

/** 沒有手動指定 typeId 的敵人，從這個編號開始自動往上編（舊敵人保留原編號，因為程式裡有以編號寫死的行為） */
export const AUTO_ENEMY_ID_BASE = 100;

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
};

export class EnemyDefinition extends CreatureDefinition {
  #unlockWave;
  #preferredDistance;
  #attackCooldown;
  #recoveryTime;
  #telegraphDuration;
  #legend;
  #attack;
  #elite;

  /**
   * @param {ConstructorParameters<typeof CreatureDefinition>[0] & {
   *   unlockWave: number, preferredDistance?: number|null, attackCooldown?: number|null,
   *   recoveryTime?: number|null, telegraphDuration?: number|null,
   *   legend?: string, attack?: {bullet: string, count?: number, spread?: number, ring?: number}, elite?: object }} d
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
    if (d.legend != null && typeof d.legend !== "string") throw new TypeError(`${label} legend 必須是字串`);
    this.#legend = d.legend ?? null;
    this.#attack = d.attack == null ? null : EnemyDefinition.#checkAttack(label, d.attack);
    if (d.elite != null && (typeof d.elite.n !== "string" || !Array.isArray(d.elite.fx))) throw new TypeError(`${label} elite 需要 n（名稱）與 fx（效果說明陣列）`);
    this.#elite = d.elite == null ? null : deepFreeze(structuredClone(d.elite));
    Object.freeze(this);
  }

  static #checkAttack(label, a) {
    if (typeof a.bullet !== "string" || !a.bullet) throw new TypeError(`${label} attack.bullet 必須是子彈名稱（見 bullet-catalog.js）`);
    const count = assertNumber(`${label} attack.count`, a.count ?? 1, { min: 1, integer: true });
    const spread = assertNumber(`${label} attack.spread`, a.spread ?? 0, { min: 0 });
    const ring = a.ring == null ? 0 : assertNumber(`${label} attack.ring`, a.ring, { min: 1, integer: true });
    return Object.freeze({ bullet: a.bullet, count, spread, ring });
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
  /** 圖鑑上的一句話說明；沒寫就不會出現在圖鑑圖例 */
  get legend() { return this.#legend; }
  /**
   * 宣告式攻擊（不必寫程式）：每次開火發射 bullet 這顆子彈。
   * count > 1 → 扇形，spread 是整個扇形的展開弧度；ring = n → 一圈 n 發。
   * 沒有宣告就走 enemy-ai.js 裡以編號寫的專屬行為。
   */
  get attack() { return this.#attack; }
  /** 精英版資料（名稱、血量/速度倍率、效果說明…）；沒有就不會有精英版 */
  get elite() { return this.#elite; }
}

export class EnemyCatalog {
  /** 全域敵人速度倍率 */
  static #SPEED_SCALE = 0.5;

  /** 圖示用的額外形狀（不是敵人，但 e22 這類圖示會用到） */
  static #EXTRA_ICON_SHAPES = { 22: { sides: 40, innerRatio: 1 } };

  static #ROWS = [
    { typeId: 0, name: "追擊", radius: 13, maxHealth: 30, moveSpeed: 125, color: "#ff3d9a", scoreValue: 100, mass: 1, unlockWave: 1,
      dodge: { skill: 0.15, mistakeChance: 0.4 },
      legend: "貼身衝撞",
      elite: {
        n: "狂奔追擊",
        hk: 55 / 30,
        sk: 150 / 125,
        fx: ["奔跑時在身後留下火焰痕跡", "撞到你後會短暫加速", "撞擊更凶、破牆更快"],
      } },
    { typeId: 1, name: "狙擊", radius: 14, maxHealth: 40, moveSpeed: 80, color: "#ff9a3d", scoreValue: 200, mass: 1, unlockWave: 2,
      usesLineTelegraph: true, preferredDistance: 300, attackCooldown: 2.3, recoveryTime: 0.8, dodge: { skill: 0.55, mistakeChance: 0.2 },
      legend: "預判單發",
      elite: {
        n: "預判狙擊",
        hk: 65 / 40,
        sk: 85 / 80,
        pref: 320,
        cd: 1.9,
        lead: [480, null, 1],
        fx: ["子彈更快更痛，預判更準", "每第 3 發是橘色穿透彈，能穿過一面牆（預警線也會變橘色）"],
      } },
    { typeId: 2, name: "散射", radius: 15, maxHealth: 60, moveSpeed: 70, color: "#b45cff", scoreValue: 250, mass: 1.5, unlockWave: 3,
      usesLineTelegraph: true, preferredDistance: 210, attackCooldown: 2.8, recoveryTime: 0.9, dodge: { skill: 0.3, mistakeChance: 0.3 },
      legend: "5 發扇形",
      elite: {
        n: "擴散散射",
        hk: 90 / 60,
        sk: 75 / 70,
        pref: 220,
        cd: 2.4,
        fx: ["一次射出 7 發，比原版更寬更密", "每第 2 次攻擊變成雙重散射：先射窄扇形，0.3 秒後再補一波寬扇形（橘色）"],
      } },
    { typeId: 3, name: "投擲", radius: 13, maxHealth: 35, moveSpeed: 75, color: "#9dff3d", scoreValue: 220, mass: 1, unlockWave: 4,
      shape: { sides: 5, innerRatio: 1 }, telegraphRadius: 64, telegraphDuration: 0.9, preferredDistance: 260, attackCooldown: 3, recoveryTime: 1.3,
      dodge: { skill: 0.35, mistakeChance: 0.3 },
      legend: "延遲炸彈",
      elite: {
        n: "連環投擲",
        hk: 55 / 35,
        sk: 80 / 75,
        cd: 2.6,
        tl: 0.75,
        rg: 70,
        lead: [1e5, 0.75, 1],
        fx: ["一次丟 2～3 顆炸彈，範圍更大、傷害更高", "炸彈落地後會彈跳一次，再爆炸"],
      } },
    { typeId: 4, name: "緩速", radius: 13, maxHealth: 35, moveSpeed: 80, color: "#4de1ff", scoreValue: 200, mass: 1, unlockWave: 5,
      shape: { sides: 4, innerRatio: 1 }, usesLineTelegraph: true, preferredDistance: 240, attackCooldown: 2.6, recoveryTime: 0.8,
      dodge: { skill: 0.5, mistakeChance: 0.25 },
      legend: "命中減速",
      elite: {
        n: "強緩射擊",
        hk: 55 / 35,
        sk: 85 / 80,
        fx: ["子彈更快，減速效果更強，可疊 2 層（疊滿時移速只剩 30%）", "每第 4 發是冰霜彈（淺藍色），命中後在原地留下 1.5 秒減速場"],
      } },
    { typeId: 5, name: "牽引", radius: 14, maxHealth: 50, moveSpeed: 60, color: "#ff4dff", scoreValue: 260, mass: 1.2, unlockWave: 8,
      shape: { sides: 12, innerRatio: 0.55 }, telegraphRadius: 130, preferredDistance: 220, attackCooldown: 6, recoveryTime: 1.2,
      dodge: { skill: 0.25, mistakeChance: 0.35 },
      legend: "吸力力場",
      elite: {
        n: "強力牽引",
        hk: 80 / 50,
        sk: 65 / 60,
        cd: 5.0,
        rg: 160,
        fx: ["吸力區更大、持續更久、拉力更強", "吸力期間持續造成輕微傷害", "吸力結束時向外爆發，把你推開並造成傷害"],
      } },
    { typeId: 6, name: "召喚", radius: 16, maxHealth: 70, moveSpeed: 55, color: "#3dffb0", scoreValue: 300, mass: 1.2, unlockWave: 6,
      shape: { sides: 8, innerRatio: 1 }, telegraphRadius: 26, preferredDistance: 300, attackCooldown: 4.5, recoveryTime: 1.1,
      dodge: { skill: 0.2, mistakeChance: 0.35 },
      legend: "生出小怪",
      elite: {
        n: "強化召喚",
        hk: 110 / 70,
        sk: 60 / 55,
        cd: 3.8,
        fx: ["一次召喚 3 隻更快更硬的小怪", "召喚物出生後有 0.8 秒無敵（周圍有保護圈）"],
      } },
    { typeId: 7, name: "雷射", radius: 14, maxHealth: 45, moveSpeed: 65, color: "#ff2a4a", scoreValue: 280, mass: 1.5, unlockWave: 10,
      shape: { sides: 6, innerRatio: 0.45 }, usesLineTelegraph: true, preferredDistance: 320, attackCooldown: 3.2, recoveryTime: 1.3,
      dodge: { skill: 0.6, mistakeChance: 0.15 },
      legend: "瞬發光束",
      elite: {
        n: "連續雷射",
        hk: 70 / 45,
        sk: 70 / 65,
        pref: 340,
        lead: [1e5, null, 0.7],
        fx: ["射線更長更寬，傷害更高；射線末端會打破 1～2 格方塊", "光束持續 0.9 秒，會慢慢轉向追著你", "光束結束後沿路留下一排灼燒地面"],
      } },
    { typeId: 8, name: "衝鋒", radius: 17, maxHealth: 90, moveSpeed: 90, color: "#c0c8ff", scoreValue: 320, mass: 2.5, unlockWave: 11,
      usesLineTelegraph: true, dodge: { skill: 0.1, mistakeChance: 0.4 },
      legend: "蓄力撞擊",
      elite: {
        n: "蓄能衝鋒",
        hk: 140 / 90,
        sk: 95 / 90,
        fx: ["蓄力時會把附近的小怪吸過來", "撞到牆會反彈一次，繼續衝刺", "衝刺結束留下一小塊減速區"],
      } },
    { typeId: 9, name: "築牆", radius: 15, maxHealth: 60, moveSpeed: 60, color: "#ffd23a", scoreValue: 270, mass: 2, unlockWave: 14,
      shape: { sides: 8, innerRatio: 0.5 }, telegraphRadius: 70, preferredDistance: 260, attackCooldown: 5, recoveryTime: 1.2,
      dodge: { skill: 0.3, mistakeChance: 0.3 },
      legend: "圍困玩家",
      elite: {
        n: "動態築牆",
        hk: 95 / 60,
        sk: 65 / 60,
        cd: 4.2,
        fx: ["築出 10 面更耐打的牆，會慢慢向中心收縮", "牆會定期射出小子彈", "牆被打破時會產生小爆炸"],
      } },
    { typeId: 10, name: "環射", radius: 14, maxHealth: 55, moveSpeed: 60, color: "#ff9ad5", scoreValue: 290, mass: 1.2, unlockWave: 9,
      shape: { sides: 14, innerRatio: 0.6 }, telegraphRadius: 34, preferredDistance: 200, attackCooldown: 3, recoveryTime: 1,
      dodge: { skill: 0.3, mistakeChance: 0.3 },
      legend: "旋轉彈環",
      elite: {
        n: "旋轉環射",
        hk: 85 / 55,
        sk: 65 / 60,
        cd: 2.5,
        fx: ["12 發彈環，起始角度會隨時間旋轉", "同時射出外層彈環，外層較快但傷害較低"],
      } },
    { typeId: 11, name: "瞬移", radius: 13, maxHealth: 40, moveSpeed: 70, color: "#7a7aff", scoreValue: 300, mass: 1, unlockWave: 12,
      shape: { sides: 10, innerRatio: 0.5 }, telegraphRadius: 24, preferredDistance: 240, attackCooldown: 2.8, recoveryTime: 0.8,
      dodge: { skill: 0.5, mistakeChance: 0.25 },
      legend: "閃現後連射",
      elite: {
        n: "連閃射擊",
        hk: 60 / 40,
        sk: 75 / 70,
        fx: ["閃現後連射 4 發扇形彈", "閃現的原地會留下殘影，0.3 秒後殘影也開一槍"],
      } },
    { typeId: 12, name: "分裂", radius: 20, maxHealth: 100, moveSpeed: 75, color: "#ff7a5a", scoreValue: 300, mass: 2, unlockWave: 7,
      shape: { sides: 7, innerRatio: 1 }, dodge: { skill: 0.15, mistakeChance: 0.4 },
      legend: "死後分成小怪",
      elite: {
        n: "連鎖分裂",
        hk: 170 / 100,
        sk: 80 / 75,
        fx: ["一次分裂成更多隻，子代也是精英", "分裂時產生擊退波，把你推開"],
      } },
    { typeId: 13, name: "迫擊", radius: 15, maxHealth: 55, moveSpeed: 50, color: "#d4ff3d", scoreValue: 310, mass: 1.5, unlockWave: 13,
      shape: { sides: 16, innerRatio: 0.75 }, telegraphRadius: 90, preferredDistance: 340, attackCooldown: 4.5, recoveryTime: 1.4,
      dodge: { skill: 0.2, mistakeChance: 0.35 },
      legend: "多枚延遲炸彈",
      elite: {
        n: "地毯迫擊",
        hk: 85 / 55,
        sk: 55 / 50,
        cd: 3.8,
        fx: ["一次落下 5 顆炸彈，引爆時間一顆接一顆", "其中 1～2 顆落地時會往你的位置偏一點"],
      } },
    // 後期新增的敵人（沒有指定閃避能力 → 使用預設值）
    { typeId: 26, name: "爆彈客", radius: 12, maxHealth: 28, moveSpeed: 210, color: "#ff9f2a", scoreValue: 140, mass: 1, unlockWave: 6,
      shape: { sides: 3, innerRatio: 1 }, telegraphRadius: 30,
      legend: "衝向你自爆",
      elite: {
        n: "連鎖爆彈客",
        hk: 45 / 28,
        sk: 230 / 210,
        fx: ["爆炸範圍更大、傷害更高", "爆炸後留下 2 顆延遲小炸彈"],
      } },
    { typeId: 27, name: "追蹤者", radius: 13, maxHealth: 45, moveSpeed: 70, color: "#e04dff", scoreValue: 230, mass: 1, unlockWave: 9,
      shape: { sides: 8, innerRatio: 0.6 }, telegraphRadius: 30, preferredDistance: 300, attackCooldown: 3.2, recoveryTime: 0.8,
      legend: "發射追蹤光球",
      elite: {
        n: "多重追蹤",
        hk: 70 / 45,
        sk: 75 / 70,
        pref: 310,
        cd: 2.7,
        fx: ["一次發射 3 顆追蹤光球，轉向更靈敏", "光球接近你時會加速", "每第 3 次攻擊，中間那顆（橘色）飛行途中分裂成 2 顆較弱的光球"],
      } },
    { typeId: 28, name: "治療者", radius: 14, maxHealth: 60, moveSpeed: 60, color: "#6dffb0", scoreValue: 260, mass: 1, unlockWave: 11,
      shape: { sides: 4, innerRatio: 0.55 }, telegraphRadius: 90, preferredDistance: 280, attackCooldown: 4, recoveryTime: 1,
      legend: "治療附近敵人",
      elite: {
        n: "範圍治療者",
        hk: 95 / 60,
        sk: 65 / 60,
        cd: 3.5,
        rg: 110,
        fx: ["治療範圍更大，每次回復 45% 最大血量", "附近沒人需要治療時冷卻縮短為 1 秒", "治療時你會進入「易傷」3 秒（受傷 +15%），並被小範圍擊退"],
      } },
    { typeId: 29, name: "陷阱師", radius: 14, maxHealth: 55, moveSpeed: 65, color: "#c0a060", scoreValue: 240, mass: 1, unlockWave: 13,
      shape: { sides: 6, innerRatio: 0.5 }, telegraphRadius: 60, preferredDistance: 260, attackCooldown: 4.5, recoveryTime: 0.9,
      legend: "佈下減速陷阱",
      elite: {
        n: "多重陷阱",
        hk: 85 / 55,
        sk: 70 / 65,
        rg: 70,
        fx: ["一次佈下 3 個減速陷阱（波數 14 後 4 個），範圍更大、持續更久", "橘色陷阱：踩到會爆炸；藍色陷阱：踩到會強力減速"],
      } },
    { name: "毒霧", radius: 15, maxHealth: 45, moveSpeed: 60, color: "#3dff67", scoreValue: 280, mass: 2.3, unlockWave: 10,
      shape: { sides: 15, innerRatio: 1 }, telegraphRadius: 90, preferredDistance: 340, attackCooldown: 5, recoveryTime: 1.4,
      dodge: { skill: 0.2, mistakeChance: 0.7 },
      legend: "發射毒霧彈，命中會中毒",
      attack: { bullet: "POISON_ORB", count: 3, spread: 0.5 } },
  ];

  /** @type {Map<number, EnemyDefinition>} */
  #definitions = new Map();

  constructor() {
    let nextAuto = AUTO_ENEMY_ID_BASE;
    for (const row of EnemyCatalog.#ROWS) {
      let typeId = row.typeId;
      if (typeId == null) { while (this.#definitions.has(nextAuto)) nextAuto++; typeId = nextAuto++; }
      if (this.#definitions.has(typeId)) throw new Error(`重複的敵人編號：${typeId}`);
      this.#definitions.set(typeId, new EnemyDefinition({ ...row, typeId }));
    }
  }

  /** 依編號對照的精英資料表（只含有 elite 的敵人；唯讀） */
  eliteTable() {
    return Object.freeze(Object.fromEntries(this.all().filter((d) => d.elite).map((d) => [d.typeId, d.elite])));
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
  /** 以名稱查詢；找不到會丟出錯誤（程式裡想指名某種敵人時用，不必記編號） */
  byName(name) {
    const def = [...this.#definitions.values()].find((d) => d.name === name);
    if (!def) throw new RangeError(`未知的敵人名稱：${String(name)}`);
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
