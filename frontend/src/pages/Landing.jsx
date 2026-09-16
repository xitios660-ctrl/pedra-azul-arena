import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import PageShell from "@/components/PageShell";
import { HOME } from "@/constants/testIds";
import {
  ChevronRight, CalendarDays, Trophy, Ticket, Zap, Activity, Play,
  MessageCircle, MapPin, ShieldCheck, Banknote, Car, Clock, Sparkles, CloudRain, ScrollText,
} from "lucide-react";
import api from "@/lib/api";
import {
  whatsappUrl,
  defaultWhatsAppPrefill,
  COURT_LOCATION,
  BALEYS_VIDEO_SRC,
  BALEYS_POSTER_SRC,
  BALEYS_POSTER_FALLBACK,
  structureChips,
  gameDurationLabel,
  mapsUrlReady,
  policiesVisible,
  resolvePolicyCancel,
  resolvePolicyRain,
} from "@/lib/siteConfig";
import { useSiteSettings } from "@/lib/SiteSettings";
import { useMotionSystem } from "@/lib/motion";
import Particles from "@/components/motion/Particles";
import SoftLetterbox from "@/components/motion/SoftLetterbox";
import MagneticCTA from "@/components/motion/MagneticCTA";
import TiltCard from "@/components/motion/TiltCard";
import Spotlight from "@/components/motion/Spotlight";

const STADIUM_IMG = "https://images.unsplash.com/photo-1779406283467-5124ba4631c3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwxfHxkYXJrJTIwZnV0c2FsJTIwc3RhZGl1bSUyMG5pZ2h0fGVufDB8fHx8MTc4MDk2OTUxMXww&ixlib=rb-4.1.0&q=85";
const PLAYER_IMG = "https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzh8MHwxfHNlYXJjaHwyfHxzb2NjZXIlMjBhY3Rpb24lMjBuaWdodCUyMGRhcmt8ZW58MHx8fHwxNzgwOTY5NTExfDA&ixlib=rb-4.1.0&q=85";
const LIGHTS_IMG = "https://images.unsplash.com/photo-1638573615178-6f2950746614?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MjJ8MHwxfHNlYXJjaHwxfHxuZW9uJTIwc3BvcnRzJTIwc3RhZGl1bSUyMGxpZ2h0c3xlbnwwfHx8fDE3ODA5Njk1MTF8MA&ixlib=rb-4.1.0&q=85";

function MenuCard({ to, title, subtitle, image, icon, testId, delay = 0 }) {
  const { reduce, fadeUp } = useMotionSystem();
  return (
    <motion.div
      {...fadeUp(delay)}
      className="relative group"
      style={{ perspective: 1000 }}
    >
      <TiltCard className="h-full">
        <Link to={to} data-testid={testId} className="block focus:outline-none">
          <div className="menu-card relative h-[300px] sm:h-[360px] md:h-[420px] overflow-hidden border border-white/10 group-hover:border-[var(--brand)]/70 transition-all duration-300 group-focus-within:border-[var(--brand)]">
            <img
              src={image}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover scale-110 group-hover:scale-125 transition-transform duration-700"
              loading="lazy"
              decoding="async"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#030305] via-[#030305]/70 to-transparent" />
            <div className="absolute inset-0 bg-[var(--brand)]/0 group-hover:bg-[var(--brand)]/12 transition-colors" />

            <div className="absolute top-4 left-4 right-4 flex items-start justify-between">
              <div className="text-[10px] uppercase tracking-[0.35em] text-white/60">
                // {String((Math.abs(Math.round(Math.sin(title.length * 9.3) * 99)) % 99)).padStart(2, "0")}
              </div>
              <div className="w-10 h-10 grid place-items-center border border-white/15 group-hover:border-[var(--brand)] group-hover:bg-[var(--brand)]/10 transition-all">
                {icon}
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6" style={{ transform: "translateZ(28px)" }}>
              <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] mb-2">{subtitle}</div>
              <div className="font-heading text-4xl sm:text-5xl md:text-6xl italic uppercase leading-[0.9]">{title}</div>
              <div className="menu-select-hint flex items-center gap-2 mt-4 text-white/80 text-sm uppercase tracking-[0.2em] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--brand)] shadow-[0_0_8px_var(--brand)]" />
                Selecionar <ChevronRight className="w-4 h-4" />
              </div>
            </div>
            <div className="absolute right-0 top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-[var(--brand)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            {!reduce && (
              <motion.div
                className="absolute inset-x-0 bottom-0 h-px bg-[var(--brand)]/0 group-hover:bg-[var(--brand)]"
                initial={false}
                whileHover={{ opacity: [0, 1, 0.4] }}
                transition={{ duration: 0.6 }}
              />
            )}
          </div>
        </Link>
      </TiltCard>
    </motion.div>
  );
}


