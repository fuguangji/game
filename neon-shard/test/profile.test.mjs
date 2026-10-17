import test from "node:test";
import assert from "node:assert/strict";
import { FakeElement, fakeContext, fakeDocument, installFakeDom } from "./fake-dom.mjs";
installFakeDom();
const { ProfilePage } = await import("../js/profile/profile-page.js");
const { SettingsStore } = await import("../js/core/settings-store.js");
const { SaveStore } = await import("../js/core/save-store.js");
const { skinStore } = await import("../js/profile/appearance.js");

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function makeDeps(overrides = {}) {
  const account = Object.assign(new EventTarget(), { signedIn: false, unlocked: false, displayName: "訪客", profile: null, getFreshAccessToken: async () => null, restore() {} });
  const calls = { autoAim: [], tutorial: 0, goTo: [], destroyed: 0 };
  const settings = new SettingsStore(new SaveStore(memStorage()));
  const AccountView = { mount: () => ({ destroy: () => calls.destroyed++, onChange() {} }) };
  const bridge = {
    getSave: () => ({}), applySave() {}, getProgress: () => ({ clearedStages: 2, totalStages: 5, bestScore: 1234, ownedWeapons: 3, totalWeapons: 24, ownedCharacters: 1, totalCharacters: 8 }),
    getRoleColor: () => "#22e6ff", getAutoAim: () => 1, setAutoAim: (m) => calls.autoAim.push(m), autoAimLabels: ["手動", "修正附近", "較大範圍"],
    replayTutorial: () => calls.tutorial++, goTo: (t) => calls.goTo.push(t), getPlayerPosition: () => ({ x: 0.5, y: 0.5 }),
  };
  return { deps: { bridge, accountService: account, AccountView, settings, apiBase: "https://api.test", ...overrides }, account, calls, settings };
}
const mount = (deps) => { const host = new FakeElement("div"); fakeDocument.body.append(host); return { host, page: ProfilePage.mount(host, deps) }; };
const tabs = (host) => host.findAll((e) => e.attrs.role === "tab");
const panel = (host, id) => host.find((e) => e.id === `ns-panel-${id}`);

test("頁面有 5 個分頁，預設顯示「個人檔案」，aria 狀態正確", () => {
  const { deps } = makeDeps(); const { host, page } = mount(deps);
  assert.deepEqual(tabs(host).map((t) => t.textContent), ["個人檔案", "設定", "外觀", "雲端同步", "線上聯機"]);
  assert.equal(page.activeId, "overview");
  assert.equal(tabs(host)[0].attrs["aria-selected"], "true");
  assert.equal(tabs(host)[1].attrs["aria-selected"], "false");
  assert.equal(panel(host, "overview").classList.contains("ns-profile-hidden"), false);
  assert.equal(panel(host, "settings").classList.contains("ns-profile-hidden"), true);
  page.destroy();
});

test("切換分頁：只顯示目標面板，並支援方向鍵", () => {
  const { deps } = makeDeps(); const { host, page } = mount(deps);
  tabs(host)[1].click();
  assert.equal(page.activeId, "settings");
  assert.equal(panel(host, "overview").classList.contains("ns-profile-hidden"), true);
  assert.equal(panel(host, "settings").classList.contains("ns-profile-hidden"), false);
  const nav = host.find((e) => e.attrs.role === "tablist");
  nav.dispatch("keydown", { key: "ArrowRight" });
  assert.equal(page.activeId, "appearance");
  nav.dispatch("keydown", { key: "End" });
  assert.equal(page.activeId, "online");
  nav.dispatch("keydown", { key: "ArrowRight" }); // 環狀：回到第一個
  assert.equal(page.activeId, "overview");
  page.destroy();
});

test("暱稱含 HTML 時只會當成文字顯示，不會建立任何子元素", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const { deps, account } = makeDeps(); account.displayName = evil;
  const { host, page } = mount(deps);
  const name = host.find((e) => e.className === "ns-profile-name");
  assert.equal(name.textContent, evil);
  assert.equal(name.children.length, 1);
  assert.equal(name.children[0].constructor.name, "FakeText");
  assert.equal(host.findAll((e) => e.tagName === "IMG").length, 0);
  page.destroy();
});

