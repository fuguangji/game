/** game/battle — 戰鬥核心：開局、受傷、射擊、大招入口 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { N, T } from "../core/viewport.js";
import { ELITE, EL_COL } from "../enemy-config.js";
import { PN } from "../game-config.js";
import { bossIntro, flash } from "./boss.js";
import { CHS, bankChips } from "./chips.js";
import { elify } from "./elite.js";

import { NEWT } from "./pickups.js";
import { ST, SV, UL, bossIndexAt, save } from "./progress.js";
import { endTrain } from "./training.js";
import { FT, LZ, SQ } from "./ultimates.js";
import { WP } from "./weapons.js";
import { ENEMY_SPEED_SCALE, bossCatalog, enemyCatalog, requireCreature } from "../config/index.js";
import { burst, empty, genMap } from "./world-helpers.js";
import { damageTakenMultiplier } from "./status-effects.js";
export { blocked, burst, cell, drop, empty, genMap, hc, hitCell, mv, ray, solidAt, turLand } from "./world-helpers.js";
export { ULN, ULT_OLD, applyUM, shoot, ub, ult, ultMods, ultT } from "./player-attacks.js";

export const keys = {},
  mouse = { x: 0, y: 0, down: false, has: false },
  tm = { id: null, sx: 0, sy: 0, x: 0, y: 0 },
  ta = { id: null, sx: 0, sy: 0, x: 0, y: 0, a: 0, act: false };
// 建立敵人物件；血量隨波數與關卡倍率成長
export function mkEn(t, x, y) {
  const m = (1 + 0.1 * (G.wave - 1)) * ST().hm,
    stats = requireCreature(t); // 這隻敵人的基礎設定（唯讀，見 config/）
  return {
    t,
    x,
    y,
    m: stats.mass,
    kx: 0,
    ky: 0,
    dash: 0,
    tx: 0,
    ty: 0,
    rt: Math.random() * 0.3,
    dtm: 0,
    dvx: 0,
    dvy: 0,
    px: x,
    py: y,
    mvx: 0,
    mvy: 0,
    r: stats.radius,
    hp: stats.maxHealth * m,
    mhp: stats.maxHealth * m,
    sp: stats.moveSpeed * ENEMY_SPEED_SCALE * (1 + Math.min(0.5, 0.03 * G.wave)),
    col: stats.color,
    sc: stats.scoreValue,
    cd: 1 + Math.random() * 2,
    tele: 0,
    aim: 0,
    hf: 0,
    cc: 0,
    ang: 0,
    st: Math.random() < 0.5 ? 1 : -1,
    ramT: 0,
  };
}
// 進入下一波：依波數解鎖敵種並生成敵人與補給
export function startWave() {
  G.wave++;
  G.banner = 2.2;
  if (G.wave > 1) G.score += G.wave * 50;
  const bw = ST().g ? G.wave === ST().g : G.wave % 5 === 0,
    n = bw
      ? Math.max(3, Math.floor(Math.min(26, 3 + G.wave * 2) / 2))
      : Math.min(26, 3 + G.wave * 2);
  G.eliteN = 0;
  G.eliteL = {};
  const elW = !G.train && (bw || (ST().g ? G.wave === ST().g - 1 : G.wave % 5 === 4));
  for (let k = 0; k < n; k++) {
    const pool = [0, 0];
    pool.push(...enemyCatalog.typesUnlockedBy(G.wave));
    const nw = NEWT(),
      t =
        k < nw.length * 2
          ? nw[k % nw.length]
          : pool[(Math.random() * pool.length) | 0];
    const p = empty(380, G.pl, 760);
    if (p) {
      const m0 = mkEn(t, p.x, p.y);
      if (elW && ELITE[t] && Math.random() < 0.2) elify(m0);
      G.en.push(m0);
      burst(p.x, p.y, m0.el ? EL_COL : "#ffffff", m0.el ? 16 : 8, 120, 2, 0.5);
    }
  }
  if (G.eliteN) {
    G.banner = 3;
    flash(EL_COL, 0.5, 0.4);
  }
  if (bw) {
    const p = empty(380, G.pl, 760);
    if (p) {
      const bi = bossIndexAt(G.wave);
      {
        const bb = mkEn(bossCatalog.get(bi).typeId, p.x, p.y);
        G.en.push(bb);
        bossIntro(bb);
      }
      G.banner = 3;
      G.bossT = bi;
      G.bossIn = 2.4;
      flash("#ff2a4a", 0.8, 0.5);
      G.shake = 26;
      G.fxs.push({
        k: "w",
        x: p.x,
        y: p.y,
        r: 500,
        t: 0.9,
        max: 0.9,
        col: "#ff2a4a",
      });
    }
  }
  for (let k = 0; k < 2; k++) {
    const p = empty(100, G.pl);
    if (p) G.pk.push({ x: p.x, y: p.y, t: PN[k ? 1 : 0], life: 18 });
  }
}
// 開局初始化：地圖、玩家、彈匣、各種陣列與計時器
export function setup() {
  G.ewl = [];
  G.egh = [];
  G.CHR = CHS[SV.char] || CHS[0];
  genMap();
  G.pl = {
    x: 22.5 * T,
    y: 22.5 * T,
    r: 12,
    hp: 100 + 10 * UL("hp") + G.CHR.hp,
    mhp: 100 + 10 * UL("hp") + G.CHR.hp,
    sh: 0,
    ammo: 5,
    w: 0,
    rc: 0,
    st: {}, // 狀態效果（見 status-effects.js）
    pvx: 0,
    pvy: 0,
    q: 0.5,
    dashCd: 0,
    dashT: 0,
    dx: 1,
    dy: 0,
    boost: 0,
    aim: 0,
    sc: 0,
    hf: 0,
    vx: 0,
    vy: 0,
  };
  WP.forEach((w) => {
    w.ms = w.bm ? 1 : Math.round(w.ms0 * (1 + 0.1 * UL("mag")));
    w.am = w.ms;
    w.um = 0;
  });
  Object.defineProperty(G.pl, "ult", {
    configurable: true,
    enumerable: true,
    get() {
      const w = WP[this.w];
      return w ? w.um || 0 : 0;
    },
    set(v) {
      const w = WP[this.w];
      if (w) w.um = v;
    },
  });
  SQ.length = 0;
  LZ.length = 0;
  FT.length = 0;
  G.fxs = [];
  G.FL = null;
  G.bossIn = 0;
  G.ptxt = 0;
  G.bti = 0;
  G.chp = [];
  G.coins = 0;
  G.shd = 0;
  G.cor = 0;
  G.pts = 0;
  G.won = 0;
  G.RUN = { dmg: 0 };
  G.en = [];
  G.pendEn.length = 0;
  G.bl = [];
  G.pk = [];
  G.pt = [];
  G.zones = [];
  G.wave = 0;
  G.score = 0;
  G.shake = 0;
  G.pkT = 6;
  G.waveT = 1.8;
  G.shown = 0;
  G.camx = G.pl.x - G.W / G.S / 2;
  G.camy = G.pl.y - G.H / G.S / 2;
  startWave();
}
// 玩家受傷：衝刺無敵、減傷、先扣護盾再扣血，血量歸零則結束遊戲
/** quiet = true：持續傷害用，不震動、不閃紅（扣血、護盾、死亡判定照舊） */
export function hurt(d, { quiet = false } = {}) {
  if (G.pl.dashT > 0 || fsm.state !== "play" || (G.train && G.god)) return;
  d *= (G.CHR.dr || 1) * damageTakenMultiplier(G.pl);
  {
    const hurtEvent = { damage: d };
    bus.emit(GameEvents.PLAYER_HURT, hurtEvent); // 監聽者可調整傷害
    d = hurtEvent.damage;
  }
  const dd = d;
  if (!quiet) {
    G.HF = Math.min(1, Math.max(G.HF, 0.3 + d / 45));
    G.HC = G.pl.sh > 0 && d <= G.pl.sh ? "#4d9bff" : "#ff1e3c";
  }
  if (G.pl.sh > 0) {
    const a = Math.min(G.pl.sh, d);
    G.pl.sh -= a;
    d -= a;
  }
  G.pl.hp -= d;
  if (!quiet || G.pl.hp <= 0) {
    G.pl.hf = 0.2;
    G.shake = Math.max(G.shake, Math.min(26, 3 + dd * 0.4));
    try {
      if (navigator.vibrate)
        navigator.vibrate(
          G.pl.hp <= 0 ? [60, 40, 160] : Math.round(Math.min(120, 15 + dd * 2.5)),
        );
    } catch (e) {}
    burst(G.pl.x, G.pl.y, "#ff3d6a", 10, 200, 2.5, 0.5);
  }
  if (G.pl.hp <= 0) {
    G.pl.hp = 0;
    fsm.transition("over");
    G.overT = 1;
    if (!G.train) {
      bankChips();
      SV.coins += G.coins;
      SV.sh += G.shd;
      SV.co += G.cor;
      SV.sb[SV.sel] = Math.max(SV.sb[SV.sel] || 0, G.wave);
      save();
    }
    endTrain();
    burst(G.pl.x, G.pl.y, "#22e6ff", 60, 380, 3, 1.1);
    if (G.score > G.best) {
      G.best = G.score;
      store.setNumber(KEYS.best, G.best);
    }
  }
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.fd = new Int16Array(N * N);
G.fT = 0;
G.zones = [];
G.best = 0;
G.shake = 0;
G.camx = 0;
G.camy = 0;
G.time = 0;
G.waveT = 0;
G.banner = 0;
G.pkT = 0;
G.overT = 0;
G.shown = 0;

G.best = store.getNumber(KEYS.best, { min: 0, fallback: 0 });

G.touchOn = false;

G.UM = null;
}

