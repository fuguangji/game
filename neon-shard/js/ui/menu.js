/** ui/menu — 主頁、備戰、背包、關卡、商城、圖鑑 */
import { accountService } from "../account/index.js";
import { escapeHtml } from "../core/dom-utils.js";
import { G } from "../core/game-state.js";
import { fsOK, toggleFS } from "../core/input.js";
import { KEYS, store } from "../core/save-store.js";
import { $ } from "../core/viewport.js";
import { ELITE } from "../enemy-config.js";
import { LEG_A, LEG_B, PC } from "../game-config.js";
import { BN } from "../game/boss.js";
import { CH, CHS, RC, RN, TW, chipApply, chipAvail, chipSum, chipWhere, modW, rollChip } from "../game/chips.js";
import { EN, ITK, ITM, buyW, ucost } from "../game/pickups.js";
import { CC, CN, ST, STG, SV, UC, UL, UPD, WPC, WPR, save } from "../game/progress.js";
import { rdOpen } from "../game/redeem.js";
import { startTrain } from "../game/training.js";
import { startTutorial } from "../game/tutorial.js";
import { ALLW, WD } from "../game/weapons.js";
import { mkEIcon, mkIcon } from "../icons.js";
import { xAccount } from "./account.js";
import { start } from "./render.js";

/* ===== NEON SHARD · 新版選單（資料與工具） ===== */
const XCAT = [
  ["精準", [0, 2, 8, 11]],
  ["速射", [3, 9, 12, 13]],
  ["近距", [1, 4, 22]],
  ["爆破", [5, 7, 10, 23]],
  ["控場", [16, 17, 18, 19]],
  ["特殊", [6, 14, 15, 20, 21]],
];
// 功能：取得指定武器的分類名稱與武器索引。
const wCat = (i) => {
  for (const c of XCAT) if (c[1].includes(i)) return c[0];
  return "其他";
};
// 功能：取得武器描述中的模式欄位。
const wMode = (i) => (WD[i] || "").split("·")[0];
// 功能：取得武器描述中的補充說明。
const wNote = (i) => (WD[i] || "").split("·").slice(1).join("·");
export const XS = {
  t: "h",
  lc: "全部",
  ws: 0,
  sl: 0,
  sh: "up",
  sc: "全部",
  rf: -1,
  cx: "i",
  over: 0,
  fresh: 0,
};
const CI = { coins: "coin", sh: "shard", co: "core" };
// 功能：建立介面標題或區塊標籤。
export const xh = (c, t, tag) => {
  const d = document.createElement(tag || "div");
  if (c) d.className = c;
  if (t !== undefined) d.innerHTML = t;
  return d;
};
// 功能：建立帶有文字與點擊回呼的介面按鈕。
export const xbt = (c, t, f, dis) => {
  const b = xh(c, t, "button");
  b.type = "button";
  if (f) b.onclick = f;
  if (dis) b.disabled = true;
  return b;
};
// 功能：建立指定類型的介面圖示。
export const xic = (t, c, s) => {
  const w = xh("x-ic");
  w.append(mkIcon(t, c, s || 24));
  return w;
};
// 功能：保存目前選定的武器配置。
const xSaveLO = () => {
  store.setJSON(KEYS.loadout, G.LO);
};
// 功能：切換至指定介面分頁或遊戲狀態。
export const xGo = (t) => {
  if (t !== XS.t) {
    XS.t = t;
    XS.fresh = 1;
  }
  window.upd();
};
// 功能：更新指定介面欄位的內容。
const xSub = (k, v) => {
  XS[k] = v;
  XS.fresh = 1;
  window.upd();
};
// 功能：依目前篩選條件整理清單並建立篩選介面。
const xFlt = (list, cur, fn) => {
  const f = xh("x-flt");
  for (const n of list)
    f.append(xbt("x-f" + (cur === n ? " on" : ""), n, () => fn(n)));
  return f;
};
// 功能：計算武器的傷害、射速、彈速與每秒傷害等數值。
const wStat = (o) => {
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
// 功能：本行宣告多個相關輔助函式；「xmax」及同列工具供後續邏輯共用。
const xmax = () =>
  G.XM ||
  (G.XM = (() => {
    const a = ALLW.map((w) => wStat(w)),
      mx = (k) => Math.max(...a.map((s) => s[k])) || 1;
    return {
      dmg: mx("dmg"),
      rate: mx("rate"),
      ms: mx("ms"),
      dps: mx("dps"),
    };
  })());
// 功能：依顯示需求格式化數值與小數位數。
const xfmt = (v, dp) =>
  dp ? v.toFixed(v < 100 ? 1 : 0) : String(Math.round(v));
// 功能：處理介面系統「xEquip」相關的資料、互動或顯示。
export function xEquip(i, sl) {
  const a = G.LO.slice(),
    o = a.indexOf(i);
  if (o >= 0) {
    if (sl >= a.length) {
      a.splice(o, 1);
      a.push(i);
    } else [a[o], a[sl]] = [a[sl], a[o]];
  } else {
    if (sl >= a.length) a.push(i);
    else a[sl] = i;
  }
  G.LO = a;
  xSaveLO();
  window.upd();
}
// 功能：處理介面系統「xUnequip」相關的資料、互動或顯示。
export function xUnequip(i) {
  if (G.LO.length < 2) return;
  G.LO = G.LO.filter((x) => x !== i);
  if (XS.sl >= G.LO.length) XS.sl = G.LO.length - 1;
  xSaveLO();
  window.upd();
}
// 功能：建立介面側欄內容或操作項目。
const xSide = (c, f) => {
  const s = xh("x-side"),
    i = xh("x-sc");
  i.dataset.sc = "r";
  i.append(...c);
  s.append(i);
  if (f) s.append(f);
  return s;
};
// 功能：加總目前已裝備或持有的芯片數量。
const xChipTotal = () => Object.values(SV.chips).reduce((a, b) => a + b, 0);

// 功能：處理介面系統「xEmb」相關的資料、互動或顯示。
export function xEmb() {
  // 功能：繪製指定邊數與半徑的多邊形。
  const poly = (x, y, n, r, off) => {
    const o = [];
    for (let k = 0; k < n; k++) {
      const a = ((off + (360 / n) * k) * Math.PI) / 180;
      o.push(
        (x + r * Math.cos(a)).toFixed(1) +
          "," +
          (y + r * Math.sin(a)).toFixed(1),
      );
    }
    return o.join(" ");
  };
  const L = [
    ["p", 12, 22, 6, 80, -90, "#ff3d9a", 1.8, 90, 1],
    ["p", 182, 52, 4, 48, -45, "#ffd23a", 1.8, 70, -1],
    ["p", 178, 186, 3, 66, -90, "#9dff3d", 1.8, 80, 1],
    ["c", 22, 178, 42, "#22e6ff", 1.6, "3 7", 100, -1],
    ["p", 96, 190, 4, 12, -90, "#ff9a3d", 1.8, 20, -1],
  ];
  let g = "";
  for (const l of L) {
    const st = `transform-origin:${l[1]}px ${l[2]}px;`;
    if (l[0] === "c")
      g += `<g class="xg" style="${st}--d:${l[7]}s;--r:${l[8] > 0 ? "normal" : "reverse"}"><circle cx="${l[1]}" cy="${l[2]}" r="${l[3]}" fill="none" stroke="${l[4]}" stroke-width="${l[5]}" stroke-dasharray="${l[6]}" stroke-linecap="round"/></g>`;
    else
      g += `<g class="xg" style="${st}--d:${l[8]}s;--r:${l[9] > 0 ? "normal" : "reverse"}"><polygon points="${poly(l[1], l[2], l[3], l[4], l[5])}" fill="none" stroke="${l[6]}" stroke-width="${l[7]}" stroke-linejoin="round"/></g>`;
  }
  return `<svg class="x-emb" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${g}</svg>`;
}
/* ---------- 大廳 ---------- */
export function xLobby(v) {
  const st = ST(),
    ch = CHS[SV.char] || CHS[0],
    cl = SV.clr.filter(Boolean).length;
  const cols = [0, 1, 2].map((k) =>
    G.LO[k] !== undefined ? ALLW[G.LO[k]].c : "#3a4573",
  );
  const pt = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return [
      (100 + 88 * Math.cos(a)).toFixed(1),
      (100 + 88 * Math.sin(a)).toFixed(1),
    ];
  });
  let fc = "";
  for (let k = 0; k < 6; k++) {
    const p = pt[k],
      q = pt[(k + 1) % 6],
      c = cols[k % 3];
    fc += `<polygon points="100,100 ${p.join(",")} ${q.join(",")}" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/>`;
  }
  const hero = xh(
    "x-pn x-hero",
    `${xEmb()}<div class="x-wm">NEON SHARD</div><div class="x-tag">霓虹幾何，瞄準與閃避</div><div class="x-hs"><span><b>${G.best}</b>最高分</span><span><b>${cl}/8</b>關卡通關</span><span><b>${SV.own.length}/${ALLW.length}</b>槍械解鎖</span></div>`,
  );
  const lst = xh("x-pair");
  const r1 = xbt(
    "x-cd",
    `<span class="x-tx"><small>關卡</small><b>${st.n}</b><small style="color:${st.c}">${st.g ? "目標 " + st.g + " 波" : "無盡模式"}</small></span>`,
    () => xGo("k"),
  );
  r1.style.setProperty("--a", st.c);
  const r2 = xbt(
    "x-cd",
    `<span class="x-tx"><small>角色</small><b>${ch.n}</b><small>${ch.d}</small></span>`,
    () => xGo("b"),
  );
  r2.style.setProperty("--a", ch.c);
  lst.append(r1, r2);
  const sl = xh("x-slots");
  for (let k = 0; k < 3; k++) {
    const i = G.LO[k],
      w = i !== undefined ? ALLW[i] : null,
      d = xbt("x-sl" + (w ? "" : " em"), "", () => {
        XS.sl = k;
        if (w) XS.ws = i;
        xGo("b");
      });
    d.style.setProperty("--a", w ? w.c : "#4a5688");
    d.append(xh("n", String(k + 1)));
    if (w) {
      d.append(xic("ammo", w.c, 26), xh("", "<b>" + w.n + "</b>"));
    } else d.append(xh("", "<small>空槽</small>"));
    sl.append(d);
  }
  const go = xbt(
    "x-btn pri blk x-big",
    XS.over ? "再次出戰" : "開始戰鬥",
    start,
  );
  const two = xh("x-two");
  two.style.marginTop = "0";
  two.style.gridTemplateColumns = "1fr 1fr 1fr";
  two.append(
    xbt("x-btn", "教學模式", startTutorial),
    xbt("x-btn", "訓練場", startTrain),
    xbt("x-btn", "兌換碼", rdOpen),
  );
  const foot = xh("x-foot");
  foot.append(go, two);
  const side = xSide(
    [
      xh("x-h", "本次出戰"),
      lst,
      xh("x-h", "出戰槍械<small>點選前往備戰調整</small>"),
      sl,
    ],
    foot,
  );
  const w = xh("x-split");
  w.append(hero, side);
  v.append(w);
}

