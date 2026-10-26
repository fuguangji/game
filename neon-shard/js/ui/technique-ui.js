/**
 * ui/technique-ui — 術式系統的畫面：能量條、目前選定的格子（普通攻擊或某個技能）、術式場提示、同心圓面板
 *
 * 版面刻意做得很小，手機不會擠：同一時間只顯示「目前選定的那一格」，左右箭頭（或桌機的滾輪）切換，
 * 點它（或桌機按左鍵、手機在右半邊拖曳後放開）就是發動。
 * 只負責顯示與轉交點擊，不認識任何遊戲規則；由 techniques.js 每 0.1 秒傳入一份 vm 狀態。
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

/** 重新建立與目前武器相符的元件（換武器、格子數改變時才會呼叫） */
function rebuild(vm) {
  const en = h("div", { class: "tq-meter" }, h("i", { class: "tq-fill" }), h("span", { class: "tq-label" }));
  const extra = vm.meter ? h("div", { class: "tq-meter alt" }, h("i", { class: "tq-fill" }), h("span", { class: "tq-label" })) : null;
  const cd = h("i", { class: "tq-cd" }), name = h("b", { class: "tq-n" }), sub = h("small", { class: "tq-sub" }), time = h("em", { class: "tq-t" });
  const chip = h("button", { type: "button", class: "tq-chip", onpointerdown: press(() => vm.handlers.cast()) }, name, sub, cd, time);
  const prev = h("button", { type: "button", class: "tq-arrow", "aria-label": "上一個", onpointerdown: press(() => vm.handlers.cycle(-1)) }, "◀");
  const next = h("button", { type: "button", class: "tq-arrow", "aria-label": "下一個", onpointerdown: press(() => vm.handlers.cycle(1)) }, "▶");
  const dots = h("div", { class: "tq-dots" }, ...vm.slots.map((_, i) => h("i", { onpointerdown: press(() => vm.handlers.select(i)) })));
  const hint = h("div", { class: "tq-hint" }, "滾輪切換・左鍵發動");
  const domains = vm.domains.map((d) => h("small", { class: "tq-dom", title: d.name }, `${d.key}：${d.name}`));
  const rings = h("div", { class: "tq-rings" });
  ui.ref = { en, extra, cd, name, sub, time, chip, dots, domains, rings, ringBtns: [], blastBtn: null };
  ui.bar.replaceChildren(
    h("div", { class: "tq-meters" }, en, ...(extra ? [extra] : [])),
    rings,
    h("div", { class: "tq-sel" }, prev, chip, next),
    dots,
    h("div", { class: "tq-doms" }, ...domains),
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
  const sig = `${vm.weapon}|${vm.slots.length}|${vm.domains.length}|${vm.meter ? 1 : 0}`;
  if (sig !== built) { built = sig; rebuild(vm); }
  const r = ui.ref, slot = vm.slots[vm.sel];
  ui.bar.classList.add("on");
  ui.bar.style.setProperty("--tq", vm.color);
  fill(r.en, vm.en / vm.enMax, `能量 ${Math.round(vm.en)}`, vm.en > vm.enMax ? "#7ad6ff" : null);
  if (vm.meter) fill(r.extra, vm.meter.value / 100, `${vm.meter.name} ${Math.round(vm.meter.value)}`, vm.meter.color);
  r.name.textContent = slot.name;
  r.sub.textContent = vm.sel === 0 ? "" : `${slot.key} · ${slot.cost ? `耗能 ${slot.cost}` : "免費"}`;
  r.chip.title = slot.desc;
  r.cd.style.height = slot.cdMax > 0 ? `${Math.min(1, slot.cd / slot.cdMax) * 100}%` : "0%";
  r.time.textContent = slot.cd > 0 ? slot.cd.toFixed(slot.cd < 10 ? 1 : 0) : "";
  r.chip.classList.toggle("no", vm.sel > 0 && (vm.en < slot.cost || vm.sealed));
  r.chip.classList.toggle("act", slot.active);
  [...r.dots.children].forEach((d, i) => d.classList.toggle("on", i === vm.sel));
  vm.domains.forEach((d, i) => r.domains[i].classList.toggle("ready", d.ready && !vm.domainOn));
  syncRings(vm);
}

/** 塵流懸圖：9 個同心圓的控制面板（點一下切換旋轉，開啟「爆破」後點一下引爆該圈） */
function syncRings(vm) {
  const r = ui.ref, ringsData = vm.rings;
  r.ringsData = ringsData;
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
