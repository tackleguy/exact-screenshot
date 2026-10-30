// components/ui/trail-card.tsx
"use client";

import * as React from "react";
import { motion, type HTMLMotionProps, type Variants } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Define the props interface for type safety and reusability
interface TrailCardProps extends Omit<HTMLMotionProps<"div">, "title"> {
  imageUrl: string;
  mapImageUrl: string;
  title: string;
  location: string;
  difficulty: string;
  creators: string;
  distance: string;
  elevation: string;
  duration: string;
  onDirectionsClick?: () => void;
  /** Overlay content in the image's top corner (a save heart, a badge). */
  corner?: React.ReactNode;
}

// Define stat item component for DRY principle
const StatItem = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col">
    <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    <span className="text-xs text-muted-foreground">{label}</span>
  </div>
);

// The Directions button slides in when the card is hovered (variants run from the card down), and is always
// shown on touch screens, which have no hover (see .trail-card-directions in globals.css).
const directionsVariants: Variants = {
  rest: { opacity: 0, x: 20 },
  hover: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeInOut" } },
};

const TrailCard = React.forwardRef<HTMLDivElement, TrailCardProps>(
  (
    {
      className,
      imageUrl,
      mapImageUrl,
      title,
      location,
      difficulty,
      creators,
      distance,
      elevation,
      duration,
      onDirectionsClick,
      corner,
      ...props
    },
    ref
  ) => {
    return (
      <motion.div
        ref={ref}
        className={cn(
          "trail-card w-full max-w-sm overflow-hidden rounded-2xl bg-card text-card-foreground shadow-lg",
          className
        )}
        initial="rest"
        animate="rest"
        whileHover="hover"
        whileFocus="hover"
        variants={{ rest: { y: 0, scale: 1 }, hover: { y: -5, scale: 1.02 } }} // Subtle lift and scale on hover
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        {...props}
      >
        {/* Top section with background image and content */}
        <div className="relative h-60 w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- remote imagery */}
          <img
            src={imageUrl}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          {corner && <div className="absolute right-3 top-3 z-10">{corner}</div>}
          <div className="absolute bottom-0 left-0 flex w-full items-end justify-between gap-3 p-4">
            <div className="min-w-0 text-white">
              <h3 className="text-xl font-bold leading-tight">{title}</h3>
              <p className="truncate text-sm text-white/90">{location}</p>
            </div>
            {onDirectionsClick && (
              <motion.div className="trail-card-directions shrink-0" variants={directionsVariants}>
                <Button
                  variant="secondary"
                  onClick={(e) => { e.stopPropagation(); onDirectionsClick(); }}
                  aria-label={`Get directions to ${title}`}
                >
                  Directions
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </motion.div>
            )}
          </div>
        </div>

        {/* Bottom section with trail details */}
        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-foreground">{difficulty}</p>
              <p className="truncate text-xs text-muted-foreground">{creators}</p>
            </div>
            {/* Simple SVG or image representation of the trail map */}
            {/* eslint-disable-next-line @next/next/no-img-element -- remote map thumbnail */}
            <img
              src={mapImageUrl}
              alt="Trail map"
              loading="lazy"
              className="h-10 w-20 shrink-0 rounded-md object-cover"
            />
          </div>
          <div className="my-4 h-px w-full bg-border" />
          <div className="flex justify-between">
            <StatItem label="Distance" value={distance} />
            <StatItem label="Elevation" value={elevation} />
            <StatItem label="Duration" value={duration} />
          </div>
        </div>
      </motion.div>
    );
  }
);

TrailCard.displayName = "TrailCard";

export { TrailCard };
