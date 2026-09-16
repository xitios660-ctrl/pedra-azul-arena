import React, { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Soft cursor spotlight for hero sections. Desktop only; pointer-events none.
 */
export default function Spotlight({ className = "" }) {
  const reduce = useReducedMotion();
  const [pos, setPos] = useState({ x: 50, y: 40 });
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (reduce) return undefined;
    const mq = window.matchMedia("(pointer: fine)");
    setEnabled(mq.matches);
    const onMove = (e) => {
      setPos({
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      });
    };
    if (mq.matches) window.addEventListener("pointermove", onMove, { passive: true });
    const onChange = () => setEnabled(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => {
      window.removeEventListener("pointermove", onMove);
      mq.removeEventListener?.("change", onChange);
    };
  }, [reduce]);

  if (reduce || !enabled) return null;

  return (
    <div
      className={`absolute inset-0 pointer-events-none z-[1] ${className}`}
      aria-hidden
      style={{
        background: `radial-gradient(520px circle at ${pos.x}% ${pos.y}%, rgba(0,229,255,0.12), transparent 45%)`,
      }}
    />
  );
}
