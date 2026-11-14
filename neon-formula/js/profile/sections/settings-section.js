import { h } from "../../core/dom-utils.js";
import { ProfileSection } from "./profile-section.js";

/** 設定：自動瞄準、顯示偏好、重看教學、重設 */
export class SettingsSection extends ProfileSection {
  #el;
  #deps;
  #radios = [];
  #abort = new AbortController();

  /** @param {import('../profile-page.js').ProfileDeps} deps */
  constructor(deps) {
    super({ id: "settings", title: "設定" });
    this.#deps = deps;
    const { bridge, settings } = deps;
    const aimGroup = h("div", { class: "ns-option-list", role: "radiogroup", "aria-label": "自動瞄準" },
      ...bridge.autoAimLabels.map((label, mode) => {
        const input = h("input", { type: "radio", name: "ns-auto-aim", value: String(mode), onchange: () => bridge.setAutoAim(mode) });
        this.#radios.push(input);
        return h("label", { class: "ns-option" }, input, h("span", {}, ["關閉", "輔助", "強力"][mode] ?? `模式 ${mode}`), h("small", {}, label));
      }));
    const modeInputs = [["auto", "自動"], ["desktop", "電腦"], ["mobile", "手機"]].map(([value, label]) => {
      const input = h("input", { type: "radio", name: "ns-control-mode", checked: settings.get("controlMode") === value, onchange: () => settings.set("controlMode", value) });
      settings.addEventListener("change", () => { input.checked = settings.get("controlMode") === value; }, { signal: this.#abort.signal });
      return h("label", { class: "ns-option" }, input, h("span", {}, label));
    });
    const modeGroup = h("div", { class: "ns-option-list", role: "radiogroup", "aria-label": "操作配置" }, ...modeInputs);
    const toggle = (name, title, help) => {
      const input = h("input", { type: "checkbox", checked: settings.get(name), onchange: () => settings.set(name, input.checked) });
      settings.addEventListener("change", () => { input.checked = settings.get(name); }, { signal: this.#abort.signal });
      return h("label", { class: "ns-option" }, input, h("span", {}, title), h("small", {}, help));
    };
    this.#el = h("section", { class: "ns-feature-card" },
      h("h3", {}, "遊戲操作"),
      h("p", { class: "ns-feature-help" }, "自動瞄準會在準星附近自動修正射擊方向；也可以在戰鬥中按 R 切換。"),
      aimGroup,
      h("h4", { class: "ns-sub" }, "操作配置"),
      h("p", { class: "ns-feature-help" }, "自動：依裝置判斷（觸控螢幕筆電會跟著你最近用的輸入切換）。也可以固定成電腦或手機配置；教學與首頁說明會跟著換。"),
      modeGroup,
      toggle("skillReturnBasic", "手機：技能施放後自動切回普通攻擊", "手機選定技能、瞄準並放開施放後，自動回到普通攻擊；關閉則保持選定"),
      h("h3", {}, "顯示"),
      toggle("showAura", "職業光環", "在角色周圍顯示職業代表色的粒子"),
      toggle("showSkin", "自訂外觀", "在角色身上顯示你繪製的圖樣（只在本機顯示）"),
      h("h3", {}, "其他"),
      h("div", { class: "ns-feature-row" },
        h("button", { type: "button", class: "ns-feature-btn", onclick: () => bridge.replayTutorial() }, "重看戰鬥教學"),
        h("button", { type: "button", class: "ns-feature-btn", onclick: () => bridge.replayShopGuide() }, "重看商店與芯片導覽"),
        h("button", { type: "button", class: "ns-feature-btn", onclick: () => settings.reset() }, "還原顯示設定")));
    this.onShow();
  }

  get element() { return this.#el; }

  onShow() {
    const mode = this.#deps.bridge.getAutoAim();
    this.#radios.forEach((r, i) => { r.checked = i === Number(mode); });
  }

  destroy() { this.#abort.abort(); }
}
