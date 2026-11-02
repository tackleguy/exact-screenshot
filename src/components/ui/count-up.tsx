"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";

/** A number that counts up from zero the first time it scrolls into view (shown at once for reduced motion). */
export function CountUp({ value, duration = 1.6, format = (n: number) => Math.round(n).toLocaleString("en-US") }: { value: number; duration?: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, { duration: reduce ? 0 : duration, ease: [0.2, 0.8, 0.2, 1], onUpdate: setShown });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);
  return <span ref={ref} className="tabular-nums">{format(shown)}</span>;
}
