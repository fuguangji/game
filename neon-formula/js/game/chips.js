/** game/chips — 芯片資料與改裝運算 */
import { G } from "../core/game-state.js";
import { flash } from "./boss.js";
import { CC, SV, save } from "./progress.js";
import { ALLWEAPON, normalizeWeaponProperties } from "./weapons.js";
import { mkIcon } from "../icons.js";

export const CH = [
  {
    n: "增傷",
    c: "#ff5a5a",
    d: "傷害 +20%",
    w: 3,
    fn: (o) => {
      o.dmg *= 1.2;
    },
  },
  {
    n: "速射",
    c: "#ffd23a",
    d: "射擊間隔 -25%、回彈 -8%",
    w: 3,
    fn: (o) => {
      o.cd *= 0.75;
      o.rs *= 0.92;
    },
  },
  {
    n: "擴容",
    c: "#4dffd8",
    d: "彈匣 +50%",
    w: 3,
    fn: (o) => {
      o.ms0 = Math.round(o.ms0 * 1.5);
    },
  },
  {
    n: "精準",
    c: "#7ab8ff",
    d: "散射 -60%",
    w: 3,
    fn: (o) => {
      o.acc *= 0.4;
      o.mp *= 0.4;
      o.sp *= 0.5;
      o.rcg = (o.rcg || 0) * 0.4;
    },
  },
  {
    n: "重擊",
    c: "#ffb040",
    d: "擊退 x2.2",
    w: 3,
    fn: (o) => {
      o.kb *= 2.2;
    },
  },
  {
    n: "破牆",
    c: "#c9a0ff",
    d: "破牆 +1",
    w: 3,
    fn: (o) => {
      o.wd = (o.wd || 0) + 1;
    },
  },
  {
    n: "穿透",
    c: "#e0e0ff",
    d: "子彈穿透敵人",
    w: 2,
    fn: (o) => {
      o.pierce = 1;
    },
  },
  {
    n: "爆裂",
    c: "#ff7a3d",
    d: "命中小範圍爆炸（35% 傷害）",
    w: 2,
    fn: (o) => {
      o.xb = 1;
    },
  },
  {
    n: "連鎖",
    c: "#6aa8ff",
    d: "命中連鎖電擊",
    w: 2,
    fn: (o) => {
      o.ch = 1;
    },
  },
  {
    n: "追蹤",
    c: "#8dff7a",
    d: "子彈微幅偏向飛行路徑旁最近的敵人",
    w: 2,
    fn: (o) => {
      o.hm = 1;
    },
  },
  {
    n: "反彈",
    c: "#a0ffa0",
    d: "撞牆反彈 +2 次",
    w: 2,
    fn: (o) => {
      o.bn = (o.bn || 0) + 2;
    },
  },
  {
    n: "燃燒",
    c: "#ff5a2a",
    d: "命中後持續燃燒",
    w: 1,
    fn: (o) => {
      o.bu = 1;
    },
  },
  {
    n: "冰霜",
    c: "#7af0ff",
    d: "命中減速敵人",
    w: 1,
    fn: (o) => {
      o.fr = 1;
    },
  },
  {
    n: "吸血",
    c: "#ff4d9a",
    d: "命中回血（傷害 2.5%，每發最多 2）",
    w: 1,
    fn: (o) => {
      o.lk = 1;
    },
  },
];

export const RC = ["#b8c4d0", "#4dff88", "#4d9bff", "#c060ff", "#ffb020"],
  RN = ["普通", "優良", "稀有", "史詩", "傳說"];
