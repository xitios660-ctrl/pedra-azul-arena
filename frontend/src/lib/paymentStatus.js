/** PIX / booking payment UX labels (pt-BR). Never auto-confirm from text alone. */

export const BOOKING_STATUS_LABEL = {
  pending: "Aguardando PIX",
  awaiting_admin: "Comprovante informado",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

export const PAYMENT_STATUS_LABEL = {
  pending: "Aguardando PIX",
  awaiting_confirmation: "PIX informado",
  paid: "PIX confirmado",
  cancelled: "Cancelado",
  expired: "PIX expirado",
};

export const BOOKING_STATUS_COLOR = {
  pending: "var(--warning)",
  awaiting_admin: "var(--brand)",
  confirmed: "var(--success)",
  cancelled: "var(--danger)",
  expired: "var(--text-3)",
};

export const PIX_BADGE = {
  pending: {
    label: "Aguardando PIX",
    short: "PIX pendente",
    hint: "Pague o calção e envie o comprovante.",
    color: "var(--warning)",
    tone: "warning",
  },
  awaiting_admin: {
    label: "Comprovante informado",
    short: "PIX informado",
    hint: "Recebemos o comprovante. Aguardando validação do admin.",
    color: "var(--brand)",
    tone: "info",
  },
  confirmed: {
    label: "Confirmado",
    short: "PIX OK",
    hint: "Pagamento validado. Reserva confirmada.",
    color: "var(--success)",
    tone: "success",
  },
  cancelled: {
    label: "Cancelado",
    short: "Cancelado",
    hint: "Esta reserva foi cancelada.",
    color: "var(--danger)",
    tone: "danger",
  },
  expired: {
    label: "PIX expirado",
    short: "Expirado",
    hint: "O prazo do PIX acabou. Faça uma nova reserva.",
    color: "var(--text-3)",
    tone: "muted",
  },
};

export const CREDITS_BADGE = {
  label: "Crédito de horas",
  short: "Crédito",
  hint: "Pago com pacote de horas — sem PIX.",
  color: "var(--success)",
  tone: "success",
};

/** Resolve booking + payment into a PIX pipeline badge. */
export function pixBadgeFor(booking) {
  if (!booking) return PIX_BADGE.pending;
  const pay = booking.payment?.status;
  const method = booking.payment?.method;
  if (method === "credits" || booking.paid_with_credits) {
    if (booking.status === "cancelled" || pay === "cancelled") return PIX_BADGE.cancelled;
    return CREDITS_BADGE;
  }
  if (booking.status === "expired" || pay === "expired") return PIX_BADGE.expired;
  if (booking.status === "cancelled" || pay === "cancelled") return PIX_BADGE.cancelled;
  if (booking.status === "confirmed" || pay === "paid") return PIX_BADGE.confirmed;
  if (booking.status === "awaiting_admin" || pay === "awaiting_confirmation") {
    return PIX_BADGE.awaiting_admin;
  }
  return PIX_BADGE.pending;
}

/** Human-readable PIX pipeline step for badges */
export function pixPipelineLabel(booking) {
  return pixBadgeFor(booking).short;
}
