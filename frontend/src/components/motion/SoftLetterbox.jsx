import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

/**
 * Cinematic letterbox bars that enter on mount then retract.
 * Does not block scroll or pointer events.
 */
export default function SoftLetterbox({ holdMs = 900 }) {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(!reduce);

  useEffect(() => {
    if (reduce) return undefined;
    const t = setTimeout(() => setShow(false), holdMs);
    return () => clearTimeout(t);
  }, [holdMs, reduce]);

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            key="lb-top"
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={{ duration: 0.75, ease: [0.65, 0, 0.35, 1] }}
            className="fixed top-0 left-0 right-0 h-[3.5vh] sm:h-[5vh] md:h-[6vh] bg-black z-[55] pointer-events-none"
            aria-hidden
          />
          <motion.div
            key="lb-bot"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.75, ease: [0.65, 0, 0.35, 1] }}
            className="fixed bottom-0 left-0 right-0 h-[3.5vh] sm:h-[5vh] md:h-[6vh] bg-black z-[55] pointer-events-none"
            aria-hidden
          />
        </>
      )}
    </AnimatePresence>
  );
}
