/**
 * ui/shop-guide — 新手導覽：帶玩家實際走一次「看錢包 → 商城買芯片包 → 背包裝芯片」
 *
 * 流程（共 11 步，全部在真實介面上操作）：
 *   歡迎 → 錢包 → 點「商城」→ 認識 5 個分區 → 點「芯片包」→ 真的買一包 →
 *   看開到什麼 → 點「背包」→ 認識槽位 → 把芯片裝上去 → 看效果對比 → 完成（可直接去訓練場）
 *
 * 新手補給：玩家第一次進入「購買」步驟時，若晶核不夠買一包普通芯片包，就補到剛好夠（終身只送一次）。
 * 已經買過／晶核不足而且領過補給的人，購買步驟會改成「只看不買」，不會卡住。
 */
import { G } from "../core/game-state.js";
import { KEYS, store } from "../core/save-store.js";
import { fsm } from "../core/state-machine.js";
import { $ } from "../core/viewport.js";
import { CH, RN, chipAvail } from "../game/chips.js";
import { SV, save } from "../game/progress.js";
import { startTrain } from "../game/training.js";
import { ALLWEAPON } from "../game/weapons.js";
import { Coach } from "./coach.js";
import { toast } from "./feedback.js";
import { XPK, XS, xChipTotal, xGo, xSub } from "./menu.js";

export const coach = new Coach();

/** 玩家是否已經走完（或略過）過商店導覽 */
export const isShopGuideDone = () => store.getString(KEYS.shopGuideDone) === "1";
const markDone = () => store.setString(KEYS.shopGuideDone, "1");

const q = (selector) => document.querySelector(selector);
const navTab = (tab) => () => q(`#xn .x-tab[data-t="${tab}"]`);
const mark = (name) => () => q(`#xV [data-coach="${name}"]`);

/* 這次導覽中買到的芯片與起始芯片數（模組內狀態，不放進 G，因為 G 已封口） */
let boughtChip = -1;
let chipsAtStart = 0;

const packCost = () => XPK[0].cost;
const canAffordPack = () => SV.co >= packCost();

const starterGiftGiven = () => store.getString(KEYS.starterGift) === "1";

/** 送一包普通芯片包的晶核，讓導覽中的購買不花玩家自己的資源；終身只送一次（重看導覽不會再送） */
export function grantStarterCores() {
  if (starterGiftGiven()) return;
  store.setString(KEYS.starterGift, "1");
  SV.co += packCost();
  save();
  window.upd?.();
  toast(`新手補給：晶核 +${packCost()}`, { type: "success" });
}

const selectedWeaponName = () => ALLWEAPON.getWeapon()[G.MWI]?.n ?? "這把槍";
const equippedHere = (chip) => (SV.mods[G.MWI] || []).includes(chip);

