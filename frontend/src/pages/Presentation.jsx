import React, { useEffect, useRef, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Volume2, VolumeX, SkipForward, Play, Pause, ChevronRight,
  Zap, Trophy, CalendarDays, Activity, Shield, Star,
} from "lucide-react";
import WhatsAppFab from "@/components/WhatsAppFab";

/**
 * PEDRA AZUL — CINEMATIC PRESENTATION
 * Premium EA-FC-style auto-playing presentation video, fully in-browser.
 * 8 cinematic scenes with synchronized motion, particles and sound.
 */

const STADIUM = "https://images.unsplash.com/photo-1779406283467-5124ba4631c3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwxfHxkYXJrJTIwZnV0c2FsJTIwc3RhZGl1bSUyMG5pZ2h0fGVufDB8fHx8MTc4MDk2OTUxMXww&ixlib=rb-4.1.0&q=85";
const LIGHTS  = "https://images.unsplash.com/photo-1638573615178-6f2950746614?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MjJ8MHwxfHNlYXJjaHwxfHxuZW9uJTIwc3BvcnRzJTIwc3RhZGl1bSUyMGxpZ2h0c3xlbnwwfHx8fDE3ODA5Njk1MTF8MA&ixlib=rb-4.1.0&q=85";
const PLAYER  = "https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzh8MHwxfHNlYXJjaHwyfHxzb2NjZXIlMjBhY3Rpb24lMjBuaWdodCUyMGRhcmt8ZW58MHx8fHwxNzgwOTY5NTExfDA&ixlib=rb-4.1.0&q=85";
const RUNNER  = "https://images.unsplash.com/photo-1730652128205-f5e98e542786?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwzfHxkYXJrJTIwZnV0c2FsJTIwc3RhZGl1bSUyMG5pZ2h0fGVufDB8fHx8MTc4MDk2OTUxMXww&ixlib=rb-4.1.0&q=85";

// Scene timings (in ms) — total ~52s
const SCENES = [
  { id: 0, name: "Black Cold Open",     duration: 2500 },
  { id: 1, name: "Logo Reveal",         duration: 5500 },
  { id: 2, name: "Stadium Reveal",      duration: 6500 },
  { id: 3, name: "Reservar",            duration: 6500 },
  { id: 4, name: "Torneios",            duration: 7000 },
  { id: 5, name: "PIX 30%",             duration: 6000 },
  { id: 6, name: "Stats Showcase",      duration: 7000 },
  { id: 7, name: "Final CTA",           duration: 7500 },
];
const TOTAL_DURATION = SCENES.reduce((a, s) => a + s.duration, 0);

/* ---------- WebAudio Cinematic Score (synthesized, no external file) ---------- */
function useCinematicAudio(enabled) {
  const ctxRef = useRef(null);
  const masterRef = useRef(null);
  const stopFnRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      if (stopFnRef.current) stopFnRef.current();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    masterRef.current = master;

    // Fade in
    master.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 1.2);

    // ----- Cinematic pad (two detuned saw with lowpass) -----
    const padOsc1 = ctx.createOscillator();
    const padOsc2 = ctx.createOscillator();
    padOsc1.type = "sawtooth";
    padOsc2.type = "sawtooth";
    padOsc1.frequency.value = 65.41; // C2
    padOsc2.frequency.value = 65.41 * 1.003;

    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 280;
    padFilter.Q.value = 7;

    const padGain = ctx.createGain();
    padGain.gain.value = 0.22;

    padOsc1.connect(padFilter); padOsc2.connect(padFilter);
    padFilter.connect(padGain); padGain.connect(master);
    padOsc1.start(); padOsc2.start();

    // Filter sweep (cinematic build)
    const t0 = ctx.currentTime;
    padFilter.frequency.cancelScheduledValues(t0);
    padFilter.frequency.setValueAtTime(280, t0);
    padFilter.frequency.exponentialRampToValueAtTime(1800, t0 + 14);
    padFilter.frequency.exponentialRampToValueAtTime(900, t0 + 30);
    padFilter.frequency.exponentialRampToValueAtTime(2400, t0 + 45);

    // ----- Sub bass pulse (4-on-the-floor cinematic kick) -----
    const tickPulse = () => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.9, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
      osc.connect(g); g.connect(master);
      osc.start(now); osc.stop(now + 0.7);
    };
    const pulseInterval = setInterval(tickPulse, 1500);

    // ----- Shimmer arpeggio (high sparkle) starts after 8s -----
    const arpNotes = [523.25, 659.25, 783.99, 1046.50, 783.99, 659.25]; // C5 E5 G5 C6
    let arpStep = 0;
    let arpInterval = null;
    const arpTimeout = setTimeout(() => {
      arpInterval = setInterval(() => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
        osc.frequency.value = arpNotes[arpStep % arpNotes.length];
        const delay = ctx.createDelay();
        delay.delayTime.value = 0.18;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.4;
        osc.connect(g); g.connect(master);
        g.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(master);
        osc.start(now); osc.stop(now + 0.55);
        arpStep++;
      }, 250);
    }, 8000);

    stopFnRef.current = () => {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        setTimeout(() => {
          clearInterval(pulseInterval);
          clearTimeout(arpTimeout);
          if (arpInterval) clearInterval(arpInterval);
          padOsc1.stop(); padOsc2.stop();
          ctx.close();
        }, 500);
      } catch (e) { /* noop */ }
    };

    return () => { if (stopFnRef.current) stopFnRef.current(); };
  }, [enabled]);
}

