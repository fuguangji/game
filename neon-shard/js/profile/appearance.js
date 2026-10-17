/**
 * 角色外觀：手繪皮膚的資料、驗證與繪製，以及職業光環。
 *
 * 所見即所得：編輯器與遊戲共用同一個 paintStrokes()。
 * 編輯器畫布是 360px，角色圓圈半徑 145px；遊戲裡把「圓圈」對應到玩家身體半徑，
 * 因此位置與筆畫粗細都按「圓圈半徑」換算（舊版把整張畫布拉伸到身體上、粗細又乘 r/18，兩邊看起來差很多）。
 * 玩家半徑只有約 12px，細筆會細到看不見，所以遊戲內有最小線寬。
 */
export const SKIN_KEY = "neon-shard.custom-skin.v1"; // 沿用舊鍵名，既有玩家的外觀不會遺失
export const EDITOR_SIZE = 360;
export const EDITOR_BODY_RADIUS = 145;
export const EDITOR_BODY_RATIO = EDITOR_BODY_RADIUS / EDITOR_SIZE;
export const MAX_STROKES = 200;
export const MAX_POINTS = 1000;
export const MIN_BRUSH = 1;
export const MAX_BRUSH = 20;
/** 遊戲內（玩家半徑約 12px）筆畫的最小線寬，避免細筆看不見 */
export const MIN_IN_GAME_LINE_WIDTH = 1.1;
const DEFAULT_COLOR = "#ff4dff";
const COLOR = /^#[0-9a-f]{6}$/i;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 把任意資料整理成安全的筆畫：數量、顏色、粗細、座標都限制在合理範圍；回傳新陣列，不修改輸入 */
export function sanitizeStrokes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const stroke of raw.slice(0, MAX_STROKES)) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 1) continue;
    out.push({
      color: COLOR.test(stroke.color) ? stroke.color.toLowerCase() : DEFAULT_COLOR,
      width: clamp(Number(stroke.width) || 5, MIN_BRUSH, MAX_BRUSH),
      points: stroke.points.slice(0, MAX_POINTS).map((p) => ({ x: clamp(Number(p?.x) || 0, 0, 1), y: clamp(Number(p?.y) || 0, 0, 1) })),
    });
  }
  return out;
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** 皮膚資料：載入／儲存時驗證一次並快取；渲染迴圈直接讀快取，不再每一幀碰 localStorage */
export class SkinStore extends EventTarget {
  #storage;
  #key;
  #strokes = null; // null = 尚未讀取
  #revision = 0;

  constructor(storage = defaultStorage(), key = SKIN_KEY) {
    super();
    this.#storage = storage;
    this.#key = key;
  }

  /** 每次內容改變就加一；繪製快取靠它判斷是否過期 */
  get revision() { return this.#revision; }

  /** 目前的筆畫（已驗證、已快取；不要修改它——要改請複製一份再 save） */
  get strokes() {
    if (this.#strokes === null) {
      try { this.#strokes = sanitizeStrokes(JSON.parse(this.#storage?.getItem(this.#key) ?? "[]")); } catch { this.#strokes = []; }
    }
    return this.#strokes;
  }

  #commit(strokes, persist) {
    this.#strokes = strokes;
    this.#revision++;
    if (persist) {
      try { strokes.length ? this.#storage?.setItem(this.#key, JSON.stringify(strokes)) : this.#storage?.removeItem(this.#key); } catch { /* 容量滿或隱私模式：只留在記憶體 */ }
    }
    this.dispatchEvent(new Event("change"));
  }

  /** @returns {boolean} 是否成功寫入本機（false 代表只保留在這次瀏覽中） */
  save(strokes) {
    const clean = sanitizeStrokes(strokes);
    let persisted = true;
    try { this.#storage?.setItem(this.#key, JSON.stringify(clean)); } catch { persisted = false; }
    this.#commit(clean, false);
    return persisted;
  }

  clear() { this.#commit([], true); }

  /** 其他分頁修改外觀時，讓本分頁重新讀取 */
  watch(target = globalThis) {
    target.addEventListener?.("storage", (e) => {
      if (e.key !== this.#key && e.key !== null) return;
      this.#strokes = null;
      this.#revision++;
      this.dispatchEvent(new Event("change"));
    });
  }
}

/**
 * 在「原點在圓心」的 ctx 上，把筆畫裁切成半徑 radius 的圓並畫出（編輯器與遊戲共用）。
 * @param {{minLineWidth?: number}} [options] minLineWidth：最小線寬（遊戲內用；編輯器放大檢視不需要）
 */
export function paintStrokes(ctx, strokes, radius, { minLineWidth = 0 } = {}) {
  if (!strokes.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(minLineWidth, (stroke.width * radius) / EDITOR_BODY_RADIUS);
    stroke.points.forEach((p, i) => {
      const x = ((p.x - 0.5) / EDITOR_BODY_RATIO) * radius;
      const y = ((p.y - 0.5) / EDITOR_BODY_RATIO) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (stroke.points.length === 1) ctx.lineTo(((stroke.points[0].x - 0.5) / EDITOR_BODY_RATIO) * radius + 0.01, ((stroke.points[0].y - 0.5) / EDITOR_BODY_RATIO) * radius); // 單點也畫出一個圓點
    ctx.stroke();
  }
  ctx.restore();
}

function createSurface(px) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(px, px);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  return canvas;
}

/**
 * 遊戲內的皮膚繪製：先把皮膚畫到一張離屏貼圖，之後每一幀只做一次 drawImage。
 * 貼圖在「皮膚內容」或「螢幕上的實際大小」改變時才重畫。
 */
export class SkinRenderer {
  #store;
  #surface = null;
  #key = "";

  constructor(store) { this.#store = store; }

  /**
   * @param {CanvasRenderingContext2D} ctx 原點已平移到玩家中心
   * @param {number} radius 玩家半徑（遊戲座標）
   * @param {number} [pixelScale] 遊戲座標到裝置像素的倍率（縮放 × 像素比），用來決定貼圖解析度
   */
  draw(ctx, radius, pixelScale = 1) {
    const strokes = this.#store.strokes;
    if (!strokes.length) return;
    const px = clamp(Math.round(radius * 2 * pixelScale * 2), 32, 512); // 2 倍超取樣
    const key = `${this.#store.revision}:${px}:${radius}`;
    if (key !== this.#key) {
      this.#surface = createSurface(px);
      const sctx = this.#surface.getContext("2d");
      sctx.scale(px / (radius * 2), px / (radius * 2));
      sctx.translate(radius, radius);
      paintStrokes(sctx, strokes, radius, { minLineWidth: MIN_IN_GAME_LINE_WIDTH });
      this.#key = key;
    }
    ctx.drawImage(this.#surface, -radius, -radius, radius * 2, radius * 2);
  }
}

/** 職業代表色粒子光環：只影響視覺，不改變碰撞或戰鬥數值 */
export function drawRoleAura(ctx, radius, color, time) {
  const TAU = Math.PI * 2;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  for (let i = 0; i < 12; i++) {
    const angle = time * 0.9 + (i * TAU) / 12;
    const r = radius + 8 + 2.5 * Math.sin(time * 2.4 + i * 1.7);
    ctx.globalAlpha = 0.42 + 0.5 * (0.5 + 0.5 * Math.sin(time * 2.5 + i));
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * r, Math.sin(angle) * r, 1.1 + 0.65 * (0.5 + 0.5 * Math.sin(time * 3 + i)), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** 全域共用的皮膚資料與繪製器 */
export const skinStore = new SkinStore();
skinStore.watch();
export const skinRenderer = new SkinRenderer(skinStore);
