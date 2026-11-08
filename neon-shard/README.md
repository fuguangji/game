# NEON SHARD

霓虹幾何風格的俯視角射擊遊戲，純前端（ES modules）。主題：冷冽松霧。

## 執行與檢查

```
python3 -m http.server 8000        # 然後開 http://localhost:8000/index.dev.html（開發版，原始模組）
npm run build                      # 產生上線版 dist/ 與 index.html（需先 npm install）
node --import ./test/stubs.mjs --test test/*.test.mjs        # 自動測試
node --expose-internals tools/check-imports.cjs js           # 匯入／匯出是否對得上
node --expose-internals tools/check-undefined.cjs js         # 有沒有用到未宣告的名稱
```

自動測試只管「看畫面看不出對錯」的東西（資料一致性、規則、存檔、加密、模擬）。畫面與操作請照文末「人工檢查清單」自己玩一遍。

## 部署前要填的常數（【待填】清單）

下面這些是我無法替你決定的值，已經在程式裡用常數寫好占位，填入後即可運作。

| # | 位置 | 常數 | 要填什麼 |
|---|---|---|---|
| 1 | `js/account/config.js` | `DEFAULT_API_BASE` | 後端（`neon-shard-api`）部署在 Render 的網址，例如 `https://xxxx.onrender.com`。目前是占位 `https://neon-shard-api.onrender.com`，若不是你的實際網址一定要改 |
| 2 | `../account/firebase-config.js` | `FIREBASE_CONFIG` | 與帳號中心共用的 Firebase Web App 設定。所有同源遊戲必須使用同一個 Firebase default app 與 browser-local persistence。 |
| 3 | Render 環境變數（`neon-shard-api/.env.example`） | `ALLOWED_ORIGINS` | 遊戲實際開啟的網址，完全一致、含 `https://`、不含結尾斜線，多個用逗號分隔。目前範例是 `https://fuguangji.github.io`，請確認是不是你的 |
| 4 | Render 環境變數 | `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase 服務帳戶金鑰 JSON（整份貼成一行）。**絕對不要提交到 Git** |
| 5 | Firebase Console | — | 啟用 Authentication 的 Email/Password；建立 Firestore；發佈 `neon-shard-api/firestore.rules` |

測試時可以不改檔案，在載入遊戲前加一段腳本覆寫：`window.NEON_SHARD_API_BASE = "http://localhost:10000";`。Firebase Web 設定一律由 repo root 的 `account/firebase-config.js` 管理。

我「不確定、已先用常數寫好」的其他項目（需要時再調，不影響上線）：

| 位置 | 常數 | 目前值 / 說明 |
|---|---|---|
| `js/core/sim-governor.js` | `SIM_RATES` | `[60, 45, 30]`：自動調頻的模擬頻率階梯（上限 60；更高螢幕更新率靠動態補償） |
| `js/core/sim-governor.js` | `PARTICLE_BUDGETS` | `[1, 0.75, 0.5, 0.3]`：自動粒子預算階梯 |
| `js/core/sim-governor.js` | `GOVERNOR_TUNING` | 何時判定吃力／輕鬆、降升級所需秒數、冷卻、「最後手段」門檻。**門檻是依經驗估的，請用 `showFps` 在你的目標手機上實測後微調** |
| `js/game/world-helpers.js` | `PARTICLE_CAP` | `700`：粒子總數上限（完整預算時） |
| `js/game/online-match.js` | `VERSUS_DAMAGE_SCALE` | `0.4`：競爭模式，我的子彈傷害 × 此倍率 = 對手扣的血量（伺服器玩家血量 100）。**請玩過手感後調整** |
| `js/game/online-match.js` | `ONLINE_STAGE_INDEX` | `1`：線上對戰固定使用的關卡（所有人要一樣，地圖才會一致）；不確定哪一關適合，請依喜好改 |
| `js/game/online-match.js` | `COOP_BOSS_HP_PER_EXTRA_PLAYER`、`COOP_BOSS_WAVE` | `0.6`、`5`：合作模式 Boss 血量隨人數增加的比例，以及 Boss 強度使用的波數 |
| `neon-shard-api/src/room-manager.js` | `MATCH_RULES` | 玩家血量、Boss 共用血量、競爭模式時間（150 秒）、傷害上限與每秒預算、命中距離、弱敵人血量與重生、得分。全是我估的值 |
| `js/account/cloud-crypto.js` | Argon2id 載入網址 | `https://esm.sh/@noble/hashes@1.8.0/argon2`（登入時動態載入的外部 CDN）。若要完全自管，可改成自己 bundle 或自行託管的檔案 |
| `neon-shard-api/package.json` | `engines.node` | 原本寫死 `24.22.1`（可能不是 Render 提供的版本），已改成 `>=22.0.0` |
| `neon-shard-api/src/realtime.js` | `MAX_CONNECTIONS`、`AUTH_TIMEOUT_MS`、`HEARTBEAT_MS`、`MAX_VIOLATIONS` | 500 / 8 秒 / 30 秒 / 100：依你的 Render 方案容量調整 |
| `neon-shard-api/src/room-manager.js` | `maxRoomSize`、`maxRooms`、`ATTACK_COOLDOWN_MS` | 4 / 200 / 450ms |

