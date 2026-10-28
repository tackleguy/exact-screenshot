import { formatElevation } from "@/lib/units";
import Link from "next/link";
import type { Activity } from "@/lib/types";
import { ACTIVITY_LABELS } from "@/lib/types";
import { formatDistance, formatDuration } from "@/lib/gps";
import { RouteSparkline } from "@/components/activities/RouteSparkline";
import { routeEstimates } from "@/lib/route-provenance";

export function ActivityListRow({ activity }: { activity: Activity }) {
  const estimatedM = Math.min(routeEstimates(activity.route_geojson)?.meters ?? 0, Number(activity.distance_m));
  const date = new Date(activity.started_at).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/activities/${activity.id}`}
      className="group flex items-center gap-4 rounded-[var(--radius-xl)] border border-[var(--border)] bg-surface-elevated p-3 transition hover:border-[var(--border-strong)] hover:bg-surface-muted"
    >
      <RouteSparkline route={activity.route_geojson} className="h-14 w-14 shrink-0 p-2" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-semibold text-cream group-hover:text-accent">
          {activity.title}
        </p>
        <p className="mt-0.5 text-xs text-mist">
          {ACTIVITY_LABELS[activity.activity_type]} · {date}
        </p>
        <p className="mt-1 text-xs tabular-nums text-sage">
          {formatDistance(Number(activity.distance_m))}
          {estimatedM > 0 && <span title="Part of this distance was estimated while GPS was paused"> ({formatDistance(estimatedM)} est.)</span>} ·{" "}
          {formatDuration(activity.duration_sec)} ·{" "}
          {formatElevation(Number(activity.elevation_gain_ft))} ↑
        </p>
      </div>
      <span className="shrink-0 text-mist transition group-hover:translate-x-0.5 group-hover:text-accent">
        →
      </span>
    </Link>
  );
}
