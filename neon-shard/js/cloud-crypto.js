import { argon2id } from "https://esm.sh/@noble/hashes@1.8.0/argon2";

const encoder = new TextEncoder();
const KDF = Object.freeze({ version: 1, t: 2, m: 19456, p: 1, dkLen: 32 });
const CRYPTO_VERSION = 1;
const SCHEMA_VERSION = 1;

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
}

export function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url value");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function randomId() {
  return crypto.randomUUID();
}

async function derivePasswordKey(password, salt) {
  if (typeof password !== "string" || password.length === 0) throw new Error("請輸入密碼。");
  const derived = argon2id(encoder.encode(password), salt, {
    t: KDF.t,
    m: KDF.m,
    p: KDF.p,
    dkLen: KDF.dkLen,
  });
  return crypto.subtle.importKey("raw", derived, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}

async function encryptBytes(key, plaintext, aad, iv = randomBytes(12)) {
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    plaintext,
  ));
  return { iv, ciphertext: sealed.slice(0, -16), tag: sealed.slice(-16) };
}

async function decryptBytes(key, ciphertext, tag, iv, aad) {
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    combined,
  ));
}

function keyBundleAad(userId) {
  return encoder.encode(canonicalJson({
    purpose: "neon-shard:key-bundle:v1",
    userId,
    kdfVersion: KDF.version,
  }));
}

function saveAad(userId, envelope) {
  return encoder.encode(canonicalJson({
    purpose: "neon-shard:save-envelope:v1",
    userId,
    keyId: envelope.keyId,
    cryptoVersion: envelope.cryptoVersion,
    schemaVersion: envelope.schemaVersion,
    ephemeralPublicKey: envelope.ephemeralPublicKey,
  }));
}

async function deriveSaveKey(sharedSecret, userId, keyId, cryptoVersion, schemaVersion) {
  const salt = await sha256(encoder.encode("neon-shard:hkdf-salt:v1"));
  const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt,
    info: encoder.encode(canonicalJson({
      purpose: "neon-shard:save-key:v1",
      userId,
      keyId,
      cryptoVersion,
      schemaVersion,
    })),
  }, hkdfKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function exportPrivateKey(key) {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey("pkcs8", key)));
}

async function importPrivateKey(pkcs8, algorithm, usages) {
  return crypto.subtle.importKey(
    "pkcs8",
    fromBase64Url(pkcs8),
    algorithm,
    true,
    usages,
  );
}

export async function createAccountKeys(userId, password) {
  const salt = randomBytes(16);
  const wrappingKey = await derivePasswordKey(password, salt);
  const encryptionPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const signingPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const encryptionPublicKey = await crypto.subtle.exportKey("jwk", encryptionPair.publicKey);
  const signingPublicKey = await crypto.subtle.exportKey("jwk", signingPair.publicKey);
  const keyId = randomId();
  const bundle = {
    version: 1,
    encryptionPrivateKeyPkcs8: await exportPrivateKey(encryptionPair.privateKey),
    signingPrivateKeyPkcs8: await exportPrivateKey(signingPair.privateKey),
    encryptionPublicKey,
    signingPublicKey,
  };
  const sealed = await encryptBytes(
    wrappingKey,
    encoder.encode(JSON.stringify(bundle)),
    keyBundleAad(userId),
  );
  const combined = new Uint8Array(sealed.ciphertext.length + sealed.tag.length);
  combined.set(sealed.ciphertext);
  combined.set(sealed.tag, sealed.ciphertext.length);
  const proofMessage = canonicalJson({
    purpose: "neon-shard:key-registration:v1",
    userId,
    keyId,
    encryptionPublicKey,
  });
  const proof = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingPair.privateKey,
    encoder.encode(proofMessage),
  ));
  return {
    keys: {
      encryptionPrivateKey: encryptionPair.privateKey,
      signingPrivateKey: signingPair.privateKey,
      encryptionPublicKey,
      signingPublicKey,
      keyId,
    },
    registration: {
      kdfVersion: KDF.version,
      kdfSalt: toBase64Url(salt),
      keyBundleCiphertext: toBase64Url(combined),
      keyBundleIv: toBase64Url(sealed.iv),
      encryptionPublicKey,
      signingPublicKey,
      keyId,
      proof: toBase64Url(proof),
    },
  };
}

