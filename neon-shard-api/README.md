# NEON SHARD API

Render hosts the server-side API. Firebase is the identity and account-data provider; GitHub Pages hosts the frontend.

## Architecture

- **Firebase Authentication** handles email/password registration, sign-in, sign-out, and ID-token refresh in the browser.
- **Firebase Admin SDK** verifies ID tokens on Render. The API derives the trusted account UID from the verified token and never trusts a UID supplied by the client.
- **Cloud Firestore** stores account profiles, display-name reservations, encryption-key metadata, and encrypted cloud saves. Save data is scoped by UID under `users/{uid}`.
- **Realtime Database** remains dedicated to the existing WebRTC room/signaling flow.
- Firestore browser rules deny direct client access to account and save documents. Render's Admin SDK is the only data-access path for those collections.

## Owner configuration

1. Fill the public Firebase Web App values in `account/firebase-config.js`. This file intentionally contains placeholders until the project owner fills them in.
2. In Firebase Console, enable **Email/Password** in Authentication.
3. Create a Cloud Firestore database and publish the repository's `firestore.rules`.
4. In Render, set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete service-account JSON value. This is a server secret; never commit it.
5. Set `ALLOWED_ORIGINS` to the exact deployed website origin(s).
6. Redeploy the Render service and check `/api/health` and `/api/ready`.

Until the Firebase service account is configured, the API process can still start and health checks can respond, but identity/profile/save endpoints correctly return `503 FIREBASE_ADMIN_NOT_CONFIGURED`.

## Routes

- `GET /api/health` — process health.
- `GET /api/ready` — Firebase Admin and Firestore readiness.
- `GET /api/identity/me` — verifies a Firebase ID token and initializes/returns its Firestore profile.
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh` — intentionally return `410 USE_FIREBASE_AUTH`; passwords must go directly to Firebase Authentication from `/account/`.
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
