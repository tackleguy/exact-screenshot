import { avgSpeedMph, formatDistance, formatDuration, formatPace } from "@/lib/gps";

interface ActivityStatsProps {
  distanceM: number;
  durationSec: number;
  elevationGainFt: number;
  variant?: "compact" | "full";
  className?: string;
}

export function ActivityStats({
  distanceM,
  durationSec,
  elevationGainFt,
  variant = "full",
  className = "",
}: ActivityStatsProps) {
  const avgMph = avgSpeedMph(distanceM, durationSec);
  const pace = formatPace(distanceM, durationSec);

  if (variant === "compact") {
    return (
      <div className={`flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600 ${className}`}>
        <span>{formatDistance(distanceM)}</span>
        <span>{formatDuration(durationSec)}</span>
        <span>{elevationGainFt.toLocaleString()} ft ↑</span>
        {distanceM > 100 && <span>{pace}</span>}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${className}`}>
      <StatBlock label="Distance" value={formatDistance(distanceM)} />
      <StatBlock label="Moving time" value={formatDuration(durationSec)} />
      <StatBlock label="Elev gain" value={`${elevationGainFt.toLocaleString()} ft`} />
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
