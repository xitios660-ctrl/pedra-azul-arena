/**
 * Lightweight pt-BR natural language parsing for arena booking intents.
 * No external NLP deps — regex + heuristics only.
 */

const WEEKDAYS = {
  domingo: 0,
  dom: 0,
  segunda: 1,
  "segunda-feira": 1,
  seg: 1,
  terca: 2,
  terça: 2,
  "terca-feira": 2,
  "terça-feira": 2,
  ter: 2,
  quarta: 3,
  "quarta-feira": 3,
  qua: 3,
  quinta: 4,
  "quinta-feira": 4,
  qui: 4,
  sexta: 5,
  "sexta-feira": 5,
  sex: 5,
  sabado: 6,
  sábado: 6,
  sab: 6,
};

const MONTHS = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, março: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeText(text) {
  return stripAccents(String(text || "").toLowerCase().trim()).replace(/\s+/g, " ");
}

/** America/Sao_Paulo "now" as Date parts via Intl */
export function nowSaoPaulo() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const minute = Number(parts.minute);
  const wdFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" });
  const wd = wdFmt.format(new Date());
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { ymd, hour, minute, weekday: map[wd] ?? 0 };
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function nextWeekday(fromYmd, fromWd, targetWd) {
  const delta = (targetWd - fromWd + 7) % 7;
  return addDaysYmd(fromYmd, delta);
}

/**
 * Parse hour from text. Returns "HH:00" or null.
 * Supports: 20, 20h, 20:00, 8 da noite, 8h da noite, meio-dia, meia-noite
 */
export function parseTime(text) {
  const t = normalizeText(text);
  if (!t) return null;

  if (/\bmeio[\s-]?dia\b/.test(t)) return "12:00";
  if (/\bmeia[\s-]?noite\b/.test(t)) return "00:00";

  // 8 da noite / 8h da noite / 9 da manha / 3 da tarde
  let m = t.match(/\b(\d{1,2})\s*h?(?:\s*da|\s*de)?\s*(noite|tarde|manha|madrugada)\b/);
  if (m) {
    let h = Number(m[1]);
    const period = m[2];
    if (period === "noite") {
      if (h >= 1 && h <= 11) h += 12;
      if (h === 12) h = 0;
    } else if (period === "tarde") {
      if (h >= 1 && h <= 11) h += 12;
    } else if (period === "manha") {
      if (h === 12) h = 12;
    } else if (period === "madrugada") {
      if (h === 12) h = 0;
    }
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }

  // 20:00 or 20h00 or 20h
  m = t.match(/\b(\d{1,2})\s*[:h]\s*(\d{2})?\b/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }

  // bare hour with context words nearby: as 20 / horario 20 / as 8
  m = t.match(/\b(?:as|às|horario|horário|para(?:\s+as)?|quero(?:\s+as)?)\s+(\d{1,2})\b/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }

  // standalone 2-digit hour if message is mostly that
  m = t.match(/^(\d{1,2})$/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }

  return null;
}

/**
 * Parse a target date. Returns YYYY-MM-DD or null.
 * Supports: hoje, amanha, depois de amanha, sabado, 15/09, 15 de setembro
 */
