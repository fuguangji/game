/**
 * game/tiles — 特殊地圖方塊註冊表（岩漿地板、炸藥桶、冰面…）
 *
 * 想新增一種方塊：在檔案最下面的「方塊清單」區加一個 registerTile({...})，不用改地圖生成、
 * 碰撞、繪製、打破的任何程式。方塊編號由註冊順序自動配發，不必記、也沒有數量限制。
 *
 * 運作方式：地圖仍然是 G.grid（0 = 空地、-1 = 外牆、>0 = 可打破方塊的血量）；
 * 特殊方塊另外記在 G.tile（同樣大小的圖層，存方塊編號，0 = 一般）。
 *   solid: false  可走的地板。grid 保持 0，所以碰撞、子彈、尋路完全不受影響。
 *   solid: true   實心可打破。grid 存血量（hp），碰撞與尋路照一般方塊處理。
 *
 * 方塊定義：
 *   name       名稱（除錯與錯誤訊息用）
 *   solid      見上；預設 false
 *   hp         solid 方塊的血量，1~6；預設 3
 *   color      預設繪製顏色（#rrggbb）
 *   density    (stage, index) => 0~1：每格出現的機率；stage 是目前關卡（STG 的一列），index 是關卡編號（STG 的索引，0 起算；無盡模式是最後一個）。省略或 0 = 不自動生成
 *   onStand    (p, dt, api) 玩家站在地板上時每幀呼叫（api = { hurt, applyStatus }）
 *   onBreak    (x, y, api) solid 方塊被打破時呼叫（x, y 是世界座標；api = { zones: G.zones }）
 *   draw       (cx, x, y, size, time) 自訂繪製（省略就畫 color 色塊）
 */
import { G } from "../core/game-state.js";
import { N, T } from "../core/viewport.js";

/** 玩家出生區半徑（格）：這個範圍內不生成特殊方塊，與 genMap 的安全區一致 */
const SAFE_RADIUS = 5;
const CENTER = 22;

/** @type {Array<Readonly<object>>} 索引 + 1 = 方塊編號 */
const TILES = [];

/** 註冊一種方塊，回傳自動配發的編號 */
export function registerTile(def) {
  if (typeof def?.name !== "string" || !def.name) throw new TypeError("方塊需要 name");
  if (!/^#[0-9a-f]{6}$/i.test(def.color ?? "")) throw new TypeError(`方塊「${def.name}」的 color 必須是 #rrggbb`);
  const hp = def.hp ?? 3;
  if (def.solid && !(Number.isInteger(hp) && hp >= 1 && hp <= 6)) throw new RangeError(`方塊「${def.name}」的 hp 必須是 1~6 的整數`);
  if (TILES.some((t) => t.name === def.name)) throw new Error(`重複的方塊名稱：${def.name}`);
  TILES.push(Object.freeze({ solid: false, ...def, hp }));
  return TILES.length;
}

/** 清掉所有註冊（只給測試用） */
export function unregisterAllTiles() {
  TILES.length = 0;
}

/** 以編號查詢方塊定義；0 或沒有回傳 null */
export const tileDef = (id) => (id > 0 ? TILES[id - 1] ?? null : null);

/** 某格的特殊方塊定義；沒有圖層（例如教學關）或沒有特殊方塊回傳 null */
export const tileAt = (i, j) => (G.tile && i >= 0 && j >= 0 && i < N && j < N ? tileDef(G.tile[j * N + i]) : null);

/** 建立新的方塊圖層，並依各方塊的 density 隨機放置。genMap 在填好 grid 之後呼叫 */
export function placeTiles(stage, index = 0) {
  G.tile = new Uint16Array(N * N);
  if (!TILES.length) return;
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const idx = j * N + i;
      if (G.grid[idx] !== 0 || Math.max(Math.abs(i - CENTER), Math.abs(j - CENTER)) <= SAFE_RADIUS) continue;
      for (let k = 0; k < TILES.length; k++) {
        const t = TILES[k], d = t.density?.(stage, index) ?? 0;
        if (d > 0 && Math.random() < d) {
          G.tile[idx] = k + 1;
          if (t.solid) G.grid[idx] = t.hp;
          break;
        }
      }
    }
}

/** 玩家站在可走的特殊地板上時，每幀呼叫 */
export function standOnTile(p, dt, api) {
  const def = tileAt(Math.floor(p.x / T), Math.floor(p.y / T));
  if (def && !def.solid) def.onStand?.(p, dt, api);
}

/** 實心方塊被打破：清掉圖層標記並呼叫 onBreak。hitCell 在血量歸零時呼叫 */
export function breakTile(i, j, x, y, api) {
  const def = tileAt(i, j);
  if (!def) return;
  G.tile[j * N + i] = 0;
  def.onBreak?.(x, y, api);
}

/** 繪製特殊方塊（只畫畫面範圍內的格子）。render.js 在畫完一般方塊後呼叫 */
export function drawTiles(cx, i0, i1, j0, j1, time) {
  if (!G.tile || !TILES.length) return;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const def = tileDef(G.tile[j * N + i]);
      if (!def) continue;
      const x = i * T, y = j * T;
      if (def.draw) { def.draw(cx, x, y, T, time); continue; }
      cx.save();
      if (def.solid) {
        cx.strokeStyle = def.color;
        cx.lineWidth = 3;
        cx.strokeRect(x + 5, y + 5, T - 10, T - 10);
      } else {
        cx.fillStyle = def.color + "55";
        cx.fillRect(x + 2, y + 2, T - 4, T - 4);
      }
      cx.restore();
    }
}

