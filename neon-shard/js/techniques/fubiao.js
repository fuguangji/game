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
  weapon: "泱懸伏鏢",
  color: "#501aa7",
  skills: [
    {
      name: "伏鏡",
      cost: 15,
      cd: 1.5,
      backlash: 0.02,
      desc: "在自身建立起屏障，每一次的攻擊都賦予恐懼",
      cast({ p, x, y }) {
        applyStatus(p,"guard",{duration:5})
        field({
          x: x,
          y: y,
          r: 190,
          t: 3,
          col: "#280c55",
          every: 0.35,
          dmg: 0,
          tag: "water",
          each(dt, f) {
            for (const e of enemiesIn(f.x, f.y, f.r))
              applyEnemyFx(e, "afraid", { duration: 1.2 });
          },
          draw(cx, f) {
            const TAU = Math.PI * 2;
            // 1. 生命週期計時：隨著時間（這裡設定約 2 秒一循環），模擬從「完好 -> 碎裂 -> 剝離飛散」
            const time = Date.now() * 0.001;
            const progress = (time * 0.5) % 1.0;

            cx.save();
            // 2. 鏡面折射色調：高亮白邊，半透明的晶瑩藍白填充
            cx.lineJoin = "miter";
            cx.miterLimit = 4;

            // 預先計算 9 個碎片的頂點角度（讓每塊碎片的形狀完全隨機且固定）
            const angles = [];
            for (let k = 0; k <= 9; k++) {
              // 基礎角度加上一個基於質數的固定亂數擾動，打破完美的圓形分割
              const noise = Math.sin(k * 23.45) * 0.15;
              angles.push((k * TAU) / 9 + noise);
            }

            // 繪製 9 塊不規則的幾何三角碎片
            for (let k = 0; k < 9; k++) {
              const angle1 = angles[k];
              const angle2 = angles[k + 1];

              // 3. 碎裂解體物理：隨著 progress 增加，碎片產生往外剝離的「位移」與「旋轉」
              // 越往外飛，動作越明顯。利用指數曲線讓爆發瞬間更有衝擊力
              const pushForce = Math.pow(progress, 2.5);
              const moveAngle = (angle1 + angle2) / 2; // 碎片的中心發散方向

              const maxOffset = f.r * 0.4; // 最大飛散位移
              const offsetX = Math.cos(moveAngle) * maxOffset * pushForce;
              const offsetY = Math.sin(moveAngle) * maxOffset * pushForce;

              // 4. 計算碎片的三個幾何頂點（相對於中心 f.x, f.y）
              // 頂點 1：中心點（會隨著碎片一起往外位移）
              const p0x = f.x + offsetX;
              const p0y = f.y + offsetY;

              // 頂點 2 & 3：外圍弧線上的兩個不規則點（長度也加入隨機鋸齒感）
              const r1 = f.r * (0.85 + 0.15 * Math.sin(k * 45.6));
              const r2 = f.r * (0.85 + 0.15 * Math.sin((k + 1) * 45.6));

              const p1x = f.x + Math.cos(angle1) * r1 + offsetX;
              const p1y = f.y + Math.sin(angle1) * r1 + offsetY;
              const p2x = f.x + Math.cos(angle2) * r2 + offsetX;
              const p2y = f.y + Math.sin(angle2) * r2 + offsetY;

              // 5. 開始繪製封閉的幾何玻璃碎片
              cx.beginPath();
              cx.moveTo(p0x, p0y);
              cx.lineTo(p1x, p1y);
              cx.lineTo(p2x, p2y);
              cx.closePath(); // 強制封閉成三角形

              // 6. 鏡面折射填充：模擬玻璃反射光線的半透明質感
              // 隨著旋轉位移，透明度會忽明忽暗，產生「閃爍折射」
              const shimmer = 0.1 + 0.25 * Math.abs(Math.sin(time * 8 + k));
              const alphaFade = Math.sin(progress * Math.PI); // 在生命週期結束時淡出

              cx.fillStyle = "#e0f2fe"; // 晶瑩的淡天藍色
              cx.globalAlpha = (0.05 + shimmer) * alphaFade;
              cx.fill();

              // 7. 鏡面銳利裂骨：繪製碎片邊框
              cx.strokeStyle = "#ffffff"; // 純白極細邊框
              cx.lineWidth = 1.0;
              cx.globalAlpha = 0.7 * alphaFade;
              cx.stroke();

              // 8. 額外細節：在碎片邊緣點綴閃爍的「玻璃反光點/碎屑」
              if (k % 2 === 0 && progress > 0.2) {
                cx.save();
                cx.fillStyle = "#ffffff";
                cx.shadowColor = "#e0f2fe";
                cx.shadowBlur = 4;
                cx.globalAlpha = alphaFade;
                cx.beginPath();
                cx.arc(p1x + Math.sin(time * 15 + k) * 2, p1y, 0.8, 0, TAU);
                cx.fill();
                cx.restore();
              }
            }
            cx.restore();
          },
        });
      },
    },
    {
      name: "懸流",
      cost: 25,
      cd: 3,
      color: "#ff8a5a",
      backlash: 0.05,
      desc: "將術式壓縮智超臨界流體，一次貫穿，極致的恐懼稍縱即逝",
      cast({ p, x, y }) {
        const a = Math.atan2(y - p.y, x - p.x);
        beam(p.x, p.y, a, 1000, 100, 14, {
            col: "#a70000",
            fx: [["afraid", { duration: 1, stacks: 5 }]],
          });
      },
    },
    {
      name: "怖鋒引",
      cost: 30,
      cd: 4,
      backlash: 0.05,
      color: "#fded0f",
      desc: "召喚雷擊，命中的敵人受到麻痺（0.5秒）及恐懼1級",
      cast({ p, x, y }) {
        aoe(x, y, 170, 30, { kb: 100, walls: 10 });
        field({
          x,
          y,
          r: 130,
          t: 1,
          fx: [["shock", { duration: 2 }],["afraid",{duration:3}]],
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
              cx.shadowColor = "#8100fa"; // 強烈的電弧紫色外發光
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
      name: "賜伏",
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
      name: "hi",
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
