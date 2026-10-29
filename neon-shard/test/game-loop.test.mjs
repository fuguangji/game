import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js");
const { GameLoop } = await import(path.join(root, "core/game-loop.js"));
const { G } = await import(path.join(root, "core/game-state.js"));
const interp = await import(path.join(root, "core/interpolation.js"));

/** 假時鐘：用 clock.t 控制 now()，frame(t) 推進一個繪製幀 */
function make({ rate = 60, cap = 0, simulating = true, idle = 10 } = {}) {
  const clock = { t: 0 };
  const log = { steps: [], draws: [], before: 0 };
  const loop = new GameLoop({
    simRate: () => rate, fpsCap: () => cap, simulating: () => simulating, idleFps: () => idle,
    beforeStep: () => log.before++, step: (dt) => log.steps.push(dt), draw: (a) => log.draws.push(a),
    now: () => clock.t,
  });
  const run = (ms, frameMs) => { for (let t = frameMs; t <= ms + 1e-9; t += frameMs) { clock.t = t; loop.frame(t); } };
  return { loop, log, run, clock };
}

test("固定步長：不論螢幕更新率，模擬次數都一樣，每步 dt 相同", () => {
  for (const hz of [30, 60, 144, 240]) {
    const { log, run } = make({ rate: 60 });
    run(2000, 1000 / hz);
    assert.ok(Math.abs(log.steps.length - 120) <= 1, `${hz}Hz 螢幕：2 秒約 120 步，實際 ${log.steps.length}`);
    assert.ok(log.steps.every((d) => d === 1 / 60), "dt 固定");
    assert.equal(log.before, log.steps.length, "每步前都記錄插值快照");
  }
});

test("模擬頻率可獨立調整（30／120 Hz）", () => {
  const a = make({ rate: 30 }); a.run(1000, 1000 / 60);
  assert.ok(Math.abs(a.log.steps.length - 30) <= 1);
  const b = make({ rate: 120 }); b.run(1000, 1000 / 60);
  assert.ok(Math.abs(b.log.steps.length - 120) <= 1);
  assert.equal(b.log.draws.length, 60, "繪製仍然每個螢幕幀一次");
});

test("掉幀時補跑模擬，但單幀最多補 6 步（不會卡死）", () => {
  const { log, loop, clock } = make({ rate: 60 });
  clock.t = 200; loop.frame(200); // 一次 200ms 的卡頓 = 12 步，只補 6 步
  assert.equal(log.steps.length, 6);
  assert.equal(loop.stats.dropped, 1, "放棄追趕的次數有被記錄");
  clock.t = 5000; loop.frame(5000); // 切分頁 5 秒：單幀間隔上限 0.25 秒，也只補 6 步
  assert.equal(log.steps.length, 12);
});

test("繪製幀率上限：30 上限在 60Hz 螢幕約畫 30 次，模擬不受影響", () => {
  const { log, run } = make({ rate: 60, cap: 30 });
  run(2000, 1000 / 60);
  assert.ok(Math.abs(log.draws.length - 60) <= 2, `實際 ${log.draws.length}`);
  assert.ok(Math.abs(log.steps.length - 120) <= 1);
});

test("alpha 在 [0,1) 之間，且隨兩次模擬之間的距離變化", () => {
  const { log, run } = make({ rate: 30 });
  run(1000, 1000 / 144);
  assert.ok(log.draws.every((a) => a >= 0 && a < 1));
  assert.ok(new Set(log.draws.map((a) => a.toFixed(2))).size > 3, "有各種不同的 alpha");
});

test("不模擬（選單、暫停）時不跑 step、alpha = 1、用低頻率繪製", () => {
  const { log, run } = make({ simulating: false });
  run(1000, 1000 / 60);
  assert.equal(log.steps.length, 0);
  assert.ok(log.draws.every((a) => a === 1));
  assert.ok(log.draws.length <= 12, `10fps 上限：${log.draws.length}`);
});

