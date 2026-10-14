# NEON SHARD Online + Custom Skins

## Realtime

The API exposes WebSocket upgrades at `/api/realtime`. The first message must be `{type: "auth", token: "<Supabase access token>"}`. After the server confirms the token with Supabase Auth, send `{type:"join", mode:"arena"|"boss", code:"ROOM1"}`. Rooms hold up to four authenticated players. Movement uses normalized coordinates; combat has a server-side cooldown. Arena mode synchronizes weak mobs and PvP player positions; boss mode shares a raid boss health pool.

Set `ALLOWED_ORIGINS` to the exact deployed frontend origin(s). The browser can override the API base with `window.NEON_SHARD_API_URL` before loading `js/online/online.js`.

## Custom skins

The drawing editor uses normalized stroke coordinates and stores the cosmetic JSON in localStorage under `neon-shard.custom-skin.v1`. It does not grant gameplay advantages. Current editor is device-local; account/cloud sync and in-game avatar rendering remain follow-up integration tasks.

## Deployment checks

1. Deploy `neon-shard-api` with the existing Supabase environment variables and `ALLOWED_ORIGINS`.
2. Confirm `/api/health` responds and test an authenticated WebSocket handshake.
3. Run `npm run check` and `npm test` in `neon-shard-api`, then the frontend tests in `neon-shard`.
