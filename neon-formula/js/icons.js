import { EL_COL } from "./enemy-config.js";
import { iconShapeOf } from "./config/index.js";

const TAU = Math.PI * 2;

const P = (c, p) => {
  c.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]);
  c.closePath();
};

function icon(c, t, x, y, s, col) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.strokeStyle = col;
  c.fillStyle = col + "33";
  c.lineJoin = c.lineCap = "round";
  c.lineWidth = 2.2 / s;
  c.beginPath();
  switch (t) {
    case "heal":
      P(c, [
        [-0.28, -0.85],
        [0.28, -0.85],
        [0.28, -0.28],
        [0.85, -0.28],
        [0.85, 0.28],
        [0.28, 0.28],
        [0.28, 0.85],
        [-0.28, 0.85],
        [-0.28, 0.28],
        [-0.85, 0.28],
        [-0.85, -0.28],
        [-0.28, -0.28],
      ]);
      break;
    case "hp":
      c.moveTo(0, 0.85);
      c.bezierCurveTo(-1.3, -0.1, -0.6, -1, 0, -0.4);
      c.bezierCurveTo(0.6, -1, 1.3, -0.1, 0, 0.85);
      break;
    case "ammo":
      c.moveTo(-0.35, 0.85);
      c.lineTo(-0.35, -0.15);
      c.quadraticCurveTo(-0.35, -0.8, 0, -0.95);
      c.quadraticCurveTo(0.35, -0.8, 0.35, -0.15);
      c.lineTo(0.35, 0.85);
      c.closePath();
      c.moveTo(-0.35, 0.4);
      c.lineTo(0.35, 0.4);
      break;
    case "shield":
      c.moveTo(0, -0.95);
      c.lineTo(0.8, -0.55);
      c.lineTo(0.8, 0.1);
      c.quadraticCurveTo(0.8, 0.65, 0, 0.95);
      c.quadraticCurveTo(-0.8, 0.65, -0.8, 0.1);
      c.lineTo(-0.8, -0.55);
      c.closePath();
      break;
    case "speed":
      P(c, [
        [0.2, -0.95],
        [-0.55, 0.15],
        [-0.05, 0.15],
        [-0.2, 0.95],
        [0.55, -0.2],
        [0.05, -0.2],
      ]);
      break;
    case "ult":
      for (let i = 0; i < 16; i++) {
        const r = i % 2 ? 0.4 : 0.95,
          a = (i / 16) * TAU - 1.57;
        c[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      break;
    case "dash":
      c.moveTo(-0.7, -0.6);
      c.lineTo(0, 0);
      c.lineTo(-0.7, 0.6);
      c.moveTo(0, -0.6);
      c.lineTo(0.7, 0);
      c.lineTo(0, 0.6);
      break;
    case "e0":
      P(c, [
        [0.9, 0],
        [-0.7, -0.8],
        [-0.7, 0.8],
      ]);
      break;
    case "e1":
      P(c, [
        [1, 0],
        [0, -0.7],
        [-1, 0],
        [0, 0.7],
      ]);
      break;
    case "e2":
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        c[i ? "lineTo" : "moveTo"](Math.cos(a), Math.sin(a));
      }
      c.closePath();
      break;
    case "pb":
      c.moveTo(-0.95, 0);
      c.lineTo(0.3, 0);
      c.moveTo(0.8, 0);
      c.arc(0.5, 0, 0.3, 0, TAU);
      break;
    case "slow":
      P(c, [
        [-0.7, -0.85],
        [0.7, -0.85],
        [0, 0],
      ]);
      P(c, [
        [0, 0],
        [0.7, 0.85],
        [-0.7, 0.85],
      ]);
      break;
    case "pull":
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        c.moveTo(Math.cos(a) * 0.95, Math.sin(a) * 0.95);
        c.lineTo(
          Math.cos(a) * 0.35 + Math.cos(a + 1.57) * 0.3,
          Math.sin(a) * 0.35 + Math.sin(a + 1.57) * 0.3,
        );
        c.lineTo(
          Math.cos(a) * 0.35 + Math.cos(a - 1.57) * 0.3,
          Math.sin(a) * 0.35 + Math.sin(a - 1.57) * 0.3,
        );
        c.closePath();
      }
      break;
    case "chip":
      P(c, [
        [-0.75, -0.75],
        [0.75, -0.75],
        [0.75, 0.75],
        [-0.75, 0.75],
      ]);
      c.moveTo(-0.3, -0.3);
      c.lineTo(0.3, -0.3);
      c.lineTo(0.3, 0.3);
      c.lineTo(-0.3, 0.3);
      c.closePath();
      c.moveTo(-1, -0.3);
      c.lineTo(-0.75, -0.3);
      c.moveTo(-1, 0.3);
      c.lineTo(-0.75, 0.3);
      c.moveTo(1, -0.3);
      c.lineTo(0.75, -0.3);
      c.moveTo(1, 0.3);
      c.lineTo(0.75, 0.3);
      break;
    case "shard":
      P(c, [
        [0, -0.95],
        [0.85, 0.65],
        [-0.85, 0.65],
      ]);
      c.moveTo(0, -0.2);
      c.lineTo(0, 0.35);
      break;
    case "core":
      P(c, [
        [0, -1],
        [0.7, 0],
        [0, 1],
        [-0.7, 0],
      ]);
      c.moveTo(0, -0.45);
      c.lineTo(0.3, 0);
      c.lineTo(0, 0.45);
      c.lineTo(-0.3, 0);
      c.closePath();
      break;
    case "coin":
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + TAU / 12;
        c[i ? "lineTo" : "moveTo"](Math.cos(a) * 0.9, Math.sin(a) * 0.9);
      }
      c.closePath();
      c.moveTo(0, -0.4);
      c.lineTo(0.35, 0);
      c.lineTo(0, 0.4);
      c.lineTo(-0.35, 0);
      c.closePath();
      break;
    case "e8":
      P(c, [
        [1, 0],
        [-0.8, -0.9],
        [-0.3, 0],
        [-0.8, 0.9],
      ]);
      break;
    case "eb":
      c.arc(0, 0, 0.75, 0, TAU);
      break;
    default:
      if (iconShapeOf(Number(t.slice(1)))) {
        const { sides: n, innerRatio: r2 } = iconShapeOf(Number(t.slice(1))),
          o = n === 4 ? TAU / 8 : 0;
        for (let i = 0; i < n; i++) {
          const r = r2 < 1 && i % 2 ? r2 : 1,
            a = (i / n) * TAU + o;
          c[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
        }
        c.closePath();
      }
  }
  if (icon.eo) {
    c.rect(-1e3, -1e3, 2e3, 2e3);
    c.clip("evenodd");
    c.strokeStyle = EL_COL;
    c.lineWidth = icon.eo / s;
    c.stroke();
    c.restore();
    return;
  }
  if (t !== "dash" && t !== "pb") c.fill();
  c.stroke();
  if (t === "eb") {
    c.beginPath();
    c.arc(0, 0, 0.2, 0, TAU);
    c.fillStyle = "#ffffff";
    c.fill();
  }
  c.restore();
}

function mkIcon(t, col, sz) {
  const k = document.createElement("canvas");
  k.width = k.height = sz * 2;
  k.style.cssText = `width:${sz}px;height:${sz}px`;
  const c = k.getContext("2d");
  c.shadowColor = col;
  c.shadowBlur = 6;
  icon(c, t, sz, sz, sz * 0.78, col);
  return k;
}

function eIcon(c, t, x, y, s, col) {
  icon(c, t, x, y, s, col);
  c.save();
  c.shadowColor = EL_COL;
  c.shadowBlur = s * 0.5;
  icon.eo = 7;
  icon(c, t, x, y, s, col);
  icon.eo = 0;
  c.restore();
}

function mkEIcon(t, col, sz) {
  const k = document.createElement("canvas");
  k.width = k.height = sz * 2;
  k.style.cssText = `width:${sz}px;height:${sz}px`;
  const c = k.getContext("2d");
  c.shadowColor = col;
  c.shadowBlur = 6;
  eIcon(c, t, sz, sz, sz * 0.66, col);
  return k;
}

export { eIcon, icon, mkEIcon, mkIcon };