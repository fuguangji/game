import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js"))) Object.assign(X, await import(path.join(root, f)));
let fails = 0;
for (const tab of ["h", "b", "i", "k", "m", "c", "a"]) {
  try { X.xGo(tab); console.log("✓ 分頁", tab, "渲染成功"); } catch (e) { fails++; console.log("✗ 分頁", tab, e.message, "\n   ", e.stack.split("\n")[1]); }
}
try { X.showOv(1); X.showOv(0); console.log("✓ 結算畫面"); } catch (e) { fails++; console.log("✗ 結算", e.message); }
const api = globalThis.NEON_SHARD_API;
console.log(api && typeof api.registerStateGuard === "function" ? "✓ window.NEON_SHARD_API 擴充 API 仍可用" : "✗ 擴充 API 遺失");
if (!api) fails++;
process.exitCode = fails ? 1 : 0;
