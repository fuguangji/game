// 檢查：每個 import { x } from "./相對路徑.js" 的 x 都真的由對方模組匯出。用法：node --expose-internals tools/check-imports.cjs js
// 驗證：每個 import { x } from "./相對路徑.js" 的 x 都真的由對方模組匯出
const acorn = require("internal/deps/acorn/acorn/dist/acorn");
const fs = require("fs"), path = require("path");
function walkDir(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "test" ? [] : walkDir(path.join(d, e.name))) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []); }
const exportsOf = new Map();
const files = walkDir(process.argv[2]);
for (const f of files) {
  const ast = acorn.parse(fs.readFileSync(f, "utf8"), { ecmaVersion: 2022, sourceType: "module" });
  const names = new Set();
  for (const n of ast.body) if (n.type === "ExportNamedDeclaration") {
    if (n.declaration) { const d = n.declaration; if (d.id) names.add(d.id.name); else d.declarations?.forEach((x) => { (function p(q) { if (q.type === "Identifier") names.add(q.name); else if (q.type === "ObjectPattern") q.properties.forEach((r) => p(r.value || r.argument)); else if (q.type === "ArrayPattern") q.elements.forEach((r) => r && p(r)); })(x.id); }); }
    n.specifiers?.forEach((s) => names.add(s.exported.name));
  } else if (n.type === "ExportAllDeclaration") names.add("*");
  exportsOf.set(path.resolve(f), { names, ast });
}
let bad = 0;
for (const [f, { ast }] of exportsOf) for (const n of ast.body) if (n.type === "ImportDeclaration" && n.source.value.startsWith(".")) {
  const target = path.resolve(path.dirname(f), n.source.value);
  const ex = exportsOf.get(target);
  if (!ex) { bad++; console.log(path.relative(process.argv[2], f), "→ 找不到模組", n.source.value); continue; }
  for (const s of n.specifiers) { const nm = s.imported?.name; if (nm && !ex.names.has(nm) && !ex.names.has("*")) { bad++; console.log(path.relative(process.argv[2], f), `→ ${n.source.value} 沒有匯出 ${nm}`); } }
}
console.log(bad ? `\n共 ${bad} 個無效的匯入` : "所有匯入都有對應的匯出");
process.exitCode = bad ? 1 : 0;
