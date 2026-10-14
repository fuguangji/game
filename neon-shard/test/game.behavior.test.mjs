import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("account"))) Object.assign(X, await import(path.join(root, f)));
const { G, fsm, bus, GameEvents, tutorial, store, KEYS } = X;
const ok = (c, m) => { if (!c) { console.log("✗ FAIL:", m); process.exitCode = 1; } else console.log("✓", m); };
const run = (n, dt = 0.016) => { for (let i = 0; i < n; i++) { X.update(dt); bus.emit(GameEvents.TICK, dt); } };

ok(tutorial.active && fsm.state === "play", "第一次遊玩：自動進入教學，狀態機為 play");
// 教學 15 步
const killAll = () => { for (const e of G.en.slice()) { e.hp = 0; X.kill(e); } };
const acts = [
  () => { for (let i = 0; i < 30; i++) { G.pl.x += 8; run(1); } },
  () => { for (let i = 0; i < 30; i++) { G.pl.aim += 0.4; run(1); } },
  () => { for (let i = 0; i < 6; i++) { G.pl.sc = 0; X.shoot(true); run(3); } },
  () => { X.WP[G.pl.w].am = 0; run(2); X.WP[G.pl.w].am = 1; run(2); },
  () => { const L = X.WP.length; G.pl.w = (G.pl.w + 1) % L; run(2); G.pl.w = (G.pl.w + 1) % L; run(2); },
  () => { const e = G.en[0]; G.pl.aim = Math.atan2(e.y - G.pl.y, e.x - G.pl.x); for (let i = 0; i < 4; i++) { G.pl.sc = 0; X.shoot(true); run(2); } },
  () => { for (let i = 0; i < 2; i++) { G.pl.dashCd = 0; X.dash(); run(15); } },
  () => { for (let k = 0; k < 4; k++) for (let j = 0; j < 44; j++) for (let i = 0; i < 44; i++) if (G.grid[i + j * 44] > 0) X.hitCell(i, j, 3); },
  killAll, killAll, killAll, killAll,
  () => { G.pl.ult = 100; X.ult(); },
  () => { X.pause(); X.resume(); },
  () => { G.pl.hp = 75; },
];
let stuck = null;
for (let i = 0; i < acts.length; i++) {
  const before = tutorial.step ?? i; run(100); acts[i]();
  for (let k = 0; k < 200 && !tutorial.isDone; k++) { run(1); }
  if (i < acts.length - 1 && fsm.state !== "play") { stuck = `步驟 ${i + 1} 後狀態=${fsm.state}`; break; }
}
ok(!stuck && tutorial.isDone, "教學 15 步全部通關" + (stuck ? "（" + stuck + "）" : ""));
ok(store.getString(KEYS.tutorialDone) === "1", "完成後寫入 localStorage（SaveStore）");
tutorial.toBattle();
ok(!tutorial.active && fsm.state === "play", "教學結束 → 正式戰鬥");
G.pl.hp = G.pl.mhp = 1e6; run(900);
ok(G.en.length >= 0 && Number.isFinite(G.pl.x), "正式戰鬥模擬 900 幀無例外");
// 24 把槍的大招
let ultOk = 0;
for (let i = 0; i < X.ALLW.length; i++) {
  if (fsm.state !== "play") fsm.transition("play");
  X.WP[0] = X.ALLW[i]; G.pl.w = 0; X.WP[0].um = 100; G.pl.ult = 100;
  G.en.length = 0; for (let k = 0; k < 4; k++) G.en.push(X.mkEn(0, G.pl.x + 100 + k * 30, G.pl.y));
  try { X.ult(); run(200); ultOk++; } catch (e) { console.log("  大招失敗", X.ALLW[i].name ?? i, e.message); }
}
ok(ultOk === X.ALLW.length, `${X.ALLW.length} 把槍的大招都能施放（${ultOk}）`);
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