/* ---------- 備戰 ---------- */
export function xLoad(v) {
  const own = SV.own;
  if (!ALLW[XS.ws]) XS.ws = G.LO[0] || 0;
  if (XS.sl > 2 || XS.sl < 0) XS.sl = 0;
  const L = xh("x-sc");
  L.dataset.sc = "l";
  L.append(xh("x-h", "角色"));
  const cg = xh("x-chr");
  CHS.forEach((c, i) => {
    const ow = SV.chars.includes(i),
      on = SV.char === i;
    const d = xbt(
      "x-cd" + (on ? " on" : "") + (ow ? "" : " lk"),
      `<b>${c.n}</b><small>${c.d}</small><span class="rt">${on ? "出戰中" : ow ? "選擇" : "未解鎖"}</span>`,
      () => {
        if (ow) {
          SV.char = i;
          save();
          window.upd();
        } else {
          XS.sh = "ch";
          xGo("m");
        }
      },
    );
    d.style.setProperty("--a", c.c);
    cg.append(d);
  });
  L.append(
    cg,
    xh("x-h", "出戰槍械<small>先選槍位，再從槍械庫選槍裝入</small>"),
  );
  const sl = xh("x-slots");
  for (let k = 0; k < 3; k++) {
    const i = G.LO[k],
      w = i !== undefined ? ALLW[i] : null,
      d = xbt(
        "x-sl" + (w ? "" : " em") + (k === XS.sl ? " on" : ""),
        "",
        () => {
          XS.sl = k;
          if (w) XS.ws = i;
          window.upd();
        },
      );
    d.style.setProperty("--a", w ? w.c : "#4a5688");
    d.append(xh("n", String(k + 1)));
    if (w) d.append(xic("ammo", w.c, 26), xh("", "<b>" + w.n + "</b>"));
    else d.append(xh("", "<small>空槽</small>"));
    sl.append(d);
  }
  L.append(
    sl,
    xh("x-h", `槍械庫<small>${own.length} / ${ALLW.length} 已解鎖</small>`),
  );
  L.append(
    xFlt(["全部", "已擁有", "未解鎖", ...XCAT.map((c) => c[0])], XS.lc, (n) =>
      xSub("lc", n),
    ),
  );
  const wg = xh("x-grid"),
    isCat = XCAT.some((c) => c[0] === XS.lc);
  ALLW.forEach((w, i) => {
    const ow = own.includes(i),
      k = G.LO.indexOf(i);
    if (XS.lc === "已擁有" && !ow) return;
    if (XS.lc === "未解鎖" && ow) return;
    if (isCat && wCat(i) !== XS.lc) return;
    const d = xbt(
      "x-cd" + (XS.ws === i ? " on" : "") + (ow ? "" : " lk"),
      "",
      () => {
        XS.ws = i;
        window.upd();
      },
    );
    d.style.setProperty("--a", w.c);
    d.append(
      xic("ammo", w.c, 26),
      xh("x-tx", `<b>${w.n}</b><small>${wCat(i)} · ${wMode(i)}</small>`),
      xh(
        "rt",
        k >= 0
          ? `<span style="color:var(--c)">出戰 ${k + 1}</span>`
          : ow
            ? ""
            : `<span style="color:${CC[WPC[i]]}">${WPR[i]} 金幣</span>`,
      ),
    );
    wg.append(d);
  });
  if (!wg.children.length) wg.append(xh("x-empty", "沒有符合條件的槍械"));
  L.append(wg);
  const i = XS.ws,
    w = ALLW[i],
    ow = own.includes(i),
    k = G.LO.indexOf(i),
    s = wStat(modW(w)),
    M = xmax();
  const dt = xh("x-pn x-dt");
  dt.style.setProperty("--a", w.c);
  const hd = xh("x-dh");
  hd.append(
    xic("ammo", w.c, 40),
    xh(
      "x-tx",
      `<span class="big">${w.n}</span><small>${wCat(i)} · ${wMode(i)}${k >= 0 ? " · 出戰 " + (k + 1) + " 號位" : ""}</small>`,
    ),
  );
  dt.append(hd, xh("x-ds", wNote(i) || WD[i] || ""));
  const sb = xh("x-sb");
  for (const [n, key, dp] of [
    ["單發傷害", "dmg", 1],
    ["射速", "rate", 1],
    ["彈匣", "ms", 0],
    ["持續輸出", "dps", 1],
  ])
    sb.append(
      xh("l", n),
      xh(
        "x-bar",
        `<i style="width:${Math.max(3, Math.min(100, (s[key] / M[key]) * 100))}%"></i>`,
      ),
      xh("v", xfmt(s[key], dp)),
    );
  dt.append(sb);
  const m = (SV.mods[i] || []).filter((c) => CH[c] !== undefined && c >= 0);
  dt.append(xh("x-h", "已裝芯片"));
  dt.append(
    xh(
      "x-ds",
      m.length
        ? m
            .map((c) => `<span style="color:${RC[CH[c].r]}">${CH[c].n}</span>`)
            .join("、")
        : "尚未安裝芯片",
    ),
  );
  const ac = xh("x-foot");
  if (!ow) {
    const can = SV[WPC[i]] >= WPR[i];
    ac.append(
      xbt("x-btn gld blk", `解鎖 · ${WPR[i]} 金幣`, () => buyW(i), !can),
    );
    if (!can) ac.append(xh("x-hint", `還差 ${WPR[i] - SV[WPC[i]]} 金幣`));
  } else {
    if (k < 0)
      ac.append(
        xbt("x-btn pri blk", `裝入 ${XS.sl + 1} 號位`, () => xEquip(i, XS.sl)),
      );
    else {
      if (k !== XS.sl)
        ac.append(
          xbt("x-btn pri blk", `移到 ${XS.sl + 1} 號位`, () =>
            xEquip(i, XS.sl),
          ),
        );
      ac.append(xbt("x-btn blk", "移出出戰", () => xUnequip(i), G.LO.length < 2));
    }
    ac.append(
      xbt("x-btn blk", "前往改裝芯片", () => {
        G.MWI = i;
        G.SLI = -1;
        G.wsNote = "";
        xGo("i");
      }),
    );
  }
  const R = xSide([dt], ac);
  const wr = xh("x-split sd");
  wr.append(L, R);
  v.append(wr);
}

