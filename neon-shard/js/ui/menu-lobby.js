/** ui/menu-lobby — 大廳、備戰、關卡選擇、結算與暫停畫面 */
import { bossCatalog } from "../config/index.js";
import { G } from "../core/game-state.js";
import { $ } from "../core/viewport.js";
import { CH, CHS, RC, chipSum, modW } from "../game/chips.js";
import { buyW } from "../game/pickups.js";
import { CC, ST, STG, SV, WPC, WPR, save } from "../game/progress.js";
import { rdOpen } from "../game/redeem.js";
import { startTrain } from "../game/training.js";
import { startTutorial } from "../game/tutorial.js";
import { ALLWEAPON, WD } from "../game/weapons.js";
import { XB, xEmb, xEquip, xUnequip } from "./menu-bag.js";
import { XCAT, XS, wCat, wMode, wNote, wStat, xFlt, xGo, xSide, xSub, xbt, xfmt, xh, xic, xmax } from "./menu.js";
import { start } from "./render.js";
import { suggestNextStep } from "./shop-guide.js";

/* ---------- 大廳 ---------- */
export function xLobby(v) {
  const st = ST(),
    ch = CHS[SV.char] || CHS[0],
    cl = SV.clr.filter(Boolean).length;
  const cols = [0, 1, 2].map((k) =>
    G.LO[k] !== undefined ? ALLWEAPON.getWeapon()[G.LO[k]].c : "#3a4573",
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
    `${xEmb()}<div class="x-wm">NEON SHARD</div><div class="x-tag">霓虹幾何，瞄準與閃避</div><div class="x-hs"><span><b>${G.best}</b>最高分</span><span><b>${cl}/8</b>關卡通關</span><span><b>${SV.own.length}/${ALLWEAPON.getWeapon().length}</b>槍械解鎖</span></div>`,
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
      w = i !== undefined ? ALLWEAPON.getWeapon()[i] : null,
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
  const tipped = (btn, tip) => ((btn.title = tip), btn);
  two.append(
    tipped(xbt("x-btn", "教學模式", startTutorial), "重玩基礎操作教學"),
    tipped(xbt("x-btn", "訓練場", startTrain), "自由試槍、試芯片，不會死亡"),
    tipped(xbt("x-btn", "兌換碼", rdOpen), "輸入兌換碼領取獎勵"),
  );
  const foot = xh("x-foot");
  foot.append(go, two);
  const next = suggestNextStep();
  const nextCard = next && xh("x-next");
  if (nextCard) {
    nextCard.append(xh("x-tx", `<b>下一步建議</b><small>${next.text}</small>`), xbt("x-btn sm pri", next.label, next.run));
  }
  const side = xSide(
    [
      ...(nextCard ? [nextCard] : []),
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
  if (!ALLWEAPON.getWeapon()[XS.ws]) XS.ws = G.LO[0] || 0;
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
      w = i !== undefined ? ALLWEAPON.getWeapon()[i] : null,
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
    xh("x-h", `槍械庫<small>${own.length} / ${ALLWEAPON.getWeapon().length} 已解鎖</small>`),
  );
  L.append(
    xFlt(["全部", "已擁有", "未解鎖", ...XCAT.map((c) => c[0])], XS.lc, (n) =>
      xSub("lc", n),
    ),
  );
  const wg = xh("x-grid"),
    isCat = XCAT.some((c) => c[0] === XS.lc);
  ALLWEAPON.getWeapon().forEach((w, i) => {
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
    w = ALLWEAPON.getWeapon()[i],
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
      `<span class="x-tx"><b>${s.n}</b><small>${s.g ? "目標 " + s.g + " 波 · BOSS " + (bossCatalog.find(i)?.name ?? "—") : "無盡模式 · 每 5 波一隻 BOSS"}</small></span><span class="rt">${ok ? (SV.clr[i] ? "已通關" : SV.sb[i] ? "最佳 " + SV.sb[i] + " 波" : "") : "通關上一關解鎖"}</span>`,
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
  const quitBtn = $("qb");
  if (quitBtn) quitBtn.textContent = G.train ? "離開訓練場" : "放棄本局，回到大廳";
  const e = $("psi");
  if (e)
    e.textContent = G.train
      ? "訓練場 · 不計入進度"
      : `第 ${G.wave} 波 · 分數 ${G.score} · 本局金幣 ${G.coins}`;
}
