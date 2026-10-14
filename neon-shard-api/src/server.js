import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import {
  keyRegistrationSchema,
  loginSchema,
  profileUpdateSchema,
  saveSchema,
  signupSchema,
} from "./validation.js";
import {
  registrationProofMessage,
  saveSignatureMessage,
  verifyP256Signature,
} from "./security.js";

const requiredEnv = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function authClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

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

function parseBody(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_PAYLOAD", "Request payload is invalid.");
  }
  return parsed.data;
}

function bearerToken(req) {
  const header = req.get("authorization") ?? "";
  const match = /^Bearer ([^ ]+)$/i.exec(header);
  if (!match) throw new HttpError(401, "UNAUTHENTICATED", "A valid bearer token is required.");
  return match[1];
}

async function requireUser(req, _res, next) {
  try {
    const token = bearerToken(req);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) {
      throw new HttpError(401, "UNAUTHENTICATED", "A valid bearer token is required.");
    }
    req.user = data.user;
    req.accessToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

async function getProfile(userId) {
  const { data, error } = await admin
    .from("profiles")
    .select("user_id,display_name,kdf_version,kdf_salt,key_bundle_ciphertext,key_bundle_iv,encryption_public_key,signing_public_key,key_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "INTERNAL_ERROR", "The request could not be completed.");
  if (!data) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
  return data;
}

function decodeJwk(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function requireSigningKey(profile, body, req, expectedRevision) {
  if (!profile.signing_public_key || !profile.key_id) {
    throw new HttpError(409, "KEYS_NOT_REGISTERED", "Set up account encryption keys before saving.");
  }
  if (body.keyId !== profile.key_id) {
    throw new HttpError(401, "KEY_ID_MISMATCH", "The signing key is not current.");
  }
  if (Math.abs(Date.now() - body.signedAt) > 5 * 60 * 1000) {
    throw new HttpError(401, "SIGNATURE_EXPIRED", "The signed request has expired.");
  }
  if ((body.expectedRevision ?? null) !== expectedRevision) {
    throw new HttpError(400, "INVALID_PAYLOAD", "The signed revision does not match the request.");
  }
  const message = saveSignatureMessage({
    userId: req.user.id,
    method: req.method,
    path: req.path,
    body,
  });
  if (!verifyP256Signature(decodeJwk(profile.signing_public_key), message, body.signature)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "The request signature is invalid.");
  }
}

function publicProfile(row) {
  return { displayName: row.display_name };
}

function parseEnvelope(text) {
  try { return JSON.parse(text); } catch {
    throw new HttpError(500, "INTERNAL_ERROR", "Stored save data is invalid.");
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "neon-shard-api", time: new Date().toISOString() });
});

app.post("/api/auth/signup", authLimiter, async (req, res, next) => {
  try {
    const input = parseBody(signupSchema, req.body);
    const { data, error } = await authClient().auth.signUp({
      email: input.email,
      password: input.password,
    });
    if (error || !data.user) {
      throw new HttpError(400, "SIGNUP_FAILED", "Unable to create this account. Check the details or try another email.");
    }

    const { error: profileError } = await admin.from("profiles").insert({
      user_id: data.user.id,
      display_name: input.displayName,
    });
    if (profileError) {
      if (profileError.code === "23505") {
        // Do not delete the Auth account automatically; email confirmation or retries may be in flight.
        throw new HttpError(409, "DISPLAY_NAME_TAKEN", "That display name is already in use.");
      }
      throw new HttpError(500, "PROFILE_CREATE_FAILED", "The account was created but profile setup needs support.");
    }
    res.status(201).json({
      user: { id: data.user.id, email: data.user.email },
      session: data.session ? {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      } : null,
      confirmationRequired: !data.session,
    });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const input = parseBody(loginSchema, req.body);
    const { data, error } = await authClient().auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error || !data.session) {
      throw new HttpError(401, "LOGIN_FAILED", "Email or password is incorrect.");
    }
    res.json({
      user: { id: data.user.id, email: data.user.email },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    });
  } catch (error) { next(error); }
});

