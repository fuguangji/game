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
const world = await import(path.join(root, "game/world-helpers.js"));


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

test("自動畫質：預設維持高畫質（發光、解析度、光環不因效能自動降低）", () => {
  settings.reset(); rp._setAutoTierForTest(2);
  assert.deepEqual([rp.profile.tierId, rp.profile.glow, rp.profile.scale, rp.profile.aura], ["high", 1, 1, true]);
});

test("粒子預算：只縮小粒子數量與上限，發光與解析度不變", () => {
  settings.reset(); rp._setAutoTierForTest(2);
  rp.setParticleBudget(0.5);
  assert.equal(rp.profile.particles, 0.5);
  assert.deepEqual([rp.profile.glow, rp.profile.scale, rp.profile.aura], [1, 1, true]);
  G.pt.length = 0; burst(0, 0, "#fff", 40, 100, 2, 0.5);
  assert.equal(G.pt.length, 20, "預算 50% → 粒子數量減半");
  G.pt.length = 0;
  rp.setParticleBudget(1);
  assert.equal(rp.profile.particles, 1);
});

test("最後手段：自動畫質才會降檔，手動指定畫質不動", () => {
  settings.reset(); rp._setAutoTierForTest(2);
  assert.equal(rp.degradeAutoTier(), true);
  assert.equal(rp.profile.tierId, "medium");
  rp.degradeAutoTier(); assert.equal(rp.degradeAutoTier(), false, "已在最低檔");
  settings.set("quality", "high");
  assert.equal(rp.degradeAutoTier(), false);
  assert.equal(rp.profile.tierId, "high");
  settings.reset();
  assert.equal(rp.autoTierIndex(), 2, "重設設定後自動檔位回到高");
});

test("粒子物件池：死掉的粒子被重複使用，且欄位（含插值座標）全部重設", () => {
  settings.reset(); rp._setAutoTierForTest(2);
  const { releaseParticle, compactInPlace } = world;
  G.pt.length = 0;
  const dirty = { x: 9, y: 9, vx: 9, vy: 9, life: 9, max: 9, col: "#000", sz: 9, age: 5, k: "ice", f: 1, rot: 3, vr: 2, seed: 7, _ix: 123, _iy: 456 };
  releaseParticle(dirty);
  burst(1, 2, "#abc", 1, 100, 2, 0.5);
  assert.equal(G.pt.length, 1);
  assert.equal(G.pt[0], dirty, "從池子取出同一個物件");
  assert.deepEqual([dirty.x, dirty.y, dirty.age, dirty.k, dirty.f, dirty._ix, dirty._iy], [1, 2, 0, undefined, undefined, undefined, undefined]);
  const arr = [1, 2, 3, 4, 5, 6];
  const same = compactInPlace(arr, (v) => v % 2 === 0);
  assert.equal(same, arr); assert.deepEqual(arr, [2, 4, 6]);
  G.pt.length = 0;
});
