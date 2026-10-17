/** 與敵人、子彈、Boss 無關的遊戲設定（敵方單位設定已搬到 config/） */
export const PC = {
  chip: "#9dff3d",
  shard: "#4de1ff",
  core: "#ff4dff",
  coin: "#ffd23a",
  heal: "#3dff8f",
  ammo: "#ffe14a",
  shield: "#4d9bff",
  speed: "#ffffff",
};

export const PN = ["heal", "ammo", "shield", "speed"];

export const LEG_A = [
  ["heal", "補血 +30 HP"],
  ["ammo", "彈藥 全槍 +40% · 能量 +25"],
  ["shield", "護盾 +30 吸收"],
  ["speed", "加速 6 秒"],
  ["coin", "金幣 · 用來解鎖槍械"],
  ["shard", "碎片 · 基礎永久升級（方塊、敵人掉落）"],
  ["core", "晶核 · 進階永久升級和芯片包（強敵、Boss 掉落）"],
  ["chip", "芯片 · Boss 掉落，顏色代表稀有度（灰 / 綠 / 藍 / 紫 / 金），可裝到槍上"],
];

export const LEG_B = [
  ["e0", "#ff3d9a", "追擊 · 貼身衝撞"],
  ["e1", "#ff9a3d", "狙擊 · 預判單發"],
  ["e2", "#b45cff", "散射 · 5 發扇形"],
  ["e3", "#9dff3d", "投擲 · 延遲炸彈"],
  ["e4", "#4de1ff", "緩速 · 命中減速"],
  ["e5", "#ff4dff", "牽引 · 吸力力場"],
  ["e6", "#3dffb0", "召喚 · 生出小怪"],
  ["e7", "#ff2a4a", "雷射 · 瞬發光束"],
  ["e8", "#c0c8ff", "衝鋒 · 蓄力撞擊"],
  ["e9", "#ffd23a", "築牆 · 圍困玩家"],
  ["e10", "#ff9ad5", "環射 · 旋轉彈環"],
  ["e11", "#7a7aff", "瞬移 · 閃現後連射"],
  ["e12", "#ff7a5a", "分裂 · 死後分成小怪"],
  ["e13", "#d4ff3d", "迫擊 · 多枚延遲炸彈"],
  ["e26", "#ff9f2a", "爆彈客 · 衝向你自爆"],
  ["e27", "#e04dff", "追蹤者 · 發射追蹤光球"],
  ["e28", "#6dffb0", "治療者 · 治療附近敵人"],
  ["e29", "#c0a060", "陷阱師 · 佈下減速陷阱"],
  ["pb", "#22e6ff", "我方子彈 · 青色拖尾"],
  ["eb", "#ff5a7a", "敵方子彈 · 空心圓"],
];
export const PSPD = 95;
export const REGEN = 1.2;
