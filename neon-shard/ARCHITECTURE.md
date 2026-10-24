# Neon Shard 前端架構

原本單一的 `main.js`（13,700 行、87 個全域 `let`、11 個被「猴子補丁」改寫的函式）已拆成下列模組。
所有模組都是 ES module，**必須透過 http(s) 伺服器開啟**（例如 `npx serve neon-shard`），直接雙擊 `index.html`（file://）瀏覽器會擋住。

## 設計原則

- **共用狀態集中在 `G`**（`core/game-state.js`）：所有可變的全域狀態都是 `GameState` 的欄位，物件建構後立刻 `Object.seal`，
  拼錯欄位名稱會直接報錯，不會悄悄新增新欄位。
- **狀態由 `fsm` 管理**（`core/state-machine.js`）：menu / play / pause / shop / over 的合法轉移集中在一處；
  可用 `addTransition` / `addGuard` / `onEnter` / `onExit` 擴充（也可透過 `window.NEON_SHARD_API`），全部回傳「取消」函式。
- **事件取代猴子補丁**（`core/event-bus.js`）：核心函式只「宣告發生了什麼」（`PLAYER_SHOT`、`ENEMY_KILLED`…），
  教學等系統自行訂閱；單一監聽者出錯不會影響遊戲。
- **所有存檔讀寫走 `SaveStore`**（`core/save-store.js`）：隱私模式、容量滿、資料損毀都會回傳預設值而不是讓遊戲當掉。
  `mergeSave` 只接受型別相符的欄位，並擋掉 `__proto__` 等原型污染。
- **路徑場在 Web Worker 計算**（`core/flow-field.js`）：失敗時自動退回主執行緒。
- **載入順序安全**：模組載入時才需要執行的程式（填入資料表、註冊事件…）放在各模組的 `export function init()`，
  由 `main.js` 依原本順序呼叫，所以模組之間互相引用（循環匯入）不會碰到「變數尚未初始化」。
  只有「純資料」常數會留在模組頂層。

## 模組

