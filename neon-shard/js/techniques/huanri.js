/** 幻日虹：空間斬擊系術式，擅長大範圍壓制與術式熔斷／反噬。 */
import { isBossType } from "../config/index.js";
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { applyEnemyFx } from "../game/enemy-effects.js";
import { applyStatus } from "../game/status-effects.js";
import { METER, addFx, aoe, bulletsIn, cone, domain, enemiesIn, field, hitEnemy, registerTechnique, ring } from "../game/techniques.js";

const sealAll = (f, dur = 1.2) => { for (const e of enemiesIn(f.x, f.y, f.r)) applyEnemyFx(e, "seal", { duration: dur }); };

/** 畫一個扇形（world 座標） */
function sector(cx, x, y, ang, range, arc, col, alpha) {
  cx.save();
  cx.globalAlpha = alpha;
  cx.fillStyle = col;
  cx.beginPath();
  cx.moveTo(x, y);
  cx.arc(x, y, range, ang - arc / 2, ang + arc / 2);
  cx.closePath();
  cx.fill();
  cx.restore();
}

registerTechnique({
  weapon: "幻日虹",
  color: "#ffd98a",
  skills: [
    {
      name: "霓", cost: 25, cd: 7, backlash: 0.03,
      desc: "長時間（2.5 秒）的空間斬擊：朝著你的瞄準方向持續斬出扇形，並擊落敵方子彈",
      cast({ p }) {
        let acc = 0.1;
        addFx({
          t: 2.5,
          update(dt) {
            acc += dt;
            if (acc >= 0.1) { acc -= 0.1; cone(p.x, p.y, p.aim, 210, 1.3, 7, { kb: 120, cutBullets: true }); }
          },
          draw(cx, f) { sector(cx, p.x, p.y, p.aim, 210, 1.3, "#ffd98a", 0.22 * Math.min(1, f.t * 2)); },
        });
      },
    },
    {
      name: "溢射", cost: 30, cd: 9, backlash: 0.04,
      desc: "大範圍的衝擊，同時張開防護：獲得護盾並在 3 秒內受到的傷害減半",
      cast({ p }) {
        aoe(p.x, p.y, 230, 55, { kb: 800 });
        p.sh = Math.min(p.mhp, (p.sh || 0) + 35);
        applyStatus(p, "guard", { duration: 3 });
        ring(p.x, p.y, 230, "#ffd98a", 0.5);
      },
    },
    {
      name: "日全蝕", cost: 35, cd: 16, backlash: 0.06,
      desc: "次術式場（5 秒）：範圍內所有實體術式熔斷，包含你自己",
      cast({ p }) {
        field({
          x: p.x, y: p.y, r: 250, t: 5, col: "#ffd98a", every: 99,
          each(dt, f) {
            sealAll(f);
            if (Math.hypot(G.pl.x - f.x, G.pl.y - f.y) < f.r) applyStatus(G.pl, "seal", { duration: 1.2 });
          },
          draw(cx, f) {
            cx.save();
            cx.globalAlpha = 0.5;
            cx.fillStyle = "#000000";
            cx.beginPath();
            cx.arc(f.x, f.y, f.r * 0.45, 0, TAU);
            cx.fill();
            cx.restore();
          },
        });
      },
    },
    {
      name: "冕", cost: 20, cd: 4,
      desc: "瞬間的空間斬擊脈衝：前方扇形，擊退並擊落敵方子彈",
      cast({ p }) {
        cone(p.x, p.y, p.aim, 270, 1.75, 70, { kb: 900, cutBullets: true });
        addFx({ t: 0.18, draw(cx, f) { sector(cx, p.x, p.y, p.aim, 270, 1.75, "#fff2c0", 0.5 * (f.t / 0.18)); } });
      },
    },
    {
      name: "二極體", cost: 20, cd: 12,
      desc: "次術式場（6 秒，半徑 3 公尺，跟著你移動）：範圍內的敵人術式熔斷（不含你）",
      cast() {
        field({ follow: true, x: G.pl.x, y: G.pl.y, r: 3 * METER, t: 6, col: "#c8d8ff", every: 99, each: (dt, f) => sealAll(f) });
      },
    },
    {
      name: "霞", cost: 30, cd: 14, backlash: 0.05,
      desc: "範圍瞬間術式反噬：立即重創範圍內敵人（一般敵人 22% 最大生命、Boss 5%），之後 8 秒內他們每次攻擊都會傷到自己",
      cast({ p }) {
        for (const e of aoe(p.x, p.y, 240, 0, {})) {
          hitEnemy(e, e.mhp * (isBossType(e.t) ? 0.05 : 0.22), { ult: 0 });
          if (e.hp > 0) applyEnemyFx(e, "backlash", { duration: 8 });
        }
        ring(p.x, p.y, 240, "#ffb0a0", 0.5);
      },
    },
  ],
  domains: [
    {
      name: "朗", color: "#fff2c0", energyFrac: 0.6, backlash: 0.3,
      desc: "6 秒大範圍：場內敵人術式熔斷與靈魂熔斷（Boss 只會被熔斷）並持續受傷，不含你；極高耗能（60% 能量）與術式反噬（30% 最大生命）",
      cast({ p }) {
        let acc = 0;
        domain({
          x: p.x, y: p.y, r: 380, t: 6, color: "#fff2c0", noRegen: true,
          update(dt, f) {
            acc += dt;
            const tick = acc >= 0.25;
            if (tick) acc -= 0.25;
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              applyEnemyFx(e, "seal", { duration: 1 });
              applyEnemyFx(e, "soulseal", { duration: 1 });
              if (tick) hitEnemy(e, 15, { from: f, ult: 0.03 });
            }
            for (const b of bulletsIn(f.x, f.y, f.r)) b.life = 0;
          },
          draw(cx, f) {
            cx.save();
            cx.translate(f.x, f.y);
            cx.strokeStyle = f.color;
            cx.globalAlpha = 0.35;
            cx.lineWidth = 3;
            for (let k = 0; k < 16; k++) {
              const a = (k * TAU) / 16 + G.time * 0.4;
              cx.beginPath();
              cx.moveTo(Math.cos(a) * f.r * 0.3, Math.sin(a) * f.r * 0.3);
              cx.lineTo(Math.cos(a) * f.r, Math.sin(a) * f.r);
              cx.stroke();
            }
            cx.restore();
          },
        });
      },
    },
  ],
});
