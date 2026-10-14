/** game/training — 訓練場 */
import { G } from "../core/game-state.js";
import { fsm } from "../core/state-machine.js";
import { $ } from "../core/viewport.js";
import { ELITE, EL_COL } from "../enemy-config.js";
import { blocked, burst, empty, mkEn, setup } from "./battle.js";
import { BN } from "./boss.js";
import { CH, RC, RN, modW } from "./chips.js";
import { elify } from "./elite.js";
import { EN } from "./pickups.js";
import { SV, UL, quit } from "./progress.js";
import { spawnDummy } from "./ultimates.js";
import { ALLW, WP } from "./weapons.js";
import { mkIcon } from "../icons.js";
import { ECOL, trPick } from "../ui/menu.js";
import { trChip } from "../ui/workshop.js";

// 功能：處理「endTrain」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function endTrain() {
  G.train = false;
  $("tr").classList.add("h");
  $("trt").classList.add("h");
}
// 進入訓練場
export function startTrain() {
  G.train = true;
  G.TM = JSON.parse(JSON.stringify(SV.mods));
  G.trK = "";
  G.god = true;
  G.fz = false;
  G.inf = true;
  WP.splice(0, WP.length, modW(ALLW[0]), modW(ALLW[1]), modW(ALLW[3]));
  setup();
  G.en.length = 0;
  G.pk.length = 0;
  G.bl.length = 0;
  G.zones.length = 0;
  G.wave = 1;
  G.banner = 0;
  $("ov").classList.add("h");
  fsm.transition("play");
  trBuild();
  $("tr").classList.remove("h");
  $("trt").classList.remove("h");
}
// 功能：處理「trBuild」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
export function trBuild() {
  const el = $("tr");
  if (el.children.length) return;
  let rowEl;
  // 功能：處理「sec」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
  const sec = (t) => {
      rowEl = document.createElement("div");
      rowEl.className = "tr-row";
      const l = document.createElement("div");
      l.className = "tr-l";
      l.textContent = t;
      rowEl.append(l);
      el.append(rowEl);
    },
    grid = () => {
      const g = document.createElement("div");
      g.className = "tr-b";
      rowEl.append(g);
      return g;
    },
    btn = (g, ic, col, txt, fn) => {
      const b = document.createElement("button");
      b.style.borderColor = col;
      if (ic) b.append(mkIcon(ic, col, 16));
      b.append(txt);
      b.onclick = () => fn(b);
      g.append(b);
    };
  {
    const hd = document.createElement("div");
    hd.className = "sec";
    hd.style.cssText =
      "cursor:move;touch-action:none;margin:0 0 6px;text-align:center";
    hd.textContent = "訓練面板 · 拖曳移動";
    let o = null;
    hd.addEventListener("pointerdown", (e) => {
      const r = el.getBoundingClientRect();
      o = {
        id: e.pointerId,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
      };
      el.style.right = "auto";
      el.style.transform = "none";
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      try {
        hd.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    });
    hd.addEventListener("pointermove", (e) => {
      if (!o || e.pointerId !== o.id) return;
      const w = el.offsetWidth,
        h = el.offsetHeight;
      el.style.left =
        Math.max(0, Math.min(innerWidth - w, e.clientX - o.dx)) + "px";
      el.style.top =
        Math.max(0, Math.min(innerHeight - Math.min(h, 60), e.clientY - o.dy)) +
        "px";
    });
    // 功能：處理「up」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
    const up = (e) => {
      if (o && e.pointerId === o.id) o = null;
    };
    hd.addEventListener("pointerup", up);
    hd.addEventListener("pointercancel", up);
    G.trHd = hd;
  }
  sec("武器");
  let g = grid();
  ALLW.forEach((w, i) =>
    btn(g, "ammo", w.c, w.n, () => {
      const m = modW(w);
      m.ms = Math.round(m.ms0 * (1 + 0.1 * UL("mag")));
      m.am = m.ms;
      WP[G.pl.w] = m;
    }),
  );
  sec("敵人");
  g = grid();
  EN.forEach((n, i) =>
    btn(g, "e" + i, ECOL[i], n, () => {
      // 功能：處理「go」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
      const go = (el) => {
        const a = G.pl.aim;
        let p = {
          x: G.pl.x + Math.cos(a) * 220,
          y: G.pl.y + Math.sin(a) * 220,
        };
        if (blocked(p.x, p.y, 16)) p = empty(150, G.pl) || p;
        const m = mkEn(i, p.x, p.y);
        if (el) elify(m, 1);
        G.en.push(m);
        burst(p.x, p.y, el ? EL_COL : "#ffffff", el ? 16 : 8, 120, 2, 0.5);
      };
      if (ELITE[i]) trPick(i, n, ECOL[i], go);
      else go(0);
    }),
  );
  BN.forEach((n, i) =>
    btn(
      g,
      "e" + (14 + i),
      [
        "#ff4d4d",
        "#ffb040",
        "#4dffd8",
        "#d070ff",
        "#ffe14a",
        "#9dff3d",
        "#7a7aff",
        "#ff2a8a",
      ][i],
      n,
      () => {
        const a = G.pl.aim;
        let p = {
          x: G.pl.x + Math.cos(a) * 260,
          y: G.pl.y + Math.sin(a) * 260,
        };
        if (blocked(p.x, p.y, 16)) p = empty(200, G.pl) || p;
        G.en.push(mkEn(14 + i, p.x, p.y));
        burst(p.x, p.y, "#ffffff", 12, 160, 2, 0.5);
      },
    ),
  );
  btn(g, "e22", "#9aa0ab", "肉盾", spawnDummy);
  sec("芯片");
  g = grid();
  CH.map((c, i) => i)
    .sort((a, b) => CH[b].r - CH[a].r || a - b)
    .forEach((i) => {
      const c = CH[i];
      btn(g, "chip", RC[c.r], c.n, () => trChip(i));
      g.lastChild.dataset.chip = i;
      g.lastChild.title = RN[c.r] + " · " + c.d;
    });
  sec("控制");
  g = grid();
  btn(g, null, "#22e6ff", "清除敵人", () => {
    G.en.length = 0;
  });
  btn(g, null, "#3dff8f", "回血", () => {
    G.pl.hp = G.pl.mhp;
  });
  btn(g, null, "#ffe14a", "無敵：開", (b) => {
    G.god = !G.god;
    b.textContent = "無敵：" + (G.god ? "開" : "關");
  });
  btn(g, null, "#4dffd8", "無限彈藥／大招：開", (b) => {
    G.inf = !G.inf;
    b.textContent = "無限彈藥／大招：" + (G.inf ? "開" : "關");
  });
  btn(g, null, "#ff9a3d", "凍結：關", (b) => {
    G.fz = !G.fz;
    b.textContent = "凍結：" + (G.fz ? "開" : "關");
  });
  btn(g, null, "#ff3d9a", "離開", () => quit());
  {
    const rows = [...el.querySelectorAll(".tr-row")],
      tb = document.createElement("div"),
      tg = document.createElement("div");
    tb.className = "tr-row";
    tb.style.order = -1;
    G.trHd.className = "tr-l";
    G.trHd.style.cssText = "cursor:move;touch-action:none;color:#22e6ff";
    G.trHd.textContent = "訓練 ≡";
    tg.className = "tr-b";
    tb.append(G.trHd, tg);
    // 功能：處理「show」相關的遊戲邏輯；具體輸入、狀態變更與副作用以函式內容為準。
    const show = (k) => {
      window._trTab = k;
      rows.forEach((r, i) => (r.style.display = i === k ? "flex" : "none"));
      [...tg.children].forEach((b, i) => {
        b.style.background = i === k ? "#22e6ff33" : "#ffffff0d";
      });
    };
    ["武器", "敵人", "芯片", "控制"].forEach((n, i) => {
      const b = document.createElement("button");
      b.style.borderColor = "#22e6ff";
      b.textContent = n;
      b.onclick = () => show(i);
      tg.append(b);
    });
    el.append(tb);
    show(window._trTab || 0);
  }
  $("trt").onclick = () => el.classList.toggle("h");
}
