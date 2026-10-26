import { formatDistance, formatElevation } from "@/lib/units";
import Link from "next/link";
import Image from "next/image";
import type { Trail } from "@/lib/types";
import { difficultyColor, formatRating } from "@/lib/utils";

export function TrailCard({ trail }: { trail: Trail }) {
  return (
    <Link
      href={`/explore/trails/${trail.id}`}
      className="card-lift group overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)] bg-surface-elevated"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-muted">
        {trail.image_url ? (
          <Image
            src={trail.image_url}
            alt={trail.trail_name}
            fill
            className="object-cover transition duration-700 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-pine/30 to-forest text-5xl opacity-40">
            🥾
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-forest via-forest/30 to-transparent" />
        <span
          className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${difficultyColor(trail.difficulty)}`}
        >
          {trail.difficulty}
        </span>
        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="font-display text-lg font-semibold text-cream">
            {trail.trail_name}
          </h3>
          {trail.park && (
            <p className="mt-0.5 text-xs text-sage">
              {trail.park.park_name}, {trail.park.state}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3 text-sm text-sage">
        <span>{formatDistance(trail.length_miles)}</span>
        <span>{formatElevation(trail.elevation_ft)} ↑</span>
        <span className="font-semibold text-accent">★ {formatRating(trail.avg_rating)}</span>
      </div>
    </Link>
  );
}
