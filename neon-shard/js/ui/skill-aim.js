/**
 * ui/skill-aim — 手機「選定技能後瞄準」的畫面提示
 *
 *   世界座標（drawSkillAim）：選定技能後角色周圍出現脈動的虛線圈（「已備妥」）；
 *     拖曳瞄準搖桿時畫出落點預覽（方向線 + 目標圈），拖回死區內則顯示「放開取消」。
 *   螢幕座標（drawSkillStickHint）：搖桿用技能代表色，並在搖桿下方顯示現在放開會發生什麼。
 * 只讀取狀態，不改任何遊戲資料。
 */
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { TAU, cx } from "../core/viewport.js";
import { ta } from "../game/battle.js";
import { selectedSkillInfo } from "../game/techniques.js";

const FONT = 'system-ui,"Noto Sans TC",sans-serif';
const READY_RED = "#ff5a6a";

/** 瞄準搖桿狀態：armed = 有選定技能；aiming = 手指在搖桿上；live = 已推出死區（放開會施放） */
function stickState() {
  const info = selectedSkillInfo();
  if (!info) return null;
  const aiming = ta.id !== null && ta.act;
  const dq = aiming ? Math.hypot(ta.x - ta.sx, ta.y - ta.sy) : 0;
  return { info, aiming, live: aiming && dq > G.CZ, dq };
}

/** 世界座標：落點預覽 */
export function drawSkillAim() {
  if (fsm.state !== "play" || !G.pl) return;
  const st = stickState();
  if (!st) return;
  const p = G.pl, { info } = st;
  const col = info.ready ? info.color : READY_RED;
  const pulse = 0.5 + 0.5 * Math.sin(G.time * 6);
  cx.save();
  cx.lineCap = "round";
  // 已備妥：角色周圍的脈動虛線圈（讓人一眼看出現在是「技能模式」）
  cx.globalAlpha = 0.35 + 0.3 * pulse;
  cx.strokeStyle = col;
  cx.lineWidth = 2;
  cx.setLineDash([6, 6]);
  cx.beginPath();
  cx.arc(p.x, p.y, p.r + 10 + pulse * 3, 0, TAU);
  cx.stroke();
  cx.setLineDash([]);
  if (st.aiming && st.live) {
    const q = Math.max(0, Math.min(1, (st.dq - G.CZ) / (90 * G.HU - G.CZ)));
    const reach = 60 + 280 * q;
    const ca = Math.cos(p.aim), sa = Math.sin(p.aim);
    const sx = p.x + ca * (p.r + 6), sy = p.y + sa * (p.r + 6);
    const ex = p.x + ca * reach, ey = p.y + sa * reach;
    cx.globalAlpha = 0.85;
    cx.strokeStyle = col;
    cx.fillStyle = col;
    cx.lineWidth = 3;
    cx.setLineDash([10, 7]);
    cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(ex, ey); cx.stroke();
    cx.setLineDash([]);
    cx.globalAlpha = 0.28 + 0.15 * pulse;
    cx.beginPath(); cx.arc(ex, ey, 24, 0, TAU); cx.fill();
    cx.globalAlpha = 0.95;
    cx.lineWidth = 2.5;
    cx.beginPath(); cx.arc(ex, ey, 24, 0, TAU); cx.stroke();
    cx.beginPath(); cx.moveTo(ex - 9, ey); cx.lineTo(ex + 9, ey); cx.moveTo(ex, ey - 9); cx.lineTo(ex, ey + 9); cx.stroke();
    cx.globalAlpha = 1;
    cx.font = `bold ${13 / G.S}px ${FONT}`;
    cx.textAlign = "center";
    cx.textBaseline = "bottom";
    cx.shadowColor = "#000";
    cx.shadowBlur = 4;
    cx.fillText(info.ready ? info.name : `${info.name}（尚未就緒）`, ex, ey - 30);
  } else if (st.aiming) {
    cx.globalAlpha = 0.9;
    cx.fillStyle = "#c8cfdc";
    cx.font = `bold ${12 / G.S}px ${FONT}`;
    cx.textAlign = "center";
    cx.textBaseline = "bottom";
    cx.shadowColor = "#000";
    cx.shadowBlur = 4;
    cx.fillText("在中心放開＝取消", p.x, p.y - p.r - 18);
  }
  cx.restore();
}

/**
 * 螢幕座標：回傳瞄準搖桿該用的顏色與提示字（沒有選定技能時回傳 null，搖桿維持原本的粉紅色）。
 * 由 render.js 的觸控搖桿繪製呼叫。
 */
export function skillStick() {
  if (fsm.state !== "play") return null;
  const st = stickState();
  if (!st) return null;
  const color = st.info.ready ? st.info.color : READY_RED;
  const label = !st.aiming ? `${st.info.name}：拖曳瞄準，放開施放` : st.live ? "放開施放" : "放開取消";
  return { color, label, live: st.live };
}
