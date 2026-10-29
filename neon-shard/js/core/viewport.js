/** core/viewport — 畫布、座標常數與視窗縮放 */
import { G } from "./game-state.js";
import { profile } from "./render-profile.js";

export let $, cv, cx; // 初始化在 init()
export let N, T, MW, TAU; // 初始化在 init()
// 依視窗大小重設畫布、縮放與像素比
export function resize() {
  // 畫布像素 = 視窗大小 × 裝置像素比（最多 2）× 渲染解析度比例（設定與畫質檔位）；CSS 大小不變，所以只影響清晰度與效能
  G.DPR = Math.min(devicePixelRatio || 1, 2) * profile.scale;
  G.W = innerWidth;
  G.H = innerHeight;
  cv.width = Math.max(1, Math.round(G.W * G.DPR));
  cv.height = Math.max(1, Math.round(G.H * G.DPR));
  G.S = Math.max(0.6, Math.min(1.6, Math.min(G.W, G.H) / 600));
  G.HU = Math.max(0.75, Math.min(1.7, Math.min(G.W, G.H) / 465));
  G.CZ = 24 * G.HU;
  document.documentElement.style.setProperty("--u", G.HU.toFixed(3));
  G.safeT = $("sa").offsetHeight;
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {
$ = (id) => document.getElementById(id);
cv = $("g");
cx = cv.getContext("2d");
N = 44;
T = 40;
MW = N * T;
TAU = Math.PI * 2;

G.HU = 1;
G.safeT = 0;

addEventListener("resize", resize);
}