| 檔案 | 行數 | 內容 |
|---|---:|---|
| `js/account/account-service.js` | 157 |  |
| `js/account/account-view.js` | 169 |  |
| `js/account/api-client.js` | 98 |  |
| `js/account/cloud-crypto.js` | 345 |  |
| `js/account/config.js` | 17 |  |
| `js/account/index.js` | 15 | 帳號系統組裝：把設定、Session、API、加密與服務接在一起（整個遊戲共用一份） |
| `js/account/session-store.js` | 59 |  |
| `js/api/extension.js` | 29 | 對外擴充 API（window.NEON_SHARD_API） |
| `js/config/boss-catalog.js` | 91 |  |
| `js/config/bullet-catalog.js` | 121 |  |
| `js/config/creature-definition.js` | 81 |  |
| `js/config/enemy-catalog.js` | 127 |  |
| `js/config/index.js` | 40 |  |
| `js/core/dom-utils.js` | 28 | 把任意文字轉成可安全放進 innerHTML 的字串（暱稱等使用者輸入一律先經過這裡） |
| `js/core/event-bus.js` | 50 |  |
| `js/core/flow-field.js` | 97 |  |
| `js/core/game-state.js` | 91 |  |
| `js/core/input.js` | 299 | 鍵盤、滑鼠、觸控輸入 |
| `js/core/save-store.js` | 86 |  |
| `js/core/settings-store.js` | 53 |  |
| `js/core/state-machine.js` | 144 |  |
| `js/core/viewport.js` | 35 | 畫布、座標常數與視窗縮放 |
| `js/enemy-config.js` | 155 |  |
| `js/game-config.js` | 49 | 與敵人、子彈、Boss 無關的遊戲設定（敵方單位設定已搬到 config/） |
| `js/game/ai-helpers.js` | 173 | 敵人 AI 共用輔助：預判彈道、閃避玩家子彈 |
| `js/game/battle.js` | 277 | 戰鬥核心：開局、受傷、射擊、大招入口 |
| `js/game/boss-ai.js` | 478 | Boss 行為決策：階段切換、招式選擇、移動、衝鋒、分身與節點 |
| `js/game/boss-attacks.js` | 383 | Boss 的攻擊招式：彈幕、炸彈、地磚、落石、蜂群、傳送門、毒區、射線等 |
| `js/game/boss-telegraph.js` | 138 | Boss 攻擊預警（直線、圓圈、扇形、光束、地磚）的計算與繪製 |
| `js/game/boss-visuals.js` | 391 | Boss 登場、死亡、光環、氛圍等視覺效果與繪製 |
| `js/game/boss.js` | 44 | Boss 與特效 |
| `js/game/chip-effects.js` | 234 | 芯片觸發效果：命中、持續、連鎖、重力井、充能 |
| `js/game/chips.js` | 562 | 芯片資料與改裝運算 |
| `js/game/elite.js` | 47 | 精英怪詞綴與數值 |
| `js/game/enemy-ai.js` | 691 | 敵人 AI：開火與每幀行為 |
| `js/game/enemy-death.js` | 154 | 敵人死亡：得分、掉落、分裂與特效 |
| `js/game/laser-zones.js` | 378 | 雷射地帶：發射、判定、更新與繪製 |
| `js/game/pathfinding.js` | 143 | 路徑場與敵人尋路 |
| `js/game/physics.js` | 250 | 爆炸、自動瞄準、追蹤 |
| `js/game/pickups.js` | 367 | 掉落物、經濟、道具 |
| `js/game/player-attacks.js` | 602 | 玩家攻擊：開火、子彈建立、大招（SUPER）加成與施放 |
| `js/game/player.js` | 175 | 玩家：衝刺、輸入、每幀更新 |
| `js/game/progress.js` | 183 | 存檔、關卡、結算、暫停 |
| `js/game/redeem.js` | 230 | 兌換碼 |
| `js/game/simulation.js` | 548 | 區域效果、擊殺、整體每幀模擬 |
| `js/game/training.js` | 236 | 訓練場 |
| `js/game/tutorial.js` | 392 | 教學模式（TutorialController） |
| `js/game/ultimate-effects.js` | 203 | 大招與訓練用的視覺輔助：假人、閃電折線、飄字、雲層火花 |
| `js/game/ultimates.js` | 774 | 各把槍的大招（SUPER）與雷射地帶 |
| `js/game/weapons.js` | 627 | 武器資料表與出戰配置 |
| `js/game/world-helpers.js` | 156 | 地圖格子、碰撞、射線、移動、粒子與掉落等世界基礎工具 |
| `js/game/zone-update.js` | 409 | 地面區域效果（炸彈、牽引、毒區、地雷等）的每幀更新 |
| `js/icons.js` | 274 |  |
| `js/main.js` | 84 | 啟動流程與主迴圈 |
| `js/profile/appearance.js` | 185 |  |
| `js/profile/profile-page.js` | 100 |  |
| `js/profile/realtime-client.js` | 120 |  |
| `js/profile/sections/appearance-section.js` | 109 |  |
| `js/profile/sections/cloud-section.js` | 20 |  |
| `js/profile/sections/online-section.js` | 96 |  |
| `js/profile/sections/overview-section.js` | 63 |  |
| `js/profile/sections/profile-section.js` | 24 | 個人檔案頁面的一個分頁區塊：持有自己的 DOM，並在顯示／隱藏／移除時收到通知 |
| `js/profile/sections/settings-section.js` | 49 |  |
| `js/ui/account.js` | 54 | 個人檔案頁面（遊戲端接合）：把遊戲的資料與動作包成 ProfileBridge，交給 ProfilePage 顯示 |
| `js/ui/aim.js` | 477 | 瞄準線與彈道預測 |
| `js/ui/hud.js` | 684 | 補給站、血條彈藥條、瞄準輔助 HUD |
| `js/ui/menu-bag.js` | 334 | 背包分頁：芯片改裝、裝備與庫存 |
| `js/ui/menu-codex.js` | 295 | 圖鑑分頁：敵人與道具介紹、敵人比較 |
| `js/ui/menu-lobby.js` | 358 | 大廳、備戰、關卡選擇、結算與暫停畫面 |
| `js/ui/menu-shop.js` | 242 | 商城分頁：武器、角色、芯片與升級的購買 |
| `js/ui/menu.js` | 252 | 主頁、備戰、背包、關卡、商城、圖鑑 |
| `js/ui/render.js` | 1327 | 場景繪製與主頁／結算顯示 |
| `js/ui/workshop.js` | 319 | 芯片工坊與訓練場改裝 |

