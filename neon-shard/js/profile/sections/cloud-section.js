import { h } from "../../core/dom-utils.js";
import { ProfileSection } from "./profile-section.js";

/** 雲端同步：登入、解鎖金鑰、上傳／下載加密存檔（畫面與邏輯在 account/ 底下，這裡只負責掛上） */
export class CloudSection extends ProfileSection {
  #el;
  #view;

  /** @param {import('../profile-page.js').ProfileDeps} deps */
  constructor(deps) {
    super({ id: "cloud", title: "雲端同步" });
    const host = h("div");
    this.#el = h("section", { class: "ns-feature-card" }, h("h3", {}, "雲端同步"), host);
    this.#view = deps.AccountView.mount(host, deps.accountService, { getSave: deps.bridge.getSave, applySave: deps.bridge.applySave });
  }

  get element() { return this.#el; }

  destroy() { this.#view.destroy(); }
}
