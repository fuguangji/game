import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js");
await import(path.join(root, "main.js"));
const rp = await import(path.join(root, "core/render-profile.js"));
const { settings } = await import(path.join(root, "core/settings-store.js"));
const { burst } = await import(path.join(root, "game/world-helpers.js"));
const { G } = await import(path.join(root, "core/game-state.js"));

const feed = (sec, frameMs, costMs, target = 1000 / 60) => { for (let t = 0; t < sec * 1000; t += frameMs) rp.reportFrame(frameMs, costMs, target); };

test("畫質檔位：手動選擇決定發光、粒子、解析度、震動", () => {
  settings.reset();
  settings.set("quality", "low");
  assert.deepEqual([rp.profile.tierId, rp.profile.glow, rp.profile.particles, rp.profile.scale, rp.profile.aura], ["low", 0, 0.35, 0.7, false]);
  settings.set("quality", "high"); settings.set("renderScale", 0.5);
  assert.equal(rp.profile.scale, 0.5, "解析度比例與檔位相乘");
  settings.set("glowEffects", false); assert.equal(rp.profile.glow, 0);
  settings.set("screenShake", false); assert.equal(rp.profile.shake, 0);
  settings.set("particleDensity", "low"); assert.equal(rp.profile.particles, 0.35);
  settings.reset();
});

test("粒子密度：burst() 依畫質縮放粒子數量", () => {
  const count = (q) => { settings.set("quality", q); G.pt.length = 0; burst(0, 0, "#fff", 40, 100, 2, 0.5); return G.pt.length; };
  const low = count("low"), high = count("high");
  assert.equal(high, 40); assert.ok(low > 0 && low < high * 0.5, `低畫質粒子較少：${low} vs ${high}`);
  G.pt.length = 0; settings.reset();
});

test("自動畫質：持續偏慢會降檔（嚴重時連降），之後不會馬上升回去", () => {
  settings.reset(); rp._setAutoTierForTest(2);
  feed(2, 40, 30); // 25 fps、每幀繪製 30ms
  assert.ok(rp.autoTierIndex() < 2, "偏慢 → 降檔");
  feed(8, 150, 120); // 慘：約 7 fps
  assert.equal(rp.autoTierIndex(), 0, "嚴重偏慢 → 連降到最低");
  feed(15, 16.7, 2); // 變順了，但 30 秒內不升
  assert.equal(rp.autoTierIndex(), 0, "剛降過檔，30 秒內不升回去（避免來回震盪）");
  feed(40, 16.7, 2);
  assert.ok(rp.autoTierIndex() > 0, "持續順暢夠久 → 升檔");
});

test("自動畫質：手動指定畫質時不會被自動調整", () => {
  settings.set("quality", "high");
  feed(10, 150, 120);
  assert.equal(rp.profile.tierId, "high");
  settings.reset();
});

test("切分頁造成的長空檔（> 250ms）不算效能問題", () => {
  settings.reset(); rp._setAutoTierForTest(2);
  for (let i = 0; i < 50; i++) rp.reportFrame(3000, 5, 16.7);
  assert.equal(rp.autoTierIndex(), 2);
});
