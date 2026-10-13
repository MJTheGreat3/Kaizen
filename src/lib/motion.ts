import type { Transition, Variants } from "motion/react";

/** House easing: quick start, long soft landing. */
export const ease = [0.16, 1, 0.3, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 420, damping: 36 };

/** Parent that reveals its children one after another. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
};

/** Child that rises into place. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};