/* ───────────── 方塊清單：新增方塊從這裡開始（範例見 README） ───────────── */
/** 關卡編號（STG 索引）：0 訓練場、1 霓虹街區、2 數據峽谷、3 虛空核心、4 冰封港灣、5 毒蜂巢穴、6 虛空裂隙、7 終焉之塔、8 熔岩熔爐、9 雷暴平原、10 棱鏡迴廊、11 終焉黎明、12 無盡深淵 */
registerTile({
  name: "炸藥桶", color: "#ffaa00", solid: true, hp: 1,
  density: (_stage, index) => (index >= 2 ? 0.012 : 0),
  onBreak(x, y, { zones }) {
    zones.push({ k: "bomb", x, y, r: 90, t: 0.3, max: 0.3, col: "#ff9f2a", dmg: 30 });
  },
  draw(cx, x, y, size) {
    cx.save();
    cx.fillStyle = "#ff9f2a";
    cx.fillRect(x + 4, y + 4, size - 8, size - 8);
    cx.strokeStyle = "#000000";
    cx.lineWidth = 4;
    cx.strokeRect(x + 4, y + 4, size - 8, size - 8);
    cx.restore();
  }
});
registerTile({
  name: "冰面", color: "#a0e0ff", solid: false,
  density: (_stage, index) => (index === 4 ? 0.07 : index === 12 ? 0.02 : 0),
  onStand(p, dt, { applyStatus }) {
    applyStatus(p, "fast", { duration: 0.1 });
  },
  draw(cx, x, y, size) {
    cx.save();
    cx.fillStyle = "#00bfff55";
    cx.fillRect(x + 2, y + 2, size - 4, size - 4);
    cx.strokeStyle = "#7fdcffb7";
    cx.lineWidth = 3;
    cx.strokeRect(x + 2, y + 2, size - 4, size - 4);
    cx.restore();
  }
});
registerTile({
  name: "岩漿地板", color: "#ff3300", solid: false,
  density: (_stage, index) => (index === 8 ? 0.06 : index === 11 ? 0.04 : [3, 7].includes(index) ? 0.03 : index === 12 ? 0.02 : 0),
  onStand(p, dt, { applyStatus }) {
    applyStatus(p, "burn", { duration: 2.5 }); // 離開後再燒 2.5 秒（原本 10 秒，踩一下就燒太久）
  },
  draw(cx, x, y, size, time) {
    cx.save();
    cx.fillStyle = "#ff330055";
    cx.fillRect(x + 2, y + 2, size - 4, size - 4);
    cx.strokeStyle = "#ff0000";
    cx.lineWidth = 3;
    cx.strokeRect(x + 2, y + 2, size - 4, size - 4);
    cx.restore();
  }
});
registerTile({
  name: "毒氣地板", color: "#00ff00", solid: false,
  density: (_stage, index) => (index === 5 ? 0.06 : [6, 12].includes(index) ? 0.02 : 0),
  onStand(p, dt, { applyStatus }) {
    applyStatus(p, "poison", { duration: 0.5 });
  },
  draw(cx, x, y, size) {
    cx.save();
    cx.fillStyle = "#00ff0055";
    cx.fillRect(x + 2, y + 2, size - 4, size - 4);
    cx.strokeStyle = "#00aa00";
    cx.lineWidth = 3;
    cx.strokeRect(x + 2, y + 2, size - 4, size - 4);
    cx.restore();
  }
});
registerTile({
  name: "磁化地板", color: "#ffe14a", solid: false,
  density: (_stage, index) => (index === 9 ? 0.06 : index === 10 ? 0.03 : index === 12 ? 0.02 : 0),
  onStand(p, dt, { applyStatus }) {
    applyStatus(p, "slow", { duration: 0.4 }); // 踩在磁場上被吸住：移動變慢
  },
  draw(cx, x, y, size, time) {
    cx.save();
    cx.fillStyle = "#ffe14a22";
    cx.fillRect(x + 2, y + 2, size - 4, size - 4);
    cx.strokeStyle = "#ffe14a";
    cx.globalAlpha = 0.55 + 0.25 * Math.sin(time * 4 + x * 0.01);
    cx.lineWidth = 2;
    cx.strokeRect(x + 5, y + 5, size - 10, size - 10);
    cx.beginPath();
    cx.moveTo(x + size * 0.35, y + size * 0.3);
    cx.lineTo(x + size * 0.55, y + size * 0.5);
    cx.lineTo(x + size * 0.42, y + size * 0.5);
    cx.lineTo(x + size * 0.62, y + size * 0.72);
    cx.stroke();
    cx.restore();
  }
});
registerTile({
  name: "治療泉", color: "#3dff8f", solid: false,
  density: (_stage, index) => (index >= 1 ? 0.006 : 0),
  onStand(p, dt) {
    p.hp = Math.min(p.mhp, p.hp + 6 * dt); // 站著每秒回 6 點血
  },
  draw(cx, x, y, size, time) {
    const c = size / 2, pulse = 0.6 + 0.25 * Math.sin(time * 3 + x * 0.02);
    cx.save();
    cx.fillStyle = "#3dff8f22";
    cx.fillRect(x + 2, y + 2, size - 4, size - 4);
    cx.globalAlpha = pulse;
    cx.strokeStyle = "#3dff8f";
    cx.lineWidth = 3;
    cx.beginPath();
    cx.moveTo(x + c, y + size * 0.25);
    cx.lineTo(x + c, y + size * 0.75);
    cx.moveTo(x + size * 0.25, y + c);
    cx.lineTo(x + size * 0.75, y + c);
    cx.stroke();
    cx.restore();
  }
});
