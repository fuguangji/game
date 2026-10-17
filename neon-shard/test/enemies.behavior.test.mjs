// 把每一種敵人、Boss、Boss 小單位都生成出來跑模擬：確認設定類別接上之後，每一種都能正常行動、開火
import { enemyCatalog, bossCatalog, requireCreature, ENEMY_SPEED_SCALE, bulletCatalog } from "../js/config/index.js";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../js");
await import(path.join(root, "main.js"));
const X = {};
for (const f of fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".js") && !f.startsWith("account"))) Object.assign(X, await import(path.join(root, f)));
const { G, tutorial, fsm } = X;
const ok = (c, m) => { if (!c) { console.log("✗ FAIL:", m); process.exitCode = 1; } else console.log("✓", m); };
if (tutorial.active) tutorial.exit(); // 離開教學
X.start();
G.pl.hp = G.pl.mhp = 1e9;
const ids = [...enemyCatalog.all().map((d) => d.typeId), ...bossCatalog.all().map((b) => b.typeId), 30, 31];
let bullets = 0, failed = [];
for (const t of ids) {
  if (fsm.state !== "play") fsm.transition("play");
  G.en.length = 0; G.bl.length = 0; G.wave = 8;
  try {
    const e = X.mkEn(t, G.pl.x + 200, G.pl.y);
    const def = requireCreature(t);
    if (e.r !== def.radius || e.col !== def.color || e.sc !== def.scoreValue || e.m !== def.mass) throw new Error("mkEn 的數值與設定不符");
    if (Math.abs(e.sp - def.moveSpeed * ENEMY_SPEED_SCALE * (1 + Math.min(0.5, 0.03 * G.wave))) > 1e-9) throw new Error("移動速度與設定不符");
    G.en.push(e);
    for (let i = 0; i < 400; i++) { X.update(0.016); if (G.en.length === 0) break; if (G.pl.hp < G.pl.mhp) G.pl.hp = G.pl.mhp; }
    bullets += G.bl.filter((b) => b.own === 0).length;
  } catch (err) { failed.push(`${t}: ${err.message}`); }
}
ok(failed.length === 0, `全部 ${ids.length} 種敵方單位（一般 ${enemyCatalog.all().length} + Boss ${bossCatalog.count} + 小單位 2）都能生成並模擬 400 幀` + (failed.length ? "\n   " + failed.join("\n   ") : ""));
// 具名子彈：確認 fireBullet 產生的子彈欄位與設定一致
G.bl.length = 0;
const shooter = X.mkEn(1, G.pl.x + 300, G.pl.y);
X.fireBullet(shooter, 0, "SLOW_ORB");
const b = G.bl.at(-1), d = bulletCatalog.get("SLOW_ORB");
ok(b.dmg === d.damage && b.eff === d.effect && b.r === d.radius && Math.abs(Math.hypot(b.vx, b.vy) - d.speed * bulletCatalog.speedScale) < 1e-9 && b.own === 0, "fireBullet 依設定產生子彈（傷害、效果、半徑、速度）");
X.fireBullet(shooter, 0, "TRACKER_ORB_LIGHT");
ok(G.bl.at(-1).hm2 === true, "追蹤子彈帶有追蹤旗標");
X.fireBullet(shooter, 0, "BOSS_ROCK");
const rock = G.bl.at(-1);
ok(Math.abs(rock.life - 3 / bulletCatalog.speedScale) < 1e-9 && rock.col === "#ffb040", "Boss 落石：存活時間隨速度倍率調整、使用固定顏色");
process.exitCode = process.exitCode || 0;
