# NEON SHARD — 開發與部署待辦（dev.md）

最後更新：2026-10-26

這份文件集中列出需要由專案擁有者親自設定的項目。不要把 Firebase 管理員憑證、服務帳號 JSON、TURN 長期密鑰或任何密碼提交到 GitHub。

## 目前架構狀態

- [x] 為 Render 部署分支準備 Node.js 安全修補：PR #15 將 .node-version 與 API engines.node 固定到 Node.js 24.22.1。
- [x] 新增 Firebase Web 設定模板：neon-shard/js/profile/firebase-config.js。
- [x] 新增 Firebase Anonymous Auth + Realtime Database 房間訊號 + WebRTC DataChannel 傳輸層。
- [x] 新增 Realtime Database 規則範本：neon-shard/firebase.database.rules.json。
- [ ] 填入 Firebase 專案設定、啟用匿名登入、建立 Realtime Database 並發布規則。
- [ ] 為跨 NAT／校園網路／行動網路提供 TURN 中繼服務並完成雙網路測試。
- [ ] 把 P2P 封包正式接入遊戲模擬：遠端玩家渲染、房主端輸入驗證、權威戰鬥狀態與重連處理。
- [x] 合併 PR #15；Render 部署已成功，建置記錄確認使用 Node.js 24.22.1。main 也已加上相同版本鎖定。
- [ ] 再人工確認 API health、既有登入、金鑰讀取與加密存檔流程。
- [x] 新增 `/account/` 共用 Firebase Email/Password 登入／註冊頁與同來源持久化登入狀態。
- [x] 新增 Render `/api/identity/me`：由 Firebase Admin SDK 驗證 ID Token，而不是相信前端提供的 UID。
- [ ] 在 Firebase Console 與 Render 填入設定，完成實際身分驗證測試。
- [ ] 將既有雲端存檔 API 從 Supabase Auth 身分遷移到 Firebase UID；目前這部分尚未完成。

> **重要：共用登入已開始改用 Firebase Authentication；`/api/identity/me` 可用 Firebase Admin 驗證 ID Token，但需先在 Render 設定服務帳號。** 現有雲端加密存檔 API 仍使用舊的 Supabase Auth session，尚未接上 Firebase UID。登入中心的「伺服器身分驗證」與雲端存檔功能是兩件事，不能把前者視為存檔遷移已完成。線上聯機目前可建立房間、加入房間、建立 P2P DataChannel 並傳送測試封包；它尚不代表整場戰鬥已經由房主完整模擬及同步。

---

## 0. 共用帳號中心（最新開發分支）

共用登入入口是 `/account/`。遊戲內所有「登入／建立帳號」入口都應導向這裡，附上 `returnTo`，登入後回到原遊戲。頁面會限制回跳網址必須同來源且位於網站部署路徑內，避免開放式重新導向。

### A. Firebase Web 設定

1. Firebase Console → Project settings → General → Your apps，選擇共用 Web App。
2. 將實際的 `apiKey`、`authDomain`、`databaseURL`、`projectId`、`appId` 填入 `account/firebase-config.js`。
3. Firebase Console → Authentication → Sign-in method，啟用 **Email/Password**。
4. Authentication → Settings → Authorized domains，確認 GitHub Pages 網域已列入；本機測試則依 Firebase Console 的目前介面加入 localhost。
5. `neon-shard/js/profile/firebase-config.js` 現在只是轉出共用設定，不要在兩處填兩份不同的 Firebase 專案資料。
6. 若仍使用線上房間，另外依第 1 節啟用 Anonymous Auth；匿名身分只供房間流程使用，不會取代電子郵件帳號。

### B. Render 後端驗證憑證

1. Firebase Console → Project settings → Service accounts，產生 Admin SDK 服務帳號 JSON。
2. Render → `neon-shard-api` Web Service → Environment，新增 `FIREBASE_SERVICE_ACCOUNT_JSON`。
3. 將完整服務帳號 JSON 作為環境變數值貼入。**不要**把 JSON 檔案提交 GitHub、放進前端、寫進 `.env.example` 或貼到聊天。
4. 重新部署 Render。
5. 登入 `/account/` 後，頁面應顯示「伺服器已驗證你的身分」。若顯示 `FIREBASE_ADMIN_NOT_CONFIGURED`，代表 Render 尚未收到該環境變數；若驗證失敗，檢查 JSON 與前端設定是否指向同一 Firebase 專案。

