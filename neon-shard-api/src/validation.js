import { z } from "zod";
import { hasUnsupportedDisplayNameChars } from "./display-name.js";

const base64url = z.string().min(1).max(16_384).regex(/^[A-Za-z0-9_-]+$/);
const keyId = z.string().trim().min(1).max(128);
const displayName = z.string().trim().min(1).max(24).refine(
  (value) => !hasUnsupportedDisplayNameChars(value),
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
  const saltBytes = Buffer.from(value.kdfSalt, "base64url");
  const ivBytes = Buffer.from(value.keyBundleIv, "base64url");
  return saltBytes.length >= 16 && ivBytes.length === 12;
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
  }).strict().refine((value) => {
    const ivBytes = Buffer.from(value.iv, "base64url");
    const ciphertextBytes = Buffer.from(value.ciphertext, "base64url");
    const tagBytes = Buffer.from(value.tag, "base64url");
    return ivBytes.length === 12 && ciphertextBytes.length > 0 && tagBytes.length === 16;
  }, "Invalid AES-GCM envelope encoding"),
  keyId,
  signedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  signature: base64url.max(512),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine((value) => value.sensitiveEnvelope.keyId === value.keyId,
  "Envelope keyId must match request keyId");

export const profileUpdateSchema = z.object({
  displayName,
}).strict();
