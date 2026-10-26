import { formatDistance, formatElevation } from "@/lib/units";
import Link from "next/link";
import Image from "next/image";
import type { Trail } from "@/lib/types";
import { difficultyColor, formatRating } from "@/lib/utils";

export function FeaturedTrailCard({ trail }: { trail: Trail }) {
  return (
    <Link
      href={`/explore/trails/${trail.id}`}
      className="card-lift group relative flex w-[280px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)] bg-surface-elevated sm:w-[320px]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-muted">
        {trail.image_url ? (
          <Image
            src={trail.image_url}
            alt={trail.trail_name}
            fill
            className="object-cover transition duration-700 group-hover:scale-105"
            sizes="320px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-pine/40 to-forest text-5xl opacity-50">
            🥾
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-forest via-forest/20 to-transparent" />
        <span
          className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${difficultyColor(trail.difficulty)}`}
        >
          {trail.difficulty}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-display text-lg font-semibold text-cream group-hover:text-accent">
          {trail.trail_name}
        </h3>
        {trail.park && (
          <p className="mt-0.5 text-xs text-mist">
            {trail.park.park_name}, {trail.park.state}
          </p>
        )}
        <div className="mt-3 flex items-center gap-3 text-xs text-sage">
          <span>{formatDistance(trail.length_miles)}</span>
          <span className="text-mist">·</span>
          <span>{formatElevation(trail.elevation_ft)}</span>
          <span className="ml-auto font-semibold text-accent">
            ★ {formatRating(trail.avg_rating)}
          </span>
        </div>
      </div>
    </Link>
  );
}
