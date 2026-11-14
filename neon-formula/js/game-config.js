/** 與敵人、子彈、Boss 無關的遊戲設定（敵方單位設定已搬到 config/） */
import { enemyCatalog } from "./config/index.js";

export const PC = {
  chip: "#9dff3d",
  shard: "#4de1ff",
  core: "#ff4dff",
  coin: "#d9c98a",
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

/** 圖鑑「圖例」：敵人部分由 enemy-catalog.js 的 legend 欄位產生（有寫 legend 的才會列出），最後兩筆是子彈 */
export const LEG_B = [
  ...enemyCatalog.all().filter((d) => d.legend).map((d) => [`e${d.typeId}`, d.color, `${d.name} · ${d.legend}`]),
  ["pb", "#8fe3cf", "我方子彈 · 薄荷色拖尾"],
  ["eb", "#ff5a7a", "敵方子彈 · 空心圓"],
];
export const PSPD = 95;
export const REGEN = 1.2;
