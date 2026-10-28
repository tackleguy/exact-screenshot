import { formatElevation } from "@/lib/units";
import { avgSpeedMph, formatDistance, formatDuration, formatPace } from "@/lib/gps";
import type { RouteEstimates } from "@/lib/types";

interface ActivityStatsProps {
  distanceM: number;
  durationSec: number;
  elevationGainFt: number;
  variant?: "compact" | "full";
  className?: string;
  /** Stretches GPS didn't measure (from routeEstimates); their share of distance and climb is shown. */
  estimates?: RouteEstimates | null;
}

export function ActivityStats({
  distanceM,
  durationSec,
  elevationGainFt,
  variant = "full",
  className = "",
  estimates = null,
}: ActivityStatsProps) {
  const estM = estimates?.meters ? Math.min(estimates.meters, distanceM) : 0;
  const estFt = estimates?.gainFt ? Math.min(estimates.gainFt, elevationGainFt) : 0;
  const avgMph = avgSpeedMph(distanceM, durationSec);
  const pace = formatPace(distanceM, durationSec);

  if (variant === "compact") {
    return (
      <div className={`flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600 ${className}`}>
        <span title={estM ? "Part of this distance was estimated while GPS was paused" : undefined}>{formatDistance(distanceM)}{estM > 0 && <small> ({formatDistance(estM)} est.)</small>}</span>
        <span>{formatDuration(durationSec)}</span>
        <span>{formatElevation(elevationGainFt)} ↑</span>
        {distanceM > 100 && <span>{pace}</span>}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${className}`}>
      <StatBlock label="Distance" value={formatDistance(distanceM)} sub={estM > 0 ? `incl. ${formatDistance(estM)} estimated` : undefined} />
      <StatBlock label="Moving time" value={formatDuration(durationSec)} />
      <StatBlock label="Elev gain" value={formatElevation(elevationGainFt) ?? "—"} sub={estFt > 0 ? `incl. ${formatElevation(estFt)} estimated` : undefined} />
      <StatBlock label="Avg pace" value={pace} />
      <StatBlock label="Avg speed" value={`${avgMph.toFixed(1)} mph`} />
      <StatBlock
        label="Calories"
        value="—"
        sub="Not tracked"
      />
    </div>
  );
}

function StatBlock({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-stone-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-stone-900">{value}</p>
      {sub && <p className="text-[10px] text-stone-400">{sub}</p>}
    </div>
  );
}
