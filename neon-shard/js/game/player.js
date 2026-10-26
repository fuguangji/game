/** game/player — 玩家：衝刺、輸入、每幀更新 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { PC, PSPD } from "../game-config.js";
import { burst, hurt, keys, mouse, mv, shoot, ta, tm } from "./battle.js";
import { collectPk } from "./pickups.js";
import { UL } from "./progress.js";
import { applyStatus, isBlocked, speedMultiplier, tickStatuses } from "./status-effects.js";
import { skillSelected } from "./techniques.js";
import { standOnTile } from "./tiles.js";
import { WP } from "./weapons.js";

// 衝刺：短暫無敵位移，方向取輸入或瞄準方向
export function dash(ang) {
  if (fsm.state !== "play" || G.pl.dashCd > 0 || isBlocked(G.pl, "move")) return;
  let { ix, iy } = inp();
  if (ang !== undefined) {
    ix = Math.cos(ang);
    iy = Math.sin(ang);
  } else if (!ix && !iy) {
    ix = Math.cos(G.pl.aim);
    iy = Math.sin(G.pl.aim);
  }
  const n = Math.hypot(ix, iy) || 1;
  G.pl.dx = ix / n;
  G.pl.dy = iy / n;
  G.pl.dashT = 0.17;
  G.pl.dashCd = 1.2 * (1 - 0.06 * UL("dsh"));
  bus.emit(GameEvents.PLAYER_DASH);
}
// 功能：彙整鍵盤、滑鼠與觸控輸入。
export function inp() {
  let ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    iy = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  if (ix || iy) {
    const n = Math.hypot(ix, iy);
    ix /= n;
    iy /= n;
  }
  if (tm.id !== null) {
    const dx = tm.x - tm.sx,
      dy = tm.y - tm.sy,
      d = Math.hypot(dx, dy);
    if (d > 6 * G.HU) {
      ix = dx / d;
      iy = dy / d;
    }
  }
  return { ix, iy };
}
// 每幀更新玩家：移動、彈藥回復、拾取物判定
export function updPl(dt) {
  const p = G.pl,
    { ix, iy } = inp();
  p.hf -= dt;
  p.rc = Math.max(0, p.rc - dt * 0.25);
  tickStatuses(p, dt, { hurt });
  if (p.dashT <= 0) standOnTile(p, dt, { hurt, applyStatus }); // 站在特殊地板上（見 tiles.js）
  p.dashCd -= dt;
  p.boost -= dt;
  p.sc -= dt;
  if (ta.act) {
    p.aim = ta.a;
    p.q = Math.max(
      0,
      Math.min(
        1,
        (Math.hypot(ta.x - ta.sx, ta.y - ta.sy) - G.CZ) / (90 * G.HU - G.CZ),
      ),
    );
  } else if (mouse.has) {
    p.aim = Math.atan2(mouse.y / G.S + G.camy - p.y, mouse.x / G.S + G.camx - p.x);
    p.q = Math.max(
      0,
      Math.min(
        1,
        Math.hypot(mouse.x / G.S + G.camx - p.x, mouse.y / G.S + G.camy - p.y) / 260,
      ),
    );
  }
  if (G.pl.lw !== G.pl.w) {
    if (G.pl.lw !== undefined) {
      G.pl.sb = 2.5;
      G.fxs.push({
        k: "w",
        x: G.pl.x,
        y: G.pl.y,
        r: 55,
        t: 0.35,
        max: 0.35,
        col: WP[G.pl.w].c,
      });
    }
    G.pl.lw = G.pl.w;
  }
  if (G.pl.sb > 0) G.pl.sb -= dt;
  for (const w of WP)
    if (w.am < w.ms)
      w.am = Math.min(w.ms, w.am + (dt * (1 + 0.08 * UL("reg"))) / w.rs);
  if (G.train && G.inf) {
    for (const w of WP) {
      w.am = w.ms;
      w.um = 100;
    }
  }
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.vx = p.dx * 420;
    p.vy = p.dy * 420;
    burst(p.x, p.y, "#22e6ff", 2, 40, 3, 0.3);
  } else {
    const sp =
      PSPD *
      (1 + 0.04 * UL("spd")) *
      (p.boost > 0 ? 1.4 : 1) *
      speedMultiplier(p);
    p.vx = ix * sp;
    p.vy = iy * sp;
  }
  mv(p, p.vx * dt, p.vy * dt);
  if (p.pvx || p.pvy) {
    mv(p, p.pvx * dt, p.pvy * dt);
    const f = Math.exp(-1.5 * dt);
    p.pvx *= f;
    p.pvy *= f;
    if (Math.hypot(p.pvx, p.pvy) < 1) p.pvx = p.pvy = 0;
  }
  if (mouse.down && WP[p.w].auto && !skillSelected()) shoot();
  if (ta.act && WP[p.w].auto && !skillSelected()) {
    const dq = Math.hypot(ta.x - ta.sx, ta.y - ta.sy);
    if (dq > G.CZ) {
      shoot();
      ta.fired = 1;
    } else if (!ta.out && performance.now() - ta.t0 > 250) {
      shoot(false, true);
      ta.fired = 1;
    }
  }
  for (let i = G.pk.length - 1; i >= 0; i--) {
    const q = G.pk[i];
    q.life -= dt;
    if (q.life <= 0) {
      G.pk.splice(i, 1);
      continue;
    }
    if (q.vac) {
      if (q.dl > 0) q.dl -= dt;
      else {
        q.vs = Math.min(1500, q.vs + 1100 * dt);
        const mx = p.x - q.x,
          my = p.y - q.y,
          md = Math.hypot(mx, my);
        if (md > 1) {
          const st = Math.min(md, q.vs * dt);
          q.x += (mx / md) * st;
          q.y += (my / md) * st;
        }
        if (Math.random() < 0.7)
          burst(q.x, q.y, PC[q.t] || "#ffffff", 1, 25, 2.2, 0.25);
      }
    }
    if (q.t === "coin" || q.t === "shard" || q.t === "core" || q.t === "chip") {
      const mx = p.x - q.x,
        my = p.y - q.y,
        md = Math.hypot(mx, my);
      if (md < 120 && md > 1) {
        q.x += (mx / md) * 260 * dt;
        q.y += (my / md) * 260 * dt;
      }
    }
    if (Math.hypot(q.x - p.x, q.y - p.y) < p.r + 15) {
      collectPk(q);
      G.pk.splice(i, 1);
    }
  }
}
