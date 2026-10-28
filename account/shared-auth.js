import { FIREBASE_CONFIG } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.5.0";
let authPromise;

async function initializeSharedAuth() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase 尚未設定。請先依 dev.md 填入 account/firebase-config.js。");
  }
  const [{ initializeApp, getApps, getApp }, { getAuth, setPersistence, browserLocalPersistence }] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const appName = "novacircuit-shared-account";
  const app = getApps().find((item) => item.name === appName) ?? initializeApp(FIREBASE_CONFIG, appName);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  return { auth, sdk: await import(`${SDK}/firebase-auth.js`) };
}

export function isFirebaseConfigured() {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "REPLACE_ME"
    && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.projectId !== "REPLACE_ME"
    && FIREBASE_CONFIG.authDomain && !FIREBASE_CONFIG.authDomain.includes("REPLACE_ME"));
}

async function shared() {
  authPromise ??= initializeSharedAuth().catch((error) => { authPromise = null; throw error; });
  return authPromise;
}

export async function getSharedAuth() {
  return (await shared()).auth;
}

export async function observeAuth(callback, onError = console.error) {
  const [{ auth }, sdk] = await shared();
  return sdk.onAuthStateChanged(auth, callback, onError);
}

export async function signIn(email, password) {
  const { auth, sdk } = await shared();
  return (await sdk.signInWithEmailAndPassword(auth, email, password)).user;
}

export async function register(email, password, displayName) {
  const { auth, sdk } = await shared();
  const credential = await sdk.createUserWithEmailAndPassword(auth, email, password);
  if (displayName?.trim()) await sdk.updateProfile(credential.user, { displayName: displayName.trim() });
  return credential.user;
}

export async function signOutShared() {
  const { auth, sdk } = await shared();
  await sdk.signOut(auth);
}

export async function resetPassword(email) {
  const { auth, sdk } = await shared();
  await sdk.sendPasswordResetEmail(auth, email);
}

export async function getIdentityToken(forceRefresh = false) {
  const { auth } = await shared();
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken(forceRefresh);
}

export async function verifyIdentityWithApi(apiBase = "https://neon-shard-api.onrender.com") {
  const token = await getIdentityToken();
  if (!token) throw new Error("請先登入。");
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/identity/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "伺服器無法驗證帳號身分。");
  return body;
}
