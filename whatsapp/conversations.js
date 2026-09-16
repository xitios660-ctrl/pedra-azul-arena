/**
 * Per-JID conversation state in MongoDB (isolated per customer).
 * Idle TTL clears stale mid-flow state so old contexts don't leak.
 */
const COL = "whatsapp_conversations";
/** Mid-flow idle timeout (30 min). Idle state docs are harmless. */
const TTL_MS = Number(process.env.WA_CONV_IDLE_MS || 30 * 60 * 1000);

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
          { $set: { state: "idle", data: {}, updated_at: new Date(), cleared_reason: "idle_timeout" } }
        );
        return { jid, state: "idle", data: {}, _idleCleared: true };
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
          $unset: { cleared_reason: "" },
        },
        { upsert: true }
      );
      return { jid, state, data };
    },

    async clear(jid) {
      return this.set(jid, "idle", {});
    },

    /** Sweep stale non-idle conversations (call periodically). */
    async clearStale(now = Date.now()) {
      const cutoff = new Date(now - TTL_MS);
      const res = await col.updateMany(
        { state: { $ne: "idle" }, updated_at: { $lt: cutoff } },
        { $set: { state: "idle", data: {}, updated_at: new Date(), cleared_reason: "idle_sweep" } }
      );
      return res.modifiedCount || 0;
    },

    ttlMs: TTL_MS,
  };
}
