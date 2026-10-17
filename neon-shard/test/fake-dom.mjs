// 最小的假 DOM：夠 core/dom-utils.js 的 h() 與個人檔案頁面使用，用來驗證結構與事件（不模擬排版）
export class FakeNode { constructor() { this.parentNode = null; } get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === fakeDocument.body; } }
export class FakeText extends FakeNode { constructor(t) { super(); this.data = String(t); } get textContent() { return this.data; } }
class ClassList {
  constructor(el) { this.el = el; }
  #set() { return new Set(this.el.className.split(/\s+/).filter(Boolean)); }
  contains(c) { return this.#set().has(c); }
  add(c) { const s = this.#set(); s.add(c); this.el.className = [...s].join(" "); }
  remove(c) { const s = this.#set(); s.delete(c); this.el.className = [...s].join(" "); }
  toggle(c, force) { const on = force ?? !this.contains(c); on ? this.add(c) : this.remove(c); return on; }
}
export class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase(); this.children = []; this.className = ""; this.style = { cssText: "" }; this.dataset = {};
    this.attrs = {}; this.listeners = {}; this.classList = new ClassList(this);
    this.value = ""; this.checked = false; this.disabled = false; this.hidden = false; this.id = ""; this.type = ""; this.tabIndex = 0; this.width = 0; this.height = 0; this.maxLength = -1; this.min = ""; this.max = ""; this.placeholder = ""; this.name = "";
  }
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
  set textContent(t) { this.children = []; if (t !== "") this.append(new FakeText(t)); }
  append(...nodes) { for (const n of nodes) { n.parentNode?.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = this; this.children.push(n); } }
  replaceChildren(...nodes) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn, opts) {
    (this.listeners[type] ??= []).push(fn);
    opts?.signal?.addEventListener?.("abort", () => this.removeEventListener(type, fn));
  }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  dispatch(type, event = {}) { const e = { type, target: this, preventDefault() {}, ...event }; for (const fn of [...(this.listeners[type] ?? [])]) fn(e); }
  click() { if (!this.disabled) this.dispatch("click"); }
  focus() { fakeDocument.activeElement = this; }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 360 }; }
  getContext() { return fakeContext; }
  querySelectorAll(sel) { const out = []; const want = sel.split(",").map((s) => s.trim().toUpperCase()); (function walk(n) { for (const c of n.children) if (c instanceof FakeElement) { if (want.includes(c.tagName)) out.push(c); walk(c); } })(this); return out; }
  find(pred) { let found = null; (function walk(n) { for (const c of n.children) if (c instanceof FakeElement && !found) { if (pred(c)) found = c; else walk(c); } })(this); return found; }
  findAll(pred) { const out = []; (function walk(n) { for (const c of n.children) if (c instanceof FakeElement) { if (pred(c)) out.push(c); walk(c); } })(this); return out; }
}
// 記錄所有 canvas 呼叫的假 2D context
export const fakeContext = new Proxy({ calls: [] }, { get: (t, k) => k === "calls" ? t.calls : k === "canvas" ? {} : (...args) => { t.calls.push([k, ...args]); }, set: (t, k, v) => { t.calls.push(["set", k, v]); return true; } });
export const fakeDocument = {
  body: new FakeElement("body"), head: new FakeElement("head"), activeElement: null,
  createElement: (tag) => new FakeElement(tag), createTextNode: (t) => new FakeText(t),
  getElementById: () => null, querySelector: () => null, addEventListener() {},
};
fakeDocument.body.parentNode = null;
export function installFakeDom() { globalThis.document = fakeDocument; globalThis.Node = FakeNode; }
