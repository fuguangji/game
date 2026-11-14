/**
 * game/tutorial-mobile — 手機版戰鬥教學（觸控）
 *
 * 手機的核心觀念只有三個，所以教學特別拆開反覆練習：
 *   左半邊 = 移動搖桿；右半邊 = 瞄準搖桿，放開 = 發射；
 *   技能：「點技能鈕選定 → 拖曳瞄準 → 放開施放」，把搖桿拖回中心放開 = 取消。
 */
import { G } from "../core/game-state.js";
import { WP } from "./weapons.js";

export function mobileSteps(h) {
  const { aheadOfPlayer, spawnTutorialEnemy, spawnDummies, common } = h;
  return [
    {
      title: "移動搖桿",
      text: "用左半邊螢幕移動：手指按在左半邊任何地方，往想去的方向拖曳，就會出現移動搖桿。試著走一小段路！",
      tip: "手指離開螢幕角色就會停下；拖得越遠，搖桿越明顯。",
      progress: (s) => s.moved / 200,
    },
    {
      title: "瞄準搖桿",
      text: "右半邊螢幕是瞄準搖桿：手指按在右半邊並拖曳，瞄準線就會朝拖曳方向轉動。試著轉約一圈！",
      tip: "搖桿中心有一圈虛線（死區）——手指要拖出虛線圈才算「瞄準」。",
      progress: (s) => s.aimed / 6,
    },
    {
      title: "放開射擊",
      text: "在右半邊拖曳瞄準後，放開手指就會發射。試著射擊 5 次！",
      tip: "輕點右半邊（不拖曳）會朝自動瞄準的目標快速開一槍；可連射的槍，按住拖曳會持續開火。",
      progress: (s) => s.shots / 5,
    },
    {
      title: "彈藥數量",
      text: "每次射擊都會消耗彈藥（畫面下方右側的彈藥條）。把目前彈匣打光，再等它自動回復一發！",
      tip: "彈藥用完不會卡死，會慢慢回復——但打空的那段時間最危險。",
      noRefill: true,
      setup: () => { const w = WP[G.pl.w]; w.am = w.ms; },
      progress: (s) => s.emptied ? (WP[G.pl.w].am >= 1 ? 1 : 0.7) : Math.min(0.6, (s.shots / WP[G.pl.w].ms) * 0.6),
    },
    {
      title: "換槍",
      text: "點畫面下方的槍欄就能切換武器，也可以拖曳互換位置。試著切換 2 次！（只裝備 1 把武器會自動略過這一步）",
      tip: "每把武器各自累積大招能量與彈藥，戰況不同時換槍很有用。",
      progress: (s) => (WP.length < 2 ? 1 : s.switches / 2),
    },
    {
      title: "技能①：點選",
      text: "術式武器有技能。畫面右側有一排技能鈕，第一顆「普攻」是普通攻擊。點任何一顆技能鈕，只會「選定」它，不會立刻發動——被選定的鈕會亮框，右下的瞄準搖桿也會變成技能的顏色。",
      tip: "點錯了？再點一次同一顆就會取消選定；點「普攻」也可以切回普通攻擊。試著選定一個技能！",
      setup: () => { G.pl.en = G.pl.enMax; },
      keep: () => { if (G.pl.en < 30) G.pl.en = 30; },
      progress: (s) => s.selects / 1,
    },
    {
      title: "技能②：瞄準並放開",
      text: "選定技能後，在右半邊拖曳瞄準搖桿：角色前方會出現技能落點預覽（圈圈的位置就是落點，搖桿拖得越遠落點越遠）。放開手指，技能才會發動。試著發動 2 次！",
      tip: "發動成功後會自動切回普通攻擊，要再用技能就再點一次技能鈕。",
      setup: () => { G.pl.en = G.pl.enMax; },
      keep: () => { if (G.pl.en < 30) G.pl.en = 30; },
      progress: (s) => s.skills / 2,
    },
    {
      title: "技能③：取消施放",
      text: "瞄準到一半後悔了？把搖桿「拖回中心的虛線圈裡」再放開，就會取消，不會發動也不會扣能量（搖桿下方會顯示「放開取消」）。選定一個技能，拖出去再拖回中心放開試試！",
      tip: "取消後技能仍保持選定，可以馬上重新瞄準。",
      setup: () => { G.pl.en = G.pl.enMax; },
      keep: () => { if (G.pl.en < 30) G.pl.en = 30; },
      progress: (s) => s.cancels / 1,
    },
    {
      title: "自動瞄準",
      text: "角色周圍的瞄準虛線圈內，會自動瞄準最近的敵人（顯示黃色圈）。試著大致朝靶射擊 3 次！",
      tip: "可以到「個人檔案→設定」調整自動瞄準模式（手動／修正附近／較大範圍）。",
      setup: () => { G.AA = 1; const a = aheadOfPlayer(130); spawnTutorialEnemy(0, a.x, a.y, true); },
      keep: h.respawnUntilKilled(0, 99, true),
      progress: (s) => s.auto / 3,
    },
    {
      title: "衝刺",
      text: "點右下角的 DASH 鈕衝刺！衝刺期間完全無敵，能直接穿過槍林彈雨，但有冷卻時間。試著衝刺 2 次！",
      tip: "按住 DASH 並往某個方向拖曳再放開，可以指定衝刺方向。",
      progress: (s) => s.dashes / 2,
    },
    common.wall,
    common.kill,
    common.sniper,
    common.spread,
    common.bomb,
    {
      title: "術式場",
      text: "命中敵人會累積大招能量，蓄滿後可以展開「術式場」，在範圍內改寫戰場規則。這次已幫你蓄滿，點 SUPER 鈕展開！",
      tip: "按住 SUPER 往某個方向拖曳再放開，可以指定術式場展開的方向與距離。",
      setup: () => { spawnDummies(2); G.pl.ult = 100; },
      keep: (ctl) => {
        if ((ctl.stats.supers || 0) < 1 && G.pl.ult < 100) G.pl.ult = 100;
        if (G.en.length === 0 && (ctl.stats.supers || 0) < 1) spawnDummies(2);
      },
      progress: (s) => s.supers,
    },
    {
      title: "暫停",
      text: "點左上角的暫停鈕暫停，再按「繼續」。暫停選單可以放棄本局。這一步請暫停後再繼續遊戲。",
      tip: "點右上角的全螢幕鈕可以讓畫面更大。",
      progress: (s) => s.pauses,
    },
    common.barrage,
    common.heal,
  ];
}