/* ---------- 背包（芯片改裝與庫存） ---------- */
export function xBag(v) {
  const own = SV.own,
    has = (c) => c !== undefined && c >= 0 && CH[c] !== undefined,
    gm = (i) => {
      const m = (SV.mods[i] || []).slice();
      while (m.length < 2) m.push(-1);
      return m;
    },
    ne = (m) => (!has(m[0]) ? 0 : !has(m[1]) ? 1 : -1);
  if (G.MWI < 0 || !own.includes(G.MWI)) G.MWI = G.LO[0] !== undefined ? G.LO[0] : own[0];
  const m = gm(G.MWI);
  if (G.SLI < 0 || G.SLI > 1) {
    const k = ne(m);
    G.SLI = k < 0 ? 0 : k;
  }
  const L = xh("x-sc");
  L.dataset.sc = "l";
  L.append(xh("x-h", "改裝台<small>選槍，選槽位，再點右側芯片</small>"));
  const wl = xh("x-wrap");
  for (const i of own) {
    const mm = gm(i),
      b = xbt("x-wb" + (i === G.MWI ? " on" : ""), "", () => {
        G.MWI = i;
        G.SLI = -1;
        G.wsNote = "";
        window.upd();
      });
    b.style.setProperty("--a", ALLW[i].c);
    b.append(mkIcon("ammo", i === G.MWI ? "#06101a" : ALLW[i].c, 16));
    b.insertAdjacentHTML(
      "beforeend",
      `<span>${ALLW[i].n}</span><span class="x-pp">${mm.map((c) => `<i class="${has(c) ? "f" : ""}" style="${has(c) ? "--p:" + RC[CH[c].r] : ""}"></i>`).join("")}</span>${G.LO.includes(i) ? `<em>${G.LO.indexOf(i) + 1}</em>` : ""}`,
    );
    wl.append(b);
  }
  L.append(wl, xh("x-h", `槽位<small>${ALLW[G.MWI].n}</small>`));
  const sg = xh("x-lst");
  for (let k = 0; k < 2; k++) {
    const ci = m[k],
      c = has(ci) ? CH[ci] : null,
      d = xh("x-cd" + (k === G.SLI ? " on" : ""));
    d.tabIndex = 0;
    d.setAttribute("role", "button");
    d.style.setProperty("--a", c ? RC[c.r] : "#4a5688");
    d.append(xh("x-no", String(k + 1)));
    if (c) {
      d.append(
        xic("chip", c.c, 24),
        xh(
          "x-tx",
          `<b>${c.n}<span class="x-tg">${RN[c.r]}</span></b><small>${c.d}</small>`,
        ),
        xbt("x-btn sm", "拆下", (ev) => {
          ev.stopPropagation();
          const q = gm(G.MWI);
          q[k] = -1;
          SV.mods[G.MWI] = q;
          G.SLI = k;
          G.wsNote = "";
          save();
          window.upd();
        }),
      );
    } else
      d.append(
        xh(
          "x-tx",
          `<b>槽位 ${k + 1}</b><small>${k === G.SLI ? "請點右側芯片安裝到這裡" : "空槽，點此選取"}</small>`,
        ),
      );
    d.onclick = () => {
      G.SLI = k;
      G.wsNote = "";
      window.upd();
    };
    sg.append(d);
  }
  const base = ALLW[G.MWI],
    cur = chipApply(base, m.filter(has)),
    sb = wStat(base),
    sc = wStat(cur),
    st = xh("x-cmp");
  for (const [nm, k, dp] of [
    ["單發傷害", "dmg", 1],
    ["射速（發／秒）", "rate", 1],
    ["彈匣", "ms", 0],
    ["整匣總傷害", "burst", 0],
    ["持續輸出（傷害／秒）", "dps", 1],
  ]) {
    const a0 = sb[k],
      a1 = sc[k],
      pc = a0 > 0 ? (a1 / a0 - 1) * 100 : 0,
      cl = Math.abs(pc) < 0.5 ? "" : pc > 0 ? " up" : " dn";
    st.append(
      xh("l", nm),
      xh("v", xfmt(a0, dp)),
      xh("v" + cl, (cl ? "→ " : "") + xfmt(a1, dp)),
      xh("v" + cl, cl ? (pc > 0 ? "+" : "") + Math.round(pc) + "%" : "—"),
    );
  }
  L.append(sg, xh("x-h", "效果對比<small>改裝前 → 改裝後</small>"), st);
  if (G.wsNote) L.append(xh("x-note", G.wsNote));
  const R = xh("x-sc");
  R.dataset.sc = "r";
  R.append(
    xh("x-h", "消耗品<small>最多帶 3 種 · 局內按 4／5／6 或點道具欄</small>"),
  );
  {
    const l = xh("x-lst");
    for (const k of ITK) {
      const t = ITM[k],
        n = SV.items[k] || 0,
        on = (SV.bagSel || []).includes(k),
        d = xh("x-cd" + (on ? " on" : ""));
      d.style.setProperty("--a", t.c);
      d.append(
        xic(t.ic, t.c, 24),
        xh("x-tx", `<b>${t.n}</b><small>${t.d}</small>`),
        xh("rt", "×" + n),
        xbt("x-btn sm" + (on ? " pri" : ""), on ? "已攜帶" : "攜帶", () => {
          let a = (SV.bagSel || []).filter((x) => ITM[x]);
          if (a.includes(k)) a = a.filter((x) => x !== k);
          else {
            if (a.length >= 3) a.shift();
            a.push(k);
          }
          SV.bagSel = a;
          save();
          window.upd();
        }),
      );
      l.append(d);
    }
    R.append(l);
  }
  const owned = CH.map((c, i) => i).filter((i) => SV.chips[i] > 0);
  R.append(
    xh(
      "x-h",
      `芯片庫存<small>${xChipTotal()} 枚 · 圖鑑 ${owned.length}/${CH.length}</small>`,
    ),
  );
  const fl = xh("x-flt");
  fl.append(
    xbt("x-f" + (XS.rf < 0 ? " on" : ""), "全部", () => xSub("rf", -1)),
  );
  for (let t = 4; t >= 0; t--) {
    const b = xbt("x-f" + (XS.rf === t ? " on" : ""), RN[t], () =>
      xSub("rf", t),
    );
    b.style.setProperty("--a", RC[t]);
    fl.append(b);
  }
  R.append(fl);
  const ids = owned
    .filter((i) => XS.rf < 0 || CH[i].r === XS.rf)
    .sort((a, b) => CH[b].r - CH[a].r || a - b);
  if (!owned.length) {
    const e = xh(
      "x-empty",
      "還沒有芯片。擊敗 Boss 會掉落芯片，也能用晶核到商城開芯片包。",
    );
    e.append(
      xbt("x-btn pri", "前往芯片包", () => {
        XS.sh = "pk";
        xGo("m");
      }),
    );
    R.append(e);
  } else if (!ids.length) R.append(xh("x-empty", "這個稀有度還沒有芯片"));
  else {
    const g = xh("x-lst");
    for (const i of ids) {
      const c = CH[i],
        av = chipAvail(i),
        tot = SV.chips[i];
      const d = xbt(
        "x-cd x-chp" + (av <= 0 ? " dim" : "") + (m.includes(i) ? " on" : ""),
        "",
        () => {
          if (av <= 0) {
            G.wsNote =
              "「" + c.n + "」已全部裝備中（" + chipWhere(i) + "），請先拆下。";
            window.upd();
            return;
          }
          const q = gm(G.MWI);
          q[G.SLI] = i;
          SV.mods[G.MWI] = q;
          const k = ne(q);
          if (k >= 0) G.SLI = k;
          G.wsNote = "";
          save();
          window.upd();
        },
      );
      d.style.setProperty("--a", RC[c.r]);
      d.append(
        xic("chip", c.c, 24),
        xh(
          "x-tx",
          `<b>${c.n}<span class="x-tg">${RN[c.r]}</span></b><small>${c.d}${av <= 0 ? " · 已裝備於 " + chipWhere(i) : ""}</small>`,
        ),
        xh("rt", "×" + av + (tot > av ? "／" + tot : "")),
      );
      g.append(d);
    }
    R.append(g);
  }
  const wr = xh("x-split");
  wr.append(L, R);
  v.append(wr);
}

