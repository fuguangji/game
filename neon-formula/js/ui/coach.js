/**
 * ui/coach — 互動式導覽引擎（聚光燈 + 說明卡片）
 *
 * 和舊版「請你自己點完再按『我已操作』」不同：
 *   - 亮起的目標才點得到，其他地方被遮罩擋住，新手不會迷路或誤觸
 *   - 完成條件由程式自動判斷（例如「真的買了芯片包」），不用自己回報
 *   - 每一步都有跳過鈕；Esc 也能離開
 *
 * 步驟格式（所有函式欄位都會在「進入該步」時才執行一次）：
 *   id        識別用
 *   title     標題
 *   body      說明文字，字串或 () => 字串
 *   target    () => Element | null   要聚光的元素；沒有就置中顯示
 *   advance   { type: "next" }（按鈕前進，目標區域被擋住不能點）
 *             { type: "when", test: () => boolean, delay?: ms }（輪詢條件，目標區域可以真的點）
 *             或回傳以上其一的函式
 *   hint      when 型步驟的提示（例如「👆 點亮起的按鈕」），字串或 () => 字串
 *   nextText  「下一步」按鈕文字
 *   actions   [{ label, primary?, run }] 最後一步用；按任一個即結束導覽
 *   enter     進入此步時執行（佈置畫面、補資源）
 *   done      條件達成、離開此步前執行（記錄結果）
 *   skipIf    () => boolean，為真就直接略過這一步
 *
 * 目標元素會被遊戲的重繪換掉，所以每一幀都重新取得 target() 並重新定位。
 */
import { h } from "../core/dom-utils.js";