## 上線建置

`dist/` 與 `index.html` 是建置產物，**這次沒有重新建置**（我的環境裝不了 esbuild）。請在你的電腦執行 `npm install && npm run build`，再部署；沒重建之前，`index.html` 載入的仍是舊版 `dist/app.js`（舊的登入流程在新後端會得到 410）。

## 線上聯機：競爭模式與合作模式

在「個人檔案 → 線上聯機」登入後選玩法、輸入相同房間代碼加入（最多 4 人），房主按「開始對戰」所有人同時進入戰鬥。

- **競爭模式**：沒有波次，大家在同一張地圖互相對戰，也能打場上 3 隻弱敵人得分。血量由伺服器決定，歸零淘汰；剩最後一人或 150 秒到結算。至少 2 人。
- **合作模式**：大家打同一隻 Boss，共用一條血量（人越多 Boss 越肥）。Boss 歸零勝利，全員倒下失敗。1 人也能開始。
- 對戰中**不能暫停**（別人還在打）：按暫停鍵會詢問是否離開。對戰不發獎勵、不影響單人紀錄。
- **已知限制**：隊友／對手以「幽靈」呈現（位置與子彈外觀）；技能、爆炸、地面效果不會傷害對手；傷害是用戶端回報，伺服器只檢查上限、頻率與距離（防離譜，不防外掛）；每位玩家用各自的武器與角色；競爭模式中我的血量只聽伺服器，補血道具只影響本地顯示。協定與規則見 `neon-shard-api/README-ONLINE.md`。

## GitHub 建置與部署

工作流程在倉庫根目錄的 `.github/workflows/neon-shard-api.yml`（倉庫根目錄是 `neon-shard` 與 `neon-shard-api` 的上一層）。每次推送或發 PR 會跑兩條線：

- **後端**：語法檢查 → 單元測試（Node 22）。
- **前端**：逐檔語法檢查 → 匯入／未宣告名稱檢查 → 單元測試 → **重新建置** `dist/` → `npm run check:dist`（用原始碼的狀態效果名稱比對建置結果，缺任何一個就失敗）→ 上傳成品。

為什麼要重新建置：`dist/` 是建置產物，手動提交很容易忘記更新（改了 `js/` 卻沒重建，線上就會跑舊版，出現「未知的狀態效果：fast」這類錯誤）。倉庫裡提交的 `dist/` 若是舊的，流程會用警告提醒你，但不會擋下。

**自動部署到 GitHub Pages（預設關閉，不會和你現有的部署衝突）**：到倉庫 Settings → Pages，Source 選「GitHub Actions」，再到 Settings → Secrets and variables → Actions → Variables 新增 `DEPLOY_PAGES` = `true`。之後每次推送到 `main` 且測試、建置都通過，就會自動部署剛建好的版本。

手動建置：`npm install && npm run build && npm run check:dist`。

