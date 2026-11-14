/**
 * game/tutorial-desktop — 電腦版戰鬥教學（鍵盤 + 滑鼠）
 * 每一步：title 標題、text 說明、tip 補充提示（選填）、progress 完成度 0~1（由操作統計判定）。
 */
import { G } from "../core/game-state.js";
import { WP } from "./weapons.js";

export function desktopSteps(h) {
  const { aheadOfPlayer, spawnTutorialEnemy, spawnDummies, common } = h;
  return [
    {
      title: "移動",
      text: "按 W A S D 在場地中移動。試著走一小段路！",
      tip: "斜向移動（例如 W+D）速度不會變快。",
      progress: (s) => s.moved / 200,
    },
    {
      title: "瞄準",
      text: "移動滑鼠，角色前方的瞄準線會跟著轉動。試著轉約一圈！",
      tip: "瞄準線的方向就是子彈的方向。",
      progress: (s) => s.aimed / 6,
    },
    {
      title: "射擊",
      text: "按滑鼠左鍵射擊（可連射的槍可以按住不放）。試著開火 5 次！",
      tip: "不同的槍有不同的射速、傷害與擊退，之後可以在「備戰」裡挑選。",
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
      text: "按 1 / 2 或 Q 切換武器。可以在「備戰」裝備第 2 把術式武器；只裝備 1 把會自動略過這一步。",
      tip: "每把武器各自累積大招能量與彈藥，戰況不同時換槍很有用。",
      progress: (s) => (WP.length < 2 ? 1 : s.switches / 2),
    },
    {
      title: "選定技能",
      text: "術式武器除了普通攻擊還有技能。畫面下方有一排格子，第一格「普攻」是普通攻擊。滾動滑鼠滾輪，可以切換「目前選定」的格子（亮框的那一格）。",
      tip: "也可以直接點下方的技能按鈕，或按 Z X C V B N 對應的技能。試著選到任何一個技能！",
      setup: () => { G.pl.en = G.pl.enMax; },
      keep: () => { if (G.pl.en < 30) G.pl.en = 30; },
      progress: (s) => s.selects / 1,
    },
    {
      title: "施放技能",
      text: "選定技能後，按滑鼠左鍵就會朝滑鼠位置發動（地面技能落在滑鼠指的地方）。技能消耗能量，能量會自己回復。試著發動 2 次！",
      tip: "按 Z X C V B N 可以不用切換、直接施放對應的技能；選回「普攻」才能再用左鍵開槍。",
      setup: () => { G.pl.en = G.pl.enMax; },
      keep: () => { if (G.pl.en < 30) G.pl.en = 30; },
      progress: (s) => s.skills / 2,
    },
    {
      title: "自動瞄準",
      text: "角色周圍的瞄準虛線圈內，會自動瞄準最近的敵人（顯示黃色圈）。試著大致朝靶射擊 3 次！",
      tip: "按 R 切換自動瞄準模式（手動／修正附近／較大範圍），也可以到「個人檔案→設定」調整。",
      setup: () => { G.AA = 1; const a = aheadOfPlayer(130); spawnTutorialEnemy(0, a.x, a.y, true); },
      keep: h.respawnUntilKilled(0, 99, true),
      progress: (s) => s.auto / 3,
    },
    {
      title: "衝刺",
      text: "按 Shift 衝刺！衝刺期間完全無敵，能直接穿過槍林彈雨，但有冷卻時間。試著衝刺 2 次！",
      tip: "衝刺的方向是你正在移動的方向；原地按則朝瞄準方向衝。",
      progress: (s) => s.dashes / 2,
    },
    common.wall,
    common.kill,
    common.sniper,
    common.spread,
    common.bomb,
    {
      title: "術式場",
      text: "命中敵人會累積大招能量，每把武器各自累積，蓄滿後可以展開「術式場」，在範圍內改寫戰場規則。這次已幫你蓄滿，按空白鍵展開！",
      tip: "展開中有些術式場會鎖住技能或接管數字鍵，要仔細看說明。",
      setup: () => { spawnDummies(2); G.pl.ult = 100; },
      keep: (ctl) => {
        if ((ctl.stats.supers || 0) < 1 && G.pl.ult < 100) G.pl.ult = 100;
        if (G.en.length === 0 && (ctl.stats.supers || 0) < 1) spawnDummies(2);
      },
      progress: (s) => s.supers,
    },
    {
      title: "暫停",
      text: "按 P 或 Esc 暫停，再按一次繼續。暫停選單可以放棄本局。這一步請暫停後再繼續遊戲。",
      tip: "按 F 可以切換全螢幕。",
      progress: (s) => s.pauses,
    },
    common.barrage,
    common.heal,
  ];
}
