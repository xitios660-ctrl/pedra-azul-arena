import React, { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * 3D tilt + focus glow for selectable menu cards (FIFA main-menu feel).
 */
export default function TiltCard({
  children,
  className = "",
  maxTilt = 7,
  glare = true,
}) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, gx: 50, gy: 50 });
  const [focused, setFocused] = useState(false);

  const onMove = (e) => {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    setTilt({
      ry: (px - 0.5) * maxTilt * 2,
      rx: (0.5 - py) * maxTilt * 2,
      gx: px * 100,
      gy: py * 100,
    });
  };

  const reset = () => setTilt({ rx: 0, ry: 0, gx: 50, gy: 50 });

  return (
    <motion.div
      ref={ref}
      className={`relative ${className}`}
      style={{ transformStyle: "preserve-3d", perspective: 900 }}
      onMouseMove={onMove}
      onMouseLeave={reset}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      animate={
        reduce
          ? undefined
          : {
              rotateX: tilt.rx,
              rotateY: tilt.ry,
            }
      }
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
    >
      {children}
      {glare && !reduce && (
        <div
          className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 mix-blend-soft-light"
          style={{
            background: `radial-gradient(circle at ${tilt.gx}% ${tilt.gy}%, rgba(0,229,255,0.35), transparent 55%)`,
          }}
          aria-hidden
        />
      )}
      <div
        className={`pointer-events-none absolute inset-0 ring-1 transition-all duration-300 ${
          focused
            ? "ring-[var(--brand)] shadow-[0_0_28px_rgba(0,229,255,0.35)]"
            : "ring-transparent"
        }`}
        aria-hidden
      />
    </motion.div>
  );
}
