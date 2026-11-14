#!/usr/bin/env node
/**
 * tools/check-dist.mjs — 確認 dist/app.js 是「目前原始碼」建出來的，不是過期的舊檔。
 *
 * 做法：讀原始碼裡所有狀態效果的名稱（玩家 STATUS、敵人 ENEMY_FX），逐一確認 dist/app.js 裡都有。
 * 少任何一個就代表 dist 是舊的（例如：改了原始碼卻沒重新建置就提交），以非零代碼結束，讓 CI 失敗，
 * 避免把舊版部署到線上（線上會出現「未知的狀態效果：fast」這類錯誤）。
 *
 *   npm run build && npm run check:dist
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = readFileSync(path.join(root, "dist/app.js"), "utf8");
const load = (file) => import(pathToFileURL(path.join(root, file)).href);

// 兩張表有同名的項目（例如 burn、seal、poison）。玩家的項目都有 icon 欄位、敵人的沒有，用它區分，才不會被另一張表矇混過去。
const groups = [
  ["玩家狀態效果 STATUS", (await load("js/game/status-effects.js")).STATUS, (key) => new RegExp(`[{,]${key}:\\{label:[^}]*?icon:`)],
  ["敵人狀態效果 ENEMY_FX", (await load("js/game/enemy-effects.js")).ENEMY_FX, (key) => new RegExp(`[{,]${key}:\\{label:`)],
];

let missing = 0;
for (const [title, table, pattern] of groups) {
  const lost = Object.keys(table).filter((key) => !pattern(key).test(bundle));
  if (lost.length) { missing += lost.length; console.error(`✗ ${title}：dist/app.js 缺少 ${lost.join("、")}`); }
  else console.log(`✓ ${title}：${Object.keys(table).length} 項都在 dist/app.js 裡`);
}
if (missing) { console.error("\ndist/ 是舊的，請執行 npm run build 後再提交／部署。"); process.exit(1); }