app.post("/api/auth/refresh", authLimiter, async (req, res, next) => {
  try {
    const refreshToken = req.body?.refreshToken;
    if (typeof refreshToken !== "string" || refreshToken.length < 20 || refreshToken.length > 4096) {
      throw new HttpError(400, "INVALID_PAYLOAD", "Refresh token is invalid.");
    }
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) throw new HttpError(401, "REFRESH_FAILED", "Session could not be refreshed.");
    res.json({
      user: { id: data.user.id, email: data.user.email },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", requireUser, async (req, res, next) => {
  try {
    const { error } = await admin.auth.admin.signOut(req.accessToken);
    if (error) throw new HttpError(400, "LOGOUT_FAILED", "Could not end this session.");
    res.status(204).end();
  } catch (error) { next(error); }
});

/**
 * First-time key registration is bound to an authenticated account and a proof
 * signed by the newly supplied P-256 signing key. Existing keys cannot be
 * silently replaced; a separately designed recovery/rotation flow is required.
 */
app.get("/api/profile/me", requireUser, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user.id);
    res.set("Cache-Control", "no-store");
    res.json({
      userId: req.user.id,
      displayName: profile.display_name,
      keysRegistered: Boolean(profile.signing_public_key && profile.encryption_public_key && profile.key_id),
    });
  } catch (error) { next(error); }
});

app.get("/api/keys", requireUser, async (req, res, next) => {
  try {
    const profile = await getProfile(req.user.id);
    res.set("Cache-Control", "no-store");
    if (!profile.signing_public_key || !profile.encryption_public_key || !profile.key_id) {
      return res.json({ registered: false });
    }
    res.json({
      registered: true,
      kdfVersion: profile.kdf_version,
      kdfSalt: profile.kdf_salt,
      keyBundleCiphertext: profile.key_bundle_ciphertext,
      keyBundleIv: profile.key_bundle_iv,
      encryptionPublicKey: profile.encryption_public_key,
      signingPublicKey: profile.signing_public_key,
      keyId: profile.key_id,
    });
  } catch (error) { next(error); }
});

