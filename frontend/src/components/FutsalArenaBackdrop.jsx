import React, { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

const W = 1600;
const H = 900;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

function pointMix(a, b, t) {
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) };
}

function drawPlayer(ctx, x, y, team, facing = 1, alpha = 1, stretch = 0) {
  const cyan = team === 0 ? "#00E5FF" : "#F2F5F7";
  const rim = team === 0 ? "rgba(0,229,255,0.72)" : "rgba(255,75,118,0.62)";
  const s = 0.76 + (y / H) * 0.44;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha = alpha;
  ctx.shadowBlur = 24;
  ctx.shadowColor = rim;

  ctx.strokeStyle = "rgba(0,0,0,0.72)";
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-7, 10);
  ctx.lineTo(-19 - stretch * 7, 45);
  ctx.moveTo(7, 10);
  ctx.lineTo(20 + stretch * 9, 45);
  ctx.stroke();

  ctx.strokeStyle = cyan;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-7, 8);
  ctx.lineTo(-17 - stretch * 5, 43);
  ctx.moveTo(7, 8);
  ctx.lineTo(18 + stretch * 7, 43);
  ctx.stroke();

  const body = ctx.createLinearGradient(0, -25, 0, 20);
  body.addColorStop(0, team === 0 ? "rgba(4,32,40,0.96)" : "rgba(42,42,48,0.94)");
  body.addColorStop(1, team === 0 ? "rgba(0,229,255,0.68)" : "rgba(255,255,255,0.52)");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-16, -30, 32, 45, 10);
  ctx.fill();

  ctx.strokeStyle = cyan;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-13 * facing, -17);
  ctx.lineTo(-30 * facing, 4 - stretch * 3);
  ctx.moveTo(13 * facing, -17);
  ctx.lineTo(29 * facing, -1 + stretch * 5);
  ctx.stroke();

  ctx.fillStyle = "#101317";
  ctx.beginPath();
  ctx.arc(0, -42, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}

