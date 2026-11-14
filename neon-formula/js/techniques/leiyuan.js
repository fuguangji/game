/**
 * 霆淵弓：雷電系術式。
 *   引雷  — 標記後延遲落雷（範圍重擊＋麻痺）
 *   鏈閃  — 連鎖閃電，逐段衰減
 *   磁暴  — 把敵人往中心吸的持續範圍場
 *   雷遁  — 沿瞄準方向瞬移並電擊路徑
 *   過載  — 8 秒傷害與移動速度提高（代價：反噬）
 *   術式場「雷獄」— 範圍內持續隨機落雷
 */
import { isBossType } from "../config/index.js";
import { G } from "../core/game-state.js";
import { applyEnemyFx } from "../game/enemy-effects.js";
import { applyStatus } from "../game/status-effects.js";
import { addFx, aoe, beam, bulletsIn, domain, enemiesIn, field, hitEnemy, moveAlong, nearestEnemy, registerTechnique, ring, strokeRing } from "../game/techniques.js";
import { burst, mv } from "../game/world-helpers.js";

const COL = "#ffe14a";
const WHITE = "#fff7c2";

/** 把瞄準點限制在離玩家 maxD 以內 */
const clampAim = ({ p, x, y }, maxD) => {
  const a = Math.atan2(y - p.y, x - p.x), d = Math.min(Math.hypot(x - p.x, y - p.y), maxD);
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
};

/** 兩點之間的閃電折線（建立時算好，繪製時不必每幀重算） */
function boltPath(x0, y0, x1, y1, jag = 14) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1, n = Math.max(2, Math.round(len / 28));
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len, pts = [[x0, y0]];
  for (let i = 1; i < n; i++) {
    const k = i / n, o = (Math.random() - 0.5) * 2 * jag;
    pts.push([x0 + (x1 - x0) * k + nx * o, y0 + (y1 - y0) * k + ny * o]);
  }
  pts.push([x1, y1]);
  return pts;
}

function drawBolt(cx, pts, alpha, width = 3) {
  cx.save();
  cx.globalAlpha = Math.max(0, Math.min(1, alpha));
  cx.strokeStyle = WHITE;
  cx.lineWidth = width;
  cx.lineJoin = "round";
  cx.shadowColor = COL;
  cx.shadowBlur = 12;
  cx.beginPath();
  pts.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y)));
  cx.stroke();
  cx.restore();
}

/** 一道短暫的閃電特效（淡出後自己消失） */
const flashBolt = (x0, y0, x1, y1, { t = 0.22, width = 4, jag = 18 } = {}) => {
  const pts = boltPath(x0, y0, x1, y1, jag);
  addFx({ t, draw(cx, f) { drawBolt(cx, pts, f.t / f.max, width); } });
};

const shock = (e, sec) => applyEnemyFx(e, "shock", { duration: sec });

