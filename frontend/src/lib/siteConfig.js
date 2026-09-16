/** Site-wide contact & WhatsApp config (Pedra Azul / Copa Alto Tietê)
 * Hardcoded defaults = fallbacks. Live values come from GET /api/site-settings.
 */

export const SITE_NAME = "Pedra Azul Arena";
export const SITE_TAGLINE = "Quadra Pedra Azul · Núncio · Alto Tietê";
export const SITE_ORG = "Pedra Azul F.S.";

export const WHATSAPP_E164 = "551140028922";
export const WHATSAPP_DISPLAY = "+55 (11) 4002-8922";

export const COURT_PRICE_LABEL = "R$ 130/h";
export const COURT_LOCATION = "Núncio · Alto Tietê · SP";
/** Google Maps search — no invented street address */
export const COURT_MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=Pedra%20Azul%20Nuncio%20Alto%20Tiete%20SP";
export const COURT_DURATION_LABEL = "1 hora (60 min)";
export const PARKING_NOTE = "Estacionamento no entorno da quadra — chegue ~10 min antes.";

/** Brand arena video (cinematic opening / hero loop) */
export const BALEYS_VIDEO_SRC = "/assets/video/baleys-lite.mp4";
export const BALEYS_VIDEO_FULL_SRC = "/assets/video/baleys.mp4";
export const BALEYS_POSTER_SRC = "/assets/video/baleys-poster.jpg";
/** Fallback if poster missing */
export const BALEYS_POSTER_FALLBACK = "/assets/pedra-azul-logo.png";

export const DEFAULT_SITE_SETTINGS = {
  whatsapp_e164: WHATSAPP_E164,
  whatsapp_display: WHATSAPP_DISPLAY,
  pix_key: "contato@pedraazulfs.com.br",
  pix_copy_text: "",
  address_label: COURT_LOCATION,
  maps_url: COURT_MAPS_URL,
  price_per_hour: 130,
  open_hour: 8,
  close_hour: 23,
  // Python weekday: 0=Mon .. 6=Sun (same as backend open_days)
  open_days: [0, 1, 2, 3, 4, 5, 6],
  slot_duration_minutes: 60,
  parking_note: PARKING_NOTE,
  court_name: "Quadra Pedra Azul — Núncio",
};


/** Seed placeholders — never open public wa.me to these until admin configures real values. */
export const PLACEHOLDER_WA_E164 = "551140028922";
export const PLACEHOLDER_PIX_KEY = "contato@pedraazulfs.com.br";

export function isWhatsAppPlaceholder(settingsOrE164, display) {
  let e164 = "";
  let disp = display ?? "";
  if (settingsOrE164 && typeof settingsOrE164 === "object") {
    e164 = String(settingsOrE164.whatsapp_e164 || "");
    disp = String(settingsOrE164.whatsapp_display || disp || "");
  } else {
    e164 = String(settingsOrE164 || "");
  }
  const digits = e164.replace(/\D/g, "");
  if (!digits || digits.length < 10) return true;
  if (digits === PLACEHOLDER_WA_E164 || digits.endsWith("40028922")) return true;
  if (!String(disp).trim() || String(disp).includes("4002-8922")) return true;
  return false;
}

export function isPixKeyPlaceholder(settingsOrKey) {
  const key =
    settingsOrKey && typeof settingsOrKey === "object"
      ? String(settingsOrKey.pix_key || "")
      : String(settingsOrKey || "");
  const k = key.trim().toLowerCase();
  if (!k) return true;
  if (k === PLACEHOLDER_PIX_KEY.toLowerCase()) return true;
  if (k === "arena@premium") return true;
  return false;
}

/**
 * Build a wa.me deep link with optional prefilled message.
 * @param {string} [prefillMessage]
 * @param {string} [e164]
 * @returns {string}
 */
export function whatsappUrl(prefillMessage, e164 = WHATSAPP_E164) {
  const base = `https://wa.me/${e164 || WHATSAPP_E164}`;
  if (!prefillMessage || !String(prefillMessage).trim()) return base;
  return `${base}?text=${encodeURIComponent(String(prefillMessage).trim())}`;
}

/** Default booking CTA WhatsApp prefill (pt-BR, no personal slogans) */
export function defaultWhatsAppPrefill() {
  return (
    `Olá! Quero reservar a Quadra Pedra Azul (Núncio).\n` +
    `Podem me ajudar com horários disponíveis?`
  );
}

export function priceLabel(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return COURT_PRICE_LABEL;
  return `R$ ${n % 1 === 0 ? n : n.toFixed(2)}/h`;
}

/** Convert YYYY-MM-DD → Python weekday (0=Mon .. 6=Sun). */
export function pythonWeekdayFromYmd(ymd) {
  if (!ymd || typeof ymd !== "string") return null;
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const js = d.getDay(); // 0=Sun .. 6=Sat
  return js === 0 ? 6 : js - 1;
}

/** True if date is an open weekday per settings.open_days (default all). Explicit [] = closed. */
export function isOpenDay(ymd, settings) {
  const days = Array.isArray(settings?.open_days)
    ? settings.open_days.map(Number)
    : [0, 1, 2, 3, 4, 5, 6];
  const wd = pythonWeekdayFromYmd(ymd);
  if (wd == null) return true;
  return days.includes(wd);
}

export const OPEN_DAY_LABELS = [
  { value: 0, short: "Seg", full: "Segunda" },
  { value: 1, short: "Ter", full: "Terça" },
  { value: 2, short: "Qua", full: "Quarta" },
  { value: 3, short: "Qui", full: "Quinta" },
  { value: 4, short: "Sex", full: "Sexta" },
  { value: 5, short: "Sáb", full: "Sábado" },
  { value: 6, short: "Dom", full: "Domingo" },
];

