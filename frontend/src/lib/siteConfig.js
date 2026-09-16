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
  pix_key: "arena@premium",
  pix_copy_text: "",
  address_label: COURT_LOCATION,
  maps_url: COURT_MAPS_URL,
  price_per_hour: 130,
  open_hour: 8,
  close_hour: 23,
  slot_duration_minutes: 60,
  parking_note: PARKING_NOTE,
  court_name: "Quadra Pedra Azul — Núncio",
};

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