export async function unlockAccountKeys(userId, password, record) {
  if (record.kdfVersion !== KDF.version) {
    throw new Error("此存檔使用不支援的金鑰衍生版本。");
  }
  const salt = fromBase64Url(record.kdfSalt);
  const iv = fromBase64Url(record.keyBundleIv);
  const combined = fromBase64Url(record.keyBundleCiphertext);
  if (salt.length < 16 || iv.length !== 12 || combined.length < 17) {
    throw new Error("加密金鑰封裝資料不完整。");
  }
  const wrappingKey = await derivePasswordKey(password, salt);
  let plaintext;
  try {
    plaintext = await decryptBytes(
      wrappingKey,
      combined.slice(0, -16),
      combined.slice(-16),
      iv,
      keyBundleAad(userId),
    );
  } catch {
    throw new Error("密碼錯誤，或加密金鑰封裝已損毀。");
  }
  const bundle = JSON.parse(new TextDecoder().decode(plaintext));
  if (bundle.version !== 1) throw new Error("不支援的私鑰封裝版本。");
  const encryptionPublicKey = JSON.parse(record.encryptionPublicKey);
  const signingPublicKey = JSON.parse(record.signingPublicKey);
  const encryptionPrivateKey = await importPrivateKey(
    bundle.encryptionPrivateKeyPkcs8,
    { name: "ECDH", namedCurve: "P-256" },
    ["deriveBits"],
  );
  const signingPrivateKey = await importPrivateKey(
    bundle.signingPrivateKeyPkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    ["sign"],
  );
  return {
    encryptionPrivateKey,
    signingPrivateKey,
    encryptionPublicKey,
    signingPublicKey,
    keyId: record.keyId,
  };
}

export async function encryptSave(userId, keys, saveObject) {
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const ephemeralPublicKey = await crypto.subtle.exportKey("jwk", ephemeralPair.publicKey);
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    keys.encryptionPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientPublicKey },
    ephemeralPair.privateKey,
    256,
  ));
  const envelope = {
    cryptoVersion: CRYPTO_VERSION,
    keyId: keys.keyId,
    schemaVersion: SCHEMA_VERSION,
    ephemeralPublicKey,
  };
  const aesKey = await deriveSaveKey(
    sharedSecret,
    userId,
    keys.keyId,
    envelope.cryptoVersion,
    envelope.schemaVersion,
  );
  const sealed = await encryptBytes(
    aesKey,
    encoder.encode(JSON.stringify(saveObject)),
    saveAad(userId, envelope),
  );
  envelope.iv = toBase64Url(sealed.iv);
  envelope.ciphertext = toBase64Url(sealed.ciphertext);
  envelope.tag = toBase64Url(sealed.tag);
  return envelope;
}

export async function decryptSave(userId, keys, envelope) {
  if (envelope.cryptoVersion !== CRYPTO_VERSION || envelope.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("此存檔使用不支援的加密或資料格式版本。");
  }
  if (envelope.keyId !== keys.keyId) throw new Error("存檔的 keyId 與目前帳號金鑰不符。");
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "jwk",
    envelope.ephemeralPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: ephemeralPublicKey },
    keys.encryptionPrivateKey,
    256,
  ));
  const aesKey = await deriveSaveKey(
    sharedSecret,
    userId,
    envelope.keyId,
    envelope.cryptoVersion,
    envelope.schemaVersion,
  );
  let plaintext;
  try {
    plaintext = await decryptBytes(
      aesKey,
      fromBase64Url(envelope.ciphertext),
      fromBase64Url(envelope.tag),
      fromBase64Url(envelope.iv),
      saveAad(userId, envelope),
    );
  } catch {
    throw new Error("存檔完整性驗證失敗，密文可能已遭修改或損毀。");
  }
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function signRegistrationProof(keys, userId) {
  const message = canonicalJson({
    purpose: "neon-shard:key-registration:v1",
    userId,
    keyId: keys.keyId,
    encryptionPublicKey: keys.encryptionPublicKey,
  });
  return toBase64Url(new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.signingPrivateKey,
    encoder.encode(message),
  )));
}

export async function signSaveRequest(keys, { userId, method, path, body }) {
  const message = canonicalJson({
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
  return toBase64Url(new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.signingPrivateKey,
    encoder.encode(message),
  )));
}