// 功能：處理「spl」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
const spl = (o, k, f) => {
  if (o.mine || o.web || o.gren || o.tox) {
    o.r *= 1 + 0.12 * k;
    return;
  }
  if (o.slash) {
    o.rg *= 1 + 0.08 * k;
    return;
  }
  const n = o.n1;
  o.n1 = n + k;
  o.dmg *= (n / (n + k)) * f;
  if (o.n1 > 1 && o.sp < 0.1 + 0.03 * k) o.sp = 0.1 + 0.03 * k;
};
export const TW = [
  [56, 28, 11, 4.2, 0.8],
  [24, 36, 26, 11, 3],
  [0, 30, 42, 22, 6],
];
// 功能：依機率與稀有度抽取芯片。
export function rollChip(b, mt) {
  const w = (TW[+b || 0] || TW[0]).slice();
  for (let t = 0; t < (mt || 0); t++) w[t] = 0;
  let r = Math.random() * w.reduce((a, x) => a + x, 0),
    t = 0;
  for (; t < 4; t++) {
    r -= w[t];
    if (r <= 0) break;
  }
  const pool = [];
  CH.forEach((c, i) => {
    if (c.r === t) pool.push(i);
  });
  return pool[Math.floor(Math.random() * pool.length)];
}
// 功能：處理「chipEl」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chipEl(i, o) {
  o = o || {};
  const c = CH[i],
    d = document.createElement("div");
  d.className = "chc r" + c.r + (o.on ? " on" : "") + (o.dim ? " dim" : "");
  d.style.setProperty("--rc", RC[c.r]);
  d.append(mkIcon("chip", c.c, 22));
  const t = document.createElement("div");
  t.className = "chb";
  t.innerHTML =
    `<b>${c.n}<span class="chr">${RN[c.r]}</span></b><small>${c.d}</small>` +
    (o.sub ? `<small class="chsub">${o.sub}</small>` : "");
  d.append(t);
  if (o.tag) {
    const e = document.createElement("em");
    e.textContent = o.tag;
    d.append(e);
  }
  return d;
}
// 功能：處理「chipToast」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chipToast(i) {
  const c = CH[i];
  let el = document.getElementById("cts");
  if (!el) {
    el = document.createElement("div");
    el.id = "cts";
    document.body.append(el);
  }
  const e = document.createElement("div");
  e.className = "chtoast";
  e.style.setProperty("--rc", RC[c.r]);
  e.textContent = "獲得 [" + RN[c.r] + "] " + c.n;
  el.append(e);
  setTimeout(() => e.remove(), 2700);
  while (el.children.length > 3) el.firstChild.remove();
  if (c.r >= 3)
    try {
      flash(RC[c.r], 0.22, 0.3);
    } catch (x) {}
}
// 功能：處理「chipSum」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chipSum() {
  if (!G.chp.length) return "";
  const n = [0, 0, 0, 0, 0];
  G.chp.forEach((i) => {
    n[CH[i].r]++;
  });
  return (
    "（" +
    n
      .map((v, t) => (v ? RN[t] + " " + v : ""))
      .filter(Boolean)
      .reverse()
      .join(" · ") +
    "）"
  );
}
// 功能：處理「chipWhere」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chipWhere(i) {
  return Object.keys(SV.mods)
    .filter((k) => (SV.mods[k] || []).includes(i))
    .map((k) => (ALLWEAPON.getWeapon()[+k] ? ALLWEAPON.getWeapon()[+k].n : ""))
    .filter(Boolean)
    .join("、");
}
// 功能：將芯片效果合併至武器數值。
export function chipApply(w, list) {
  const o = normalizeWeaponProperties(Object.assign({}, w));
  for (const c of list) if (CH[c]) CH[c].fn(o);
  const e = (o.dmg * o.n1) / (w.dmg * w.n1 || 1);
  if (e > 2) o.dmg *= (2 + (e - 2) * 0.5) / e;
  if (o.cr > 0.6) o.cr = 0.6;
  return o;
}
// 功能：處理「modW」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function modW(w) {
  const o = chipApply(w, (G.train ? G.TM : SV.mods)[w.id] || []);
  if (o.bm) o.ms0 = 1;
  return o;
}

