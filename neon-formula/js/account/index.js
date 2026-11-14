/** 帳號系統組裝：所有頁面共用 repo root 的 Firebase Auth。 */
import { API_BASE } from "./config.js";
import { ApiClient } from "./api-client.js";
import { AccountService } from "./account-service.js";
import {
  getIdentityToken, observeAuth, register, signIn, signOutShared, waitForAuthState,
} from "../../../account/shared-auth.js";
import * as crypto from "./cloud-crypto.js";

export { AccountView } from "./account-view.js";

const auth = {
  signUp: register,
  signIn,
  signOut: signOutShared,
  getIdentityToken,
  observeAuth,
  waitForAuthState,
};
const api = new ApiClient({ baseUrl: API_BASE, getToken: getIdentityToken });
export const accountService = new AccountService({ api, auth, crypto });
