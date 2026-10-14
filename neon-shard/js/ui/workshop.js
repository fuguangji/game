/** ui/workshop — 芯片工坊與訓練場改裝 */
import { G } from "../core/game-state.js";
import { CH, RC, RN, TW, chipApply, chipAvail, chipEl, chipWhere, modW, rollChip } from "../game/chips.js";
import { CC, SV, UL, save } from "../game/progress.js";
import { ALLW, WP } from "../game/weapons.js";
import { mkIcon } from "../icons.js";

// 功能：處理「trRebuild」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function trRebuild() {
  const id = WP[G.pl.w].id,
    m = modW(ALLW[id]);
  m.ms = Math.round(m.ms0 * (1 + 0.1 * UL("mag")));
  m.am = m.ms;
  WP[G.pl.w] = m;
}
// 功能：處理「trChip」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function trChip(i) {
  const id = WP[G.pl.w].id,
    a = (G.TM[id] || []).slice(),
    k = a.indexOf(i);
  if (k >= 0) a.splice(k, 1);
  else {
    a.push(i);
    if (a.length > 2) a.shift();
  }
  G.TM[id] = a;
  trRebuild();
}
// 功能：處理「trMark」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function trMark() {
  const id = WP[G.pl.w].id,
    k = id + ":" + (G.TM[id] || []).join(",");
  if (k === G.trK) return;
  G.trK = k;
  const on = G.TM[id] || [];
  document.querySelectorAll("#tr [data-chip]").forEach((b) => {
    const i = +b.dataset.chip;
    b.style.background = on.includes(i) ? RC[CH[i].r] + "55" : "#ffffff0d";
  });
}
// 功能：處理「wsR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function wsR(el) {
  el.innerHTML = "";
  const own = SV.own,
    dv = (c, h) => {
      const d = document.createElement("div");
      d.className = c;
      if (h !== undefined) d.innerHTML = h;
      return d;
    };
  if (G.MWI < 0 || !own.includes(G.MWI)) G.MWI = G.LO[0] !== undefined ? G.LO[0] : own[0];
  // 功能：取得指定武器的改裝資料。
  const gm = (i) => {
      const m = (SV.mods[i] || []).slice();
      while (m.length < 2) m.push(-1);
      return m;
    },
    has = (v) => CH[v] !== undefined && v >= 0,
    nextEmpty = (m) => (!has(m[0]) ? 0 : !has(m[1]) ? 1 : -1);
  const m = gm(G.MWI);
  if (G.SLI < 0 || G.SLI > 1) {
    const k = nextEmpty(m);
    G.SLI = k < 0 ? 0 : k;
  }
  el.append(dv("sec", "芯片改裝"));
  el.append(dv("hint", "① 選槍　② 選槽位　③ 點下方芯片安裝（顏色 = 稀有度）"));
  const wg = dv("chw");
  for (const i of own) {
    const mm = gm(i),
      b = dv("chp" + (i === G.MWI ? " on" : ""));
    b.style.setProperty("--wc", ALLW[i].c);
    b.append(mkIcon("ammo", ALLW[i].c, 16));
    const nm = document.createElement("span");
    nm.textContent = ALLW[i].n;
    b.append(nm);
    const pips = dv("pips");
    mm.forEach((ci) => {
      const p = document.createElement("i");
      if (has(ci)) {
        p.style.background = RC[CH[ci].r];
        p.style.borderColor = RC[CH[ci].r];
      }
      pips.append(p);
    });
    b.append(pips);
    if (G.LO.includes(i)) {
      const t = document.createElement("span");
      t.className = "ord";
      t.textContent = "出戰" + (G.LO.indexOf(i) + 1);
      b.append(t);
    }
    b.onclick = () => {
      G.MWI = i;
      G.SLI = -1;
      G.wsNote = "";
      window.upd();
    };
    wg.append(b);
  }
  el.append(wg);
  const sl = dv("chsl");
  for (let k = 0; k < 2; k++) {
    const ci = m[k],
      c = has(ci) ? CH[ci] : null,
      d = dv("chs" + (k === G.SLI ? " on" : "") + (c ? "" : " em"));
    d.style.setProperty("--rc", c ? RC[c.r] : "#6a7590");
    if (c) {
      d.append(dv("chn", k + 1));
      d.append(mkIcon("chip", c.c, 22));
      d.append(
        dv(
          "chb",
          `<b>${c.n}<span class="chr">${RN[c.r]}</span></b><small>${c.d}</small>`,
        ),
      );
      const x = document.createElement("button");
      x.className = "chx";
      x.textContent = "拆下";
      x.onclick = (ev) => {
        ev.stopPropagation();
        const q = gm(G.MWI);
        q[k] = -1;
        SV.mods[G.MWI] = q;
        G.SLI = k;
        G.wsNote = "";
        save();
        window.upd();
      };
      d.append(x);
    } else {
      d.append(dv("chn", k + 1));
      d.append(
        dv(
          "chb",
          `<b>槽位 ${k + 1}</b><small>${k === G.SLI ? "▶ 點下方芯片安裝到這裡" : "空槽 · 點此選取"}</small>`,
        ),
      );
    }
    d.onclick = () => {
      G.SLI = k;
      G.wsNote = "";
      window.upd();
    };
    sl.append(d);
  }
  el.append(sl);
  const base = ALLW[G.MWI],
    cur = chipApply(base, m.filter(has));
  // 功能：計算並顯示武器的屬性統計。
  const stat = (o) => {
    const pel = o.mine || o.web ? 1 : o.n1,
      crit = 1 + (o.cr || 0) * ((o.cm || 1) - 1),
      ms = Math.round(o.ms0 * (1 + 0.1 * UL("mag"))),
      shot = o.dmg * pel * crit * (1 + 0.06 * UL("dmg"));
    return {
      dmg: shot,
      rate: 1 / o.cd,
      ms,
      burst: shot * ms,
      dps: (shot * (1 + 0.08 * UL("reg"))) / o.rs,
    };
  };
  const sb = stat(base),
    sc = stat(cur),
    rows = [
      ["每次射擊傷害", "dmg", 1],
      ["射速（發/秒）", "rate", 1],
      ["彈匣", "ms", 0],
      ["整匣總傷害", "burst", 0],
      ["持續輸出（傷害/秒）", "dps", 1],
    ],
    st = dv("chst");
  for (const [nm, k, dp] of rows) {
    const a0 = sb[k],
      a1 = sc[k],
      pc = a0 > 0 ? (a1 / a0 - 1) * 100 : 0,
      f = (v) => (dp ? v.toFixed(v < 100 ? 1 : 0) : String(Math.round(v))),
      cl = Math.abs(pc) < 0.5 ? "" : pc > 0 ? " up" : " dn";
    st.append(
      dv("l", nm),
      dv("v", f(a0)),
      dv("v" + cl, (Math.abs(pc) < 0.5 ? "" : "→ ") + f(a1)),
      dv(
        "v" + cl,
        Math.abs(pc) < 0.5 ? "—" : (pc > 0 ? "+" : "") + Math.round(pc) + "%",
      ),
    );
  }
  el.append(st);
  if (G.wsNote) el.append(dv("hint warn", G.wsNote));
  const owned = CH.map((c, i) => i).filter((i) => SV.chips[i] > 0),
    total = Object.values(SV.chips).reduce((a, b) => a + b, 0);
  el.append(
    dv("sec", `芯片庫存 · ${total} 枚 · 圖鑑 ${owned.length}/${CH.length}`),
  );
  const lg = dv("chlg");
  RN.forEach((n, t) => {
    const sp = document.createElement("span");
    sp.style.color = RC[t];
    sp.textContent = "● " + n;
    lg.append(sp);
  });
  el.append(lg);
  if (!owned.length) {
    el.append(dv("hint", "還沒有芯片：打 Boss 或到商城買芯片包"));
    return;
  }
  for (let t = 4; t >= 0; t--) {
    const ids = owned.filter((i) => CH[i].r === t);
    if (!ids.length) continue;
    const hd = dv(
      "chg",
      `<b>${RN[t]}</b><small>${ids.length} / ${CH.filter((c) => c.r === t).length} 種</small>`,
    );
    hd.style.color = RC[t];
    el.append(hd);
    const g = dv("chgrid");
    ids.forEach((i) => {
      const av = chipAvail(i),
        tot = SV.chips[i],
        card = chipEl(i, {
          dim: av <= 0,
          on: m.includes(i),
          tag: "x" + av + (tot > av ? "/" + tot : ""),
          sub: av <= 0 ? "已裝備：" + chipWhere(i) : "",
        });
      card.onclick = () => {
        if (av <= 0) {
          G.wsNote =
            "「" +
            CH[i].n +
            "」已全部裝備中（" +
            chipWhere(i) +
            "），請先拆下。";
          window.upd();
          return;
        }
        const q = gm(G.MWI);
        q[G.SLI] = i;
        SV.mods[G.MWI] = q;
        const k = nextEmpty(q);
        if (k >= 0) G.SLI = k;
        G.wsNote = "";
        save();
        window.upd();
      };
      g.append(card);
    });
    el.append(g);
  }
}
// 功能：處理「csR」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function csR(el) {
  el.innerHTML = "";
  // 功能：建立角色或裝備比較介面中的數值列。
  const dv = (c, h) => {
    const d = document.createElement("div");
    d.className = c;
    if (h !== undefined) d.innerHTML = h;
    return d;
  };
  el.append(
    dv(
      "sec",
      "芯片包（晶核）· 持有芯片 " +
        Object.values(SV.chips).reduce((a, b) => a + b, 0),
    ),
  );
  const PK = [
      { n: "普通芯片包", cost: 30, k: 1, b: 0, g: 0 },
      { n: "精選芯片包", cost: 80, k: 3, b: 1, g: 0 },
      { n: "頂級芯片包", cost: 200, k: 3, b: 2, g: 1 },
    ],
    g = dv("chpk");
  for (const p of PK) {
    const o = TW[p.b],
      sum = o.reduce((a, x) => a + x, 0),
      d = dv(
        "chpack" + (SV.co < p.cost ? " dim" : ""),
        `<div class="top"><b>${p.n}</b><small>${p.k} 枚${p.g ? " · 保底 1 枚史詩以上" : ""}</small><em style="color:${CC.co}">${p.cost} 晶核</em></div><div class="odds">${o.map((v, t) => (v ? `<span style="color:${RC[t]}">${RN[t]} ${+((v / sum) * 100).toFixed(1)}%</span>` : "")).join("")}</div>`,
      );
    d.style.setProperty("--wc", CC.co);
    d.onclick = () => {
      if (SV.co < p.cost) return;
      SV.co -= p.cost;
      const got = [];
      for (let q = 0; q < p.k; q++) got.push(rollChip(p.b));
      if (p.g && !got.some((i) => CH[i].r >= 3))
        got[got.length - 1] = rollChip(p.b, 3);
      G.lastPk = [];
      for (const i of got) {
        G.lastPk.push({ i, nw: !(SV.chips[i] > 0) });
        SV.chips[i] = (SV.chips[i] || 0) + 1;
      }
      save();
      window.upd();
    };
    g.append(d);
  }
  el.append(g);
  if (G.lastPk) {
    el.append(dv("sec", "本次獲得"));
    const gr = dv("chgrid");
    G.lastPk.forEach((x) => gr.append(chipEl(x.i, { tag: x.nw ? "NEW" : "" })));
    el.append(gr);
  }
}

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.TM = {};
G.trK = "";
G.trHd = null;

G.MWI = -1;
G.lastPack = "";
}

