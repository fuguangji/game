/** 個人檔案頁面的一個分頁區塊：持有自己的 DOM，並在顯示／隱藏／移除時收到通知 */
export class ProfileSection {
  #id;
  #title;

  /** @param {{id: string, title: string}} meta */
  constructor({ id, title }) {
    this.#id = id;
    this.#title = title;
  }

  get id() { return this.#id; }
  get title() { return this.#title; }

  /** @returns {HTMLElement} 此區塊的根元素（子類別建構時建立） */
  get element() { throw new Error("子類別必須提供 element"); }

  /** 切換到這個分頁時呼叫（可用來重新整理資料） */
  onShow() {}
  /** 切換離開這個分頁時呼叫 */
  onHide() {}
  /** 頁面被移除時呼叫：釋放事件監聽、計時器與連線 */
  destroy() {}
}
