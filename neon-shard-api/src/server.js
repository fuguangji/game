import { createServer } from "node:http";
import express from "express";
import { attachRealtime } from "./realtime.js";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createAccountStore } from "./firebase-store.js";
import {
  keyRegistrationSchema,
  profileUpdateSchema,
  saveSchema,
} from "./validation.js";
import {
  registrationProofMessage,
  saveSignatureMessage,
  verifyP256Signature,
} from "./security.js";

let firebaseAuth = null;
let store = null;
let firebaseConfigError = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    const appName = "novacircuit-shared-account-admin";
    const firebaseApp = getApps().find((item) => item.name === appName)
      ?? initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }, appName);
    firebaseAuth = getAuth(firebaseApp);
    store = createAccountStore(getFirestore(firebaseApp));
  } catch (error) {
    firebaseConfigError = error;
    console.error("[firebase-config] Admin SDK initialization failed; Firebase endpoints are disabled.");
  }
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  maxAge: 600,
}));
app.use(express.json({ limit: "64kb", strict: true }));

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireFirebase() {
  if (!firebaseAuth || !store) {
    throw new HttpError(503, "FIREBASE_ADMIN_NOT_CONFIGURED",
      firebaseConfigError ? "Firebase Admin SDK configuration is invalid." : "Firebase Admin SDK is not configured yet.");
  }
}

function parseBody(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "INVALID_PAYLOAD", "Request payload is invalid.");
  return parsed.data;
}

function bearerToken(req) {
  const match = /^Bearer ([^ ]+)$/i.exec(req.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "UNAUTHENTICATED", "A valid Firebase ID token is required.");
  return match[1];
}

async function requireUser(req, _res, next) {
  try {
    requireFirebase();
    const decoded = await firebaseAuth.verifyIdToken(bearerToken(req), true);
    if (!decoded?.uid) throw new HttpError(401, "UNAUTHENTICATED", "A valid Firebase ID token is required.");
    req.user = { uid: decoded.uid, email: decoded.email ?? null, decoded };
    next();
  } catch (error) {
    if (error?.code?.startsWith?.("auth/")) return next(new HttpError(401, "UNAUTHENTICATED", "Firebase ID token is invalid or expired."));
    next(error);
  }
}

function decodeJwk(value) {
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
}

function requireSigningKey(profile, body, req, expectedRevision) {
  if (!profile.signing_public_key || !profile.key_id) {
    throw new HttpError(409, "KEYS_NOT_REGISTERED", "Set up account encryption keys before saving.");
  }
  if (body.keyId !== profile.key_id) throw new HttpError(401, "KEY_ID_MISMATCH", "The signing key is not current.");
  if (Math.abs(Date.now() - body.signedAt) > 5 * 60 * 1000) throw new HttpError(401, "SIGNATURE_EXPIRED", "The signed request has expired.");
  if ((body.expectedRevision ?? null) !== expectedRevision) {
    throw new HttpError(400, "INVALID_PAYLOAD", "The signed revision does not match the request.");
  }
  const message = saveSignatureMessage({ userId: req.user.uid, method: req.method, path: req.path, body });
  if (!verifyP256Signature(decodeJwk(profile.signing_public_key), message, body.signature)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "The request signature is invalid.");
  }
}

function publicProfile(row) {
  return { displayName: row.display_name };
}

function parseEnvelope(text) {
  try { return typeof text === "string" ? JSON.parse(text) : text; } catch {
    throw new HttpError(500, "INTERNAL_ERROR", "Stored save data is invalid.");
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "neon-shard-api", time: new Date().toISOString() });
});

app.get("/api/ready", async (_req, res) => {
  try {
    requireFirebase();
    await store.ping();
    return res.json({ status: "ready", service: "neon-shard-api", storage: "firebase-firestore", time: new Date().toISOString() });
  } catch {
    return res.status(503).json({ status: "not_ready", service: "neon-shard-api", storage: "firebase-firestore" });
  }
});

