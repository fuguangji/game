/** ui/menu-bag — 背包分頁：芯片改裝、裝備與庫存 */
import { G } from "../core/game-state.js";
import { bossCatalog } from "../config/index.js";
import { CH, RC, RN, chipApply, chipAvail, chipWhere } from "../game/chips.js";
import { ITK, ITM } from "../game/pickups.js";
import { SV, bossAppearance, save } from "../game/progress.js";
import { ALLWEAPON } from "../game/weapons.js";
import { mkIcon } from "../icons.js";
import { toast } from "./feedback.js";
import { XS, wStat, xChipTotal, xGo, xSaveLO, xSub, xbt, xfmt, xh, xic } from "./menu.js";

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
    ["p", 12, 22, 6, 80, -90, "#ee6a7c", 1.8, 90, 1],
    ["p", 182, 52, 4, 48, -45, "#d9c98a", 1.8, 70, -1],
    ["p", 178, 186, 3, 66, -90, "#9dff3d", 1.8, 80, 1],
    ["c", 22, 178, 42, "#8fe3cf", 1.6, "3 7", 100, -1],
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
    b.style.setProperty("--a", ALLWEAPON.getWeapon()[i].c);
    b.append(mkIcon("ammo", i === G.MWI ? "#07120f" : ALLWEAPON.getWeapon()[i].c, 16));
    b.insertAdjacentHTML(
      "beforeend",
      `<span>${ALLWEAPON.getWeapon()[i].n}</span><span class="x-pp">${mm.map((c) => `<i class="${has(c) ? "f" : ""}" style="${has(c) ? "--p:" + RC[CH[c].r] : ""}"></i>`).join("")}</span>${G.LO.includes(i) ? `<em>${G.LO.indexOf(i) + 1}</em>` : ""}`,
    );
    wl.append(b);
  }
  wl.dataset.coach = "bag-weapons";
  L.append(wl, xh("x-h", `槽位<small>${ALLWEAPON.getWeapon()[G.MWI].n}</small>`));
  const sg = xh("x-lst");
  sg.dataset.coach = "bag-slots";
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
          toast(`已拆下「${c.n}」，它回到庫存了`);
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
  const base = ALLWEAPON.getWeapon()[G.MWI],
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
  st.dataset.coach = "bag-cmp";
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
          const slot = G.SLI;
          q[slot] = i;
          SV.mods[G.MWI] = q;
          const k = ne(q);
          if (k >= 0) G.SLI = k;
          G.wsNote = "";
          save();
          window.upd();
          toast(`已把「${c.n}」裝到${ALLWEAPON.getWeapon()[G.MWI].n}的槽位 ${slot + 1}`, { type: "success" });
        },
      );
      d.style.setProperty("--a", RC[c.r]);
      d.dataset.coach = "bag-chip-" + i;
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

/** Boss 圖鑑列表 [名稱, 顏色, 出現位置, 說明]：全部由 boss-catalog.js 與關卡表推導，新增 Boss 時不用改這裡 */
export const bossRows = () => bossCatalog.all().map((b) => [b.name, b.color, bossAppearance(b.index), b.description ?? "（尚無說明）"]);
