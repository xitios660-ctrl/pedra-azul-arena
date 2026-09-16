import React, { useState, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ChevronRight, X, MapPin, Calendar } from "lucide-react";
import { BALEYS_VIDEO_SRC, BALEYS_POSTER_SRC } from "@/lib/siteConfig";
import { useSiteSettings } from "@/lib/SiteSettings";

/**
 * INTRO VIDEO MODAL — "Até a Pedra Azul"
 * - Auto-opens on first session visit
 * - Baleys arena mp4 (muted) + game-like motion entrance
 * - NO forced sound / no YouTube — skip anytime
 * - Primary logo: Copa Alto Tietê (main)
 * - Secondary brand: Pedra Azul F.S.
 */

const SESSION_KEY = "pedra_azul_intro_played_v4";
const STADIUM_BG = "https://images.unsplash.com/photo-1521334884684-d80222895322?crop=entropy&cs=srgb&fm=jpg&q=85&w=2400";

export default function IntroVideoModal() {
  const { priceLabel } = useSiteSettings();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(() => {
    try { return !sessionStorage.getItem(SESSION_KEY); } catch { return true; }
  });

  const close = useCallback(() => {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* noop */ }
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed inset-0 z-[9999] bg-black overflow-hidden"
        data-testid="intro-video-modal"
      >
        {/* Baleys arena video — muted autoplay; static poster if reduced-motion */}
        {reduce ? (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${STADIUM_BG})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "brightness(0.45) saturate(1.1)",
            }}
          />
        ) : (
          <motion.div
            initial={{ scale: 1.08, opacity: 0.85 }}
            animate={{ scale: 1.0, opacity: 1 }}
            transition={{ duration: 8, ease: "linear" }}
            className="absolute inset-0"
          >
            <video
              className="absolute inset-0 w-full h-full object-cover"
              src={BALEYS_VIDEO_SRC}
              poster={BALEYS_POSTER_SRC || STADIUM_BG}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
          </motion.div>
        )}

        {/* Heavy gradient overlays */}
        <div className="absolute inset-0 bg-black/60" />
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(5,8,16,0.4), rgba(5,8,16,0.96))" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-[#050810]/40 via-transparent to-[#050810]" />
        <div className="absolute inset-0 scanlines" />

        {/* Animated colored glows — skipped under prefers-reduced-motion */}
        {!reduce && (
          <>
        <motion.div
          animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 6, repeat: Infinity }}
          className="absolute top-10 right-10 w-[40rem] h-[40rem] rounded-full blur-3xl pointer-events-none"
          style={{ background: "var(--brand-glow)" }}
        />
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 7.5, repeat: Infinity }}
          className="absolute -bottom-32 -left-32 w-[44rem] h-[44rem] rounded-full blur-3xl pointer-events-none"
          style={{ background: "var(--accent-glow)" }}
        />
          </>
        )}

        {/* Floating particles */}
        {!reduce && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {Array.from({ length: 28 }).map((_, i) => {
            const r = (k) => {
              const v = Math.sin((i + 1) * 9301 + k * 49297) * 43758.5453;
              return v - Math.floor(v);
            };
            return (
              <motion.div
                key={i}
                className="absolute rounded-full"
                style={{
                  left: `${r(1) * 100}%`,
                  top: `${r(2) * 100}%`,
                  width: 1 + r(3) * 3,
                  height: 1 + r(3) * 3,
                  background: i % 3 === 0 ? "var(--accent)" : "var(--brand)",
                  boxShadow: `0 0 ${4 + r(4) * 8}px currentColor`,
                  color: i % 3 === 0 ? "var(--accent)" : "var(--brand)",
                }}
                animate={{ y: [-20, -160], opacity: [0, 1, 0] }}
                transition={{
                  duration: 5 + r(5) * 5,
                  delay: r(6) * 5,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            );
          })}
        </div>
        )}

        {/* TOP HUD */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 md:px-10 py-4">
          <motion.div
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="flex items-center gap-3"
          >
            <motion.div
              animate={reduce ? undefined : { opacity: [0.4, 1, 0.4] }}
              transition={reduce ? undefined : { duration: 1.5, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-[var(--accent)]"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-white/60">
              ◉ ON AIR · ABERTURA OFICIAL
            </span>
          </motion.div>

          <button
            onClick={close}
            data-testid="intro-close"
            className="w-11 h-11 min-w-[44px] min-h-[44px] grid place-items-center border border-white/15 hover:border-[var(--accent)] hover:text-[var(--accent)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            title="Fechar intro"
            aria-label="Fechar introdução"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* CENTER STAGE */}
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center px-6">
          {/* Copa Alto Tietê = MAIN LOGO (with rotating glow) */}
          <motion.div
            initial={{ scale: 0, opacity: 0, rotate: -45 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ delay: 0.3, duration: 1.2, type: "spring", stiffness: 60 }}
            className="relative mb-8"
          >
            {!reduce && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-full"
              style={{
                background: "conic-gradient(from 0deg, var(--brand) 0deg, transparent 90deg, var(--accent) 180deg, transparent 270deg, var(--brand) 360deg)",
                filter: "blur(28px)",
                opacity: 0.85,
              }}
            />
            )}
            <img
              src="/assets/copa-alto-tiete.png"
              alt="Copa Alto Tietê"
              className="relative w-48 h-48 md:w-60 md:h-60 object-contain"
              style={{ filter: "drop-shadow(0 0 40px var(--accent-glow))" }}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.8 }}
            className="text-[11px] md:text-sm uppercase tracking-[0.6em] text-[var(--brand)] mb-3"
          >
            BEM-VINDO À CASA DO
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, letterSpacing: "0.5em" }}
            animate={{ opacity: 1, letterSpacing: "0.02em" }}
            transition={{ delay: 1.5, duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            className="font-heading text-6xl md:text-9xl italic font-black uppercase leading-[0.85]"
          >
            <span className="text-white">PEDRA</span>{" "}
            <span style={{ color: "var(--brand)", textShadow: "0 0 32px var(--brand-glow)" }}>AZUL</span>
            <span className="text-white">.</span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 2.6, duration: 0.8 }}
            className="mt-6 h-px w-64 md:w-96 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2.9, duration: 0.8 }}
            className="mt-6 flex flex-col items-center gap-3"
          >
            <div className="flex items-center gap-3 text-white/80 text-base md:text-lg">
              <MapPin className="w-5 h-5 text-[var(--accent)]" />
              <span className="uppercase tracking-[0.3em] font-semibold">Quadra Pedra Azul · Núncio</span>
            </div>
            <div className="flex items-center gap-3 text-white/60 text-sm md:text-base">
              <Calendar className="w-4 h-4 text-[var(--brand)]" />
              <span className="uppercase tracking-[0.3em]">Fundado em 19.04.15 · Copa Alto Tietê 2026</span>
            </div>
          </motion.div>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 3.4, duration: 0.6 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
          >
            <button
              onClick={close}
              data-testid="intro-enter-btn"
              className="btn-neon !py-5 !px-12 !text-2xl"
            >
              ENTRAR NA QUADRA <ChevronRight className="w-7 h-7" />
            </button>
            <button
              onClick={() => { close(); navigate("/booking"); }}
              data-testid="intro-book-btn"
              className="btn-blue"
            >
              Reservar agora
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 4.2, duration: 0.6 }}
            className="mt-8 text-[var(--accent)] font-heading text-2xl md:text-3xl uppercase tracking-wider"
          >
            {priceLabel.replace("/h", "")}/<span className="text-white/70 text-lg">hora</span>
          </motion.div>
        </div>

        {/* Letterbox bars */}
        <motion.div
          initial={{ y: "-100%" }} animate={{ y: 0 }}
          transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
          className="absolute top-0 left-0 right-0 h-[6vh] bg-black pointer-events-none z-[5]"
        />
        <motion.div
          initial={{ y: "100%" }} animate={{ y: 0 }}
          transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
          className="absolute bottom-0 left-0 right-0 h-[6vh] bg-black pointer-events-none z-[5]"
        />

        {/* Pedra Azul logo bottom-left (secondary) */}
        <motion.div
          initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 4.5, duration: 0.6 }}
          className="absolute bottom-12 left-6 md:left-10 z-10 flex items-center gap-3"
        >
          <img src="/assets/pedra-azul-logo.svg" alt="Pedra Azul F.S."
            className="w-12 h-12 md:w-16 md:h-16" />
          <div className="text-left">
            <div className="text-[9px] uppercase tracking-[0.35em] text-white/40">Time Oficial</div>
            <div className="font-heading uppercase text-white text-sm md:text-base tracking-wider">Pedra Azul F.S.</div>
          </div>
        </motion.div>

        {/* Bottom-right hint */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 4.8, duration: 0.6 }}
          className="absolute bottom-14 right-10 z-10 hidden md:block text-right pointer-events-none"
        >
          <div className="text-[9px] uppercase tracking-[0.4em] text-white/40 font-mono">Quadra única · Núncio</div>
          <div className="text-[9px] uppercase tracking-[0.4em] text-white/40 font-mono">Alto Tietê · SP · BR</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