app.get("/api/identity/me", async (req, res, next) => {
  try {
    requireFirebase();
    const decoded = await firebaseAuth.verifyIdToken(bearerToken(req), true);
    if (!decoded?.uid) throw new HttpError(401, "UNAUTHENTICATED", "A valid Firebase ID token is required.");
    const identity = await store.ensureIdentity(decoded);
    res.set("Cache-Control", "no-store");
    res.json(identity);
  } catch (error) {
    if (error instanceof HttpError) return next(error);
    if (error?.code?.startsWith?.("auth/")) return next(new HttpError(401, "UNAUTHENTICATED", "Firebase ID token is invalid or expired."));
    next(error);
  }
});

// Registration, login, password reset and session persistence belong to Firebase Auth on /account.
// The API deliberately never receives account passwords.
app.post("/api/auth/signup", authLimiter, (_req, _res, next) => next(new HttpError(410, "USE_FIREBASE_AUTH", "Please create your account at /account/ using Firebase Authentication.")));
app.post("/api/auth/login", authLimiter, (_req, _res, next) => next(new HttpError(410, "USE_FIREBASE_AUTH", "Please sign in at /account/ using Firebase Authentication.")));
app.post("/api/auth/refresh", authLimiter, (_req, _res, next) => next(new HttpError(410, "USE_FIREBASE_AUTH", "Firebase automatically refreshes ID tokens in the browser.")));

app.post("/api/auth/logout", requireUser, (_req, res) => res.status(204).end());

app.get("/api/profile/me", requireUser, async (req, res, next) => {
  try {
    const profile = await store.getProfile(req.user.uid);
    if (!profile) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    res.set("Cache-Control", "no-store");
    res.json({
      userId: req.user.uid,
      displayName: profile.display_name,
      keysRegistered: Boolean(profile.signing_public_key && profile.encryption_public_key && profile.key_id),
    });
  } catch (error) { next(mapStoreError(error)); }
});

app.get("/api/keys", requireUser, async (req, res, next) => {
  try {
    const profile = await store.getProfile(req.user.uid);
    if (!profile) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    res.set("Cache-Control", "no-store");
    if (!profile.signing_public_key || !profile.encryption_public_key || !profile.key_id) return res.json({ registered: false });
    res.json({
      registered: true,
      kdfVersion: profile.kdf_version,
      kdfSalt: profile.kdf_salt,
      keyBundleCiphertext: profile.key_bundle_ciphertext,
      keyBundleIv: profile.key_bundle_iv,
      encryptionPublicKey: decodeJwk(profile.encryption_public_key),
      signingPublicKey: decodeJwk(profile.signing_public_key),
      keyId: profile.key_id,
    });
  } catch (error) { next(mapStoreError(error)); }
});

app.put("/api/keys", requireUser, async (req, res, next) => {
  try {
    const input = parseBody(keyRegistrationSchema, req.body);
    const current = await store.getProfile(req.user.uid);
    if (!current) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    const proofMessage = registrationProofMessage(req.user.uid, input.keyId, input.encryptionPublicKey);
    if (!verifyP256Signature(input.signingPublicKey, proofMessage, input.proof)) {
      throw new HttpError(401, "INVALID_KEY_PROOF", "Proof of key ownership is invalid.");
    }
    if (current.signing_public_key) throw new HttpError(409, "KEY_ROTATION_REQUIRES_RECOVERY", "Key replacement requires the account recovery flow.");
    await store.registerKeys(req.user.uid, input);
    res.status(204).end();
  } catch (error) { next(mapStoreError(error)); }
});

app.get("/api/player-data", requireUser, async (req, res, next) => {
  try {
    const data = await store.getSave(req.user.uid);
    if (!data) throw new HttpError(404, "SAVE_NOT_FOUND", "No save exists for this account.");
    res.json({
      saveData: data.saveData,
      sensitiveEnvelope: parseEnvelope(data.sensitiveCiphertext),
      cryptoVersion: data.cryptoVersion,
      keyId: data.keyId,
      schemaVersion: data.schemaVersion,
      revision: data.revision,
      updatedAt: data.updatedAt,
    });
  } catch (error) { next(mapStoreError(error)); }
});