const XB = [
  [
    "哨兵",
    "#ff4d4d",
    "訓練場最終波；無盡模式第 5、45 波",
    "身上的裝甲會持續旋轉，只有缺口那一側才能造成像樣的傷害，打在裝甲上幾乎無效。招式有環形彈幕、朝你瞄準的扇形彈幕，以及一道道連續掃過前方大範圍的雷射。要隨時繞到缺口方向再開火，血量越低彈幕越密、轉得越快。",
  ],
  [
    "巨像",
    "#ffb040",
    "霓虹街區最終波；無盡模式第 10 波",
    "招式有直線蓄力衝撞、在你所在位置附近投下一批炸彈，以及把周圍的方塊撕下來當石頭砸向你（附近沒有方塊時，改在自己周圍丟出一圈炸彈）。衝撞若撞上牆壁會暈眩一段時間，是最好的輸出時機，可以引它撞牆。後期階段衝撞會連續追擊，還會召喚自爆小怪。",
  ],
  [
    "棱鏡",
    "#4dffd8",
    "數據峽谷最終波；無盡模式第 15 波",
    "會分出環繞自己的分身，分身還在時本體處於無敵狀態（身上有深灰圈）：分身很脆弱，先擊碎它們才打得到本體。本體與分身會同時朝你發射雷射，後期本體的雷射條數會增加，雷射碰到牆壁還會反彈。另一種招式是預判你的移動方向，在你前方落下炸彈。分身被清光後，它會在之後的招式或階段轉換時重新分出分身。",
  ],
  [
    "核心",
    "#d070ff",
    "虛空核心最終波；無盡模式第 20 波",
    "本體在節點還在時是無敵的，要先打掉環繞身邊的節點，每個節點的彈幕各不相同（環形、扇形、追蹤彈）。本體自己會放出旋轉螺旋彈幕、環形炸彈、追蹤光球，也會召喚小怪。節點全部被打掉後本體會暈眩一段時間，讓你盡情輸出，之後節點會重新生成。",
  ],
  [
    "雷霆",
    "#ffe14a",
    "冰封港灣最終波；無盡模式第 25 波",
    "招式有高速衝撞（後期會連續衝刺）、鎖定你所在橫向位置的落雷，以及讓地板以棋盤格分批通電，通電前格子會先亮起預警，站在沒亮的安全格就不會受傷。每一招都伴隨環形彈幕，要先看預警再走位。",
  ],
  [
    "蜂后",
    "#9dff3d",
    "毒蜂巢穴最終波；無盡模式第 30 波",
    "身邊還有小蜂時本體處於無敵狀態（身上有深灰圈），必須先清掉小蜂。小蜂是會衝向你自爆的單位，被清光後它會再叫出新一批。它還會發射扇形彈幕與追蹤針，並在你腳下留下毒池，毒池會逐漸擴大壓縮可站立的空間，要邊清蜂邊移動。",
  ],
  [
    "虛空",
    "#7a7aff",
    "虛空裂隙最終波；無盡模式第 35 波",
    "大部分時間處於隱身狀態，此時受到的傷害大幅降低；只有放出大招後才會短暫現形，那是主要輸出時機。招式有強力引力場搭配環形彈幕、瞬移到你身旁後連射三道雷射，以及放出一對傳送門，你和子彈都能穿過傳送門，之後還會接旋轉彈幕。",
  ],
  [
    "終焉",
    "#ff2a8a",
    "終焉之塔最終波；無盡模式第 40 波",
    "依血量分成四個階段，每個階段套用不同 Boss 的特色：第一階段是旋轉裝甲加環形與扇形彈幕；第二階段加入棋盤格通電地板；第三階段分出分身，分身還在時本體無敵，並一起發射雷射；最後階段毒池持續擴大、旋轉彈幕更密、整體進入狂暴，速度明顯加快。全程也會召喚各類小怪干擾。",
  ],
];
/* ---------- 關卡 ---------- */
export function xStage(v) {
  const L = xh("x-sc");
  L.dataset.sc = "l";
  L.append(xh("x-h", "關卡"));
  const g = xh("x-lst");
  STG.forEach((s, i) => {
    const ok = i === 0 || SV.clr[i - 1];
    const d = xbt(
      "x-cd" + (SV.sel === i ? " on" : "") + (ok ? "" : " lk"),
      `<span class="x-tx"><b>${s.n}</b><small>${s.g ? "目標 " + s.g + " 波 · BOSS " + BN[i] : "無盡模式 · 每 5 波一隻 BOSS"}</small></span><span class="rt">${ok ? (SV.clr[i] ? "已通關" : SV.sb[i] ? "最佳 " + SV.sb[i] + " 波" : "") : "通關上一關解鎖"}</span>`,
      () => {
        if (!ok) return;
        SV.sel = i;
        save();
        window.upd();
      },
    );
    d.style.setProperty("--a", s.c);
    g.append(d);
  });
  L.append(g);
  const s = ST(),
    i = SV.sel;
  const dt = xh("x-pn x-dt");
  dt.style.setProperty("--a", s.c);
  dt.innerHTML = `<div class="x-stn">${s.n}</div><div class="x-kv4"><span>目標<b>${s.g ? s.g + " 波" : "無盡"}</b></span><span>敵人血量<b>×${s.hm}</b></span><span>金幣加成<b>×${s.cm}</b></span><span>最佳紀錄<b>${SV.sb[i] ? SV.sb[i] + " 波" : "—"}</b></span></div>`;
  if (s.g && XB[i]) {
    const b = XB[i],
      bx = xh("x-boss");
    bx.append(
      xic("e" + (14 + i), b[1], 34),
      xh(
        "x-tx",
        `<b style="color:${b[1]}">${b[0]}</b><small>${b[2]}</small><p>${b[3]}</p>`,
      ),
    );
    dt.append(bx);
  } else
    dt.append(
      xh(
        "x-ds",
        "沒有終點，波數越高敵人越強。每 5 波會出現一隻 BOSS，撐得越久，最佳波數越高。",
      ),
    );
  const ac = xh("x-foot");
  ac.append(
    xbt("x-btn pri blk", "出戰此關", start),
    xbt("x-btn blk", "前往備戰", () => xGo("b")),
  );
  const R = xSide([dt], ac);
  const w = xh("x-split sd");
  w.append(L, R);
  v.append(w);
}

