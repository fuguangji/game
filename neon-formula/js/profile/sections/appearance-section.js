import { h } from "../../core/dom-utils.js";
import { EDITOR_BODY_RADIUS, EDITOR_SIZE, MAX_POINTS, MAX_STROKES, MIN_IN_GAME_LINE_WIDTH, MAX_BRUSH, MIN_BRUSH, drawRoleAura, paintStrokes, skinStore } from "../appearance.js";
import { ProfileSection } from "./profile-section.js";

const PREVIEW_PX = 112;
const PREVIEW_ZOOM = 4; // 預覽：遊戲內實際大小放大 4 倍
const IN_GAME_RADIUS = 12;

/** 角色外觀設計：左邊編輯，右邊「遊戲內實際大小」預覽（兩邊共用同一支繪製程式，所見即所得） */
export class AppearanceSection extends ProfileSection {
  #el;
  #deps;
  #strokes = structuredClone(skinStore.strokes);
  #active = null;
  #canvas = h("canvas", { class: "ns-skin-canvas", width: EDITOR_SIZE, height: EDITOR_SIZE, "aria-label": "角色外觀繪圖畫布" });
  #preview = h("canvas", { class: "ns-skin-preview", width: PREVIEW_PX, height: PREVIEW_PX, "aria-label": "遊戲內實際大小預覽" });
  #color = h("input", { type: "color", value: "#ff4dff", "aria-label": "筆刷顏色" });
  #width = h("input", { type: "range", min: MIN_BRUSH, max: MAX_BRUSH, value: 5, "aria-label": "筆刷粗細" });
  #status = h("p", { class: "ns-feature-status" }, "外觀只影響造型，不會增加戰鬥能力。");
  #abort = new AbortController();

  /** @param {import('../profile-page.js').ProfileDeps} deps */
  constructor(deps) {
    super({ id: "appearance", title: "角色外觀" });
    this.#deps = deps;
    const btn = (label, fn, primary) => h("button", { type: "button", class: "ns-feature-btn" + (primary ? " primary" : ""), onclick: fn }, label);
    this.#el = h("section", { class: "ns-feature-card ns-appearance" },
      h("h3", {}, "角色外觀設計"),
      h("p", { class: "ns-feature-help" }, "在圓圈內繪製圖樣；圓圈外的部分不會顯示。右側是遊戲裡的實際樣子（放大 4 倍）。職業光環使用目前職業的代表色。"),
      h("div", { class: "ns-appearance-body" },
        this.#canvas,
        h("div", { class: "ns-appearance-side" }, h("div", { class: "ns-preview-caption" }, "遊戲內實際大小 ×4"), this.#preview,
          h("div", { class: "ns-skin-tools" }, h("label", {}, "筆色", this.#color), h("label", {}, "粗細", this.#width)))),
      h("div", { class: "ns-feature-row" },
        btn("復原", () => { this.#strokes.pop(); this.#paint(); }), btn("清空", () => { this.#strokes = []; this.#paint(); }),
        btn("套用外觀", () => this.#apply(), true), btn("移除外觀", () => this.#remove())),
      this.#status);
    const c = this.#canvas, signal = this.#abort.signal;
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.#strokes.length >= MAX_STROKES) { this.#say(`筆畫已達上限（${MAX_STROKES} 筆），請先清空或復原。`); return; }
      c.setPointerCapture(e.pointerId);
      this.#active = { color: this.#color.value, width: Number(this.#width.value), points: [this.#point(e)] };
      this.#strokes.push(this.#active);
      this.#paint();
    }, { signal });
    c.addEventListener("pointermove", (e) => {
      if (!this.#active || this.#active.points.length >= MAX_POINTS) return;
      e.preventDefault();
      this.#active.points.push(this.#point(e));
      this.#paint();
    }, { signal });
    for (const type of ["pointerup", "pointercancel"]) c.addEventListener(type, () => { this.#active = null; }, { signal });
    this.#paint();
  }

  get element() { return this.#el; }

  onShow() { this.#strokes = structuredClone(skinStore.strokes); this.#paint(); }

  destroy() { this.#abort.abort(); }

  #say(text) { this.#status.textContent = text; }

  #apply() {
    const persisted = skinStore.save(this.#strokes);
    this.#say(persisted ? "已套用！回到戰鬥即可看到自訂外觀。" : "已套用，但瀏覽器無法儲存（可能是隱私模式或空間已滿），重新整理後會消失。");
  }

  #remove() {
    this.#strokes = [];
    skinStore.clear();
    this.#paint();
    this.#say("已移除自訂外觀。");
  }

  #point(e) {
    const r = this.#canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }

  #paint() {
    const color = this.#deps.bridge.getRoleColor();
    const ctx = this.#canvas.getContext("2d"), S = EDITOR_SIZE;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#070d18"; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = "#ffffff12"; ctx.lineWidth = 1;
    for (let i = 0; i <= S; i += 30) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.fillStyle = color + "22"; ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, EDITOR_BODY_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    paintStrokes(ctx, this.#strokes, EDITOR_BODY_RADIUS); // 圓圈外會被裁掉，和遊戲一致
    ctx.restore();
    // 遊戲內實際大小預覽
    const p = this.#preview.getContext("2d");
    p.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);
    p.save();
    p.translate(PREVIEW_PX / 2, PREVIEW_PX / 2);
    p.scale(PREVIEW_ZOOM, PREVIEW_ZOOM);
    p.shadowColor = color; p.shadowBlur = 16 / PREVIEW_ZOOM; p.strokeStyle = color; p.fillStyle = color + "33"; p.lineWidth = 2.5;
    p.beginPath(); p.arc(0, 0, IN_GAME_RADIUS, 0, Math.PI * 2); p.fill(); p.stroke();
    p.shadowBlur = 0;
    if (this.#deps.settings.get("showAura")) drawRoleAura(p, IN_GAME_RADIUS, color, 0);
    paintStrokes(p, this.#strokes, IN_GAME_RADIUS, { minLineWidth: MIN_IN_GAME_LINE_WIDTH });
    p.restore();
  }
}
