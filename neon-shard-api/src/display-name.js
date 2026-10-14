/**
 * 暱稱規則（純函式，不依賴 zod，方便單獨測試）。
 * 除了控制字元、% 與 _ 之外，也拒絕 < > & " ' ` \ —— 這些字元會在前端被誤當成 HTML／跳脫字元使用。
 * 前端顯示時仍會再跳脫一次（雙重防線），這裡是從源頭擋掉。
 */
const FORBIDDEN = new Set(["%", "_", "<", ">", "&", '"', "'", "`", "\\"]);

export function hasUnsupportedDisplayNameChars(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127 || FORBIDDEN.has(character);
  });
}