// 功能：處理「chipAvail」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chipAvail(i) {
  let u = 0;
  for (const k in SV.mods) for (const c of SV.mods[k]) if (c === i) u++;
  return (SV.chips[i] || 0) - u;
}
export const CHS = [
  {
    n: "游擊者",
    c: "#22e6ff",
    hp: 0,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 0,
    d: "均衡型，沒有弱點",
  },
  {
    n: "重裝兵",
    c: "#ffb040",
    hp: 50,
    Lspd: -3.75,
    dr: 0.85,
    sc: 1,
    kh: 0,
    p: 900,
    d: "血量 +50、受到傷害 -15%，移動 -15%",
  },
  {
    n: "疾風",
    c: "#9dff3d",
    hp: -20,
    Lspd: 6.25,
    Ldsh: 5,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 900,
    d: "移動 +25%、衝刺冷卻 -30%，血量 -20",
  },
  {
    n: "工程師",
    c: "#7ab8ff",
    hp: 0,
    Lreg: 4,
    Lmag: 2.5,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 1100,
    d: "彈藥回復 +32%、彈匣 +25%",
  },
  {
    n: "刺客",
    c: "#ff5a5a",
    hp: -15,
    Lspd: 2,
    Ldsh: 1.7,
    Ldmg: 4.2,
    dr: 1,
    sc: 1,
    kh: 0,
    p: 1300,
    d: "傷害 +25%、移動 +8%，血量 -15",
  },
  {
    n: "術士",
    c: "#d070ff",
    hp: 0,
    Ldmg: 1.3,
    dr: 1,
    sc: 1.6,
    kh: 3,
    p: 1600,
    d: "大招充能 +60%、擊殺回復 3 血量",
  },
];
// 功能：處理「chR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function chR(el) {
  el.innerHTML = "";
  const h = document.createElement("div");
  h.className = "sec";
  h.textContent = "腳色";
  el.append(h);
  const g = document.createElement("div");
  g.className = "grid";
  CHS.forEach((c, i) => {
    const own = SV.chars.includes(i),
      b = document.createElement("div");
    b.className = "it wb" + (SV.char === i ? " s" : "");
    b.style.setProperty("--wc", c.c);
    b.style.opacity = own ? 1 : 0.6;
    b.innerHTML = `<span><b>${c.n}</b> <small>${c.d}</small></span><em style="color:${own ? c.c : CC.coins}">${SV.char === i ? "出戰中" : own ? "選擇" : c.p + " 金幣"}</em>`;
    b.onclick = () => {
      if (own) SV.char = i;
      else if (SV.coins >= c.p) {
        SV.coins -= c.p;
        SV.chars.push(i);
        SV.char = i;
      } else return;
      save();
      window.upd();
    };
    g.append(b);
  });
  el.append(g);
}
// 功能：處理「bankChips」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function bankChips() {
  for (const c of G.chp) SV.chips[c] = (SV.chips[c] || 0) + 1;
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

[0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2].forEach((r, i) => {
  CH[i].r = r;
});

