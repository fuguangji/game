/** ui/menu-codex — 圖鑑分頁：敵人與道具介紹、敵人比較 */
import { ELITE } from "../enemy-config.js";
import { LEG_A, LEG_B, PC } from "../game-config.js";
import { EN } from "../game/pickups.js";
import { mkEIcon, mkIcon } from "../icons.js";
import { bossCatalog } from "../config/index.js";
import { bossRows } from "./menu-bag.js";
import { XS, xSub, xbt, xh, xic } from "./menu.js";

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
          "<kbd>WASD</kbd> 移動，滑鼠瞄準，左鍵發動「目前選定」的格子（普通攻擊可按住連射）",
          "<kbd>Shift</kbd> 衝刺（衝刺期間無敵）",
          "<kbd>滾輪</kbd> 切換選定的格子（普通攻擊 ↔ 各技能），<kbd>Z X C V B N</kbd> 直接施放技能",
          "<kbd>空白鍵</kbd> 展開術式場（<kbd>E</kbd> 為第 2 個術式場）",
          "<kbd>1</kbd>–<kbd>2</kbd>、<kbd>Q</kbd> 切換武器",
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
    bossRows().forEach((b, i) => {
      const d = xh("x-cd");
      d.style.setProperty("--a", b[1]);
      d.style.alignItems = "flex-start";
      d.append(
        xic("e" + bossCatalog.get(i).typeId, b[1], 30),
        xh(
          "x-tx",
          `<b style="color:${b[1]}">${b[0]}</b><small>${b[2]}</small><small style="color:#c3d6cd;margin-top:4px">${b[3]}</small>`,
        ),
      );
      g.append(d);
    });
    box.append(g);
  }
}
