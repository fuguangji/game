// 粗略的 no-undef 檢查：找出「用到卻沒宣告也沒 import」的名稱（抓漏掉的 import）。用法：node --expose-internals tools/check-undefined.cjs js
// 粗略的 no-undef 檢查：每個模組中被引用、但整個檔案裡從未宣告（含 import）的名稱
const acorn = require("internal/deps/acorn/acorn/dist/acorn");
const fs = require("fs"), path = require("path");
const GLOBALS = new Set(["document","window","localStorage","sessionStorage","navigator","requestAnimationFrame","performance","innerWidth","innerHeight","devicePixelRatio","addEventListener","removeEventListener","matchMedia","MutationObserver","ResizeObserver","Worker","Blob","URL","TextEncoder","TextDecoder","crypto","fetch","setTimeout","clearTimeout","setInterval","clearInterval","console","alert","confirm","atob","btoa","screen","location","Image","AudioContext","webkitAudioContext","CustomEvent","Event","EventTarget","WebSocket","AbortController","structuredClone","arguments","undefined","NaN","Infinity","Math","JSON","Object","Array","Number","String","Boolean","Symbol","Promise","Map","Set","WeakMap","Date","Error","TypeError","RangeError","Int8Array","Int16Array","Int32Array","Uint8Array","Uint8ClampedArray","Uint16Array","Uint32Array","Float32Array","Float64Array","ArrayBuffer","DataView","RegExp","parseInt","parseFloat","isNaN","isFinite","Reflect","Proxy","globalThis","Node","HTMLElement","KeyboardEvent","getComputedStyle","queueMicrotask","encodeURIComponent","decodeURIComponent","FileReader","indexedDB","CSS","Path2D","OffscreenCanvas","createImageBitmap","Intl","BigInt","WeakSet","Function","eval","escape","TextDecoderStream","Notification","speechSynthesis","history","open","close","focus","prompt","btoa"]);
function walkDir(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "test" ? [] : walkDir(path.join(d, e.name))) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []); }
let problems = 0;
for (const file of walkDir(process.argv[2])) {
  const code = fs.readFileSync(file, "utf8");
  const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: "module" });
  const declared = new Set(), refs = [];
  const pat = (p) => { if (!p) return; if (p.type === "Identifier") declared.add(p.name); else if (p.type === "ObjectPattern") p.properties.forEach((q) => pat(q.value || q.argument)); else if (p.type === "ArrayPattern") p.elements.forEach(pat); else if (p.type === "AssignmentPattern") pat(p.left); else if (p.type === "RestElement") pat(p.argument); };
  (function walk(n, parent, key) {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "ImportDeclaration") n.specifiers.forEach((s) => declared.add(s.local.name));
    if (n.type === "VariableDeclarator") pat(n.id);
    if (/Function/.test(n.type)) { if (n.id) declared.add(n.id.name); n.params.forEach(pat); }
    if (n.type === "ClassDeclaration" || n.type === "ClassExpression") { if (n.id) declared.add(n.id.name); }
    if (n.type === "CatchClause" && n.param) pat(n.param);
    if (n.type === "Identifier") {
      const isProp = (parent?.type === "MemberExpression" && key === "property" && !parent.computed) || (parent?.type === "Property" && key === "key" && !parent.computed && !parent.shorthand) || ((parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") && key === "key" && !parent.computed) || parent?.type === "LabeledStatement" || parent?.type === "BreakStatement" || parent?.type === "ContinueStatement" || parent?.type === "ImportSpecifier" || parent?.type === "ExportSpecifier";
      if (!isProp) refs.push(n.name);
    }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, n, k)); else if (v && typeof v.type === "string") walk(v, n, k); }
  })(ast);
  const bad = [...new Set(refs.filter((r) => !declared.has(r) && !GLOBALS.has(r)))];
  if (bad.length) { problems += bad.length; console.log(path.relative(process.argv[2], file), "→ 未宣告:", bad.join(", ")); }
}
console.log(problems ? `\n共 ${problems} 個未宣告名稱` : "沒有未宣告的名稱");
process.exitCode = problems ? 1 : 0;
