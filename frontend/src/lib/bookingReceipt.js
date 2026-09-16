/** Shareable / printable booking receipt helpers (pt-BR). */

import { BOOKING_STATUS_LABEL } from "@/lib/paymentStatus";
import { SITE_NAME, whatsappUrl } from "@/lib/siteConfig";

export function fmtBRL(n) {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** YYYY-MM-DD → dd/mm/yyyy (local). */
export function formatReceiptDate(ymd) {
  if (!ymd || typeof ymd !== "string") return "—";
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("pt-BR");
}

/** Human duration from booking fields. */
export function formatReceiptDuration(booking) {
  const mins = Number(booking?.duration_minutes);
  if (Number.isFinite(mins) && mins > 0) {
    if (mins === 60) return "1 hora";
    if (mins === 120) return "2 horas";
    if (mins % 60 === 0) {
      const h = mins / 60;
      return `${h} hora${h !== 1 ? "s" : ""}`;
    }
    return `${mins} minutos`;
  }
  const hours = Number(booking?.duration_hours);
  if (Number.isFinite(hours) && hours > 0) {
    if (hours === 1) return "1 hora";
    return `${hours} horas`;
  }
  return "1 hora";
}

/** "19:00–20:00" or just start if no end. */
export function formatReceiptTimeRange(booking) {
  const start = (booking?.start_time || "").trim() || "—";
  const end = (booking?.end_time || "").trim();
  if (end && end !== start) return `${start}–${end}`;
  return start;
}

export function receiptStatusLabel(booking) {
  const s = booking?.status || "";
  return BOOKING_STATUS_LABEL[s] || (s ? String(s) : "—");
}

/**
 * Natural Portuguese share text for WhatsApp / clipboard / Web Share.
 * @param {object} booking
 * @param {{ address_label?: string, court_name?: string }} [settings]
 */
export function buildReceiptShareText(booking, settings = {}) {
  const court =
    (booking?.court_name || settings?.court_name || "Quadra Pedra Azul — Núncio").trim();
  const date = formatReceiptDate(booking?.date);
  const time = formatReceiptTimeRange(booking);
  const duration = formatReceiptDuration(booking);
  const name = (booking?.customer_name || "").trim() || "Cliente";
  const value = fmtBRL(booking?.deposit ?? booking?.total);
  const status = receiptStatusLabel(booking);
  const address = String(settings?.address_label || booking?.address_label || "").trim();
  const usedCredits = booking?.payment?.method === "credits" || booking?.paid_with_credits;
  const creditsH = booking?.payment?.credits_hours || booking?.credits_hours;

  const lines = [
    `Olá! Segue o comprovante da minha reserva na ${SITE_NAME} ⚽`,
    "",
    `Quadra: ${court}`,
    `Data: ${date}`,
    `Horário: ${time} (${duration})`,
    `Nome: ${name}`,
    usedCredits
      ? `Pagamento: crédito de horas${creditsH ? ` (${creditsH}h)` : ""}`
      : `Valor (calção): ${value}`,
    `Status: ${status}`,
  ];
  if (address) lines.push(`Local: ${address}`);
  lines.push("", "Qualquer dúvida, é só chamar!");
  return lines.join("\n");
}

/** WhatsApp deep link with prefilled receipt text (chat picker if no e164). */
export function buildReceiptWhatsAppUrl(text, e164) {
  const msg = String(text || "").trim();
  if (!msg) return "https://wa.me/";
  const digits = String(e164 || "").replace(/\D/g, "");
  // Prefer chat-picker (no number) so customer can share with friends/family.
  // If e164 passed explicitly for arena contact, use it.
  if (digits && digits.length >= 10) {
    return whatsappUrl(msg, digits);
  }
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export function canUseWebShare() {
  try {
    return typeof navigator !== "undefined" && typeof navigator.share === "function";
  } catch {
    return false;
  }
}

export async function copyText(text) {
  const t = String(text || "");
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(t);
    return true;
  }
  // Fallback for older browsers / insecure contexts
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/**
 * Try Web Share API; returns { shared: true } | { shared: false, reason }.
 * Does not throw AbortError (user cancel) as failure.
 */
export async function shareReceiptText(text, title = SITE_NAME) {
  if (!canUseWebShare()) return { shared: false, reason: "unsupported" };
  try {
    await navigator.share({ title, text: String(text || "") });
    return { shared: true };
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) {
      return { shared: false, reason: "cancelled" };
    }
    return { shared: false, reason: "error" };
  }
}

export function printReceipt() {
  if (typeof window === "undefined" || typeof window.print !== "function") return;
  const body = document.body;
  body.classList.add("printing-receipt");
  const cleanup = () => {
    body.classList.remove("printing-receipt");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Fallback cleanup if afterprint never fires
  setTimeout(cleanup, 60_000);
  window.print();
}
