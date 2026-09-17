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
export const STRUCTURE_BLURB =
  "Quadra oficial no Alto Tietê — iluminação noturna, espaço para peladas e treinos. Chegue ~10 min antes.";
export const DEFAULT_AMENITIES = ["Iluminação noturna", "Pelada & treino", "Copa Alto Tietê"];

/** Brand arena video (cinematic opening / hero loop) */
export const BALEYS_VIDEO_SRC = "https://d2ol7oe51mr4n9.cloudfront.net/user_3ExHvVfp1S2A6CycImN7kDdmbsV/5f0b6913-dd24-4c8a-90c5-681d493ca11b.mp4";
export const BALEYS_VIDEO_FULL_SRC = BALEYS_VIDEO_SRC;
export const BALEYS_POSTER_SRC = "https://d2ol7oe51mr4n9.cloudfront.net/user_3ExHvVfp1S2A6CycImN7kDdmbsV/915e8d00-facd-4ec2-8e44-e676adf25143.jpg";
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
  price_weekend: null,
  open_hour: 8,
  close_hour: 23,
  weekend_open_hour: null,  // null = use open_hour/close_hour on Sat/Sun
  weekend_close_hour: null,
  // Python weekday: 0=Mon .. 6=Sun (same as backend open_days)
  open_days: [0, 1, 2, 3, 4, 5, 6],
  slot_duration_minutes: 60,
  parking_note: PARKING_NOTE,
  has_parking: true,
  game_duration_note: COURT_DURATION_LABEL,
  accepts_pix: true,
  structure_blurb: STRUCTURE_BLURB,
  amenities: DEFAULT_AMENITIES,
  court_name: "Quadra Pedra Azul — Núncio",
  allow_multi_hour: true,
  max_hours_per_booking: 2,
  waitlist_enabled: true,
  cancel_min_hours: 2,
  policies_enabled: true,
  policy_cancel:
    "Cancelamentos pelo cliente devem ser feitos com pelo menos {horas} horas de antecedência do horário reservado. Após esse prazo, entre em contato pelo WhatsApp.",
  policy_rain: "Em caso de chuva, entre em contato pelo WhatsApp.",
  // Cycle 39: site announcement (empty + disabled by default)
  announcement_enabled: false,
  announcement_text: "",
  announcement_style: "info",
};

/** Resolve {horas}/{cancel_min_hours} in policy_cancel from settings.cancel_min_hours */
export function resolvePolicyCancel(settings) {
  const s = settings || DEFAULT_SITE_SETTINGS;
  const hours = Number(s.cancel_min_hours ?? 2);
  const raw = String(s.policy_cancel_resolved || s.policy_cancel || DEFAULT_SITE_SETTINGS.policy_cancel || "").trim();
  return raw
    .replace(/\{cancel_min_hours\}/g, String(hours))
    .replace(/\{horas\}/g, String(hours));
}

export function resolvePolicyRain(settings) {
  const s = settings || DEFAULT_SITE_SETTINGS;
  return String(s.policy_rain_resolved || s.policy_rain || "").trim();
}

export function policiesVisible(settings) {
  const s = settings || DEFAULT_SITE_SETTINGS;
  if (s.policies_enabled === false) return false;
  return !!(resolvePolicyCancel(s) || resolvePolicyRain(s));
}


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

/** Effective hourly price for YYYY-MM-DD. Sat/Sun use price_weekend when set (>0). */
export function priceForDate(settings, ymd) {
  const base = Number(settings?.price_per_hour);
  const we = Number(settings?.price_weekend);
  const hasWe = settings?.price_weekend != null && settings?.price_weekend !== "" && Number.isFinite(we) && we > 0;
  if (!ymd || !hasWe) return Number.isFinite(base) ? base : 130;
  const wd = pythonWeekdayFromYmd(ymd);
  if (wd === 5 || wd === 6) return we;
  return Number.isFinite(base) ? base : 130;
}

/** True when maps_url is a usable http(s) link (do not invent URLs). */
export function mapsUrlReady(settingsOrUrl) {
  const u =
    settingsOrUrl && typeof settingsOrUrl === "object"
      ? String(settingsOrUrl.maps_url || "").trim()
      : String(settingsOrUrl || "").trim();
  if (!u) return false;
  return /^https?:\/\//i.test(u);
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


/** Effective open/close hours for a YYYY-MM-DD (weekend pair if set and Sat/Sun). */
export function hoursForDate(ymd, settings) {
  const s = settings || DEFAULT_SITE_SETTINGS;
  const open = Number(s.open_hour ?? 8);
  const close = Number(s.close_hour ?? 23);
  const wo = s.weekend_open_hour;
  const wc = s.weekend_close_hour;
  const hasWeekend =
    wo !== null && wo !== undefined && wo !== "" && Number(wo) !== -1 &&
    wc !== null && wc !== undefined && wc !== "" && Number(wc) !== -1;
  const wd = pythonWeekdayFromYmd(ymd);
  if (hasWeekend && (wd === 5 || wd === 6)) {
    return { open_hour: Number(wo), close_hour: Number(wc) };
  }
  return { open_hour: open, close_hour: close };
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

/** Duration chip / FAQ label from settings (falls back to slot minutes). */
export function gameDurationLabel(settings) {
  const note = (settings?.game_duration_note || "").trim();
  if (note) return note;
  const mins = Number(settings?.slot_duration_minutes ?? 60);
  if (mins === 60) return COURT_DURATION_LABEL;
  if (Number.isFinite(mins) && mins > 0) {
    if (mins % 60 === 0) {
      const h = mins / 60;
      return `${h} hora${h !== 1 ? "s" : ""} (${mins} min)`;
    }
    return `${mins} minutos`;
  }
  return COURT_DURATION_LABEL;
}

/** Build landing amenity chips from settings flags + amenities list. */
export function structureChips(settings) {
  const s = settings || DEFAULT_SITE_SETTINGS;
  const chips = [];
  const seen = new Set();
  const push = (label) => {
    const t = String(label || "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    chips.push(t);
  };
  for (const a of Array.isArray(s.amenities) ? s.amenities : []) push(a);
  if (s.has_parking !== false) push("Estacionamento");
  if (s.accepts_pix !== false) push("Aceita PIX");
  push(gameDurationLabel(s));
  return chips.slice(0, 10);
}


/** YYYY-MM-DD in America/Sao_Paulo (booking day boundary). */
export function todayYmdSaoPaulo() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }
}

/** Validate YYYY-MM-DD (loose). */
export function isValidYmd(ymd) {
  if (!ymd || typeof ymd !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

/** Normalize HH:MM or H:MM → HH:MM; null if invalid. */
export function normalizeTimeHm(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Prefill WhatsApp message when asking about a tournament (no signup backend). */
export function tournamentInterestPrefill(tournamentName) {
  const name = String(tournamentName || "").trim() || "torneio";
  return (
    `Olá! Tenho interesse no torneio "${name}" na Quadra Pedra Azul (Núncio).\n` +
    `Podem me passar mais informações?`
  );
}
