/** game/battle — 戰鬥核心：開局、受傷、射擊、大招入口 */
import { GameEvents, bus } from "../core/event-bus.js";
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { MW, N, T, TAU } from "../core/viewport.js";
import { ELITE, EL_COL } from "../enemy-config.js";
import { BS, ESPD, NE, PN, TH } from "../game-config.js";
import { EXT, bossIntro, flash, isB, thr } from "./boss.js";
import { CHS, bankChips } from "./chips.js";
import { elify } from "./elite.js";
import { aimT, angD, explode, quickT } from "./physics.js";
import { AIMR, NEWT, coin, cone, cur, jit } from "./pickups.js";
import { ST, SV, UL, save } from "./progress.js";
import { endTrain } from "./training.js";
import { FT, LZ, SQ, ULTS, laserFire, slashHit, ultRing, zfl } from "./ultimates.js";
import { ALLW, WP } from "./weapons.js";

export const keys = {},
  mouse = { x: 0, y: 0, down: false, has: false },
  tm = { id: null, sx: 0, sy: 0, x: 0, y: 0 },
  ta = { id: null, sx: 0, sy: 0, x: 0, y: 0, a: 0, act: false };
// 功能：讀取地圖格；超出地圖邊界時視為不可通行。
export const cell = (i, j) =>
  i < 0 || j < 0 || i >= N || j >= N ? -1 : G.grid[j * N + i];
// 功能：判斷指定座標是否落在實心地圖格。
export const solidAt = (x, y) => cell(Math.floor(x / T), Math.floor(y / T)) !== 0;
// 功能：以角色碰撞半徑檢查四角是否被地形阻擋。
export const blocked = (x, y, r) =>
  solidAt(x - r, y - r) ||
  solidAt(x + r, y - r) ||
  solidAt(x - r, y + r) ||
  solidAt(x + r, y + r);