## 敵人、子彈、Boss 設定（`js/config/`）

以前這些設定散在 `game-config.js` 的 9 張表（用位置編號對照）、`battle.js` 的陣列、`boss.js` 的 `EXT/BN/BK/BPF`，
以及散落各處的 `eb(e, a, 400, 20)` 這種數字。現在各自是一個類別，屬性全用完整名稱：

| 類別 | 內容 | 主要成員 |
|---|---|---|
| `EnemyCatalog` / `EnemyDefinition` | 一般敵人（數量不限，編號自動配發；圖鑑說明、精英資料、宣告式攻擊都寫在同一列） | `radius`、`maxHealth`、`moveSpeed`、`scoreValue`、`mass`、`unlockWave`、`preferredDistance`、`attackCooldown`、`recoveryTime`、`telegraphDuration`、`dodge`… |
| `BossCatalog` / `BossDefinition` | Boss（數量不限，編號自動配發）+ 2 種召喚物 | `name`、`attackPatternCount`、`preferredDistance`，並繼承上面的基礎屬性 |
| `BulletCatalog` / `BulletDefinition` | 16 種具名敵方子彈 | `speed`、`damage`、`radius`、`lifetimeSeconds`、`effect`（`BulletEffect`）、`color` |

- **資料表是 `#` 私有欄位**：`Reflect.ownKeys(catalog)` 是空的，外部讀不到、列舉不到、也無法序列化；
  定義實例已凍結，改寫會直接丟錯；`all()`、`names()`、`ids()` 回傳的都是副本。
- **建構時驗證**：顏色格式、血量與半徑範圍、解鎖波數…寫錯會當場報錯，不會悄悄變成 `NaN`。
- **查詢失敗會丟錯**：`bulletCatalog.get("拼錯了")` 與 `requireCreature(999)` 不會射出奇怪的子彈或生出奇怪的敵人。
- 發射子彈：`fireBullet(enemy, angle, "SNIPER_SHOT")`；Boss 依階段變動的子彈用 `eb(...)`（內部走 `bulletCatalog.custom`）。
- 原本散在 9 張表裡的數字，已用 359 項逐值比對確認轉抄無誤（見 `test/config.test.mjs` 的不變量測試）。

## 個人檔案頁面（`js/profile/`）

原本的 `account-features.js`（每行塞滿程式的單一檔案）已拆成：

| 類別 | 責任 |
|---|---|
| `ProfilePage` | 分頁外殼（個人檔案／設定／外觀／雲端同步／線上聯機），支援方向鍵與 aria |
| `OverviewSection` | 頭像（含目前外觀）、暱稱、帳號狀態、遊戲進度 |
| `SettingsSection` | 自動瞄準、職業光環、自訂外觀顯示、重看教學、還原 |
| `AppearanceSection` | 皮膚編輯器 + 遊戲內實際大小預覽 |
| `CloudSection` | 雲端登入與加密存檔（掛上 `AccountView`） |
| `OnlineSection` | 線上聯機（使用 `RealtimeClient`；離開頁面自動中斷） |
| `SettingsStore`（`core/`） | 只接受已宣告欄位與正確型別的顯示設定 |

頁面完全不直接碰遊戲內部：遊戲的資料與動作由 `ui/account.js` 組成 `ProfileBridge` 傳入。

### 皮膚渲染的修正

1. **編輯器與遊戲對不上**：舊版把 360px 畫布整個 0~1 拉伸到玩家身體上，筆畫粗細又乘 `r/18`，
   結果遊戲裡的線寬約是編輯器的 8 倍、圖案被擠在約 67% 的範圍內。現在兩邊共用同一支 `paintStrokes()`，
   以「圓圈半徑」換算位置與粗細（所見即所得）；玩家半徑只有約 12px，所以遊戲內有最小線寬，
   編輯器另外提供「遊戲內實際大小 ×4」預覽。
2. **每一幀讀 `localStorage` 並重畫所有筆畫**（最多 200 筆 × 1000 點）：改成載入時驗證一次，
   `SkinRenderer` 把皮膚畫到離屏貼圖，之後每幀只 `drawImage` 一次；內容或螢幕大小改變才重畫。
