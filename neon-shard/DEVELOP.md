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



【一、武器怎麼組成】

武器全部寫在 `js/game/weapons.js` 的 `#definitions` 陣列裡，每把是一個物件。大部分武器不用寫新程式，只要把「旗標」組合起來就是新武器。

基本欄位（每把都要有）：
- `name` 名稱、`color` 顏色、`description` 說明
- `damage` 傷害、`fireCooldown` 射擊間隔（秒）、`projectilesPerShot` 一次幾發、`spreadAngle` 扇形展開弧度
- `projectileSpeed` 彈速、`projectileLifetime` 子彈存活秒數、`projectileRadius` 子彈大小、`knockback` 擊退、`wallDamage` 對方塊傷害
- `magazineCapacity` 彈匣容量、`ammoInMagazine`（**必須等於彈匣容量**）、`reloadDuration` 裝填秒數、`ammoCost` 每發耗彈
- `accuracySpread`、`muzzleParameter`、`automaticFire`（1 = 按住連射）、`aimPreviewMode`（瞄準線樣式，值有 "l"、"c"、"r"，請照現有武器抄）
- `id`

已經存在的特殊旗標（有寫就生效，要幾個疊幾個）：
`pierceCount` 穿透敵人、`pierceWalls` 穿牆、`bounceCount` 彈跳、`homingEnabled` 追蹤、`boomerangEnabled` 迴旋、`chainLightningEnabled` 連鎖電弧、`freezeOnHit` 命中凍結、`gravityFieldEnabled` 重力場、`chargeStackEnabled` 蓄力、`explosionRadius` 爆炸、`clusterShotEnabled` 集束、`laserMode` 雷射、`mineMode` 地雷、`webMode` 蛛網、`turretMode` 砲塔、`poisonCloudMode` 毒雲、`grenadeMode` 榴彈、`flameMode` 噴火、`meleeArcEnabled` 近戰揮砍（搭配 `meleeRange`、`meleeSweepAngle`）。

【二、新增一把武器（只用現有旗標，示範「雷霆連弩」）】

步驟 1：在 `weapons.js` 的 `#definitions` 最後面加一個物件。`id` 一定要等於它在陣列裡的位置（現在有 24 把，新的就是 24）。**只能加在最後，不要插在中間或換順序**，因為存檔裡的擁有武器、出戰配置、芯片都是用這個編號記的。

```js
{
  name: "雷霆連弩", color: "#9fd8ff", description: "自動連射·穿透·連鎖電弧",
  projectilesPerShot: 1, spreadAngle: 0,
  damage: 14, projectileSpeed: 820, projectileLifetime: 0.6,
  fireCooldown: 0.12, ammoCost: 1, knockback: 120, projectileRadius: 3.5,
  pierceCount: 1, chainLightningEnabled: 1,
  accuracySpread: 0.02, muzzleParameter: 0.05, wallDamage: 0.5,
  automaticFire: 1, aimPreviewMode: "l",
  id: 24, magazineCapacity: 20, ammoInMagazine: 20, reloadDuration: 1.4,
},
```

步驟 2：改 `js/game/progress.js`（約 148 行附近）的價格表，這是陷阱所在。

```js
WPR = [ ...原本 24 個數字..., 650 ];     // 最後補一個價格，索引 = 武器 id
WPC = Array(WPR.length).fill("coins");   // 原本寫死 Array(24)，一定要改，不然第 25 把永遠買不起
```

步驟 3（選配）：大招。到 `js/game/ultimates.js` 的 `ULTS` 加一個以武器 id 為鍵的函式；沒寫會自動使用預設的環形大招。

```js
24(a) {                                  // a = 瞄準角度
  for (let k = 0; k < 8; k++)
    later(k * 0.06, () => ub(a + (k - 3.5) * 0.12, 800, { dmg: 30, r: 4, life: 0.8 / BULLET_SPEED_SCALE }));
},
```

`later(秒數, 函式)` 是延遲執行，`ub(角度, 速度, { dmg, r, life, kb, wd })` 是發射大招子彈，需要震動可加 `G.shake = 10`。

步驟 4：測試。進「訓練場 → 武器」分頁，新武器會自動出現，點一下就換上，彈藥無限。商城和大廳的槍械列表也是自動產生的，價格就是步驟 2 的那個數字。