const PAD = 6; // 聚光框比目標大一圈
const GAP = 10; // 卡片與聚光框的距離
const MARGIN = 12; // 卡片與螢幕邊緣的最小距離
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Coach {
  #steps = [];
  #index = -1;
  #step = null;
  #opts = {};
  #running = false;
  #advancing = false;
  #raf = 0;
  #lastScroll = 0;
  #lastLayout = "";
  #ui = null;
  #onKey = (e) => { if (e.key === "Escape") { e.preventDefault?.(); this.skip(); } };

  get running() { return this.#running; }
  get stepId() { return this.#step?.id ?? null; }

  /**
   * @param {object[]} steps
   * @param {{onFinish?: () => void, onSkip?: () => void, onAbort?: () => void, shouldAbort?: () => boolean}} [opts]
   */
  start(steps, opts = {}) {
    if (this.#running) this.#teardown();
    this.#steps = steps;
    this.#opts = opts;
    this.#running = true;
    this.#build();
    globalThis.addEventListener?.("keydown", this.#onKey, true);
    this.#enter(0);
    this.#tick();
  }

  /** 使用者按「跳過導覽」 */
  skip() {
    if (!this.#running) return;
    const cb = this.#opts.onSkip;
    this.#teardown();
    cb?.();
  }

  /** 非使用者造成的中斷（例如選單被關閉）：不標記為完成 */
  abort() {
    if (!this.#running) return;
    const cb = this.#opts.onAbort;
    this.#teardown();
    cb?.();
  }

  #finish() {
    const cb = this.#opts.onFinish;
    this.#teardown();
    cb?.();
  }

  #teardown() {
    this.#running = false;
    globalThis.cancelAnimationFrame?.(this.#raf);
    globalThis.removeEventListener?.("keydown", this.#onKey, true);
    this.#ui?.root.remove?.();
    this.#ui = null;
    this.#step = null;
    this.#index = -1;
    this.#lastLayout = "";
  }

  /* ---------- 畫面 ---------- */
  #build() {
    const dims = [0, 1, 2, 3].map(() => h("div", { class: "ns-coach-dim" }));
    const ring = h("div", { class: "ns-coach-ring" });
    const block = h("div", { class: "ns-coach-block" });
    const progress = h("span", { class: "ns-coach-progress" });
    const bar = h("i");
    const skip = h("button", { type: "button", class: "ns-coach-skip", onclick: () => this.skip() }, "跳過導覽");
    const title = h("h3", {});
    const body = h("p", { class: "ns-coach-body" });
    const hint = h("p", { class: "ns-coach-hint" });
    const actions = h("div", { class: "ns-coach-actions" });
    const card = h("section", { class: "ns-coach-card", role: "dialog", "aria-live": "polite", "aria-label": "新手導覽" },
      h("div", { class: "ns-coach-top" }, progress, skip),
      h("div", { class: "ns-coach-bar" }, bar),
      title, body, hint, actions);
    const root = h("div", { class: "ns-coach" }, ...dims, block, ring, card);
    document.body.append(root);
    this.#ui = { root, dims, ring, block, card, progress, bar, title, body, hint, actions };
  }

  #enter(i) {
    const raw = this.#steps[i];
    if (!raw) return this.#finish();
    if (raw.skipIf?.()) return this.#enter(i + 1);
    this.#index = i;
    this.#advancing = false;
    this.#lastScroll = 0;
    raw.enter?.();
    const advance = (typeof raw.advance === "function" ? raw.advance() : raw.advance) ?? { type: "next" };
    const body = typeof raw.body === "function" ? raw.body() : raw.body;
    const hint = typeof raw.hint === "function" ? raw.hint() : raw.hint;
    this.#step = { ...raw, advance, body, hint };
    this.#renderCard();
  }

  #next() {
    const st = this.#step;
    if (!st || !this.#running) return;
    st.done?.();
    this.#enter(this.#index + 1);
  }

  #renderCard() {
    const ui = this.#ui, st = this.#step;
    const total = this.#steps.length;
    ui.progress.textContent = `步驟 ${this.#index + 1} / ${total}`;
    ui.bar.style.width = `${((this.#index + 1) / total) * 100}%`;
    ui.title.textContent = st.title;
    ui.body.textContent = st.body ?? "";
    ui.hint.textContent = st.advance.type === "when" ? (st.hint ?? "👆 請點亮起的地方") : "";
    ui.hint.style.display = ui.hint.textContent ? "block" : "none";
    const buttons = [];
    if (st.actions) {
      for (const a of st.actions) {
        buttons.push(h("button", { type: "button", class: `x-btn ${a.primary ? "pri" : ""}`, onclick: () => { this.#finish(); a.run?.(); } }, a.label));
      }
    } else if (st.advance.type === "next") {
      const last = this.#index === total - 1;
      buttons.push(h("button", { type: "button", class: "x-btn pri", onclick: () => this.#next() }, st.nextText ?? (last ? "完成" : "下一步")));
    }
    ui.actions.replaceChildren(...buttons);
    ui.actions.style.display = buttons.length ? "flex" : "none";
    this.#lastLayout = ""; // 內容變了，卡片大小也會變，強制重新定位
    buttons.find((b) => b.className.includes("pri"))?.focus?.();
  }

  /* ---------- 每幀：檢查完成條件、重新定位 ---------- */
  #tick() {
    if (!this.#running) return;
    if (this.#opts.shouldAbort?.()) return this.abort();
    const st = this.#step;
    if (st && st.advance.type === "when" && !this.#advancing) {
      let ok = false;
      try { ok = !!st.advance.test(); } catch (error) { console.error("[coach] 條件檢查失敗", error); }
      if (ok) {
        this.#advancing = true;
        this.#ui.hint.textContent = "✓ 做得好！";
        this.#ui.hint.classList.add("ok");
        setTimeout(() => { this.#ui?.hint.classList.remove("ok"); this.#next(); }, st.advance.delay ?? 450);
      }
    }
    if (this.#step) this.#layout();
    this.#raf = requestAnimationFrame(() => this.#tick());
  }

  #targetRect(st) {
    let el = null;
    try { el = st.target?.() ?? null; } catch { el = null; }
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    const now = performance.now();
    if ((r.top < 0 || r.bottom > innerHeight) && now - this.#lastScroll > 600) { // 目標在畫面外：捲到中間
      this.#lastScroll = now;
      el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
    return { left: r.left - PAD, top: r.top - PAD, right: r.right + PAD, bottom: r.bottom + PAD };
  }

  #layout() {
    const ui = this.#ui, st = this.#step;
    const vw = innerWidth, vh = innerHeight;
    const rect = this.#targetRect(st);
    const interactive = st.advance.type === "when";
    const cw = Math.min(ui.card.offsetWidth || 380, vw - MARGIN * 2), ch = ui.card.offsetHeight || 190;
    let x, y;
    if (!rect) {
      x = (vw - cw) / 2;
      y = (vh - ch) / 2;
    } else {
      const cx = clamp((rect.left + rect.right) / 2 - cw / 2, MARGIN, vw - cw - MARGIN);
      const below = vh - rect.bottom - MARGIN, above = rect.top - MARGIN;
      const right = vw - rect.right - MARGIN, left = rect.left - MARGIN;
      if (below >= ch + GAP) { x = cx; y = rect.bottom + GAP; }
      else if (above >= ch + GAP) { x = cx; y = rect.top - ch - GAP; }
      else if (right >= cw + GAP) { x = rect.right + GAP; y = clamp(rect.top, MARGIN, vh - ch - MARGIN); }
      else if (left >= cw + GAP) { x = rect.left - cw - GAP; y = clamp(rect.top, MARGIN, vh - ch - MARGIN); }
      else { x = cx; y = vh - ch - MARGIN; } // 放不下就貼在底部（會蓋到目標一小部分）
    }
    const key = [rect && `${rect.left}|${rect.top}|${rect.right}|${rect.bottom}`, vw, vh, interactive, x | 0, y | 0].join(",");
    if (key === this.#lastLayout) return;
    this.#lastLayout = key;
    const box = (l, t, w, hgt) => `left:${l}px;top:${t}px;width:${Math.max(0, w)}px;height:${Math.max(0, hgt)}px`;
    const [top, bottom, left, right] = ui.dims;
    if (rect) {
      top.style.cssText = box(0, 0, vw, rect.top);
      bottom.style.cssText = box(0, rect.bottom, vw, vh - rect.bottom);
      left.style.cssText = box(0, rect.top, rect.left, rect.bottom - rect.top);
      right.style.cssText = box(rect.right, rect.top, vw - rect.right, rect.bottom - rect.top);
      ui.ring.style.cssText = box(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      ui.block.style.cssText = interactive ? "display:none" : box(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    } else {
      top.style.cssText = box(0, 0, vw, vh);
      for (const d of [bottom, left, right]) d.style.cssText = "display:none";
      ui.ring.style.cssText = "display:none";
      ui.block.style.cssText = "display:none";
    }
    ui.card.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
}