## 效能設計（畫質優先）

- **模擬頻率沒有設定項了**，由 `core/sim-governor.js` 依實際負載自動調整（60 → 45 → 30 Hz，輕鬆時自動升回）。降頻時畫面由動態補償插值，不會變得一頓一頓。
- 卡頓時**先動程式面，不動畫質**：模擬佔比高 → 先降頻；繪製佔比高 → 先減粒子預算（新生粒子與上限，不刪已存在的）。發光、解析度、光環維持「高」。只有兩種手段都用到底、仍然很吃力超過幾秒，才「最後手段」降一檔畫質。想完全不降畫質：手動選「高」。
- 程式面優化：粒子物件池與原地壓縮（取代逐個 `splice`）、子彈／敵人陣列原地壓縮（取代每步 `filter`）、敵人互推與子彈命中先用平方距離排除、畫面外粒子不繪製、粒子顏色沒變不重設 `fillStyle`、被幀率上限跳過的幀也計入負載。
- 尋路：BFS 改用預先配置的 Int32Array 佇列（結果與原版逐格一致，用 20 張隨機地圖驗證）、視線檢查不再每次建立函式。
- 事件監聽：休眠時才掛「喚醒」監聽；教學快捷鍵只在教學中掛；電腦／手機各自的輸入整組可拆；「自動偵測平台」只聽另一種輸入，控制模式固定為電腦或手機後整組拆掉；`resize` 只剩一個且同一幀合併。

## 資料流：每種內容只有一個來源

| 要新增 | 只改這裡 | 其他地方自動跟上 |
|---|---|---|
| 敵人 | `js/config/enemy-catalog.js` 加一列 | 名稱、圖鑑圖例、精英版、訓練場按鈕、出怪池 |
| Boss | `js/config/boss-catalog.js` 加一列，招式寫在 `js/game/boss-custom.js` | Boss 圖鑑、訓練場按鈕、無盡模式輪替 |
| 玩家狀態效果 | `js/game/status-effects.js` 的 `STATUS` | 倒數、HUD 圖示、角色光環、速度／受傷／傷害／反噬倍率 |
| 敵人狀態效果 | `js/game/enemy-effects.js` 的 `ENEMY_FX` | 倒數、頭上光環、禁止攻擊／移動、反噬 |
| 術式（技能與術式場） | `js/techniques/` 新增檔案，見 `TECHNIQUES.md` | 技能鈕、能量條、冷卻、按鍵 |
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

- 效能：設定 → 畫面效能開「顯示效能資訊」，大量敵人與彈幕時看「自動調頻」是否降到 45／30 Hz、粒子百分比是否下降，並確認畫面仍平順、發光與解析度沒變；離開戰鬥後是否慢慢升回。

- 新手導覽：全新存檔 → 戰鬥教學 → 「繼續：商店與芯片導覽」能走完買芯片、裝芯片；每一步都能「跳過導覽」；個人檔案 → 設定可重看。
- 登入頁（需先填好上面的常數）：註冊 → 自動設定暱稱與金鑰；登入、登出、重新整理後解鎖；上傳／下載雲端存檔；切換「登入／建立帳號」、密碼顯示／隱藏、欄位提示、錯誤訊息是否好懂；下載雲端存檔前會跳出比對視窗。
- 訓練場：分頁與說明、敵人與芯片按鈕、清除敵人、離開訓練場、目前手上的槍有亮起。
- 商城與背包：買不起時按鈕顯示「還差多少」、購買與裝備有提示、芯片包開完有「到背包安裝」。
- 新增內容後：訓練場能叫出來、圖鑑有列出、狀態效果在角色身上有光環與 HUD 圖示。
- 術式武器：在訓練場「武器」分頁裝備，確認技能鈕、冷卻、能量條；各技能與術式場的視覺與手感；塵流懸圖的數字鍵與手機面板；被熔斷時是否真的不能攻擊。

術式武器（青羽鎩等 7 把）的操作、技能表與新增方式見 `TECHNIQUES.md`。

更多結構與模組職責見 `ARCHITECTURE.md`。