/* ---------- Cinematic Letterbox (top/bottom black bars) ---------- */
function Letterbox() {
  return (
    <>
      <motion.div
        initial={{ y: "-100%" }} animate={{ y: 0 }}
        transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
        className="fixed top-0 left-0 right-0 h-[8vh] bg-black z-[60] pointer-events-none"
      />
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }}
        transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
        className="fixed bottom-0 left-0 right-0 h-[8vh] bg-black z-[60] pointer-events-none"
      />
    </>
  );
}

/* ---------- Floating Particles ---------- */
function Particles({ count = 30, seed = 0 }) {
  const items = useMemo(() => {
    // Deterministic pseudo-random based on seed and index
    const rand = (i, k) => {
      const v = Math.sin((i + 1) * 9301 + k * 49297 + seed * 233) * 43758.5453;
      return v - Math.floor(v);
    };
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: rand(i, 1) * 100,
      y: rand(i, 2) * 100,
      delay: rand(i, 3) * 4,
      duration: 4 + rand(i, 4) * 6,
      size: 1 + rand(i, 5) * 3,
    }));
  }, [count, seed]);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {items.map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-[var(--brand)]"
          style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size,
            boxShadow: `0 0 ${p.size * 4}px var(--brand)`,
          }}
          animate={{
            y: [-20, -120],
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
}

/* ---------- Scene 0: Cold Open ---------- */
function SceneColdOpen() {
  return (
    <motion.div className="absolute inset-0 bg-black flex items-center justify-center"
      exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 1, 1, 0.4], scale: [0.6, 1, 1, 1.05] }}
        transition={{ duration: 2.4, times: [0, 0.3, 0.7, 1] }}
        className="text-[var(--brand)] font-heading uppercase text-xs tracking-[0.9em]"
      >
        Pedra Azul · presents
      </motion.div>
    </motion.div>
  );
}

