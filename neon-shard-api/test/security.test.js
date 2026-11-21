import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalJson,
  registrationProofMessage,
  saveSignatureMessage,
  verifyP256Signature,
} from "../src/security.js";

test("canonicalJson sorts object keys recursively", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, b: 2 } }),
    '{"a":{"b":2,"y":true},"z":1}',
  );
});

test("P-256 signature round-trips in browser-compatible IEEE-P1363 format", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = publicKey.export({ format: "jwk" });
  const message = "neon-shard test signature";
  const signature = sign("sha256", Buffer.from(message), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");

  assert.equal(verifyP256Signature(publicJwk, message, signature), true);
  assert.equal(verifyP256Signature(publicJwk, message + "!", signature), false);
  assert.equal(verifyP256Signature(publicJwk, message, "invalid"), false);
});

test("registration and save signing messages bind purpose and ownership context", () => {
  const key = { kty: "EC", crv: "P-256", x: "x", y: "y" };
  const registration = registrationProofMessage("user-1", "key-1", key);
  assert.match(registration, /key-registration:v1/);
  assert.match(registration, /user-1/);

  const message = saveSignatureMessage({
    userId: "user-1",
    method: "PUT",
    path: "/api/player-data",
    body: {
      signedAt: 123,
      keyId: "key-1",
      expectedRevision: 4,
      saveData: { coins: 9 },
      sensitiveEnvelope: { ciphertext: "opaque" },
    },
  });
  assert.match(message, /save-request:v1/);
  assert.match(message, /"expectedRevision":4/);
  assert.match(message, /user-1/);
});
