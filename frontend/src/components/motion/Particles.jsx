import React, { useMemo, useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Lightweight floating particle accents (pointer-events none).
 * Deterministic positions — no layout thrash. Fewer dots on phone.
 */
export default function Particles({ count = 22, seed = 1, className = "" }) {
  const reduce = useReducedMotion();
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 480px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const effective = narrow ? Math.min(count, 8) : count;

  const items = useMemo(() => {
    const rand = (i, k) => {
      const v = Math.sin((i + 1) * 9301 + k * 49297 + seed * 233) * 43758.5453;
      return v - Math.floor(v);
    };
    return Array.from({ length: effective }, (_, i) => ({
      id: i,
      x: rand(i, 1) * 100,
      y: rand(i, 2) * 100,
      delay: rand(i, 3) * 4,
      duration: 5 + rand(i, 4) * 6,
      size: 1 + rand(i, 5) * 2.5,
      accent: i % 4 === 0,
    }));
  }, [effective, seed]);

  if (reduce) return null;

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden>
      {items.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: p.accent ? "var(--accent)" : "var(--brand)",
            boxShadow: `0 0 ${4 + p.size * 2}px ${p.accent ? "var(--accent)" : "var(--brand)"}`,
            opacity: 0.55,
            willChange: "transform, opacity",
          }}
          animate={{ y: [-12, -100], opacity: [0, 0.85, 0] }}
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
