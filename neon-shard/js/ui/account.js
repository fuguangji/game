/** ui/account — 個人檔案頁面（遊戲端接合）：把遊戲的資料與動作包成 ProfileBridge，交給 ProfilePage 顯示 */
import { API_BASE } from "../account/config.js";
import { AccountView, accountService } from "../account/index.js";
import { settings } from "../core/settings-store.js";
import { G } from "../core/game-state.js";
import { MW } from "../core/viewport.js";
import { CHS } from "../game/chips.js";
import { STG, SV, SV_DEFAULTS, mergeSave, save } from "../game/progress.js";
import { startTutorial } from "../game/tutorial.js";
import { startShopGuide } from "./shop-guide.js";
import { ALLWEAPON, applyLO } from "../game/weapons.js";
import { ProfilePage } from "../profile/profile-page.js";
import { AAH, setAA } from "./hud.js";
import { xGo } from "./menu.js";

/** 把雲端存檔安全地套用到本機：以預設值為底，只接受型別相符的欄位，並刷新畫面與出戰配置 */
export function applyRemoteSave(remoteSave) {
  const next = JSON.parse(JSON.stringify(SV_DEFAULTS));
  mergeSave(next, remoteSave, { allowUnknown: false });
  for (const key of Object.keys(SV)) delete SV[key];
  Object.assign(SV, next);
  G.CHR = CHS[SV.char] || CHS[0];
  save();
  applyLO();
  if (window.upd) window.upd();
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 個人檔案頁面需要的遊戲資料與動作（頁面本身不直接碰遊戲內部） */
const profileBridge = {
  getSave: () => JSON.parse(JSON.stringify(SV)),
  applySave: applyRemoteSave,
  getProgress: () => ({
    clearedStages: (Array.isArray(SV.clr) ? SV.clr : []).filter(Boolean).length, // 存檔欄位被改壞時也不會讓頁面崩潰
    totalStages: STG.length,
    bestScore: G.best ?? 0,
    ownedWeapons: (SV.own || []).length,
    totalWeapons: ALLWEAPON.getWeapon().length,
    ownedCharacters: (SV.chars || []).length,
    totalCharacters: CHS.length,
  }),
  getRoleColor: () => (HEX_COLOR.test(G.CHR?.c) ? G.CHR.c : "#22e6ff"),
  getAutoAim: () => G.AA,
  setAutoAim: (mode) => setAA(mode),
  get autoAimLabels() { return AAH; }, // 用到時才讀取（避免模組載入順序問題）
  replayTutorial: () => startTutorial(),
  replayShopGuide: () => startShopGuide(),
  goTo: (tab) => xGo(tab),
  getPlayerPosition: () => (G.pl ? { x: Math.max(0, Math.min(1, G.pl.x / MW)), y: Math.max(0, Math.min(1, G.pl.y / MW)) } : null),
};

// 功能：建立「個人檔案」頁面（個人檔案、設定、外觀、雲端同步、線上聯機）。
export function xAccount(v) {
  ProfilePage.mount(v, { bridge: profileBridge, accountService, AccountView, settings, apiBase: API_BASE });
}
