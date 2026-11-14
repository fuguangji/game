/**
 * 線上對戰的「旗標」（極小的模組，讓戰鬥核心可以檢查而不必依賴整個對戰模組，避免循環匯入）。
 *   active：目前是線上對戰（沒有波次、商店，暫停不會凍結遊戲）
 *   mode  ：'arena'（競爭）| 'boss'（合作）
 *   pvp   ：競爭模式（玩家對戰；本地受傷一律以伺服器為準）
 *   coop  ：合作模式（共享 Boss 血量）
 */
export const onlineState = {
  active: false,
  mode: null,
  pvp: false,
  coop: false,
  /** 套用伺服器傷害時暫時為 true，讓 hurt() 放行 */
  applying: false,
  /** 暫停鍵被按下時的處理（線上對戰時改為詢問是否離開，不會凍結遊戲） */
  onPauseRequest: null,
};
