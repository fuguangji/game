/** 驥隱流楓：位移、映射與隱匿。 */
import { BULLET_SPEED_SCALE } from "../config/index.js";
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { ub } from "../game/battle.js";
import { angD } from "../game/physics.js";
import { applyStatus, backlashMultiplier } from "../game/status-effects.js";
import { addFx, bulletsIn, domain, enemiesIn, hitEnemy, nearestEnemy, registerTechnique, ring, selfBacklash } from "../game/techniques.js";
import { burst } from "../game/world-helpers.js";

registerTechnique({
  weapon: "驥隱流楓",
  color: "#e08a4a",
  skills: [
    {
      name: "紊流隱舞曲", cost: 8, cd: 0.35,
      desc: "施術方向（前方扇形）的敵人瞬間順時針離心運動並受傷，敵方子彈也被甩向外側；可不間斷連續觸發，只是暫時覆蓋，不會保護你",
      cast({ p }) {
        const R = 300, ARC = 2.1;
        for (const e of enemiesIn(p.x, p.y, R)) {
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1, ox = dx / d, oy = dy / d;
          if (angD(Math.atan2(dy, dx), p.aim) > ARC / 2) continue;
          e.kx += ((-oy * 0.9 + ox * 0.6) * 900) / e.m; // 順時針切線 + 向外
          e.ky += ((ox * 0.9 + oy * 0.6) * 900) / e.m;
          hitEnemy(e, 25, { ult: 0.08, from: p });
        }
        for (const b of bulletsIn(p.x, p.y, R)) {
          if (angD(Math.atan2(b.y - p.y, b.x - p.x), p.aim) > ARC / 2) continue;
          const c = Math.cos(0.9), s = Math.sin(0.9);
          [b.vx, b.vy] = [b.vx * c - b.vy * s, b.vx * s + b.vy * c];
        }
        ring(p.x, p.y, R * 0.8, "#e08a4a", 0.3);
        burst(p.x + Math.cos(p.aim) * 90, p.y + Math.sin(p.aim) * 90, "#ff8a3d", 10, 220, 3, 0.5);
      },
    },
    {
      name: "鏡川殘卷", cost: 30, cd: 150, backlash: 0.25,
      desc: "短暫映射他人術式（弱化）：把周圍 420 像素內的敵方子彈全部映射成你的子彈（威力減半）射向敵人。代價：2 分鐘術式熔斷與極高術式反噬（25% 最大生命）",
      cast({ p }) {
        const target = nearestEnemy(p.x, p.y);
        for (const b of bulletsIn(p.x, p.y, 420)) {
          const a = target ? Math.atan2(target.y - p.y, target.x - p.x) : Math.atan2(-b.vy, -b.vx);
          ub(a, Math.max(400, Math.min(900, Math.hypot(b.vx, b.vy))), { dmg: b.dmg * 0.5, r: 5, life: 1.2 / BULLET_SPEED_SCALE, col: "#e08a4a" });
          b.life = 0;
        }
        applyStatus(p, "seal", { duration: 120 });
        ring(p.x, p.y, 420, "#e08a4a", 0.6);
      },
    },
    {
      name: "鳶尾天平非穩態", cost: 20, cd: 10,
      desc: "指定一個敵人：傷害與你「剩餘能量」的平方成反比（能量越少越痛，最高 9 倍）；此術式的術式反噬映射給對方，而 30% 的傷害會反射回你（不致死）。沒有目標時反噬由自己承受",
      cast({ p, target }) {
        const t = target ?? nearestEnemy(p.x, p.y, 800, (e) => angD(Math.atan2(e.y - p.y, e.x - p.x), p.aim) < 0.5);
        if (!t) { selfBacklash(0.08); return; }
        const f = Math.max(0.33, p.en / p.enMax), dmg = 60 / (f * f);
        G.fxs.push({ k: "l", x: p.x, y: p.y, a: Math.atan2(t.y - p.y, t.x - p.x), len: Math.hypot(t.x - p.x, t.y - p.y), t: 0.3, max: 0.3, col: "#e08a4a" });
        hitEnemy(t, dmg, { kb: 300 });
        hitEnemy(t, 0.08 * p.mhp * backlashMultiplier(p), { ult: 0 }); // 反噬映射到被施術者
        p.hp = Math.max(1, p.hp - dmg * 0.3); // 30% 反射回施術者
      },
    },
    {
      name: "瑟颯峽村", cost: 15, cd: 20,
      desc: "次術式場：8 秒隱身（敵人看不見你，只會亂走），並在身後留下少量橘紅落葉；代價是期間術式熔斷",
      cast({ p }) {
        applyStatus(p, "stealth", { duration: 8 });
        applyStatus(p, "seal", { duration: 8 });
        addFx({ t: 8, update(dt) { if (Math.random() < dt * 3) burst(G.pl.x, G.pl.y, "#ff8a3d", 1, 60, 3, 0.9); } });
      },
    },
  ],
  domains: [
    {
      name: "霜雪風域", color: "#dff3ff",
      desc: "8 秒：進入者仍能用術式卻發動不了（敵人受到與造成的傷害幾乎無效，攻擊力 -99.99%），術式反噬照常；場內敵人完全看不見你的位置；你可在場內自由移動，但不得離開",
      cast({ p }) {
        domain({
          x: p.x, y: p.y, r: 360, t: 8, color: "#dff3ff", blind: true, confine: true,
          update() { applyStatus(G.pl, "domainGuard", { duration: 0.25 }); },
          draw(cx, f) {
            cx.save();
            cx.translate(f.x, f.y);
            cx.strokeStyle = "#ffffff";
            cx.globalAlpha = 0.3;
            for (let k = 0; k < 5; k++) {
              cx.beginPath();
              for (let a = 0; a < 3.2; a += 0.1) {
                const rr = f.r * 0.15 * (1 + a) + k * 6, aa = a + (k * TAU) / 5 + G.time * 0.6;
                cx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
              }
              cx.stroke();
            }
            cx.restore();
          },
        });
      },
    },
  ],
});
