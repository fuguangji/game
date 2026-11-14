import { h } from "../../core/dom-utils.js";
import { drawRoleAura, SkinRenderer, skinStore } from "../appearance.js";
import { ProfileSection } from "./profile-section.js";

const AVATAR_PX = 112;
const AVATAR_RADIUS = 34;

/** 個人檔案：頭像（含目前外觀）、暱稱、帳號狀態與遊戲進度 */
export class OverviewSection extends ProfileSection {
  #el;
  #deps;
  #avatar = h("canvas", { class: "ns-avatar", width: AVATAR_PX, height: AVATAR_PX, "aria-label": "角色預覽" });
  #renderer = new SkinRenderer(skinStore); // 專用的繪製器，不與遊戲內的貼圖快取互相覆蓋
  #name = h("div", { class: "ns-profile-name" });
  #status = h("span", { class: "ns-feature-status" });
  #stats = h("div", { class: "ns-stats" });
  #abort = new AbortController();

  /** @param {import('../profile-page.js').ProfileDeps} deps */
  constructor(deps) {
    super({ id: "overview", title: "個人檔案" });
    this.#deps = deps;
    const goto = (tab, label, primary) => h("button", { type: "button", class: "ns-feature-btn" + (primary ? " primary" : ""), onclick: () => deps.bridge.goTo(tab) }, label);
    this.#el = h("section", { class: "ns-feature-card ns-overview" },
      h("h3", {}, "個人檔案"),
      h("div", { class: "ns-profile-head" }, this.#avatar, h("div", { class: "ns-profile-id" }, this.#name, this.#status)),
      h("h3", {}, "遊戲進度"), this.#stats,
      h("div", { class: "ns-feature-row" }, goto("b", "前往備戰", true), goto("h", "返回大廳")));
    const redraw = () => this.#refresh();
    deps.accountService.addEventListener("change", redraw, { signal: this.#abort.signal });
    skinStore.addEventListener("change", redraw, { signal: this.#abort.signal });
    deps.settings.addEventListener("change", redraw, { signal: this.#abort.signal });
    this.#refresh();
  }

  get element() { return this.#el; }

  onShow() { this.#refresh(); }

  destroy() { this.#abort.abort(); }

  #refresh() {
    const { accountService, bridge, settings } = this.#deps;
    this.#name.textContent = accountService.displayName; // textContent：暱稱不會被當成 HTML
    this.#status.textContent = !accountService.signedIn ? "本機存檔 · 尚未連結線上帳號" : accountService.unlocked ? "雲端帳號 · 金鑰已解鎖" : "雲端帳號 · 需要密碼解鎖";
    const color = bridge.getRoleColor();
    const ctx = this.#avatar.getContext("2d");
    ctx.clearRect(0, 0, AVATAR_PX, AVATAR_PX);
    ctx.save();
    ctx.translate(AVATAR_PX / 2, AVATAR_PX / 2);
    ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.strokeStyle = color; ctx.fillStyle = color + "33"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, AVATAR_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    if (settings.get("showAura")) drawRoleAura(ctx, AVATAR_RADIUS, color, 0);
    if (settings.get("showSkin")) this.#renderer.draw(ctx, AVATAR_RADIUS, 1);
    ctx.restore();
    const p = bridge.getProgress();
    this.#stats.replaceChildren(...[
      ["已通關", `${p.clearedStages} / ${p.totalStages}`], ["最高分", String(p.bestScore)],
      ["已解鎖槍械", `${p.ownedWeapons} / ${p.totalWeapons}`], ["已解鎖角色", `${p.ownedCharacters} / ${p.totalCharacters}`],
    ].map(([label, value]) => h("div", { class: "ns-stat" }, h("span", {}, label), h("b", {}, value))));
  }
}
