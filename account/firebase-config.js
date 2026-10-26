// Firebase Web App 設定（可公開）。真正的權限由 Firebase Auth 與資料庫規則控制。
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME-default-rtdb.firebaseio.com",
  projectId: "REPLACE_ME",
  appId: "REPLACE_ME",
});

// WebRTC 預設 STUN；需要跨 NAT 穩定連線時，請按 dev.md 配置短期 TURN 憑證。
export const FIREBASE_ICE_SERVERS = Object.freeze([
  { urls: "stun:stun.l.google.com:19302" },
]);
