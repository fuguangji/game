import test from "node:test";
import assert from "node:assert/strict";
import { signupSchema, saveSchema } from "../src/validation.js";

test("signup rejects short passwords and malformed email", () => {
  assert.equal(signupSchema.safeParse({
    email: "not-an-email",
    password: "short",
    displayName: "Pilot",
  }).success, false);
});

test("signup trims valid display names", () => {
  const result = signupSchema.safeParse({
    email: "pilot@example.com",
    password: "long-enough-password",
    displayName: "  Pilot  ",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.displayName, "Pilot");
});

test("save schema requires a P-256 envelope and matching key IDs", () => {
  const valid = {
    saveData: { coins: 3 },
    sensitiveEnvelope: {
      cryptoVersion: 1,
      keyId: "key-1",
      schemaVersion: 1,
      ephemeralPublicKey: {
        kty: "EC", crv: "P-256", x: "eA", y: "eQ",
      },
      iv: "AAAAAAAAAAAAAAAA",
      ciphertext: "Y2lwaGVy",
      tag: "AAAAAAAAAAAAAAAAAAAAAA",
    },
    keyId: "key-1",
    signedAt: Date.now(),
    signature: "c2ln",
  };
  assert.equal(saveSchema.safeParse(valid).success, true);
  assert.equal(saveSchema.safeParse({
    ...valid,
    sensitiveEnvelope: { ...valid.sensitiveEnvelope, keyId: "other" },
  }).success, false);
});
