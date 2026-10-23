/**
 * ui/feedback — 讓操作「有回應」：toast 通知與確認對話框
 *
 * - toast：不擋操作的小提示（購買成功、裝備完成、錯誤…），自動消失，螢幕閱讀器會朗讀
 * - confirmDialog：取代瀏覽器內建的 window.confirm（樣式一致、可用鍵盤、可顯示多行說明）
 *
 * 兩者都只在第一次呼叫時才建立 DOM，所以載入模組本身沒有副作用。
 */
import { h } from "../core/dom-utils.js";

const MAX_TOASTS = 4;
let toastHost = null;
let activeDialog = null;

function ensureToastHost() {
  if (toastHost?.isConnected) return toastHost;
  toastHost = h("div", { class: "ns-toasts", role: "status", "aria-live": "polite", "aria-atomic": "false" });
  document.body.append(toastHost);
  return toastHost;
}

/**
 * 顯示一則 toast
 * @param {string} message
 * @param {{type?: "info"|"success"|"warn"|"error", duration?: number}} [options]
 * @returns {() => void} 手動關閉的函式
 */
export function toast(message, { type = "info", duration = 3200 } = {}) {
  const host = ensureToastHost();
  const item = h("div", { class: `ns-toast ns-toast-${type}` }, String(message));
  host.append(item);
  while (host.children.length > MAX_TOASTS) host.children[0].remove?.();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    item.classList.add("out");
    setTimeout(() => item.remove?.(), 200);
  };
  if (duration > 0) setTimeout(close, duration);
  item.addEventListener("click", close);
  return close;
}

/**
 * 顯示確認對話框
 * @param {{title: string, body?: string|Node, confirmText?: string, cancelText?: string, danger?: boolean}} options
 * @returns {Promise<boolean>} 按「確定」回傳 true；按取消、Esc 或點背景回傳 false
 */
export function confirmDialog({ title, body = "", confirmText = "確定", cancelText = "取消", danger = false }) {
  activeDialog?.(false); // 同一時間只留一個對話框
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const confirmBtn = h("button", { type: "button", class: `x-btn ${danger ? "dng" : "pri"}` }, confirmText);
    const cancelBtn = h("button", { type: "button", class: "x-btn" }, cancelText);
    const lines = typeof body === "string" ? body.split("\n").map((line) => h("p", {}, line)) : [body];
    const sheet = h("div", { class: "ns-dialog-sheet", role: "alertdialog", "aria-modal": "true", "aria-label": title },
      h("h2", {}, title),
      h("div", { class: "ns-dialog-body" }, ...lines),
      h("div", { class: "ns-dialog-actions" }, cancelBtn, confirmBtn));
    const overlay = h("div", { class: "ns-dialog" }, sheet);
    const finish = (result) => {
      if (activeDialog !== finish) return;
      activeDialog = null;
      globalThis.removeEventListener?.("keydown", onKey, true);
      overlay.remove?.();
      previousFocus?.focus?.();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault?.(); e.stopPropagation?.(); finish(false); }
      else if (e.key === "Tab") { // 把焦點鎖在對話框內
        e.preventDefault?.();
        (document.activeElement === confirmBtn ? cancelBtn : confirmBtn).focus();
      }
    };
    confirmBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) finish(false); });
    activeDialog = finish;
    globalThis.addEventListener?.("keydown", onKey, true);
    document.body.append(overlay);
    (danger ? cancelBtn : confirmBtn).focus(); // 危險操作預設停在「取消」，避免手滑
  });
}