test("動態補償：繪製時座標是插值，繪製後完整還原；瞬移不插值", () => {
  const e = { x: 0, y: 0 }, far = { x: 0, y: 0 }, fresh = { x: 5, y: 5 };
  Object.assign(G, { pl: { x: 0, y: 0 }, en: [e, far], bl: [fresh], pt: [], camx: 0, camy: 0, time: 10 });
  interp.snapshot();
  e.x = 10; far.x = 1000; G.pl.x = 4; G.camx = 8; G.time = 10.1;
  interp.apply(0.5, 0.1);
  assert.equal(e.x, 5, "一般移動插值到一半");
  assert.equal(G.pl.x, 2);
  assert.equal(G.camx, 4, "鏡頭也插值");
  assert.equal(far.x, 1000, "一步位移 > 160 像素視為瞬移，不插值");
  assert.equal(fresh.x, 5, "沒有快照的新物件用目前位置");
  assert.ok(Math.abs(G.time - 10.15) < 1e-9, "動畫時鐘推進到畫面時間");
  interp.restore();
  assert.deepEqual([e.x, G.pl.x, G.camx, far.x, G.time], [10, 4, 8, 1000, 10.1], "還原為真實值");
  interp.apply(1, 0.1); // alpha = 1 → 不動
  assert.equal(e.x, 10);
  interp.restore();
  interp.resetInterpolation();
  interp.apply(0.5, 0.1);
  assert.equal(e.x, 10, "重設後第一幀不插值");
  interp.restore();
});

test("閒置幀率為 0（選單）：只在進入閒置與 invalidate() 時畫一次，其餘不重畫", () => {
  const clock = { t: 0 }, st = { sim: true }, log = { draws: 0, steps: 0 };
  const loop = new GameLoop({ simRate: () => 60, fpsCap: () => 0, simulating: () => st.sim, idleFps: () => 0, beforeStep() {}, step: () => log.steps++, draw: () => log.draws++, now: () => clock.t });
  const run = (n) => { for (let i = 0; i < n; i++) { clock.t += 16.7; loop.frame(clock.t); } };
  run(10); assert.equal(log.draws, 10, "模擬中每幀都畫");
  st.sim = false; run(100);
  assert.equal(log.draws, 11, "進入選單補畫 1 次，之後 100 幀完全不畫");
  loop.invalidate(); run(5);
  assert.equal(log.draws, 12, "invalidate 後只補畫 1 次");
  st.sim = true; run(3);
  assert.equal(log.draws, 15, "回到戰鬥立刻恢復每幀繪製");
});

test("休眠：閒置且畫面最新時不再排 requestAnimationFrame；wake() 才會醒來", () => {
  const clock = { t: 0 }, st = { sim: true }, queue = [];
  const loop = new GameLoop({ simRate: () => 60, fpsCap: () => 0, simulating: () => st.sim, idleFps: () => 0, beforeStep() {}, step() {}, draw() {}, now: () => clock.t, schedule: (fn) => queue.push(fn) });
  const pump = (n) => { for (let i = 0; i < n && queue.length; i++) { clock.t += 16.7; queue.shift()(clock.t); } };
  loop.start(); pump(5);
  assert.equal(queue.length, 1, "戰鬥中每幀都排下一幀");
  st.sim = false; pump(3); // 進入選單：補畫一幀，之後休眠
  assert.equal(queue.length, 0, "休眠後沒有排任何 rAF");
  loop.wake(); assert.equal(queue.length, 1, "wake() 醒來");
  loop.wake(); assert.equal(queue.length, 1, "重複 wake() 不會重複排程");
  pump(3); assert.equal(queue.length, 0, "沒有欠繪製就再次休眠");
  loop.invalidate(); assert.equal(queue.length, 1, "invalidate() 會醒來並補畫");
  st.sim = true; pump(2); assert.equal(queue.length, 1, "回到戰鬥持續排程");
});