驗證端點：`GET https://neon-shard-api.onrender.com/api/identity/me`，使用 `Authorization: Bearer <Firebase ID Token>`。Token 是短期有效的身分證明，不是永久密碼；後端會驗簽並從 Token 取得可信的 `uid`，不會信任前端另傳的 UID。

### C. 目前範圍與待完成工作

- 已新增共用登入／註冊、登入狀態持久化、登出、忘記密碼及安全的 `returnTo` 檢查。
- NEON SHARD 未登入時的登入／註冊入口已導向共用帳號中心。
- 已新增 Firebase Admin 驗證端點；沒有設定服務帳號時，端點會回報尚未配置，不會假裝驗證成功。
- [x] 已在 Neon-shard Supabase 專案新增 `firebase_identities`、`firebase_profiles`、`firebase_player_data` 三張 Firebase UID（text）資料表，保留舊 UUID 表與外鍵不動；SQL 記錄在 `neon-shard-api/sql/firebase-shared-account.sql`。三張新表已啟用 RLS，僅授權 `service_role` 直接存取。
- [x] Render API 已開始依經過驗證的 Token provider 分流：Firebase UID 寫入新表，舊 Supabase session 仍走原表，避免直接把 Firebase UID 塞進 UUID 欄位。
- **仍需完成線上驗證：** 在 Render 設定 `FIREBASE_SERVICE_ACCOUNT_JSON`，填入 Firebase Web config，然後測試新帳號、金鑰初始化、加密存檔上傳／下載及不同 UID 間的資料隔離。
- Firebase WebRTC 房間目前使用另一個具名 Firebase App 與匿名登入，避免覆寫共用帳號登入狀態。後續需決定房間採已登入 UID 還是允許訪客 UID，並讓資料庫規則一致。
- 測試順序：建立帳號 → 登出 → 登入 → 重新整理 → 新分頁／另一款遊戲沿用登入狀態 → 登出後確認各頁狀態同步 → 確認伺服器驗證回傳 UID 與 Firebase 使用者相同。

---

## 1. Firebase 專案設定（你需要操作）

### A. 建立 Web App