async function writeInitialSave(req, res, next) {
  try {
    const input = parseBody(saveSchema, req.body);
    if (input.expectedRevision !== undefined) throw new HttpError(400, "INVALID_PAYLOAD", "Initial save must not include expectedRevision.");
    const profile = await store.getProfile(req.user.uid);
    if (!profile) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    requireSigningKey(profile, input, req, null);
    const result = await store.createSave(req.user.uid, input);
    res.status(201).json(result);
  } catch (error) { next(mapStoreError(error)); }
}

async function updateSave(req, res, next) {
  try {
    const input = parseBody(saveSchema, req.body);
    if (!Number.isInteger(input.expectedRevision)) throw new HttpError(400, "REVISION_REQUIRED", "expectedRevision is required for updates.");
    const profile = await store.getProfile(req.user.uid);
    if (!profile) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    requireSigningKey(profile, input, req, input.expectedRevision);
    const result = await store.updateSave(req.user.uid, input);
    res.json(result);
  } catch (error) { next(mapStoreError(error)); }
}

app.post("/api/player-data", requireUser, writeInitialSave);
app.put("/api/player-data", requireUser, updateSave);

app.get("/api/profiles/:displayName", async (req, res, next) => {
  try {
    requireFirebase();
    const name = req.params.displayName.trim();
    if (!name || name.length > 24) throw new HttpError(400, "INVALID_DISPLAY_NAME", "Display name is invalid.");
    const data = await store.findProfileByName(name);
    if (!data) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    res.json(publicProfile(data));
  } catch (error) { next(mapStoreError(error)); }
});

app.put("/api/profile", requireUser, async (req, res, next) => {
  try {
    const input = parseBody(profileUpdateSchema, req.body);
    const data = await store.updateDisplayName(req.user.uid, input.displayName);
    res.json(publicProfile(data));
  } catch (error) { next(mapStoreError(error)); }
});

function mapStoreError(error) {
  if (error instanceof HttpError) return error;
  if (error?.code === "PROFILE_NOT_FOUND") return new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
  if (error?.code === "SAVE_NOT_FOUND") return new HttpError(404, "SAVE_NOT_FOUND", "No save exists for this account.");
  if (error?.code === "SAVE_ALREADY_EXISTS") return new HttpError(409, "SAVE_ALREADY_EXISTS", "A save already exists; use PUT to update it.");
  if (error?.code === "REVISION_CONFLICT") return new HttpError(409, "REVISION_CONFLICT", "The save changed elsewhere. Reload before saving again.");
  if (error?.code === "DISPLAY_NAME_TAKEN") return new HttpError(409, "DISPLAY_NAME_TAKEN", "That display name is already in use.");
  if (error?.code === "KEY_ROTATION_REQUIRES_RECOVERY") return new HttpError(409, "KEY_ROTATION_REQUIRES_RECOVERY", "Key replacement requires the account recovery flow.");
  if (error?.code?.startsWith?.("auth/")) return new HttpError(401, "UNAUTHENTICATED", "Firebase ID token is invalid or expired.");
  return error;
}

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } });
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error?.type === "entity.too.large") return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 64 KiB." } });
  if (error?.message === "Origin not allowed") return res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed." } });
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
  const message = status >= 500 ? "The request could not be completed." : error.message;
  if (status >= 500) console.error("[api-error]", code);
  res.status(status).json({ error: { code, message } });
});

const port = Number(process.env.PORT ?? 10000);
const httpServer = createServer(app);
attachRealtime(httpServer, { firebaseAuth, store, allowedOrigins });
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Neon-shard API listening on port ${port}`);
});
