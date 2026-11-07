import { FIREBASE_CONFIG } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/12.5.0";
let authPromise;

/**
 * Every page on https://fuguangji.github.io must use this default Firebase app.
 * Firebase Auth browser-local persistence is origin-scoped; using one project,
 * one default app name and one persistence mode makes the account state shared
 * by the account center and every game on this GitHub Pages origin.
 */
async function initializeSharedAuth() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase 尚未設定。請檢查 account/firebase-config.js 的 Web App 設定。");
  }

  const [appSdk, authSdk] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);

  const { initializeApp, getApps } = appSdk;
  const { getAuth, setPersistence, browserLocalPersistence } = authSdk;

  const existingDefault = getApps().find((item) => item.name === "[DEFAULT]");
  const app = existingDefault ?? initializeApp(FIREBASE_CONFIG);
  const expected = ["apiKey", "authDomain", "projectId", "appId"];
  const mismatch = expected.find((key) => app.options[key] !== FIREBASE_CONFIG[key]);
  if (mismatch) {
    throw new Error(`Firebase default app 設定不一致（${mismatch}）。所有遊戲必須使用 account/firebase-config.js。`);
  }

  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  return { app, auth, sdk: authSdk };
}

export function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "REPLACE_ME"
    && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.projectId !== "REPLACE_ME"
    && FIREBASE_CONFIG.authDomain && !FIREBASE_CONFIG.authDomain.includes("REPLACE_ME")
    && FIREBASE_CONFIG.appId && !FIREBASE_CONFIG.appId.includes("REPLACE_ME")
  );
}

async function shared() {
  authPromise ??= initializeSharedAuth().catch((error) => {
    authPromise = null;
    throw error;
  });
  return authPromise;
}

export async function getSharedAuth() {
  return (await shared()).auth;
}

/** Subscribe to the one shared Firebase Auth state. Returns an unsubscribe function. */
export async function observeAuth(callback, onError = console.error) {
  const { auth, sdk } = await shared();
  return sdk.onAuthStateChanged(auth, callback, onError);
}

/** Resolve after Firebase has restored browser-local persistence for this origin. */
export async function waitForAuthState() {
  const { auth, sdk } = await shared();
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = sdk.onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, (error) => {
      unsubscribe();
      reject(error);
    });
  });
}

export async function signIn(email, password) {
  const { auth, sdk } = await shared();
  return (await sdk.signInWithEmailAndPassword(auth, email, password)).user;
}

export async function register(email, password, displayName) {
  const { auth, sdk } = await shared();
  const credential = await sdk.createUserWithEmailAndPassword(auth, email, password);
  if (displayName?.trim()) {
    await sdk.updateProfile(credential.user, { displayName: displayName.trim() });
  }
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

/**
 * Keep the Render identity bootstrap: Firebase proves who the browser user is;
 * Render verifies the ID token and initializes/returns the server-side profile.
 */
export async function verifyIdentityWithApi(apiBase = "https://neon-shard-api.onrender.com") {
  const token = await getIdentityToken();
  if (!token) throw new Error("請先登入。");
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/identity/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `Render 身分驗證失敗（HTTP ${response.status}）。`);
  }
  return body;
}
