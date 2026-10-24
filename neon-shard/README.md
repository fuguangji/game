# NEON SHARD

霓虹幾何風格的俯視角射擊遊戲，純前端（ES modules）。主題：冷冽松霧。

自動測試只管「看畫面看不出對錯」的東西（資料一致性、規則、存檔、加密、模擬）。畫面與操作請照文末「人工檢查清單」自己玩一遍。

## 資料流：每種內容只有一個來源

| 要新增 | 只改這裡 | 其他地方自動跟上 |
|---|---|---|
| 敵人 | `js/config/enemy-catalog.js` 加一列 | 名稱、圖鑑圖例、精英版、訓練場按鈕、出怪池 |
| Boss | `js/config/boss-catalog.js` 加一列，招式寫在 `js/game/boss-custom.js` | Boss 圖鑑、訓練場按鈕、無盡模式輪替 |
| 玩家狀態效果 | `js/game/status-effects.js` 的 `STATUS` | 倒數、HUD 圖示、角色光環、速度／受傷倍率 |
| 地圖方塊 | `js/game/tiles.js` 底部加 `registerTile` | 生成、繪製、站立效果、打破效果 |

重點：**不需要記編號，也沒有「還剩幾個名額」**。敵人與 Boss 的編號自動配發，
啟動時會檢查有沒有重複（重複會直接報錯並指出是誰跟誰）；Boss 數量增減時，無盡模式的輪替會自動配合。
唯一例外：舊敵人的專屬行為是用編號寫在 `enemy-ai.js` 裡，那些編號請不要動。

---

## 一、新增敵人

示範：「酸蝕者」，會朝玩家射出 3 發扇形酸彈，命中中毒。**只改兩個檔案，不寫任何 AI 程式。**

1. `js/config/bullet-catalog.js` 的 `#PRESETS` 加子彈（`status` 的名稱要是 `STATUS` 裡有的，見第三節）：

```js
{ id: "ACID_SHOT", speed: 240, damage: 6, radius: 6, color: "#9dff3d", lifetimeSeconds: 3.5,
  status: { name: "poison", duration: 5, stack: true } },
```

2. `js/config/enemy-catalog.js` 的 `#ROWS` 末尾加一列（不要寫 `typeId`）：

```js
{ name: "酸蝕者", radius: 14, maxHealth: 50, moveSpeed: 65, color: "#9dff3d",
  scoreValue: 260, mass: 1, unlockWave: 6,
  shape: { sides: 6, innerRatio: 0.6 }, telegraphRadius: 30,
  preferredDistance: 280, attackCooldown: 3.5, recoveryTime: 1,
  legend: "發射酸彈，命中會中毒",                       // 圖鑑圖例；不寫就不會列在圖鑑
  attack: { bullet: "ACID_SHOT", count: 3, spread: 0.5 } }, // 宣告式攻擊
```

`attack` 的三種寫法：

| 寫法 | 效果 |
|---|---|
| `{ bullet: "X" }` | 朝玩家一發 |
| `{ bullet: "X", count: 3, spread: 0.5 }` | 3 發扇形，整個扇形展開 0.5 弧度 |
| `{ bullet: "X", ring: 12 }` | 一圈 12 發 |

`unlockWave` 決定第幾波開始出現。資料寫錯（顏色格式、數值為負、子彈名稱不存在…）會在啟動時直接報錯。

3. 選配：加 `elite: { n: "…", fx: ["效果說明"], … }` 就會有精英版（欄位照 `enemy-catalog.js` 裡舊敵人的 `elite` 抄）。
4. 驗證：進「訓練場 → 敵人」分頁，新敵人會自動出現，點一下就能試。

### 需要特殊行為時
`attack` 不夠用（衝刺、召喚、自爆…）：在 `js/game/enemy-ai.js` 的 `fire(e)` 依該敵人的編號加一個 `else if` 分支。
編號用 `enemyCatalog.byName("酸蝕者").typeId` 取得，不必背數字。

---

## 二、新增 Boss

示範：「酸蝕王」。

1. `js/config/boss-catalog.js` 的 `#BOSSES` 末尾加一列（不要寫 `typeId`）：

```js
{ name: "酸蝕王", radius: 40, maxHealth: 2600, moveSpeed: 90, color: "#9dff3d",
  scoreValue: 6000, mass: 4, attackPatternCount: 3, preferredDistance: 160,
  shape: { sides: 9, innerRatio: 0.6 }, telegraphRadius: 90,
  description: "第一招環形彈幕，第二招扇形；血量越低彈幕越密。" }, // 圖鑑說明
```

2. `js/game/boss-custom.js` 用**同一個名稱**註冊招式（不必知道它是第幾隻）：

```js
import { lat, pFan, pRing, poison } from "./boss-attacks.js";

export const CUSTOM_BOSS_ATTACKS = {
  "酸蝕王": (e, k, ph, A) => {
    // e 本體、k 這次出第幾招（0 ~ attackPatternCount-1）、ph 階段 0~3、A 朝向玩家的角度
    if (k === 0) pRing(e, 12 + ph * 4, 170, 9, 0);   // 環形：數量、速度、傷害、起始角
    else if (k === 1) pFan(e, A, 5 + ph * 2, 250, 10, 1.2); // 扇形：中心角、數量、速度、傷害、展開角
    else { poison(e); lat(e, 0.4, () => pRing(e, 16, 150, 8, 0)); } // 毒池 + 0.4 秒後再補一圈
  },
};
```

