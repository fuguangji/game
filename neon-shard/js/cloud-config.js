// Set this before importing main.js after the Render service has been deployed.
// Example: window.NEON_SHARD_API_BASE = "https://your-service.onrender.com";
export const API_BASE = (window.NEON_SHARD_API_BASE || "").replace(/\/$/, "");
