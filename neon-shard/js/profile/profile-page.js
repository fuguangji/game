/**
 * 個人檔案頁面：以分頁組合五個區塊（個人檔案、設定、外觀、雲端同步、線上聯機）。
 * 頁面本身不認識遊戲內部——遊戲的資料與動作全部由 deps.bridge 提供，方便獨立測試。
 */
import { h } from "../core/dom-utils.js";
import { AppearanceSection } from "./sections/appearance-section.js";
import { CloudSection } from "./sections/cloud-section.js";
import { OnlineSection } from "./sections/online-section.js";
import { OverviewSection } from "./sections/overview-section.js";
import { SettingsSection } from "./sections/settings-section.js";

/**
 * @typedef {object} ProfileBridge 遊戲端提供的資料與動作
 * @property {() => object} getSave 取得目前存檔的副本
 * @property {(save: object) => void} applySave 套用（已驗證的）雲端存檔
 * @property {() => {clearedStages:number,totalStages:number,bestScore:number,ownedWeapons:number,totalWeapons:number,ownedCharacters:number,totalCharacters:number}} getProgress
 * @property {() => string} getRoleColor 目前職業的代表色（#rrggbb）
 * @property {() => number} getAutoAim
 * @property {(mode: number) => void} setAutoAim
 * @property {string[]} autoAimLabels 每種自動瞄準模式的說明
 * @property {() => void} replayTutorial
 * @property {() => void} replayShopGuide 重看「商店與芯片」互動導覽
 * @property {(tab: string) => void} goTo 切換大廳分頁
 * @property {() => ({x:number,y:number}|null)} getPlayerPosition 玩家位置（0~1）
 *
 * @typedef {object} ProfileDeps
 * @property {ProfileBridge} bridge
 * @property {import('../account/account-service.js').AccountService} accountService
 * @property {typeof import('../account/account-view.js').AccountView} AccountView
 * @property {import('../core/settings-store.js').SettingsStore} settings
 * @property {string} apiBase 雲端 API 網址
 */

const CSS_HIDDEN = "ns-profile-hidden";

export class ProfilePage {
  static #current = null;
  static #lastTab = "overview";

  #sections;
  #tabs = new Map();
  #panels = new Map();
  #active = null;

  /** 掛載頁面；同一時間只保留一個，舊的會先被清理（釋放監聽、計時器與連線） */
  static mount(container, deps) {
    ProfilePage.#current?.destroy();
    const page = new ProfilePage(container, deps);
    ProfilePage.#current = page;
    return page;
  }

  constructor(container, deps) {
    this.#sections = [new OverviewSection(deps), new SettingsSection(deps), new AppearanceSection(deps), new CloudSection(deps), new OnlineSection(deps)];
    const nav = h("div", { class: "ns-tabs", role: "tablist", "aria-label": "個人檔案分頁", onkeydown: (e) => this.#onKey(e) });
    const panels = h("div", { class: "ns-tab-panels" });
    for (const section of this.#sections) {
      const tab = h("button", { type: "button", class: "ns-tab", role: "tab", id: `ns-tab-${section.id}`, "aria-controls": `ns-panel-${section.id}`, onclick: () => this.show(section.id) }, section.title);
      const panel = h("div", { id: `ns-panel-${section.id}`, role: "tabpanel", "aria-labelledby": tab.id, class: CSS_HIDDEN }, section.element);
      this.#tabs.set(section.id, tab);
      this.#panels.set(section.id, panel);
      nav.append(tab);
      panels.append(panel);
    }
    container.replaceChildren(h("div", { class: "ns-profile" }, nav, panels));
    this.show(this.#sections.some((s) => s.id === ProfilePage.#lastTab) ? ProfilePage.#lastTab : "overview");
  }

  get activeId() { return this.#active; }

  show(id) {
    if (!this.#panels.has(id) || id === this.#active) return;
    const previous = this.#sections.find((s) => s.id === this.#active);
    previous?.onHide();
    for (const [key, panel] of this.#panels) {
      const on = key === id;
      panel.classList.toggle(CSS_HIDDEN, !on);
      this.#tabs.get(key).setAttribute("aria-selected", String(on));
      this.#tabs.get(key).tabIndex = on ? 0 : -1;
    }
    this.#active = id;
    ProfilePage.#lastTab = id;
    this.#sections.find((s) => s.id === id)?.onShow();
  }

  /** 方向鍵在分頁間移動（無障礙：tablist 的標準操作） */
  #onKey(e) {
    const ids = this.#sections.map((s) => s.id);
    const i = ids.indexOf(this.#active);
    const next = e.key === "ArrowRight" ? ids[(i + 1) % ids.length] : e.key === "ArrowLeft" ? ids[(i - 1 + ids.length) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids.at(-1) : null;
    if (!next) return;
    e.preventDefault();
    this.show(next);
    this.#tabs.get(next).focus();
  }

  destroy() {
    for (const section of this.#sections) section.destroy();
    if (ProfilePage.#current === this) ProfilePage.#current = null;
  }
}
