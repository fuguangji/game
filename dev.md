# NEON SHARD — 開發與部署待辦

最後更新：2026-10-26

## 架構決策

- **Firebase Authentication** 是所有遊戲共用的唯一登入系統。
- **Cloud Firestore** 儲存共用帳號資料、顯示名稱索引、加密金鑰中繼資料與雲端存檔。
- **Firebase Realtime Database** 保留給既有 WebRTC 房間訊號／聯機流程使用。
- **Render** 只負責 API、驗證 Firebase ID Token、執行簽章驗證及透過 Firebase Admin SDK 存取 Firestore。
- 不再把 Supabase 當作新帳號或新存檔架構的一部分。舊 Supabase 資料表尚未刪除；因為這是未公開測試專案，先不做不必要的破壞性刪除。
- 前端 Firebase Web 設定是公開設定，保留佔位值供專案擁有者自行填寫；服務帳號 JSON 永遠只放 Render 環境變數。

## 已完成的程式工作

- [x] `/account/` 共用 Firebase Email/Password 註冊、登入、登出、忘記密碼及安全的 `returnTo`。
- [x] 同來源頁面透過 Firebase Auth browser-local persistence 共用登入狀態。
- [x] Render API 透過 Firebase Admin SDK 驗證 ID Token，UID 只從已驗證 Token 取得。
- [x] 新增 Firestore store：`users/{uid}` 保存個人資料與加密金鑰中繼資料；`users/{uid}/gameData/currentSave` 保存雲端存檔；`displayNames/{normalizedName}` 預留暱稱。
- [x] 雲端存檔仍由前端加密、簽署；Render 驗證簽章、UID、金鑰 ID、時間戳及 revision。
- [x] WebSocket realtime 驗證改用 Firebase ID Token。
- [x] 新增 `firestore.rules`：禁止瀏覽器直接讀寫帳號與存檔文件，透過 Render Admin SDK 存取。
- [x] `.env.example` 移除 Supabase 必填設定；Firebase Admin 未配置時，健康檢查可回應，帳號與存檔端點則回傳 503。
- [x] 已確認先前新增的 Supabase Firebase UID 資料表均為空表，已移除，未影響舊有 Supabase 帳號表。
- [ ] GitHub Actions 全部測試通過，並完成 API 與前端測試審核。
- [ ] 填入 Firebase Web App 設定與 Render 服務帳號憑證後，進行真實端到端驗證。
- [ ] 確認 Cloud Firestore 資料庫已建立、發布規則，並開啟必要的 Firebase Authentication provider。
- [ ] TURN 中繼服務與 WebRTC 跨 NAT 測試。
- [ ] 將 P2P 封包正式接入遊戲模擬：遠端玩家渲染、房主端輸入驗證、權威戰鬥狀態與重連處理。

## 你需要手動填入的項目

### 1. Firebase Web App（公開設定）

Firebase Console → Project settings → General → Your apps，建立或選擇共用 Web App，將設定填入 `account/firebase-config.js`。

欄位包含 `apiKey`、`authDomain`、`databaseURL`、`projectId`、`appId`。目前刻意保留 `REPLACE_ME`，不要把 Firebase Admin 服務帳號內容放進此檔。

### 2. Firebase Authentication

Firebase Console → Authentication → Sign-in method → 啟用 **Email/Password**。

Authentication → Settings → Authorized domains，確認 GitHub Pages 網域已加入。若要本機測試，依 Firebase Console 畫面加入 localhost。

若仍使用現有的 WebRTC 房間流程，也要啟用 **Anonymous** provider；它只是舊房間訊號流程的匿名使用者，不取代 Email/Password 共用帳號。

### 3. Cloud Firestore

Firebase Console → Firestore Database → Create database。選擇適合專案的區域，之後將 repository 根目錄的 `firestore.rules` 發布至 Firestore Rules。

資料結構：
- `users/{firebaseUid}`：電子郵件、暱稱、驗證狀態、加密金鑰中繼資料。
- `users/{firebaseUid}/gameData/currentSave`：遊戲存檔與加密 envelope、revision。
- `displayNames/{normalizedName}`：暱稱唯一性索引。
- `_health/firestore`：Render readiness probe。

規則預設拒絕瀏覽器直接存取；Render 透過 Firebase Admin SDK 存取。請勿為了方便而開放所有人讀寫。

### 4. Render 服務帳號

1. Firebase Console → Project settings → Service accounts → Generate new private key。
2. Render → `neon-shard-api` Web Service → Environment，新增 `FIREBASE_SERVICE_ACCOUNT_JSON`。
3. 把完整 JSON 貼成單一環境變數值。**不要提交 JSON 到 GitHub、不要放入前端，也不要貼在聊天中。**
4. 設定 `ALLOWED_ORIGINS=https://fuguangji.github.io`（若另有自訂網域，再加入確切 origin）。
5. 重新部署 Render。

### 5. 驗證流程

1. 開啟 `https://fuguangji.github.io/account/` 註冊測試帳號。
2. 驗證電子郵件（若 Firebase 專案要求），登入後開啟 NEON SHARD。
3. 在不同分頁／遊戲頁確認登入狀態共用，登出後確認其他分頁更新狀態。
4. 觸發伺服器身分驗證，確認回傳 UID 與 Firebase 使用者一致。
5. 初始化／解鎖加密金鑰，測試雲端存檔建立、讀取、revision 衝突與帳號隔離。
6. 開啟 `https://neon-shard-api.onrender.com/api/health`；Firebase 設定完成後，`/api/ready` 應回傳 `storage: firebase-firestore`。
7. 未配置 Admin JSON 時，帳號／存檔端點應回傳 `FIREBASE_ADMIN_NOT_CONFIGURED`，不得假裝驗證成功。

## API 路由摘要

- `GET /api/health`：程序存活狀態。
- `GET /api/ready`：Firebase Admin／Firestore readiness。
- `GET /api/identity/me`：驗證 Firebase ID Token 並初始化／回傳 Firestore profile。
- `GET /api/profile/me`、`PUT /api/profile`：目前帳號資料與暱稱更新。
- `GET /api/keys`、`PUT /api/keys`：讀取／首次註冊加密金鑰中繼資料。
- `GET /api/player-data`、`POST /api/player-data`、`PUT /api/player-data`：讀取／建立／更新雲端存檔。
- `POST /api/auth/signup`、`POST /api/auth/login`、`POST /api/auth/refresh`：回傳 `410 USE_FIREBASE_AUTH`，避免密碼繞道進入 Render；帳號登入流程只在 Firebase Auth 執行。
- `POST /api/auth/logout`：需有效 Firebase ID Token；真正登出由瀏覽器 Firebase Auth SDK 執行。

## 安全注意事項

- Firebase ID Token 是短期身分證明，不是永久密碼。後端驗證簽章與有效期，再從 Token 取得 UID。
- 永遠不要接受前端自行提交的 UID 作為授權依據。
- 私密加密金鑰只在瀏覽器使用；伺服器只儲存加密後的金鑰包與公開金鑰。
- Firestore rules 禁止前端直接讀寫帳號／存檔資料；Admin SDK 服務帳號憑證只存 Render。
- 不要為了讓測試通過而略過簽章驗證或把 Firestore 規則改成公開讀寫。