test("個人檔案：顯示進度，按鈕透過橋接切換大廳分頁", () => {
  const { deps, calls } = makeDeps(); const { host, page } = mount(deps);
  const stats = host.findAll((e) => e.className === "ns-stat").map((e) => e.textContent);
  assert.deepEqual(stats, ["已通關2 / 5", "最高分1234", "已解鎖槍械3 / 24", "已解鎖角色1 / 8"]);
  host.findAll((e) => e.tagName === "BUTTON" && e.textContent === "前往備戰")[0].click();
  assert.deepEqual(calls.goTo, ["b"]);
  page.destroy();
});

test("設定：自動瞄準與顯示偏好會寫回遊戲／設定儲存；重新觀看教學呼叫橋接", () => {
  const { deps, calls, settings } = makeDeps(); const { host, page } = mount(deps);
  page.show("settings");
  const radios = host.findAll((e) => e.type === "radio");
  assert.deepEqual(radios.map((r) => r.checked), [false, true, false], "依 getAutoAim 勾選");
  radios[2].checked = true; radios[2].dispatch("change");
  assert.deepEqual(calls.autoAim, [2]);
  const [aura, skin] = host.findAll((e) => e.type === "checkbox");
  assert.equal(aura.checked, true);
  aura.checked = false; aura.dispatch("change");
  assert.equal(settings.get("showAura"), false);
  settings.reset();
  assert.equal(aura.checked, true, "還原設定後畫面同步");
  host.findAll((e) => e.textContent === "重新觀看教學")[0].click();
  assert.equal(calls.tutorial, 1);
  void skin; page.destroy();
});

test("線上聯機：未登入時鎖定，登入後開放", () => {
  const { deps, account } = makeDeps(); const { host, page } = mount(deps);
  const online = panel(host, "online");
  const gate = online.find((e) => e.className === "ns-feature-status" && e.hidden !== undefined && e.textContent.includes("請先"));
  const body = online.find((e) => e.className === "ns-online");
  assert.equal(body.hidden, true); assert.equal(gate.hidden, false);
  account.signedIn = true; account.dispatchEvent(new CustomEvent("change", { detail: {} }));
  assert.equal(body.hidden, false); assert.equal(gate.hidden, true);
  page.destroy();
});

test("重新掛載會先清理舊頁面（雲端區塊被 destroy）", () => {
  const first = makeDeps(); mount(first.deps);
  const second = makeDeps(); mount(second.deps);
  assert.equal(first.calls.destroyed, 1);
  ProfilePage.mount(new FakeElement("div"), second.deps);
  assert.equal(second.calls.destroyed, 1);
});

test("外觀：滑鼠繪製會產生筆畫，套用後寫入皮膚資料；筆畫數量有上限", () => {
  skinStore.clear();
  const { deps } = makeDeps(); const { host, page } = mount(deps);
  page.show("appearance");
  const canvas = host.find((e) => e.className === "ns-skin-canvas");
  canvas.dispatch("pointerdown", { pointerId: 1, clientX: 180, clientY: 180 });
  canvas.dispatch("pointermove", { clientX: 200, clientY: 190 });
  canvas.dispatch("pointerup", {});
  canvas.dispatch("pointermove", { clientX: 300, clientY: 300 }); // 放開後移動不應再畫
  host.findAll((e) => e.textContent === "套用外觀")[0].click();
  assert.equal(skinStore.strokes.length, 1);
  assert.equal(skinStore.strokes[0].points.length, 2);
  assert.ok(host.findAll((e) => e.className === "ns-feature-status").some((e) => e.textContent.includes("已套用")));
  host.findAll((e) => e.textContent === "移除外觀")[0].click();
  assert.equal(skinStore.strokes.length, 0);
  for (let i = 0; i < 205; i++) { canvas.dispatch("pointerdown", { pointerId: 1, clientX: 100 + (i % 50), clientY: 100 }); canvas.dispatch("pointerup", {}); }
  host.findAll((e) => e.textContent === "套用外觀")[0].click();
  assert.equal(skinStore.strokes.length, 200, "最多 200 筆");
  skinStore.clear(); page.destroy(); void fakeContext;
});
