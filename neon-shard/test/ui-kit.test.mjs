import test from "node:test";
import assert from "node:assert/strict";
import { FakeElement, installFakeDom } from "./fake-dom.mjs";
installFakeDom();
FakeElement.prototype.remove = function () { const p = this.parentNode; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } };
globalThis.performance ??= { now: () => Date.now() };
const { toast, confirmDialog } = await import("../js/ui/feedback.js");
const { Coach } = await import("../js/ui/coach.js");
const { friendlyError, summarizeSave } = await import("../js/account/account-view.js");
const body = (await import("./fake-dom.mjs")).fakeDocument.body;
const buttons = (root, text) => root.findAll((e) => e.tagName === "BUTTON" && e.textContent === text);
const tick = () => new Promise((r) => setTimeout(r, 5));

test("toast：最多同時 4 則，內容走文字節點", () => {
  for (let i = 0; i < 6; i++) toast(`訊息 ${i}`, { duration: 0 });
  const host = body.find((e) => e.className === "ns-toasts");
  assert.equal(host.children.length, 4);
  assert.equal(host.children.at(-1).textContent, "訊息 5");
});

test("confirmDialog：按確定回傳 true、按取消回傳 false、危險操作預設焦點在取消", async () => {
  const yes = confirmDialog({ title: "t", body: "a\nb", confirmText: "好" });
  buttons(body, "好")[0].click();
  assert.equal(await yes, true);
  const no = confirmDialog({ title: "t", danger: true, confirmText: "刪除", cancelText: "算了" });
  const cancel = buttons(body, "算了")[0];
  assert.equal(globalThis.document.activeElement, cancel);
  cancel.click();
  assert.equal(await no, false);
  assert.equal(body.find((e) => e.className === "ns-dialog"), null, "關閉後對話框被移除");
});

test("Coach：按鈕前進、條件達成自動前進、最後一步結束並回呼", async () => {
  const coach = new Coach(); let flag = false, finished = 0, done = 0;
  coach.start([
    { id: "a", title: "A", body: "a" },
    { id: "skip", title: "S", body: "s", skipIf: () => true },
    { id: "b", title: "B", body: () => "b", advance: { type: "when", test: () => flag, delay: 0 }, done: () => done++ },
    { id: "c", title: "C", body: "c", actions: [{ label: "去", primary: true }] },
  ], { onFinish: () => finished++ });
  assert.equal(coach.stepId, "a");
  buttons(body, "下一步")[0].click();
  assert.equal(coach.stepId, "b", "skipIf 的步驟被略過");
  globalThis.__raf.splice(0).forEach((f) => f());
  assert.equal(coach.stepId, "b", "條件未達成不前進");
  flag = true;
  globalThis.__raf.splice(0).forEach((f) => f()); await tick();
  assert.equal(coach.stepId, "c"); assert.equal(done, 1);
  buttons(body, "去")[0].click();
  assert.equal(finished, 1); assert.equal(coach.running, false);
});

test("Coach：跳過會呼叫 onSkip、不呼叫 onFinish；選單關閉時中止", () => {
  const coach = new Coach(); let skipped = 0, finished = 0, aborted = 0, closed = false;
  coach.start([{ id: "a", title: "A", body: "" }], { onSkip: () => skipped++, onFinish: () => finished++ });
  coach.skip();
  assert.deepEqual([skipped, finished, coach.running], [1, 0, false]);
  coach.start([{ id: "a", title: "A", body: "" }], { onAbort: () => aborted++, shouldAbort: () => closed });
  closed = true; globalThis.__raf.splice(0).forEach((f) => f());
  assert.deepEqual([aborted, coach.running], [1, false]);
});

test("friendlyError：常見錯誤翻成白話，不認得的保留原文", () => {
  assert.match(friendlyError({ status: 401, message: "Invalid login credentials" }, "login"), /電子郵件或密碼不正確/);
  assert.match(friendlyError({ status: 429, message: "x" }), /次數太多/);
  assert.match(friendlyError({ status: 400, message: "User already registered" }, "signup"), /已經註冊/);
  assert.match(friendlyError({ status: 503, message: "x" }), /伺服器暫時/);
  assert.equal(friendlyError({ status: 400, message: "暱稱不可用" }), "暱稱不可用");
});

test("summarizeSave：缺欄位或型別錯誤也不會丟錯", () => {
  assert.equal(summarizeSave({ coins: 5, sh: 2, co: 1, clr: [1, 0, 1] }), "金幣 5 · 碎片 2 · 晶核 1 · 通關 2 關");
  assert.equal(summarizeSave(null), "金幣 0 · 碎片 0 · 晶核 0 · 通關 0 關");
});