/* ---------- Scene 1: Logo Reveal ---------- */
function SceneLogoReveal() {
  return (
    <motion.div className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden"
      exit={{ opacity: 0, scale: 1.1 }} transition={{ duration: 0.8 }}>
      {/* light beams */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 1.2 }}
        style={{
          background: "radial-gradient(ellipse 60% 100% at 50% 50%, rgba(0,229,255,0.35), transparent 70%)",
        }}
      />
      <Particles count={40} />

      {/* Scanning line */}
      <motion.div
        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-transparent"
        initial={{ top: "0%", opacity: 0 }}
        animate={{ top: ["0%", "100%"], opacity: [0, 1, 0] }}
        transition={{ duration: 2.5, delay: 0.8 }}
        style={{ filter: "drop-shadow(0 0 12px var(--brand))" }}
      />

      <div className="relative text-center z-10">
        {/* Bolt icon */}
        <motion.div
          initial={{ scale: 0, rotate: -180, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ delay: 0.6, duration: 1, type: "spring", stiffness: 60 }}
          className="inline-flex w-20 h-20 mb-6 items-center justify-center border-2 border-[var(--brand)] bg-[var(--brand)]/10"
          style={{ filter: "drop-shadow(0 0 24px var(--brand-glow))" }}
        >
          <Zap className="w-10 h-10 text-[var(--brand)]" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, letterSpacing: "1em" }}
          animate={{ opacity: 1, letterSpacing: "0.05em" }}
          transition={{ delay: 1.2, duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          className="font-heading text-7xl md:text-9xl italic font-black uppercase leading-none"
        >
          <span className="text-white">Arena</span>{" "}
          <span className="text-[var(--brand)] text-glow-strong">Premium</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 2.4, duration: 0.8 }}
          className="mx-auto mt-6 h-px w-64 bg-gradient-to-r from-transparent via-white to-transparent"
        />
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3, duration: 0.8 }}
          className="mt-4 text-white/70 text-sm uppercase tracking-[0.7em]"
        >
          E A · F U T S A L · C L U B
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ---------- Scene 2: Stadium Reveal ---------- */
function SceneStadium() {
  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 1 }}
    >
      {/* Background image with zoom */}
      <motion.img
        src={STADIUM} alt=""
        initial={{ scale: 1.4 }} animate={{ scale: 1.05 }}
        transition={{ duration: 6.5, ease: "linear" }}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/30" />
      <div className="absolute inset-0 bg-grid opacity-30" />

      <Particles count={20} />

      <div className="relative z-10 h-full flex flex-col justify-center items-start px-12 md:px-24">
        {/* Skewed tag */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="skew-tag mb-6"
        >
          <span className="text-[var(--brand)] font-heading uppercase tracking-[0.4em] text-xs">
            BEM-VINDO À NOVA ERA
          </span>
        </motion.div>

        {/* Big animated headline letter-by-letter */}
        <div className="font-heading text-6xl md:text-9xl uppercase italic font-black leading-[0.85] tracking-tighter">
          {"O ESTÁDIO".split("").map((c, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 + i * 0.05, duration: 0.5 }}
              className="inline-block"
            >{c === " " ? "\u00A0" : c}</motion.span>
          ))}
          <br />
          {"DOS LENDÁRIOS.".split("").map((c, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.4 + i * 0.04, duration: 0.5 }}
              className="inline-block text-[var(--brand)]"
              style={{ textShadow: "0 0 32px var(--brand-glow)" }}
            >{c === " " ? "\u00A0" : c}</motion.span>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.8, duration: 0.8 }}
          className="mt-8 max-w-2xl text-white/80 text-xl md:text-2xl font-light"
        >
          A primeira arena de futsal com experiência <span className="text-[var(--brand)] font-semibold">EA Sports FC</span>.
          Iluminação cinematográfica. Replays automáticos. Vibração de Champions.
        </motion.p>

        {/* Bottom counter line */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 3.5, duration: 0.6 }}
          className="absolute bottom-12 left-12 md:left-24 right-12 md:right-24 flex items-end justify-between text-white/40 text-[10px] uppercase tracking-[0.5em] font-mono"
        >
          <span>// CAP. 01 — A ARENA</span>
          <span>SP · BRASIL</span>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ---------- Scene 3: Reservar (Booking) ---------- */
