/**
 * ui/technique-ui — 術式系統的畫面：能量條、全部技能按鈕（展開，名稱與耗能一目了然）、術式場鈕、同心圓面板
 *
 * - 所有技能都直接列出來，新手不必背技能。
 * - 電腦：點按鈕就施放；另外有「選定」功能：滾輪切換、左鍵發動，被選定的按鈕會亮框，第一顆「普攻」代表普通攻擊。
 * - 手機：點按鈕只是「選定」（再點取消），接著用右半邊的瞄準搖桿瞄準、放開才施放；
 *   「普攻」鈕永遠看得到，點它回到普通攻擊。這樣點選技能時不會誤發動（見 input-mobile.js）。
 * - 版面：電腦在畫面左下；手機縮成右側邊緣的兩欄按鈕，容器本身不吃觸控，只有按鈕吃，
 *   不會擋到瞄準與移動區（見 css/ui-kit.css 的 html[data-platform="mobile"]）。
 * 只負責顯示與轉交點擊，不認識遊戲規則；由 techniques.js 每 0.1 秒傳入一份 vm 狀態。
 */
import { h } from "../core/dom-utils.js";

let ui = null;
let built = "";

function build() {
  const bar = h("div", { id: "tqBar" });
  document.body.append(bar);
  ui = { bar };
}

const press = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };

/** 重新建立與目前武器相符的元件（換武器、技能數改變時才會呼叫） */
function rebuild(vm) {
  const en = h("div", { class: "tq-meter" }, h("i", { class: "tq-fill" }), h("span", { class: "tq-label" }));
  const extra = vm.meter ? h("div", { class: "tq-meter alt" }, h("i", { class: "tq-fill" }), h("span", { class: "tq-label" })) : null;
  const basic = h("button", { type: "button", class: "tq-btn tq-basic", title: vm.mobile ? "普通攻擊" : "普通攻擊（滾輪切回這格）", "aria-label": "普通攻擊", onpointerdown: press(() => vm.handlers.select(0)) },
    h("span", { class: "tq-n" }, "普攻"), h("small", { class: "tq-c" }, vm.mobile ? "拖曳" : "左鍵"));
  const skills = vm.slots.slice(1).map((s, i) => {
    const cd = h("i", { class: "tq-cd" }), time = h("em", { class: "tq-t" }), cost = h("small", { class: "tq-c" });
    const btn = h("button", { type: "button", class: "tq-btn", title: s.desc, "aria-label": s.name, onpointerdown: press(() => vm.handlers.skill(i)) },
      h("b", { class: "tq-k" }, s.key), h("span", { class: "tq-n" }, s.name), cost, cd, time);
    return { btn, cd, time, cost };
  });
  const domains = vm.domains.map((d, i) => ({
    btn: h("button", { type: "button", class: `tq-btn dom d${i}`, title: d.name, onpointerdown: press(() => vm.handlers.domain(i)) },
      h("b", { class: "tq-k" }, d.key), h("span", { class: "tq-n" }, d.name), h("small", { class: "tq-c" }, "術式場")),
  }));
  const rings = h("div", { class: "tq-rings" });
  const hint = h("div", { class: "tq-hint" }, vm.mobile ? "" : "滾輪切換・左鍵發動選定的格子");
  ui.ref = { en, extra, basic, skills, domains, rings, ringBtns: [], blastBtn: null };
  ui.bar.replaceChildren(
    h("div", { class: "tq-meters" }, en, ...(extra ? [extra] : [])),
    rings,
    h("div", { class: "tq-row" }, basic, ...skills.map((s) => s.btn), ...domains.map((d) => d.btn)),
    hint,
  );
}

function fill(el, frac, label, color) {
  if (!el) return;
  const bar = el.firstChild, text = el.lastChild;
  bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  if (color) bar.style.background = color;
  text.textContent = label;
}

/**
 * @param {null | object} vm null = 隱藏（沒有術式或不在戰鬥中）
 */
export function syncTechniqueUi(vm) {
  if (!ui) { if (!vm) return; build(); }
  if (!vm) { ui.bar.classList.remove("on"); built = ""; return; }
  const sig = `${vm.weapon}|${vm.slots.length}|${vm.domains.length}|${vm.meter ? 1 : 0}|${vm.mobile ? "m" : "d"}`;
  if (sig !== built) { built = sig; rebuild(vm); }
  const r = ui.ref;
  ui.bar.classList.add("on");
  ui.bar.classList.toggle("armed", vm.sel > 0); // 已選定技能：手機版用來讓整排按鈕變暗一點，只突顯被選的那顆
  ui.bar.style.setProperty("--tq", vm.color);
  fill(r.en, vm.en / vm.enMax, `能量 ${Math.round(vm.en)}`, vm.en > vm.enMax ? "#7ad6ff" : null);
  if (vm.meter) fill(r.extra, vm.meter.value / 100, `${vm.meter.name} ${Math.round(vm.meter.value)}`, vm.meter.color);
  r.basic.classList.toggle("sel", vm.sel === 0);
  vm.slots.slice(1).forEach((s, i) => {
    const el = r.skills[i];
    el.cd.style.height = s.cdMax > 0 ? `${Math.min(1, s.cd / s.cdMax) * 100}%` : "0%";
    el.time.textContent = s.cd > 0 ? s.cd.toFixed(s.cd < 10 ? 1 : 0) : "";
    el.cost.textContent = s.cost ? `${s.cost}` : "免費";
    el.btn.classList.toggle("no", vm.en < s.cost || vm.sealed);
    el.btn.classList.toggle("act", s.active);
    el.btn.classList.toggle("sel", vm.sel === i + 1);
  });
  vm.domains.forEach((d, i) => {
    const el = r.domains[i];
    el.btn.classList.toggle("ready", d.ready && !vm.domainOn);
    el.btn.classList.toggle("no", !d.ready || vm.domainOn || vm.sealed);
  });
  syncRings(vm);
}

/** 塵流懸圖：9 個同心圓的控制面板（點一下切換旋轉，開啟「爆破」後點一下引爆該圈） */
function syncRings(vm) {
  const r = ui.ref, ringsData = vm.rings;
  r.ringsData = ringsData; // 按鈕永遠呼叫最新一次的資料（重新展開術式場後閉包會換新）
  if (!ringsData) { r.rings.classList.remove("on"); return; }
  if (!r.ringBtns.length) {
    r.ringBtns = Array.from({ length: 9 }, (_, i) => h("button", { type: "button", class: "tq-ring", onpointerdown: press(() => r.ringsData?.tap(i + 1)) }, String(i + 1)));
    r.blastBtn = h("button", { type: "button", class: "tq-ring blast", onpointerdown: press(() => r.ringsData?.toggleBlast()) }, "爆破");
    r.rings.replaceChildren(...r.ringBtns, r.blastBtn);
  }
  r.rings.classList.add("on");
  r.ringBtns.forEach((b, i) => {
    const w = ringsData.speeds[i];
    b.classList.toggle("cw", w > 0);
    b.classList.toggle("ccw", w < 0);
    b.textContent = `${i + 1}${w > 0 ? "↻" : w < 0 ? "↺" : ""}`;
  });
  r.blastBtn.classList.toggle("on", ringsData.blast);
}
