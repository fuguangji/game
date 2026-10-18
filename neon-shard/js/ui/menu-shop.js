/** ui/menu-shop — 商城分頁：武器、角色、芯片與升級的購買 */
import { G } from "../core/game-state.js";
import { CH, CHS, RC, RN, TW, rollChip } from "../game/chips.js";
import { ITK, ITM, buyW, ucost } from "../game/pickups.js";
import { CC, CN, SV, UC, UPD, WPC, WPR, save } from "../game/progress.js";
import { ALLWEAPON } from "../game/weapons.js";
import { mkIcon } from "../icons.js";
import { CI, XCAT, XPK, XS, wCat, wMode, wNote, xChipTotal, xFlt, xSub, xbt, xh, xic } from "./menu.js";

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
    const miss = ALLWEAPON.getWeapon().map((w, i) => i).filter((i) => !SV.own.includes(i));
    box.append(
      xh(
        "x-sub",
        `用金幣解鎖新槍械，已解鎖 ${SV.own.length} / ${ALLWEAPON.getWeapon().length}。`,
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
      const w = ALLWEAPON.getWeapon()[i],
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