1. 開啟 [Firebase Console](https://console.firebase.google.com/) 並建立或選擇專案。
2. 專案設定（齒輪）→「一般」→「你的應用程式」→ 新增 Web App。
3. 複製 Web App 設定值，填入 account/firebase-config.js 的 FIREBASE_CONFIG：
   - apiKey
   - authDomain
   - databaseURL
   - projectId
   - appId
4. databaseURL 必須是 Firebase Console 實際顯示的 Realtime Database URL；不要猜區域或網域。
5. Web Firebase config 本身不是管理員密鑰，可以出現在前端；真正的存取限制由資料庫規則與 Authentication 決定。

### B. 開啟匿名登入

1. Firebase Console → Authentication → Sign-in method。
2. 啟用 Anonymous。
3. 儲存。

這只用於線上房間身分，不會自動取代遊戲現有的電子郵件帳號／雲端存檔登入。

### C. 建立 Realtime Database 並設定規則

1. Firebase Console → Realtime Database → Create Database。
2. 選擇你需要的資料庫區域。
3. 打開 Rules。
4. 將 neon-shard/firebase.database.rules.json 的內容貼上並發布。
5. 不要為了「先讓它能跑」而把根規則改成 .read=true 或 .write=true。

規則以房間代碼、Firebase 使用者 UID 和房主／加入者角色限制存取。房間代碼應只分享給要一起玩的玩家；不要把房間代碼當作帳號密碼或高安全性的秘密。

### D. TURN 中繼（跨網路必要的可靠性設定）

目前程式預設只有 Google STUN。這能讓許多網路建立直連，但無法保證在所有 NAT、校園 Wi-Fi、行動網路或嚴格防火牆下成功。

- 選擇可信任的 WebRTC TURN 服務。
- 取得可輪替或短期有效的 TURN 使用者憑證。
- 將服務提供的 ICE server 設定加入 FIREBASE_ICE_SERVERS。
- 不要把 TURN 服務的永久 API secret 寫進前端檔案或 GitHub。若服務需要秘密金鑰，必須由安全的後端產生短期憑證。
- 至少用兩個不同網路測試：例如一台使用家用 Wi-Fi，另一台使用行動網路。

---

## 2. 本機測試

從 repository 根目錄執行：

    python3 -m http.server 8000

瀏覽器開啟：

    http://localhost:8000/neon-shard/

在「個人檔案 → 線上聯機」測試：

1. 瀏覽器 A 選擇模式，按「建立房間（我是房主）」。
2. 將顯示的 6 位代碼交給瀏覽器 B。
3. 瀏覽器 B 選擇相同模式、輸入代碼，按「加入房間」。
4. 等待狀態變成 P2P 已連線。
5. 點「傳送攻擊輸入」，確認另一端顯示收到攻擊封包；移動角色時，另一端應持續收到位置資料。
6. 關閉房主頁面，確認加入者收到房間結束訊息。
7. 再用兩個不同網路測一次，確認 TURN 是否真的有配置到位。

如果初始化錯誤，先檢查 firebase-config.js 是否仍含 REPLACE_ME。如果出現 permission denied，檢查 Anonymous Authentication 是否啟用，以及資料庫規則是否已發布。若 P2P 一直停在協商中，先查看瀏覽器 Console，再檢查 TURN。

---

## 3. Node.js / Render 安全修補

官方 Node.js 2026-10-21 安全公告修補了多項問題，包括高嚴重度的 Brotli 解碼器漏洞。NEON SHARD API 的舊設定 node >=20 沒有限制上界，也沒有鎖定已修補版本。

1. PR [#15](https://github.com/fuguangji/game/pull/15) 已合併到 Render 使用的分支 feature/neon-shard-integration。
2. Render 自動部署已成功；建置記錄明確顯示使用 Node.js 24.22.1。
3. 還需要人工確認 https://neon-shard-api.onrender.com/api/health 回傳健康狀態，並測試既有登入、金鑰讀取與加密存檔流程。
4. main 分支也已加入根目錄 .node-version 與 API package 的版本鎖定，避免未來切換部署分支時重新採用不明確版本。

官方公告與 Render 版本選擇說明：
- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://render.com/docs/node-version

不要只改 main 分支的版本檔就以為線上服務已修補。Render 目前指向 feature/neon-shard-integration，所以 PR #15 的目標分支與實際部署分支必須一致。

---

## 4. 遊戲連線目前的限制與下一步

現在的連線層完成的是「配對 + WebRTC 傳輸」：

- 房主建立房間，加入者以 6 位代碼加入。
- 最多兩名玩家。
- Firebase Realtime Database 只承載房間資料與 WebRTC offer／answer／ICE 訊號。
- 連線建立後，位置與攻擊測試封包走 WebRTC DataChannel，而不是每 100 ms 寫入 Firebase。
- 房主離線時房間會結束。
- 連線層會對輸入格式做基本檢查，但它不是完整的伺服器權威戰鬥模擬。

接下來要整合 neon-shard/js/game/simulation.js 與玩家／敵人狀態：

1. 遠端玩家要有獨立實體，不能直接覆寫本機的 G.pl。
2. 加入者只送「輸入意圖」（移動、瞄準、攻擊、技能），不能自行宣告傷害、敵人死亡或 Boss HP。
3. 房主以固定模擬步長驗證輸入並執行戰鬥，定期傳送版本化狀態快照。
4. 加入序號、封包大小限制、輸入頻率限制、斷線／暫停處理。
5. 房主瀏覽器被手機系統暫停或關閉時，房間結束；這是目前選定的規則，不做房主遷移。
6. 用延遲、丟包、重複封包、加入者中途離開、房主關閉分頁等情境做測試。

---

## 5. 雲端存檔遷移提醒

共用登入已開始使用 Firebase Authentication，但雲端存檔仍使用 Render API + Supabase Auth/PostgreSQL。不要直接刪除舊後端或替換 cloud-crypto.js。

加密資料的金鑰推導、簽章與關聯資料會綁定使用者識別及版本。若決定把帳號與存檔全面遷移到 Firebase，必須先設計：
- Firebase Authentication 帳號建立／登入／驗證與既有帳號對應；
- 存檔 schema、revision／衝突處理與資料庫安全規則；
- 舊帳號和加密存檔的可逆遷移或使用者主動匯出／匯入流程；
- 恢復、錯誤回滾、舊版用戶相容與測試。

在這些項目驗證之前，保留既有雲端存檔服務，避免讓舊資料無法解密。
