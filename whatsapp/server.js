/**
 * Pedra Azul — Baileys WhatsApp sidecar
 * Internal HTTP only (bound to 127.0.0.1). FastAPI proxies admin routes.
 * Auth state persisted in MongoDB (whatsapp_auth). Never expose creds to FE.
 */
import express from "express";
import { MongoClient } from "mongodb";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { useMongoAuthState } from "./mongoAuthState.js";

const PORT = Number(process.env.WHATSAPP_PORT || 3001);
const HOST = process.env.WHATSAPP_HOST || "127.0.0.1";
const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || "arena_futsal";
const INTERNAL_TOKEN = process.env.WHATSAPP_INTERNAL_TOKEN || "";
const AUTO_START = String(process.env.WHATSAPP_AUTO_START || "true").toLowerCase() !== "false";

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "info" });

/** @type {'DESCONECTADO'|'CONECTANDO'|'AGUARDANDO_QR'|'CONECTADO'|'ERRO'} */
let status = "DESCONECTADO";
let qrDataUrl = null;
let connectedNumber = null;
let lastError = null;
let lastDisconnectReason = null;
let sock = null;
let starting = false;
let reconnectAttempt = 0;
let reconnectTimer = null;
let intentionalLogout = false;
let mongoClient = null;
let db = null;
let authHelpers = null;

const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function publicState() {
  return {
    status,
    qr: status === "AGUARDANDO_QR" ? qrDataUrl : null,
    number: connectedNumber,
    last_error: lastError,
    last_disconnect_reason: lastDisconnectReason,
    reconnect_attempt: reconnectAttempt,
  };
}

function setState(patch) {
  if (patch.status != null) status = patch.status;
  if ("qr" in patch) qrDataUrl = patch.qr;
  if ("number" in patch) connectedNumber = patch.number;
  if ("last_error" in patch) lastError = patch.last_error;
  if ("last_disconnect_reason" in patch) lastDisconnectReason = patch.last_disconnect_reason;
  broadcast({ type: "state", ...publicState(), at: new Date().toISOString() });
}

function authOk(req) {
  if (!INTERNAL_TOKEN) return true;
  const h = req.headers["x-internal-token"] || "";
  return h === INTERNAL_TOKEN;
}

function jidFromPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  // Already E.164 without + (e.g. 5511999999999)
  return `${digits}@s.whatsapp.net`;
}

async function startSocket() {
  if (starting) {
    logger.warn("start ignored — already starting");
    return publicState();
  }
  if (sock && (status === "CONECTADO" || status === "AGUARDANDO_QR" || status === "CONECTANDO")) {
    logger.warn("start ignored — socket already active");
    return publicState();
  }

  if (!authHelpers) {
    throw new Error("Mongo auth not ready");
  }

  starting = true;
  intentionalLogout = false;
  setState({ status: "CONECTANDO", qr: null, last_error: null });

  try {
    const { state, saveCreds } = authHelpers;
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: async () => undefined,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const dataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 360,
          });
          setState({ status: "AGUARDANDO_QR", qr: dataUrl });
          reconnectAttempt = 0;
        } catch (e) {
          logger.error({ err: String(e) }, "QR encode failed");
          setState({ status: "ERRO", last_error: "Falha ao gerar QR" });
        }
      }

      if (connection === "open") {
        reconnectAttempt = 0;
        const id = sock?.user?.id || "";
        const num = id.split(":")[0] || id.split("@")[0] || null;
        setState({
          status: "CONECTADO",
          qr: null,
          number: num,
          last_error: null,
          last_disconnect_reason: null,
        });
        logger.info({ number: num }, "WhatsApp connected");
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reasonName =
          Object.entries(DisconnectReason).find(([, v]) => v === statusCode)?.[0] ||
          String(statusCode ?? "unknown");
        lastDisconnectReason = reasonName;
        sock = null;
        starting = false;

        const loggedOut = statusCode === DisconnectReason.loggedOut;
        logger.warn({ reason: reasonName, intentionalLogout }, "WhatsApp disconnected");

        if (intentionalLogout || loggedOut) {
          setState({
            status: "DESCONECTADO",
            qr: null,
            number: null,
            last_disconnect_reason: reasonName,
          });
          return;
        }

        setState({
          status: "DESCONECTADO",
          qr: null,
          number: null,
          last_disconnect_reason: reasonName,
        });
        scheduleReconnect();
      }
    });

    starting = false;
    return publicState();
  } catch (e) {
    starting = false;
    sock = null;
    const msg = e?.message || String(e);
    logger.error({ err: msg }, "startSocket failed");
    setState({ status: "ERRO", last_error: msg, qr: null });
    scheduleReconnect();
    return publicState();
  }
}