/* ---------- 商城 ---------- */
const XPK = [
  { n: "普通芯片包", cost: 30, k: 1, b: 0, g: 0 },
  { n: "精選芯片包", cost: 80, k: 3, b: 1, g: 0 },
  { n: "頂級芯片包", cost: 200, k: 3, b: 2, g: 1 },
];
// 功能：處理介面系統「xShop」相關的資料、互動或顯示。
export function xShop(v) {
  const subs = [
    ["up", "永久升級"],
    ["wp", "槍械"],
    ["it", "消耗品"],
    ["ch", "角色"],
    ["pk", "芯片包"],
  ];
  const fl = xh("x-flt");
  subs.forEach(([k, n]) =>
    fl.append(xbt("x-f" + (XS.sh === k ? " on" : ""), n, () => xSub("sh", k))),
  );
  v.append(fl);
  const box = xh("x-doc");
  v.append(box);
  // 功能：處理「cost」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const cost = (K, c, can, fn, txt) => {
    const b = xbt("x-btn sm " + (can ? "pri" : ""), `${c} ${CN[K]}`, fn, !can);
    b.prepend(mkIcon(CI[K], can ? "#04101a" : CC[K], 14));
    return b;
  };
  if (XS.sh === "up") {
    box.append(
      xh("x-sub", "碎片用於基礎強化，晶核用於進階強化。升級永久生效。"),
    );
    const l = xh("x-lst");
    UPD.forEach((u) => {
      const lv = SV.up[u.k] || 0,
        K = UC[u.k],
        c = ucost(u, lv),
        mx = lv >= u.m,
        can = !mx && SV[K] >= c;
      const d = xh("x-cd x-up");
      d.style.setProperty("--a", CC[K]);
      d.append(
        xh(
          "x-tx",
          `<b>${u.n}</b><small>每級 ${u.d} · Lv ${lv}/${u.m}</small><span class="x-pp">${Array.from({ length: u.m }, (_, q) => `<i class="${q < lv ? "f" : ""}" style="--p:${CC[K]}"></i>`).join("")}</span>`,
        ),
      );
      d.append(
        mx
          ? xh("rt", "已滿級")
          : cost(K, c, can, () => {
              if (!can) return;
              SV[K] -= c;
              SV.up[u.k] = lv + 1;
              save();
              window.upd();
            }),
      );
      l.append(d);
    });
    box.append(l);
  } else if (XS.sh === "wp") {
    const miss = ALLW.map((w, i) => i).filter((i) => !SV.own.includes(i));
    box.append(
      xh(
        "x-sub",
        `用金幣解鎖新槍械，已解鎖 ${SV.own.length} / ${ALLW.length}。`,
      ),
    );
    box.append(
      xFlt(["全部", ...XCAT.map((c) => c[0])], XS.sc, (n) => xSub("sc", n)),
    );
    const l = xh("x-lst"),
      sh = miss.filter((i) => XS.sc === "全部" || wCat(i) === XS.sc);
    if (!miss.length) l.append(xh("x-empty", "已全部解鎖"));
    else if (!sh.length) l.append(xh("x-empty", "這個分類已全部解鎖"));
    sh.forEach((i) => {
      const w = ALLW[i],
        can = SV[WPC[i]] >= WPR[i],
        d = xh("x-cd");
      d.style.setProperty("--a", w.c);
      d.append(
        xic("ammo", w.c, 26),
        xh(
          "x-tx",
          `<b>${w.n}</b><small>${wCat(i)} · ${wMode(i)} · ${wNote(i)}</small>`,
        ),
      );
      const b = xbt(
        "x-btn sm " + (can ? "gld" : ""),
        `${WPR[i]} 金幣`,
        () => buyW(i),
        !can,
      );
      b.prepend(mkIcon("coin", can ? "#1a1200" : CC.coins, 14));
      d.append(b);
      l.append(d);
    });
    box.append(l);
  } else if (XS.sh === "it") {
    box.append(
      xh(
        "x-sub",
        "消耗品用金幣購買，每種最多持有 9 個，用掉就會減少。到「背包」選擇出戰攜帶。",
      ),
    );
    const l = xh("x-lst");
    for (const k of ITK) {
      const t = ITM[k],
        n = SV.items[k] || 0,
        can = SV.coins >= t.p && n < 9,
        d = xh("x-cd");
      d.style.setProperty("--a", t.c);
      d.append(
        xic(t.ic, t.c, 26),
        xh("x-tx", `<b>${t.n}</b><small>${t.d} · 持有 ${n}/9</small>`),
      );
      const b = xbt(
        "x-btn sm " + (can ? "gld" : ""),
        n >= 9 ? "已滿" : `${t.p} 金幣`,
        () => {
          if (SV.coins < t.p || (SV.items[k] || 0) >= 9) return;
          SV.coins -= t.p;
          SV.items[k] = (SV.items[k] || 0) + 1;
          save();
          window.upd();
        },
        !can,
      );
      b.prepend(mkIcon("coin", can ? "#1a1200" : CC.coins, 14));
      d.append(b);
      l.append(d);
    }
    box.append(l);
  } else if (XS.sh === "ch") {
    box.append(xh("x-sub", "不同角色有各自的特性與取捨。"));
    const l = xh("x-lst");
    CHS.forEach((c, i) => {
      const ow = SV.chars.includes(i),
        on = SV.char === i,
        can = SV.coins >= c.p,
        d = xh("x-cd" + (on ? " on" : ""));
      d.style.setProperty("--a", c.c);
      d.append(xh("x-tx", `<b>${c.n}</b><small>${c.d}</small>`));
      if (on) d.append(xh("rt", "出戰中"));
      else if (ow)
        d.append(
          xbt("x-btn sm pri", "選擇", () => {
            SV.char = i;
            save();
            window.upd();
          }),
        );
      else {
        const b = xbt(
          "x-btn sm " + (can ? "gld" : ""),
          `${c.p} 金幣`,
          () => {
            if (SV.coins < c.p) return;
            SV.coins -= c.p;
            SV.chars.push(i);
            SV.char = i;
            save();
            window.upd();
          },
          !can,
        );
        b.prepend(mkIcon("coin", can ? "#1a1200" : CC.coins, 14));
        d.append(b);
      }
      l.append(d);
    });
    box.append(l);
  } else {
    box.append(
      xh("x-sub", `用晶核開芯片包，目前持有 ${xChipTotal()} 枚芯片。`),
    );
    const l = xh("x-lst");
    for (const p of XPK) {
      const o = TW[p.b],
        sum = o.reduce((a, x) => a + x, 0),
        can = SV.co >= p.cost,
        d = xh("x-cd");
      d.style.setProperty("--a", CC.co);
      d.append(
        xic("chip", "#ff4dff", 28),
        xh(
          "x-tx",
          `<b>${p.n}</b><small>${p.k} 枚${p.g ? " · 保底 1 枚史詩以上" : ""}</small><small>${o
            .map((q, t) =>
              q
                ? `<span style="color:${RC[t]}">${RN[t]} ${+((q / sum) * 100).toFixed(1)}%</span>`
                : "",
            )
            .filter(Boolean)
            .join("　")}</small>`,
        ),
      );
      d.append(
        cost("co", p.cost, can, () => {
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
        }),
      );
      l.append(d);
    }
    box.append(l);
    if (G.lastPk && G.lastPk.length) {
      box.append(xh("x-h", "本次獲得"));
      const g = xh("x-lst");
      for (const x of G.lastPk) {
        const c = CH[x.i],
          d = xh("x-cd x-chp");
        d.style.setProperty("--a", RC[c.r]);
        d.append(
          xic("chip", c.c, 24),
          xh(
            "x-tx",
            `<b>${c.n}<span class="x-tg">${RN[c.r]}</span></b><small>${c.d}</small>`,
          ),
          xh("rt", x.nw ? "NEW" : ""),
        );
        g.append(d);
      }
      box.append(g);
    }
  }
}