3. 資料驗證：顏色、粗細、座標與數量都限制在合理範圍；其他分頁修改時會同步；儲存失敗（隱私模式、空間滿）會明確告知。
4. 光環與皮膚可在「設定」中關閉。

## 拆分

`boss`（1,524→54 行入口 + 6 個模組）、`ultimates`、`menu`、`battle`、`simulation` 已依功能拆開；
原模組以 `export … from` 轉發，所以其他檔案的 import 完全不用改。拆分用的 `tools/split-module.cjs` 會自動算出新檔案需要的 import，
並拒絕搬移會改寫原模組變數的程式碼。

## 帳號系統（`js/account/`）

| 類別 | 責任 |
|---|---|
| `SessionStore` | 登入工作階段（sessionStorage）；格式不正確一律視為未登入 |
| `ApiClient` | 逾時（伺服器喚醒中不會永遠卡住）、錯誤碼、**401 自動 refresh 一次**（多個請求共用一次 refresh） |
| `AccountService` | 登入／金鑰解鎖／上傳／下載的邏輯，不碰 DOM；狀態改變發出 `change` 事件 |
| `AccountView` | 畫面：使用 `<form>`、所有文字走 `textContent`、訊息不會被重繪吃掉 |

### 這次修掉的帳號頁面問題

1. **儲存型 XSS**：頁面標題用 `innerHTML` 放入伺服器傳回的暱稱，而後端只擋控制字元、`%`、`_`，`<img src=x onerror=…>` 可通過。
   前端改為先 `escapeHtml`、帳號頁一律 `textContent`；後端同步拒絕 `< > & " ' \` \\ `（雙重防線）。
2. **套用雲端存檔不安全**：原本把 `SV` 清空後直接塞入解密內容，缺欄位會讓帳號頁當場崩潰（`SV.clr.filter`），
   也不會刷新出戰配置與角色。現在以預設值為底、型別驗證後合併，並更新 `CHR`、出戰配置與畫面；覆蓋前會要求確認。
3. **成功訊息永遠看不到**：先顯示訊息又立刻整頁重繪，訊息被清掉。訊息現在由畫面保存。
4. **登入逾時（401）後畫面卡在已登入**：session 被清掉但畫面沒更新，按鈕會丟出 `Cannot read properties of null`。
   現在先嘗試 refresh；失敗則回到登入畫面並顯示「登入已過期」。
5. **`refreshToken` 存了卻從沒用過**：後端有 `/api/auth/refresh`，前端現在會用。
6. **雲端伺服器冷啟動時畫面永久鎖死**：`fetch` 沒有逾時。現在 25 秒逾時並提示「免費主機閒置後需要 30～60 秒喚醒」。
7. **用訊息字串判斷「沒有存檔」**（`includes("No save exists")`）：改用錯誤碼 `SAVE_NOT_FOUND`；版本衝突（`REVISION_CONFLICT`）也有明確提示。
8. **個人資料卡的狀態標籤永遠是「尚未連結線上帳號」**，登入後也不變；重新整理後暱稱也回到「訪客」。現在會隨登入狀態更新，並在載入時補抓暱稱。
9. **表單**：原本沒有 `<form>`，按 Enter 不能送出、登入欄位卻標成 `new-password`。現在登入與註冊分開，欄位屬性正確。
10. API 網址只接受 `https`（或本機 `http://localhost`），避免登入資料走明文。
11. 變數名稱 `accoutInfo` 的拼字錯誤一併移除。

## 原始程式中發現的錯誤

- `fire()` 使用 `REC`（敵人開火後恢復時間表），它有在 `game-config.js` 匯出，但 `main.js` 的 import 清單漏掉，
  **任何敵人第一次開火都會丟出 `ReferenceError`**。拆分時已自動補上。
- 拆分工具會掃描整份程式的未宣告名稱；除 `REC` 外沒有其他。

## 測試與靜態檢查

```bash
cd neon-shard
node --import ./test/stubs.mjs --test test/*.test.mjs      # 40 項
node --expose-internals tools/check-imports.cjs js         # 每個 import 都有對應的 export
node --expose-internals tools/check-undefined.cjs js       # 用到卻沒宣告／沒 import 的名稱
```

