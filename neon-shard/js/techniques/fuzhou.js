/** 符咒:冰／火／雷／毒
 * | 工具 | 用途 |
|---|---|
| `aoe(x, y, r, dmg, { kb, fx, burn, tag, walls })` | 圓形範圍傷害；`fx` 是對敵人施加的效果清單，如 `[["seal", { duration: 5 }]]` |
| `cone(x, y, 角度, 距離, 弧度, dmg, { cutBullets })` | 扇形，可同時擊落敵方子彈 |
| `beam(x, y, 角度, 長度, 寬度, dmg, { pierceWalls, first, fx })` | 瞬間命中的射線 |
| `field({ x, y, r, t, col, every, dmg, each, tick, follow })` | 持續範圍場（次術式場、燃燒地面） |
| `domain({ x, y, r, t, color, update, draw, lockSkills, blind, confine, onDigit })` | 展開術式場（同時只有一個） |
| `addFx({ t, update, draw, end, skill, release })` | 任意持續效果；寫 `skill` 與 `release` 就能做「再按一次釋放」 |
| `hitEnemy(e, dmg)`、`enemiesIn`、`bulletsIn`、`nearestEnemy`、`moveAlong`、`healPlayer`、`ring`、`strokeRing` | 其他輔助 |

玩家身上的效果加在 `js/game/status-effects.js` 的 `STATUS`，敵人身上的加在 `js/game/enemy-effects.js` 的 `ENEMY_FX`（見 README）。

技能的欄位：`name`、`cost`（數字，或 `(ctx) => 數字`）、`cd`、`backlash`（反噬，最大生命比例）、`hpCost`（生命代價）、`desc`（必填）、`cast(ctx)`。
`ctx` 有 `p`（玩家）、`aim`（瞄準角度）、`x, y`（瞄準點）、`dist`、`target`（瞄準點附近的敵人）。
 */
import { G } from "../core/game-state.js";
import { TAU } from "../core/viewport.js";
import { applyEnemyFx } from "../game/enemy-effects.js";
import { later } from "../game/ultimates.js";
import { applyStatus } from "../game/status-effects.js";
import {
  aoe,
  beam,
  domain,
  enemiesIn,
  registerTechnique,
  ring,
  field,
} from "../game/techniques.js";
import { WP } from "../game/weapons.js";
import { burst, turLand } from "../game/world-helpers.js";
import { bar } from "../ui/hud.js";

