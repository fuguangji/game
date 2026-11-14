/**
 * ui/control-diagrams — 操作簡圖（內嵌 SVG，沒有外部圖片，不增加請求數）
 *
 *   controlSvg("desktop" | "mobile")  回傳 SVG 字串
 *   controlCard(mode?)                回傳「操作簡圖」卡片（含電腦／手機切換），預設顯示目前平台
 * 首頁與圖鑑「操作」分頁共用。圖中的文字都是靜態文案，不含任何使用者輸入。
 */
import { platform } from "../core/platform.js";

const C = { line: "#8fe3cf", dim: "#8fe3cf55", fill: "#8fe3cf1c", pink: "#ff3d9a", gold: "#ffe14a", txt: "#d8f4ff", mute: "#9db3c4" };

const t = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" fill="${o.fill || C.txt}" font-size="${o.size || 9}" text-anchor="${o.anchor || "middle"}"${o.bold ? ' font-weight="700"' : ""}>${s}</text>`;
const key = (x, y, label, w = 22) =>
  `<rect x="${x}" y="${y}" width="${w}" height="20" rx="4" fill="${C.fill}" stroke="${C.line}"/>${t(x + w / 2, y + 14, label, { size: 10, bold: true })}`;
const arrow = (x1, y1, x2, y2, col = C.gold) =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${col}" stroke-width="1.6" fill="none" marker-end="url(#ar)"/>`;
const defs = `<defs><marker id="ar" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="${C.gold}"/></marker></defs>`;

function desktop() {
  return `<svg viewBox="0 0 360 200" role="img" aria-label="電腦操作簡圖：WASD 移動、滑鼠瞄準與左鍵、Shift 衝刺、空白鍵術式場、滾輪切換技能" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,'Noto Sans TC',sans-serif">${defs}
  ${key(48, 40, "W")}${key(22, 64, "A")}${key(48, 64, "S")}${key(74, 64, "D")}
  ${t(60, 100, "移動", { bold: true, fill: C.line })}
  ${key(16, 132, "Shift", 48)}${t(40, 164, "衝刺（無敵）", { size: 8.5, fill: C.mute })}
  <rect x="74" y="132" width="110" height="20" rx="4" fill="${C.fill}" stroke="${C.line}"/>${t(129, 146, "空白鍵", { size: 10, bold: true })}
  ${t(129, 164, "展開術式場", { size: 8.5, fill: C.mute })}
  ${key(206, 132, "Z", 20)}${key(228, 132, "X", 20)}${key(250, 132, "C", 20)}${key(272, 132, "V", 20)}
  ${t(239, 164, "直接施放技能", { size: 8.5, fill: C.mute })}
  <rect x="226" y="24" width="64" height="86" rx="30" fill="${C.fill}" stroke="${C.line}" stroke-width="1.6"/>
  <path d="M258 24V62M226 62H290" stroke="${C.line}" stroke-width="1.2"/>
  <path d="M226 62V54A32 32 0 0 1 258 24V62Z" fill="${C.pink}" fill-opacity=".35"/>
  <rect x="254" y="34" width="8" height="16" rx="4" fill="${C.gold}"/>
  ${t(212, 52, "左鍵", { anchor: "end", bold: true, fill: C.pink })}${t(212, 63, "發射／施放", { anchor: "end", size: 8.5, fill: C.mute })}
  ${t(304, 44, "滾輪", { anchor: "start", bold: true, fill: C.gold })}${t(304, 55, "切換技能", { anchor: "start", size: 8.5, fill: C.mute })}
  ${t(258, 122, "移動滑鼠 = 瞄準", { size: 8.5, fill: C.line })}
  ${t(180, 188, "1 2 / Q 換槍　P / Esc 暫停　F 全螢幕", { size: 8.5, fill: C.mute })}
</svg>`;
}

function mobile() {
  return `<svg viewBox="0 0 360 200" role="img" aria-label="手機操作簡圖：左半邊移動搖桿；點右側技能鈕選定技能，右半邊拖曳瞄準，放開發射；DASH 與 SUPER 按鈕" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,'Noto Sans TC',sans-serif">${defs}
  <rect x="6" y="6" width="348" height="150" rx="16" fill="#0a1411" stroke="${C.line}" stroke-width="1.6"/>
  <line x1="180" y1="14" x2="180" y2="148" stroke="${C.dim}" stroke-dasharray="3 4"/>
  <circle cx="70" cy="108" r="28" fill="${C.fill}" stroke="${C.line}" stroke-width="1.4"/><circle cx="76" cy="102" r="11" fill="${C.line}" fill-opacity=".55"/>
  ${t(70, 150, "移動搖桿", { size: 8.5, bold: true, fill: C.line })}${t(70, 36, "左半邊", { size: 8.5, fill: C.mute })}
  <circle cx="262" cy="106" r="28" fill="${C.pink}" fill-opacity=".1" stroke="${C.pink}" stroke-width="1.4"/><circle cx="262" cy="106" r="8" fill="none" stroke="${C.pink}" stroke-dasharray="2 2"/><circle cx="276" cy="94" r="11" fill="${C.pink}" fill-opacity=".5"/>
  ${t(262, 150, "瞄準搖桿・放開發射", { size: 8.5, bold: true, fill: C.pink })}${t(262, 36, "右半邊", { size: 8.5, fill: C.mute })}
  ${[0, 1].map((r) => [0, 1].map((c) => `<rect x="${298 + c * 24}" y="${42 + r * 20}" width="20" height="16" rx="4" fill="${r === 0 && c === 1 ? C.gold : C.fill}" fill-opacity="${r === 0 && c === 1 ? 0.5 : 1}" stroke="${r === 0 && c === 1 ? C.gold : C.line}"/>`).join("")).join("")}
  <circle cx="226" cy="74" r="13" fill="${C.fill}" stroke="${C.gold}"/>${t(226, 77, "SUPER", { size: 6.5, bold: true, fill: C.gold })}
  <circle cx="196" cy="120" r="12" fill="${C.fill}" stroke="${C.line}"/>${t(196, 123, "DASH", { size: 6.5, bold: true })}
  ${t(318, 32, "技能鈕", { size: 8.5, bold: true, fill: C.gold })}
  <g transform="translate(0,166)">
    <rect x="6" y="0" width="348" height="30" rx="8" fill="${C.fill}" stroke="${C.dim}"/>
    ${t(40, 19, "① 點技能選定", { size: 9, bold: true, fill: C.gold })}${arrow(78, 15, 96, 15)}
    ${t(130, 19, "② 拖曳瞄準", { size: 9, bold: true, fill: C.pink })}${arrow(168, 15, 186, 15)}
    ${t(222, 19, "③ 放開施放", { size: 9, bold: true, fill: C.line })}${t(312, 19, "拖回中心＝取消", { size: 8, fill: C.mute })}
  </g>
</svg>`;
}

/** 操作簡圖 SVG；mode = "desktop" | "mobile" */
export const controlSvg = (mode) => (mode === "mobile" ? mobile() : desktop());

/**
 * 「操作簡圖」卡片：標題 + 電腦／手機切換 + 圖 + 一句話說明。預設顯示目前平台。
 * 只用 DOM API 組裝；SVG 字串是上面的靜態文案。
 */
export function controlCard(initial = platform.mode) {
  const box = document.createElement("div");
  box.className = "x-ctl";
  const head = document.createElement("div");
  head.className = "x-ctl-h";
  const title = document.createElement("b");
  title.textContent = "操作簡圖";
  const tabs = document.createElement("div");
  tabs.className = "x-ctl-t";
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "切換操作簡圖");
  const fig = document.createElement("div");
  fig.className = "x-ctl-f";
  const cap = document.createElement("small");
  cap.className = "x-ctl-c";
  const CAPS = {
    desktop: "WASD 走位，滑鼠指哪打哪；技能先用滾輪選定、再按左鍵，或直接按 Z X C V。",
    mobile: "技能先「點選」、再「拖曳瞄準」、最後「放開施放」；點技能鈕不會直接發動，拖回中心放開可取消。",
  };
  const btns = {};
  const show = (mode) => {
    fig.innerHTML = controlSvg(mode); // 靜態文案，沒有使用者輸入
    cap.textContent = CAPS[mode];
    for (const [m, b] of Object.entries(btns)) b.setAttribute("aria-pressed", String(m === mode));
  };
  for (const [m, label] of [["desktop", "電腦"], ["mobile", "手機"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "x-ctl-b";
    b.textContent = label;
    b.addEventListener("click", () => show(m));
    btns[m] = b;
    tabs.append(b);
  }
  head.append(title, tabs);
  box.append(head, fig, cap);
  show(initial);
  return box;
}
