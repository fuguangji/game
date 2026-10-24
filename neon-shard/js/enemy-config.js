import { enemyCatalog } from "./config/index.js";

export const EL_COL = "#ffb21a";

/** 精英版資料：寫在 config/enemy-catalog.js 各敵人那一列的 elite 欄位，這裡只是依編號整理成查詢表 */
export const ELITE = enemyCatalog.eliteTable();