function drawBall(ctx, x, y, lift = 0) {
  const r = 8 + (y / H) * 4;
  const yy = y - lift;
  ctx.save();
  ctx.shadowBlur = 16;
  ctx.shadowColor = "rgba(255,255,255,0.7)";
  ctx.fillStyle = "rgba(248,248,248,0.96)";
  ctx.beginPath();
  ctx.arc(x, yy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(12,17,21,0.86)";
  for (let i = 0; i < 5; i += 1) {
    const a = i * (Math.PI * 2) / 5 - 0.4;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.48, yy + Math.sin(a) * r * 0.48, r * 0.19, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function createNoiseBuffer(ctx, seconds = 3) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.97 + white * 0.03;
    data[i] = last;
  }
  return buffer;
}

export default function FutsalArenaBackdrop({
  videoSrc,
  posterSrc,
  fallbackSrc,
  reduceMotion = false,
}) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const ambienceRef = useRef(null);
  const timersRef = useRef([]);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return undefined;

    let raf = 0;
    let mounted = true;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform((rect.width * dpr) / W, 0, 0, (rect.height * dpr) / H, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });

    const teamA = [
      { x: 410, y: 610, ax: 88, ay: 36, phase: 0.0 },
      { x: 680, y: 520, ax: 112, ay: 52, phase: 1.4 },
      { x: 955, y: 610, ax: 82, ay: 42, phase: 2.5 },
      { x: 1160, y: 505, ax: 66, ay: 34, phase: 4.1 },
    ];
    const teamB = [
      { x: 530, y: 525, ax: 70, ay: 44, phase: 2.0 },
      { x: 805, y: 640, ax: 86, ay: 39, phase: 3.2 },
      { x: 1040, y: 490, ax: 75, ay: 33, phase: 5.0 },
      { x: 1285, y: 585, ax: 44, ay: 31, phase: 1.0 },
    ];

    const moving = (p, t, team) => ({
      x: p.x + Math.sin(t * (0.78 + team * 0.05) + p.phase) * p.ax,
      y: p.y + Math.cos(t * 0.66 + p.phase * 1.17) * p.ay,
    });

    const frame = (now) => {
      if (!mounted) return;
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, W, H);

      const haze = ctx.createRadialGradient(810, 370, 30, 810, 370, 780);
      haze.addColorStop(0, "rgba(0,229,255,0.08)");
      haze.addColorStop(0.48, "rgba(4,8,14,0.03)");
      haze.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, W, H);

      for (let i = 0; i < 11; i += 1) {
        const phase = i * 0.73;
        const px = ((i * 173 + t * (10 + i)) % (W + 220)) - 110;
        const py = 120 + ((i * 91) % 420) + Math.sin(t * 0.55 + phase) * 18;
        ctx.fillStyle = i % 3 === 0 ? "rgba(0,229,255,0.08)" : "rgba(255,255,255,0.045)";
        ctx.beginPath();
        ctx.arc(px, py, 2 + (i % 4), 0, Math.PI * 2);
        ctx.fill();
      }

      const a = teamA.map((p) => moving(p, t, 0));
      const b = teamB.map((p) => moving(p, t, 1));

      const cycle = t % 6;
      let ball;
      let lift = 0;
      if (cycle < 1.45) {
        ball = pointMix(a[0], a[1], smooth(cycle / 1.45));
        lift = Math.sin((cycle / 1.45) * Math.PI) * 14;
      } else if (cycle < 2.75) {
        ball = pointMix(a[1], a[2], smooth((cycle - 1.45) / 1.3));
        lift = Math.sin(((cycle - 1.45) / 1.3) * Math.PI) * 18;
      } else if (cycle < 4.05) {
        const dribble = smooth((cycle - 2.75) / 1.3);
        ball = {
          x: mix(a[2].x + 8, a[3].x - 20, dribble),
          y: mix(a[2].y + 20, a[3].y + 10, dribble) + Math.abs(Math.sin(cycle * 10)) * 7,
        };
      } else {
        const shot = smooth((cycle - 4.05) / 1.95);
        const goal = { x: 1455, y: 505 };
        ball = pointMix({ x: a[3].x + 18, y: a[3].y + 8 }, goal, shot);
        lift = Math.sin(shot * Math.PI) * 72;
      }

      const ordered = [
        ...a.map((p, i) => ({ ...p, team: 0, key: "a" + i })),
        ...b.map((p, i) => ({ ...p, team: 1, key: "b" + i })),
      ].sort((p1, p2) => p1.y - p2.y);

      ordered.forEach((p, i) => {
        const stride = Math.sin(t * 6.5 + i * 1.7) * 0.65;
        drawPlayer(ctx, p.x, p.y, p.team, p.team === 0 ? 1 : -1, 0.68, stride);
      });

      const keeperDive = cycle > 4.35 ? smooth((cycle - 4.35) / 1.15) : 0;
      drawPlayer(ctx, 1425 + keeperDive * 18, 500 - keeperDive * 24, 1, -1, 0.82, keeperDive * 1.7);
      drawBall(ctx, ball.x, ball.y, lift);

      const streak = ctx.createLinearGradient(ball.x - 70, ball.y, ball.x + 12, ball.y);
      streak.addColorStop(0, "rgba(255,255,255,0)");
      streak.addColorStop(1, "rgba(255,255,255,0.15)");
      ctx.strokeStyle = streak;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ball.x - 52, ball.y + 3);
      ctx.lineTo(ball.x - 10, ball.y + 1);
      ctx.stroke();

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reduceMotion]);

  const stopAudio = useCallback(() => {
    timersRef.current.forEach((id) => window.clearInterval(id));
    timersRef.current = [];
    if (ambienceRef.current) {
      try { ambienceRef.current.stop(); } catch {}
      ambienceRef.current = null;
    }
    if (audioRef.current) {
      const context = audioRef.current;
      audioRef.current = null;
      context.close().catch(() => {});
    }
    setSoundOn(false);
  }, []);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const startAudio = useCallback(async () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ac = new AudioCtx();
    await ac.resume();
    audioRef.current = ac;

    const master = ac.createGain();
    master.gain.value = 0.68;
    master.connect(ac.destination);

    const crowd = ac.createBufferSource();
    crowd.buffer = createNoiseBuffer(ac, 3);
    crowd.loop = true;
    const crowdFilter = ac.createBiquadFilter();
    crowdFilter.type = "lowpass";
    crowdFilter.frequency.value = 620;
    crowdFilter.Q.value = 0.7;
    const crowdGain = ac.createGain();
    crowdGain.gain.value = 0.075;
    crowd.connect(crowdFilter);
    crowdFilter.connect(crowdGain);
    crowdGain.connect(master);
    crowd.start();
    ambienceRef.current = crowd;

    const makeKick = () => {
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(125, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.28, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.2);
    };

    const makeSqueak = () => {
      const now = ac.currentTime;
      const len = Math.floor(ac.sampleRate * 0.11);
      const b = ac.createBuffer(1, len, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i += 1) {
        const env = 1 - i / len;
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ac.createBufferSource();
      src.buffer = b;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2500 + Math.random() * 1000;
      bp.Q.value = 7;
      const g = ac.createGain();
      g.gain.value = 0.08;
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(now);
    };

    const makeShout = () => {
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      const bp = ac.createBiquadFilter();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180 + Math.random() * 80, now);
      osc.frequency.linearRampToValueAtTime(130 + Math.random() * 40, now + 0.16);
      bp.type = "bandpass";
      bp.frequency.value = 780;
      bp.Q.value = 1.4;
      g.gain.setValueAtTime(0.001, now);
      g.gain.exponentialRampToValueAtTime(0.035, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(bp);
      bp.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 0.24);
    };

    makeKick();
    timersRef.current = [
      window.setInterval(() => {
        makeKick();
        if (Math.random() > 0.46) window.setTimeout(makeSqueak, 170 + Math.random() * 260);
      }, 1450),
      window.setInterval(() => {
        makeSqueak();
        if (Math.random() > 0.62) makeShout();
      }, 980),
    ];
    setSoundOn(true);
  }, []);

  const toggleSound = useCallback(() => {
    if (soundOn) stopAudio();
    else startAudio().catch(() => stopAudio());
  }, [soundOn, startAudio, stopAudio]);

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="false">
      {reduceMotion ? (
        <img
          src={posterSrc || fallbackSrc}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
          decoding="async"
        />
      ) : (
        <>
          <video
            className="absolute inset-0 w-full h-full object-cover hero-baleys-video"
            src={videoSrc}
            poster={posterSrc || fallbackSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden="true"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full opacity-80 mix-blend-screen pointer-events-none"
            aria-hidden="true"
          />
        </>
      )}

      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn}
        data-testid="arena-sound-toggle"
        className="pointer-events-auto absolute right-4 sm:right-7 bottom-5 sm:bottom-7 z-[40] min-h-[44px] inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/65 px-4 py-2.5 text-[11px] sm:text-xs uppercase tracking-[0.16em] text-white/85 backdrop-blur-md shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition hover:border-[var(--brand)]/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        {soundOn ? <Volume2 className="w-4 h-4 text-[var(--brand)]" /> : <VolumeX className="w-4 h-4 text-white/70" />}
        <span>{soundOn ? "Som da quadra ligado" : "Ativar som da quadra"}</span>
      </button>
    </div>
  );
}
