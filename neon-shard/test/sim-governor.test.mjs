import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js");
const { SimGovernor, SIM_RATES, PARTICLE_BUDGETS } = await import(path.join(root, "core/sim-governor.js"));

const B = 1000 / 60;
/** 餵 sec 秒的幀：每幀間隔 frameMs，繪製 drawMs、模擬 stepMs */
const feed = (g, sec, frameMs, drawMs, stepMs, budget = B) => { for (let t = 0; t < sec * 1000; t += frameMs) g.report(frameMs, drawMs, stepMs, budget); };

test("負載輕鬆：維持 60 Hz 與完整粒子", () => {
  const g = new SimGovernor();
  feed(g, 20, B, 3, 1);
  assert.equal(g.rate, 60);
  assert.equal(g.particleBudget, 1);
});

test("模擬佔比高又吃力：先降模擬頻率（60 → 45 → 30）", () => {
  const g = new SimGovernor();
  feed(g, 3, 30, 4, 22); // 33fps，模擬是大宗
  assert.ok(g.rate < 60, `降頻：${g.rate}`);
  feed(g, 8, 30, 4, 22);
  assert.equal(g.rate, 30, "持續吃力會一路降到最低檔");
  assert.ok(SIM_RATES.includes(g.rate));
});

test("繪製佔比高又吃力：先減粒子預算，不先動模擬頻率", () => {
  const g = new SimGovernor();
  feed(g, 3, 30, 26, 1);
  assert.equal(g.rate, 60);
  assert.ok(g.particleBudget < 1, `減粒子：${g.particleBudget}`);
});

test("恢復順暢夠久：先補回粒子，再升回模擬頻率；剛降過的 20 秒內不升", () => {
  const g = new SimGovernor();
  feed(g, 12, 30, 4, 22);
  const lowRate = g.rate;
  feed(g, 10, B, 3, 1); // 變順了，但還在冷卻
  assert.equal(g.rate, lowRate, "剛降過檔，20 秒內不升回去");
  feed(g, 120, B, 3, 1);
  assert.equal(g.rate, 60);
  assert.equal(g.particleBudget, 1);
});

test("兩種手段都用到底仍然吃力：通知上層最後手段（確認後重新計時）", () => {
  let notified = 0;
  const g = new SimGovernor({ onChange: (x) => { if (x.needsLastResort) notified++; } });
  feed(g, 40, 50, 30, 20);
  assert.equal(g.rate, 30);
  assert.equal(g.particleBudget, PARTICLE_BUDGETS.at(-1));
  assert.ok(notified >= 1, "要求最後手段");
  g.acknowledgeLastResort();
  assert.equal(g.needsLastResort, false);
});

test("切分頁的長空檔與靜止畫面（選單）不算效能問題", () => {
  const g = new SimGovernor();
  for (let i = 0; i < 80; i++) g.report(3000, 5, 5, B);
  for (let i = 0; i < 200; i++) g.report(50, 30, 20, B, false);
  assert.equal(g.rate, 60);
  assert.equal(g.particleBudget, 1);
});

test("forceRate 可固定頻率（除錯用），0 回到自動", () => {
  const g = new SimGovernor();
  g.forceRate(30); assert.equal(g.rate, 30);
  g.forceRate(0); assert.equal(g.rate, 60);
});