function scheduleReconnect() {
  if (intentionalLogout) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempt += 1;
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
  logger.info({ delay, attempt: reconnectAttempt }, "scheduling reconnect");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSocket().catch((e) => logger.error({ err: String(e) }, "reconnect failed"));
  }, delay);
}

async function logout() {
  intentionalLogout = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    if (sock) {
      await sock.logout();
    }
  } catch (e) {
    logger.warn({ err: String(e) }, "logout sock error");
  }
  sock = null;
  starting = false;
  if (authHelpers?.clearAll) {
    await authHelpers.clearAll();
  }
  setState({
    status: "DESCONECTADO",
    qr: null,
    number: null,
    last_error: null,
    last_disconnect_reason: "loggedOut",
  });
  return publicState();
}

async function sendText(phone, text) {
  if (status !== "CONECTADO" || !sock) {
    const err = new Error("WhatsApp não conectado");
    err.code = "NOT_CONNECTED";
    throw err;
  }
  const jid = jidFromPhone(phone);
  if (!jid) {
    const err = new Error("Número inválido");
    err.code = "BAD_PHONE";
    throw err;
  }
  await sock.sendMessage(jid, { text: String(text) });
  return { ok: true, to: jid.split("@")[0] };
}

const app = express();
app.use(express.json({ limit: "256kb" }));

app.use((req, res, next) => {
  if (!authOk(req)) {
    return res.status(401).json({ detail: "Unauthorized" });
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, whatsapp: status });
});

app.get("/status", (_req, res) => {
  res.json(publicState());
});

app.post("/start", async (_req, res) => {
  try {
    const state = await startSocket();
    res.json(state);
  } catch (e) {
    res.status(500).json({ detail: e?.message || String(e) });
  }
});

app.post("/logout", async (_req, res) => {
  try {
    const state = await logout();
    res.json(state);
  } catch (e) {
    res.status(500).json({ detail: e?.message || String(e) });
  }
});

app.post("/send", async (req, res) => {
  try {
    const { phone, text } = req.body || {};
    if (!phone || !text) {
      return res.status(400).json({ detail: "phone e text são obrigatórios" });
    }
    const result = await sendText(phone, text);
    res.json(result);
  } catch (e) {
    const code = e?.code === "NOT_CONNECTED" ? 503 : e?.code === "BAD_PHONE" ? 400 : 500;
    res.status(code).json({ detail: e?.message || String(e) });
  }
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "state", ...publicState(), at: new Date().toISOString() })}\n\n`);
  sseClients.add(res);
  const hb = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(hb);
      sseClients.delete(res);
    }
  }, 25000);
  req.on("close", () => {
    clearInterval(hb);
    sseClients.delete(res);
  });
});

async function main() {
  if (!MONGO_URL) {
    logger.error("MONGO_URL is required");
    process.exit(1);
  }
  mongoClient = new MongoClient(MONGO_URL);
  await mongoClient.connect();
  db = mongoClient.db(DB_NAME);
  authHelpers = await useMongoAuthState(db);
  logger.info({ db: DB_NAME }, "Mongo auth state ready");

  // Soft instance lock (best-effort) — avoids two sockets fighting one session
  const lockCol = db.collection("whatsapp_locks");
  const lockId = process.env.WHATSAPP_SESSION_ID || "default";
  const existing = await lockCol.findOne({ _id: lockId });
  const now = Date.now();
  if (existing?.expires_at && new Date(existing.expires_at).getTime() > now && existing.holder !== process.pid) {
    logger.warn({ holder: existing.holder }, "another WhatsApp holder may be active — continuing carefully");
  }
  await lockCol.updateOne(
    { _id: lockId },
    {
      $set: {
        holder: process.pid,
        hostname: process.env.HOSTNAME || "local",
        expires_at: new Date(now + 60_000),
        updated_at: new Date(),
      },
    },
    { upsert: true }
  );
  setInterval(async () => {
    try {
      await lockCol.updateOne(
        { _id: lockId, holder: process.pid },
        { $set: { expires_at: new Date(Date.now() + 60_000), updated_at: new Date() } }
      );
    } catch (e) {
      logger.warn({ err: String(e) }, "lock refresh failed");
    }
  }, 20_000);
  logger.info({ pid: process.pid }, "instance lock refreshed");

  app.listen(PORT, HOST, () => {
    logger.info({ host: HOST, port: PORT }, "WhatsApp sidecar listening");
  });

  if (AUTO_START) {
    startSocket().catch((e) => logger.error({ err: String(e) }, "auto-start failed"));
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, "fatal");
  process.exit(1);
});

process.on("SIGTERM", async () => {
  intentionalLogout = true;
  try {
    if (sock) sock.end(undefined);
  } catch {}
  try {
    await mongoClient?.close();
  } catch {}
  process.exit(0);
});