【三、新增全新的武器邏輯（現有旗標做不到時）】

例如「命中後留下持續燃燒的地面」這種新機制：

1. 在武器定義加一個新旗標，例如 `igniteGroundEnabled: 1`。戰鬥用的武器副本是由定義複製出來的，新欄位會一起帶進去；用的是完整欄位名稱，不用另外加縮寫。
2. 射擊時怎麼生成子彈：改 `js/game/player-attacks.js` 的 `shoot()`。近戰、地雷、蛛網、榴彈、砲塔、毒雲這類「特殊武器」是在函式前段各自判斷旗標，處理完就 `return`，你的旗標可以仿照寫在同一區。若只是一般子彈的變化，就在約 274 行附近建立子彈的地方，把新旗標一起傳給子彈。
3. 子彈在飛行中或命中時的行為：改 `js/game/simulation.js`（子彈更新與命中判斷）。
4. 要產生地面效果、爆炸之類的區域，可以仿照 `shoot()` 裡榴彈、毒雲的寫法，把區域資料推進 `G.zones`（`k` 是區域種類，`zone-update.js` 負責每幀更新）。

【四、容易出錯的地方】

- `id` 沒有等於陣列位置，或中間插入、換順序：存檔與芯片會對錯武器。
- `ammoInMagazine` 沒有等於 `magazineCapacity`：一開始彈匣數量不對。
- 忘了補價格、沒改 `WPC` 的 24：該武器在商城買不到。
- 欄位名稱打錯不會報錯，只是默默不生效。


## 建置、開發與效能量測

| 目的 | 指令 |
|---|---|
| 開發（不用建置） | `python3 -m http.server 8000`，開 `http://localhost:8000/index.dev.html` |
| 上線版 | `npm install`（第一次）→ `npm run build` → 提交 `dist/` 與 `index.html` |
| 測試 | `npm test` |
| Lighthouse | 用 Chrome 隱身視窗開上線版 `index.html` → DevTools → Lighthouse → Mobile；或 `npx lighthouse http://localhost:8000/index.html --preset=perf --form-factor=mobile` |

要改首頁 HTML 請改 `index.dev.html`（`index.html` 是建置產物）。新增或搬動 `css/*.css` 時，同步更新 `tools/build.mjs` 的 `cssFiles`。

## 人工檢查清單（改完請自己玩一遍）

- 手機版（Chrome DevTools 裝置模擬或真機，橫向與直向各一次）：點技能鈕只會選定（不施放）→ 右搖桿拖曳出現落點預覽 → 放開施放；
  拖回中心放開不施放；施放後回到普攻；蓄力類技能再點一次可釋放；左搖桿、DASH、SUPER、槍欄正常；教學是手機版文字與練習。
- 電腦版：WASD、滑鼠、左鍵、滾輪選定技能、ZXCVBN、Shift、空白鍵、P/Esc；教學是鍵鼠版文字。
- 畫面效能：設定 → 畫面效能，逐項切換（畫質、解析度、幀率上限、模擬頻率、動態補償、發光、粒子、震動），開「顯示效能資訊」看數字；
  60 Hz 與 120／144 Hz 螢幕上移動畫面是否平順（關掉「動態補償」對照）。
- 首頁與圖鑑「操作」分頁的操作簡圖：電腦／手機切換正常，手機橫向首頁不被擠壞。
- 新手導覽：全新存檔 → 戰鬥教學 → 「繼續：商店與芯片導覽」能走完買芯片、裝芯片；每一步都能「跳過導覽」；個人檔案 → 設定可重看。
- 登入頁：切換「登入／建立帳號」、密碼顯示／隱藏、欄位提示、錯誤訊息是否好懂；下載雲端存檔前會跳出比對視窗。
- 訓練場：分頁與說明、敵人與芯片按鈕、清除敵人、離開訓練場、目前手上的槍有亮起。
- 商城與背包：買不起時按鈕顯示「還差多少」、購買與裝備有提示、芯片包開完有「到背包安裝」。
- 新增內容後：訓練場能叫出來、圖鑑有列出、狀態效果在角色身上有光環與 HUD 圖示。

更多結構與模組職責見 `ARCHITECTURE.md`。
