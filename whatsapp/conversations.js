/**
 * Per-JID conversation state in MongoDB (isolated per customer).
 */
const COL = "whatsapp_conversations";
const TTL_MS = 2 * 60 * 60 * 1000; // 2h idle reset

export function conversations(db) {
  const col = db.collection(COL);

  return {
    async ensureIndexes() {
      await col.createIndex({ jid: 1 }, { unique: true });
      await col.createIndex({ updated_at: 1 });
    },

    async get(jid) {
      const doc = await col.findOne({ jid });
      if (!doc) return { jid, state: "idle", data: {} };
      const age = Date.now() - new Date(doc.updated_at || 0).getTime();
      if (age > TTL_MS && doc.state !== "idle") {
        await col.updateOne(
          { jid },
          { $set: { state: "idle", data: {}, updated_at: new Date() } }
        );
        return { jid, state: "idle", data: {} };
      }
      return { jid, state: doc.state || "idle", data: doc.data || {} };
    },

    async set(jid, state, data = {}) {
      await col.updateOne(
        { jid },
        {
          $set: {
            jid,
            state,
            data,
            updated_at: new Date(),
          },
        },
        { upsert: true }
      );
      return { jid, state, data };
    },

    async clear(jid) {
      return this.set(jid, "idle", {});
    },
  };
}
