import React from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Short celebratory burst for booking success — premium, not childish.
 */
export default function VictoryBurst() {
  const reduce = useReducedMotion();
  if (reduce) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--brand)]/40"
          initial={{ width: 40, height: 40, opacity: 0.7 }}
          animate={{ width: 220 + i * 80, height: 220 + i * 80, opacity: 0 }}
          transition={{ duration: 1.1 + i * 0.15, ease: "easeOut", delay: i * 0.08 }}
        />
      ))}
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const dist = 70 + (i % 3) * 18;
        return (
          <motion.span
            key={`spark-${i}`}
            className="absolute left-1/2 top-[28%] w-1.5 h-1.5 rounded-full bg-[var(--brand)]"
            style={{ boxShadow: "0 0 8px var(--brand)" }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist,
              opacity: 0,
              scale: 0.4,
            }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
          />
        );
      })}
    </div>
  );
}
