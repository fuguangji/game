import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "js");
await import(path.join(root, "main.js"));
const { buildSteps } = await import(path.join(root, "game/tutorial.js"));
const { settings } = await import(path.join(root, "core/settings-store.js"));
const { platform } = await import(path.join(root, "core/platform.js"));

const use = (mode) => { settings.set("controlMode", mode); assert.equal(platform.mode, mode); return buildSteps(); };
const DESKTOP_ONLY = /滑鼠|滾輪|WASD|W A S D|Shift|空白鍵|按 [PRQF]\b|Esc/;
const MOBILE_ONLY = /搖桿|觸控|手指|DASH|SUPER|點畫面/;

test("電腦版與手機版教學是兩份獨立的步驟，每一步都完整", () => {
  for (const mode of ["desktop", "mobile"]) {
    const steps = use(mode);
    assert.ok(steps.length >= 16, `${mode} 至少 16 步`);
    for (const s of steps) {
      assert.ok(s.title && s.text, `${mode}：每步都有標題與說明（${s.title}）`);
      assert.equal(typeof s.progress, "function");
      assert.ok(s.tip, `${mode}「${s.title}」有補充提示`);
      assert.equal(s.mb, undefined, "不再有 mb 這種共用欄位");
      const p = s.progress({ moved: 0, aimed: 0, shots: 0, auto: 0, switches: 0, dashes: 0, walls: 0, kills: 0, supers: 0, pauses: 0, emptied: 0, skills: 0, selects: 0, cancels: 0 });
      assert.ok(Number.isFinite(p) && p >= 0, `${mode}「${s.title}」起始進度合法`);
    }
    assert.equal(new Set(steps.map((s) => s.title)).size, steps.length, "標題不重複");
  }
  settings.set("controlMode", "auto");
});

test("手機版教學不出現滑鼠鍵盤用語；電腦版不出現觸控用語", () => {
  const mobile = use("mobile"), desktop = use("desktop");
  for (const s of mobile) assert.ok(!DESKTOP_ONLY.test(s.text + s.tip), `手機版「${s.title}」不該提到電腦操作：${s.text}`);
  for (const s of desktop) assert.ok(!MOBILE_ONLY.test(s.text + s.tip), `電腦版「${s.title}」不該提到觸控操作：${s.text}`);
  settings.set("controlMode", "auto");
});

test("手機版教學涵蓋技能「點選 → 瞄準放開 → 取消」三步，電腦版涵蓋「滾輪選定 → 左鍵施放」", () => {
  const m = use("mobile").map((s) => s.title), d = use("desktop").map((s) => s.title);
  for (const t of ["技能①：點選", "技能②：瞄準並放開", "技能③：取消施放"]) assert.ok(m.includes(t), t);
  for (const t of ["選定技能", "施放技能"]) assert.ok(d.includes(t), t);
  const sel = use("mobile").find((s) => s.title === "技能①：點選");
  assert.equal(sel.progress({ selects: 1 }), 1, "點選完成度由選定事件統計");
  assert.equal(use("mobile").find((s) => s.title === "技能③：取消施放").progress({ cancels: 1 }), 1);
  settings.set("controlMode", "auto");
});
