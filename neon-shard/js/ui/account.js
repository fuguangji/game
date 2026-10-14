/** ui/account — 帳號頁面（遊戲端接合） */
import { AccountView, accountService } from "../account/index.js";
import { G } from "../core/game-state.js";
import { CHS } from "../game/chips.js";
import { STG, SV, SV_DEFAULTS, mergeSave, save } from "../game/progress.js";
import { ALLW, applyLO } from "../game/weapons.js";
import { xGo, xbt, xh } from "./menu.js";

/* =====================================================================
 * 帳號頁面（遊戲端接合）：顯示玩家資料與進度，雲端同步交給 AccountView。
 * 這裡只處理「遊戲存檔」的讀取與套用；網路、加密、登入狀態都在 account/ 底下。
 * ===================================================================== */

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

const ACCOUNT_STATUS_TEXT = (svc) => !svc.signedIn ? "本機存檔 · 尚未連結線上帳號" : svc.unlocked ? "雲端帳號 · 金鑰已解鎖" : "雲端帳號 · 需要密碼解鎖";

// 功能：建立玩家帳號頁面，顯示個人資料、遊戲進度與雲端同步功能。
export function xAccount(v) {
  const box = xh("x-doc");
  box.style.display = "grid";
  box.style.gap = "12px";
  v.append(box);

  // 1. 玩家資料（名稱與狀態會隨登入狀態更新）
  const profile = xh("x-pn");
  profile.append(xh("x-h", "玩家資料"));
  const nameValue = xh("");
  nameValue.style.fontSize = "1.5rem";
  nameValue.style.fontWeight = "bold";
  const nameBox = xh("x-tx");
  nameBox.append(xh("", "玩家名稱"), nameValue);
  const status = xh("x-tag");
  profile.append(nameBox, status);
  box.append(profile);

  // 2. 遊戲進度（存檔欄位被改壞時也不會讓頁面崩潰）
  const cleared = (Array.isArray(SV.clr) ? SV.clr : []).filter(Boolean).length;
  const stats = xh("x-pn");
  stats.append(xh("x-h", "遊戲進度"));
  const grid = xh("x-kv4");
  [
    ["已通關", `${cleared} / ${STG.length}`],
    ["最高分", String(G.best)],
    ["已解鎖槍械", `${(SV.own || []).length} / ${ALLW.length}`],
    ["已解鎖角色", `${(SV.chars || []).length} / ${CHS.length}`],
  ].forEach(([label, value]) => {
    const item = xh("");
    item.append(xh("span", label));
    const number = xh("b");
    number.textContent = value;
    item.append(number);
    grid.append(item);
  });
  stats.append(grid);
  box.append(stats);

  // 3. 帳號操作
  const actions = xh("x-pn");
  actions.append(xh("x-h", "帳號操作"));
  const buttons = xh("x-two");
  buttons.append(xbt("x-btn", "前往備戰", () => xGo("b")), xbt("x-btn", "返回大廳", () => xGo("h")));
  actions.append(buttons);
  box.append(actions);

  // 4. 雲端帳號與加密存檔
  const cloud = xh("x-pn");
  cloud.append(xh("x-h", "雲端同步"));
  const cloudHost = xh("");
  cloud.append(cloudHost);
  box.append(cloud);

  const view = AccountView.mount(cloudHost, accountService, {
    getSave: () => JSON.parse(JSON.stringify(SV)),
    applySave: applyRemoteSave,
  });
  const syncProfile = () => {
    nameValue.textContent = accountService.displayName; // textContent：暱稱不會被當成 HTML
    status.textContent = ACCOUNT_STATUS_TEXT(accountService);
    const subtitle = document.querySelector("#xT small");
    if (subtitle) subtitle.textContent = `歡迎回來，${accountService.displayName}`;
  };
  view.onChange(syncProfile);
  syncProfile();
}