// 功能：處理介面系統「xEnemyCmp」相關的資料、互動或顯示。
export function xEnemyCmp(t, c, d) {
  const id = +String(t).slice(1),
    E = ELITE[id],
    nm = (typeof EN !== "undefined" && EN[id]) || d.split(" · ")[0];
  const bk = xh("x-elbk"),
    w = xh("x-elw");
  bk.append(w);
  w.append(xh("", "<h3>" + d.split(" · ")[0] + "　原版 / 精英版</h3>", "div"));
  const g = xh("x-elg");
  const a = xh("x-elc");
  a.style.setProperty("--a", c);
  const ia = xh("x-ic");
  ia.append(mkIcon(t, c, 44));
  a.append(
    xh("tp", "原本"),
    ia,
    xh("", "<b>" + d.split(" · ")[0] + "</b>"),
    xh("", "<p>" + d + "</p>"),
  );
  const b = xh("x-elc el");
  b.style.setProperty("--a", c);
  if (E) {
    const ib = xh("x-ic");
    ib.append(mkEIcon(t, c, 44));
    b.append(
      xh(
        "tp",
        '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg> 精英',
      ),
      ib,
      xh("", "<b>" + E.n + "</b>"),
      xh("", "<ul>" + E.fx.map((s) => "<li>" + s + "</li>").join("") + "</ul>"),
    );
  } else {
    const ib = xh("x-ic");
    ib.append(mkEIcon(t, c, 44));
    b.append(
      xh(
        "tp",
        '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg> 精英',
      ),
      ib,
      xh("", "<b>尚未加入</b>"),
      xh("", "<p>這隻怪的精英版還在製作中。</p>"),
    );
  }
  g.append(a, b);
  w.append(g);
  w.append(
    xh(
      "",
      '<p style="font-size:11px;color:var(--mu)">精英怪只會出現在 Boss 關和 Boss 前一關，出現時畫面會提示。</p>',
    ),
  );
  const x = xh("x-elx", "關閉", "button");
  x.onclick = () => bk.remove();
  w.append(x);
  bk.onclick = (ev) => {
    if (ev.target === bk) bk.remove();
  };
  document.body.append(bk);
}

