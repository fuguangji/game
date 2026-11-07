# NEON SHARD API

Render hosts the server-side API. Firebase is the identity and account-data provider; GitHub Pages hosts the frontend.

## Architecture

- **Firebase Authentication** handles email/password registration, sign-in, sign-out, and ID-token refresh in the browser through the shared `account/shared-auth.js` module used by every GitHub Pages game.
- **Firebase Admin SDK** verifies ID tokens on Render. The API derives the trusted account UID from the verified token and never trusts a UID supplied by the client.
- **Cloud Firestore** stores account profiles, display-name reservations, encryption-key metadata, and encrypted cloud saves. Save data is scoped by UID under `users/{uid}`.
- **Realtime（WebSocket）** 線上聯機由本服務的 `/api/realtime` 提供（見 README-ONLINE.md）。舊的 Firebase Realtime Database／WebRTC 房間流程已移除，不需要建立 Realtime Database。
- Firestore browser rules deny direct client access to account and save documents. Render's Admin SDK is the only data-access path for those collections.

## Owner configuration

完整的「要填哪些常數」清單在前端專案的 `neon-shard/README.md`（「部署前要填的常數」）。後端這邊只需要：

1. Firebase Console → Authentication → 啟用 **Email/Password**。
2. 建立 Cloud Firestore 資料庫，並發佈本資料夾的 `firestore.rules`（全部拒絕瀏覽器直接存取；只有本服務的 Admin SDK 能讀寫）。
3. 在 Render 設定 `FIREBASE_SERVICE_ACCOUNT_JSON`（整份服務帳戶 JSON，一行；這是伺服器密鑰，不可提交）。
4. 在 Render 設定 `ALLOWED_ORIGINS` 為前端實際網址（完全一致）。
5. 重新部署後檢查 `/api/health` 與 `/api/ready`。
6. 前端 Render API 網址由 `neon-shard/js/account/config.js` 設定；Firebase Web App 設定集中於 repo root `account/firebase-config.js`。

Until the Firebase service account is configured, the API process can still start and health checks can respond, but identity/profile/save endpoints correctly return `503 FIREBASE_ADMIN_NOT_CONFIGURED`.

## Routes

- `GET /api/health` — process health.
- `GET /api/ready` — Firebase Admin and Firestore readiness.
- `GET /api/identity/me` — verifies a Firebase ID token and initializes/returns its Firestore profile.
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh` — intentionally return `410 USE_FIREBASE_AUTH`; passwords go directly from the browser to Firebase Authentication through the shared Firebase SDK module (`account/shared-auth.js`) and never reach this API.
- `POST /api/auth/logout` — authenticated no-content response; the browser signs out through Firebase Auth.
- `GET /api/profile/me` — current UID, display name, and key-setup status.
- `PUT /api/profile` — update the authenticated user's display name.
- `GET /api/profiles/:displayName` — public display-name lookup only.
- `GET /api/keys` / `PUT /api/keys` — read or register encryption-key metadata; first registration requires proof of possession.
- `GET /api/player-data` — read the authenticated user's cloud save.
- `POST /api/player-data` — create a save if absent.
- `PUT /api/player-data` — update a save using `expectedRevision` optimistic concurrency.

## Save encryption and integrity

- Password-derived key wrapping uses the existing browser-side Argon2id protocol. The password and private keys are never sent to Render.
- Each save's sensitive envelope is encrypted in the browser with AES-GCM and stored by Firestore as ciphertext.
- The browser signs save requests with ECDSA P-256; Render validates the signature, user UID, key ID, timestamp, and revision.
- Firestore save documents are stored under `users/{uid}/gameData/currentSave`, and key metadata is stored on `users/{uid}`.
- Firestore transaction logic prevents two initial saves, checks revision conflicts, and reserves display names.

## Local checks

Run inside `neon-shard-api`:

```sh
npm run check
npm test
```

Live authentication and Firestore integration tests require the owner's Firebase project and Render service-account configuration.
