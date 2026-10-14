import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
}

function importP256PublicKey(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("Invalid P-256 public key");
  }
  return createPublicKey({ key: jwk, format: "jwk" });
}

/**
 * Browser WebCrypto ECDSA P-256 signatures use IEEE-P1363 r||s encoding.
 * This verifies signatures only; it does not decrypt the save or prove gameplay fairness.
 */
export function verifyP256Signature(publicJwk, message, signatureBase64Url) {
  try {
    const key = importP256PublicKey(publicJwk);
    const signature = Buffer.from(signatureBase64Url, "base64url");
    if (signature.length !== 64) return false;
    return cryptoVerify(
      "sha256",
      Buffer.from(message, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}

export function registrationProofMessage(userId, keyId, encryptionPublicKey) {
  return canonicalJson({
    purpose: "neon-shard:key-registration:v1",
    userId,
    keyId,
    encryptionPublicKey,
  });
}

export function saveSignatureMessage({ userId, method, path, body }) {
  return canonicalJson({
    purpose: "neon-shard:save-request:v1",
    userId,
    method,
    path,
    signedAt: body.signedAt,
    keyId: body.keyId,
    expectedRevision: body.expectedRevision ?? null,
    saveData: body.saveData,
    sensitiveEnvelope: body.sensitiveEnvelope,
  });
}
