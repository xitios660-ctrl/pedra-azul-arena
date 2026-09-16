import React, { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import PageShell from "@/components/PageShell";
import api, { formatApiErrorDetail } from "@/lib/api";
import { maskCPF, validateCPF, onlyDigits } from "@/lib/cpf";
import { MYB } from "@/constants/testIds";
import {
  whatsappUrl,
  defaultWhatsAppPrefill,
} from "@/lib/siteConfig";
import { useSiteSettings } from "@/lib/SiteSettings";
import {
  IdCard, Search, Calendar, Clock, CheckCircle2, XCircle, Hourglass, Upload,
  FileCheck, Loader2, MessageCircle, Ticket, RefreshCw,
} from "lucide-react";
import { pixBadgeFor } from "@/lib/paymentStatus";
import RescheduleModal from "@/components/RescheduleModal";

const STATUS_ICON = {
  pending: Hourglass,
  awaiting_admin: MessageCircle,
  confirmed: CheckCircle2,
  cancelled: XCircle,
  expired: XCircle,
};

function fmtBRL(n) { return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function MyBookings() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialCpf = params.get("cpf") || "";
  const [cpf, setCpf] = useState(maskCPF(initialCpf));
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const { waReady, waHref: ctxWa, settings } = useSiteSettings();
  const waHref = waReady
    ? (ctxWa || whatsappUrl(defaultWhatsAppPrefill(), settings.whatsapp_e164))
    : null;

  const doLookup = async (cpfValue) => {
    setErr(""); setLoading(true); setSearched(true);
    try {
      if (!validateCPF(cpfValue)) { setErr("CPF inválido"); setResult(null); return; }
      const { data } = await api.post("/bookings/lookup", { cpf: cpfValue });
      setResult(data);
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      setResult(null);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (initialCpf && validateCPF(initialCpf)) doLookup(initialCpf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell>
      <div data-testid={MYB.page} className="max-w-5xl mx-auto px-4 sm:px-6 md:px-10 py-10 md:py-12">
        <div className="diagonal-stripe pb-6 mb-8 md:mb-10">
          <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2">// Player Lookup</div>
          <h1 className="font-heading text-5xl md:text-7xl uppercase italic leading-[0.9]">
            Minhas <span className="text-[var(--brand)]">Reservas</span>
          </h1>
          <p className="text-white/60 mt-2">Sem login. Digite seu CPF para ver e gerenciar suas partidas.</p>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => { e.preventDefault(); doLookup(cpf); }}
          className="glass-strong p-5 sm:p-6 md:p-8"
        >
          <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end">
            <label className="block">
              <div className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2 flex items-center gap-2">
                <IdCard className="w-3 h-3 text-[var(--brand)]" /> CPF
              </div>
              <input
                data-testid={MYB.cpfLookupInput}
                value={cpf}
                onChange={(e) => setCpf(maskCPF(e.target.value))}
                placeholder="000.000.000-00"
                inputMode="numeric"
                className="w-full bg-black/40 border border-white/15 px-4 py-3 text-white text-lg font-display tracking-wider focus:border-[var(--brand)] focus:outline-none"
                autoFocus
              />
            </label>
            <button data-testid={MYB.cpfLookupSubmit} type="submit" className="btn-neon justify-center w-full md:w-auto" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4" /> Buscar</>}
            </button>
          </div>
          {err && (
            <div data-testid={MYB.lookupError} className="mt-4 px-4 py-3 text-sm border-l-2 border-[var(--danger)] bg-[var(--danger)]/10">
              {err}
            </div>
          )}
        </motion.form>

        {loading && (
          <div className="grid sm:grid-cols-2 gap-5 mt-8" aria-busy="true" aria-label="Buscando reservas">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton-card h-[220px]" />
            ))}
          </div>
        )}

        {!loading && searched && !result && !err && (
          <div className="glass state-panel mt-8">
            <Ticket className="w-8 h-8 text-white/30 mb-3" />
            <div className="font-heading text-2xl uppercase">Nada encontrado</div>
            <p className="text-sm text-white/55 mt-2 max-w-sm mx-auto">Confira o CPF ou faça uma nova reserva na Quadra Pedra Azul.</p>
            <button type="button" onClick={() => navigate("/booking")} className="btn-neon !py-2 !px-5 !text-sm mt-4">
              Reservar horário
            </button>
          </div>
        )}

        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-10"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">CPF · {result.cpf_masked}</div>
                <div className="font-heading text-3xl uppercase">{result.customer_name || "Sem reservas ainda"}</div>
              </div>
              <button onClick={() => navigate("/booking")} className="btn-ghost !py-2 !px-4 !text-sm justify-center">
                + Nova reserva
              </button>
            </div>

            {result.bookings.length === 0 ? (
              <div className="glass p-8 text-center text-white/60 mt-6">
                <Ticket className="w-10 h-10 mx-auto mb-3 text-white/25" />
                <div className="font-heading text-2xl uppercase text-white/80">Nenhuma reserva neste CPF</div>
                <p className="text-sm mt-2">
                  {waReady
                    ? "Faça sua primeira partida ou fale conosco no WhatsApp."
                    : "Faça sua primeira partida pela página de reservas."}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button onClick={() => navigate("/booking")} className="btn-neon !py-2 !px-5 !text-base">
                    Reservar agora
                  </button>
                  {waReady && waHref && (
                    <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-ghost !py-2 !px-4 !text-sm">
                      <MessageCircle className="w-4 h-4" /> Fale no WhatsApp
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-5 mt-6">
                {result.bookings.map((b, i) => (
                  <BookingCard key={b.id} b={b} cpf={cpf} idx={i} onChanged={() => doLookup(cpf)} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>
    </PageShell>
  );
}

function BookingCard({ b, cpf, idx, onChanged }) {
  const badge = pixBadgeFor(b);
  const Icon = STATUS_ICON[b.status] || STATUS_ICON.pending;
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [showReschedule, setShowReschedule] = useState(false);

  const uploadComprovante = async (file) => {
    if (!file) return;
    setUploading(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/bookings/${b.id}/comprovante`, fd, { headers: { "Content-Type": "multipart/form-data" }});
      onChanged();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setUploading(false); }
  };

  const cancel = async () => {
    if (!window.confirm("Cancelar esta reserva?")) return;
    try {
      await api.post(`/bookings/${b.id}/cancel`, null, { params: { cpf: onlyDigits(cpf) }});
      onChanged();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const isActive = ["pending", "awaiting_admin", "confirmed"].includes(b.status);

  const renderCrest = (c) => {
    const isUrl = typeof c === "string" && c.startsWith("http");
    return isUrl
      ? <img src={c} alt="" className="w-12 h-12 object-cover border border-white/15 mx-auto" />
      : <div className="text-3xl">{c}</div>;
  };

  return (
    <motion.div
      data-testid={MYB.bookingCard(b.id)}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}
      whileHover={{ y: -2 }}
      className="glass p-5 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl opacity-10" style={{ background: badge.color }} />
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.35em] text-white/40 truncate">// {b.court_name}</div>
        <span
          data-testid={`mybook-pix-badge-${b.id}`}
          data-pix-tone={badge.tone}
          className="text-[10px] uppercase tracking-[0.3em] px-2 py-1 border flex items-center gap-1 shrink-0"
          style={{ color: badge.color, borderColor: badge.color }}
          title={badge.hint}
        >
          <Icon className="w-3 h-3" /> {badge.label}
        </span>
      </div>
      <p className="text-[11px] text-white/45 mt-2" data-testid={`mybook-pix-hint-${b.id}`}>
        {badge.hint}
        {b.payment?.status ? ` · pagamento: ${b.payment.status}` : ""}
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mt-4">
        <div className="text-center">
          {renderCrest(b.your_team_crest)}
          <div className="font-heading uppercase mt-1 text-sm">{b.your_team_name}</div>
        </div>
        <div className="font-heading text-3xl text-[var(--brand)] italic">VS</div>
        <div className="text-center">
          {renderCrest(b.opponent_team_crest)}
          <div className="font-heading uppercase mt-1 text-sm">{b.opponent_team_name}</div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm text-white/70">
        <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-[var(--brand)]" /> {new Date(b.date+"T00:00:00").toLocaleDateString("pt-BR")}</div>
        <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-[var(--brand)]" /> {b.start_time}</div>
        <div className="font-heading text-[var(--brand)]">{fmtBRL(b.deposit)}</div>
      </div>

      {b.status === "pending" && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--brand)] flex items-center gap-2 mb-2">
            <Upload className="w-3 h-3" /> Envie o comprovante PIX
          </div>
          <button
            data-testid={MYB.uploadComprovante(b.id)}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-neon !py-2 !px-4 !text-sm w-full justify-center"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Upload className="w-4 h-4" /> Enviar Comprovante</>}
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => uploadComprovante(e.target.files?.[0])} />
        </div>
      )}

      {b.status === "awaiting_admin" && (
        <div className="mt-5 border-t border-white/10 pt-4 text-xs text-white/60 flex items-start gap-2">
          <FileCheck className="w-3 h-3 text-[var(--brand)] mt-0.5 shrink-0" />
          PIX informado — aguardando o admin validar o comprovante. Só depois fica Confirmado (WhatsApp).
        </div>
      )}
      {b.status === "confirmed" && (
        <div className="mt-5 border-t border-white/10 pt-4 text-xs text-white/60 flex items-start gap-2">
          <CheckCircle2 className="w-3 h-3 text-[var(--success)] mt-0.5 shrink-0" />
          PIX confirmado. Reserva ativa — chegue 10 min antes.
        </div>
      )}
      {b.status === "expired" && (
        <div className="mt-5 border-t border-white/10 pt-4 text-xs text-white/50 flex items-start gap-2">
          <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
          PIX expirado. Faça uma nova reserva se ainda precisar do horário.
        </div>
      )}

      {isActive && (
        <div className="mt-4 flex flex-wrap gap-3 items-center">
          <button
            data-testid={MYB.rescheduleBooking(b.id)}
            type="button"
            onClick={() => setShowReschedule(true)}
            className="text-xs text-[var(--brand)] hover:underline inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Reagendar
          </button>
          <button data-testid={MYB.cancelBooking(b.id)} onClick={cancel}
            className="text-xs text-white/40 hover:text-[var(--danger)] transition-colors">
            Cancelar reserva
          </button>
        </div>
      )}

      {err && <div className="mt-2 text-xs text-[var(--danger)]">{err}</div>}

      {showReschedule && (
        <RescheduleModal
          booking={b}
          cpf={cpf}
          mode="customer"
          onClose={() => setShowReschedule(false)}
          onDone={() => { setShowReschedule(false); onChanged(); }}
        />
      )}
    </motion.div>
  );
}
