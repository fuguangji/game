/** 把任意文字轉成可安全放進 innerHTML 的字串（暱稱等使用者輸入一律先經過這裡） */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c]);
}

/**
 * 以 DOM API 建立元素；字串子節點一律走 textContent，天生不會有 XSS。
 * @param {string} tag
 * @param {Record<string, any>} [props] class / dataset / on* 事件 / 其他屬性
 * @param {...(Node|string|null|false)} children
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "style") el.style.cssText = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
