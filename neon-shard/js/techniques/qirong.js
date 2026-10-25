/** 噐體熔融：以術式熔斷、靈魂熔斷與反噬壓制對手。 */
import { isBossType } from "../config/index.js";
import { applyEnemyFx } from "../game/enemy-effects.js";
import { applyStatus, clearStatus } from "../game/status-effects.js";
import { aoe, beam, domain, enemiesIn, hitEnemy, registerTechnique, ring } from "../game/techniques.js";

/** 靈魂熔斷；Boss 免疫，改為熔斷同樣時間 */
const soulSeal = (e, dur) => { if (!applyEnemyFx(e, "soulseal", { duration: dur })) applyEnemyFx(e, "seal", { duration: dur }); };

registerTechnique({
  weapon: "噐體熔融",
  color: "#ff8a5a",
  skills: [
    {
      name: "基本熔斷", cost: 20, cd: 8,
      desc: "範圍術式熔斷：範圍內敵人 6 秒無法攻擊（Boss 3 秒）",
      cast({ p }) { aoe(p.x, p.y, 230, 20, { fx: [["seal", { duration: 6 }]] }); ring(p.x, p.y, 230, "#ff8a5a", 0.45); },
    },
    {
      name: "塑·熔", cost: 30, cd: 12,
      desc: "範圍塑性靈魂熔斷：範圍內敵人 5 秒無法操縱（不能移動與攻擊），還會持續流失能量；Boss 只會被熔斷",
      cast({ p }) {
        for (const e of aoe(p.x, p.y, 210, 10, { fx: [["drain", { duration: 5 }]] })) soulSeal(e, 5);
        ring(p.x, p.y, 210, "#c070ff", 0.5);
      },
    },
    {
      name: "汽焊", cost: 20, cd: 75,
      desc: "1 分鐘內，自身所有種類的熔斷無效，並立刻解除目前的熔斷",
      cast({ p }) {
        clearStatus(p, "seal");
        clearStatus(p, "soulseal");
        applyStatus(p, "sealImmune", { duration: 60 });
        ring(p.x, p.y, 90, "#9fe8ff", 0.5);
      },
    },
    {
      name: "助焊劑", cost: 15, cd: 6,
      desc: "朝前方射出一發，命中的第一個敵人 30 秒內承受的術式反噬增加 150%",
      cast({ p, aim }) { beam(p.x, p.y, aim, 700, 22, 20, { first: true, col: "#ffd27a", fx: [["flux", { duration: 30 }]] }); },
    },
  ],
  domains: [
    {
      name: "爐心熔毀", color: "#ff6a3a", energyFrac: 0.8, hpFrac: 0.99,
      desc: "6 秒：場內敵人靈魂熔斷（Boss 熔斷）並承受極高的術式反噬（每秒約 20% 最大生命，Boss 約 4%）。代價：99% 最大生命（血量必須高於 99% 才能施放）與 80% 能量",
      cast({ p }) {
        let acc = 0;
        domain({
          x: p.x, y: p.y, r: 420, t: 6, color: "#ff6a3a", noRegen: true,
          update(dt, f) {
            acc += dt;
            const tick = acc >= 0.5;
            if (tick) acc -= 0.5;
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              soulSeal(e, 1);
              if (tick) hitEnemy(e, e.mhp * (isBossType(e.t) ? 0.02 : 0.1), { from: f, ult: 0.02 });
            }
          },
        });
      },
    },
  ],
});
