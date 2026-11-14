/** 銘骨衍枝曲：毒與竹。中毒（敵人）可疊 3 層；竹式神是會自動開火的砲塔。 */
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { applyEnemyFx } from "../game/enemy-effects.js";
import { later } from "../game/ultimates.js";
import { applyStatus } from "../game/status-effects.js";
import { aoe, beam, domain, enemiesIn, registerTechnique, ring } from "../game/techniques.js";
import { WP } from "../game/weapons.js";
import { burst, turLand } from "../game/world-helpers.js";

const poison = (dur) => [["poison", { duration: dur, stack: true }]];

registerTechnique({
  weapon: "銘骨衍枝曲",
  color: "#8fd070",
  skills: [
    {
      name: "鐫刻", cost: 15, cd: 3,
      desc: "朝前方射出 5 道針芒，命中的敵人中毒（可疊 3 層，每層每秒 8 點傷害）",
      cast({ p, aim }) {
        for (const k of [-0.3, -0.15, 0, 0.15, 0.3]) beam(p.x, p.y, aim + k, 520, 14, 14, { col: "#8fd070", fx: poison(6) });
      },
    },
    {
      name: "竹綻", cost: 20, cd: 20, hpCost: 0.5,
      desc: "代價：50% 最大生命。範圍內所有敵人中毒（直接疊滿 3 層，10 秒），並召喚 2 個會自動開火的竹式神（20 秒）",
      cast({ p }) {
        const fx = [...poison(10), ...poison(10), ...poison(10)];
        aoe(p.x, p.y, 260, 20, { fx });
        ring(p.x, p.y, 260, "#8fd070", 0.5);
        const w = WP[G.pl.w];
        for (const side of [-1, 1]) {
          const [x, y] = turLand(p.x + Math.cos(p.aim + side * 1.4) * 55, p.y + Math.sin(p.aim + side * 1.4) * 55, 18);
          G.zones.push({ k: "tur", x, y, r: 14, t: 20, max: 20, hp: 40, mhp: 40, col: "#8fd070", w, cd: 0.4, ang: p.aim, rg: 250, fi: w.cd, dmul: 1 });
          burst(x, y, "#8fd070", 14, 160, 3, 0.5);
        }
      },
    },
    {
      name: "柳", cost: (ctx) => Math.round(10 + 0.06 * shotDistance(ctx)), cd: 2, backlash: 0.03,
      desc: "脈衝式射擊（3 連發）：瞄準點越遠，每發傷害越高，耗能也越多（約 120～900 像素）",
      cast(ctx) {
        const D = shotDistance(ctx), dmg = 8 + 0.12 * D;
        [0, 0.1, 0.2].forEach((t) => later(t, () => { const { p } = ctx; beam(p.x, p.y, p.aim, D + 40, 12, dmg, { col: "#cfe8a0" }); }));
      },
    },
    {
      name: "白楊", cost: 20, cd: 45,
      desc: "30 秒內無視術式反噬；期間最大生命值減少 15%，結束後還原",
      cast({ p }) { applyStatus(p, "ignoreBacklash", { duration: 30 }); ring(p.x, p.y, 80, "#b6ff9d", 0.5); },
    },
  ],
  domains: [
    {
      name: "百花齊放", color: "#ff9ad0",
      desc: "12 秒：場內敵人持續中毒（不含你）；場內所有人（含你）的術式反噬 +10%",
      cast({ p }) {
        domain({
          x: p.x, y: p.y, r: 340, t: 12, color: "#ff9ad0",
          update(dt, f) {
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              applyEnemyFx(e, "poison", { duration: 1.5, stacks: 2 });
              applyEnemyFx(e, "bloom", { duration: 0.25 });
            }
            if (Math.hypot(G.pl.x - f.x, G.pl.y - f.y) < f.r) applyStatus(G.pl, "bloom", { duration: 0.25 });
            if (Math.random() < dt * 14) {
              const a = Math.random() * TAU, d = Math.random() * f.r;
              burst(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, "#ff9ad0", 1, 40, 3, 0.9);
            }
          },
        });
      },
    },
  ],
});

/** 柳的射程：用瞄準點或目標的距離，限制在 120～900 之間 */
function shotDistance({ p, target, dist }) {
  const d = target ? Math.hypot(target.x - p.x, target.y - p.y) : dist || 400;
  return Math.max(120, Math.min(900, d));
}