function SceneReservar() {
  const slots = [
    { time: "19:00", court: "Quadra Premium 1", state: "occ",   price: "R$ 180" },
    { time: "20:00", court: "Quadra Premium 1", state: "free",  price: "R$ 180" },
    { time: "21:00", court: "Quadra Premium 1", state: "free",  price: "R$ 180" },
    { time: "22:00", court: "Quadra Premium 1", state: "occ",   price: "R$ 180" },
  ];
  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.8 }}
    >
      <motion.img
        src={PLAYER} alt=""
        initial={{ scale: 1.2, x: 0 }}
        animate={{ scale: 1.05, x: -40 }}
        transition={{ duration: 6.5, ease: "linear" }}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
      <Particles count={15} />

      <div className="relative z-10 h-full grid md:grid-cols-2 gap-8 items-center px-12 md:px-24">
        {/* Left: text */}
        <div>
          <motion.div
            initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-xs uppercase tracking-[0.5em] text-[var(--brand)] mb-4"
          >
            // CAP. 02 — RESERVE EM SEGUNDOS
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.7 }}
            className="font-heading text-6xl md:text-8xl uppercase italic font-black leading-[0.9]"
          >
            UM TOQUE.<br/>
            <span className="text-[var(--brand)] text-glow-brand">SUA QUADRA.</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.6 }}
            className="mt-6 text-white/70 text-lg max-w-md"
          >
            Sem login. Sem espera. Apenas CPF, escolha o horário e pague no PIX
            com <span className="text-[var(--brand)] font-bold">30% de desconto</span>.
          </motion.p>
        </div>

        {/* Right: animated slot list */}
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="glass-strong p-6 backdrop-blur-2xl"
            style={{ clipPath: "polygon(4% 0, 100% 0, 96% 100%, 0 100%)" }}
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-[10px] uppercase tracking-[0.4em] text-[var(--brand)]">Hoje · Sexta</div>
                <div className="font-heading text-3xl uppercase">Horários</div>
              </div>
              <CalendarDays className="w-7 h-7 text-[var(--brand)]" />
            </div>

            <div className="space-y-2">
              {slots.map((s, i) => (
                <motion.div
                  key={s.time}
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.3 + i * 0.18, duration: 0.45 }}
                  className={`flex items-center justify-between p-4 ${s.state === "free" ? "slot-free" : "slot-occ"} backdrop-blur-md bg-white/5`}
                >
                  <div className="flex items-center gap-4">
                    <div className="font-heading text-3xl text-white">{s.time}</div>
                    <div className="text-white/60 text-sm">{s.court}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-white/70">{s.price}</div>
                    <div className={`text-[10px] uppercase tracking-[0.3em] font-bold ${s.state === "free" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                      {s.state === "free" ? "LIVRE" : "OCUPADO"}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Highlight glow on selected slot */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: [0, 1, 1], scale: [0.95, 1.02, 1] }}
              transition={{ delay: 3.2, duration: 1.2 }}
              className="mt-5 p-3 text-center border border-[var(--brand)]/40 bg-[var(--brand)]/10"
              style={{ filter: "drop-shadow(0 0 16px var(--brand-glow))" }}
            >
              <div className="font-heading uppercase text-[var(--brand)] tracking-[0.3em]">
                20:00 · SELECIONADO
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- Scene 4: Torneios (Tournament) ---------- */
function SceneTorneios() {
  const matches = [
    { a: "TIGRES FC",   b: "LOBOS UTD",  sa: 4, sb: 2 },
    { a: "SHARKS",      b: "DRAGÕES",    sa: 3, sb: 1 },
    { a: "AGUIAS",      b: "FÊNIX",      sa: 2, sb: 2 },
    { a: "RAIO",        b: "VULCANO",    sa: 5, sb: 3 },
  ];
  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.8 }}
    >
      <motion.img
        src={LIGHTS} alt=""
        initial={{ scale: 1.3 }} animate={{ scale: 1.0 }}
        transition={{ duration: 7, ease: "linear" }}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/70" />
      <div className="absolute inset-0 bg-grid opacity-25" />
      <Particles count={25} />

      <div className="relative z-10 h-full flex flex-col justify-center px-12 md:px-24">
        <motion.div
          initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-xs uppercase tracking-[0.5em] text-[var(--brand)] mb-4"
        >
          // CAP. 03 — TORNEIOS CINEMATOGRÁFICOS
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.7 }}
          className="font-heading text-6xl md:text-8xl uppercase italic font-black leading-[0.9] mb-10"
        >
          DISPUTE. <span className="text-[var(--brand)] text-glow-strong">VENÇA.</span> ERGA A TAÇA.
        </motion.h2>

        <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
          {matches.map((m, i) => {
            const winnerA = m.sa > m.sb;
            return (
              <motion.div
                key={m.a}
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 1.2 + i * 0.15, duration: 0.5 }}
                className="glass-strong p-4 relative overflow-hidden"
                style={{ clipPath: "polygon(3% 0, 100% 0, 97% 100%, 0 100%)" }}
              >
                {/* Team A */}
                <div className={`flex items-center justify-between py-2 ${winnerA ? "text-white" : "text-white/40"}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 grid place-items-center bg-[var(--brand)]/15 border border-[var(--brand)]/40">
                      <Shield className="w-4 h-4 text-[var(--brand)]" />
                    </div>
                    <div className="font-heading text-xl uppercase tracking-wide">{m.a}</div>
                  </div>
                  <div className="font-heading text-3xl">{m.sa}</div>
                </div>
                <div className="h-px bg-white/10" />
                {/* Team B */}
                <div className={`flex items-center justify-between py-2 ${!winnerA ? "text-white" : "text-white/40"}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 grid place-items-center bg-[var(--danger)]/15 border border-[var(--danger)]/40">
                      <Shield className="w-4 h-4 text-[var(--danger)]" />
                    </div>
                    <div className="font-heading text-xl uppercase tracking-wide">{m.b}</div>
                  </div>
                  <div className="font-heading text-3xl">{m.sb}</div>
                </div>

                <motion.div
                  initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                  transition={{ delay: 1.8 + i * 0.15, duration: 0.6 }}
                  className={`absolute ${winnerA ? "top-2" : "bottom-2"} left-0 h-0.5 origin-left bg-[var(--brand)]`}
                  style={{ width: "100%", filter: "drop-shadow(0 0 8px var(--brand))" }}
                />
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 3.5, duration: 0.8 }}
          className="mt-10 flex items-center gap-3 text-white/60"
        >
          <Trophy className="w-5 h-5 text-[var(--warning)]" />
          <span className="font-heading uppercase tracking-[0.3em] text-lg">
            COPA ALTO TIETÊ · TEMPORADA 1
          </span>
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity }}
            className="ml-3 px-2 py-0.5 bg-[var(--danger)]/80 text-white text-[10px] font-bold uppercase tracking-widest"
          >● LIVE</motion.span>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ---------- Scene 5: PIX ---------- */
function ScenePix() {
  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.8 }}
    >
      <motion.img
        src={RUNNER} alt=""
        initial={{ scale: 1.2, x: 60 }} animate={{ scale: 1.0, x: 0 }}
        transition={{ duration: 6, ease: "linear" }}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-l from-black via-black/70 to-transparent" />
      <Particles count={20} />

      <div className="relative z-10 h-full grid md:grid-cols-2 gap-12 items-center px-12 md:px-24">
        {/* Left: QR Code mock */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85, rotate: -3 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ delay: 0.5, duration: 0.8, type: "spring" }}
          className="relative max-w-sm mx-auto"
        >
          <div className="bg-white p-6 relative">
            {/* Animated QR squares */}
            <div className="grid grid-cols-8 gap-0.5 w-72 h-72">
              {Array.from({ length: 64 }).map((_, i) => {
                // Deterministic checkerboard-ish QR pattern
                const v = Math.sin(i * 991.3 + 17) * 43758.5;
                const on = (v - Math.floor(v)) > 0.45;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: on ? 1 : 0 }}
                    transition={{ delay: 0.8 + i * 0.008 }}
                    className="bg-black"
                  />
                );
              })}
            </div>
            {/* corner squares */}
            <div className="absolute top-6 left-6 w-12 h-12 border-4 border-black" />
            <div className="absolute top-6 right-6 w-12 h-12 border-4 border-black" />
            <div className="absolute bottom-6 left-6 w-12 h-12 border-4 border-black" />

            {/* Scanning beam */}
            <motion.div
              initial={{ top: "0%" }} animate={{ top: ["0%", "100%", "0%"] }}
              transition={{ duration: 3, repeat: Infinity, delay: 1.5 }}
              className="absolute left-6 right-6 h-1 bg-[var(--brand)]"
              style={{ filter: "drop-shadow(0 0 12px var(--brand))" }}
            />
          </div>
          <div className="mt-3 text-center font-mono text-xs text-white/60 tracking-widest">
            00020126580014BR.GOV.BCB.PIX...
          </div>
        </motion.div>

        {/* Right: Discount */}
        <div className="text-right">
          <motion.div
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-xs uppercase tracking-[0.5em] text-[var(--brand)] mb-4"
          >
            // CAP. 04 — PAGAMENTO INSTANTÂNEO
          </motion.div>
          <motion.div
            initial={{ scale: 0.3, opacity: 0, rotate: 10 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ delay: 0.8, duration: 0.8, type: "spring", stiffness: 80 }}
            className="font-heading uppercase italic font-black"
            style={{ filter: "drop-shadow(0 0 32px var(--brand-glow))" }}
          >
            <span className="text-[18vw] md:text-[14vw] text-[var(--brand)] leading-none">30%</span>
            <div className="text-5xl md:text-7xl text-white -mt-4">OFF NO PIX</div>
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2, duration: 0.7 }}
            className="text-white/70 text-xl mt-6 max-w-md ml-auto"
          >
            Sinal de 30% via PIX confirma a reserva. Sem cartão. Sem taxas.
            Sem complicação.
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- Scene 6: Stats Showcase ---------- */
function StatBlock({ label, value, delay, suffix = "" }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now() + delay * 1000;
    const dur = 1800;
    let raf;
    const step = (t) => {
      if (t < start) { raf = requestAnimationFrame(step); return; }
      const p = Math.min((t - start) / dur, 1);
      setN(Math.floor(p * value));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, delay]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6 }}
      className="glass-strong p-8 border-l-2 border-[var(--brand)]"
    >
      <div className="text-[10px] uppercase tracking-[0.4em] text-white/50">{label}</div>
      <div className="font-heading text-7xl md:text-8xl text-[var(--brand)] mt-2 leading-none" style={{ textShadow: "0 0 24px var(--brand-glow)" }}>
        {n.toLocaleString("pt-BR")}{suffix}
      </div>
    </motion.div>
  );
}

function SceneStats() {
  return (
    <motion.div
      className="absolute inset-0 overflow-hidden bg-black"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 bg-grid opacity-50" />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,229,255,0.15), transparent 70%)" }}
      />
      <Particles count={50} />

      <div className="relative z-10 h-full flex flex-col justify-center px-12 md:px-24">
        <motion.div
          initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-xs uppercase tracking-[0.5em] text-[var(--brand)] mb-4"
        >
          // CAP. 05 — A ARENA EM NÚMEROS
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.7 }}
          className="font-heading text-6xl md:text-8xl uppercase italic font-black leading-[0.9] mb-12"
        >
          A <span className="text-[var(--brand)]">EXCELÊNCIA</span> EM DADOS
        </motion.h2>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl">
          <StatBlock label="Quadras Premium" value={3}    delay={1.0} />
          <StatBlock label="Torneios na Temporada" value={2}    delay={1.3} />
          <StatBlock label="Times Cadastrados" value={24}   delay={1.6} />
          <StatBlock label="Iluminação"       value={4}    delay={1.9} suffix="K" />
          <StatBlock label="Replay Auto"      value={120}  delay={2.2} suffix="fps" />
          <StatBlock label="Desconto PIX"     value={30}   delay={2.5} suffix="%" />
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- Scene 7: Final CTA ---------- */
function SceneFinal({ onCta }) {
  return (
    <motion.div
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0 }} transition={{ duration: 1 }}
    >
      <motion.img
        src={STADIUM} alt=""
        initial={{ scale: 1.0 }} animate={{ scale: 1.15 }}
        transition={{ duration: 7.5, ease: "linear" }}
        className="absolute inset-0 w-full h-full object-cover opacity-60"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/40" />
      <Particles count={60} />

      <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.8, type: "spring", stiffness: 70 }}
          className="inline-flex w-16 h-16 mb-6 items-center justify-center border-2 border-[var(--brand)] bg-[var(--brand)]/10"
          style={{ filter: "drop-shadow(0 0 24px var(--brand-glow))" }}
        >
          <Zap className="w-8 h-8 text-[var(--brand)]" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40, letterSpacing: "0.5em" }}
          animate={{ opacity: 1, y: 0, letterSpacing: "0.02em" }}
          transition={{ delay: 0.8, duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          className="font-heading text-7xl md:text-[10rem] italic font-black uppercase leading-[0.85]"
        >
          <span className="text-white">SEJA</span><br/>
          <span className="text-[var(--brand)] text-glow-strong">LENDA.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.5, duration: 0.8 }}
          className="mt-6 text-white/80 text-xl md:text-2xl max-w-xl"
        >
          O gramado está pronto. As luzes acesas. <br/>
          Só falta <span className="text-[var(--brand)] font-bold">você</span>.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3.5, duration: 0.6 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-4"
        >
          <button
            onClick={onCta}
            data-testid="presentation-final-cta"
            className="btn-neon !py-5 !px-12 !text-2xl"
          >
            ENTRAR NA ARENA <ChevronRight className="w-7 h-7" />
          </button>
          <Link to="/" className="btn-ghost">
            <Play className="w-4 h-4 rotate-180" /> Início
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 0.5 }}
          transition={{ delay: 5, duration: 1 }}
          className="absolute bottom-12 text-white/40 text-[10px] uppercase tracking-[0.5em] font-mono"
        >
          PEDRA AZUL · EA FUTSAL CLUB · MMXXVI
        </motion.div>
      </div>
    </motion.div>
  );
}

/* =================================================================== */
/* MAIN PRESENTATION COMPONENT                                         */
/* =================================================================== */
export default function Presentation() {
  const navigate = useNavigate();
  const [sceneIdx, setSceneIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [audio, setAudio] = useState(false); // requires user interaction to enable
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const accumRef = useRef(0);

  useCinematicAudio(audio && playing);

  // Auto-advance scenes
  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now();
    const sceneStart = SCENES.slice(0, sceneIdx).reduce((a, s) => a + s.duration, 0);
    const sceneEnd = sceneStart + SCENES[sceneIdx].duration;

    const tick = () => {
      const now = accumRef.current + (performance.now() - startRef.current);
      setElapsed(Math.min(now, TOTAL_DURATION));
      if (now >= sceneEnd) {
        if (sceneIdx < SCENES.length - 1) {
          accumRef.current = sceneEnd;
          setSceneIdx(sceneIdx + 1);
        } else {
          setPlaying(false);
        }
        return;
      }
      timerRef.current = requestAnimationFrame(tick);
    };
    timerRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(timerRef.current);
  }, [sceneIdx, playing]);

  const skipToEnd = () => {
    cancelAnimationFrame(timerRef.current);
    accumRef.current = TOTAL_DURATION - SCENES[SCENES.length - 1].duration;
    setSceneIdx(SCENES.length - 1);
  };

  const togglePlay = () => {
    if (playing) {
      cancelAnimationFrame(timerRef.current);
      accumRef.current += performance.now() - startRef.current;
      setPlaying(false);
    } else {
      setPlaying(true);
    }
  };

  const replay = () => {
    cancelAnimationFrame(timerRef.current);
    accumRef.current = 0;
    setElapsed(0);
    setSceneIdx(0);
    setPlaying(true);
  };

  const sceneStart = SCENES.slice(0, sceneIdx).reduce((a, s) => a + s.duration, 0);
  const sceneProgress = Math.min(1, (elapsed - sceneStart) / SCENES[sceneIdx].duration);
  const totalProgress = elapsed / TOTAL_DURATION;

  return (
    <div className="fixed inset-0 bg-black z-50 overflow-hidden" data-testid="presentation-root">
      <Letterbox />

      {/* Scene Stage */}
      <div className="absolute inset-0">
        <AnimatePresence mode="wait">
          {sceneIdx === 0 && <SceneColdOpen key="s0" />}
          {sceneIdx === 1 && <SceneLogoReveal key="s1" />}
          {sceneIdx === 2 && <SceneStadium key="s2" />}
          {sceneIdx === 3 && <SceneReservar key="s3" />}
          {sceneIdx === 4 && <SceneTorneios key="s4" />}
          {sceneIdx === 5 && <ScenePix key="s5" />}
          {sceneIdx === 6 && <SceneStats key="s6" />}
          {sceneIdx === 7 && <SceneFinal key="s7" onCta={() => navigate("/booking")} />}
        </AnimatePresence>
      </div>

      {/* Top HUD: scene chapter + audio + skip */}
      <div className="fixed top-0 left-0 right-0 z-[70] px-6 md:px-10 py-3 flex items-center justify-between text-white/80">
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-2 h-2 rounded-full bg-[var(--danger)]"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-white/60">REC · APRESENTAÇÃO</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-white/60">
          {String(sceneIdx + 1).padStart(2, "0")} / {String(SCENES.length).padStart(2, "0")} · {SCENES[sceneIdx].name}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAudio(a => !a)}
            data-testid="presentation-audio-toggle"
            className="w-10 h-10 grid place-items-center border border-white/15 hover:border-[var(--brand)] hover:text-[var(--brand)] transition"
            title={audio ? "Desativar som" : "Ativar som cinematográfico"}
          >
            {audio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={togglePlay}
            data-testid="presentation-play-toggle"
            className="w-10 h-10 grid place-items-center border border-white/15 hover:border-[var(--brand)] hover:text-[var(--brand)] transition"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => navigate("/")}
            data-testid="presentation-skip"
            className="px-4 h-10 inline-flex items-center gap-2 border border-white/15 hover:border-[var(--brand)] hover:text-[var(--brand)] transition text-[11px] uppercase tracking-[0.3em] font-bold"
          >
            <SkipForward className="w-4 h-4" /> Pular intro
          </button>
        </div>
      </div>

      {/* Bottom HUD: progress + scene chips */}
      <div className="fixed bottom-0 left-0 right-0 z-[70] px-6 md:px-10 py-3 space-y-2">
        {/* Scene chips */}
        <div className="flex items-center gap-1.5">
          {SCENES.map((s, i) => (
            <div key={s.id} className="flex-1 h-1 bg-white/10 overflow-hidden">
              <motion.div
                className="h-full bg-[var(--brand)]"
                animate={{
                  width: i < sceneIdx ? "100%" : i === sceneIdx ? `${sceneProgress * 100}%` : "0%",
                }}
                transition={{ duration: 0.2, ease: "linear" }}
                style={{ boxShadow: i === sceneIdx ? "0 0 12px var(--brand)" : "none" }}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.4em] text-white/50">
          <span>{Math.floor(elapsed / 1000).toString().padStart(2, "0")}:{(Math.floor(elapsed / 10) % 100).toString().padStart(2, "0")} / {Math.floor(TOTAL_DURATION/1000)}s</span>
          <span className="hidden md:inline">CINEMATIC · 24fps · 2.39:1</span>
          <span>{Math.round(totalProgress * 100)}%</span>
        </div>
      </div>

      {/* Replay overlay (only when finished) */}
      {!playing && sceneIdx === SCENES.length - 1 && elapsed >= TOTAL_DURATION - 100 && (
        <motion.button
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={replay}
          data-testid="presentation-replay"
          className="fixed bottom-16 right-10 z-[80] btn-ghost"
        >
          <Play className="w-4 h-4" /> Reproduzir novamente
        </motion.button>
      )}

      {/* Audio hint (first 6s) */}
      {!audio && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }} transition={{ delay: 1, duration: 0.6 }}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[75] pointer-events-none"
        >
          <div className="px-4 py-2 bg-black/70 border border-[var(--brand)]/30 text-[var(--brand)] text-[10px] tracking-[0.4em] uppercase font-mono">
            <Volume2 className="w-3 h-3 inline mr-2" /> Para experiência completa, ative o som
          </div>
        </motion.div>
      )}
      <WhatsAppFab />
    </div>
  );
}
