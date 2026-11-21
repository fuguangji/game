/**
 * 命名護欄：遊戲對外叫 NEON-FORMULA，但有些識別字必須維持 neon-shard，改了會讓存檔消失或雲端存檔解不開。
 * 這個測試一邊確認「顯示名稱」都換了，一邊鎖住「不能改的識別字」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { KEYS } from "../js/core/save-store.js";
import { SKIN_KEY } from "../js/profile/appearance.js";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");
const api = (...p) => path.join(repo, "neon-shard-api", ...p);
const TAGLINE = "霓虹幾何，瞄準與閃避";

test("顯示名稱：頁面標題、說明、h1、選單字樣都是 NEON-FORMULA，且保留標語", () => {
  for (const file of ["index.dev.html", "index.html"]) {
    const html = read(root, file);
    assert.match(html, /<title>NEON-FORMULA － 霓虹幾何射擊遊戲<\/title>/, `${file} 的標題`);
    assert.match(html, /<h1 class="sr-only">NEON-FORMULA － 霓虹幾何射擊遊戲<\/h1>/, `${file} 的 h1`);
    assert.match(html, /content="NEON-FORMULA：霓虹幾何風格的俯視角射擊遊戲/, `${file} 的 meta 說明`);
    assert.match(html, new RegExp(`<div class="x-wm">NEON-FORMULA</div>\\s*<div class="x-tag">${TAGLINE}</div>`), `${file} 的選單名稱與標語`);
    assert.doesNotMatch(html, /NEON SHARD/, `${file} 不該再有舊名稱`);
  }
  const lobby = read(root, "js/ui/menu-lobby.js");
  assert.ok(lobby.includes(`<div class="x-wm">NEON-FORMULA</div><div class="x-tag">${TAGLINE}</div>`), "主選單即時渲染的名稱與標語");
  assert.ok(!lobby.includes("NEON SHARD"));
  assert.match(read(root, "success/index.html"), /認證成功｜NEON-FORMULA/);
  assert.match(read(repo, "index.html"), /<h3>NEON-FORMULA<\/h3>/, "首頁專案卡片");
});

test("較長的名稱不會撐出窄螢幕：標題字級同時受畫面寬度限制，且不換行", () => {
  const css = read(root, "index.dev.html").match(/\.x-wm \{[^}]*\}/)?.[0] ?? "";
  assert.match(css, /font-size:\s*clamp\(20px,\s*min\(6vh,\s*7vw\),\s*36px\)/);
  assert.match(css, /white-space:\s*nowrap/);
});

test("不能改的識別字（一）：本機存檔鍵與外觀鍵沿用 neonShard／neon-shard，改了玩家的存檔會讀不到", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(KEYS).filter(([k]) => ["save", "best", "settings", "loadout", "autoAim", "tutorialDone", "shopGuideDone", "starterGift", "trainingTip", "cloudSync"].includes(k))),
    { loadout: "neonShardLO", best: "neonShardBest", save: "neonShardSave", autoAim: "neonShardAA", tutorialDone: "neonShardTutorialDone", shopGuideDone: "neonShardShopGuideDone", starterGift: "neonShardStarterGift", trainingTip: "neonShardTrainingTip", settings: "neonShardSettings", cloudSync: "neonShardCloudSync" },
  );
  for (const [name, key] of Object.entries(KEYS)) assert.ok(!/formula/i.test(key), `KEYS.${name} 不能被改名：${key}`);
  assert.equal(SKIN_KEY, "neon-shard.custom-skin.v1");
});

test("不能改的識別字（二）：加密用途標籤逐一鎖定，前後端一致；改了既有的雲端存檔會解不開", () => {
  const clientText = read(root, "js/account/cloud-crypto.js");
  const serverText = fs.readFileSync(api("src/security.js"), "utf8");
  // 前端用到的全部標籤（金鑰包、存檔封包、HKDF 鹽、存檔金鑰、金鑰註冊、請求簽章）：少一個或寫錯一個都會讓既有資料失效
  const clientLabels = ["neon-shard:key-bundle:v1", "neon-shard:save-envelope:v1", "neon-shard:hkdf-salt:v1", "neon-shard:save-key:v1", "neon-shard:key-registration:v1", "neon-shard:save-request:v1"];
  for (const label of clientLabels) assert.ok(clientText.includes(`"${label}"`), `前端缺少或被改名：${label}`);
  // 伺服器要驗證簽章的兩個標籤，必須與前端完全相同
  for (const label of ["neon-shard:key-registration:v1", "neon-shard:save-request:v1"]) assert.ok(serverText.includes(`"${label}"`), `伺服器缺少或被改名：${label}`);
  assert.ok(read(root, "js/account/account-service.js").includes('format: "neon-shard-save-v1"'), "存檔封包格式標記");
  // 加密與簽章相關的檔案裡，連一個 formula 都不該出現
  for (const [name, text] of [["cloud-crypto.js", clientText], ["security.js", serverText]]) assert.ok(!/formula/i.test(text), `${name} 不能出現新名稱`);
});

test("識別字不該被改名：整個前端與伺服器程式碼裡沒有 neonFormula／NEON_FORMULA 形式的識別字（資料夾路徑 neon-formula 可用）", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(dir, e.name))) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
  const offenders = [...walk(path.join(root, "js")), ...walk(api("src"))].filter((f) => /neonFormula|NEON_FORMULA/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

test("資料夾與測試路徑不再引用 neon-shard", () => {
  const paths = [
    path.join(root, "js/account/config.js"),
    path.join(root, "test/account.test.mjs"),
    path.join(root, "test/login-flow.test.mjs"),
    path.join(root, "tools/build.mjs"),
    api("package.json"),
    api("test/browser-crypto.test.js"),
    api("test/e2e-reconnect.test.js"),
  ];
  for (const file of paths) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /neon-shard\//, `${file} 不該引用舊資料夾路徑`);
  }
});

test("不能改的識別字（三）：伺服器維持 neon-shard-api（套件名、健康檢查、預設網址）", () => {
  assert.equal(JSON.parse(fs.readFileSync(api("package.json"), "utf8")).name, "neon-shard-api");
  const server = fs.readFileSync(api("src/server.js"), "utf8");
  assert.equal((server.match(/service: "neon-shard-api"/g) ?? []).length, 3, "三個健康檢查回應");
  assert.match(read(root, "js/account/config.js"), /https:\/\/neon-shard-api\.onrender\.com/);
});

test("不能改的識別字（四）：對外的全域名稱（擴充 API、設定入口）維持原樣", () => {
  assert.ok(read(root, "js/api/extension.js").includes('"NEON_SHARD_API"'));
  assert.ok(read(root, "js/account/config.js").includes("NEON_SHARD_API_BASE"));
  assert.ok(read(root, "js/account/config.js").includes("NEON_SHARD_ACCOUNT_URL"));
});
