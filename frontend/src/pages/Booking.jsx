import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import PageShell from "@/components/PageShell";
import { BOOKING } from "@/constants/testIds";
import api, { formatApiErrorDetail } from "@/lib/api";
import { maskCPF, validateCPF, maskPhoneBR, onlyDigits } from "@/lib/cpf";
import {
  whatsappUrl,
  defaultWhatsAppPrefill,
  COURT_LOCATION,
  priceLabel,
  priceForDate,
  isOpenDay,
  OPEN_DAY_LABELS,
  mapsUrlReady,
} from "@/lib/siteConfig";
import { useSiteSettings } from "@/lib/SiteSettings";
import { pixPipelineLabel } from "@/lib/paymentStatus";
import { useMotionSystem, easings } from "@/lib/motion";
import VictoryBurst from "@/components/motion/VictoryBurst";
import Particles from "@/components/motion/Particles";
import {
  Calendar as CalendarIcon, Clock, X, Check, Loader2, QrCode, Copy,
  ChevronRight, Upload, IdCard, Phone, User, Image as ImageIcon,
  FileCheck, MapPin, Banknote, MessageCircle, ShieldCheck, Crosshair,
} from "lucide-react";

function todayISO() {
  // Local calendar date (browser TZ). Avoid toISOString() which shifts UTC and can
  // pick the wrong day near midnight for some offsets.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtBRL(n) { return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

const EMOJI_CRESTS = ["⚽","🔥","⚡","🐯","🐺","🦁","🦅","🐲","🦊","🐂","🐍","🦈"];

const FLOW_STEPS = [
  { id: "date", label: "Data" },
  { id: "slot", label: "Horário" },
  { id: "dados", label: "Dados" },
  { id: "review", label: "Revisão" },
  { id: "confirm", label: "Confirmar" },
];

function isSlotAvailable(slot) {
  if (!slot) return false;
  return slot.status === "available" || slot.status === "free";
}
function isSlotReserved(slot) {
  return slot?.status === "reserved" || slot?.status === "occupied";
}
function isSlotUnavailable(slot) {
  return slot?.status === "unavailable" || slot?.status === "blocked";
}
function slotLabel(slot, isPicked) {
  if (isPicked) return "Selecionado";
  if (isSlotAvailable(slot)) return "Disponível";
  if (isSlotReserved(slot)) return "Reservado";
  return "Indisponível";
}

function flowIndex(step, hasCourt, hasDate, hasSlot) {
  if (step === "pix" || step === "awaiting" || step === "done") return 4;
  if (step === "review" || step === "matchmaking") return 3;
  if (step === "identify") return 2;
  if (hasSlot) return 1;
  if (hasDate) return 0;
  return 0;
}

export default function Booking() {
  const { settings, priceLabel: livePriceLabel, waReady, waHref: ctxWa } = useSiteSettings();

  const navigate = useNavigate();
  const [waStatus, setWaStatus] = useState(null); // CONECTADO | AGUARDANDO_QR | DESCONECTADO | ...
  const [courts, setCourts] = useState([]);
  const [courtsError, setCourtsError] = useState("");
  const [selectedCourt, setSelectedCourt] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [availError, setAvailError] = useState("");

  const [pickedSlot, setPickedSlot] = useState(null);
  // step: idle | identify | matchmaking | pix | awaiting | done
  const [step, setStep] = useState("idle");

  const [cpf, setCpf] = useState("");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  const [yourTeam, setYourTeam] = useState("");
  const [oppTeam, setOppTeam] = useState("");
  const [yourCrest, setYourCrest] = useState("⚽");
  const [oppCrest, setOppCrest] = useState("🔥");
  const [uploadingCrest, setUploadingCrest] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [booking, setBooking] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/courts")
      .then(({ data }) => {
        setCourts(data);
        setSelectedCourt(data[0] || null);
        setCourtsError("");
      })
      .catch((e) => {
        setCourtsError(formatApiErrorDetail(e.response?.data?.detail) || "Não foi possível carregar as quadras.");
      });
  }, []);

  // Public health exposes WhatsApp status (no secrets) — used for success copy.
  useEffect(() => {
    if (step !== "pix" && step !== "awaiting") return;
    let cancelled = false;
    api.get("/health")
      .then(({ data }) => {
        if (!cancelled) setWaStatus(data?.whatsapp || "DESCONECTADO");
      })
      .catch(() => {
        if (!cancelled) setWaStatus("DESCONECTADO");
      });
    return () => { cancelled = true; };
  }, [step]);

  useEffect(() => {
    if (!selectedCourt) return;
    setLoading(true);
    setAvailError("");
    api.get("/courts/availability", { params: { court_id: selectedCourt.id, date } })
      .then(({ data }) => setAvailability(data))
      .catch((e) => {
        setAvailability(null);
        setAvailError(formatApiErrorDetail(e.response?.data?.detail) || "Erro ao buscar horários.");
      })
      .finally(() => setLoading(false));
  }, [selectedCourt, date]);

  const pickSlot = (slot) => {
    if (!isSlotAvailable(slot)) return;
    setPickedSlot(slot);
    setStep("identify");
    setErr("");
  };

  const onIdentifyContinue = (e) => {
    e?.preventDefault();
    setErr("");
    if (!validateCPF(cpf)) { setErr("CPF inválido."); return; }
    if (name.trim().length < 2) { setErr("Informe seu nome completo."); return; }
    if (onlyDigits(whatsapp).length < 10) { setErr("Informe um WhatsApp válido (com DDD)."); return; }
    setStep("review");
  };

  const handleCrestUpload = async (side, file) => {
    if (!file) return;
    setUploadingCrest(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/crest", fd, { headers: { "Content-Type": "multipart/form-data" }});
      const url = `${process.env.REACT_APP_BACKEND_URL}${data.url}`;
      if (side === "home") setYourCrest(url); else setOppCrest(url);
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setUploadingCrest(false);
    }
  };

  const confirmReservation = async () => {
    setErr("");
    setConfirming(true);
    try {
      const { data } = await api.post("/bookings", {
        court_id: selectedCourt.id,
        date,
        start_time: pickedSlot.time,
        duration_minutes: settings?.slot_duration_minutes || 60,
        cpf,
        customer_name: name.trim(),
        whatsapp,
        your_team_name: yourTeam || "Seu Time",
        opponent_team_name: oppTeam || "Adversário",
        your_team_crest: yourCrest,
        opponent_team_crest: oppCrest,
      });
      setBooking(data);
      setStep("pix");
      const { data: av } = await api.get("/courts/availability", { params: { court_id: selectedCourt.id, date } });
      setAvailability(av);
    } catch (e) {
      const detail = formatApiErrorDetail(e.response?.data?.detail) || e.message;
      if (e.response?.status === 409) {
        setErr("Este horário acabou de ser reservado. Escolha outro.");
        setStep("idle");
        setPickedSlot(null);
        try {
          const { data: av } = await api.get("/courts/availability", { params: { court_id: selectedCourt.id, date } });
          setAvailability(av);
        } catch (_) {}
      } else {
        setErr(detail);
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleComprovanteUpload = async (file) => {
    if (!file || !booking) return;
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(`/bookings/${booking.id}/comprovante`, fd, { headers: { "Content-Type": "multipart/form-data" }});
      setBooking(data);
      setStep("awaiting");
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  const closeAll = () => {
    setStep("idle"); setPickedSlot(null); setBooking(null); setErr("");
    setCpf(""); setName(""); setWhatsapp("");
    setYourTeam(""); setOppTeam(""); setYourCrest("⚽"); setOppCrest("🔥");
  };

  const effectiveHourly = (() => {
    const fromAvail = availability?.settings?.effective_price_per_hour;
    if (fromAvail != null && Number(fromAvail) > 0) return Number(fromAvail);
    const slotPrice = pickedSlot?.price;
    if (slotPrice != null && Number(slotPrice) > 0) return Number(slotPrice);
    if (availability?.court?.price_per_hour != null) return Number(availability.court.price_per_hour);
    return priceForDate(settings, date) || Number(settings?.price_per_hour) || 0;
  })();
  const courtPriceLabel = priceLabel(effectiveHourly) || livePriceLabel || priceLabel(settings?.price_per_hour);

  const activeFlow = flowIndex(step, !!selectedCourt, !!date, !!pickedSlot);
  const dayOpen = isOpenDay(date, settings);
  const freeSlots = dayOpen
    ? (availability?.slots?.filter((s) => isSlotAvailable(s))?.length ?? null)
    : 0;
  const waHref = waReady
    ? (ctxWa || whatsappUrl(defaultWhatsAppPrefill(), settings?.whatsapp_e164))
    : null;
  const m = useMotionSystem();

  return (
    <PageShell>
      <div data-testid={BOOKING.page} className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-10 md:py-12">
        <div className="diagonal-stripe pb-6 mb-6 relative">
          <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2 flex items-center gap-2">
            <Crosshair className="w-3.5 h-3.5" /> // Matchmaking · Mission HUD
          </div>
          <motion.h1
            {...m.fadeUp(0)}
            className="font-heading text-5xl md:text-7xl uppercase italic leading-[0.9]"
          >
            Reservar <span className="text-[var(--brand)]">Quadra</span>
          </motion.h1>
          <motion.p {...m.fadeUp(0.1)} className="text-white/60 mt-2 max-w-2xl">
            Fluxo mobile-first: data → horário → dados → revisão → confirmar. Uma quadra · sem cadastro (CPF + WhatsApp).
          </motion.p>
        </div>

        {/* Mission progress HUD */}
        <nav aria-label="Etapas da reserva" className="mission-hud mb-6">
          <div className="mission-hud-track" aria-hidden>
            <motion.div
              className="mission-hud-fill"
              initial={false}
              animate={{ width: `${(activeFlow / (FLOW_STEPS.length - 1)) * 100}%` }}
              transition={m.reduce ? { duration: 0.01 } : { duration: 0.45, ease: easings.outExpo }}
            />
          </div>
          <div className="booking-step-rail relative z-[1]">
            {FLOW_STEPS.map((s, i) => (
              <React.Fragment key={s.id}>
                <motion.div
                  layout
                  className={`booking-step-chip ${
                    i === activeFlow ? "is-active" : i < activeFlow ? "is-done" : "is-locked"
                  }`}
                  animate={
                    i === activeFlow && !m.reduce
                      ? { boxShadow: ["0 0 12px rgba(0,229,255,0.2)", "0 0 22px rgba(0,229,255,0.45)", "0 0 12px rgba(0,229,255,0.2)"] }
                      : undefined
                  }
                  transition={i === activeFlow && !m.reduce ? { duration: 2.2, repeat: Infinity } : undefined}
                >
                  <span className="booking-step-num">
                    {i < activeFlow ? <Check className="w-3 h-3" /> : i + 1}
                  </span>
                  {s.label}
                </motion.div>
                {i < FLOW_STEPS.length - 1 && (
                  <ChevronRight className="w-3.5 h-3.5 text-white/25 hidden sm:block" aria-hidden />
                )}
              </React.Fragment>
            ))}
          </div>
        </nav>

        {/* Trust signals */}
        <div className="trust-strip mb-8">
          <span className="trust-pill"><Banknote className="w-3.5 h-3.5 text-[var(--brand)]" /> <strong>{courtPriceLabel}</strong></span>
          <span className="trust-pill"><MapPin className="w-3.5 h-3.5 text-[var(--brand)]" /> {COURT_LOCATION}</span>
          <span className="trust-pill"><ShieldCheck className="w-3.5 h-3.5 text-[var(--success)]" /> Confirmação via WhatsApp</span>
          {waReady && waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="trust-pill hover:border-[#25D366]/50 hover:text-[#25D366] transition-colors">
              <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" /> FALAR NO WHATSAPP
            </a>
          )}
        </div>

        {/* Primary CTAs */}
        <div className="flex flex-wrap gap-3 mb-6">
          <a href="#booking-slots" className="btn-neon" data-testid="booking-cta-reservar">
            RESERVAR HORÁRIO <ChevronRight className="w-5 h-5" />
          </a>
          {waReady && waHref && (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-ghost !border-[#25D366]/40 hover:!border-[#25D366] hover:!text-[#25D366]" data-testid="booking-cta-whatsapp">
              <MessageCircle className="w-4 h-4 text-[#25D366]" /> FALAR NO WHATSAPP
            </a>
          )}
        </div>

        {/* Single court banner */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[11px] tracking-[0.3em] uppercase text-[var(--brand)]">Quadra oficial</div>
        </div>
        {courtsError && (
          <div className="mb-4 px-4 py-3 text-sm border-l-2 border-[var(--danger)] bg-[var(--danger)]/10">{courtsError}</div>
        )}
        {!courtsError && courts.length === 0 && (
          <div className="glass state-panel mb-8">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--brand)] mb-2" />
            <div>Carregando quadras…</div>
          </div>
        )}
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 mb-10">
          {courts.map((c, idx) => (
            <motion.button
              key={c.id}
              type="button"
              data-testid={BOOKING.courtCard(c.id)}
              onClick={() => { setSelectedCourt(c); setPickedSlot(null); }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              whileHover={m.reduce ? undefined : { y: -4, scale: 1.01 }}
              whileTap={m.reduce ? undefined : { scale: 0.985 }}
              className={`relative text-left p-5 border transition-all overflow-hidden court-select ${
                selectedCourt?.id === c.id
                  ? "border-[var(--brand)] bg-[var(--brand)]/10 glow-brand is-selected"
                  : "border-white/10 bg-white/[0.02] hover:border-white/30"
              }`}
            >
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20" style={{ background: c.color }} />
              <div className="text-[10px] uppercase tracking-[0.35em] text-white/40">// {c.type}</div>
              <div className="font-heading text-3xl uppercase mt-1">{c.name}</div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-xs text-white/50">A partir de</div>
                  <div className="font-heading text-2xl text-[var(--brand)]">{fmtBRL(effectiveHourly || c.price_per_hour)}<span className="text-sm text-white/50">/hora</span></div>
                  {settings?.price_weekend != null && Number(settings.price_weekend) > 0 && (
                    <div className="text-[10px] text-white/45 mt-0.5">Sáb/dom {fmtBRL(Number(settings.price_weekend))}/h · semana {fmtBRL(c.price_per_hour)}/h</div>
                  )}
                </div>
                {selectedCourt?.id === c.id && (
                  <div className="text-[var(--brand)] font-display tracking-[0.3em] uppercase text-xs flex items-center gap-1">
                    Selecionada <Check className="w-3 h-3" />
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>

        {/* Date + Slots */}
        <div className="grid md:grid-cols-[280px_1fr] gap-4 md:gap-6">
          <div className="glass p-5 h-fit order-1">
            <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--brand)] mb-2 flex items-center gap-2">
              <CalendarIcon className="w-3 h-3" /> 2 · Data da Partida
            </div>
            <input
              data-testid={BOOKING.datePicker}
              type="date" min={todayISO()} value={date}
              onChange={(e) => {
                const next = e.target.value;
                setDate(next);
                setPickedSlot(null);
                setStep("idle");
              }}
              className={`w-full bg-black/40 border px-3 py-3 text-white focus:outline-none font-display text-base ${
                dayOpen ? "border-white/15 focus:border-[var(--brand)]" : "border-[var(--warning)]/50 opacity-80"
              }`}
            />
            {!dayOpen && (
              <div
                className="mt-3 px-3 py-2 text-xs border-l-2 border-[var(--warning)] bg-[var(--warning)]/10 text-white/80"
                data-testid="booking-day-closed"
                role="status"
              >
                Quadra fechada neste dia da semana. Escolha{" "}
                {(settings?.open_days || [0,1,2,3,4,5,6])
                  .map((n) => OPEN_DAY_LABELS.find((d) => d.value === Number(n))?.short)
                  .filter(Boolean)
                  .join(", ") || "outro dia"}.
              </div>
            )}
            <div className="mt-6 text-xs text-white/50 leading-relaxed space-y-1.5">
              <div className="flex items-center gap-2"><span className="w-3 h-3 inline-block border-l-4 border-[var(--success)]" /> Disponível</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 inline-block border-l-4 border-[var(--warning)]" /> Reservado</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 inline-block border-l-4 border-white/30" /> Indisponível</div>
              <div className="mt-4 pt-3 border-t border-white/10 space-y-1">
                <div>Calção PIX = 30% · restante na quadra.</div>
                <div>Após pagar: envie comprovante → admin confirma → WhatsApp.</div>
                <div>1 horário = 1 hora na Quadra Pedra Azul.</div>
              </div>
            </div>
          </div>

          <div id="booking-slots" className="glass p-4 sm:p-5 order-2 scroll-mt-24">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--brand)] flex items-center gap-2">
                <Clock className="w-3 h-3" /> 3 · Horários ·{" "}
                {new Date(date+"T00:00:00").toLocaleDateString("pt-BR", {weekday:"long", day:"2-digit", month:"long"})}
              </div>
              <div className="flex items-center gap-3 text-xs text-white/45">
                {freeSlots != null && !loading && (
                  <span>{freeSlots} livre{freeSlots === 1 ? "" : "s"}</span>
                )}
                {loading && <Loader2 className="w-4 h-4 animate-spin text-[var(--brand)]" />}
              </div>
            </div>

            {availError && (
              <div className="px-4 py-3 text-sm border-l-2 border-[var(--danger)] bg-[var(--danger)]/10 mb-3">{availError}</div>
            )}

            {loading && !availability && (
              <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3" aria-busy="true" aria-label="Carregando horários">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="skeleton-slot h-[72px] sm:h-[80px]" />
                ))}
              </div>
            )}

            {!loading && !availError && !availability && (
              <div className="state-panel">
                <Clock className="w-8 h-8 text-white/30 mb-3" />
                <div className="font-heading text-2xl uppercase text-white/70">Escolha uma data</div>
                <p className="text-sm mt-2 max-w-sm">Os horários da Quadra Pedra Azul aparecem aqui. Uma quadra · slots de 1 hora.</p>
              </div>
            )}

            {!loading && !dayOpen && (
              <div className="state-panel" data-testid="booking-closed-weekday">
                <CalendarIcon className="w-8 h-8 text-white/30 mb-3" />
                <div className="font-heading text-2xl uppercase text-white/70">Dia fechado</div>
                <p className="text-sm mt-2 max-w-sm">
                  A quadra não abre neste dia da semana. Selecione um dia marcado como aberto nas configurações.
                </p>
              </div>
            )}

            {!loading && dayOpen && availability?.slots?.length === 0 && (
              <div className="state-panel">
                <Clock className="w-8 h-8 text-white/30 mb-3" />
                <div className="font-heading text-2xl uppercase text-white/70">Nenhum horário neste dia</div>
                <p className="text-sm mt-2 max-w-sm">
                  {waReady
                    ? "Tente outra data ou fale conosco no WhatsApp para encaixes especiais."
                    : "Tente outra data ou reserve em um dia com horários livres."}
                </p>
                {waReady && waHref && (
                  <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-ghost !py-2 !px-4 !text-sm mt-4">
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                  </a>
                )}
              </div>
            )}

            {!loading && dayOpen && availability?.slots?.length > 0 && freeSlots === 0 && (
              <div className="state-panel mb-4 !min-h-0 py-6">
                <div className="font-heading text-xl uppercase text-[var(--warning)]">Lotado neste dia</div>
                <p className="text-sm mt-1">Todos os horários estão ocupados. Escolha outra data.</p>
              </div>
            )}

            {dayOpen && (
            <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
              <AnimatePresence mode="popLayout">
                {availability?.slots?.map((s, idx) => {
                  const isFree = isSlotAvailable(s);
                  const isReserved = isSlotReserved(s);
                  const isUnavail = isSlotUnavailable(s);
                  const isPicked = pickedSlot?.time === s.time;
                  return (
                  <motion.button
                    key={s.time}
                    type="button"
                    layout
                    data-testid={BOOKING.slot(s.time)}
                    disabled={!isFree}
                    aria-disabled={!isFree}
                    initial={m.reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={m.reduce ? { duration: 0.01 } : { delay: Math.min(idx * 0.03, 0.35), duration: 0.35, ease: easings.outExpo }}
                    whileHover={isFree && !m.reduce ? { x: 4, scale: 1.015 } : {}}
                    whileTap={isFree && !m.reduce ? { scale: 0.98 } : {}}
                    onClick={() => pickSlot(s)}
                    className={`slot-match relative flex items-center justify-between px-4 py-3.5 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left min-h-[72px] ${
                      isFree ? "slot-free" : isReserved ? "slot-reserved slot-locked" : "slot-unavailable slot-locked"
                    } ${isPicked ? "slot-selected" : ""}`}
                  >
                    {isPicked && !m.reduce && (
                      <motion.span
                        layoutId="slot-select-glow"
                        className="absolute inset-0 pointer-events-none slot-selected-glow"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      />
                    )}
                    <div className="relative z-[1]">
                      <div className="font-heading text-2xl uppercase leading-none">{s.time}</div>
                      <div className={`text-[10px] uppercase tracking-[0.3em] mt-1 ${
                        isPicked ? "text-[var(--brand)]" : isReserved ? "text-[var(--warning)]" : isUnavail ? "text-white/35" : "text-white/40"
                      }`}>
                        {slotLabel(s, isPicked)}
                      </div>
                    </div>
                    <div className="text-right relative z-[1]">
                      <div className="font-display text-[var(--brand)] text-lg">{fmtBRL(s.price)}</div>
                      <div className="text-[10px] text-white/40 uppercase tracking-[0.3em]">60min</div>
                    </div>
                  </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* ====== MODALS ====== */}
      <AnimatePresence>
        {step === "identify" && (
          <Overlay onClose={closeAll}>
            <motion.form
              onSubmit={onIdentifyContinue}
              data-testid={BOOKING.identifyModal}
              {...m.modalMotion}
              className="relative glass-strong booking-modal-sheet w-[min(640px,95vw)] p-5 sm:p-8 md:p-10 max-h-[92vh] overflow-y-auto"
            >
              <CloseBtn onClick={closeAll} />
              <StepBar current={1} />
              <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mt-2">// 4 · Identificação</div>
              <h2 className="font-heading text-3xl sm:text-4xl uppercase italic">Quase lá, <span className="text-[var(--brand)]">jogador</span></h2>
              <p className="text-white/60 mt-1 text-sm">
                {selectedCourt?.name} · {new Date(date+"T00:00:00").toLocaleDateString("pt-BR")} · {pickedSlot?.time}
              </p>

              <div className="mt-6 space-y-4">
                <FormField icon={<IdCard className="w-4 h-4" />} label="CPF">
                  <input
                    data-testid={BOOKING.cpfInput}
                    value={cpf}
                    onChange={(e) => setCpf(maskCPF(e.target.value))}
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    className="bg-transparent w-full focus:outline-none text-white placeholder-white/30"
                    autoFocus
                  />
                </FormField>
                <FormField icon={<User className="w-4 h-4" />} label="Nome completo">
                  <input
                    data-testid={BOOKING.nameInput}
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome"
                    className="bg-transparent w-full focus:outline-none text-white placeholder-white/30"
                  />
                </FormField>
                <FormField icon={<Phone className="w-4 h-4" />} label="WhatsApp (DDD + número)">
                  <input
                    data-testid={BOOKING.whatsappInput}
                    value={whatsapp} onChange={(e) => setWhatsapp(maskPhoneBR(e.target.value))}
                    placeholder="(11) 99999-9999"
                    inputMode="tel"
                    className="bg-transparent w-full focus:outline-none text-white placeholder-white/30"
                  />
                </FormField>
              </div>

              {err && <div data-testid={BOOKING.identifyError} className="mt-4 px-4 py-3 text-sm border-l-2 border-[var(--danger)] bg-[var(--danger)]/10">{err}</div>}

              <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-white/40">Você receberá a confirmação no WhatsApp.</div>
                <button data-testid={BOOKING.identifyContinue} type="submit" className="btn-neon w-full sm:w-auto justify-center">
                  Continuar <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </motion.form>
          </Overlay>
        )}

        {(step === "review" || step === "matchmaking") && (
          <Overlay onClose={closeAll}>
            <motion.div
              data-testid={BOOKING.matchmakingModal}
              {...m.modalMotion}
              className="relative glass-strong booking-modal-sheet w-[min(960px,95vw)] p-5 sm:p-8 md:p-10 max-h-[92vh] overflow-y-auto"
            >
              <CloseBtn onClick={closeAll} />
              <StepBar current={2} />
              <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mt-2">// 4 · Revisão</div>
              <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl uppercase italic">
                Revise e <span className="text-[var(--brand)]">confirme</span>
              </h2>
              <div className="mt-3 glass px-4 py-3 text-sm text-white/70">
                <strong className="text-white">{name}</strong> · CPF {cpf} · WhatsApp {whatsapp}<br />
                {selectedCourt?.name} · {new Date(date+"T00:00:00").toLocaleDateString("pt-BR")} · {pickedSlot?.time}
              </div>
              <p className="text-white/60 mt-1 text-sm">
                {selectedCourt?.name} · {new Date(date+"T00:00:00").toLocaleDateString("pt-BR")} · {pickedSlot?.time}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4 md:gap-6 mt-8">
                <TeamCard side="home" name={yourTeam} onName={setYourTeam} crest={yourCrest} onCrest={setYourCrest}
                  nameTestId={BOOKING.yourTeamInput} uploadTestId={BOOKING.uploadYourCrest}
                  onFile={(f) => handleCrestUpload("home", f)} uploading={uploadingCrest} />
                <div className="text-center font-heading text-5xl md:text-7xl italic text-[var(--brand)] text-glow-strong py-2">VS</div>
                <TeamCard side="away" name={oppTeam} onName={setOppTeam} crest={oppCrest} onCrest={setOppCrest}
                  nameTestId={BOOKING.opponentTeamInput} uploadTestId={BOOKING.uploadOpponentCrest}
                  onFile={(f) => handleCrestUpload("away", f)} uploading={uploadingCrest} />
              </div>

              {err && <div className="mt-4 text-sm text-[var(--danger)]">{err}</div>}

              <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 glass p-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">Total · Calção (30%)</div>
                  <div className="font-heading text-2xl sm:text-3xl">{fmtBRL(effectiveHourly || 0)} · <span className="text-[var(--brand)]">{fmtBRL((effectiveHourly || 0) * 0.3)}</span></div>
                </div>
                <button
                  data-testid={BOOKING.confirmReservation}
                  onClick={confirmReservation}
                  disabled={confirming}
                  className="btn-neon justify-center"
                >
                  {confirming ? <Loader2 className="w-5 h-5 animate-spin" /> : <>RESERVAR HORÁRIO <ChevronRight className="w-5 h-5" /></>}
                </button>
              </div>
            </motion.div>
          </Overlay>
        )}

        {step === "pix" && booking && (
          <Overlay onClose={closeAll}>
            <motion.div
              data-testid={BOOKING.pixModal}
              {...m.modalMotion}
              className="relative glass-strong booking-modal-sheet w-[min(780px,95vw)] p-5 sm:p-8 md:p-10 max-h-[92vh] overflow-y-auto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pix-title"
            >
              <CloseBtn onClick={closeAll} />
              <StepBar current={3} />
              <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mt-2">// 5 · Pagamento PIX</div>
              <h2 id="pix-title" className="font-heading text-3xl sm:text-4xl uppercase italic">Calção via <span className="text-[var(--brand)]">PIX</span></h2>
              <div className="mt-3 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] px-2.5 py-1.5 border border-[var(--warning)]/50 text-[var(--warning)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse" aria-hidden />
                Status: {pixPipelineLabel(booking)} · aguardando pagamento
              </div>
              <p className="mt-3 text-sm text-white/65 max-w-xl">
                Pague o <strong className="text-white">calção de 30%</strong> via PIX (copia-e-cola abaixo). Depois envie o <strong className="text-white">comprovante em imagem</strong>.
                Só o admin confirma — mensagem de texto sozinha <em>não</em> libera a quadra.
              </p>
              {waStatus && waStatus !== "CONECTADO" && (
                <div
                  data-testid="booking-wa-pending-notice"
                  className="mt-4 text-left text-sm border border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)] px-3 py-2.5"
                  role="status"
                >
                  <strong className="text-white">Confirmação manual / WhatsApp pendente.</strong>{" "}
                  O bot está <span className="uppercase tracking-wide">{waStatus}</span> — sua reserva já está salva;
                  a mensagem automática pode atrasar até o admin conectar o WhatsApp. Acompanhe também em Minhas reservas.
                </div>
              )}

              <div className="grid md:grid-cols-[200px_1fr] gap-6 md:gap-8 mt-6 items-start">
                <div className="w-[160px] h-[160px] sm:w-[200px] sm:h-[200px] mx-auto md:mx-0 glass grid place-items-center relative" aria-label="QR Code PIX simulado">
                  <QrCode className="w-28 h-28 sm:w-32 sm:h-32 text-[var(--brand)]" strokeWidth={1} aria-hidden />
                  <div className="absolute inset-4 border border-[var(--brand)]/30" aria-hidden />
                  <div className="absolute top-2 right-2 text-[8px] uppercase tracking-[0.3em] text-[var(--brand)]">MOCK</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">Valor do calção (30%)</div>
                  <div className="font-heading text-4xl sm:text-5xl text-[var(--brand)]">{fmtBRL(booking.deposit)}</div>
                  <div className="text-xs text-white/50 mt-1">Restante na quadra · {courtPriceLabel}</div>
                  {booking.payment?.expires_at && (
                    <div className="text-xs text-white/45 mt-2">
                      PIX válido até {new Date(booking.payment.expires_at).toLocaleString("pt-BR")} — após isso a reserva expira.
                    </div>
                  )}

                  <PixCopyPaste value={booking.payment.pix_copy_paste} />

                  <div className="mt-6 border-t border-white/10 pt-5">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--brand)] flex items-center gap-2">
                      <Upload className="w-3 h-3" /> Após pagar, envie o comprovante
                    </div>
                    <p className="text-white/60 text-xs mt-1">
                      Envie a imagem/print do PIX. A confirmação é <strong className="text-white">manual pelo admin</strong> — não confirmamos só por mensagem de texto.
                    </p>
                    <FileUploadButton
                      testId={BOOKING.uploadComprovante}
                      inputTestId={BOOKING.comprovanteFileInput}
                      onFile={handleComprovanteUpload}
                      label="Enviar Comprovante PIX"
                    />
                  </div>
                </div>
              </div>
              {err && <div className="mt-4 text-sm text-[var(--danger)]" role="alert">{err}</div>}
              <div className="text-[10px] text-white/30 mt-4 uppercase tracking-[0.25em]">
                * PIX simulado para demonstração. Fluxo: aguardando → informado (comprovante) → confirmado (admin) · ou cancelado / expirado.
              </div>
            </motion.div>
          </Overlay>
        )}

        {step === "awaiting" && booking && (
          <Overlay onClose={closeAll}>
            <motion.div
              {...m.modalMotion}
              className="relative glass-strong booking-modal-sheet w-[min(620px,95vw)] p-6 sm:p-10 text-center overflow-hidden victory-panel max-h-[92vh] overflow-y-auto"
            >
              <VictoryBurst />
              <Particles count={12} seed={42} className="opacity-70" />
              <CloseBtn onClick={closeAll} />
              <motion.div
                initial={m.reduce ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={m.reduce ? { duration: 0.01 } : { type: "spring", stiffness: 380, damping: 22 }}
                className="relative z-[1] w-20 h-20 mx-auto rounded-full bg-[var(--success)]/15 grid place-items-center pulse-ring border border-[var(--success)]/30"
              >
                <Check className="w-10 h-10 text-[var(--success)]" strokeWidth={2.5} />
              </motion.div>
              <motion.div
                initial={m.reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: m.reduce ? 0 : 0.15 }}
                className="relative z-[1]"
              >
                <div className="text-[10px] tracking-[0.4em] uppercase text-[var(--success)] mt-5">
                  Missão enviada
                </div>
                <h2 className="font-heading text-3xl sm:text-4xl uppercase italic mt-2">
                  Comprovante <span className="text-[var(--success)]">informado</span>
                </h2>
                <p className="text-white/70 mt-3">
                  Status: <strong className="text-white">Informado</strong>. A equipe valida o comprovante e só então marca como <strong className="text-white">Confirmado</strong>. Você receberá{" "}
                  <span className="text-[var(--brand)]">WhatsApp</span> na confirmação.
                </p>
                {waStatus && waStatus !== "CONECTADO" && (
                  <div
                    data-testid="booking-wa-pending-notice"
                    className="mt-4 text-sm border border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)] px-3 py-2.5 text-left"
                    role="status"
                  >
                    <strong className="text-white">Confirmação manual / WhatsApp pendente.</strong>{" "}
                    Canal WhatsApp: <span className="uppercase tracking-wide">{waStatus}</span>.
                    Reserva e comprovante já registrados — a confirmação segue manual pelo admin até o bot reconectar.
                  </div>
                )}
                <div className="mt-4 text-sm text-white/50 glass inline-block px-4 py-2">
                  {booking.your_team_name} <span className="text-[var(--brand)]">×</span> {booking.opponent_team_name} · {booking.court_name} · {booking.start_time}
                </div>
                <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
                  <button data-testid={BOOKING.pixCloseSuccess} onClick={closeAll} className="btn-ghost justify-center">Fechar</button>
                  <button onClick={() => navigate(`/minhas-reservas?cpf=${encodeURIComponent(cpf)}`)} className="btn-neon justify-center">
                    Ver minhas reservas <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </Overlay>
        )}
      </AnimatePresence>
    </PageShell>
  );
}

function StepBar({ current }) {
  const labels = ["Dados", "Times", "PIX"];
  return (
    <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
      {[1,2,3].map((n) => (
        <div key={n} className="flex items-center gap-2">
          <div className={`w-7 h-7 grid place-items-center text-xs font-heading border ${
            n === current ? "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand)]/10"
            : n < current ? "border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10"
            : "border-white/15 text-white/40"
          }`}>
            {n < current ? <Check className="w-3 h-3" /> : n}
          </div>
          <span className={`text-[10px] uppercase tracking-[0.2em] hidden sm:inline ${
            n === current ? "text-[var(--brand)]" : "text-white/35"
          }`}>{labels[n-1]}</span>
          {n < 3 && <div className={`w-6 sm:w-10 h-px ${n < current ? "bg-[var(--success)]" : "bg-white/15"}`} />}
        </div>
      ))}
    </div>
  );
}

function FormField({ icon, label, children }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-[0.35em] uppercase text-white/40 mb-2">{label}</div>
      <div className="flex items-center gap-3 px-4 py-3 min-h-[48px] bg-black/40 border border-white/10 focus-within:border-[var(--brand)] transition-colors">
        <span className="text-[var(--brand)] shrink-0">{icon}</span>
        {children}
      </div>
    </label>
  );
}

function Overlay({ children, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full flex justify-center my-auto">{children}</div>
    </motion.div>
  );
}

function CloseBtn({ onClick }) {
  return (
    <button onClick={onClick}
      className="absolute top-3 right-3 w-11 h-11 grid place-items-center border border-white/10 hover:border-[var(--brand)] hover:text-[var(--brand)] text-white/70 transition-colors z-10"
      aria-label="Fechar">
      <X className="w-4 h-4" />
    </button>
  );
}

function CrestPreview({ crest }) {
  const isUrl = typeof crest === "string" && crest.startsWith("http");
  return (
    <div className="w-16 h-16 sm:w-20 sm:h-20 grid place-items-center border border-white/15 bg-black/40 overflow-hidden shrink-0">
      {isUrl ? <img src={crest} alt="" className="w-full h-full object-cover" /> : <span className="text-4xl sm:text-5xl">{crest}</span>}
    </div>
  );
}

function TeamCard({ side, name, onName, crest, onCrest, nameTestId, uploadTestId, onFile, uploading }) {
  const accent = side === "home" ? "var(--brand)" : "#FFB800";
  const fileRef = useRef(null);
  return (
    <div className="relative p-4 sm:p-5 border border-white/10 bg-white/[0.02]">
      <div className="text-[10px] uppercase tracking-[0.35em]" style={{ color: accent }}>// {side === "home" ? "Seu Time" : "Adversário"}</div>
      <div className="mt-3 flex items-center gap-3 sm:gap-4">
        <CrestPreview crest={crest} />
        <input
          data-testid={nameTestId}
          value={name} onChange={(e) => onName(e.target.value)} maxLength={30}
          placeholder={side === "home" ? "Nome do seu time" : "Nome do adversário"}
          className="bg-transparent border-b border-white/15 focus:border-[var(--brand)] focus:outline-none px-1 py-2 font-heading text-xl sm:text-2xl uppercase w-full min-w-0"
        />
      </div>
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-2">Escudo</div>
        <div className="flex flex-wrap gap-2">
          {EMOJI_CRESTS.map((c) => (
            <button key={c} type="button" onClick={() => onCrest(c)}
              className={`w-9 h-9 grid place-items-center text-xl border transition-all ${
                crest === c ? "border-[var(--brand)] bg-[var(--brand)]/15" : "border-white/10 hover:border-white/40"
              }`}>{c}</button>
          ))}
          <button
            type="button"
            data-testid={uploadTestId}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3 h-9 border border-dashed border-[var(--brand)]/50 text-[var(--brand)] hover:bg-[var(--brand)]/10 text-[10px] uppercase tracking-[0.2em] flex items-center gap-1"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
            Enviar imagem
          </button>
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
      </div>
    </div>
  );
}

function PixCopyPaste({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      setCopied(false);
    }
  };
  return (
    <div className="mt-5">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">PIX Copia-e-Cola</div>
      <div className="flex items-stretch mt-1">
        <input
          data-testid={BOOKING.pixCopy}
          readOnly
          value={value || ""}
          aria-label="Código PIX copia e cola"
          className="flex-1 bg-black/40 border border-white/10 px-3 py-2.5 text-xs text-white/70 focus:outline-none focus-visible:border-[var(--brand)] truncate min-w-0 min-h-[44px]"
        />
        <button
          onClick={copy}
          className="px-4 min-w-[44px] min-h-[44px] border border-l-0 border-white/10 hover:border-[var(--brand)] hover:text-[var(--brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)] transition-colors shrink-0"
          type="button"
          aria-label={copied ? "PIX copiado" : "Copiar código PIX"}
        >
          {copied ? <Check className="w-4 h-4 text-[var(--success)]" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
        </button>
      </div>
      <div className="sr-only" aria-live="polite">{copied ? "Código PIX copiado" : ""}</div>
      {copied && <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--success)] mt-1">Copiado!</div>}
    </div>
  );
}

function FileUploadButton({ testId, inputTestId, onFile, label }) {
  const ref = useRef(null);
  const [name, setName] = useState("");
  return (
    <div className="mt-4">
      <button
        type="button"
        data-testid={testId}
        onClick={() => ref.current?.click()}
        className="btn-neon w-full justify-center"
      >
        <Upload className="w-4 h-4" /> {label}
      </button>
      <input
        ref={ref} type="file" accept="image/*,application/pdf" className="hidden"
        data-testid={inputTestId}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); onFile(f); } }}
      />
      {name && (
        <div className="mt-2 text-xs text-white/60 flex items-center gap-2">
          <FileCheck className="w-3 h-3 text-[var(--success)]" /> {name}
        </div>
      )}
    </div>
  );
}