registerTechnique({
  weapon: "符咒",
  color: "#5edfff",
  skills: [
    {
      name: "冰",
      cost: 15,
      cd: 1.5,
      backlash: 0.02,
      desc: "朝前方射出冰符咒，命中的敵人受到冰凍（1.2 秒）",
      cast({ p, x, y }) {
        const a = Math.atan2(y - p.y, x - p.x),
          d = Math.min(Math.hypot(x - p.x, y - p.y), 380);
        const cx0 = p.x + Math.cos(a) * d,
          cy0 = p.y + Math.sin(a) * d;
        field({
          x: cx0,
          y: cy0,
          r: 190,
          t: 5,
          col: "#5edfff",
          every: 0.35,
          dmg: 6,
          tag: "water",
          each(dt, f) {
            for (const e of enemiesIn(f.x, f.y, f.r))
              applyEnemyFx(e, "frozen", { duration: 1.2 });
          },
          tick(f) {
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              const q = Math.random() * TAU;
              e.kx += (Math.cos(q) * 600) / e.m;
              e.ky += (Math.sin(q) * 600) / e.m;
            }
          },
          draw(cx, f) {
            const TAU = Math.PI * 2;
            const time = Date.now() * 0.001; // 動態波動（若不需要動態，可將 time 設為固定常數）

            cx.save();
            // 1. 冰裂紋的晶瑩色調：使用極亮藍白色，搭配輕微發光
            cx.strokeStyle = "#e8f8ff";
            cx.lineWidth = 1.2;
            cx.lineJoin = "miter"; // 讓折角保持銳利
            cx.globalAlpha = 0.6;

            cx.shadowColor = "#93c5fd"; // 淡藍色擬真冰發光
            cx.shadowBlur = 4;

            // 9 條主裂紋脈絡
            for (let k = 0; k < 9; k++) {
              // 固定的基礎發散角度，加上一點點 k 的交錯擾動
              const baseAngle = (k * TAU) / 9 + 0.3;

              cx.beginPath();
              cx.moveTo(f.x, f.y);

              // 2. 冰裂紋段數：每一條裂紋由 3 個不規則折線段（Segment）串接而成
              let currentX = f.x;
              let currentY = f.y;
              const segments = 3;

              for (let s = 1; s <= segments; s++) {
                // 比例進度 (0.33, 0.66, 1.0)
                const progress = s / segments;

                // 3. 冰裂隨機擾動：利用正弦波與索引值，計算出每個折點的「角度偏折」與「長度縮放」
                // 加入極微量的 time * 0.05 讓冰裂紋有非常緩慢、不易察覺的冰晶生長動態
                const angleNoise =
                  Math.sin(k * 4.5 + s * 12.3 + time * 0.05) * 0.25;
                const lengthNoise = 0.8 + 0.3 * Math.cos(k * 7.1 + s * 3.4);

                const segmentAngle = baseAngle + angleNoise;
                const segmentDist = f.r * progress * lengthNoise;

                // 計算此折點的座標
                const nextX = f.x + Math.cos(segmentAngle) * segmentDist;
                const nextY = f.y + Math.sin(segmentAngle) * segmentDist;

                // 4. 連線至下一個折點
                cx.lineTo(nextX, nextY);

                // 5. 冰裂分叉（細微支脈）：在主裂紋的半途，隨機向外抽出一根細小的側裂紋
                if (s === 2 && k % 2 === 0) {
                  cx.save();
                  cx.lineWidth = 0.6; // 支脈比較細
                  cx.globalAlpha = 0.4;

                  // 往左或往右偏折較大的角度 (約 45 ~ 60 度)
                  const forkAngle = segmentAngle + (k % 4 === 0 ? 0.9 : -0.9);
                  const forkDist = segmentDist + f.r * 0.2;

                  cx.moveTo(nextX, nextY);
                  cx.lineTo(
                    f.x + Math.cos(forkAngle) * forkDist,
                    f.y + Math.sin(forkAngle) * forkDist,
                  );
                  cx.stroke();
                  cx.restore();
                }

                // 迭代座標
                currentX = nextX;
                currentY = nextY;
              }

              // 繪製整條主裂紋
              cx.stroke();
            }

            cx.restore();
          },
        });
      },
    },
    {
      name: "火",
      cost: 25,
      cd: 3,
      color: "#ff8a5a",
      backlash: 0.05,
      desc: "朝前方射出 5 道符咒，命中的敵人受到燃燒",
      cast({ p, x, y }) {
        const a = Math.atan2(y - p.y, x - p.x);
        for (const k of [-0.3, -0.15, 0, 0.15, 0.3])
          beam(p.x, p.y, a + k, 520, 14, 14, {
            col: "#ff8a5a",
            fx: [["burn", { duration: 10, stacks: 2 }]],
          });
      },
    },
    {
      name: "雷",
      cost: 30,
      cd: 4,
      backlash: 0.05,
      color: "#fded0f",
      desc: "以自身為中心召喚雷擊，命中的敵人受到麻痺（2 秒）",
      cast({ p, x, y }) {
        aoe(x, y, 170, 30, { kb: 100, walls: 10 });
        field({
          x,
          y,
          r: 130,
          t: 1,
          fx: [["shock", { duration: 2 }]],
          col: "#fded0f",
          every: 0.3,
          dmg: 1,
          draw(cx, f) {
            const TAU = Math.PI * 2;
            // 1. 取得超高頻率的時間齒輪，讓閃電每幀都在瘋狂顫抖
            const time = Date.now() * 0.001;

            cx.save();
            // 2. 雷電終極發光模式：重疊處會融合成耀眼的白光
            cx.globalCompositeOperation = "screen";
            cx.lineJoin = "miter";
            cx.miterLimit = 4; // 讓閃電的折角保持極度尖銳

            // 3. 高頻率閃爍與明滅邏輯
            // 模擬閃電「劈下後消失，再劈下」的隨機跳動感，有 30% 的機率完全不顯示（造成驟盲閃爍感）
            const strikeFlicker = Math.sin(time * 60); // 每秒震盪 60 次的極速波
            if (strikeFlicker < -0.4) {
              cx.restore();
              return;
            }

            // 9 條向四面八方劈開的雷電主幹
            for (let k = 0; k < 9; k++) {
              // 基礎雷擊方向
              const baseAngle = (k * TAU) / 9;

              // 4. 雷擊主幹：設定為超亮核心（白藍色），線條較粗
              cx.strokeStyle = "#ffffff";
              cx.lineWidth = 2.0;
              cx.shadowColor = "#3b82f6"; // 強烈的電弧藍色外發光（可換成 #a855f7 變成紫電）
              cx.shadowBlur = 10;
              cx.globalAlpha = 0.9;

              cx.beginPath();
              cx.moveTo(f.x, f.y);

              let currentX = f.x;
              let currentY = f.y;
              const segments = 4; // 4 段高密度的劇烈折線

              for (let s = 1; s <= segments; s++) {
                const progress = s / segments;

                // 5. 雷擊隨機擾動 (Chaos Noise)：
                // 這裡乘以 120 配合 time，能創造出每幀完全不同、毫無幾何規律的狂暴折角
                const lightningChaos = Math.sin(
                  k * 23.13 + s * 45.67 + time * 120,
                );

                // 讓角度產生高達 ±45 度的劇烈偏折
                const segmentAngle = baseAngle + lightningChaos * 0.8;
                // 長度同樣隨機縮放，製造鋸齒感
                const segmentDist =
                  f.r *
                  progress *
                  (0.8 + 0.4 * Math.cos(k * 12.3 + s * 8.9 + time * 80));

                const nextX = f.x + Math.cos(segmentAngle) * segmentDist;
                const nextY = f.y + Math.sin(segmentAngle) * segmentDist;

                cx.lineTo(nextX, nextY);

                // 6. 閃電分支 (Branches)：主幹劈到一半時，分支出更細、更淡的微小電弧
                if (s >= 2 && (k + s) % 3 === 0) {
                  cx.save();
                  cx.lineWidth = 0.8; // 分支電弧變細
                  cx.strokeStyle = "#93c5fd"; // 偏藍的外圍電弧
                  cx.shadowBlur = 4;

                  // 分支角度偏折極大（甚至往橫向劈開）
                  const forkChaos = Math.cos(k * 45.1 + s * 12.9 + time * 150);
                  const forkAngle = segmentAngle + (forkChaos > 0 ? 1.2 : -1.2);
                  const forkDist =
                    segmentDist + f.r * 0.25 * (0.5 + 0.5 * forkChaos);

                  cx.moveTo(nextX, nextY);
                  cx.lineTo(
                    f.x + Math.cos(forkAngle) * forkDist,
                    f.y + Math.sin(forkAngle) * forkDist,
                  );
                  cx.stroke();
                  cx.restore();
                }

                currentX = nextX;
                currentY = nextY;
              }

              // 繪製該條雷擊主幹
              cx.stroke();
            }

            cx.restore();
          },
        });
        G.shake = Math.max(G.shake, 12);
      },
    },
    {
      name: "毒",
      cost: 10,
      cd: 5,
      backlash: 0.02,
      color: "#5effd7",
      desc: "展開毒霧",
      cast({ p, x, y }) {
        const a = Math.atan2(y - p.y, x - p.x),
          d = Math.min(Math.hypot(x - p.x, y - p.y), 380);
        const cx0 = p.x + Math.cos(a) * d,
          cy0 = p.y + Math.sin(a) * d;
        field({
          x: cx0,
          y: cy0,
          r: 150,
          t: 5,
          col: "#5effd7",
          every: 0.35,
          dmg: 6,
          tag: "water",
          each(dt, f) {
            for (const e of enemiesIn(f.x, f.y, f.r))
              applyEnemyFx(e, "frozen", { duration: 1.2 });
          },
          tick(f) {
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              const q = Math.random() * TAU;
              e.kx += (Math.cos(q) * 600) / e.m;
              e.ky += (Math.sin(q) * 600) / e.m;
            }
          },
          draw(cx, f) {
            const TAU = Math.PI * 2;
            const time = Date.now() * 0.001;

            cx.save();
            // 1. 毒系核心色調：使用極致的螢光毒綠色，重疊時產生濃稠的高亮酸蝕感
            cx.globalCompositeOperation = "screen";
            cx.lineJoin = "round"; // 徹底捨棄閃電的銳角，改用圓滑轉角模擬液態黏稠感
            cx.lineCap = "round";

            cx.strokeStyle = "#a7f3d0"; // 核心：帶白光的淺螢光綠
            cx.shadowColor = "#059669"; // 外發光：深邃的毒腺綠
            cx.shadowBlur = 12;

            // 9 條向外蔓延、溶解的毒素主脈絡
            for (let k = 0; k < 9; k++) {
              // 利用質數讓 9 條脈絡的內外長度完全錯開，製造不規則的液體擴散邊緣
              const pulseOffset = Math.sin(time * 3.5 + k * 7.3);
              const currentRadius = f.r * (0.7 + 0.3 * pulseOffset);

              // 基礎方向
              const baseAngle = (k * TAU) / 9;

              cx.beginPath();
              cx.moveTo(f.x, f.y);

              let currentX = f.x;
              let currentY = f.y;
              const segments = 3; // 3 段黏稠的液態折線

              for (let s = 1; s <= segments; s++) {
                const progress = s / segments;

                // 2. 模擬液體表面張力的「拉扯與抖動」
                // time * 25 的中高頻率，讓毒素絲像強酸一樣在邊緣不斷腐蝕跳動
                const poisonWobble = Math.sin(k * 14.5 + s * 22.1 + time * 25);

                const segmentAngle = baseAngle + poisonWobble * 0.25; // 微幅偏折，維持流體延伸感
                const segmentDist = currentRadius * progress;

                const nextX = f.x + Math.cos(segmentAngle) * segmentDist;
                const nextY = f.y + Math.sin(segmentAngle) * segmentDist;

                // 3. 隨著脈絡向外延伸，線條要像流體拉絲一樣「越來越細」
                cx.lineWidth = Math.max(1.0, (3.5 / G.S) * (1.1 - progress));
                cx.lineTo(nextX, nextY);

                // 4. 毒素冒泡 / 毒孢子（Poison Spores）
                // 在毒絲的節點上，隨機膨脹出圓形的毒液泡泡
                if (s >= 2 && (k + s) % 2 === 0) {
                  cx.save();
                  // 泡泡大小隨著時間做不規則的呼吸膨脹 (模擬沸騰冒泡)
                  const bubbleRadius =
                    (1.5 + 1.5 * Math.sin(time * 15 + k * 8)) / G.S;

                  cx.beginPath();
                  cx.arc(nextX, nextY, Math.max(0.5, bubbleRadius), 0, TAU);

                  // 毒泡泡內層填滿螢光色，外層維持綠色發光
                  cx.fillStyle = "#ecfdf5";
                  cx.fill();
                  cx.restore();
                }

                currentX = nextX;
                currentY = nextY;
              }

              // 繪製該條劇毒脈絡
              cx.stroke();
            }

            cx.restore();
          },
        });
      },
    },
  ],
  domains: [
    {
      name: "噬血符",
      color: "#5edfff",
      desc: "術式場（12 秒，半徑 10 公尺）：範圍內敵人受到火雷冰毒的持續傷害與效果，玩家也會受到3級中毒",
      backlash: 0.5,
      cost: 60,
      cast({ p }) {
        domain({
          x: p.x,
          y: p.y,
          r: 1000,
          t: 12,
          color: "#5edfff",
          update(dt, f) {
            for (const e of enemiesIn(f.x, f.y, f.r)) {
              applyEnemyFx(e, "poison", { duration: 1.5, stacks: 2 });
              applyEnemyFx(e, "frozen", { duration: 1.2 });
              applyEnemyFx(e, "burn", { duration: 1.5, stacks: 2 });
              applyEnemyFx(e, "shock", { duration: 1.5, stacks: 2 });
            }
            applyStatus(p, "poison", { duration: 1.5, stacks: 3 });
            if (Math.random() < dt * 14) {
              const a = Math.random() * TAU,
                d = Math.random() * f.r;
              burst(
                f.x + Math.cos(a) * d,
                f.y + Math.sin(a) * d,
                "#5edfff",
                1,
                40,
                3,
                0.9,
              );
            }
          },
        });
      },
    },
  ],
});