// 功能：處理「trPick」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function trPick(i, name, col, go) {
  const bk = xh("x-elbk"),
    w = xh("x-elw");
  bk.append(w);
  w.append(xh("", "<h3>召喚 " + name + "　選擇型態</h3>"));
  const tri =
    '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const g = xh("x-elg"),
    E = ELITE[i];
  // 功能：建立或生成「mk」所需的遊戲資料。
  const mk = (el) => {
    const c = xh("x-elc" + (el ? " el" : ""), "", "button");
    c.style.cssText =
      "text-align:left;color:inherit;font:inherit;border:0;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start";
    c.style.setProperty("--a", col);
    const ic = xh("x-ic");
    ic.append(el ? mkEIcon("e" + i, col, 44) : mkIcon("e" + i, col, 44));
    c.append(
      xh("tp", el ? tri + " 精英" : "普通"),
      ic,
      xh("", "<b>" + (el ? E.n : name) + "</b>"),
    );
    if (el)
      c.append(
        xh(
          "",
          "<ul>" + E.fx.map((t) => "<li>" + t + "</li>").join("") + "</ul>",
        ),
      );
    c.onclick = () => {
      bk.remove();
      go(el);
    };
    return c;
  };
  g.append(mk(0), mk(1));
  w.append(g);
  const x = xh("x-elx", "取消", "button");
  x.onclick = () => bk.remove();
  w.append(x);
  bk.onclick = (ev) => {
    if (ev.target === bk) bk.remove();
  };
  document.body.append(bk);
}
/* ---------- 圖鑑（介紹） ---------- */
export function xCodex(v) {
  const subs = [
    ["i", "簡介"],
    ["o", "操作"],
    ["p", "道具"],
    ["e", "敵人"],
    ["b", "Boss"],
  ];
  const fl = xh("x-flt");
  subs.forEach(([k, n]) =>
    fl.append(xbt("x-f" + (XS.cx === k ? " on" : ""), n, () => xSub("cx", k))),
  );
  v.append(fl);
  const box = xh("x-doc");
  v.append(box);
  // 功能：本行宣告多個相關輔助函式；「ul」及同列工具供後續邏輯共用。
  const ul = (a) =>
    `<ul class="x-ul">${a.map((t) => `<li>${t}</li>`).join("")}</ul>`;
  if (XS.cx === "i") {
    box.append(
      xh(
        "x-lead",
        "在霓虹方塊構成的戰場上，一邊瞄準、一邊閃避。清光每一波敵人，擊敗關底 Boss，再把戰利品帶回來強化自己。",
      ),
    );
    box.append(
      xh(
        "",
        '<ol class="x-seq"><li><b>備戰</b>選一名角色，帶上 3 把槍（依點選順序為 1 至 3 號），也可以替槍裝上芯片。</li><li><b>出戰</b>清掉每一波敵人。敵人攻擊前會先出現紅色預警，看到就走位。命中敵人會累積 SUPER 能量，每波之間可在補給站用積分補血、補彈。</li><li><b>結算</b>不論勝負都會帶回金幣、碎片、晶核與芯片，拿去升級、解鎖槍械和改裝。</li></ol>',
      ),
    );
    box.append(xh("x-h", "貨幣與戰利品"));
    const l = xh("x-lst");
    [
      ["coin", "金幣", "解鎖槍械與角色"],
      ["shard", "碎片", "基礎永久升級，由方塊與敵人掉落"],
      ["core", "晶核", "進階升級與芯片包，由強敵與 Boss 掉落"],
      [
        "chip",
        "芯片",
        "Boss 掉落，裝在槍上強化。顏色代表稀有度（灰、綠、藍、紫、金）",
      ],
    ].forEach(([t, n, d]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", PC[t]);
      r.append(xic(t, PC[t], 26), xh("x-tx", `<b>${n}</b><small>${d}</small>`));
      l.append(r);
    });
    box.append(
      l,
      xh("x-h", "小技巧"),
      xh(
        "",
        ul([
          "所有出戰槍的彈藥會同時回復，切換武器後的第一發傷害 +30%，輪流使用最有效率。",
          "子彈會打碎方塊，可以開路，也會拆掉自己的掩體。",
          "衝刺期間無敵，可以直接穿過彈幕。",
        ]),
      ),
    );
  } else if (XS.cx === "o") {
    box.append(
      xh("x-h", "電腦"),
      xh(
        "",
        ul([
          "<kbd>WASD</kbd> 移動，滑鼠瞄準，按住左鍵射擊",
          "<kbd>Shift</kbd> 衝刺（衝刺期間無敵）",
          "<kbd>空白鍵</kbd> 釋放 SUPER",
          "<kbd>1</kbd>–<kbd>3</kbd>、<kbd>Q</kbd>、滾輪切換槍械",
          "<kbd>F</kbd> 全螢幕，<kbd>P</kbd> / <kbd>Esc</kbd> 暫停",
        ]),
      ),
    );
    box.append(
      xh("x-h", "手機"),
      xh(
        "",
        ul([
          "左半邊畫面是移動搖桿",
          "右半邊拖曳瞄準，放開時發射",
          "SUPER、DASH、換槍使用畫面上的按鈕",
          "點選畫面下方槍欄換槍，拖曳可互換位置",
        ]),
      ),
    );
    box.append(
      xh("x-h", "自動瞄準"),
      xh(
        "",
        ul([
          "分三段：關、輔助、強（在暫停選單裡調整）",
          "輔助只修正你瞄準方向附近的敵人，其他方向照你瞄的打",
          "強的修正範圍更大，但同樣只會修正準星方向附近的敵人",
        ]),
      ),
    );
    box.append(
      xh("x-h", "戰鬥提示"),
      xh(
        "",
        ul([
          "紅色虛線代表 0.45 秒後開火，快閃開",
          "命中敵人會累積 SUPER 能量",
          "子彈會打碎方塊",
        ]),
      ),
    );
  } else if (XS.cx === "p") {
    const g = xh("x-lst");
    LEG_A.forEach(([t, n]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", PC[t]);
      r.append(xic(t, PC[t], 26), xh("x-tx", n));
      g.append(r);
    });
    box.append(g);
  } else if (XS.cx === "e") {
    const g = xh("x-lst"),
      n = LEG_B.length - 2;
    LEG_B.slice(0, n).forEach(([t, c, d]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", c);
      r.append(xic(t, c, 26), xh("x-tx", d));
      if (ELITE[+t.slice(1)])
        r.append(
          xh(
            "rt",
            '<svg width="18" height="18" viewBox="-4 -4 22 22" style="vertical-align:-4px;overflow:visible;filter:drop-shadow(0 0 3px #ffb21a) drop-shadow(0 0 7px #ffb21a)"><polygon points="7,2.5 12,11.5 2,11.5" fill="#ffc83a" stroke="#ffb21a" stroke-width="1.2" stroke-linejoin="round"/></svg>',
          ),
        );
      r.onclick = () => xEnemyCmp(t, c, d);
      g.append(r);
    });
    box.append(g, xh("x-h", "子彈"));
    const g2 = xh("x-lst");
    LEG_B.slice(n).forEach(([t, c, d]) => {
      const r = xh("x-cd");
      r.style.setProperty("--a", c);
      r.append(xic(t, c, 26), xh("x-tx", d));
      g2.append(r);
    });
    box.append(g2);
  } else {
    box.append(
      xh("x-h", "所有 Boss 共通規則"),
      xh(
        "",
        ul([
          "每次攻擊前都有預警（紅色虛線或紅圈），攻擊後有短暫後搖。護盾、裝甲、隱身等減傷在後搖中依然有效。",
          "Boss 身上出現深灰色圓環代表無敵，打中只會冒灰色粒子，不要浪費彈藥，先處理護盾來源。",
          "打在護盾或裝甲上會填滿血條下方的黃色破綻條，填滿後進入 BREAK：Boss 暈眩、不再行動，通過護盾的傷害會被放大。",
          "血量降到門檻會進入下一階段，招式更多更密，切換階段時 Boss 會短暫完全無敵。",
          "Boss 不會閃避子彈，會撕碎擋路的方塊。擊殺後場上掉落物會自動吸到你身上。",
        ]),
      ),
    );
    box.append(xh("x-h", "Boss 一覽"));
    const g = xh("x-lst");
    XB.forEach((b, i) => {
      const d = xh("x-cd");
      d.style.setProperty("--a", b[1]);
      d.style.alignItems = "flex-start";
      d.append(
        xic("e" + (14 + i), b[1], 30),
        xh(
          "x-tx",
          `<b style="color:${b[1]}">${b[0]}</b><small>${b[2]}</small><small style="color:#bcc8ee;margin-top:4px">${b[3]}</small>`,
        ),
      );
      g.append(d);
    });
    box.append(g);
  }
}

