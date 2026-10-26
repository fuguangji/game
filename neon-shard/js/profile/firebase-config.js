// Firebase web config is public by design; protect data with Realtime Database rules.
// Replace these values in Firebase Console > Project settings > Your apps.
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME-default-rtdb.firebaseio.com",
  projectId: "REPLACE_ME",
  appId: "REPLACE_ME",
});

// STUN helps peers discover a direct route. For reliable cross-network play,
// configure a TURN provider and add short-lived credentials here; never publish
// a TURN provider's permanent API secret in this file.
export const FIREBASE_ICE_SERVERS = Object.freeze([
  { urls: "stun:stun.l.google.com:19302" },
]);
