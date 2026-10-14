import { API_BASE } from "./cloud-config.js";
import {
  createAccountKeys,
  decryptSave,
  encryptSave,
  signSaveRequest,
  unlockAccountKeys,
} from "./cloud-crypto.js";

const SESSION_KEY = "neonShardAuthSession";
const encoder = new TextEncoder();
let session = loadSession();
let activeKeys = null;
let activeProfile = null;
let busy = false;

function loadSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return value?.accessToken && value?.refreshToken ? value : null;
  } catch {
    return null;
  }
}

function storeSession(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

function requireApi() {
  if (!API_BASE) {
    throw new Error("尚未設定 Render API 網址；完成部署後再設定 window.NEON_SHARD_API_BASE。");
  }
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  requireApi();
  const headers = { "Content-Type": "application/json" };
  if (auth && session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  const response = await fetch(API_BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && auth) {
      storeSession(null);
      activeKeys = null;
    }
    throw new Error(result?.error?.message || `API 請求失敗（${response.status}）`);
  }
  return result;
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function field(labelText, type, autocomplete) {
  const wrap = node("label", "ns-field");
  wrap.append(node("span", "", labelText));
  const input = node("input", "ns-input");
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = true;
  if (type === "password") input.maxLength = 256;
  wrap.append(input);
  return { wrap, input };
}

function button(label, onClick, primary = false) {
  const el = node("button", "x-btn" + (primary ? " pri" : ""), label);
  el.type = "button";
  el.addEventListener("click", onClick);
  return el;
}

function status(container, message, isError = false) {
  const el = container.querySelector("[data-ns-status]");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#ff7b88" : "var(--t)";
}

async function withBusy(container, work) {
  if (busy) return;
  busy = true;
  container.querySelectorAll("button").forEach((el) => { el.disabled = true; });
  try {
    await work();
  } catch (error) {
    status(container, error?.message || "操作失敗，請稍後再試。", true);
  } finally {
    busy = false;
    container.querySelectorAll("button").forEach((el) => { el.disabled = false; });
  }
}

function saveSignatureBody(saveData, sensitiveEnvelope, expectedRevision) {
  const body = {
    saveData,
    sensitiveEnvelope,
    keyId: sensitiveEnvelope.keyId,
    signedAt: Date.now(),
  };
  if (expectedRevision !== null) body.expectedRevision = expectedRevision;
  return body;
}

async function registerKeys(userId, password) {
  const created = await createAccountKeys(userId, password);
  await api("/api/keys", { method: "PUT", body: created.registration });
  activeKeys = created.keys;
}

async function unlockOrCreateKeys(userId, password) {
  const record = await api("/api/keys");
  if (record.registered) {
    activeKeys = await unlockAccountKeys(userId, password, record);
  } else {
    await registerKeys(userId, password);
  }
}

async function loadProfile() {
  activeProfile = await api("/api/profile/me");
  if (session && !session.userId) storeSession({ ...session, userId: activeProfile.userId });
  return activeProfile;
}

export function renderCloudAccount(container, { getSave, applySave, setName }) {
  container.replaceChildren();
  const panel = node("section", "ns-account");
  container.append(panel);
  const statusLine = node("p", "x-sub");
  statusLine.dataset.nsStatus = "1";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  const style = node("style");
  style.textContent = ".ns-account{display:grid;gap:12px;max-width:620px}.ns-account h2{margin:0;color:var(--t)}.ns-field{display:grid;gap:6px;color:var(--t);font-size:14px}.ns-input{box-sizing:border-box;width:100%;min-width:0;padding:12px;border:1px solid #ffffff30;border-radius:10px;background:#101923;color:var(--t);font:inherit}.ns-account button:disabled{opacity:.55;cursor:wait}";
  panel.append(style, statusLine);

  if (!session) {
    panel.append(node("h2", "", "雲端帳號"));
    panel.append(node("p", "x-sub", "建立帳號後可在其他裝置登入並同步存檔。私鑰只會以密碼衍生的金鑰加密後上傳。"));
    const email = field("電子郵件", "email", "email");
    const password = field("密碼（至少 8 字元）", "password", "new-password");
    const displayName = field("遊戲暱稱（1–24 字元）", "text", "nickname");
    displayName.input.maxLength = 24;
    panel.append(email.wrap, password.wrap, displayName.wrap);
    panel.append(
      button("建立帳號", () => withBusy(panel, async () => {
        const result = await api("/api/auth/signup", {
          method: "POST", auth: false,
          body: { email: email.input.value.trim(), password: password.input.value, displayName: displayName.input.value.trim() },
        });
        if (!result.session) {
          status(panel, "帳號已建立。請先完成電子郵件驗證，再回到這裡登入。");
          return;
        }
        storeSession({ ...result.session, userId: result.user.id });
        await unlockOrCreateKeys(result.user.id, password.input.value);
        await loadProfile();
        setName(activeProfile.displayName);
        status(panel, "帳號建立完成，金鑰已加密封裝。");
        renderCloudAccount(container, { getSave, applySave, setName });
      }), true),
      button("登入", () => withBusy(panel, async () => {
        const result = await api("/api/auth/login", {
          method: "POST", auth: false,
          body: { email: email.input.value.trim(), password: password.input.value },
        });
        storeSession(result.session);
        await unlockOrCreateKeys(result.user.id, password.input.value);
        await loadProfile();
        setName(activeProfile.displayName);
        status(panel, "登入成功，帳號加密金鑰已解鎖。");
        renderCloudAccount(container, { getSave, applySave, setName });
      })),
    );
    return;
  }

  const accountLine = node("p", "x-sub", activeProfile?.displayName
    ? `已登入：${activeProfile.displayName}`
    : "已保留登入工作階段；請輸入密碼解鎖加密金鑰。");
  panel.append(node("h2", "", "雲端存檔"), accountLine);

  if (!activeKeys) {
    const password = field("登入密碼（只在本裝置記憶體中使用）", "password", "current-password");
    panel.append(password.wrap);
    panel.append(button("解鎖金鑰", () => withBusy(panel, async () => {
      const profile = await loadProfile();
      const record = await api("/api/keys");
      if (!record.registered) {
        throw new Error("帳號尚未完成金鑰設定；請登出後重新登入，或聯絡管理員。");
      }
      activeKeys = await unlockAccountKeys(profile.userId, password.input.value, record);
      setName(profile.displayName);
      status(panel, "金鑰已解鎖；可以同步存檔。");
      renderCloudAccount(container, { getSave, applySave, setName });
    }), true));
  } else {
    panel.append(node("p", "x-sub", "加密金鑰已在目前分頁解鎖。存檔內容使用 ECDH + HKDF-SHA-256 + AES-256-GCM 加密。"));
    panel.append(
      button("上傳目前存檔", () => withBusy(panel, async () => {
        const currentSave = getSave();
        const userId = session.userId;
        if (!userId) throw new Error("登入工作階段缺少使用者識別；請重新登入。");
        const summary = {
          format: "neon-shard-save-v1",
          savedAt: new Date().toISOString(),
          summary: {
            coins: Number(currentSave.coins) || 0,
            shards: Number(currentSave.sh) || 0,
            cores: Number(currentSave.co) || 0,
          },
          payloadType: "encrypted-full-save",
        };
        const sensitiveEnvelope = await encryptSave(userId, activeKeys, currentSave);
        let revision = null;
        try {
          const remote = await api("/api/player-data");
          revision = remote.revision;
        } catch (error) {
          if (!String(error.message).includes("No save exists")) throw error;
        }
        const method = revision === null ? "POST" : "PUT";
        const body = saveSignatureBody(summary, sensitiveEnvelope, revision);
        body.signature = await signSaveRequest(activeKeys, {
          userId, method, path: "/api/player-data", body,
        });
        const result = await api("/api/player-data", { method, body });
        status(panel, `雲端存檔完成（版本 ${result.revision}）。`);
      }), true),
      button("下載並覆蓋本機存檔", () => withBusy(panel, async () => {
        const remote = await api("/api/player-data");
        const restored = await decryptSave(session.userId, activeKeys, remote.sensitiveEnvelope);
        if (!restored || typeof restored !== "object" || Array.isArray(restored)) {
          throw new Error("解密後的存檔格式不正確，已取消覆蓋。");
        }
        applySave(restored);
        status(panel, `已下載雲端存檔（版本 ${remote.revision}），本機存檔已更新。`);
      })),
      button("登出", () => withBusy(panel, async () => {
        try { await api("/api/auth/logout", { method: "POST" }); } finally {
          storeSession(null);
          activeKeys = null;
          activeProfile = null;
          setName("訪客");
          renderCloudAccount(container, { getSave, applySave, setName });
        }
      })),
    );
  }
  panel.append(node("p", "x-hint", "安全提醒：忘記密碼且沒有舊密碼或其他恢復方式時，可能無法解密敏感存檔。不要在共用裝置上保持登入。"));
}