app.put("/api/keys", requireUser, async (req, res, next) => {
  try {
    const input = parseBody(keyRegistrationSchema, req.body);
    const current = await getProfile(req.user.id);
    const signingJwk = input.signingPublicKey;
    const proofMessage = registrationProofMessage(req.user.id, input.keyId, input.encryptionPublicKey);
    if (!verifyP256Signature(signingJwk, proofMessage, input.proof)) {
      throw new HttpError(401, "INVALID_KEY_PROOF", "Proof of key ownership is invalid.");
    }
    if (current.signing_public_key) {
      throw new HttpError(409, "KEY_ROTATION_REQUIRES_RECOVERY", "Key replacement requires the account recovery flow.");
    }
    const { data: updated, error } = await admin.from("profiles").update({
      kdf_version: input.kdfVersion,
      kdf_salt: input.kdfSalt,
      key_bundle_ciphertext: input.keyBundleCiphertext,
      key_bundle_iv: input.keyBundleIv,
      encryption_public_key: JSON.stringify(input.encryptionPublicKey),
      signing_public_key: JSON.stringify(input.signingPublicKey),
      key_id: input.keyId,
      updated_at: new Date().toISOString(),
    }).eq("user_id", req.user.id).is("signing_public_key", null)
      .select("user_id").maybeSingle();
    if (error) throw new HttpError(500, "KEY_SETUP_FAILED", "Could not save encryption key metadata.");
    if (!updated) throw new HttpError(409, "KEY_ROTATION_REQUIRES_RECOVERY", "Keys were registered by another request; reload the profile.");
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/player-data", requireUser, async (req, res, next) => {
  try {
    const { data, error } = await admin.from("player_data")
      .select("save_data,sensitive_ciphertext,crypto_version,key_id,schema_version,revision,updated_at")
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (error) throw new HttpError(500, "INTERNAL_ERROR", "The request could not be completed.");
    if (!data) throw new HttpError(404, "SAVE_NOT_FOUND", "No save exists for this account.");
    res.json({
      saveData: data.save_data,
      sensitiveEnvelope: parseEnvelope(data.sensitive_ciphertext),
      cryptoVersion: data.crypto_version,
      keyId: data.key_id,
      schemaVersion: data.schema_version,
      revision: data.revision,
      updatedAt: data.updated_at,
    });
  } catch (error) { next(error); }
});

async function writeInitialSave(req, res, next) {
  try {
    const input = parseBody(saveSchema, req.body);
    if (input.expectedRevision !== undefined) {
      throw new HttpError(400, "INVALID_PAYLOAD", "Initial save must not include expectedRevision.");
    }
    const profile = await getProfile(req.user.id);
    requireSigningKey(profile, input, req, null);
    const { data, error } = await admin.from("player_data").insert({
      user_id: req.user.id,
      save_data: input.saveData,
      sensitive_ciphertext: JSON.stringify(input.sensitiveEnvelope),
      crypto_version: input.sensitiveEnvelope.cryptoVersion,
      key_id: input.keyId,
      schema_version: input.sensitiveEnvelope.schemaVersion,
      revision: 1,
      updated_at: new Date().toISOString(),
    }).select("revision,updated_at").single();
    if (error?.code === "23505") throw new HttpError(409, "SAVE_ALREADY_EXISTS", "A save already exists; use PUT to update it.");
    if (error) throw new HttpError(422, "SAVE_REJECTED", "The save could not be stored.");
    res.status(201).json({ revision: data.revision, updatedAt: data.updated_at });
  } catch (error) { next(error); }
}

async function updateSave(req, res, next) {
  try {
    const input = parseBody(saveSchema, req.body);
    if (!Number.isInteger(input.expectedRevision)) {
      throw new HttpError(400, "REVISION_REQUIRED", "expectedRevision is required for updates.");
    }
    const profile = await getProfile(req.user.id);
    requireSigningKey(profile, input, req, input.expectedRevision);
    const { data, error } = await admin.from("player_data").update({
      save_data: input.saveData,
      sensitive_ciphertext: JSON.stringify(input.sensitiveEnvelope),
      crypto_version: input.sensitiveEnvelope.cryptoVersion,
      key_id: input.keyId,
      schema_version: input.sensitiveEnvelope.schemaVersion,
      revision: input.expectedRevision + 1,
      updated_at: new Date().toISOString(),
    }).eq("user_id", req.user.id).eq("revision", input.expectedRevision)
      .select("revision,updated_at").maybeSingle();
    if (error) throw new HttpError(422, "SAVE_REJECTED", "The save could not be stored.");
    if (!data) {
      const { data: exists, error: readError } = await admin.from("player_data")
        .select("user_id").eq("user_id", req.user.id).maybeSingle();
      if (readError) throw new HttpError(500, "INTERNAL_ERROR", "The request could not be completed.");
      if (!exists) throw new HttpError(404, "SAVE_NOT_FOUND", "No save exists for this account.");
      throw new HttpError(409, "REVISION_CONFLICT", "The save changed elsewhere. Reload before saving again.");
    }
    res.json({ revision: data.revision, updatedAt: data.updated_at });
  } catch (error) { next(error); }
}

app.post("/api/player-data", requireUser, writeInitialSave);
app.put("/api/player-data", requireUser, updateSave);

app.get("/api/profiles/:displayName", async (req, res, next) => {
  try {
    const name = req.params.displayName.trim();
    const hasUnsupportedChars = [...name].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === "%" || character === "_";
    });
    if (!name || name.length > 24 || hasUnsupportedChars) {
      throw new HttpError(400, "INVALID_DISPLAY_NAME", "Display name is invalid.");
    }
    const { data, error } = await admin.from("profiles")
      .select("display_name")
      .ilike("display_name", name)
      .maybeSingle();
    if (error) throw new HttpError(500, "INTERNAL_ERROR", "The request could not be completed.");
    if (!data) throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile not found.");
    res.json(publicProfile(data));
  } catch (error) { next(error); }
});

app.put("/api/profile", requireUser, async (req, res, next) => {
  try {
    const input = parseBody(profileUpdateSchema, req.body);
    const { data, error } = await admin.from("profiles").update({
      display_name: input.displayName,
      updated_at: new Date().toISOString(),
    }).eq("user_id", req.user.id).select("display_name").single();
    if (error?.code === "23505") throw new HttpError(409, "DISPLAY_NAME_TAKEN", "That display name is already in use.");
    if (error || !data) throw new HttpError(500, "PROFILE_UPDATE_FAILED", "Could not update the profile.");
    res.json(publicProfile(data));
  } catch (error) { next(error); }
});

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } });
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds 64 KiB." } });
  }
  if (error?.message === "Origin not allowed") {
    return res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed." } });
  }
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
  const message = status >= 500 && !error?.message?.startsWith("The account was created")
    ? "The request could not be completed."
    : error.message;
  if (status >= 500) console.error("[api-error]", code);
  res.status(status).json({ error: { code, message } });
});

const port = Number(process.env.PORT ?? 10000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Neon-shard API listening on port ${port}`);
});
