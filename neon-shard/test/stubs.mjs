// 瀏覽器環境的最小假物件：用 Proxy 吞掉所有 DOM 呼叫，讓遊戲能在 Node 裡載入並跑模擬
const mk = () => { const f = function () { return mk(); }; return new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === "length" ? 0 : k === "children" ? [] : k === "isConnected" ? true : (k in t ? t[k] : mk()), set: () => true, apply: () => mk(), construct: () => mk() }); };
const el = mk();
globalThis.document = { getElementById: () => el, createElement: () => el, querySelector: () => el, querySelectorAll: () => [], addEventListener() {}, documentElement: el, body: el, head: el, createTextNode: () => el };
globalThis.window = globalThis; globalThis.innerWidth = 900; globalThis.innerHeight = 600; globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {}; globalThis.matchMedia = () => ({ matches: false });
globalThis.MutationObserver = globalThis.ResizeObserver = function () { this.observe = () => {}; };
const mem = new Map(); globalThis.localStorage = { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });
globalThis.__raf = []; globalThis.requestAnimationFrame = (f) => { globalThis.__raf.push(f); return 1; };
globalThis.Worker = undefined; globalThis.Node = function () {};