function buildSteps() {
  return [
    {
      id: "welcome",
      title: "一分鐘學會：商店與芯片",
      body: () => !starterGiftGiven()
        ? "芯片能裝在槍上強化武器。接下來帶你真的買一包、裝到槍上，這次的花費由新手補給負擔（會送你一包的晶核），放心點。"
        : canAffordPack()
          ? `芯片能裝在槍上強化武器。這次導覽會真的買一包，花你自己的 ${packCost()} 晶核；不想花的話可以按右上角「跳過導覽」。`
          : "芯片能裝在槍上強化武器。這次導覽會走過整個流程；你的晶核不夠買芯片包，購買那一步會改成只看不買。",
      nextText: "好，開始！",
    },
    {
      id: "wallet",
      title: "先看看你的錢包",
      target: () => $("xC"),
      body: "三種資源：金幣可以買槍、角色和消耗品；碎片用在基礎強化；晶核用在進階強化，也是開芯片包的貨幣。戰鬥中撿到的、通關結算的都會存進來。",
    },
    {
      id: "go-shop",
      title: "前往商城",
      target: navTab("m"),
      advance: { type: "when", test: () => XS.t === "m" },
      hint: "👆 點亮起的「商城」",
      body: "想變強就從商城開始。",
    },
    {
      id: "shop-areas",
      title: "商城有 5 個分區",
      target: mark("shop-subs"),
      body: "永久升級（碎片或晶核）、槍械（金幣）、消耗品（金幣）、角色（金幣）、芯片包（晶核）。每個商品右邊的按鈕就是價格；錢不夠時按鈕會變灰，並告訴你還差多少。",
    },
    {
      id: "go-packs",
      title: "打開「芯片包」",
      target: mark("shop-sub-pk"),
      enter: () => grantStarterCores(),
      advance: { type: "when", test: () => XS.t === "m" && XS.sh === "pk" },
      hint: "👆 點亮起的「芯片包」",
      body: "芯片是最有彈性的強化方式：每把槍可以裝 2 枚，組合出自己的玩法。",
    },
    {
      id: "buy",
      title: "買下第一個芯片包",
      target: mark("pack-card-0"),
      enter: () => { chipsAtStart = xChipTotal(); boughtChip = -1; },
      advance: () => canAffordPack()
        ? { type: "when", test: () => xChipTotal() > chipsAtStart, delay: 700 }
        : { type: "next" },
      done: () => { if (xChipTotal() > chipsAtStart) boughtChip = G.lastPk?.[0]?.i ?? -1; },
      hint: () => `👆 按下「${packCost()} 晶核」`,
      body: () => canAffordPack()
        ? `普通芯片包 ${packCost()} 晶核，開 1 枚芯片。卡片下方列出每種稀有度的機率，越貴的包機率越好。按下價格按鈕買買看！`
        : `普通芯片包要 ${packCost()} 晶核，你目前不夠，先看看就好。通關和擊敗 Boss 都能拿到晶核，也會掉落芯片。`,
    },
    {
      id: "result",
      title: "開到了什麼？",
      target: mark("pack-result"),
      skipIf: () => boughtChip < 0,
      body: () => {
        const chip = CH[boughtChip];
        const fresh = G.lastPk?.[0]?.nw ? " 標示 NEW 代表第一次獲得。" : "";
        return `你拿到「${chip.n}」（${RN[chip.r]}）：${chip.d}。顏色代表稀有度：普通、優良、稀有、史詩、傳說，越後面越強。${fresh}`;
      },
    },
    {
      id: "go-bag",
      title: "到背包裝上去",
      target: navTab("i"),
      advance: { type: "when", test: () => XS.t === "i" },
      hint: "👆 點亮起的「背包」",
      body: "芯片買了還不會生效，要裝到槍上才算數。",
    },
    {
      id: "slots",
      title: "每把槍有 2 個芯片槽",
      target: mark("bag-slots"),
      body: () => `現在選中的是「${selectedWeaponName()}」。左邊可以換別把槍，這裡是它的 2 個槽位；發亮的那格就是下一枚芯片會裝進去的位置。`,
    },
    {
      id: "install",
      title: "把芯片裝上去",
      target: () => q(`#xV [data-coach="bag-chip-${boughtChip}"]`),
      skipIf: () => boughtChip < 0 || chipAvail(boughtChip) <= 0 || equippedHere(boughtChip),
      enter: () => xSub("rf", -1), // 清掉稀有度篩選，確保剛買的芯片看得到
      advance: { type: "when", test: () => equippedHere(boughtChip) },
      hint: "👆 點亮起的芯片，它會裝進發亮的槽位",
      body: "在右邊的庫存找到剛開到的芯片，點一下就能安裝。",
    },
    {
      id: "compare",
      title: "看改裝前後的差異",
      target: mark("bag-cmp"),
      skipIf: () => boughtChip < 0,
      body: "這張表即時顯示「改裝前 → 改裝後」：綠色代表變強，紅色代表有所取捨。有些芯片是戰鬥中才觸發的特效，數字不會變，請看芯片說明。不滿意隨時可以按「拆下」換別枚。",
    },
    {
      id: "finish",
      title: "完成！",
      body: "你已經會了：看錢包 → 商城購買 → 背包裝芯片。想馬上試試手感，可以去訓練場：能直接叫出敵人、不會死亡，所有芯片都能免費試用。想跨裝置同步進度，之後可到「個人檔案 → 雲端同步」登入（選用）。",
      actions: [
        { label: "去訓練場試試", primary: true, run: () => startTrain() },
        { label: "回大廳", run: () => xGo("h") },
      ],
    },
  ];
}

/** 開始導覽（第一次遊玩、從大廳提示卡、或從設定重看都走這裡） */
export function startShopGuide() {
  if (coach.running) return;
  if (!fsm.is("menu")) return; // 戰鬥中不開導覽
  boughtChip = -1;
  chipsAtStart = xChipTotal();
  xGo("h");
  coach.start(buildSteps(), {
    onFinish: markDone,
    onSkip: () => { markDone(); toast("導覽已略過，之後可到「個人檔案 → 設定」重看。"); },
    shouldAbort: () => $("ov").classList.contains("h"), // 選單被關掉（例如開始戰鬥）就中止，不標記完成
  });
}

/**
 * 大廳的「下一步建議」：依存檔狀況給一個最有用的提示（沒有就回傳 null）
 * @returns {{text: string, label: string, run: () => void} | null}
 */
export function suggestNextStep() {
  const tutorialSeen = store.getString(KEYS.tutorialDone) === "1";
  if (tutorialSeen && !isShopGuideDone()) {
    return { text: "新手導覽：實際買一次芯片並裝到槍上，約 1 分鐘。", label: "開始導覽", run: startShopGuide };
  }
  const free = CH.reduce((sum, _, i) => sum + Math.max(0, chipAvail(i)), 0);
  const slotsOpen = G.LO.some((w) => (SV.mods[w] || []).filter((c) => c >= 0 && CH[c] !== undefined).length < 2);
  if (free > 0 && slotsOpen) {
    return { text: `你有 ${free} 枚芯片還沒裝上，裝上去就能變強。`, label: "前往背包", run: () => xGo("i") };
  }
  if (xChipTotal() === 0 && SV.co >= packCost()) {
    return { text: `你有 ${SV.co} 晶核，可以開芯片包了。`, label: "前往芯片包", run: () => { XS.sh = "pk"; xGo("m"); } };
  }
  return null;
}
