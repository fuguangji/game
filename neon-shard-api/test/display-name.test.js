import test from "node:test";
import assert from "node:assert/strict";
import { hasUnsupportedDisplayNameChars } from "../src/display-name.js";

test("一般暱稱（中英文、數字、空白、連字號）可通過", () => {
  for (const name of ["Pilot", "光風濟月", "Neon Shard 07", "a-b.c"]) assert.equal(hasUnsupportedDisplayNameChars(name), false, name);
});

test("會被當成 HTML 或跳脫字元的字元一律拒絕", () => {
  for (const name of ['<img src=x onerror=alert(1)>', "a&b", 'say "hi"', "it's", "`x`", "a\\b", "50%", "a_b", "tab\there", "\u0000"]) {
    assert.equal(hasUnsupportedDisplayNameChars(name), true, JSON.stringify(name));
  }
});
