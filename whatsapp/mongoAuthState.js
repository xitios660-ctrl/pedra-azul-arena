/**
 * Persist Baileys auth state in MongoDB so Render restarts restore the session.
 * Never expose these docs to the frontend.
 * Cycle 18: detect registered session before QR; reload creds on each start.
 */
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

const COLLECTION = "whatsapp_auth";
const SESSION_ID = process.env.WHATSAPP_SESSION_ID || "default";

function keyId(type, id) {
  return `${SESSION_ID}:${type}:${id}`;
}

/**
 * True when Mongo/Baileys creds look like a paired session (restore, don't spam QR).
 * @param {any} creds
 */
export function isRegisteredCreds(creds) {
  if (!creds || typeof creds !== "object") return false;
  if (creds.registered === true) return true;
  const meId = creds.me?.id || creds.me?.lid;
  return Boolean(meId);
}

/**
 * @param {import('mongodb').Db} db
 */
export async function useMongoAuthState(db) {
  const col = db.collection(COLLECTION);
  await col.createIndex({ key: 1 }, { unique: true });

  const read = async (key) => {
    const doc = await col.findOne({ key });
    if (!doc?.value) return null;
    return JSON.parse(JSON.stringify(doc.value), BufferJSON.reviver);
  };

  const write = async (key, value) => {
    const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
    await col.updateOne(
      { key },
      { $set: { key, value: serialized, updated_at: new Date() } },
      { upsert: true }
    );
  };

  const remove = async (key) => {
    await col.deleteOne({ key });
  };

  const credsKey = keyId("creds", "app");
  let creds = await read(credsKey);
  let createdFresh = false;
  if (!creds) {
    creds = initAuthCreds();
    await write(credsKey, creds);
    createdFresh = true;
  }

  const reload = async () => {
    const fresh = await read(credsKey);
    if (fresh) {
      // Mutate in place so Baileys state.creds reference stays valid
      for (const k of Object.keys(creds)) {
        if (!(k in fresh)) delete creds[k];
      }
      Object.assign(creds, fresh);
      return { ok: true, registered: isRegisteredCreds(creds) };
    }
    return { ok: false, registered: false };
  };

  const countKeys = async () => {
    try {
      return await col.countDocuments({ key: { $regex: `^${SESSION_ID}:` } });
    } catch {
      return -1;
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(keyId(type, id));
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              if (value) out[id] = value;
            })
          );
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const k = keyId(category, id);
              tasks.push(value ? write(k, value) : remove(k));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await write(credsKey, creds);
    },
    clearAll: async () => {
      await col.deleteMany({ key: { $regex: `^${SESSION_ID}:` } });
      creds = initAuthCreds();
      await write(credsKey, creds);
    },
    /** Re-read creds from Mongo before socket start (cold-start restore). */
    reload,
    isRegistered: () => isRegisteredCreds(creds),
    createdFresh: () => createdFresh,
    countKeys,
  };
}
