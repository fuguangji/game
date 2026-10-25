/** 塵流懸液：控場系術式。術式場「塵流懸圖」有 9 層同心圓，可以分層旋轉、單獨爆破。 */
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { aoe, bulletsIn, domain, enemiesIn, hitEnemy, registerTechnique, ring, strokeRing } from "../game/techniques.js";
import { mv } from "../game/world-helpers.js";

const RING_W = 40; // 每一層的寬度（像素）
const SPIN = 2.2; // 旋轉角速度（弧度／秒）

registerTechnique({
  weapon: "塵流懸液",
  color: "#c9b8a0",
  skills: [
    {
      name: "簡筆", cost: 12, cd: 2.5,
      desc: "擊退範圍內的所有實體",
      cast({ p }) { aoe(p.x, p.y, 170, 15, { kb: 1300 }); ring(p.x, p.y, 170, "#c9b8a0", 0.35); },
    },
    {
      name: "裂解", cost: 25, cd: 10,
      desc: "範圍內敵人的能量被快速消耗（6 秒持續失去生命，Boss 只受 1/4），流失的能量會補給你",
      cast({ p }) { aoe(p.x, p.y, 250, 0, { fx: [["drain", { duration: 6 }]] }); ring(p.x, p.y, 250, "#4de1ff", 0.5); },
    },
  ],
  domains: [
    {
      name: "塵流懸圖", color: "#c9b8a0",
      desc: "18 秒：以自己為中心繪出 9 個同心圓。數字鍵 1~9 切換該層旋轉（順→逆→停），層內的敵人與敵方子彈隨之轉動；Shift+數字（手機：先點「爆破」再點數字）單獨引爆該層，爆破後仍可操控。期間無法使用其他術式",
      cast({ p }) {
        const speeds = Array(9).fill(0), flash = Array(9).fill(0);
        let blast = false;
        const press = (n, shift) => {
          const i = n - 1;
          if (i < 0 || i > 8) return false;
          if (blast || shift) { // 爆破這一層
            const f = G.dom;
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              const d = Math.hypot(e.x - f.x, e.y - f.y);
              if (d >= i * RING_W - e.r && d < (i + 1) * RING_W + e.r) hitEnemy(e, 70, { from: f, kb: 500 });
            }
            flash[i] = 0.4;
          } else speeds[i] = speeds[i] === 0 ? SPIN : speeds[i] > 0 ? -SPIN : 0; // 停 → 順時針 → 逆時針 → 停
          return true;
        };
        domain({
          x: p.x, y: p.y, r: 9 * RING_W, t: 18, color: "#c9b8a0", lockSkills: true,
          onDigit: press,
          ringUi: () => ({ speeds, blast, tap: (n) => press(n, false), toggleBlast: () => { blast = !blast; } }),
          update(dt, f) {
            for (let i = 0; i < 9; i++) flash[i] = Math.max(0, flash[i] - dt);
            const spin = (obj, w) => { // 繞圓心旋轉 w*dt 弧度
              const dx = obj.x - f.x, dy = obj.y - f.y, a = Math.atan2(dy, dx) + w * dt, d = Math.hypot(dx, dy);
              return [f.x + Math.cos(a) * d - obj.x, f.y + Math.sin(a) * d - obj.y];
            };
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              const band = Math.min(8, Math.floor(Math.hypot(e.x - f.x, e.y - f.y) / RING_W)), w = speeds[band];
              if (w) mv(e, ...spin(e, w));
            }
            for (const b of bulletsIn(f.x, f.y, f.r)) {
              const w = speeds[Math.min(8, Math.floor(Math.hypot(b.x - f.x, b.y - f.y) / RING_W))];
              if (!w) continue;
              const [mx, my] = spin(b, w), c = Math.cos(w * dt), s = Math.sin(w * dt);
              b.x += mx; b.y += my;
              [b.vx, b.vy] = [b.vx * c - b.vy * s, b.vx * s + b.vy * c];
            }
          },
          draw(cx, f) {
            for (let i = 0; i < 9; i++) {
              const w = speeds[i];
              strokeRing(cx, f.x, f.y, (i + 1) * RING_W, flash[i] > 0 ? "#ffffff" : w > 0 ? "#8fe3cf" : w < 0 ? "#d9c98a" : f.color, {
                alpha: flash[i] > 0 ? 0.9 : 0.45, width: flash[i] > 0 ? 6 : 2, dash: w ? [10, 8] : null, offset: -G.time * 40 * Math.sign(w || 1),
              });
            }
            cx.save();
            cx.fillStyle = "#ffffff";
            cx.globalAlpha = 0.8;
            for (let i = 0; i < 9; i++) if (speeds[i]) {
              const a = G.time * speeds[i] + i, rr = (i + 0.5) * RING_W;
              cx.beginPath();
              cx.arc(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, 3, 0, TAU);
              cx.fill();
            }
            cx.restore();
          },
        });
      },
    },
  ],
});