可用招式積木（都在 `boss-attacks.js`）：`pRing`、`pFan`、`pHom`（追蹤彈）、`pBomb`、`pSum`（召喚）、`lat`（延遲執行）、`poison`、`rocks`、`tiles`。
沒有註冊的 Boss 只會移動不會出招。

3. 讓玩家打得到它：
   - 無盡模式：**什麼都不用改**，每 5 波輪流出 Boss，輪完一圈自動回到第一隻。
   - 專屬關卡：在 `js/game/progress.js` 的 `STG` 加一關，並寫 `boss: <Boss 順序，從 0 起算>`（= 它在 `#BOSSES` 的位置）。
     新增關卡會讓 `SV` 的通關紀錄多一格，舊存檔請確認 `progress.js` 的預設值與遷移有補齊。
4. 圖鑑的 Boss 列表、出現位置、訓練場按鈕都會自動出現。

---

## 三、新增玩家效果（例如劇毒）

劇毒、減速、易傷都是同一個機制，在 `js/game/status-effects.js` 的 `STATUS` 表裡。**新增一項就完成，其餘（倒數、HUD 圖示、角色光環、速度與受傷倍率）自動生效。**

```js
// 例：灼燒 —— 每 0.4 秒固定扣 2 點，3 秒
burn: {
  label: "灼燒", color: "#ff8a3d", icon: "core", defaultDuration: 3,
  onTick(p, s, dt, api) {
    s.acc += dt;
    while (s.acc >= 0.4) { s.acc -= 0.4; api.hurt(2, { quiet: true }); }
  },
},
```

欄位：`defaultDuration` 持續秒數、`maxStacks` 最多疊幾層（預設 1）、`speedMul(n)` 速度倍率、`damageTakenMul(n)` 受傷倍率、`onTick(p, s, dt, api)` 每幀（`s.n` 層數、`api.hurt(傷害, { quiet: true })` 安靜扣血，不震動不閃紅）。

怎麼施加：

- 子彈命中：在 `bullet-catalog.js` 的子彈加 `status: { name: "burn", duration: 3 }`（疊層加 `stack: true`）。
- 程式裡：`applyStatus(G.pl, "burn", { duration: 3, stack: true })`
- 解除：`clearStatus(G.pl, "burn")`（現有例子：吃補血道具會解除劇毒，見 `pickups.js`）

規則：再次中同一種狀態時，持續時間取「現有剩餘」與「這次給的」較長者，不會被短的蓋掉。

---

## 四、新增地圖方塊

地圖仍是 `G.grid`（0 空地、-1 外牆、>0 可打破方塊的血量）。特殊方塊另外記在 `G.tile` 圖層，所以碰撞、子彈、尋路完全不用改。

- `solid: false`：可走的地板（岩漿、冰面…），`grid` 保持 0。
- `solid: true`：實心可打破（炸藥桶…），`grid` 存血量，碰撞照一般方塊處理。

在 `js/game/tiles.js` 底部「方塊清單」區加入（編號自動配發）：

```js
// 岩漿地板：站上去每 0.5 秒受傷；越後面的關卡越多
registerTile({
  name: "岩漿", color: "#ff5a14",
  density: (stage) => (stage.g ? 0.03 : 0.04),
  onStand(p, dt, { hurt }) {
    p.lavaT = (p.lavaT ?? 0) - dt;
    if (p.lavaT <= 0) { p.lavaT = 0.5; hurt(4, { quiet: true }); }
  },
});

// 炸藥桶：打破時爆炸
registerTile({
  name: "炸藥桶", color: "#ffaa00", solid: true, hp: 2,
  density: () => 0.01,
  onBreak(x, y, { zones }) {
    zones.push({ k: "bomb", x, y, r: 90, t: 0.3, max: 0.3, col: "#ff9f2a", dmg: 30 });
  },
});
```

欄位：`density(stage)` 每格出現機率（0 或省略 = 不自動生成）、`onStand(p, dt, api)`、`onBreak(x, y, api)`、`draw(cx, x, y, size, time)` 自訂繪製（省略就畫 `color` 色塊或外框）。
玩家出生區（中心 5 格內）不會生成。教學關是乾淨的空地，不會有特殊方塊。

---

## 人工檢查清單（改完請自己玩一遍）

- 新手導覽：全新存檔 → 戰鬥教學 → 「繼續：商店與芯片導覽」能走完買芯片、裝芯片；每一步都能「跳過導覽」；個人檔案 → 設定可重看。
- 登入頁：切換「登入／建立帳號」、密碼顯示／隱藏、欄位提示、錯誤訊息是否好懂；下載雲端存檔前會跳出比對視窗。
- 訓練場：分頁與說明、敵人與芯片按鈕、清除敵人、離開訓練場、目前手上的槍有亮起。
- 商城與背包：買不起時按鈕顯示「還差多少」、購買與裝備有提示、芯片包開完有「到背包安裝」。
- 新增內容後：訓練場能叫出來、圖鑑有列出、狀態效果在角色身上有光環與 HUD 圖示。

更多結構與模組職責見 `ARCHITECTURE.md`。