export function parseDate(text, now = null) {
  const n = now || nowSaoPaulo();
  const t = normalizeText(text);

  if (/\bhoje\b/.test(t)) return n.ymd;
  if (/\bdepois\s+de\s+amanha\b/.test(t) || /\bdepois\s+de\s+amanhã\b/.test(t)) {
    return addDaysYmd(n.ymd, 2);
  }
  if (/\bamanha\b/.test(t)) return addDaysYmd(n.ymd, 1);

  // weekday
  for (const [name, wd] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${stripAccents(name)}\\b`).test(t)) {
      return nextWeekday(n.ymd, n.weekday, wd);
    }
  }

  // dd/mm or dd/mm/yyyy
  let m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : Number(n.ymd.slice(0, 4));
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // 15 de setembro
  m = t.match(/\b(\d{1,2})\s+de\s+([a-zç]+)\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2]];
    if (mo && d >= 1 && d <= 31) {
      let y = Number(n.ymd.slice(0, 4));
      const candidate = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (candidate < n.ymd) y += 1;
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  return null;
}

/** "depois das 18" / "após as 20" / "a partir das 20" → minimum hour inclusive */
export function parseAfterHour(text) {
  const t = normalizeText(text);
  let m = t.match(/\b(?:depois|apos|após)\s+(?:das?\s+|as\s+)?(\d{1,2})\b/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return h;
  }
  m = t.match(/\b(?:a\s+partir\s+das?\s+)(\d{1,2})\b/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return h;
  }
  // "depois das 20h" / "depois das 20:00"
  m = t.match(/\b(?:depois|apos|após)\s+(?:das?\s+|as\s+)?(\d{1,2})\s*[:h]/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return h;
  }
  return null;
}

/** "sábado à noite" / "sabado de noite" → afterHour 18 (evening window) */
export function parseNightWindow(text) {
  const t = normalizeText(text);
  if (/\b(a\s+noite|à\s+noite|de\s+noite|noitezinha|final\s+da\s+noite)\b/.test(t)) {
    return 18;
  }
  if (/\b(a\s+tarde|de\s+tarde)\b/.test(t) && !/\bdepois\b/.test(t)) {
    return 14;
  }
  return null;
}

/** Mid-flow change of mind: "na verdade", "mudei de ideia", "outra data", "melhor amanhã" */
export function isChangeOfMind(text) {
  const t = normalizeText(text);
  return (
    /\b(na verdade|mudei de ideia|mudei de ideia|melhor|outra data|outro horario|outro horário|esquece|deixa pra la|deixa pra lá|quero mudar|mudar (a )?data|mudar (o )?horario)\b/.test(t) ||
    /\b(nao quero mais|não quero mais|volta|recome[cç]ar|comeca de novo|começa de novo)\b/.test(t)
  );
}

export function detectIntent(text, conversationState) {
  const t = normalizeText(text);
  const state = conversationState?.state || "idle";

  // Affirm / deny while in confirm flows
  if (state === "awaiting_confirm" || state === "awaiting_cancel_confirm" || state === "awaiting_reschedule_confirm") {
    if (/^(s|sim|ss|confirma|confirmar|ok|pode|claro|isso|fechado|bora)\b/.test(t) || t === "s") {
      return { intent: "affirm" };
    }
    if (/^(n|nao|não|cancelar|cancela|nunca|negativo)\b/.test(t) || t === "n") {
      return { intent: "deny" };
    }
  }

  // Change of mind mid-flow (before treating as name / slot)
  if (["awaiting_name", "awaiting_confirm", "awaiting_slot", "awaiting_cancel_confirm", "awaiting_reschedule_confirm", "awaiting_reschedule_slot"].includes(state)) {
    if (isChangeOfMind(t)) {
      const date = parseDate(t);
      const time = parseTime(t);
      const afterHour = parseAfterHour(t) ?? parseNightWindow(t);
      return { intent: "change_mind", date, time, afterHour };
    }
    // New date/time while confirming → treat as change
    if (state === "awaiting_confirm" || state === "awaiting_name") {
      const date = parseDate(t);
      const time = parseTime(t);
      if (date || (time && /\b(as|às|horario|horário|amanha|hoje|sabado|sábado)\b/.test(t))) {
        return {
          intent: "change_mind",
          date: date || conversationState?.data?.date || null,
          time: time || null,
          afterHour: parseAfterHour(t) ?? parseNightWindow(t),
        };
      }
    }
  }

  if (state === "awaiting_name") {
    if (/\b(cancelar|cancela|menu|ajuda|oi|ola|reagendar|remarcar)\b/.test(t) && t.length < 24) {
      // fall through to global intents
    } else {
      return { intent: "provide_name", name: String(text).trim() };
    }
  }

  if (state === "awaiting_slot" || state === "awaiting_reschedule_slot") {
    // date provided instead of time (change)
    const maybeDate = parseDate(t);
    if (maybeDate && !parseTime(t) && /\b(hoje|amanha|sabado|sábado|segunda|terca|terça|quarta|quinta|sexta|domingo|\d{1,2}[\/\-])\b/.test(t)) {
      return { intent: "change_mind", date: maybeDate, time: null, afterHour: parseAfterHour(t) ?? parseNightWindow(t) };
    }
    const time = parseTime(t);
    if (time) return { intent: "provide_slot", time };
  }

  // Greetings
  if (/^(oi+|ola+|olá+|hey|eai|e ae|bom dia|boa tarde|boa noite|salve)\b/.test(t) || t === "oi" || t === "ola") {
    return { intent: "greeting" };
  }

  // Help / menu fallback
  if (/\b(ajuda|help|menu|opcoes|opções|o que (voce|você) faz)\b/.test(t)) {
    return { intent: "help" };
  }

  // Parking
  if (/\b(estacionamento|estacionar|vaga de carro|tem lugar pra carro|tem estacionamento|onde estaciono|onde estacionar)\b/.test(t)) {
    return { intent: "parking" };
  }

  // Game duration
  if (/\b(duracao|duração|quanto tempo|tempo de jogo|dura quanto|1 hora|uma hora|60 min|sessao|sessão)\b/.test(t) &&
      !/\b(reserv|agend)\b/.test(t)) {
    return { intent: "duration" };
  }

  // PIX how-to / acceptance
  if (/\b(aceita\s+pix|aceitam\s+pix|aceita\s+pagamento|pix|como pagar|pagamento|calcao|calção|comprovante|qr ?code|copia e cola|copia-e-cola)\b/.test(t)) {
    return { intent: "pix_howto" };
  }

  // Hour credits / pacote balance (Cycle 33) — before price (both use "quanto")
  if (/\b(quanto credito|quanto crédito|meu pacote|horas restantes|meu credito|meu crédito|saldo (de )?horas|saldo do pacote|credito restante|crédito restante|quantas horas (eu )?tenho|tenho credito|tenho crédito)\b/.test(t)) {
    return { intent: "credits_balance" };
  }

  // Price
  if (/\b(preco|preço|valor|quanto custa|quanto e|quanto é|taxa)\b/.test(t)) {
    return { intent: "price" };
  }

  // Address / location / maps / structure
  if (/\b(endereco|endereço|onde fica|localizacao|localização|como chegar|onde e|onde é|mapa|maps|google maps|waze|conhece a quadra|estrutura da quadra)\b/.test(t)) {
    return { intent: "address" };
  }

  // Policy FAQ (Cycle 30) — before cancel *action*
  if (/\b(chuva|chovendo|chover|garoa|temporal|tempo ruim|molhad[oa])\b/.test(t)) {
    return { intent: "policy_rain" };
  }
  if (/\b(politica|política)\b/.test(t)) {
    return { intent: "policy_all" };
  }
  // "cancelamento" / "política de cancelamento" = FAQ; "cancelar/cancela" = action
  if (/\bcancelamento\b/.test(t) && !/\b(cancelar|cancela|desmarcar|desmarca)\b/.test(t)) {
    return { intent: "policy_cancel" };
  }

  // Reschedule
  if (/\b(reagendar|remarcar|trocar horario|trocar horário|mudar horario|mudar horário|adiar)\b/.test(t)) {
    return { intent: "reschedule" };
  }

  // Cancel
  if (/\b(cancelar|cancela|desmarcar|desmarca)\b/.test(t)) {
    return { intent: "cancel" };
  }

  // Availability / book
  const wantsAvail =
    /\b(disponivel|disponível|disponibilidade|tem horario|tem horário|horarios|horários|vaga|livre|quando posso)\b/.test(t);
  const wantsBook =
    /\b(reservar|reserva|agendar|agendamento|quero jogar|marcar|book)\b/.test(t);

  const date = parseDate(t);
  const time = parseTime(t);
  let afterHour = parseAfterHour(t);
  const night = parseNightWindow(t);
  if (afterHour == null && night != null) afterHour = night;

  // "sábado à noite" without explicit book verb → availability with evening filter
  if (date && night != null && !time && !wantsBook) {
    return { intent: "availability", date, afterHour: night };
  }

  if (wantsBook || (wantsAvail && time) || (state === "idle" && time && date)) {
    if (time && date) {
      return { intent: "book_direct", date, time };
    }
    if (wantsBook || time) {
      return { intent: "book_start", date: date || null, time: time || null, afterHour };
    }
  }

  if (wantsAvail || date || afterHour != null) {
    return {
      intent: "availability",
      date: date || null,
      afterHour,
    };
  }

  if (time && state === "idle") {
    return { intent: "book_start", date: date || null, time, afterHour };
  }

  return { intent: "unknown" };
}

export function formatDateBr(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export function weekdayNamePt(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
  const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(dt);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return names[map[wd] ?? 0];
}
