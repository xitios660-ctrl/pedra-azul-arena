/** Site-wide contact & WhatsApp config (Pedra Azul / Copa Alto Tietê) */

export const WHATSAPP_E164 = "551140028922";
export const WHATSAPP_DISPLAY = "+55 (11) 4002-8922";

export const COURT_PRICE_LABEL = "R$ 130/h";
export const COURT_LOCATION = "Núncio · Alto Tietê · SP";

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
