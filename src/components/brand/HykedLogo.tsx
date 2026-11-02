import { useId } from "react";

/**
 * The Hyked mark: a mountain range drawn in one line, with a trail winding up into it. Drawn in the current text
 * colour, so it follows the theme; size it with width/height or CSS. Decorative unless given a `title`.
 */
export function HykedLogo({ title, className, strokeScale = 1, animated = false }: { title?: string; className?: string; strokeScale?: number; /** Draw the lines in, ridge then trail (CSS, skipped for reduced motion). */ animated?: boolean }) {
  const clip = useId();
  const draw = animated ? { pathLength: 1, className: "hyked-logo-draw" } : {};
  return (
    <svg viewBox="268 278 1000 444" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} fill="none" stroke="currentColor">
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={clip}><rect x="250" y="265" width="1040" height="452" /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {/* The ridge line: its ends are cut flat along the ground. */}
        <polyline {...draw} points="281,726 501,486 565,546 759,302 871,448 933,402 1083,579 1100,552 1255,726" strokeWidth={28 * strokeScale} strokeLinejoin="miter" strokeMiterlimit={10} />
        {/* The trail, widening as it comes toward you. */}
        <path {...draw} style={animated ? { animationDelay: "0.9s" } : undefined} d="M849 438 C 800 455, 754 468, 762 485 C 770 499, 850 510, 893 522 C 930 533, 922 552, 878 567 C 800 592, 640 618, 575 648 C 520 674, 510 700, 515 730" strokeWidth={15 * strokeScale} />
        <path {...draw} style={animated ? { animationDelay: "1.5s" } : undefined} d="M575 650 C 526 672, 509 696, 515 730" strokeWidth={26 * strokeScale} />
      </g>
    </svg>
  );
}
