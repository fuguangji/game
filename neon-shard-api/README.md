# Neon-shard API

Node.js API intended for Render. GitHub Pages is the browser frontend; browser code calls this API only. The API uses Supabase Auth for identity and a server-only Supabase service-role key for database access.

## Status

This is the first backend implementation pass. It includes Auth proxy routes, profile operations, key registration, save reads/writes, optimistic revisions, input limits, and signed-request verification. The frontend has not yet been integrated with this API. Do not treat this as production-ready until the cryptographic client helper and end-to-end tests are added.

## Routes

- `GET /api/health`
- `POST /api/auth/signup` — `{ email, password, displayName }`
- `POST /api/auth/login` — `{ email, password }`
- `POST /api/auth/refresh` — `{ refreshToken }`
- `POST /api/auth/logout` — Bearer access token
- `PUT /api/keys` — first-time key bundle registration and proof of signing-key possession
- `GET /api/player-data` — current user's save
- `POST /api/player-data` — create a save only if absent
- `PUT /api/player-data` — update with required `expectedRevision`
- `GET /api/profiles/:displayName` — returns the public display name only
- `PUT /api/profile` — update the authenticated user's own display name

Protected routes derive the user ID exclusively from a validated Supabase access token. Request-body user IDs are not accepted. Saves are signed using ECDSA P-256/SHA-256 with IEEE-P1363 signatures over the canonical JSON protocol defined in `src/security.js`. The server verifies signatures and never decrypts `sensitiveEnvelope`.

## Cryptographic wire format

Public keys are P-256 JWK objects with `kty`, `crv`, `x`, and `y`. The private-key bundle remains client-side encrypted; only its ciphertext and IV are stored. The client must implement Argon2id and password-derived wrapping locally. Passwords are only sent to Supabase Auth through this API and are not logged or persisted by Render.

For each save, `sensitiveEnvelope` contains:
- `cryptoVersion`
- `keyId`
- `schemaVersion`
- `ephemeralPublicKey` (P-256 JWK)
- `iv` (base64url, at least 12 decoded bytes)
- `ciphertext` (base64url)
- `tag` (base64url)

The frontend and API must agree on the exact canonical JSON signature input. The signature covers purpose, authenticated user ID, HTTP method, request path, signed timestamp, key ID, expected revision, plain save JSON, and encrypted envelope. Signed timestamps older/newer than five minutes are rejected. Revision checks prevent stale writes; they do not prevent a modified browser from signing fabricated gameplay state.

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
# Fill .env with project values; never commit it.
npm run check
npm test
npm start
```

## Important security limitations / remaining work

- The service-role key bypasses RLS. Every route must enforce authorization server-side; this API uses the verified Auth user ID for data ownership.
- Client signatures establish possession of the registered signing key, not fair play or truthful game state.
- First-time key setup is supported. Key rotation/recovery needs a deliberate flow and is rejected by this initial version rather than silently replacing existing keys.
- Password reset without the old password or a separately designed recovery mechanism can make sensitive saves unrecoverable.
- Add browser-side Argon2id/ECDH/HKDF/AES-GCM implementation and integration tests before connecting the game UI.
- Supabase table checks are reasonableness/shape checks, not comprehensive game-rule validation.
