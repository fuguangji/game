import { hasUnsupportedDisplayNameChars } from "./display-name.js";

export function createAccountStore(db) {
  const userRef = (uid) => db.collection("users").doc(uid);
  const saveRef = (uid) => userRef(uid).collection("gameData").doc("currentSave");
  const nameRef = (name) => db.collection("displayNames").doc(name.trim().toLocaleLowerCase("en-US"));

  function asProfile(uid, data) {
    return {
      user_id: uid,
      display_name: data.displayName,
      kdf_version: data.kdfVersion ?? null,
      kdf_salt: data.kdfSalt ?? null,
      key_bundle_ciphertext: data.keyBundleCiphertext ?? null,
      key_bundle_iv: data.keyBundleIv ?? null,
      encryption_public_key: data.encryptionPublicKey ?? null,
      signing_public_key: data.signingPublicKey ?? null,
      key_id: data.keyId ?? null,
    };
  }

  return {
    async ping() {
      // A read-only query proves Firestore connectivity without charging a write
      // on every Render readiness probe.
      await db.collection("_health").limit(1).get();
      return true;
    },

    async ensureIdentity(decoded) {
      const ref = userRef(decoded.uid);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const old = snap.data();
          const updated = {
            ...old,
            email: decoded.email ?? old.email ?? null,
            emailVerified: Boolean(decoded.email_verified),
            updatedAt: new Date().toISOString(),
          };
          tx.set(ref, updated, { merge: true });
          return { uid: decoded.uid, email: updated.email, emailVerified: updated.emailVerified, displayName: old.displayName };
        }

        const requestedName = (decoded.name || decoded.email?.split("@")[0] || "").trim().replace(/\s+/g, " ").slice(0, 24);
        const base = requestedName && !hasUnsupportedDisplayNameChars(requestedName)
          ? requestedName
          : `Player-${decoded.uid.slice(0, 8)}`;
        const candidates = [
          base,
          `Player-${decoded.uid.slice(0, 8)}`,
          `P-${decoded.uid.slice(0, 12)}`,
          `P-${decoded.uid.slice(-20)}`,
        ];
        let displayName = null;
        let nameDoc = null;
        for (const candidate of [...new Set(candidates)]) {
          const candidateRef = nameRef(candidate);
          const candidateSnap = await tx.get(candidateRef);
          if (!candidateSnap.exists || candidateSnap.data().uid === decoded.uid) {
            displayName = candidate;
            nameDoc = candidateRef;
            break;
          }
        }
        if (!displayName || !nameDoc) {
          throw Object.assign(new Error("Could not reserve a unique display name."), { code: "DISPLAY_NAME_TAKEN" });
        }
        const now = new Date().toISOString();
        tx.set(ref, {
          uid: decoded.uid,
          email: decoded.email ?? null,
          emailVerified: Boolean(decoded.email_verified),
          displayName,
          createdAt: now,
          updatedAt: now,
          kdfVersion: null, kdfSalt: null, keyBundleCiphertext: null, keyBundleIv: null,
          encryptionPublicKey: null, signingPublicKey: null, keyId: null,
        });
        tx.set(nameDoc, { uid: decoded.uid, displayName });
        return { uid: decoded.uid, email: decoded.email ?? null, emailVerified: Boolean(decoded.email_verified), displayName };
      });
    },

    async getProfile(uid) {
      const snap = await userRef(uid).get();
      if (!snap.exists) return null;
      return asProfile(uid, snap.data());
    },

    async registerKeys(uid, input) {
      return db.runTransaction(async (tx) => {
        const ref = userRef(uid);
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("Profile not found."), { code: "PROFILE_NOT_FOUND" });
        if (snap.data().signingPublicKey) throw Object.assign(new Error("Key replacement requires recovery."), { code: "KEY_ROTATION_REQUIRES_RECOVERY" });
        tx.update(ref, {
          kdfVersion: input.kdfVersion,
          kdfSalt: input.kdfSalt,
          keyBundleCiphertext: input.keyBundleCiphertext,
          keyBundleIv: input.keyBundleIv,
          encryptionPublicKey: JSON.stringify(input.encryptionPublicKey),
          signingPublicKey: JSON.stringify(input.signingPublicKey),
          keyId: input.keyId,
          updatedAt: new Date().toISOString(),
        });
        return true;
      });
    },

    async getSave(uid) {
      const snap = await saveRef(uid).get();
      return snap.exists ? snap.data() : null;
    },

    async createSave(uid, input) {
      return db.runTransaction(async (tx) => {
        const ref = saveRef(uid);
        const snap = await tx.get(ref);
        if (snap.exists) throw Object.assign(new Error("A save already exists."), { code: "SAVE_ALREADY_EXISTS" });
        const updatedAt = new Date().toISOString();
        tx.create(ref, {
          saveData: input.saveData,
          sensitiveCiphertext: JSON.stringify(input.sensitiveEnvelope),
          cryptoVersion: input.sensitiveEnvelope.cryptoVersion,
          keyId: input.keyId,
          schemaVersion: input.sensitiveEnvelope.schemaVersion,
          revision: 1,
          updatedAt,
        });
        return { revision: 1, updatedAt };
      });
    },

    async updateSave(uid, input) {
      return db.runTransaction(async (tx) => {
        const ref = saveRef(uid);
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("No save exists for this account."), { code: "SAVE_NOT_FOUND" });
        const old = snap.data();
        if (old.revision !== input.expectedRevision) throw Object.assign(new Error("The save changed elsewhere."), { code: "REVISION_CONFLICT" });
        const updatedAt = new Date().toISOString();
        const revision = old.revision + 1;
        tx.update(ref, {
          saveData: input.saveData,
          sensitiveCiphertext: JSON.stringify(input.sensitiveEnvelope),
          cryptoVersion: input.sensitiveEnvelope.cryptoVersion,
          keyId: input.keyId,
          schemaVersion: input.sensitiveEnvelope.schemaVersion,
          revision,
          updatedAt,
        });
        return { revision, updatedAt };
      });
    },

    async findProfileByName(displayName) {
      const nameSnap = await nameRef(displayName).get();
      if (!nameSnap.exists) return null;
      const userSnap = await userRef(nameSnap.data().uid).get();
      if (!userSnap.exists) return null;
      return { display_name: userSnap.data().displayName };
    },

    async updateDisplayName(uid, displayName) {
      return db.runTransaction(async (tx) => {
        const ref = userRef(uid);
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("Profile not found."), { code: "PROFILE_NOT_FOUND" });
        const oldName = snap.data().displayName;
        const oldRef = nameRef(oldName);
        const newRef = nameRef(displayName);
        const newSnap = await tx.get(newRef);
        if (newSnap.exists && newSnap.data().uid !== uid) throw Object.assign(new Error("That display name is already in use."), { code: "DISPLAY_NAME_TAKEN" });
        const now = new Date().toISOString();
        if (oldName?.toLocaleLowerCase("en-US") !== displayName.toLocaleLowerCase("en-US")) tx.delete(oldRef);
        tx.set(newRef, { uid, displayName });
        tx.update(ref, { displayName, updatedAt: now });
        return { display_name: displayName };
      });
    },
  };
}

