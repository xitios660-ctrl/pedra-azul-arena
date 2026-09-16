/** PIX / booking payment UX labels (pt-BR). Never auto-confirm from text alone. */

export const BOOKING_STATUS_LABEL = {
  pending: "Aguardando PIX",
  awaiting_admin: "Comprovante informado",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

export const PAYMENT_STATUS_LABEL = {
  pending: "Aguardando",
  awaiting_confirmation: "Informado",
  paid: "Confirmado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

export const BOOKING_STATUS_COLOR = {
  pending: "var(--warning)",
  awaiting_admin: "var(--brand)",
  confirmed: "var(--success)",
  cancelled: "var(--danger)",
  expired: "var(--text-3)",
};

/** Human-readable PIX pipeline step for badges */
export function pixPipelineLabel(booking) {
  if (!booking) return "";
  if (booking.status === "expired" || booking.payment?.status === "expired") return "Expirado";
  if (booking.status === "cancelled" || booking.payment?.status === "cancelled") return "Cancelado";
  if (booking.status === "confirmed" || booking.payment?.status === "paid") return "Confirmado";
  if (booking.status === "awaiting_admin" || booking.payment?.status === "awaiting_confirmation") {
    return "Informado";
  }
  return "Aguardando";
}
