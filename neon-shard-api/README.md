# Neon-shard API

Node.js API intended for Render. GitHub Pages remains the frontend and calls this API only. The API uses Supabase Auth for identity and a server-only Supabase service-role key for database access.

## Current implementation

- Supabase Auth proxy: signup, password login, refresh, logout.
- Authenticated own-profile and key-metadata endpoints.
- First-time P-256 key registration with proof of possession.
- Browser-side Argon2id password KDF, encrypted private-key bundle, ECDH + HKDF-SHA-256 + AES-256-GCM save encryption.
- ECDSA P-256/SHA-256 signatures over canonical request JSON, verified by Render.
- Save upload/download, revision-based optimistic concurrency, request validation, 64 KiB body limit, rate limits, CORS allowlist, and safe public profile lookup.
- Unit tests for schema validation, signatures, and browser crypto round-trip.

This remains a pre-deployment integration branch. Do not deploy as production-ready until all CI checks pass and manual browser tests are completed.

## Routes

- `GET /api/health`
- `GET /api/identity/me` — verifies a Firebase ID Token using `FIREBASE_SERVICE_ACCOUNT_JSON` and returns the verified Firebase UID (the legacy save routes still use Supabase Auth).
- `POST /api/auth/signup` — `{ email, password, displayName }`
- `POST /api/auth/login` — `{ email, password }`
- `POST /api/auth/refresh` — `{ refreshToken }`
- `POST /api/auth/logout` — Bearer access token
- `GET /api/profile/me` — current user's display name and key setup status
- `PUT /api/profile` — update the authenticated user's own display name
- `GET /api/profiles/:displayName` — returns public display name only
- `GET /api/keys` — current user's encrypted key bundle and public-key metadata
- `PUT /api/keys` — first-time key registration; key rotation is deliberately rejected pending a recovery design
- `GET /api/player-data` — current user's save
- `POST /api/player-data` — create a save only if absent
- `PUT /api/player-data` — update with required `expectedRevision`

Protected routes derive the user ID from a validated Supabase access token. Request-body user IDs are not accepted.

## Crypto protocol (version 1)

- Password KDF: Argon2id, `t=2`, `m=19456 KiB`, `p=1`, `dkLen=32`; random 16-byte per-account salt.
- Long-term encryption key: ECDH P-256 key pair generated in the browser.
- Signing key: ECDSA P-256, SHA-256.
- Private ECDH/signing keys are exported only during first-time creation, placed in a JSON bundle, and wrapped with AES-256-GCM under the password-derived key. The server stores only the wrapped bundle, its IV, the salt, and public keys.
- Each save uses a fresh ephemeral ECDH P-256 key pair. HKDF-SHA-256 derives a per-save AES-256-GCM key from the shared secret and context-bound info. AES-GCM uses a fresh 96-bit IV and a 128-bit authentication tag.
- AAD binds the ciphertext to the user ID, key ID, protocol version, schema version, and ephemeral public key.
- Browser ECDSA signatures use IEEE-P1363 `r||s` encoding. The signature binds purpose, authenticated user ID, method, path, timestamp, key ID, expected revision, ordinary JSON summary, and encrypted envelope. Signatures expire after five minutes.
- Argon2id currently loads from a pinned ESM CDN import (`@noble/hashes@1.8.0`). The browser must be online for first-time key setup/unlock unless the dependency is later vendored and audited.

### Data split

The current first integration conservatively encrypts the full local `SV` save payload, because the game has not yet classified individual fields as safe to expose. `save_data` contains only a non-sensitive format marker, save timestamp, and coarse currency summary. This protects the full progression payload from being readable in the database; if you later decide specific progression fields are intentionally public, the split can be refined explicitly.

### Limitations

- Client signatures prove possession of the registered signing key and request integrity, not honest gameplay. A modified browser can still fabricate game state and sign it.
- The service-role key bypasses RLS; the API must enforce ownership on every protected operation.
- The first version does not support silent key rotation or automatic recovery. Password reset without the old password or a separately designed recovery mechanism can make sensitive saves unrecoverable.
- Render never receives or logs a password intentionally, and never decrypts the private-key bundle or save envelope.
- Browser-side Argon2id/ECDH/HKDF/AES-GCM must be tested on real mobile browsers before release.

## Environment variables

Copy `.env.example` to a local `.env` for development. Configure the values as Render environment variables for deployment. Never commit actual secrets.

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `ALLOWED_ORIGINS` (comma-separated exact origins)
- `PORT` (Render supplies this automatically)

## Local run

```sh
npm install
cp .env.example .env
# Fill .env with values; never commit .env.
npm run check
npm test
npm start
```
