// Firebase web config is public by design;
// protect data with Firebase Security Rules.
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyACYQpAwTDGEydbYgSYn9_5jDTQSo47tXg",
  authDomain: "neon-shard.firebaseapp.com",
  databaseURL: "https://neon-shard-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "neon-shard",
  storageBucket: "neon-shard.firebasestorage.app",
  messagingSenderId: "605979130564",
  appId: "1:605979130564:web:9be90fede8b9fc5985e791",
  measurementId: "G-47RG92NWVX"
});

// STUN server for WebRTC.
export const FIREBASE_ICE_SERVERS = Object.freeze([
  { urls: "stun:stun.l.google.com:19302" },
]);