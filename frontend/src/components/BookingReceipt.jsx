import React, { useMemo, useState } from "react";
import {
  Calendar, Clock, MapPin, User, Banknote, BadgeCheck, Copy, Share2,
  MessageCircle, Printer, Check, Loader2, Ticket,
} from "lucide-react";
import { useSiteSettings } from "@/lib/SiteSettings";
import {
  buildReceiptShareText,
  buildReceiptWhatsAppUrl,
  canUseWebShare,
  copyText,
  shareReceiptText,
  printReceipt,
  formatReceiptDate,
  formatReceiptDuration,
  formatReceiptTimeRange,
  receiptStatusLabel,
  fmtBRL,
} from "@/lib/bookingReceipt";
import { BOOKING_STATUS_COLOR } from "@/lib/paymentStatus";

/**
 * Neon premium booking receipt — mobile-first.
 * Actions: Copiar texto · Compartilhar (Web Share) · WhatsApp · Imprimir/PDF
 */
export default function BookingReceipt({
  booking,
  compact = false,
  variant = "customer",
  className = "",
  testIdPrefix = "booking-receipt",
}) {
  const { settings } = useSiteSettings();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const canShare = canUseWebShare();

  const shareText = useMemo(
    () => buildReceiptShareText(booking, settings),
    [booking, settings],
  );
  const waHref = useMemo(
    () => buildReceiptWhatsAppUrl(shareText),
    [shareText],
  );

  if (!booking) return null;

  const statusColor = BOOKING_STATUS_COLOR[booking.status] || "var(--brand)";
  const address = String(settings?.address_label || "").trim();
  const court = booking.court_name || settings?.court_name || "Quadra Pedra Azul — Núncio";

  const onCopy = async () => {
    setBusy("copy");
    try {
      const ok = await copyText(shareText);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    } finally {
      setBusy("");
    }
  };

  const onShare = async () => {
    setBusy("share");
    try {
      const res = await shareReceiptText(shareText);
      if (!res.shared && res.reason === "unsupported") {
        await onCopy();
      }
    } finally {
      setBusy("");
    }
  };

  const onPrint = () => {
    printReceipt();
  };

  return (
    <div
      data-testid={testIdPrefix}
      className={`booking-receipt relative overflow-hidden ${compact ? "p-4" : "p-5 sm:p-6"} ${className}`}
    >
      <div className="booking-receipt-glow pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full blur-3xl opacity-30"
        style={{ background: statusColor }} aria-hidden />

      <div className="relative z-[1]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] tracking-[0.35em] uppercase text-[var(--brand)] flex items-center gap-2">
              <Ticket className="w-3 h-3" />
              {variant === "admin" ? "Recibo · balcão" : "Recibo da reserva"}
            </div>
            <h3 className={`font-heading uppercase italic leading-none mt-1 ${compact ? "text-2xl" : "text-3xl sm:text-4xl"}`}>
              Pedra <span className="text-[var(--brand)]">Azul</span>
            </h3>
          </div>
          <span
            className="text-[10px] uppercase tracking-[0.25em] px-2.5 py-1 border shrink-0"
            style={{ color: statusColor, borderColor: statusColor }}
            data-testid={`${testIdPrefix}-status`}
          >
            <BadgeCheck className="w-3 h-3 inline mr-1" />
            {receiptStatusLabel(booking)}
          </span>
        </div>

        <dl className={`mt-4 grid gap-3 ${compact ? "text-sm" : "sm:grid-cols-2 text-sm"}`}>
          <ReceiptRow icon={<MapPin className="w-3.5 h-3.5" />} label="Quadra" value={court} />
          <ReceiptRow icon={<Calendar className="w-3.5 h-3.5" />} label="Data" value={formatReceiptDate(booking.date)} />
          <ReceiptRow
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Horário"
            value={`${formatReceiptTimeRange(booking)} · ${formatReceiptDuration(booking)}`}
          />
          <ReceiptRow icon={<User className="w-3.5 h-3.5" />} label="Nome" value={booking.customer_name || "—"} />
          <ReceiptRow
            icon={<Banknote className="w-3.5 h-3.5" />}
            label="Valor (calção)"
            value={fmtBRL(booking.deposit ?? booking.total)}
            accent
          />
          {address ? (
            <ReceiptRow icon={<MapPin className="w-3.5 h-3.5" />} label="Endereço" value={address} />
          ) : null}
        </dl>

        {(booking.your_team_name || booking.opponent_team_name) && (
          <div className="mt-4 text-xs text-white/50 border-t border-white/10 pt-3">
            <span className="font-heading uppercase text-white/80 tracking-wide">
              {booking.your_team_name || "Time A"}
            </span>
            <span className="text-[var(--brand)] mx-2">×</span>
            <span className="font-heading uppercase text-white/80 tracking-wide">
              {booking.opponent_team_name || "Time B"}
            </span>
          </div>
        )}

        {/* Actions — hidden on print */}
        <div className="booking-receipt-actions no-print mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid={`${testIdPrefix}-copy`}
            onClick={onCopy}
            disabled={!!busy}
            className="btn-ghost !py-2 !px-3 !text-xs justify-center min-h-[40px]"
          >
            {busy === "copy" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
              copied ? <Check className="w-3.5 h-3.5 text-[var(--success)]" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copiado!" : "Copiar texto"}
          </button>

          {canShare && (
            <button
              type="button"
              data-testid={`${testIdPrefix}-share`}
              onClick={onShare}
              disabled={!!busy}
              className="btn-ghost !py-2 !px-3 !text-xs justify-center min-h-[40px]"
            >
              {busy === "share" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
              Compartilhar
            </button>
          )}

          <a
            data-testid={`${testIdPrefix}-whatsapp`}
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost !py-2 !px-3 !text-xs justify-center min-h-[40px] inline-flex items-center gap-2 text-[#25D366] border-[#25D366]/40 hover:bg-[#25D366]/10"
          >
            <MessageCircle className="w-3.5 h-3.5" /> Abrir WhatsApp
          </a>

          <button
            type="button"
            data-testid={`${testIdPrefix}-print`}
            onClick={onPrint}
            className="btn-neon !py-2 !px-3 !text-xs justify-center min-h-[40px]"
          >
            <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({ icon, label, value, accent }) {
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="mt-0.5 text-[var(--brand)] shrink-0" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-[0.28em] text-white/40">{label}</dt>
        <dd className={`mt-0.5 break-words ${accent ? "font-heading text-xl text-[var(--brand)]" : "text-white/90"}`}>
          {value}
        </dd>
      </div>
    </div>
  );
}