| 測試檔 | 內容 |
|---|---|
| `account.test.mjs` | Session、API 用戶端（refresh／逾時／錯誤碼）、帳號服務、`escapeHtml` |
| `config.test.mjs` | 設定類別：私有資料表讀不到／改不了、定義已凍結、副本、建構驗證、查詢失敗會丟錯、原始碼中的子彈名稱都存在 |
| `enemies.behavior.test.mjs` | 全部 28 種敵方單位（18 一般 + 8 Boss + 2 召喚物）生成並模擬、`fireBullet` 產生的子彈與設定一致 |
| `appearance.test.mjs` | 皮膚換算（所見即所得）、最小線寬、快取、皮膚與設定儲存的驗證與持久化 |
| `game.behavior.test.mjs` | 第一次遊玩自動進教學、教學 15 步、900 幀戰鬥、24 把槍的大招、狀態機、事件匯流排、存檔損毀與原型污染 |
| `extension.test.mjs` | 擴充點：狀態效果、特殊方塊、宣告式攻擊、Boss 輪替 |

`stubs.mjs` 用假的 DOM 讓遊戲在 Node 裡執行，**只能驗證邏輯，看不到畫面**；排版、動畫與手感仍需在瀏覽器實際操作。
後端另有 16 項測試（`neon-shard-api`：`RoomManager`、`TokenBucket`、暱稱驗證、加密、安全）。

## 下一步（尚未做）

- **`ui/render.js` 的 `render()` 是一個 1,100 多行的單一函式**，`update()`（約 500 行）也是；它們沒辦法靠「搬函式」拆開，
  需要先把內容整理成多個繪製／更新階段，這次沒有處理。
- **執行期的實體物件仍是欄位縮寫的普通物件**（`e.hp`、`b.dmg`、`pl.r`…）。目前完成的是「靜態設定」的類別
  （`EnemyDefinition`、`BulletDefinition`、`BossDefinition`）；`Enemy`、`Bullet`、`Player` 等執行期類別還沒做，
  因為這些欄位被數百處直接讀寫，需要逐一確認每個呼叫點。
- 精英怪詞綴（`enemy-config.js` 的 `ELITE`）仍是一張以編號為鍵的表，尚未類別化。
- 少數 Boss 招式仍直接以數字呼叫 `eb(...)`（速度與傷害依階段變動，走 `bulletCatalog.custom`），尚未全部具名。
- 線上聯機只在個人檔案頁面開啟期間連線；與實際戰鬥畫面的同步還沒有接上。
- 真實瀏覽器中的視覺驗證（皮膚線寬、頭像、分頁排版）。

## 擴充點與資料流（新增）

每種內容只有一個「來源」，其他表都由它推導，新增時不必同步多處：

| 要新增 | 來源（只改這裡） | 自動推導出 |
|---|---|---|
| 一般敵人 | `config/enemy-catalog.js` 一列 | 名稱表 `EN`、圖鑑圖例 `LEG_B`、精英表 `ELITE`、訓練場按鈕、生成池 |
| Boss | `config/boss-catalog.js` 一列 + `game/boss-custom.js` 以名稱註冊招式 | Boss 圖鑑、訓練場按鈕、無盡模式輪替 |
| 玩家狀態效果 | `game/status-effects.js` 的 `STATUS` | 倒數、HUD 圖示、角色光環、速度／受傷倍率 |
| 地圖方塊 | `game/tiles.js` 底部 `registerTile` | 生成、繪製、站立效果、打破效果 |

編號由程式配發，並在啟動時檢查任兩種單位不重複；Boss／小單位用資料判斷（`isBossType`、`isMinionType`），不再有編號範圍。

## UI 人性化層

| 檔案 | 職責 |
|---|---|
| `js/ui/feedback.js` | `toast()` 非阻擋提示、`confirmDialog()` 取代 `window.confirm` |
| `js/ui/coach.js` | `Coach`：聚光燈導覽引擎（步驟可用條件自動前進、可跳過、Esc 離開） |
| `js/ui/shop-guide.js` | 商店與芯片導覽的 11 個步驟、新手補給、大廳「下一步建議」 |
| `css/ui-kit.css` | 上述元件、訓練場面板、雲端帳號畫面的樣式 |

- 導覽靠 `data-coach="…"` 屬性找目標（商城、背包、芯片包卡片等），重繪後每幀重新定位。
- 新增存檔鍵：`shopGuideDone`、`starterGift`（新手補給只送一次）、`trainingTip`。
