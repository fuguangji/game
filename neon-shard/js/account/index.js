/** 帳號系統組裝：把設定、Session、API、加密與服務接在一起（整個遊戲共用一份） */
import { API_BASE } from "./config.js";
import { SessionStore } from "./session-store.js";
import { ApiClient } from "./api-client.js";
import { AccountService } from "./account-service.js";
import * as crypto from "./cloud-crypto.js";

export { AccountView } from "./account-view.js";

const sessions = new SessionStore();
export const accountService = new AccountService({
  api: new ApiClient({ baseUrl: API_BASE, sessions }),
  sessions,
  crypto,
});