registerTechnique({
  weapon: "霆淵弓",
  color: COL,
  skills: [
    {
      name: "引雷", cost: 20, cd: 5, backlash: 0.02,
      desc: "標記瞄準處（最遠 520 像素），0.7 秒後落雷：範圍內敵人受到重擊並麻痺 1.5 秒（Boss 減半），同時擊碎附近的牆",
      cast(ctx) {
        const { x, y } = clampAim(ctx, 520), R = 150;
        addFx({
          t: 0.7,
          draw(cx, f) {
            const k = 1 - f.t / f.max;
            strokeRing(cx, x, y, R, COL, { alpha: 0.3 + 0.4 * k, width: 2, dash: [6, 6], offset: -G.time * 30 });
            strokeRing(cx, x, y, R * k, WHITE, { alpha: 0.6, width: 3 });
          },
          end() {
            for (const e of aoe(x, y, R, 95, { tag: "thunder", kb: 320, walls: 2 })) shock(e, 1.5);
            ring(x, y, R, WHITE, 0.45);
            burst(x, y, COL, 50, 420, 4, 0.7);
            flashBolt(x + (Math.random() - 0.5) * 60, y - 700, x, y, { t: 0.3, width: 7, jag: 26 });
            G.shake = Math.max(G.shake, 14);
          },
        });
      },
    },
    {
      name: "鏈閃", cost: 25, cd: 8, backlash: 0.03,
      desc: "從瞄準點附近的敵人開始連鎖閃電，最多跳 6 次（每次最遠 280 像素），傷害逐段衰減 18%，每個目標短暫麻痺",
      cast(ctx) {
        const { p } = ctx, hit = new Set();
        let from = { x: p.x, y: p.y }, dmg = 75;
        let target = nearestEnemy(ctx.x, ctx.y, 420) ?? nearestEnemy(p.x, p.y, 520);
        for (let i = 0; i < 6 && target; i++) {
          hit.add(target);
          flashBolt(from.x, from.y, target.x, target.y, { t: 0.25 + i * 0.03 });
          hitEnemy(target, dmg, { tag: "thunder", from, kb: 80 });
          shock(target, 0.8);
          burst(target.x, target.y, COL, 10, 220, 2.5, 0.3);
          from = { x: target.x, y: target.y };
          dmg *= 0.82;
          target = nearestEnemy(from.x, from.y, 280, (e) => !hit.has(e));
        }
      },
    },
    {
      name: "磁暴", cost: 30, cd: 12, backlash: 0.04,
      desc: "在瞄準處（最遠 420 像素）張開 4.5 秒的磁場：場內敵人被持續拉向中心（Boss 只受 1/3 拉力）並受傷，敵方子彈會被電散",
      cast(ctx) {
        const { x, y } = clampAim(ctx, 420);
        field({
          x, y, r: 210, t: 4.5, col: COL, every: 0.35, dmg: 20, tag: "thunder",
          each(dt, f) {
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              const dx = f.x - e.x, dy = f.y - e.y, d = Math.hypot(dx, dy);
              if (d < 30) continue;
              const v = (isBossType(e.t) ? 60 : 190) * dt;
              mv(e, (dx / d) * v, (dy / d) * v);
            }
            for (const b of bulletsIn(f.x, f.y, f.r)) if (Math.random() < dt * 2.5) b.life = 0;
          },
          tick(f) { ring(f.x, f.y, f.r * 0.45, COL, 0.3); },
        });
        ring(x, y, 210, COL, 0.5);
      },
    },
    {
      name: "雷遁", cost: 15, cd: 7,
      desc: "朝瞄準方向瞬移最多 280 像素（被牆擋住就停下），電擊路徑上的敵人並麻痺 1 秒，之後加速 1.2 秒",
      cast({ p, aim }) {
        const x0 = p.x, y0 = p.y, moved = moveAlong(p, aim, 280);
        if (moved <= 0) return;
        beam(x0, y0, aim, moved, 44, 60, { tag: "thunder", col: WHITE, fx: [["shock", { duration: 1 }]] });
        flashBolt(x0, y0, p.x, p.y, { t: 0.3, width: 5, jag: 10 });
        applyStatus(p, "fast", { duration: 1.2 });
        burst(x0, y0, COL, 18, 260, 3, 0.4);
        burst(p.x, p.y, COL, 18, 260, 3, 0.4);
      },
    },
    {
      name: "過載", cost: 40, cd: 30, backlash: 0.06,
      desc: "8 秒內造成的傷害 ×1.35、移動速度 ×1.2。代價：施放時的術式反噬（6% 最大生命）",
      cast({ p }) {
        applyStatus(p, "overload", { duration: 8 });
        ring(p.x, p.y, 120, COL, 0.5);
        burst(p.x, p.y, WHITE, 30, 320, 3, 0.6);
      },
    },
  ],
  domains: [
    {
      name: "雷獄", color: COL, energyFrac: 0.2,
      desc: "9 秒：以自己為中心的大範圍雷獄，每 0.35 秒隨機劈中場內 2 個敵人（傷害並麻痺 0.7 秒）。消耗 20% 能量",
      cast({ p }) {
        const bolts = [];
        let acc = 0;
        domain({
          x: p.x, y: p.y, r: 400, t: 9, color: COL,
          update(dt, f) {
            for (let i = bolts.length - 1; i >= 0; i--) { bolts[i].t -= dt; if (bolts[i].t <= 0) bolts.splice(i, 1); }
            acc += dt;
            if (acc < 0.35) return;
            acc -= 0.35;
            const list = enemiesIn(f.x, f.y, f.r);
            for (let k = 0; k < 2 && list.length; k++) {
              const e = list.splice((Math.random() * list.length) | 0, 1)[0];
              hitEnemy(e, 55, { from: f, ult: 0.03, tag: "thunder" });
              shock(e, 0.7);
              bolts.push({ t: 0.2, pts: boltPath(e.x + (Math.random() - 0.5) * 80, e.y - 500, e.x, e.y, 22) });
              burst(e.x, e.y, COL, 8, 200, 2.5, 0.3);
            }
          },
          draw(cx) { for (const b of bolts) drawBolt(cx, b.pts, b.t / 0.2, 4); },
        });
      },
    },
  ],
});
