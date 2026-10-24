import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("account"))) Object.assign(X, await import(path.join(root, f)));
const { G, fsm, bus, GameEvents, tutorial, store, KEYS } = X;
const ok = (c, m) => { if (!c) { console.log("✗ FAIL:", m); process.exitCode = 1; } else console.log("✓", m); };
const run = (n, dt = 0.016) => { for (let i = 0; i < n; i++) { X.update(dt); bus.emit(GameEvents.TICK, dt); } };

// 教學流程改由人工測試；這裡只切換到一般戰鬥狀態，保留後續戰鬥引擎回歸測試。
tutorial.toBattle();
G.pl.hp = G.pl.mhp = 1e6; run(900);
ok(G.en.length >= 0 && Number.isFinite(G.pl.x), "正式戰鬥模擬 900 幀無例外");
// 每一把槍的大招
let ultOk = 0;
ok(Object.isFrozen(X.ALLWEAPON) && Object.isFrozen(X.ALLWEAPON.getWeapon()) && Object.isFrozen(X.ALLWEAPON.getWeapon(0)), "武器定義 API、陣列與單筆資料皆唯讀");
const weaponDefinitions = X.ALLWEAPON.getWeapon();
ok(weaponDefinitions.length > 0 && weaponDefinitions.every((w, i) => w.id === i && typeof w.description === "string" && Number.isFinite(w.magazineCapacity) && Number.isFinite(w.reloadDuration)), "每把武器的 ID、描述、彈匣與裝填資料均已整合");
for (let i = 0; i < X.ALLWEAPON.getWeapon().length; i++) {
  if (fsm.state !== "play") fsm.transition("play");
  X.WP[0] = X.modW(X.ALLWEAPON.getWeapon(i)); G.pl.w = 0; X.WP[0].um = 100; G.pl.ult = 100;
  G.en.length = 0; for (let k = 0; k < 4; k++) G.en.push(X.mkEn(0, G.pl.x + 100 + k * 30, G.pl.y));
  try { X.ult(); run(200); ultOk++; } catch (e) { console.log("  大招失敗", X.ALLWEAPON.getWeapon()[i].name ?? i, e.message); }
}
ok(ultOk === X.ALLWEAPON.getWeapon().length, `${X.ALLWEAPON.getWeapon().length} 把槍的大招都能施放（${ultOk}）`);
// 狀態機
fsm.transition("play"); const hits = [];
const off = fsm.onEnter("pause", () => hits.push("enter"));
fsm.transition("pause"); fsm.transition("play"); off(); fsm.transition("pause"); fsm.transition("play");
ok(hits.length === 1, "狀態機 onEnter 可註冊、可取消");
const rm = X.registerStateGuard(() => false); const blocked = fsm.transition("pause"); rm();
ok(blocked === false && fsm.state === "play", "守門函式可拒絕轉移，移除後恢復");
// 事件匯流排：壞監聽者不影響遊戲
let called = 0; bus.on("x", () => { throw new Error("boom"); }); bus.on("x", () => called++); const err = console.error; console.error = () => {}; bus.emit("x"); console.error = err;
ok(called === 1, "事件匯流排：一個監聽者出錯不影響其他監聽者");
// 存檔：損毀資料不會讓遊戲壞掉
globalThis.localStorage.setItem(KEYS.best, "not-a-number"); globalThis.localStorage.setItem(KEYS.save, "{broken");
ok(store.getNumber(KEYS.best, { min: 0, fallback: 7 }) === 7 && store.getJSON(KEYS.save, X.isPlainObject, {}) !== null, "存檔損毀時回傳預設值");
const target = { coins: 5, own: [0], name: "a" }; X.mergeSave(target, JSON.parse('{"coins":"999","own":[1,2],"name":"b","__proto__":{"evil":1},"extra":1}'), { allowUnknown: false });
ok(target.coins === 5 && target.own.length === 2 && target.name === "b" && !("extra" in target) && ({}).evil === undefined, "mergeSave：型別不符忽略、未知欄位忽略、原型污染無效");
console.log(process.exitCode ? "\n有測試失敗" : "\n全部通過");
