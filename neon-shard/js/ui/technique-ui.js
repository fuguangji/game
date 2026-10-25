/**
 * ui/technique-ui — 術式系統的畫面：能量條、技能鈕（含冷卻）、術式場鈕、同心圓控制面板
 *
 * 只負責顯示與把點擊轉交給遊戲（由 techniques.js 每 0.1 秒傳入一份 vm 狀態），不認識任何遊戲規則。
 * 桌機用鍵盤（Z X C V B N、空白鍵、E、數字鍵），這裡的按鈕主要給手機點，也順便顯示冷卻與按鍵提示。
 */
import { h } from "../core/dom-utils.js";

let ui = null;
let built = "";

function build() {
  const bar = h("div", { id: "tqBar" });
  document.body.append(bar);
  ui = { bar, skills: [], domains: [], meters: {}, rings: null, ringBtns: [], blastBtn: null };
}

/** 重新建立與目前武器相符的按鈕（換武器、技能數改變時才會呼叫） */
function rebuild(vm) {
  const press = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  const energy = h("div", { class: "tq-meter" }, h("i", { class: "tq-fill" }), h("span", { class: "tq-label" }));
  const extra = vm.meter ? h("div", { class: "tq-meter alt" }, h("i", { class: "tq-fill" }), h("span", { class: "tq-label" })) : null;
  ui.meters = { en: energy, extra };
  ui.skills = vm.skills.map((s, i) => {
    const cd = h("i", { class: "tq-cd" }), time = h("em", { class: "tq-t" }), cost = h("small", { class: "tq-c" });
    const btn = h("button", { type: "button", class: "tq-btn", title: s.desc, onpointerdown: press(() => vm.handlers.skill(i)) },
      h("b", { class: "tq-k" }, s.key), h("span", { class: "tq-n" }, s.name), cost, cd, time);
    return { btn, cd, time, cost };
  });
  ui.domains = vm.domains.map((d, i) => {
    const btn = h("button", { type: "button", class: "tq-btn dom", title: d.name, onpointerdown: press(() => vm.handlers.domain(i)) },
      h("b", { class: "tq-k" }, d.key), h("span", { class: "tq-n" }, d.name), h("small", { class: "tq-c" }, "術式場"));
    return { btn };
  });
  ui.ringsPanel = h("div", { class: "tq-rings" });
  ui.ringBtns = [];
  ui.bar.replaceChildren(
    h("div", { class: "tq-meters" }, energy, ...(extra ? [extra] : [])),
    ui.ringsPanel,
    h("div", { class: "tq-row" }, ...ui.skills.map((s) => s.btn), ...ui.domains.map((d) => d.btn)),
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
  const sig = `${vm.weapon}|${vm.skills.length}|${vm.domains.length}|${vm.meter ? 1 : 0}`;
  if (sig !== built) { built = sig; rebuild(vm); }
  ui.bar.classList.add("on");
  ui.bar.style.setProperty("--tq", vm.color);
  fill(ui.meters.en, vm.en / vm.enMax, `能量 ${Math.round(vm.en)} / ${vm.enMax}`, vm.en > vm.enMax ? "#7ad6ff" : null);
  if (vm.meter) fill(ui.meters.extra, vm.meter.value / 100, `${vm.meter.name} ${Math.round(vm.meter.value)}`, vm.meter.color);
  vm.skills.forEach((s, i) => {
    const el = ui.skills[i];
    el.cd.style.height = s.cdMax > 0 ? `${Math.min(1, s.cd / s.cdMax) * 100}%` : "0%";
    el.time.textContent = s.cd > 0 ? s.cd.toFixed(s.cd < 10 ? 1 : 0) : "";
    el.cost.textContent = s.cost ? `${s.cost}` : "免費";
    el.btn.classList.toggle("no", vm.en < s.cost || vm.sealed);
    el.btn.classList.toggle("act", s.active);
  });
  vm.domains.forEach((d, i) => {
    const el = ui.domains[i];
    el.btn.classList.toggle("ready", d.ready && !vm.domainOn);
    el.btn.classList.toggle("no", !d.ready || vm.domainOn || vm.sealed);
  });
  syncRings(vm);
}

/** 塵流懸圖：9 個同心圓的控制面板（點一下切換旋轉，開啟「爆破」後點一下引爆該圈） */
function syncRings(vm) {
  const r = vm.rings;
  if (!r) { ui.ringsPanel.classList.remove("on"); return; }
  if (!ui.ringBtns.length) {
    ui.ringBtns = Array.from({ length: 9 }, (_, i) => h("button", { type: "button", class: "tq-ring", onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); r.tap(i + 1); } }, String(i + 1)));
    ui.blastBtn = h("button", { type: "button", class: "tq-ring blast", onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); r.toggleBlast(); } }, "爆破");
    ui.ringsPanel.replaceChildren(...ui.ringBtns, ui.blastBtn);
  }
  ui.ringsPanel.classList.add("on");
  ui.ringBtns.forEach((b, i) => {
    const w = r.speeds[i];
    b.classList.toggle("cw", w > 0);
    b.classList.toggle("ccw", w < 0);
    b.textContent = `${i + 1}${w > 0 ? "↻" : w < 0 ? "↺" : ""}`;
  });
  ui.blastBtn.classList.toggle("on", r.blast);
}
