# NEON FORMULA Online + Custom Skins

## Realtime

The API exposes WebSocket upgrades at `/api/realtime`. The first message must be `{type: "auth", token: "<Firebase ID token>"}`. After the server verifies the token with Firebase Admin SDK, send `{type:"join", mode:"arena"|"boss", code:"ROOM1"}`. Rooms hold up to four authenticated players. Movement uses normalized coordinates; combat has a server-side cooldown. Arena mode synchronizes weak mobs and PvP player positions; boss mode shares a raid boss health pool.

Set `ALLOWED_ORIGINS` to the exact deployed frontend origin(s). 前端在「個人檔案 → 線上聯機」連線（`neon-formula/js/profile/realtime-client.js`）；API 網址在 `neon-formula/js/account/config.js`（或載入前設定 `window.NEON_FORMULA_API_BASE`）。

## Custom skins

外觀編輯器已整合進遊戲的「個人檔案 → 外觀」（`neon-formula/js/profile/appearance.js`），只存在本機、不影響遊戲能力。

## Deployment checks

1. Deploy `neon-shard-api` with `FIREBASE_SERVICE_ACCOUNT_JSON` and `ALLOWED_ORIGINS`.
2. Confirm `/api/health` responds and test an authenticated WebSocket handshake.
3. Run `npm run check` and `npm test` in `neon-shard-api`, then the frontend tests in `neon-formula`.

## 對戰玩法與協定（v2）

房間流程：`lobby`（大廳）→ 房主送 `start` → `playing` → `ended`（房主可 `reset` 回大廳）。對戰中不能加入新玩家；最多 4 人。

| 玩法（前端顯示） | 協定 `mode` | 規則 |
|---|---|---|
| **競爭模式** | `arena` | 玩家互相對戰，也能打 3 隻伺服器管的弱敵人（得分、6 秒重生）。玩家血量 100，**由伺服器決定**，歸零淘汰；剩最後一人或 150 秒到，以「存活 → 分數 → 血量」排名。至少 2 人 |
| **合作模式** | `boss` | 大家打同一隻 Boss，共用 1000 單位血量；各端自己模擬 Boss 行為，只共享血量與「誰倒下」。Boss 歸零全員勝利，全員倒下失敗。1 人即可 |

用戶端 → 伺服器：`auth`、`join {code, mode}`、`start`、`reset`、`leave`、`move {x, y, hp?}`、`shot {shots:[{x,y,vx,vy}]}`（只轉發給別人看，純視覺）、`hit {target, dmg}`（競爭：打中玩家 id 或弱敵人 `m1…`）、`bossDamage {amount}`（合作：Boss 最大血量的千分比）、`died`（合作：自己倒下）、`attack`（舊版，只在大廳可用）。

伺服器 → 用戶端：`authenticated {playerId}`、`room`（房間快照，含 `phase`、`hostId`）、`started {mode, spawns, seed, endsAt, playerCount, bossPool}`、`move`、`shot`、`combat`（血量／Boss／弱敵人）、`eliminated`、`end {result}`、`error`。座標一律是 0~1 的地圖比例。`seed` 讓所有人產生同一張地圖。

**防作弊的立場**：傷害是用戶端回報，伺服器沒有模擬整個遊戲。每個回報都檢查：階段與存活、單次上限（`maxHitDamage` 40、`maxBossDamagePerReport` 150）、每秒傷害預算（令牌桶）、攻擊者與目標的距離（`hitRange`）。這擋得住離譜的值，擋不住刻意的外掛。所有數值集中在 `src/room-manager.js` 的 `MATCH_RULES`。
