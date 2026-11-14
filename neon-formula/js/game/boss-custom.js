/**
 * game/boss-custom — 新 Boss 的招式（用 Boss 名稱註冊，不必知道它是第幾隻）
 *
 * 在 config/boss-catalog.js 加好 Boss 後，在這裡以相同名稱寫招式：
 *   "酸蝕王": (e, k, ph, A) => { ... }
 *     e  Boss 本體    k  這次出第幾招（0 到 attackPatternCount - 1）
 *     ph 階段 0~3（血量越低越大）    A  朝向玩家的角度
 * 可用的招式積木都從 ./boss-attacks.js 匯入：pRing、pFan、pHom、pBomb、pSum、lat、poison、rocks、tiles…
 * 沒有在這裡註冊的 Boss 不會出招，只會移動（方便先放進訓練場看外觀）。
 */
// import { lat, pFan, pRing } from "./boss-attacks.js";
// import { G } from "../core/game-state.js";

/** @type {Record<string, (e: object, k: number, ph: number, A: number) => void>} */
export const CUSTOM_BOSS_ATTACKS = {};
