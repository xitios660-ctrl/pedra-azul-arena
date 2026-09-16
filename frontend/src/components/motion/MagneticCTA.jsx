import React, { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Subtle magnetic hover wrapper for primary CTAs.
 * Visual “select” only — no audio. Falls back to plain motion when reduced.
 */
export default function MagneticCTA({ children, className = "", strength = 0.28 }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const onMove = (e) => {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setOffset({
      x: (e.clientX - cx) * strength,
      y: (e.clientY - cy) * strength,
    });
  };

  const onLeave = () => setOffset({ x: 0, y: 0 });

  return (
    <motion.div
      ref={ref}
      className={`inline-flex ${className}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      animate={reduce ? undefined : { x: offset.x, y: offset.y }}
      transition={{ type: "spring", stiffness: 260, damping: 22, mass: 0.4 }}
      whileTap={reduce ? undefined : { scale: 0.97 }}
    >
      {children}
    </motion.div>
  );
}