function CountUp({ to, suffix = "" }) {
  const { reduce } = useMotionSystem();
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) {
      setN(to);
      return undefined;
    }
    let raf;
    let start;
    const dur = 1400;
    const step = (t) => {
      if (!start) start = t;
      const p = Math.min((t - start) / dur, 1);
      setN(Math.floor(p * to));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, reduce]);
  return (
    <span>
      {n.toLocaleString("pt-BR")}
      {suffix}
    </span>
  );
}

export default function Landing() {
  const [stats, setStats] = useState({ courts: 1, tournaments: 0, matchesLive: 0 });
  const m = useMotionSystem();

  useEffect(() => {
    api
      .get("/tournaments")
      .then(({ data }) => {
        const matchesLive = data.reduce(
          (acc, t) => acc + t.matches.filter((x) => x.status !== "finished").length,
          0
        );
        setStats({ courts: 1, tournaments: data.length, matchesLive });
      })
      .catch(() => {});
  }, []);

  const { settings, priceLabel: COURT_PRICE_LABEL, waReady, waHref: ctxWa, pixReady } = useSiteSettings();
  const WHATSAPP_DISPLAY = settings.whatsapp_display;
  const waHref = waReady
    ? (ctxWa || whatsappUrl(defaultWhatsAppPrefill(), settings.whatsapp_e164))
    : null;
  const chips = structureChips(settings);
  const structureBlurb = (settings.structure_blurb || "").trim();
  const durationLabel = gameDurationLabel(settings);
  const showPolicies = policiesVisible(settings);
  const policyCancelText = resolvePolicyCancel(settings);
  const policyRainText = resolvePolicyRain(settings);

  return (
    <PageShell>
      <SoftLetterbox holdMs={1100} />

      {/* ===== TITLE SCREEN / MAIN MENU HERO ===== */}
      <section className="relative min-h-[100vh] flex items-end overflow-hidden title-screen">
        {/* Hero background: baleys arena video (paused/hidden under reduced-motion) */}
        {m.reduce ? (
          <img
            src={STADIUM_IMG}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="eager"
            decoding="async"
          />
        ) : (
          <video
            className="absolute inset-0 w-full h-full object-cover hero-baleys-video"
            src={BALEYS_VIDEO_SRC}
            poster={BALEYS_POSTER_SRC || BALEYS_POSTER_FALLBACK || STADIUM_IMG}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden="true"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/70 to-[#030305]" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/35" />
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute inset-0 scanlines opacity-50" />
        <Spotlight />
        <Particles count={18} seed={7} />

        {!m.reduce && (
          <>
            <motion.div
              className="absolute top-32 right-12 w-72 h-72 rounded-full bg-[var(--brand)]/20 blur-3xl"
              animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 5, repeat: Infinity }}
            />
            <motion.div
              className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-[#FF0055]/10 blur-3xl"
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 7, repeat: Infinity }}
            />
          </>
        )}

        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 pointer-events-none">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--brand)]/40 to-transparent shimmer-line" />
        </div>

        {/* Title-screen press-start style badge */}
        <motion.div
          {...m.fadeIn(0.15)}
          className="absolute top-24 left-6 md:left-10 z-10 hidden sm:flex items-center gap-2 text-[10px] tracking-[0.4em] uppercase text-white/45"
        >
          <span className="w-2 h-2 rounded-full bg-[var(--brand)] animate-pulse shadow-[0_0_10px_var(--brand)]" />
          Title Screen · Pedra Azul F.S.
        </motion.div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 md:px-10 pb-24 pt-28 sm:pt-32 w-full overflow-x-hidden">
          <motion.div {...m.slideX(0)} className="skew-tag mb-4 sm:mb-6">
            <span className="font-heading uppercase text-sm tracking-[0.4em] text-[var(--brand)]">
              Temporada 2026 · Pedra Azul F.S. — Ao Vivo
            </span>
          </motion.div>

          <motion.h1
            {...m.fadeUp(0.18)}
            className="font-heading text-[16vw] md:text-[10vw] leading-[0.85] uppercase italic font-bold tracking-tighter"
          >
            ATÉ A <br />
            <span className="text-[var(--brand)] text-glow-strong">PEDRA</span> <br />
            <span className="text-[var(--accent)]" style={{ textShadow: "0 0 32px var(--accent-glow)" }}>
              AZUL.
            </span>
          </motion.h1>

          <motion.p {...m.fadeUp(0.35)} className="mt-6 max-w-xl text-white/70 text-lg md:text-xl">
            A casa oficial do <span className="text-[var(--brand)] font-semibold">Pedra Azul F.S.</span> — fundado
            em <strong>19.04.15</strong>. Reserve sua quadra, monte seu time e dispute a{" "}
            <span className="text-[var(--accent)]">Copa Alto Tietê</span> em tempo real.
          </motion.p>

          <motion.div {...m.fadeUp(0.48)} className="trust-strip mt-6">
            <span className="trust-pill">
              <Banknote className="w-3.5 h-3.5 text-[var(--brand)]" /> <strong>{COURT_PRICE_LABEL}</strong>
            </span>
            <span className="trust-pill">
              <MapPin className="w-3.5 h-3.5 text-[var(--brand)]" /> {COURT_LOCATION}
            </span>
            <span className="trust-pill">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--success)]" /> Confirmação via WhatsApp
            </span>
          </motion.div>

          <motion.div {...m.fadeUp(0.58)} className="mt-10 flex flex-wrap items-center gap-3 sm:gap-4 max-w-full">
            <MagneticCTA>
              <Link to="/booking" data-testid={HOME.heroCta} className="btn-neon cta-select">
                RESERVAR HORÁRIO <ChevronRight className="w-5 h-5" />
              </Link>
            </MagneticCTA>
            {waReady && waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="hero-whatsapp-cta"
                className="btn-ghost !border-[#25D366]/40 hover:!border-[#25D366] hover:!text-[#25D366]"
              >
                <MessageCircle className="w-4 h-4 text-[#25D366]" /> FALAR NO WHATSAPP
              </a>
            )}
            <Link to="/tournaments" data-testid={HOME.heroSecondary} className="btn-ghost">
              <Trophy className="w-4 h-4" /> Ver Campeonatos
            </Link>
          </motion.div>

          <motion.div
            {...m.fadeIn(0.9)}
            className="mt-14 grid grid-cols-3 gap-2 sm:gap-4 max-w-2xl"
          >
            {[
              { label: "Quadra Oficial", val: stats.courts, icon: <Zap className="w-4 h-4" /> },
              { label: "Torneios Ativos", val: stats.tournaments, icon: <Trophy className="w-4 h-4" /> },
              { label: "Partidas Live", val: stats.matchesLive, icon: <Activity className="w-4 h-4" /> },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                {...m.fadeUp(0.95 + i * 0.08)}
                className="glass px-4 py-3 hud-stat"
              >
                <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-white/50">
                  {s.icon} {s.label}
                </div>
                <div className="font-heading text-4xl text-[var(--brand)] mt-1">
                  <CountUp to={s.val} />
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {!m.reduce && (
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/40 text-[10px] tracking-[0.4em] uppercase"
          >
            ▾ Explore
          </motion.div>
        )}
      </section>

      {/* Subtle HUD ticker — brand only */}
      <div className="hud-ticker hidden sm:block" aria-hidden="true">
        <div className={`hud-ticker-track${m.reduce ? " hud-ticker-track--static" : ""}`}>
          <span>PEDRA AZUL F.S.  ·  COPA ALTO TIETÊ  ·  QUADRA NÚNCIO  ·  {COURT_PRICE_LABEL.toUpperCase()}  ·  </span>
          <span>PEDRA AZUL F.S.  ·  COPA ALTO TIETÊ  ·  QUADRA NÚNCIO  ·  {COURT_PRICE_LABEL.toUpperCase()}  ·  </span>
        </div>
      </div>

      {/* ===== ESTRUTURA / CONHEÇA A QUADRA (+ video) ===== */}
      <section
        className="relative py-14 sm:py-20 overflow-hidden border-y border-white/5"
        data-testid="landing-structure-band"
      >
        <div className="absolute inset-0 pointer-events-none">
          {!m.reduce && (
            <video
              className="absolute inset-0 w-full h-full object-cover opacity-35"
              src={BALEYS_VIDEO_SRC}
              poster={BALEYS_POSTER_SRC}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#030305] via-[#030305]/88 to-[#030305]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,229,255,0.12),transparent_65%)]" />
        </div>
        <div className="relative max-w-7xl mx-auto px-6 md:px-10">
          <div className="text-center max-w-2xl mx-auto">
            <div className="text-[10px] sm:text-[11px] tracking-[0.45em] uppercase text-[var(--brand)] mb-3">
              // Estrutura · Conheça a quadra
            </div>
            <h2 className="font-heading text-[clamp(2rem,7vw,4.5rem)] uppercase italic font-black leading-[0.92] tracking-tighter">
              Até a <span className="text-glow-strong text-[var(--brand)]">Pedra Azul</span>
            </h2>
            <p className="mt-4 text-white/60 text-sm sm:text-base leading-relaxed" data-testid="landing-structure-blurb">
              {structureBlurb ||
                "A energia da quadra — reserve, jogue e dispute a Copa Alto Tietê. Tire dúvidas e reserve no WhatsApp."}
            </p>
          </div>
          {chips.length > 0 && (
            <ul
              className="mt-8 flex flex-wrap justify-center gap-2 sm:gap-2.5 max-w-3xl mx-auto"
              data-testid="landing-amenities-chips"
              aria-label="Amenities da quadra"
            >
              {chips.map((c) => (
                <li
                  key={c}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-full border border-[var(--brand)]/35 bg-black/45 text-[11px] sm:text-xs uppercase tracking-[0.12em] text-white/85 shadow-[0_0_18px_rgba(0,229,255,0.08)]"
                >
                  <Sparkles className="w-3 h-3 text-[var(--brand)] shrink-0" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
            <div className="glass px-4 py-3 flex items-start gap-3 border border-white/10">
              <MapPin className="w-4 h-4 text-[var(--brand)] mt-0.5 shrink-0" aria-hidden />
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-white/45">Local</div>
                <div className="text-sm text-white/85 mt-0.5">{settings.address_label || COURT_LOCATION}</div>
                {mapsUrlReady(settings) && (
                  <a
                    href={String(settings.maps_url).trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="landing-como-chegar"
                    className="inline-flex items-center gap-1 text-xs text-[var(--brand)] mt-1.5 hover:underline"
                  >
                    Como chegar
                  </a>
                )}
              </div>
            </div>
            <div className="glass px-4 py-3 flex items-start gap-3 border border-white/10">
              <Clock className="w-4 h-4 text-[var(--brand)] mt-0.5 shrink-0" aria-hidden />
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-white/45">Duração</div>
                <div className="text-sm text-white/85 mt-0.5">{durationLabel}</div>
              </div>
            </div>
            <div className="glass px-4 py-3 flex items-start gap-3 border border-white/10">
              {settings.has_parking !== false ? (
                <Car className="w-4 h-4 text-[var(--brand)] mt-0.5 shrink-0" aria-hidden />
              ) : (
                <Banknote className="w-4 h-4 text-[var(--brand)] mt-0.5 shrink-0" aria-hidden />
              )}
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-white/45">
                  {settings.has_parking !== false ? "Estacionamento" : "Pagamento"}
                </div>
                <div className="text-sm text-white/85 mt-0.5 line-clamp-2">
                  {settings.has_parking !== false
                    ? (settings.parking_note || "No entorno da quadra")
                    : (settings.accepts_pix !== false && pixReady ? "Aceita PIX" : settings.accepts_pix !== false ? "Aceita PIX" : "Consulte no WhatsApp")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== POLÍTICAS ===== */}
      {showPolicies && (
        <section
          className="relative py-12 sm:py-16 border-b border-white/5"
          data-testid="landing-policies"
        >
          <div className="max-w-3xl mx-auto px-6 md:px-10">
            <div className="text-[10px] sm:text-[11px] tracking-[0.45em] uppercase text-[var(--brand)] mb-3 text-center">
              // Políticas
            </div>
            <h2 className="font-heading text-[clamp(1.75rem,5vw,3rem)] uppercase italic font-black text-center leading-tight tracking-tighter mb-6">
              Cancelamento & <span className="text-[var(--brand)]">chuva</span>
            </h2>
            <div className="space-y-3">
              {policyCancelText ? (
                <details className="glass border border-white/10 rounded-lg px-4 py-3 group" data-testid="landing-policy-cancel" open>
                  <summary className="cursor-pointer list-none flex items-center gap-2 min-h-[44px] text-sm font-display tracking-wide text-white/90">
                    <ScrollText className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />
                    Política de cancelamento
                    <ChevronRight className="w-4 h-4 ml-auto text-white/40 group-open:rotate-90 transition-transform" aria-hidden />
                  </summary>
                  <p className="mt-2 text-sm text-white/65 leading-relaxed whitespace-pre-wrap pb-1">{policyCancelText}</p>
                </details>
              ) : null}
              {policyRainText ? (
                <details className="glass border border-white/10 rounded-lg px-4 py-3 group" data-testid="landing-policy-rain">
                  <summary className="cursor-pointer list-none flex items-center gap-2 min-h-[44px] text-sm font-display tracking-wide text-white/90">
                    <CloudRain className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />
                    Chuva / tempo
                    <ChevronRight className="w-4 h-4 ml-auto text-white/40 group-open:rotate-90 transition-transform" aria-hidden />
                  </summary>
                  <p className="mt-2 text-sm text-white/65 leading-relaxed whitespace-pre-wrap pb-1">{policyRainText}</p>
                </details>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* ===== MAIN MENU CARDS ===== */}
      <section className="relative py-24">
        <Particles count={10} seed={21} className="opacity-40" />
        <div className="max-w-7xl mx-auto px-6 md:px-10 relative">
          <div className="flex items-end justify-between mb-10 diagonal-stripe pb-6">
            <div>
              <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2">
                // Menu Principal
              </div>
              <h2 className="font-heading text-5xl md:text-7xl uppercase italic">
                Escolha sua <span className="text-[var(--brand)]">jogada</span>
              </h2>
            </div>
            <div className="hidden md:block text-right text-white/50 text-sm max-w-sm">
              Cada modo é uma experiência dedicada. Desde reservar uma partida casual até disputar a Liga Relâmpago.
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <MenuCard
              to="/booking"
              title="Reservar"
              subtitle="Quick Match · PIX"
              image={PLAYER_IMG}
              icon={<CalendarDays className="w-5 h-5 text-[var(--brand)]" />}
              testId={HOME.menuCardBook}
              delay={0.0}
            />
            <MenuCard
              to="/tournaments"
              title="Torneios"
              subtitle="Brackets · Leaderboards"
              image={LIGHTS_IMG}
              icon={<Trophy className="w-5 h-5 text-[var(--brand)]" />}
              testId={HOME.menuCardTournaments}
              delay={0.12}
            />
            <MenuCard
              to="/minhas-reservas"
              title="Minhas Reservas"
              subtitle="CPF · Status · PIX"
              image={STADIUM_IMG}
              icon={<Ticket className="w-5 h-5 text-[var(--brand)]" />}
              testId={HOME.menuCardMyBookings}
              delay={0.24}
            />
          </div>
        </div>
      </section>

      {/* ===== WHATSAPP / CONTATO ===== */}
      <section className="relative py-20 overflow-hidden" data-testid="landing-whatsapp-section">
        <div className="absolute inset-0 bg-gradient-to-r from-[#128C7E]/15 via-transparent to-[var(--brand)]/10 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 md:px-10 relative">
          <motion.div
            initial={m.reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: m.reduce ? 0.01 : 0.55 }}
            className="glass-strong p-8 md:p-12 border border-[#25D366]/25 relative overflow-hidden"
          >
            <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-[#25D366]/15 blur-3xl pointer-events-none" />
            <div className="skew-tag mb-4">
              <span className="font-heading uppercase text-sm tracking-[0.35em] text-[#25D366]">
                {waReady ? "Contato · WhatsApp" : "Contato · Reserva"}
              </span>
            </div>
            <h2 className="font-heading text-4xl md:text-6xl uppercase italic leading-[0.95] max-w-3xl">
              {waReady ? (
                <>Fale no <span className="text-[#25D366]">WhatsApp</span></>
              ) : (
                <>Reserve a <span className="text-[var(--brand)]">quadra</span></>
              )}
            </h2>
            <p className="text-white/65 text-lg mt-4 max-w-2xl leading-relaxed">
              {waReady ? (
                <>
                  Reservas, dúvidas de horário ou status do pagamento — nosso time responde no WhatsApp. Confirmação
                  rápida, sem burocracia. Fale agora: <strong className="text-white">{WHATSAPP_DISPLAY}</strong>.
                </>
              ) : (
                <>
                  Reserve online sem cadastro (CPF + PIX). Dúvidas por e-mail:{" "}
                  <strong className="text-white">contato@pedraazulfs.com.br</strong>.
                </>
              )}
            </p>
            <div className="trust-strip mt-6">
              <span className="trust-pill">
                <Banknote className="w-3.5 h-3.5 text-[var(--brand)]" /> <strong>{COURT_PRICE_LABEL}</strong>
              </span>
              <span className="trust-pill">
                <MapPin className="w-3.5 h-3.5 text-[var(--brand)]" /> Núncio
              </span>
              <span className="trust-pill">
                <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" /> Confirmação via WhatsApp
              </span>
            </div>
            <div className="mt-8 flex flex-wrap gap-4">
              {waReady && waHref ? (
                <MagneticCTA>
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="landing-whatsapp-cta"
                    className="btn-neon !bg-gradient-to-r from-[#25D366] to-[#128C7E] !shadow-[0_0_28px_rgba(37,211,102,0.45)]"
                    aria-label={`Abrir WhatsApp ${WHATSAPP_DISPLAY}`}
                  >
                    <MessageCircle className="w-5 h-5" /> FALAR NO WHATSAPP
                  </a>
                </MagneticCTA>
              ) : (
                <a
                  href="mailto:contato@pedraazulfs.com.br"
                  data-testid="landing-email-cta"
                  className="btn-ghost"
                >
                  E-mail
                </a>
              )}
              <Link to="/booking" className="btn-ghost" data-testid="landing-booking-cta-secondary">
                RESERVAR HORÁRIO <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ===== FEATURE BAND ===== */}
      <section className="relative py-24 border-y border-white/5 bg-gradient-to-b from-transparent to-black/40">
        <div className="max-w-7xl mx-auto px-6 md:px-10 grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={m.reduce ? { opacity: 0 } : { opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: m.reduce ? 0.01 : 0.6 }}
          >
            <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2">// O Diferencial</div>
            <h3 className="font-heading text-5xl md:text-6xl uppercase italic leading-[0.9]">
              Mais que uma quadra. <br />
              <span className="text-[var(--brand)]">Um estádio.</span>
            </h3>
            <p className="text-white/70 mt-6 text-lg leading-relaxed">
              Iluminação cinematográfica, replays automáticos, placar eletrônico FIFA-grade e atendimento de alto
              padrão. Tudo orquestrado por uma plataforma digital tão boa quanto o gramado.
            </p>
            <ul className="mt-6 grid grid-cols-2 gap-3 text-sm">
              {["Iluminação 4K", "Replays Instantâneos", "Vestiários VIP", "Café Esportivo", "Bar Premium", "Bancos Pro"].map(
                (f) => (
                  <li key={f} className="flex items-center gap-2 text-white/80">
                    <span className="w-1.5 h-1.5 bg-[var(--brand)] rounded-full" /> {f}
                  </li>
                )
              )}
            </ul>
          </motion.div>
          <motion.div
            initial={m.reduce ? { opacity: 0 } : { opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: m.reduce ? 0.01 : 0.6 }}
            className="relative h-[480px] overflow-hidden"
          >
            <img src={LIGHTS_IMG} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-[var(--brand)]/20" />
            <div className="absolute bottom-6 left-6 right-6 glass p-5">
              <div className="text-[11px] tracking-[0.3em] uppercase text-[var(--brand)]">Hoje · 21:30</div>
              <div className="font-heading text-3xl uppercase mt-1">
                Tigres FC <span className="text-white/40">vs</span> Lobos United
              </div>
              <div className="text-white/60 text-sm mt-1">Quartas — Copa Alto Tietê</div>
            </div>
          </motion.div>
        </div>
      </section>
    </PageShell>
  );
}
