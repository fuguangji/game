/**
 * game/tutorial-common — 電腦版與手機版教學共用的「場景型」步驟
 * （敵人、牆、補血這些與輸入方式無關的關卡）。文字不分平台，只有需要提到操作的地方才由
 * tutorial-desktop.js／tutorial-mobile.js 自己寫。helpers 由 tutorial.js 注入，避免模組互相引用。
 */
import { G } from "../core/game-state.js";
import { N, T } from "../core/viewport.js";
import { cell, empty } from "./battle.js";

/**
 * @param {{ aheadOfPlayer: Function, spawnTutorialEnemy: Function, spawnDummies: Function, respawnUntilKilled: Function, spawnHealPack: Function }} h
 */
export function commonSteps(h) {
  const { aheadOfPlayer, spawnTutorialEnemy, spawnDummies, respawnUntilKilled, spawnHealPack } = h;
  return {
    wall: {
      title: "破牆",
      text: "彩色方塊能被子彈打碎：顏色越偏暖色，牆壁損壞度越高；紫色叉叉牆無論任何武器都打不壞。試著打碎前方 3 塊牆！",
      tip: "牆是掩體也是路障——打碎它可以開路，留著它可以擋子彈。",
      setup: (ctl) => {
        const a = aheadOfPlayer(T * 3);
        const ci = Math.floor(a.x / T), cj = Math.floor(a.y / T);
        const horizontal = Math.abs(Math.cos(G.pl.aim)) < Math.abs(Math.sin(G.pl.aim));
        const placed = [];
        for (let d = -1; d <= 1; d++) {
          const i = ci + (horizontal ? d : 0), j = cj + (horizontal ? 0 : d);
          if (cell(i, j) === 0) { G.grid[i + j * N] = 2; placed.push(i + j * N); }
        }
        while (placed.length < 3) { // 前方被擋時改放別處
          const q = empty(150, G.pl);
          if (!q) break;
          const i = Math.floor(q.x / T), j = Math.floor(q.y / T);
          G.grid[i + j * N] = 2;
          placed.push(i + j * N);
        }
        ctl.walls = placed;
      },
      progress: (s) => s.walls / 3,
    },
    kill: {
      title: "擊敗敵人",
      text: "擊敗 2 個靜止的追擊靶！命中會把敵人擊退，擊退力強的武器更容易拉開距離。",
      tip: "敵人被擊敗會掉金幣與補給；金幣可以在商店買芯片強化武器。",
      setup: () => spawnDummies(2),
      keep: (ctl) => { if (G.en.length === 0 && (ctl.stats.kills || 0) < 2) spawnDummies(2 - (ctl.stats.kills || 0)); },
      progress: (s) => s.kills / 2,
    },
    sniper: {
      title: "閃避狙擊",
      text: "狙擊敵人開火前會出現紅色虛線（約 0.45 秒）。看到就移動或衝刺閃開，再把它擊倒！",
      tip: "紅線出現的那一刻不要站在線上；橫向移動比後退更有效。",
      setup: () => { const a = aheadOfPlayer(260); spawnTutorialEnemy(1, a.x, a.y, false); },
      keep: respawnUntilKilled(1, 1, false),
      progress: (s) => s.kills,
    },
    spread: {
      title: "閃避散射",
      text: "散射敵人一次射出 5 發扇形子彈，紅色虛線就是彈道。往彈道之間的縫隙移動，或衝刺穿過去，再擊倒它。",
      tip: "貼近散射敵人時彈道最密；拉開距離，縫隙才會變大。",
      setup: () => { const a = aheadOfPlayer(260); spawnTutorialEnemy(2, a.x, a.y, false); },
      keep: respawnUntilKilled(2, 1, false),
      progress: (s) => s.kills,
    },
    bomb: {
      title: "地面炸彈",
      text: "投擲敵人會在你腳下丟出紅色圓圈炸彈，圈填滿就爆炸，也會炸毀方塊。看到圈就離開，再擊倒它。",
      tip: "炸彈的範圍就是紅圈的大小；炸彈炸掉的牆也會讓敵人的子彈穿過去。",
      setup: () => { const a = aheadOfPlayer(260); spawnTutorialEnemy(3, a.x, a.y, false); },
      keep: respawnUntilKilled(3, 1, false),
      progress: (s) => s.kills,
    },
    barrage: {
      title: "彈幕",
      text: "體驗用衝刺和移動閃避彈幕！血量已鎖住，放心試試看擊敗他們。",
      tip: "不要一直後退——繞圈移動、讓子彈追不上你，比直線逃跑安全。",
      setup: () => {
        const a = aheadOfPlayer(260);
        for (let k = 0; k < 4; k++) spawnTutorialEnemy(2, a.x, a.y, false);
      },
      keep: respawnUntilKilled(2, 4, false),
      progress: (s) => s.kills / 4,
    },
    heal: {
      title: "補血",
      text: "血量被降低了。走到綠色十字上回復血量；撿取物掉在地上一段時間後會消失。",
      tip: "戰鬥中血量低時，優先撿補給，不要硬打。",
      setup: () => { if (G.pl.hp >= 100) G.pl.hp = 40; spawnHealPack(); },
      keep: () => { if (G.pl.hp < 65 && !G.pk.some((q) => q.t === "heal")) spawnHealPack(); },
      progress: () => Math.max(0, (G.pl.hp - 40) / 25),
    },
  };
}
