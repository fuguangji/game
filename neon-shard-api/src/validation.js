import { z } from "zod";

const base64url = z.string().min(1).max(16_384).regex(/^[A-Za-z0-9_-]+$/);
const keyId = z.string().trim().min(1).max(128);
const displayName = z.string().trim().min(1).max(24).refine(
  (value) => !/[\\u0000-\\u001f\\u007f%_]/u.test(value),
  "Display name contains unsupported characters",
);

export const signupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(256),
  displayName,
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
}).strict();

const publicJwk = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: base64url,
  y: base64url,
}).strict();

export const keyRegistrationSchema = z.object({
  kdfVersion: z.number().int().positive(),
  kdfSalt: base64url.max(128),
  keyBundleCiphertext: base64url.max(8192),
  keyBundleIv: base64url.max(64),
  encryptionPublicKey: publicJwk,
  signingPublicKey: publicJwk,
  keyId,
  proof: base64url.max(512),
}).strict().refine((value) => {
  try {
    return Buffer.from(value.kdfSalt, "base64url").length >= 16
      && Buffer.from(value.keyBundleIv, "base64url").length >= 12;
  } catch {
    return false;
  }
}, "Invalid KDF salt or IV");

export const saveSchema = z.object({
  saveData: z.record(z.string(), z.unknown()),
  sensitiveEnvelope: z.object({
    cryptoVersion: z.number().int().positive(),
    keyId,
    schemaVersion: z.number().int().positive(),
    ephemeralPublicKey: publicJwk,
    iv: base64url.max(64),
    ciphertext: base64url.max(65_536),
    tag: base64url.max(64),
  }).strict(),
  keyId,
  signedAt: z.number().int().positive(),
  signature: base64url.max(512),
  expectedRevision: z.number().int().positive().optional(),
}).strict().refine((value) => value.sensitiveEnvelope.keyId === value.keyId,
  "Envelope keyId must match request keyId");

export const profileUpdateSchema = z.object({
  displayName,
}).strict();
