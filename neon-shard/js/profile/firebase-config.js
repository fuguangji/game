// Firebase web config is public by design; protect data with Realtime Database rules.
// Replace these values in Firebase Console > Project settings > Your apps.
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyACYQpAwTDGEydbYgSYn9_5jDTQSo47tXg",
  authDomain: "neon-shard.firebaseapp.com",
  projectId: "neon-shard",
  storageBucket: "neon-shard.firebasestorage.app",
  messagingSenderId: "605979130564",
  appId: "1:605979130564:web:9be90fede8b9fc5985e791",
  measurementId: "G-47RG92NWVX"
};);

// STUN helps peers discover a direct route. For reliable cross-network play,
// configure a TURN provider and add short-lived credentials here; never publish
// a TURN provider's permanent API secret in this file.
export const FIREBASE_ICE_SERVERS = Object.freeze([
  { urls: "stun:stun.l.google.com:19302" },
]);
