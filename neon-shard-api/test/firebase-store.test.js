import test from "node:test";
import assert from "node:assert/strict";
import { createAccountStore } from "../src/firebase-store.js";

class FakeSnapshot {
  constructor(ref, data) { this.ref = ref; this._data = data; this.exists = data !== undefined; }
  data() { return this._data === undefined ? undefined : structuredClone(this._data); }
}

class FakeRef {
  constructor(db, path) { this.db = db; this.path = path; }
  async get() { return new FakeSnapshot(this, this.db.docs.get(this.path)); }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
}

class FakeCollection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new FakeRef(this.db, `${this.path}/${id}`); }
  limit(count) { return { get: async () => ({ docs: [...this.db.docs.entries()]
    .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes("/"))
    .slice(0, count).map(([path, data]) => new FakeSnapshot(new FakeRef(this.db, path), data)) }) }; }
}

class FakeFirestore {
  docs = new Map();
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(callback) {
    const tx = {
      get: async (ref) => new FakeSnapshot(ref, this.docs.get(ref.path)),
      set: (ref, data, options = {}) => {
        const old = this.docs.get(ref.path);
        this.docs.set(ref.path, options.merge && old ? { ...old, ...structuredClone(data) } : structuredClone(data));
      },
      update: (ref, data) => {
        const old = this.docs.get(ref.path);
        if (!old) throw Object.assign(new Error("document missing"), { code: "not-found" });
        this.docs.set(ref.path, { ...old, ...structuredClone(data) });
      },
      create: (ref, data) => {
        if (this.docs.has(ref.path)) throw Object.assign(new Error("document exists"), { code: "already-exists" });
        this.docs.set(ref.path, structuredClone(data));
      },
      delete: (ref) => this.docs.delete(ref.path),
    };
    return callback(tx);
  }
}

const keyInput = {
  kdfVersion: 1,
  kdfSalt: "c2FsdA",
  keyBundleCiphertext: "Y2lwaGVy",
  keyBundleIv: "aXY",
  encryptionPublicKey: { kty: "EC", crv: "P-256", x: "eA", y: "eQ" },
  signingPublicKey: { kty: "EC", crv: "P-256", x: "eA", y: "eQ" },
  keyId: "key-one",
};

test("Firebase UID is the account document key and profiles are isolated", async () => {
  const db = new FakeFirestore();
  const store = createAccountStore(db);
  const first = await store.ensureIdentity({ uid: "uid-a", email: "a@example.com", email_verified: true, name: "Pilot" });
  const second = await store.ensureIdentity({ uid: "uid-b", email: "b@example.com", email_verified: true, name: "Pilot" });

  assert.equal(first.uid, "uid-a");
  assert.equal(second.uid, "uid-b");
  assert.notEqual(first.displayName.toLowerCase(), second.displayName.toLowerCase());
  assert.equal((await store.getProfile("uid-a")).user_id, "uid-a");
  assert.equal(await store.getProfile("uid-missing"), null);
});

test("Firestore key metadata and encrypted save use optimistic revisions", async () => {
  const store = createAccountStore(new FakeFirestore());
  await store.ensureIdentity({ uid: "uid-save", email: "save@example.com", email_verified: true });
  await store.registerKeys("uid-save", keyInput);
  const profile = await store.getProfile("uid-save");
  assert.equal(profile.key_id, "key-one");
  assert.equal(typeof profile.signing_public_key, "string");

  const input = {
    saveData: { coins: 12 },
    sensitiveEnvelope: { cryptoVersion: 1, schemaVersion: 1, keyId: "key-one", ciphertext: "opaque" },
    keyId: "key-one",
  };
  const created = await store.createSave("uid-save", input);
  assert.equal(created.revision, 1);
  const saved = await store.getSave("uid-save");
  assert.deepEqual(saved.saveData, { coins: 12 });
  assert.equal(JSON.parse(saved.sensitiveCiphertext).ciphertext, "opaque");

  const updated = await store.updateSave("uid-save", { ...input, expectedRevision: 1, saveData: { coins: 20 } });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    store.updateSave("uid-save", { ...input, expectedRevision: 1 }),
    (error) => error.code === "REVISION_CONFLICT",
  );
  await assert.rejects(store.createSave("uid-save", input), (error) => error.code === "SAVE_ALREADY_EXISTS");
});

test("display names are reserved case-insensitively and can be changed", async () => {
  const store = createAccountStore(new FakeFirestore());
  await store.ensureIdentity({ uid: "uid-name-a", email: "a@example.com", email_verified: true, name: "Nova" });
  await store.ensureIdentity({ uid: "uid-name-b", email: "b@example.com", email_verified: true, name: "Nova" });
  await assert.rejects(store.updateDisplayName("uid-name-b", "nova"), (error) => error.code === "DISPLAY_NAME_TAKEN");
  const changed = await store.updateDisplayName("uid-name-b", "Orbit");
  assert.equal(changed.display_name, "Orbit");
  assert.equal(await store.findProfileByName("Nova") !== null, true);
  assert.equal(await store.findProfileByName("Orbit") !== null, true);
});
