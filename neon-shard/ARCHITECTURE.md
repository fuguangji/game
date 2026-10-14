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
| `js/core/dom-utils.js` | 28 | 把任意文字轉成可安全放進 innerHTML 的字串（暱稱等使用者輸入一律先經過這裡） |
| `js/core/event-bus.js` | 50 |  |
| `js/core/flow-field.js` | 97 |  |
| `js/core/game-state.js` | 91 |  |
| `js/core/input.js` | 298 | 鍵盤、滑鼠、觸控輸入 |
| `js/core/save-store.js` | 85 |  |
| `js/core/state-machine.js` | 144 |  |
| `js/core/viewport.js` | 35 | 畫布、座標常數與視窗縮放 |
| `js/enemy-config.js` | 155 |  |
| `js/game-config.js` | 177 |  |
| `js/game/battle.js` | 1013 | 戰鬥核心：開局、受傷、射擊、大招入口 |
| `js/game/boss.js` | 1548 | Boss 與特效 |
| `js/game/chips.js` | 562 | 芯片資料與改裝運算 |
| `js/game/elite.js` | 47 | 精英怪詞綴與數值 |
| `js/game/enemy-ai.js` | 701 | 敵人 AI：開火與每幀行為 |
| `js/game/pathfinding.js` | 143 | 路徑場與敵人尋路 |
| `js/game/physics.js` | 250 | 爆炸、自動瞄準、追蹤 |
| `js/game/pickups.js` | 369 | 掉落物、經濟、道具 |
| `js/game/player.js` | 175 | 玩家：衝刺、輸入、每幀更新 |
| `js/game/progress.js` | 183 | 存檔、關卡、結算、暫停 |
| `js/game/redeem.js` | 230 | 兌換碼 |
| `js/game/simulation.js` | 1087 | 區域效果、擊殺、整體每幀模擬 |
| `js/game/training.js` | 236 | 訓練場 |
| `js/game/tutorial.js` | 392 | 教學模式（TutorialController） |
| `js/game/ultimates.js` | 1542 | 各把槍的大招（SUPER）與雷射地帶 |
| `js/game/weapons.js` | 627 | 武器資料表與出戰配置 |
| `js/icons.js` | 274 |  |
| `js/main.js` | 84 | 啟動流程與主迴圈 |
| `js/ui/account.js` | 95 | 帳號頁面（遊戲端接合） |
| `js/ui/aim.js` | 477 | 瞄準線與彈道預測 |
| `js/ui/hud.js` | 684 | 補給站、血條彈藥條、瞄準輔助 HUD |
| `js/ui/menu.js` | 1433 | 主頁、備戰、背包、關卡、商城、圖鑑 |
| `js/ui/render.js` | 1321 | 場景繪製與主頁／結算顯示 |
| `js/ui/workshop.js` | 319 | 芯片工坊與訓練場改裝 |

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

## 測試

```bash
cd neon-shard
node --import ./test/stubs.mjs --test test/*.test.mjs
```

- `account.test.mjs`：Session、API 用戶端（refresh／逾時／錯誤碼）、帳號服務、`escapeHtml`
- `game.behavior.test.mjs`：第一次遊玩自動進教學、教學 15 步通關、900 幀戰鬥、24 把槍的大招、狀態機、事件匯流排、存檔損毀與原型污染
- `ui-smoke.test.mjs`：主頁每個分頁（含帳號）都能渲染，擴充 API 仍可用

`stubs.mjs` 用假的 DOM 讓遊戲在 Node 裡執行，**只能驗證邏輯，看不到畫面**；排版、動畫與手感仍需在瀏覽器實際操作。

## 下一步（尚未做）

- 實體層級的 Class：`Player`、`Enemy`、`Bullet`、`Weapon`。目前 224 個函式仍以「實體物件當第一個參數」的方式運作，
  要改成方法需要逐一確認每個呼叫點，這次沒有做。
- 幾個模組仍然很大（`game/boss`、`game/ultimates`、`ui/menu`、`ui/render` 各約 1,300～1,500 行），可再按功能細分。
- 純資料常數仍是模組頂層的 `const`；其餘載入時才執行的程式在 `init()` 內，是為了安全而非最終形態。
