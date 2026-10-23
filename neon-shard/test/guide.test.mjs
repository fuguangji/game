import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("account"))) Object.assign(X, await import(path.join(root, f)));
const { SV, G, store, KEYS, fsm } = X;

test("下一步建議：教學做完後先推商店導覽，導覽完成後才依存檔狀況建議", () => {
  store.setString(KEYS.tutorialDone, "1"); store.setString(KEYS.shopGuideDone, "0");
  assert.match(X.suggestNextStep().text, /新手導覽/);
  store.setString(KEYS.shopGuideDone, "1");
  SV.chips = {}; SV.co = 0; assert.equal(X.suggestNextStep(), null);
  SV.co = 30; assert.match(X.suggestNextStep().text, /芯片包/);
  SV.chips = { 0: 1 }; SV.mods = {}; assert.match(X.suggestNextStep().text, /還沒裝上/);
  SV.mods = { [G.LO[0]]: [0, -1] };
  SV.mods = Object.fromEntries(G.LO.map((w) => [w, [0, 0]])); assert.equal(X.suggestNextStep(), null, "所有出戰槍都滿槽就不再提示");
});

test("新手補給：只送一次一包的晶核；導覽可開始，跳過也算完成", () => {
  store.setString(KEYS.starterGift, "0"); SV.co = 5;
  X.grantStarterCores();
  assert.equal(SV.co, 5 + X.XPK[0].cost, "第一次送一包普通芯片包的晶核");
  X.grantStarterCores();
  assert.equal(SV.co, 5 + X.XPK[0].cost, "重看導覽不會再送");
  const realGet = document.getElementById; // 假 DOM 的 classList.contains 永遠為真，會讓導覽以為選單已關閉
  document.getElementById = (id) => (id === "ov" ? { classList: { contains: () => false } } : realGet.call(document, id));
  fsm.transition("menu"); store.setString(KEYS.shopGuideDone, "0");
  X.startShopGuide();
  assert.equal(X.coach.running, true);
  X.coach.skip();
  assert.equal(store.getString(KEYS.shopGuideDone), "1", "跳過也標記完成，不會一直打擾");
  assert.equal(X.coach.running, false);
  document.getElementById = realGet;
});