/* ---------- 結算 / 暫停 / 補給 ---------- */
export function xResult(over) {
  const m = $("xm");
  if (!over) {
    m.classList.remove("on");
    m.innerHTML = "";
    return;
  }
  const nr = G.score >= G.best && G.score > 0,
    s = chipSum();
  m.innerHTML = `<div class="x-rs${G.won ? "" : " lose"}"><h2>${G.won ? "通關成功" : "戰鬥結束"}${nr ? '<span class="nr">新紀錄</span>' : ""}</h2><div class="x-kv"><span>分數<b>${G.score}</b></span><span>抵達波數<b>${G.wave}</b></span><span>芯片<b>+${G.chp.length}</b></span><span>金幣<b style="color:${CC.coins}">+${G.coins}</b></span><span>碎片<b style="color:${CC.sh}">+${G.shd}</b></span><span>晶核<b style="color:${CC.co}">+${G.cor}</b></span></div>${s ? `<div class="x-chs">芯片 ${s.replace(/^（|）$/g, "")}</div>` : ""}<div class="x-two"><button class="x-btn" id="xrb">回大廳</button><button class="x-btn pri" id="xrg">再次出戰</button></div></div>`;
  $("xrb").onclick = () => m.classList.remove("on");
  $("xrg").onclick = () => {
    m.classList.remove("on");
    start();
  };
  m.classList.add("on");
}
// 功能：處理介面系統「xPause」相關的資料、互動或顯示。
export function xPause() {
  const e = $("psi");
  if (e)
    e.textContent = G.train
      ? "訓練場 · 不計入進度"
      : `第 ${G.wave} 波 · 分數 ${G.score} · 本局金幣 ${G.coins}`;
}

/* ---------- 版面總管 ---------- */
const XFIT = { h: 1, b: 1, i: 1, k: 1 };
// 功能：處理介面系統「xRender」相關的資料、互動或顯示。
export function xRender() {
  const v = $("xV"),
    sv = {},
    tp = v.scrollTop,
    t = XS.t,
    fresh = XS.fresh;
  XS.fresh = 0;
  v.querySelectorAll("[data-sc]").forEach(
    (e) => (sv[e.dataset.sc] = e.scrollTop),
  );
  $("xa").dataset.t = t;
  document
    .querySelectorAll("#xn .x-tab")
    .forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  const cl = SV.clr.filter(Boolean).length;
  const TI = {
    h: ["大廳", `最高分 ${G.best}`],
    b: ["備戰", `${(CHS[SV.char] || CHS[0]).n} · 出戰 ${G.LO.length} / 3 把`],
    i: ["背包", `芯片 ${xChipTotal()} 枚 · 槍械 ${SV.own.length} 把`],
    k: ["關卡", `已通關 ${cl} / 8`],
    m: ["商城", "強化、解鎖與芯片包"],
    c: ["圖鑑", "玩法、操作與敵人資料"],
    a: ["帳號", `歡迎回來，${escapeHtml(accountService.displayName)}`], // 暱稱來自伺服器，必須先跳脫再放進 innerHTML
  }[t];
  $("xT").innerHTML = `<b>${TI[0]}</b><small>${TI[1]}</small>`;
  const cur = $("xC");
  cur.replaceChildren();
  for (const k of ["coins", "sh", "co"]) {
    const s = document.createElement("span");
    s.style.color = CC[k];
    s.append(mkIcon(CI[k], CC[k], 15), String(SV[k]));
    s.title = CN[k];
    cur.append(s);
  }
  $("go").textContent = XS.over ? "再次出戰" : "出戰";
  v.replaceChildren();
  v.className = "x-view" + (XFIT[t] ? " fit" : "");
  ({ h: xLobby, b: xLoad, i: xBag, k: xStage, m: xShop, c: xCodex ,a: xAccount})[t](v);
  if (!fresh) {
    v.scrollTop = tp;
    v.querySelectorAll("[data-sc]").forEach((e) => {
      if (sv[e.dataset.sc] != null) e.scrollTop = sv[e.dataset.sc];
    });
  }
}
// 把舊版長頁面重組為主頁（分頁、商城、關卡選擇）
export function buildHome() {
  window.upd = xRender;
  window.showTab = (k) => xGo(k);
  document
    .querySelectorAll("#xn .x-tab")
    .forEach((b) => (b.onclick = () => xGo(b.dataset.t)));
  const fb = $("xfs");
  if (!fsOK) fb.style.display = "none";
  else fb.onclick = toggleFS;
  // 功能：處理「sync」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const sync = () =>
    document.body.classList.toggle("inmenu", !$("ov").classList.contains("h"));
  new MutationObserver(sync).observe($("ov"), {
    attributes: true,
    attributeFilter: ["class"],
  });
  sync();
  xRender();
}

export const ECOL = [
  "#ff3d9a",
  "#ff9a3d",
  "#b45cff",
  "#9dff3d",
  "#4de1ff",
  "#ff4dff",
  "#3dffb0",
  "#ff2a4a",
  "#c0c8ff",
  "#ffd23a",
  "#ff9ad5",
  "#7a7aff",
  "#ff7a5a",
  "#d4ff3d",
];

/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {

G.XM = null;

ECOL[26] = "#ff9f2a";

ECOL[27] = "#e04dff";

ECOL[28] = "#6dffb0";

ECOL[29] = "#c0a060";
}

