// 把一個 ES module 內的部分頂層宣告搬到新檔案；原模組以 `export … from` 轉發，其他檔案的 import 不用改。
// 用法：node --expose-internals splitmod.js <module.js> <spec.json>   spec: { "新檔.js": { "desc": "說明", "names": ["fn1", ...] } }
const acorn = require("internal/deps/acorn/acorn/dist/acorn");
const fs = require("fs"), path = require("path");
const [file, specFile] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
const S = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const dir = path.dirname(file), base = path.basename(file);
const ast = acorn.parse(S, { ecmaVersion: 2022, sourceType: "module", locations: true });
const patNames = (p, out = []) => { if (!p) return out; if (p.type === "Identifier") out.push(p.name); else if (p.type === "ObjectPattern") p.properties.forEach((q) => patNames(q.value || q.argument, out)); else if (p.type === "ArrayPattern") p.elements.forEach((e) => patNames(e, out)); else if (p.type === "AssignmentPattern") patNames(p.left, out); else if (p.type === "RestElement") patNames(p.argument, out); return out; };
const decl = (n) => (n.type === "ExportNamedDeclaration" && n.declaration ? n.declaration : n);
const namesOf = (n) => { const d = decl(n); return d.type === "FunctionDeclaration" || d.type === "ClassDeclaration" ? [d.id.name] : d.type === "VariableDeclaration" ? d.declarations.flatMap((x) => patNames(x.id)) : []; };
const body = ast.body;
const imports = body.filter((n) => n.type === "ImportDeclaration");
const importMap = new Map(); // 本地名稱 -> {spec 文字, source}
for (const n of imports) for (const s of n.specifiers) importMap.set(s.local.name, { text: s.imported && s.imported.name !== s.local.name ? `${s.imported.name} as ${s.local.name}` : s.local.name, source: n.source.value });
const topNodes = body.filter((n) => n.type !== "ImportDeclaration");
const nodeOf = new Map(); topNodes.forEach((n) => namesOf(n).forEach((nm) => nodeOf.set(nm, n)));
const targetOf = new Map(); // node -> 新檔名
for (const [nf, { names }] of Object.entries(spec)) for (const nm of names) {
  const n = nodeOf.get(nm); if (!n) throw new Error(`找不到頂層宣告：${nm}`);
  const d = decl(n);
  if (nm === "init") throw new Error("不可搬移 init()");
  if (d.type === "VariableDeclaration" && d.kind !== "const") throw new Error(`${nm} 不是 const（可能是延後初始化的變數）`);
  if (targetOf.has(n) && targetOf.get(n) !== nf) throw new Error(`${nm} 同時被分到兩個檔案`);
  targetOf.set(n, nf);
}
// —— 參照解析（感知作用域）——
class Scope { constructor(p) { this.p = p; this.n = new Set(); } has(x) { return this.n.has(x) || (this.p ? this.p.has(x) : false); } }
const refs = []; let owner = null;
const collectVars = (n, set) => { if (!n || typeof n.type !== "string" || /Function/.test(n.type)) return; if (n.type === "VariableDeclaration" && n.kind === "var") n.declarations.forEach((d) => patNames(d.id).forEach((x) => set.add(x))); for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach((c) => collectVars(c, set)); else if (v && typeof v.type === "string") collectVars(v, set); } };
const hoist = (stmts, sc) => { for (const s of stmts) { if (s.type === "VariableDeclaration" && s.kind !== "var") s.declarations.forEach((d) => patNames(d.id).forEach((x) => sc.n.add(x))); else if (s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") sc.n.add(s.id.name); } };
const addRef = (id, sc, w = false) => { if (!sc.has(id.name)) refs.push({ name: id.name, owner, write: w }); };
function pattern(p, sc, isDecl, w) { if (!p) return; switch (p.type) { case "Identifier": if (!isDecl) addRef(p, sc, w); break; case "AssignmentPattern": pattern(p.left, sc, isDecl, w); visit(p.right, sc); break; case "ObjectPattern": for (const q of p.properties) { if (q.type === "RestElement") { pattern(q.argument, sc, isDecl, w); continue; } if (q.computed) visit(q.key, sc); pattern(q.value, sc, isDecl, w); } break; case "ArrayPattern": p.elements.forEach((e) => e && pattern(e, sc, isDecl, w)); break; case "RestElement": pattern(p.argument, sc, isDecl, w); break; default: visit(p, sc); } }
function fn(n, sc) { const s = new Scope(sc); if (n.type === "FunctionExpression" && n.id) s.n.add(n.id.name); n.params.forEach((p) => patNames(p).forEach((x) => s.n.add(x))); n.params.forEach((p) => pattern(p, s, true)); if (n.body.type === "BlockStatement") { const vs = new Set(); collectVars(n.body, vs); vs.forEach((x) => s.n.add(x)); hoist(n.body.body, s); n.body.body.forEach((c) => visit(c, s)); } else visit(n.body, s); }
function visit(n, sc) {
  if (!n || typeof n.type !== "string") return;
  switch (n.type) {
    case "Identifier": addRef(n, sc); return;
    case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": fn(n, sc); return;
    case "ClassDeclaration": case "ClassExpression": { const s = new Scope(sc); if (n.id) s.n.add(n.id.name); visit(n.superClass, s); n.body.body.forEach((m) => { if (m.computed) visit(m.key, s); visit(m.value, s); }); return; }
    case "BlockStatement": { const s = new Scope(sc); hoist(n.body, s); n.body.forEach((c) => visit(c, s)); return; }
    case "ForStatement": case "ForInStatement": case "ForOfStatement": { const s = new Scope(sc); const h = n.init || n.left; if (h && h.type === "VariableDeclaration" && h.kind !== "var") h.declarations.forEach((d) => patNames(d.id).forEach((x) => s.n.add(x))); if (n.type === "ForStatement") { visit(n.init, s); visit(n.test, s); visit(n.update, s); } else { if (n.left.type === "VariableDeclaration") visit(n.left, s); else pattern(n.left, s, false, true); visit(n.right, s); } visit(n.body, s); return; }
    case "CatchClause": { const s = new Scope(sc); if (n.param) patNames(n.param).forEach((x) => s.n.add(x)); visit(n.body, s); return; }
    case "SwitchStatement": { visit(n.discriminant, sc); const s = new Scope(sc); n.cases.forEach((c) => hoist(c.consequent, s)); n.cases.forEach((c) => { visit(c.test, s); c.consequent.forEach((x) => visit(x, s)); }); return; }
    case "VariableDeclaration": n.declarations.forEach((d) => { pattern(d.id, sc, true); visit(d.init, sc); }); return;
    case "MemberExpression": visit(n.object, sc); if (n.computed) visit(n.property, sc); return;
    case "Property": if (n.computed) visit(n.key, sc); if (n.shorthand && n.value.type === "Identifier") addRef(n.value, sc); else visit(n.value, sc); return;
    case "LabeledStatement": visit(n.body, sc); return;
    case "BreakStatement": case "ContinueStatement": case "MetaProperty": return;
    case "AssignmentExpression": if (n.left.type === "Identifier") addRef(n.left, sc, true); else if (n.left.type === "ObjectPattern" || n.left.type === "ArrayPattern") pattern(n.left, sc, false, true); else visit(n.left, sc); visit(n.right, sc); return;
    case "UpdateExpression": if (n.argument.type === "Identifier") addRef(n.argument, sc, true); else visit(n.argument, sc); return;
    default: for (const k of Object.keys(n)) { if (["type", "loc", "start", "end"].includes(k)) continue; const v = n[k]; if (Array.isArray(v)) v.forEach((c) => visit(c, sc)); else if (v && typeof v.type === "string") visit(v, sc); }
  }
}
const top = new Scope(null);
for (const n of topNodes) { owner = n; visit(n, top); }
// —— 計算每個節點用到的名稱 ——
const used = new Map(); for (const n of topNodes) used.set(n, new Set());
for (const r of refs) { used.get(r.owner).add(r.name); if (r.write && nodeOf.has(r.name) && targetOf.has(r.owner) && nodeOf.get(r.name) !== r.owner) throw new Error(`搬移的程式碼會改寫 ${base} 的頂層變數 ${r.name}，無法搬移`); }
const exportedNames = new Set(topNodes.filter((n) => n.type === "ExportNamedDeclaration").flatMap(namesOf));
const needExportInM = new Set();
// —— 輸出新檔案 ——
const rel = (nf) => "./" + nf.replace(/\.js$/, "") + ".js";
const prevEnd = (n) => { const i = topNodes.indexOf(n); return i > 0 ? topNodes[i - 1].end : (imports.length ? imports.at(-1).end : 0); };
const segOf = (n) => { const a = n.type === "ExportNamedDeclaration" ? prevEnd(n) : prevEnd(n); return { a, text: S.slice(a, n.end), nodeOffset: n.start - a }; };
const moved = new Map(); // nf -> nodes
for (const [n, nf] of targetOf) (moved.get(nf) ?? moved.set(nf, []).get(nf)).push(n);
for (const [nf, nodes] of moved) nodes.sort((x, y) => x.start - y.start);
for (const [nf, nodes] of moved) {
  const imp = new Map(); // source -> Set(spec text)
  const add = (src, text) => (imp.get(src) ?? imp.set(src, new Set()).get(src)).add(text);
  for (const n of nodes) for (const nm of used.get(n)) {
    if (nodeOf.has(nm)) { const tn = nodeOf.get(nm), tf = targetOf.get(tn); if (tf === nf) continue; if (tf) add(rel(tf), nm); else { add("./" + base, nm); needExportInM.add(nm); } }
    else if (importMap.has(nm)) { const m = importMap.get(nm); add(m.source, m.text); }
  }
  const lines = [...imp.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([src, set]) => `import { ${[...set].sort().join(", ")} } from "${src}";`);
  let out = `/** ${spec[nf].desc} */\n${lines.join("\n")}${lines.length ? "\n" : ""}\n`;
  for (const n of nodes) {
    const { text, nodeOffset } = segOf(n);
    out += (n.type === "ExportNamedDeclaration" ? text : text.slice(0, nodeOffset) + "export " + text.slice(nodeOffset)).replace(/^\n+/, "\n");
    out += "\n";
  }
  fs.writeFileSync(path.join(dir, nf), out.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n") );
}
// —— 改寫原模組 ——
let edits = [];
for (const [n] of targetOf) edits.push({ a: prevEnd(n), b: n.end, t: "" });
for (const nm of needExportInM) { const n = nodeOf.get(nm); if (n.type !== "ExportNamedDeclaration" && !targetOf.has(n)) edits.push({ a: n.start, b: n.start, t: "export " }); }
// 原模組仍需要的名稱（留下的程式碼用到了被搬走的名稱）
const stay = topNodes.filter((n) => !targetOf.has(n));
const needFrom = new Map();
for (const n of stay) for (const nm of used.get(n)) if (nodeOf.has(nm) && targetOf.has(nodeOf.get(nm))) { const f = targetOf.get(nodeOf.get(nm)); (needFrom.get(f) ?? needFrom.set(f, new Set()).get(f)).add(nm); }
// 轉發：原本有匯出、被搬走的名稱
const reexport = new Map();
for (const [n, nf] of targetOf) { const ex = n.type === "ExportNamedDeclaration"; if (ex) (reexport.get(nf) ?? reexport.set(nf, []).get(nf)).push(...namesOf(n)); }
// 修剪不再使用的 import
const stillUsed = new Set(); for (const n of stay) used.get(n).forEach((x) => stillUsed.add(x));
for (const n of imports) {
  const keep = n.specifiers.filter((s) => stillUsed.has(s.local.name));
  if (keep.length === n.specifiers.length) continue;
  const text = keep.length ? `import { ${keep.map((s) => (s.imported && s.imported.name !== s.local.name ? `${s.imported.name} as ${s.local.name}` : s.local.name)).join(", ")} } from "${n.source.value}";` : "";
  edits.push({ a: n.start, b: n.end, t: text });
}
const addLines = [...needFrom.entries()].map(([f, set]) => `import { ${[...set].sort().join(", ")} } from "${rel(f)}";`).concat([...reexport.entries()].map(([f, names]) => `export { ${[...new Set(names)].sort().join(", ")} } from "${rel(f)}";`));
const insertAt = imports.length ? imports.at(-1).end : 0;
edits.push({ a: insertAt, b: insertAt, t: "\n" + addLines.join("\n") });
edits.sort((x, y) => y.a - x.a || y.b - x.b);
let out = S; for (const e of edits) out = out.slice(0, e.a) + e.t + out.slice(e.b);
fs.writeFileSync(file, out.replace(/\n{3,}/g, "\n\n"));
for (const [nf, nodes] of moved) console.log(`${nf}: ${nodes.length} 個宣告，${fs.readFileSync(path.join(dir, nf), "utf8").split("\n").length} 行`);
console.log(`${base}: ${out.split("\n").length} 行（原 ${S.split("\n").length}）`);
