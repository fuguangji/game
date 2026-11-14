import { h } from "../../core/dom-utils.js";
import { ProfileSection } from "./profile-section.js";

/**
 * 畫面與效能：畫質、解析度、幀率上限、模擬頻率、動態補償、發光、粒子、震動、效能資訊。
 * 每個選項都直接寫入 SettingsStore；主迴圈與渲染每幀讀取，所以改了立刻生效（解析度會重設畫布）。
 */
export class PerformanceSection extends ProfileSection {
  #el;
  #abort = new AbortController();

  /** @param {import('../profile-page.js').ProfileDeps} deps */
  constructor(deps) {
    super({ id: "performance", title: "畫面效能" });
    const { settings } = deps;
    // 整頁只掛一個 change 監聽（原本每個選項各掛一個）；頁面被移除時由 destroy() 一併拆掉
    const syncers = [];
    const sync = (fn) => syncers.push(fn);
    settings.addEventListener("change", () => { for (const fn of syncers) fn(); }, { signal: this.#abort.signal });

    /** 一組單選：options = [[值, 文字], …]；值的型別必須與設定一致（數字或字串） */
    const choice = (name, title, help, options) => {
      const inputs = options.map(([value, label]) => {
        const input = h("input", { type: "radio", name: `ns-${name}`, checked: settings.get(name) === value, onchange: () => settings.set(name, value) });
        return [value, input, h("label", { class: "ns-option" }, input, h("span", {}, label))];
      });
      sync(() => inputs.forEach(([value, input]) => { input.checked = settings.get(name) === value; }));
      return h("div", {}, h("h4", { class: "ns-sub" }, title), h("p", { class: "ns-feature-help" }, help),
        h("div", { class: "ns-option-list", role: "radiogroup", "aria-label": title }, ...inputs.map((x) => x[2])));
    };
    const toggle = (name, title, help) => {
      const input = h("input", { type: "checkbox", checked: settings.get(name), onchange: () => settings.set(name, input.checked) });
      sync(() => { input.checked = settings.get(name); });
      return h("label", { class: "ns-option" }, input, h("span", {}, title), h("small", {}, help));
    };

    this.#el = h("section", { class: "ns-feature-card" },
      h("h3", {}, "畫質與解析度"),
      choice("quality", "畫質", "自動：維持高畫質；變慢時先由遊戲自動調整模擬頻率與粒子數量，不會先犧牲畫面。手動選擇則固定發光強度、粒子數量與解析度。",
        [["auto", "自動"], ["low", "低"], ["medium", "中"], ["high", "高"]]),
      choice("renderScale", "渲染解析度", "畫布像素比例；調低可大幅提升效能，畫面會稍微模糊（不影響操作）。",
        [[1, "100%"], [0.75, "75%"], [0.5, "50%"]]),
      h("h3", {}, "幀率"),
      choice("fpsCap", "繪製幀率上限", "只限制「畫」的次數，不影響遊戲速度。手機想省電可選 30。",
        [[0, "跟隨螢幕"], [30, "30"], [60, "60"], [90, "90"], [120, "120"]]),
      toggle("interpolation", "動態補償（插值）", "在兩次模擬之間補出中間位置，讓 90／120／144 Hz 螢幕以及自動降低模擬頻率時畫面仍然平順（建議保持開啟）"),
      h("h3", {}, "特效"),
      toggle("glowEffects", "發光特效", "陰影模糊造成的光暈，是最吃效能的特效；低階手機建議關閉"),
      choice("particleDensity", "粒子密度", "爆炸、擊中與拖尾的粒子數量。", [["auto", "跟隨畫質"], ["low", "少"], ["normal", "標準"], ["high", "多"]]),
      toggle("screenShake", "畫面震動", "受傷與爆炸時的鏡頭晃動"),
      toggle("showFps", "顯示效能資訊", "在畫面左上角顯示幀率、模擬頻率、繪製耗時與目前畫質檔位"));
  }

  get element() { return this.#el; }
  destroy() { this.#abort.abort(); }
}
