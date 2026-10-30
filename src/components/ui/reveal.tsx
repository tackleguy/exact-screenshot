"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

/**
 * Fades and lifts its content into view the first time it scrolls into the viewport. Only opacity and a small
 * translate are animated, and Motion skips the movement for visitors who ask for reduced motion (MotionConfig in
 * src/web/main.tsx). Don't wrap anything with position: fixed or sticky inside: a transformed parent changes
 * what those are positioned against.
 */
export function Reveal({ delay = 0, y = 18, children, ...props }: HTMLMotionProps<"div"> & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1], delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** For list items: each one rises in slightly after the one before (capped so long lists don't wait). */
export const staggerItem = (index: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number], delay: Math.min(index, 12) * 0.035 },
});
