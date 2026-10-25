/** 青羽鎩：熱量系近戰術式。熱量（p.heat）用衰變與托克馬克累積，用轉能、中子射線流消耗。 */
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { angD } from "../game/physics.js";
import { applyStatus, isBlocked } from "../game/status-effects.js";
import { addFx, aoe, beam, bulletsIn, domain, enemiesIn, field, hitEnemy, moveAlong, nearestEnemy, registerTechnique, ring, strokeRing } from "../game/techniques.js";
import { burst, mv } from "../game/world-helpers.js";

/** 把瞄準點限制在離玩家 maxD 以內 */
const clampAim = ({ p, x, y }, maxD) => {
  const a = Math.atan2(y - p.y, x - p.x), d = Math.min(Math.hypot(x - p.x, y - p.y), maxD);
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
};

registerTechnique({
  weapon: "青羽鎩",
  color: "#7fe0d0",
  meter: { name: "熱量", color: "#ff7a3d", value: (p) => p.heat },
  skills: [
    {
      name: "琉璃焰", cost: 30, cd: 6, backlash: 0.04,
      desc: "擊碎空間，瞄準處大範圍高溫攻擊，並留下燃燒的地面（熱量越高越痛）",
      cast(ctx) {
        const { p } = ctx, { x, y } = clampAim(ctx, 320);
        ring(x, y, 170, "#ff9a4d", 0.5);
        burst(x, y, "#ff7a1a", 60, 420, 5, 0.8);
        aoe(x, y, 170, 70 + p.heat * 0.6, { kb: 700, burn: 4, walls: 2 });
        field({ x, y, r: 130, t: 3, col: "#ff7a3d", every: 0.3, dmg: 9, burn: 2 });
        p.heat = Math.min(100, p.heat + 15);
        G.shake = Math.max(G.shake, 12);
      },
    },
    {
      name: "衰變", cost: 15, cd: 12,
      desc: "劍身迅速升溫（8 秒）：熱量快速上升，攻擊力隨熱量提高，是轉能與托克馬克的前置",
      cast({ p }) {
        applyStatus(p, "heated", { duration: 8 });
        p.heat = Math.min(100, p.heat + 20);
        ring(p.x, p.y, 70, "#ff7a3d", 0.4);
      },
    },
    {
      name: "托克馬克", cost: 40, cd: 14, backlash: 0.06,
      desc: "蓄能最多 6 秒：熱量前慢後快地指數上升，再按一次（或滿 6 秒）釋放，爆炸大小與威力隨熱量暴增。蓄能時移動變慢",
      cast({ p }) {
        const DUR = 6, K = 3.2;
        let el = 0;
        const blast = () => {
          const h = p.heat, r = 110 + 3.4 * h;
          aoe(p.x, p.y, r, 30 + 650 * (h / 100) ** 2, { kb: 1400, burn: 3, walls: 6 });
          ring(p.x, p.y, r, "#ffffff", 0.7);
          ring(p.x, p.y, r * 0.7, "#ff9a4d", 0.5);
          burst(p.x, p.y, "#ff7a1a", 40 + h, 480, 6, 1);
          G.shake = Math.max(G.shake, 6 + h * 0.18);
          p.heat = 0;
        };
        addFx({
          skill: "托克馬克", t: DUR,
          update(dt, f) {
            el += dt;
            p.heat = (100 * Math.expm1(K * el)) / Math.expm1(K * DUR);
            applyStatus(p, "slow", { duration: 0.2 });
            if (isBlocked(p, "skill")) f.release(f);
          },
          draw(cx) {
            const h = p.heat / 100;
            strokeRing(cx, p.x, p.y, 20 + 90 * h, "#ff7a3d", { alpha: 0.4 + 0.4 * h, width: 2 + 4 * h });
          },
          release(f) { if (f.released) return; f.released = true; f.dead = true; blast(); },
          end(f) { if (!f.released) { f.released = true; blast(); } },
        });
      },
    },
    {
      name: "轉能", cost: 25, cd: 8, backlash: 0.05,
      desc: "把熱量全部轉成動能：朝最近的敵人（沒有就朝瞄準方向）瞬間衝刺，路徑上必中、無法閃避，威力隨熱量提高",
      cast({ p, aim }) {
        const h = p.heat;
        p.heat = 0;
        const t = nearestEnemy(p.x, p.y, 520, (e) => angD(Math.atan2(e.y - p.y, e.x - p.x), aim) < 0.6);
        const ang = t ? Math.atan2(t.y - p.y, t.x - p.x) : aim, L = 260 + 3 * h;
        p.aim = ang;
        beam(p.x, p.y, ang, L, 70, 40 + 3.2 * h, { kb: 1000, col: "#ffd27a" });
        applyStatus(p, "guard", { duration: 0.5 });
        moveAlong(p, ang, L);
        burst(p.x, p.y, "#ffd27a", 30, 300, 4, 0.5);
      },
    },
    {
      name: "中子射線流", cost: 45, cd: 12, backlash: 0.1,
      desc: "一發瞬間貫穿路徑上所有敵人與牆壁的射線；消耗 30 熱量，熱量越高越痛",
      cast({ p, aim }) {
        beam(p.x, p.y, aim, 1700, 26, 170 + p.heat * 1.5, { pierceWalls: true, walls: 6, kb: 1200, col: "#e8ffff" });
        p.heat = Math.max(0, p.heat - 30);
        G.shake = Math.max(G.shake, 14);
      },
    },
  ],
  domains: [
    {
      name: "電子軌域", color: "#7fe0d0",
      desc: "場內所有敵人被迫沿電子軌道高速繞行並持續切割，無法靠近中心；敵方子彈會被切碎",
      cast({ p }) {
        let acc = 0;
        domain({
          x: p.x, y: p.y, r: 300, t: 8, color: "#7fe0d0",
          update(dt, f) {
            acc += dt;
            const tick = acc >= 0.25;
            if (tick) acc -= 0.25;
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              const dx = e.x - f.x, dy = e.y - f.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
              mv(e, -uy * 220 * dt, ux * 220 * dt); // 繞行
              if (d < f.r * 0.6) mv(e, ux * 520 * dt, uy * 520 * dt); // 靠近中心就被推開
              if (tick) hitEnemy(e, 9, { from: f, ult: 0.05 });
            }
            for (const b of bulletsIn(f.x, f.y, f.r * 0.95)) b.life = 0;
          },
          draw(cx, f) {
            cx.save();
            cx.translate(f.x, f.y);
            for (let k = 0; k < 3; k++) {
              cx.save();
              cx.rotate((k * TAU) / 3 + G.time * 0.8);
              cx.strokeStyle = f.color;
              cx.globalAlpha = 0.5;
              cx.lineWidth = 2;
              cx.beginPath();
              cx.ellipse(0, 0, f.r * 0.92, f.r * 0.36, 0, 0, TAU);
              cx.stroke();
              const a = G.time * 3 + k * 2;
              cx.globalAlpha = 1;
              cx.fillStyle = "#ffffff";
              cx.beginPath();
              cx.arc(Math.cos(a) * f.r * 0.92, Math.sin(a) * f.r * 0.36, 5, 0, TAU);
              cx.fill();
              cx.restore();
            }
            cx.restore();
          },
        });
      },
    },
  ],
});