CH.push(
  {
    n: "迅彈",
    c: "#9fe8ff",
    r: 0,
    d: "子彈速度 +25%",
    fn: (o) => {
      o.v *= 1.25;
    },
  },
  {
    n: "長程",
    c: "#9fffb0",
    r: 0,
    d: "射程 +35%",
    fn: (o) => {
      o.life *= 1.35;
    },
  },
  {
    n: "補給",
    c: "#ffe9a0",
    r: 0,
    d: "彈藥回復 +18%",
    fn: (o) => {
      o.rs *= 0.85;
    },
  },
  {
    n: "分裂",
    c: "#8ff0ff",
    r: 1,
    d: "多 1 發子彈，總傷害 -15%（無彈體武器改為範圍 +12%）",
    fn: (o) => spl(o, 1, 0.85),
  },
  {
    n: "巨彈",
    c: "#ffb27a",
    r: 1,
    d: "子彈變大 50%、傷害 +15%、擊退 +20%",
    fn: (o) => {
      o.r *= 1.5;
      o.dmg *= 1.15;
      o.kb *= 1.2;
    },
  },
  {
    n: "暴擊",
    c: "#ff8a8a",
    r: 2,
    d: "30% 機率造成 2.5 倍傷害（白色子彈）",
    fn: (o) => {
      o.cr = (o.cr || 0) + 0.3;
      o.cm = Math.max(o.cm || 0, 2.5);
    },
  },
  {
    n: "重裝",
    c: "#ffb040",
    r: 2,
    d: "傷害 +45%、彈匣 -30%",
    fn: (o) => {
      o.dmg *= 1.45;
      o.ms0 = Math.max(1, Math.round(o.ms0 * 0.7));
    },
  },
  {
    n: "彈幕",
    c: "#7ab8ff",
    r: 2,
    d: "多 2 發子彈，總傷害 -25%（無彈體武器改為範圍 +24%）",
    fn: (o) => spl(o, 2, 0.75),
  },
  {
    n: "狂暴",
    c: "#ff4d4d",
    r: 3,
    d: "傷害 +55%、射擊間隔 -15%",
    fn: (o) => {
      o.dmg *= 1.55;
      o.cd *= 0.85;
    },
  },
  {
    n: "滿載",
    c: "#4dffd8",
    r: 3,
    d: "彈匣 x2、彈藥回復 +33%",
    fn: (o) => {
      o.ms0 = Math.round(o.ms0 * 2);
      o.rs *= 0.75;
    },
  },
  {
    n: "雷霆",
    c: "#ffe14a",
    r: 3,
    d: "連鎖電擊 + 小範圍爆炸，傷害 +10%",
    fn: (o) => {
      o.ch = 1;
      o.xb = 1;
      o.dmg *= 1.1;
    },
  },
  {
    n: "烈焰風暴",
    c: "#ff6a2a",
    r: 3,
    d: "穿透敵人並點燃，傷害 +10%",
    fn: (o) => {
      o.pierce = 1;
      o.bu = 1;
      o.dmg *= 1.1;
    },
  },
  {
    n: "極寒領域",
    c: "#7af0ff",
    r: 3,
    d: "命中減速，連續 6 發凍結敵人，傷害 +10%",
    fn: (o) => {
      o.fr = 1;
      o.fz4 = 1;
      o.dmg *= 1.1;
    },
  },
  {
    n: "毀滅者",
    c: "#ff3d6a",
    r: 4,
    d: "傷害 +45%、穿透、爆炸、破牆 +1、擊退 +50%，彈匣 -20%",
    fn: (o) => {
      o.dmg *= 1.45;
      o.pierce = 1;
      o.xb = 1;
      o.wd = (o.wd || 0) + 1;
      o.kb *= 1.5;
      o.ms0 = Math.max(1, Math.round(o.ms0 * 0.8));
    },
  },
  {
    n: "永動",
    c: "#4dffa0",
    r: 4,
    d: "彈匣 x2、彈藥回復 +67%、射擊間隔 -15%",
    fn: (o) => {
      o.ms0 = Math.round(o.ms0 * 2);
      o.rs *= 0.6;
      o.cd *= 0.85;
    },
  },
  {
    n: "天罰",
    c: "#fff070",
    r: 4,
    d: "28% 暴擊，暴擊造成 3.5 倍傷害（白色子彈）",
    fn: (o) => {
      o.cr = (o.cr || 0) + 0.28;
      o.cm = Math.max(o.cm || 0, 3.5);
    },
  },
  {
    n: "混沌",
    c: "#d070ff",
    r: 4,
    d: "追蹤、穿透、撞牆反彈 +3 次，傷害 +30%",
    fn: (o) => {
      o.hm = 1;
      o.pierce = 1;
      o.bn = (o.bn || 0) + 3;
      o.dmg *= 1.3;
    },
  },
);

G.SLI = -1;
G.wsNote = "";
G.lastPk = null;

G.CHR = CHS[0];
}

