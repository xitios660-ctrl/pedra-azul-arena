/**
 * Shared motion system — EA FC / motion-design studio presets.
 * All heavy effects respect prefers-reduced-motion via useMotionSystem().
 */
import { useReducedMotion } from "framer-motion";

export const easings = {
  outExpo: [0.16, 1, 0.3, 1],
  outQuint: [0.22, 1, 0.36, 1],
  cinematic: [0.65, 0, 0.35, 1],
  springSoft: { type: "spring", stiffness: 320, damping: 28 },
  springSnappy: { type: "spring", stiffness: 420, damping: 32 },
};

/** Static variant factories (ignore reduced-motion; wrap with useMotionSystem). */
export const variants = {
  fadeUp: {
    hidden: { opacity: 0, y: 28 },
    show: (delay = 0) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.55, delay, ease: easings.outExpo },
    }),
  },
  fadeIn: {
    hidden: { opacity: 0 },
    show: (delay = 0) => ({
      opacity: 1,
      transition: { duration: 0.45, delay, ease: "easeOut" },
    }),
  },
  scaleIn: {
    hidden: { opacity: 0, scale: 0.92 },
    show: (delay = 0) => ({
      opacity: 1,
      scale: 1,
      transition: { duration: 0.45, delay, ease: easings.outExpo },
    }),
  },
  slideX: {
    hidden: { opacity: 0, x: -28 },
    show: (delay = 0) => ({
      opacity: 1,
      x: 0,
      transition: { duration: 0.55, delay, ease: easings.outExpo },
    }),
  },
  modalIn: {
    hidden: { opacity: 0, scale: 0.94, y: 16 },
    show: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: 0.35, ease: easings.outExpo },
    },
    exit: {
      opacity: 0,
      scale: 0.96,
      y: 8,
      transition: { duration: 0.22 },
    },
  },
  staggerContainer: {
    hidden: {},
    show: {
      transition: { staggerChildren: 0.08, delayChildren: 0.06 },
    },
  },
  staggerItem: {
    hidden: { opacity: 0, y: 18 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: easings.outExpo },
    },
  },
};

/** Glow / select pulse — used as animate prop, not variants. */
export const glowPulse = {
  animate: {
    boxShadow: [
      "0 0 12px rgba(0,229,255,0.25)",
      "0 0 28px rgba(0,229,255,0.55)",
      "0 0 12px rgba(0,229,255,0.25)",
    ],
  },
  transition: { duration: 2.2, repeat: Infinity, ease: "easeInOut" },
};

export const selectFlash = {
  initial: { boxShadow: "0 0 0 0 rgba(0,229,255,0)" },
  animate: {
    boxShadow: [
      "0 0 0 0 rgba(0,229,255,0.6)",
      "0 0 24px 4px rgba(0,229,255,0.35)",
      "0 0 14px 0 rgba(0,229,255,0.2)",
    ],
  },
  transition: { duration: 0.55, ease: easings.outExpo },
};

/**
 * Hook: returns motion props that collapse to near-instant fades when
 * the user prefers reduced motion.
 */
export function useMotionSystem() {
  const reduce = !!useReducedMotion();

  const fadeUp = (delay = 0) =>
    reduce
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.01 },
        }
      : {
          initial: { opacity: 0, y: 28 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, delay, ease: easings.outExpo },
        };

  const fadeIn = (delay = 0) =>
    reduce
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.01 },
        }
      : {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.5, delay },
        };

  const scaleIn = (delay = 0) =>
    reduce
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.01 },
        }
      : {
          initial: { opacity: 0, scale: 0.92 },
          animate: { opacity: 1, scale: 1 },
          transition: { duration: 0.45, delay, ease: easings.outExpo },
        };

  const slideX = (delay = 0, from = -28) =>
    reduce
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.01 },
        }
      : {
          initial: { opacity: 0, x: from },
          animate: { opacity: 1, x: 0 },
          transition: { duration: 0.55, delay, ease: easings.outExpo },
        };

  const modalMotion = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : {
        initial: { opacity: 0, scale: 0.94, y: 16 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.96, y: 8 },
        transition: { duration: 0.35, ease: easings.outExpo },
      };

  const hoverLift = reduce
    ? {}
    : { whileHover: { y: -6, scale: 1.015 }, whileTap: { scale: 0.985 } };

  const hoverTilt = reduce
    ? {}
    : { whileHover: { y: -8, scale: 1.02 }, transition: easings.springSoft };

  const glowPulseAnim = reduce
    ? {}
    : {
        animate: glowPulse.animate,
        transition: glowPulse.transition,
      };

  const stagger = reduce
    ? { hidden: {}, show: { transition: { staggerChildren: 0 } } }
    : variants.staggerContainer;

  const staggerItem = reduce
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.01 } },
      }
    : variants.staggerItem;

  return {
    reduce,
    fadeUp,
    fadeIn,
    scaleIn,
    slideX,
    modalMotion,
    hoverLift,
    hoverTilt,
    glowPulseAnim,
    stagger,
    staggerItem,
    easings,
  };
}

export default useMotionSystem;
