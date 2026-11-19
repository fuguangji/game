/**
 * 存檔合併：兩台裝置各自玩了一段時間後，把進度「合起來」而不是二選一覆蓋。
 *
 * 做法是三方合併：除了本機（local）與雲端（remote），還要有「上一次同步成功時的存檔」（base）。
 * 只要知道 base，就能分辨「這一邊改了什麼」：
 *   貨幣（金幣、碎片、晶核）  base + 本機的變化 + 雲端的變化。例：一台賺了 +300、另一台花了 -200 → 合起來 +100。
 *   數量表（晶片、背包道具）  逐項用同樣的方式合併（道具上限 9）。
 *   集合（擁有的武器、角色）  聯集：任何一台買到的都保留。
 *   通關、最佳波數           逐格取較大值：進度只會往前。
 *   強化等級                 逐項取較大值。
 *   選擇（選的關卡、角色、背包配置、武器的晶片配置）
 *                            只有一邊改過就用那一邊；兩邊都改過用本機（你正在玩的這台）。
 *
 * 沒有 base 的時候（這台裝置從沒同步過，兩邊卻都有進度），貨幣不能用「加總」——
 * 有可能兩邊其實是同一份進度的不同時間點，加起來會讓貨幣憑空翻倍。這時一律取較大值。
 *
 * 全部是純函式：不會修改傳入的物件，也不碰遊戲的全域狀態，方便測試。
 */

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clone = (v) => JSON.parse(JSON.stringify(v));

/** 鍵排序後的 JSON：內容相同就得到相同的字串（用來比較兩份存檔是否一樣） */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlain(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export const sameSave = (a, b) => stableStringify(a) === stableStringify(b);

/** 還是剛開始的新存檔（和預設值完全一樣） */
export const isPristine = (save, defaults) => sameSave(save, defaults);

/** 每個欄位的合併規則；沒列出的欄位（未來新增的）用 "pick"，不會漏掉也不會亂加 */
export const MERGE_RULES = Object.freeze({
  coins: "currency",
  sh: "currency",
  co: "currency",
  chips: "countMap",
  items: "countMap",
  up: "maxMap",
  own: "union",
  chars: "union",
  clr: "maxList",
  sb: "maxList",
  mods: "pickMap",
  sel: "pick",
  char: "pick",
  bagSel: "pick",
  sv: "max",
});

/** 數量表有上限的欄位（背包道具最多 9 個，見 menu-shop.js） */
const COUNT_CAPS = Object.freeze({ items: 9 });

const mergeNumber = (b, l, r, hasBase) => Math.max(0, Math.round(hasBase ? num(l) + num(r) - num(b) : Math.max(num(l), num(r))));

/** 只有一邊改過就用那一邊；兩邊都改過、或都沒改，用本機 */
function pick(b, l, r, hasBase) {
  if (!hasBase) return l !== undefined ? l : r;
  const lChanged = stableStringify(l) !== stableStringify(b);
  const rChanged = stableStringify(r) !== stableStringify(b);
  if (!lChanged && rChanged) return r;
  return l !== undefined ? l : r;
}

const keysOf = (...objs) => [...new Set(objs.flatMap((o) => (isPlain(o) ? Object.keys(o) : [])))];

function mergeField(rule, field, b, l, r, hasBase) {
  switch (rule) {
    case "currency":
      return mergeNumber(b, l, r, hasBase);
    case "max":
      return Math.max(num(l), num(r));
    case "countMap": {
      const out = {};
      for (const k of keysOf(b, l, r)) {
        const n = mergeNumber(b?.[k], l?.[k], r?.[k], hasBase);
        out[k] = COUNT_CAPS[field] ? Math.min(COUNT_CAPS[field], n) : n;
      }
      return out;
    }
    case "maxMap": {
      const out = {};
      for (const k of keysOf(l, r)) out[k] = Math.max(num(l?.[k]), num(r?.[k]));
      return out;
    }
    case "union":
      return [...new Set([...(Array.isArray(l) ? l : []), ...(Array.isArray(r) ? r : [])].filter((v) => Number.isFinite(v)))];
    case "maxList": {
      const la = Array.isArray(l) ? l : [], ra = Array.isArray(r) ? r : [];
      return Array.from({ length: Math.max(la.length, ra.length) }, (_, i) => Math.max(num(la[i]), num(ra[i])));
    }
    case "pickMap": {
      const out = {};
      for (const k of keysOf(b, l, r)) {
        const v = pick(b?.[k], l?.[k], r?.[k], hasBase);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    default:
      return pick(b, l, r, hasBase);
  }
}

/**
 * @param {{base?: object|null, local: object, remote: object, defaults: object}} input
 * @returns {{save: object, changed: {local: string[], remote: string[]}}}
 *   save = 合併結果（以 defaults 為底，欄位齊全）；changed = 相對於 base，兩邊各自改過哪些欄位（沒有 base 時兩個都是空的）
 */
export function mergeSaves({ base = null, local, remote, defaults }) {
  const hasBase = isPlain(base);
  const save = clone(defaults);
  const changed = { local: [], remote: [] };
  for (const field of keysOf(defaults, local, remote, hasBase ? base : null)) {
    if (field === "__proto__" || field === "constructor" || field === "prototype") continue;
    const b = hasBase ? base[field] : undefined;
    const l = local?.[field], r = remote?.[field];
    if (hasBase) {
      if (stableStringify(l) !== stableStringify(b)) changed.local.push(field);
      if (stableStringify(r) !== stableStringify(b)) changed.remote.push(field);
    }
    const merged = mergeField(MERGE_RULES[field] ?? "pick", field, b, l, r, hasBase);
    if (merged !== undefined) save[field] = merged;
  }
  return { save, changed };
}
