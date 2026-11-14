/** 未雨鎩：水屬性術式（技能傷害屬性 "water"，會被「轉態」放大 3 倍）。 */
import { isBossType } from "../config/index.js";
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { applyEnemyFx } from "../game/enemy-effects.js";
import { applyStatus, clearStatus } from "../game/status-effects.js";
import { addFx, aoe, beam, bulletsIn, domain, enemiesIn, field, healPlayer, hitEnemy, registerTechnique, ring, strokeRing } from "../game/techniques.js";
import { burst } from "../game/world-helpers.js";

registerTechnique({
  weapon: "未雨鎩",
  color: "#6ab8ff",
  tick(p, dt) {
    // 記錄最近 5 秒的狀態，給「負片」逆流用
    p.snapT = (p.snapT ?? 0) - dt;
    if (p.snapT <= 0) {
      p.snapT = 0.25;
      (p.snap ??= []).push({ hp: p.hp, en: p.en });
      if (p.snap.length > 20) p.snap.shift();
    }
  },
  skills: [
    {
      name: "時柳", cost: 0, cd: 40,
      desc: "預支未來 5 分鐘的能量：能量滿並多出 100、10 秒內技能免費，抽走周圍敵人的能量（熔斷並損血、為自己回血）；代價是時間到後昏迷 4 秒",
      cast({ p }) {
        p.en = p.enMax + 100;
        applyStatus(p, "borrow", { duration: 10 });
        const near = enemiesIn(p.x, p.y, 330);
        for (const e of near) {
          applyEnemyFx(e, "seal", { duration: 5 });
          hitEnemy(e, e.mhp * (isBossType(e.t) ? 0.02 : 0.08), { tag: "water", ult: 0 });
        }
        healPlayer(Math.min(0.2, 0.04 * near.length));
        ring(p.x, p.y, 330, "#7ad6ff", 0.6);
      },
    },
    {
      name: "渦流", cost: 15, cd: 3,
      desc: "快速自旋攻擊，高擊退，同時擊落近身的敵方子彈",
      cast({ p }) {
        let acc = 0.09;
        addFx({
          t: 0.45,
          update(dt) {
            acc += dt;
            if (acc >= 0.09) {
              acc -= 0.09;
              aoe(p.x, p.y, 125, 16, { tag: "water", kb: 1100, ult: 0.08 });
              for (const b of bulletsIn(p.x, p.y, 125)) b.life = 0;
            }
          },
          draw(cx, f) {
            cx.save();
            cx.strokeStyle = "#bfeaff";
            cx.lineWidth = 4;
            cx.globalAlpha = Math.min(1, f.t * 4);
            for (let k = 0; k < 3; k++) {
              const a = G.time * 22 + (k * TAU) / 3;
              cx.beginPath();
              cx.arc(p.x, p.y, 105, a, a + 1.2);
              cx.stroke();
            }
            cx.restore();
          },
        });
      },
    },
    {
      name: "脈衝", cost: 35, cd: 9, backlash: 0.05,
      desc: "瞬間貫穿整條直線上所有敵人的細射線（很窄，需要精準瞄準）",
      cast({ p, aim }) {
        beam(p.x, p.y, aim, 1500, 7, 240, { tag: "water", col: "#bfeaff" });
        G.shake = Math.max(G.shake, 6);
      },
    },
    {
      name: "璃", cost: 30, cd: 10,
      desc: "瞄準處的空間像冰面般碎裂 5 秒：靠近的敵人被快速扭曲、減速並持續受傷",
      cast({ p, x, y }) {
        const a = Math.atan2(y - p.y, x - p.x), d = Math.min(Math.hypot(x - p.x, y - p.y), 380);
        const cx0 = p.x + Math.cos(a) * d, cy0 = p.y + Math.sin(a) * d;
        field({
          x: cx0, y: cy0, r: 190, t: 5, col: "#aee6ff", every: 0.35, dmg: 6, tag: "water",
          each(dt, f) { for (const e of enemiesIn(f.x, f.y, f.r)) e.fr = Math.max(e.fr || 0, 0.3); },
          tick(f) {
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              const q = Math.random() * TAU;
              e.kx += (Math.cos(q) * 600) / e.m;
              e.ky += (Math.sin(q) * 600) / e.m;
            }
          },
          draw(cx, f) {
            cx.save();
            cx.strokeStyle = "#e8f8ff";
            cx.globalAlpha = 0.5;
            for (let k = 0; k < 9; k++) {
              const q = (k * TAU) / 9 + 0.3;
              cx.beginPath();
              cx.moveTo(f.x, f.y);
              cx.lineTo(f.x + Math.cos(q) * f.r, f.y + Math.sin(q + (k % 2) * 0.1) * f.r);
              cx.stroke();
            }
            cx.restore();
          },
        });
      },
    },
    {
      name: "負片", cost: 0, cd: 60,
      desc: "把狀態逆流：能量回滿、生命回到 5 秒前的水準（不會比現在低）、清除負面狀態；代價是 30 秒術式熔斷（無法施放術式，仍可普通攻擊）",
      cast({ p }) {
        const past = p.snap?.[0];
        for (const n of ["slow", "vuln", "poison", "seal", "soulseal"]) clearStatus(p, n);
        p.en = p.enMax;
        if (past) p.hp = Math.max(p.hp, Math.min(p.mhp, past.hp));
        applyStatus(p, "seal", { duration: 30 });
        ring(p.x, p.y, 200, "#ffffff", 0.7);
        burst(p.x, p.y, "#dff3ff", 40, 300, 3, 0.8);
      },
    },
  ],
  domains: [
    {
      name: "絕對霜域", color: "#aee6ff",
      desc: "7 秒：場內敵人完全無法移動，敵方子彈幾乎凝固在空中",
      cast({ p }) {
        domain({
          x: p.x, y: p.y, r: 320, t: 7, color: "#aee6ff",
          update(dt, f) {
            for (const e of enemiesIn(f.x, f.y, f.r)) { e.root = Math.max(e.root || 0, 0.25); e.fr = Math.max(e.fr || 0, 0.3); }
            const k = Math.pow(0.02, dt);
            for (const b of bulletsIn(f.x, f.y, f.r)) { b.vx *= k; b.vy *= k; }
          },
          draw(cx, f) {
            cx.save();
            cx.strokeStyle = "#e8f8ff";
            cx.globalAlpha = 0.35;
            for (let k = 0; k < 6; k++) {
              const q = (k * TAU) / 6 + G.time * 0.1;
              cx.beginPath();
              cx.moveTo(f.x, f.y);
              cx.lineTo(f.x + Math.cos(q) * f.r, f.y + Math.sin(q) * f.r);
              cx.stroke();
            }
            cx.restore();
            strokeRing(cx, f.x, f.y, f.r * 0.5, "#e8f8ff", { alpha: 0.3 });
          },
        });
      },
    },
    {
      name: "轉態", color: "#6ad8ff",
      desc: "12 秒：站在場內時，所有水屬性技能傷害 +200%（×3）",
      cast({ p }) {
        domain({
          x: p.x, y: p.y, r: 300, t: 12, color: "#6ad8ff",
          update(dt, f) { if (Math.hypot(G.pl.x - f.x, G.pl.y - f.y) < f.r) applyStatus(G.pl, "waterBoost", { duration: 0.25 }); },
        });
      },
    },
  ],
});
