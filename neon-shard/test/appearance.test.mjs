import test from "node:test";
import assert from "node:assert/strict";
import { EDITOR_BODY_RADIUS, EDITOR_BODY_RATIO, MAX_STROKES, MIN_IN_GAME_LINE_WIDTH, SkinStore, paintStrokes, sanitizeStrokes } from "../js/profile/appearance.js";
import { SETTING_DEFAULTS, SettingsStore } from "../js/core/settings-store.js";
import { KEYS, SaveStore } from "../js/core/save-store.js";

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m }; };
/** 記錄所有繪圖呼叫的假 ctx */
function recorder() {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => k === "calls" ? calls : (...a) => { calls.push([k, ...a]); }, set: (_, k, v) => { calls.push(["set", k, v]); return true; } });
  return { ctx, calls, sets: (name) => calls.filter((c) => c[0] === "set" && c[1] === name).map((c) => c[2]), of: (name) => calls.filter((c) => c[0] === name) };
}
const stroke = (points, width = 5, color = "#ff4dff") => ({ color, width, points });

test("sanitizeStrokes：壞資料被整理成安全範圍，且不修改輸入", () => {
  assert.deepEqual(sanitizeStrokes(null), []);
  assert.deepEqual(sanitizeStrokes("x"), []);
  const input = [{ color: "javascript:alert(1)", width: 999, points: [{ x: -5, y: 9 }, { x: "a", y: NaN }] }, { points: [] }, null];
  const snapshot = JSON.stringify(input);
  const out = sanitizeStrokes(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(out.length, 1);
  assert.equal(out[0].color, "#ff4dff");
  assert.equal(out[0].width, 20);
  assert.deepEqual(out[0].points, [{ x: 0, y: 1 }, { x: 0, y: 0 }]);
  assert.equal(sanitizeStrokes(Array.from({ length: 500 }, () => stroke([{ x: 0.5, y: 0.5 }]))).length, MAX_STROKES);
});

test("所見即所得：編輯器圓圈的邊緣 = 遊戲身體的邊緣；線寬依圓圈半徑換算", () => {
  const edge = 0.5 + EDITOR_BODY_RATIO; // 編輯器圓圈右緣
  for (const radius of [12, 32, EDITOR_BODY_RADIUS]) {
    const r = recorder();
    paintStrokes(r.ctx, [stroke([{ x: edge, y: 0.5 }, { x: 0.5, y: 0.5 }], 5)], radius);
    const [, x, y] = r.of("moveTo")[0];
    assert.ok(Math.abs(x - radius) < 1e-9 && Math.abs(y) < 1e-9, `半徑 ${radius}：圓圈右緣應落在 (${radius}, 0)，實際 (${x}, ${y})`);
    assert.deepEqual(r.of("arc")[0].slice(1, 4), [0, 0, radius], "裁切圓半徑等於身體半徑");
    assert.ok(Math.abs(r.sets("lineWidth")[0] - (5 * radius) / EDITOR_BODY_RADIUS) < 1e-9);
  }
  // 編輯器本身（半徑 145）：粗細就是筆刷像素值，與畫布上看到的一致
  const r = recorder(); paintStrokes(r.ctx, [stroke([{ x: 0.5, y: 0.5 }], 9)], EDITOR_BODY_RADIUS);
  assert.equal(r.sets("lineWidth")[0], 9);
});

test("遊戲內最小線寬：細筆不會細到看不見；粗筆維持比例", () => {
  const thin = recorder(); paintStrokes(thin.ctx, [stroke([{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }], 5)], 12, { minLineWidth: MIN_IN_GAME_LINE_WIDTH });
  assert.equal(thin.sets("lineWidth")[0], MIN_IN_GAME_LINE_WIDTH);
  const thick = recorder(); paintStrokes(thick.ctx, [stroke([{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }], 20)], 12, { minLineWidth: MIN_IN_GAME_LINE_WIDTH });
  assert.ok(Math.abs(thick.sets("lineWidth")[0] - (20 * 12) / EDITOR_BODY_RADIUS) < 1e-9);
  assert.ok(thick.sets("lineWidth")[0] > MIN_IN_GAME_LINE_WIDTH);
});

test("SkinStore：載入時驗證並快取；儲存失敗會回報；改動時 revision 增加", () => {
  const st = memStorage();
  st.setItem("k", JSON.stringify([{ color: "bad", width: 1000, points: [{ x: 2, y: 2 }] }]));
  const store = new SkinStore(st, "k");
  assert.equal(store.strokes[0].color, "#ff4dff");
  assert.equal(store.strokes, store.strokes, "同一份快取，不會每次重新解析");
  const rev = store.revision;
  assert.equal(store.save([stroke([{ x: 0.2, y: 0.2 }])]), true);
  assert.ok(store.revision > rev);
  assert.equal(JSON.parse(st.getItem("k")).length, 1);
  store.clear();
  assert.equal(st.getItem("k"), null);
  const full = new SkinStore({ getItem: () => null, setItem() { throw new Error("quota"); }, removeItem() {} }, "k");
  assert.equal(full.save([stroke([{ x: 0.5, y: 0.5 }])]), false, "空間滿：回傳 false，但記憶體中仍有效");
  assert.equal(full.strokes.length, 1);
  assert.deepEqual(new SkinStore(memStorage(), "none").strokes, []);
  const broken = memStorage(); broken.setItem("k", "{oops");
  assert.deepEqual(new SkinStore(broken, "k").strokes, []);
});

test("SkinStore：其他分頁修改時重新讀取", () => {
  const st = memStorage(); const store = new SkinStore(st, "k");
  const bus = new EventTarget(); store.watch(bus);
  assert.equal(store.strokes.length, 0);
  st.setItem("k", JSON.stringify([stroke([{ x: 0.1, y: 0.1 }])]));
  let changed = 0; store.addEventListener("change", () => changed++);
  bus.dispatchEvent(Object.assign(new Event("storage"), { key: "k" }));
  assert.equal(store.strokes.length, 1); assert.equal(changed, 1);
  bus.dispatchEvent(Object.assign(new Event("storage"), { key: "other" }));
  assert.equal(changed, 1, "不相關的鍵不應觸發");
});

test("SettingsStore：預設值、型別驗證、持久化、損毀資料與重設", () => {
  const st = memStorage(); const store = new SettingsStore(new SaveStore(st));
  assert.deepEqual(store.all(), { ...SETTING_DEFAULTS });
  let events = 0; store.addEventListener("change", () => events++);
  store.set("showAura", false); store.set("showAura", false);
  assert.equal(events, 1, "值沒變就不觸發事件");
  assert.equal(JSON.parse(st.getItem(KEYS.settings)).showAura, false);
  assert.throws(() => store.set("showAura", "yes"), TypeError);
  assert.throws(() => store.set("nope", true), RangeError);
  assert.throws(() => store.get("nope"), RangeError);
  assert.equal(new SettingsStore(new SaveStore(st)).get("showAura"), false, "重新載入後保留");
  const bad = memStorage(); bad.setItem(KEYS.settings, JSON.stringify({ showAura: "x", showSkin: false, evil: 1, __proto__: { x: 1 } }));
  const loaded = new SettingsStore(new SaveStore(bad));
  assert.deepEqual(loaded.all(), { ...SETTING_DEFAULTS, showSkin: false }, "型別不符與未知欄位被忽略");
  store.reset();
  assert.deepEqual(store.all(), { ...SETTING_DEFAULTS });
});

test("SettingsStore：列舉與數值範圍驗證（畫質、幀率、解析度、操作配置）", () => {
  const st = memStorage(); const store = new SettingsStore(new SaveStore(st));
  store.set("quality", "low"); store.set("fpsCap", 30); store.set("renderScale", 0.75); store.set("controlMode", "mobile"); store.set("simRate", 120);
  assert.equal(store.get("quality"), "low");
  assert.throws(() => store.set("quality", "ultra"), RangeError, "不在列舉裡");
  assert.throws(() => store.set("fpsCap", 45), RangeError, "幀率只接受固定檔位");
  assert.throws(() => store.set("renderScale", 0.1), RangeError, "解析度比例有下限");
  assert.throws(() => store.set("renderScale", NaN), RangeError, "NaN 不是合法數值");
  assert.throws(() => store.set("controlMode", "tablet"), RangeError);
  assert.throws(() => store.set("simRate", "60"), TypeError, "型別不符");
  const bad = memStorage(); bad.setItem(KEYS.settings, JSON.stringify({ quality: "ultra", fpsCap: 999, renderScale: 5, simRate: 120 }));
  const loaded = new SettingsStore(new SaveStore(bad));
  assert.equal(loaded.get("quality"), "auto", "存檔裡不合法的列舉退回預設");
  assert.equal(loaded.get("fpsCap"), 0);
  assert.equal(loaded.get("renderScale"), 1, "超出範圍退回預設");
  assert.equal(loaded.get("simRate"), 120, "合法的值保留");
});
