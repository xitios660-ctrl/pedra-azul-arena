/** Site-wide contact & WhatsApp config (Pedra Azul / Copa Alto Tietê) */

export const SITE_NAME = "Pedra Azul Arena";
export const SITE_TAGLINE = "Quadra Pedra Azul · Núncio · Alto Tietê";
export const SITE_ORG = "Pedra Azul F.S.";

/** Site-wide contact & WhatsApp config (Pedra Azul / Copa Alto Tietê) */

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
export const BALEYS_VIDEO_SRC = "/assets/video/baleys.mp4";

/**
 * Build a wa.me deep link with optional prefilled message.
 * @param {string} [prefillMessage]
 * @returns {string}
 */
export function whatsappUrl(prefillMessage) {
  const base = `https://wa.me/${WHATSAPP_E164}`;
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