// 功能：處理「turLand」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function turLand(x, y, r, m) {
  m = m || 20;
  x = Math.max(m, Math.min(MW - m, x));
  y = Math.max(m, Math.min(MW - m, y));
  if (!blocked(x, y, r)) return [x, y];
  for (let d = 8; d <= 160; d += 8)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU,
        nx = Math.max(m, Math.min(MW - m, x + Math.cos(a) * d)),
        ny = Math.max(m, Math.min(MW - m, y + Math.sin(a) * d));
      if (!blocked(nx, ny, r)) return [nx, ny];
    }
  return [x, y];
}
// 功能：處理「mv」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function mv(e, dx, dy) {
  if (e.root > 0 && !G.MVF) return true;
  let b = false;
  if (!blocked(e.x + dx, e.y, e.r)) e.x += dx;
  else b = true;
  if (!blocked(e.x, e.y + dy, e.r)) e.y += dy;
  else b = true;
  return b;
}
// 功能：處理「ray」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ray(x, y, a, m) {
  let l = 0;
  const c = Math.cos(a),
    s = Math.sin(a);
  while (l < m && !solidAt(x + c * l, y + s * l)) l += 8;
  return l;
}
// 功能：將敵人索引轉換為對應色相的 HSLA 顏色字串。
export const hc = (v, a) => `hsla(${(v - 1) * 36},85%,46%,${a})`;
// 隨機產生地圖：外框不可破、中央安全區、其餘依關卡密度放可破壞牆
export function genMap() {
  G.grid = new Int8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (i == 0 || j == 0 || i == N - 1 || j == N - 1) v = -1;
      else if (Math.max(Math.abs(i - 22), Math.abs(j - 22)) > 5) {
        const r = Math.random();
        v = r < 0.035 ? -1 : r < 0.035 + ST().dn ? 6 : 0;
      }
      G.grid[j * N + i] = v;
    }
}
// 功能：尋找符合距離條件且未被障礙物阻擋的位置。
export function empty(minD, ref, maxD) {
  for (let k = 0; k < 400; k++) {
    const i = (1 + Math.random() * (N - 2)) | 0,
      j = (1 + Math.random() * (N - 2)) | 0;
    if (G.grid[j * N + i] === 0) {
      const x = (i + 0.5) * T,
        y = (j + 0.5) * T,
        dd = ref ? Math.hypot(x - ref.x, y - ref.y) : 0;
      if (!ref || (dd >= minD && (!maxD || dd <= maxD))) return { x, y };
    }
  }
  return maxD ? empty(minD, ref) : null;
}
// 功能：在指定位置建立粒子爆發特效。
export function burst(x, y, col, n, sp, sz, life) {
  for (let i = 0; i < n && G.pt.length < 700; i++) {
    const a = Math.random() * TAU,
      s = sp * (0.3 + Math.random() * 0.7);
    G.pt.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: life * (0.6 + Math.random() * 0.4),
      max: life,
      col,
      sz: sz * (0.6 + Math.random() * 0.8),
    });
  }
}
// 功能：建立指定掉落物。
export function drop(x, y, p) {
  if (Math.random() < p && G.pk.filter((q) => PN.includes(q.t)).length < 12)
    G.pk.push({
      ...jit(x, y),
      t: PN[[0, 0, 0, 1, 1, 1, 2, 2, 3, 3][(Math.random() * 10) | 0]],
      life: 18,
    });
}
// 子彈/爆炸命中方塊：扣血、碎裂與掉落
export function hitCell(i, j, n = 1) {
  const v = cell(i, j);
  if (v <= 0) return;
  const nv = Math.max(0, v - n);
  G.grid[j * N + i] = nv;
  const x = (i + 0.5) * T,
    y = (j + 0.5) * T,
    col = hc(v, 1);
  if (nv === 0) {
    bus.emit(GameEvents.WALL_BROKEN);
    for (let k = 0; k < 9; k++) {
      const a = Math.random() * TAU,
        s = 80 + Math.random() * 180;
      G.pt.push({
        x: x + (Math.random() - 0.5) * T * 0.6,
        y: y + (Math.random() - 0.5) * T * 0.6,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.8,
        max: 0.8,
        col,
        sz: 4 + Math.random() * 6,
        f: 1,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
    burst(x, y, col, 10, 180, 2.5, 0.5);
    drop(x, y, 0.1);
    if (Math.random() < 0.15) coin(x, y, 1);
    if (Math.random() < 0.3) cur("shard", x, y, 1);
    G.score += 5;
    G.pts += 2;
    G.shake = Math.max(G.shake, 3);
  } else burst(x, y, col, 5, 120, 2, 0.35);
}
// 建立敵人物件；血量隨波數與關卡倍率成長
export function mkEn(t, x, y) {
  const m = (1 + 0.1 * (G.wave - 1)) * ST().hm,
    D =
      EXT[t] ||
      [
        [13, 30, 125, "#ff3d9a", 100, 1],
        [14, 40, 80, "#ff9a3d", 200, 1],
        [15, 60, 70, "#b45cff", 250, 1.5],
        [13, 35, 75, "#9dff3d", 220, 1],
        [13, 35, 80, "#4de1ff", 200, 1],
        [14, 50, 60, "#ff4dff", 260, 1.2],
        [16, 70, 55, "#3dffb0", 300, 1.2],
        [14, 45, 65, "#ff2a4a", 280, 1.5],
        [17, 90, 90, "#c0c8ff", 320, 2.5],
        [15, 60, 60, "#ffd23a", 270, 2],
        [14, 55, 60, "#ff9ad5", 290, 1.2],
        [13, 40, 70, "#7a7aff", 300, 1],
        [20, 100, 75, "#ff7a5a", 300, 2],
        [15, 55, 50, "#d4ff3d", 310, 1.5],
        [34, 1750, 90, "#ff4d4d", 1500, 3],
        [38, 2250, 100, "#ffb040", 2000, 4],
        [30, 1625, 140, "#4dffd8", 2200, 3],
        [40, 3000, 50, "#d070ff", 4000, 5],
      ][t];
  return {
    t,
    x,
    y,
    m: D[5],
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
    r: D[0],
    hp: D[1] * m,
    mhp: D[1] * m,
    sp: D[2] * ESPD * (1 + Math.min(0.5, 0.03 * G.wave)),
    col: D[3],
    sc: D[4],
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
    for (let q = 0; q < 14; q++) if (G.wave >= TH[q]) pool.push(q);
    for (const [t2, w2] of NE) if (G.wave >= w2) pool.push(t2);
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
      const bi = ST().g ? SV.sel : (G.wave / 5 - 1) % 8;
      {
        const bb = mkEn(14 + bi, p.x, p.y);
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
    slow: 0,
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
export function hurt(d) {
  if (G.pl.dashT > 0 || fsm.state !== "play" || (G.train && G.god)) return;
  d *= (G.CHR.dr || 1) * (G.pl.vuln > 0 ? 1.15 : 1);
  {
    const hurtEvent = { damage: d };
    bus.emit(GameEvents.PLAYER_HURT, hurtEvent); // 監聽者可調整傷害
    d = hurtEvent.damage;
  }
  const dd = d;
  G.HF = Math.min(1, Math.max(G.HF, 0.3 + d / 45));
  G.HC = G.pl.sh > 0 && d <= G.pl.sh ? "#4d9bff" : "#ff1e3c";
  if (G.pl.sh > 0) {
    const a = Math.min(G.pl.sh, d);
    G.pl.sh -= a;
    d -= a;
  }
  G.pl.hp -= d;
  G.pl.hf = 0.2;
  G.shake = Math.max(G.shake, Math.min(26, 3 + dd * 0.4));
  try {
    if (navigator.vibrate)
      navigator.vibrate(
        G.pl.hp <= 0 ? [60, 40, 160] : Math.round(Math.min(120, 15 + dd * 2.5)),
      );
  } catch (e) {}
  burst(G.pl.x, G.pl.y, "#ff3d6a", 10, 200, 2.5, 0.5);
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
// 開火：檢查彈藥與冷卻，依武器產生子彈（含自動瞄準與散佈）
export function shoot(f, qk) {
  const w = WP[G.pl.w];
  if (fsm.state !== "play" || G.pl.sc > 0 || w.am < (w.laser ? 0.85 : 1)) return;
  w.am -= w.laser ? 0.85 : 1;
  G.pl.sc = w.cd;
  G.pl.lf = G.time;
  const tg = qk ? quickT() : aimT();
  bus.emit(GameEvents.PLAYER_SHOT, { autoAim: !!tg });
  const SB = G.pl.sb > 0 ? 1.3 : 1;
  G.pl.sb = 0;
  let ba = G.pl.aim;
  if (tg && !(w.mine || w.web || w.tur || w.tox || w.slash)) {
    const sp = w.v * BS,
      D = Math.hypot(tg.x - G.pl.x, tg.y - G.pl.y),
      t = D / sp;
    ba = Math.atan2(tg.y + tg.mvy * t - G.pl.y, tg.x + tg.mvx * t - G.pl.x);
  }
  const jit =
    (Math.random() * 2 - 1) *
    (cone() - (w.n1 === 1 ? w.sp / 2 : 0)) *
    (tg ? 0.4 : 1);
  G.pl.rc = Math.min(0.1, G.pl.rc + (w.rcg || 0));
  if (w.slash) {
    if (tg) ba = Math.atan2(tg.y - G.pl.y, tg.x - G.pl.x);
    slashHit(
      G.pl.x,
      G.pl.y,
      ba,
      w.sw,
      w.rg,
      w.dmg * (w.n1 || 1) * SB * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg),
      w.kb,
      w.c,
      w,
    );
    G.shake = Math.max(G.shake, 2);
    return;
  }
  if (w.mine || w.web || w.gren || w.tur || w.tox) {
    const W0 = ALLW[w.id] || w,
      RGm = Math.max(0.5, (w.life || 1) / (W0.life || 1)),
      RG = 260 * RGm,
      N1 = Math.max(1, w.n1 || 1),
      XB = w.xb ? 1.25 : 1;
    if (tg) {
      const lt = w.mine ? 0.3 : w.gren ? 0.6 : w.tox ? 0.5 : w.tur ? 0.3 : 0,
        px = tg.x + (tg.mvx || 0) * lt,
        py = tg.y + (tg.mvy || 0) * lt;
      ba = Math.atan2(py - G.pl.y, px - G.pl.x);
      G.pl.q = Math.max(0, Math.min(1, Math.hypot(px - G.pl.x, py - G.pl.y) / RG));
    }
    const L =
        w.gren || w.tox || w.tur
          ? Math.max(0, G.pl.q * RG)
          : Math.max(0, Math.min(G.pl.q * RG, ray(G.pl.x, G.pl.y, ba, RG) - 12)),
      mx = G.pl.x + Math.cos(ba) * L,
      my = G.pl.y + Math.sin(ba) * L;
    if (w.gren) {
      const crt = w.cr && Math.random() < w.cr,
        gx = Math.max(20, Math.min(MW - 20, mx)),
        gy = Math.max(20, Math.min(MW - 20, my));
      G.zones.push(
        thr(
          {
            k: "gren",
            x: gx,
            y: gy,
            r: (w.ex || 70) * Math.sqrt((w.r || 6) / 6) * XB,
            t: 0.5,
            max: 0.5,
            col: crt ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              N1 *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) *
              (crt ? w.cm : 1),
            kb: w.kb,
            wd: w.wd,
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.45,
        ),
      );
      burst(
        G.pl.x + Math.cos(ba) * 20,
        G.pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.tox) {
      const crt = w.cr && Math.random() < w.cr,
        gx = Math.max(20, Math.min(MW - 20, mx)),
        gy = Math.max(20, Math.min(MW - 20, my));
      G.zones.push(
        thr(
          {
            k: "tox",
            x: gx,
            y: gy,
            r: 85 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 4,
            max: 4,
            wi: G.pl.w,
            col: crt ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              (4 / 6) *
              N1 *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) *
              (crt ? w.cm : 1),
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.45,
        ),
      );
      burst(
        G.pl.x + Math.cos(ba) * 20,
        G.pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.tur) {
      const ts = G.zones.filter((z) => z.k === "tur" && !z.ult);
      while (ts.length >= 2) {
        const o = ts.shift();
        o.t = 0;
        burst(o.x, o.y, o.col, 8, 120, 2, 0.3);
      }
      const [tx0, ty0] = turLand(mx, my, 18);
      G.zones.push(
        thr(
          {
            k: "tur",
            x: tx0,
            y: ty0,
            r: 14,
            t: 10,
            max: 10,
            hp: 40,
            mhp: 40,
            col: w.c,
            w: w,
            cd: 0.4,
            ang: ba,
            rg: 250 * RGm,
            fi: w.cd,
            dmul: SB * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg),
          },
          G.pl.x,
          G.pl.y,
          0.3,
        ),
      );
      burst(
        G.pl.x + Math.cos(ba) * 20,
        G.pl.y + Math.sin(ba) * 20,
        w.c,
        4,
        100,
        1.8,
        0.2,
      );
      return;
    }
    if (w.web)
      G.zones.push(
        thr(
          {
            k: "web",
            x: mx,
            y: my,
            r: 70 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 7,
            max: 7,
            wi: G.pl.w,
            col: w.c,
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.28,
        ),
      );
    else {
      const crM = w.cr && Math.random() < w.cr;
      G.zones.push(
        thr(
          {
            k: "mine",
            x: mx,
            y: my,
            r: 70 * Math.sqrt((w.r || 5) / 5) * XB,
            t: 14,
            max: 14,
            wi: G.pl.w,
            col: crM ? "#ffffff" : w.c,
            dmg:
              w.dmg *
              SB *
              (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) *
              (crM ? w.cm : 1),
            kb: w.kb,
            wd: w.wd,
            arm: 0.6,
            ...zfl(w),
          },
          G.pl.x,
          G.pl.y,
          0.28,
        ),
      );
    }
    burst(mx, my, w.c, 8, 120, 2, 0.3);
    return;
  }
  if (w.laser) {
    laserFire(w, tg, SB);
    return;
  }
  for (let k = 0; k < w.n1; k++) {
    const crt = w.cr && Math.random() < w.cr,
      a =
        ba +
        jit +
        (w.n1 > 1
          ? (k / (w.n1 - 1) - 0.5) * w.sp
          : (Math.random() - 0.5) * w.sp),
      c = Math.cos(a),
      s = Math.sin(a);
    G.bl.push({
      x: G.pl.x + c * 20,
      y: G.pl.y + s * 20,
      vx: c * w.v * BS,
      vy: s * w.v * BS,
      r: crt ? w.r * 1.4 : w.r,
      own: 1,
      dmg:
        w.dmg * SB * (1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg) * (crt ? w.cm : 1),
      life: w.life / BS,
      col: crt ? "#ffffff" : w.c,
      kb: w.kb,
      pe: w.pierce,
      hm: w.hm,
      pierce: w.pa,
      ex: w.ex,
      ch: w.ch,
      bn: w.bn,
      bm: w.bm,
      wi: G.pl.w,
      xb: w.xb,
      bu: w.bu,
      fr: w.fr,
      lk: w.lk,
      fz4: w.fz4,
      cg: w.cg,
      gp: w.gp,
      wd: w.wd,
      fl: w.fl,
      cs: w.cs,
      l0: w.life / BS,
      age: 0,
      lc: -1,
      hit: [],
    });
  }
  burst(
    G.pl.x + Math.cos(ba) * 22,
    G.pl.y + Math.sin(ba) * 22,
    w.c,
    3,
    120,
    1.8,
    0.2,
  );
  G.shake = Math.max(G.shake, w.n1 > 1 || w.kb > 400 ? 4 : 1);
}
// 功能：處理「ub」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ub(a, v, o) {
  const b = Object.assign(
    {
      x: G.pl.x + Math.cos(a) * 16,
      y: G.pl.y + Math.sin(a) * 16,
      vx: Math.cos(a) * v * BS,
      vy: Math.sin(a) * v * BS,
      r: 5,
      own: 1,
      dmg: 30,
      life: 1.2 / BS,
      col: "#ffe14a",
      kb: 300,
      pe: 1,
      ult: 1,
      hit: [],
      lc: -1,
    },
    o,
  );
  b.dmg *= 1 + 0.06 * UL("dmg") + 0.1 * G.RUN.dmg;
  applyUM(b);
  G.bl.push(b);
}
// 功能：處理「ultMods」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ultMods() {
  const c = WP[G.pl.w],
    b = c && ALLW[c.id];
  if (!b) return null;
  // 功能：計算兩個武器屬性之間的倍率；分母無效時回傳預設倍率。
  const g = (x, y) => (y > 0 ? x / y : 1),
    fl = (k) => (c[k] && !b[k] ? 1 : 0);
  return {
    dm: 1 + (g(c.dmg * (c.n1 || 1), b.dmg * (b.n1 || 1)) - 1) * 0.6,
    kb: g(c.kb, b.kb),
    wd: (c.wd || 0) - (b.wd || 0),
    r: g(c.r, b.r),
    v: g(c.v, b.v),
    life: g(c.life, b.life),
    xb: fl("xb"),
    ch: fl("ch"),
    bu: fl("bu"),
    fr: fl("fr"),
    fz4: fl("fz4"),
    lk: fl("lk"),
    hm: fl("hm"),
    bn: (c.bn || 0) - (b.bn || 0),
    cr: (c.cr || 0) - (b.cr || 0),
    cm: c.cm || 1,
  };
}
// 功能：處理「applyUM」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function applyUM(b) {
  if (!G.UM || b.um) return;
  b.um = 1;
  const m = G.UM;
  b.dmg *= m.dm;
  b.kb *= m.kb;
  if (m.wd > 0) b.wd = (b.wd === undefined ? 1 : b.wd) + m.wd;
  b.r *= m.r;
  b.vx *= m.v;
  b.vy *= m.v;
  b.life *= m.life;
  if (b.l0) b.l0 *= m.life;
  if (m.xb) b.xb = 1;
  if (m.ch) b.ch = 1;
  if (m.bu) b.bu = 1;
  if (m.fr) b.fr = 1;
  if (m.fz4) b.fz4 = 1;
  if (m.lk) b.lk = 1;
  if (m.hm) b.hm = 1;
  if (m.bn > 0) b.bn = (b.bn || 0) + m.bn;
  if (m.cr > 0 && Math.random() < m.cr) {
    b.dmg *= m.cm;
    b.col = "#ffffff";
    b.r *= 1.4;
  }
}
export const ULN = [
    "連珠",
    "轟炸",
    "貫穿光束",
    "彈幕",
    "烈焰環",
    "隕石",
    "飛彈群",
    "雙環爆",
    "雷射掃射",
    "雙向火網",
    "地毯轟炸",
    "穿透風暴",
  ],
  ULT_OLD = {
    0() {
      const a = G.pl.aim;
      for (let k = 0; k < 12; k++) ub(a + (k - 5.5) * 0.05, 680, { dmg: 30 });
    },
    1() {
      const a = G.pl.aim;
      for (let k = 0; k < 40; k++)
        ub(a + (Math.random() - 0.5) * 2, 420 + Math.random() * 180, {
          dmg: 22,
          life: 0.55 / BS,
          r: 4,
          kb: 260,
        });
    },
    2() {
      ub(G.pl.aim, 1500, {
        dmg: 220,
        r: 14,
        life: 0.6 / BS,
        pierce: 1,
        wd: 3,
        kb: 900,
      });
    },
    3() {
      const a = G.pl.aim;
      for (let k = 0; k < 36; k++)
        ub(a + k * 0.4, 330 + (k % 6) * 35, {
          dmg: 16,
          r: 3.5,
          life: 0.9 / BS,
        });
    },
    4() {
      for (let k = 0; k < 24; k++)
        ub((k / 24) * TAU, 220, {
          dmg: 25,
          r: 7,
          life: 0.9 / BS,
          l0: 0.9 / BS,
          kb: 120,
          fl: 1,
        });
    },
    5() {
      const t = G.en
        .slice()
        .sort(
          (p, q) =>
            Math.hypot(p.x - G.pl.x, p.y - G.pl.y) -
            Math.hypot(q.x - G.pl.x, q.y - G.pl.y),
        )
        .slice(0, 6);
      if (!t.length)
        for (let k = 0; k < 6; k++)
          t.push({
            x: G.pl.x + Math.cos(k) * 120,
            y: G.pl.y + Math.sin(k) * 120,
          });
      for (const e of t)
        explode({
          x: e.x,
          y: e.y,
          ex: 90,
          dmg: 70,
          kb: 500,
          wd: 3,
          col: "#b45cff",
        });
    },
    6() {
      for (let k = 0; k < 16; k++)
        ub(Math.random() * TAU, 380, {
          dmg: 28,
          hm: 1,
          life: 2 / BS,
          r: 4,
        });
    },
    7() {
      for (let k = 0; k < 20; k++) {
        ub((k / 20) * TAU, 300, { dmg: 25 });
        ub(((k + 0.5) / 20) * TAU, 450, { dmg: 25 });
      }
    },
    8() {
      const a = G.pl.aim;
      for (let k = 0; k < 5; k++)
        ub(a + (k - 2) * 0.16, 1300, { dmg: 60, life: 0.45 / BS, r: 3 });
    },
    9() {
      const a = G.pl.aim;
      for (let k = 0; k < 12; k++) {
        ub(a + (k - 5.5) * 0.09, 600, { dmg: 24 });
        ub(a + Math.PI + (k - 5.5) * 0.09, 600, { dmg: 24 });
      }
    },
    10() {
      const a = G.pl.aim,
        c = Math.cos(a),
        s = Math.sin(a),
        L = ray(G.pl.x, G.pl.y, a, 450);
      for (let k = 0; k < 8; k++) {
        const d = 50 + k * 45;
        if (d < L)
          explode({
            x: G.pl.x + c * d,
            y: G.pl.y + s * d,
            ex: 70,
            dmg: 55,
            kb: 350,
            wd: 2,
            col: "#ffd23a",
          });
      }
    },
    11() {
      for (let k = 0; k < 24; k++)
        ub((k / 24) * TAU, 450, {
          dmg: 35,
          r: 4,
          pierce: 1,
          wd: 2,
          life: 1.3 / BS,
        });
    },
  };
// 功能：處理「ultT」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function ultT() {
  if (!G.AA) return null;
  const R = AIMR * (G.AA === 2 ? 3.4 : 2.6),
    ex = G.AA === 2 ? 0.7 : 0.35;
  let b = null,
    bs = 1e9;
  for (const e of G.en) {
    if (e.hp <= 0) continue;
    const D = Math.hypot(e.x - G.pl.x, e.y - G.pl.y);
    if (D > R * (isB(e) ? 1.3 : 1) + e.r) continue;
    const a = Math.atan2(e.y - G.pl.y, e.x - G.pl.x);
    if (
      angD(a, G.pl.aim) >
      Math.min(Math.atan2(e.r + 8, Math.max(D, 1)), 0.4) + ex
    )
      continue;
    const los = ray(G.pl.x, G.pl.y, a, D) >= D - e.r - 6,
      sc = D + (los ? 0 : 120) - (isB(e) ? 200 : 0);
    if (sc < bs) {
      bs = sc;
      b = e;
    }
  }
  return b;
}
// 施放 SUPER 大招：依目前武器查表執行，並清空蓄能
export function ult(ang, q) {
  if (fsm.state !== "play" || G.pl.ult < 100) return;
  G.UMANUAL = ang !== undefined;
  if (ang === undefined) {
    const t = ultT();
    if (t) {
      const lx = t.x + (t.mvx || 0) * 0.3,
        ly = t.y + (t.mvy || 0) * 0.3;
      ang = Math.atan2(ly - G.pl.y, lx - G.pl.x);
      G.pl.aim = ang;
      q = Math.max(0, Math.min(1, Math.hypot(lx - G.pl.x, ly - G.pl.y) / 330));
    }
  }
  G.pl.ult = 0;
  bus.emit(GameEvents.ULTIMATE_USED);
  G.UM = ultMods();
  const n0 = G.bl.length;
  (ULTS[WP[G.pl.w].id] || ultRing)(
    ang === undefined ? G.pl.aim : ang,
    q === undefined
      ? mouse.has
        ? Math.max(
            0,
            Math.min(
              1,
              Math.hypot(mouse.x / G.S + G.camx - G.pl.x, mouse.y / G.S + G.camy - G.pl.y) /
                330,
            ),
          )
        : 0.7
      : q,
  );
  for (let i = n0; i < G.bl.length; i++) if (G.bl[i].ult) applyUM(G.bl[i]);
  if (WP[G.pl.w].id !== 18) {
    if (WP[G.pl.w].id !== 18) {
      G.shake = 14;
      burst(G.pl.x, G.pl.y, "#ffe14a", 40, 320, 3, 0.7);
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

