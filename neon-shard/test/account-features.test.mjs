import test from "node:test";
import assert from "node:assert/strict";
import { mountAccountFeatures } from "../js/account/account-features.js";

test("帳號功能：可在測試 DOM 中掛載、刷新並清理資源", () => {
  const container = document.createElement("section");
  const features = mountAccountFeatures(container);

  assert.equal(typeof features.refresh, "function");
  assert.equal(typeof features.destroy, "function");
  assert.doesNotThrow(() => features.refresh(false));
  assert.doesNotThrow(() => features.refresh(true));
  assert.doesNotThrow(() => features.destroy());
});

test("帳號功能：重複清理不應拋出例外", () => {
  const features = mountAccountFeatures(document.createElement("section"));
  features.destroy();
  assert.doesNotThrow(() => features.destroy());
});
