/** api/extension — 對外擴充 API（window.NEON_SHARD_API） */
import { fsm, registerStateGuard, registerStateHook, registerStateTransition } from "../core/state-machine.js";
import { ALLWEAPON } from "../game/weapons.js";
import { registerAimLineExtension } from "../ui/aim.js";



/** 本模組「載入時才執行」的程式（填入資料表、註冊事件…）。由 main.js 依原本順序呼叫，避免模組互相引用時的載入順序問題。 */
export function init() {


/*
 * NEON SHARD 擴充 API。
 * 其他模組載入完成後可透過 window.NEON_SHARD_API 註冊狀態與瞄準線擴充。
 * getWeaponDefinitions() 回傳凍結的武器定義；前端封裝不是伺服器端防作弊機制。
 */
Object.defineProperty(window, "NEON_SHARD_API", {
  configurable: true,
  value: Object.freeze({
    registerStateTransition,
    registerStateHook,
    registerStateGuard,
    registerAimLineExtension,
    getState: () => fsm.state,
    getWeaponDefinitions: () => ALLWEAPON.getWeapon(),
  }),
});
}

