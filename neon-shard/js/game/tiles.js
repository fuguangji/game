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
 *   density    (stage) => 0~1：每格出現的機率；stage 是目前關卡（STG 的一列）。省略或 0 = 不自動生成
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
export function placeTiles(stage) {
  G.tile = new Uint16Array(N * N);
  if (!TILES.length) return;
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const idx = j * N + i;
      if (G.grid[idx] !== 0 || Math.max(Math.abs(i - CENTER), Math.abs(j - CENTER)) <= SAFE_RADIUS) continue;
      for (let k = 0; k < TILES.length; k++) {
        const t = TILES[k], d = t.density?.(stage) ?? 0;
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
registerTile({
  name: "炸藥桶", color: "#ffaa00", solid: true, hp: 1,
  density: (stage) => stage >= 3 ? 0.01 : 0,
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
  density: (stage) => 0.02,
  onStand(p, dt, { applyStatus }) {
    applyStatus(p, "fast", 0.1);
  },
  draw(cx, x, y, size) {
    cx.save();
    cx.fillStyle = "#00bfff";
    cx.fillRect(x + 2, y + 2, size - 4, size - 4);
    cx.strokeStyle = "#00bfffb7";
    cx.lineWidth = 3;
    cx.strokeRect(x + 2, y + 2, size - 4, size - 4);
    cx.restore();
  }
});
registerTile({
  name: "岩漿地板", color: "#ff3300", solid: false,
  density: (stage) => stage >= 5 ? 0.02 : 0,
  onStand(p, dt, { applyStatus }) {
    applyStatus(p, "burn", 10);
  },
  draw(cx, x, y, size) {
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
  density: (stage) => stage >= 10 ? 0.02 : 0,
  onStand(p, dt, { applyStatus }) {
    applyStatus(p, "poison", 0.5);
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
