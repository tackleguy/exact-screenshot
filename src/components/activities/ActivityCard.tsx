import Link from "next/link";
import type { Activity } from "@/lib/types";
import { ACTIVITY_ICONS, ACTIVITY_LABELS } from "@/lib/types";
import { ACTIVITY_THEME } from "@/lib/activity-theme";
import { avgSpeedMph, formatDistance, formatDuration, formatPace } from "@/lib/gps";
import { RouteMiniMap } from "@/components/activities/RouteMiniMap";
import { ActivityStats } from "@/components/activities/ActivityStats";
import { routeEstimates } from "@/lib/route-provenance";
import clsx from "clsx";

export function ActivityCard({ activity }: { activity: Activity }) {
  const theme = ACTIVITY_THEME[activity.activity_type];
  const date = new Date(activity.started_at).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = new Date(activity.started_at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const distanceM = Number(activity.distance_m);
  const avgMph = avgSpeedMph(distanceM, activity.duration_sec);

  return (
    <Link
      href={`/activities/${activity.id}`}
      className="card-lift group block overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm"
    >
      <div className="relative">
        <RouteMiniMap route={activity.route_geojson} className="h-44 w-full" />
        <div
          className={clsx(
            "absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent",
            `from-black/40`,
          )}
        />
        <div
          className={clsx(
            "absolute left-3 top-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-xl text-white shadow-lg ring-2",
            theme.gradient,
            theme.ring,
          )}
        >
          {ACTIVITY_ICONS[activity.activity_type]}
        </div>
        <span
          className={clsx(
            "absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm",
            `bg-gradient-to-r ${theme.gradient}`,
          )}
        >
          {theme.label}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg font-semibold text-stone-900 group-hover:text-pine">
              {activity.title}
            </h3>
            <p className="text-sm text-stone-500">
              {ACTIVITY_LABELS[activity.activity_type]} · {date} at {time}
            </p>
          </div>
          {distanceM > 0 && (
            <span
              className={clsx(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums",
                theme.accent,
                "bg-stone-50 ring-1 ring-stone-200/80",
              )}
            >
              {formatPace(distanceM, activity.duration_sec)}
            </span>
          )}
        </div>

        {(activity.trail || activity.ski_area_name) && (
          <p className={clsx("mt-2 truncate text-xs font-medium", theme.accent)}>
            📍 {activity.trail?.trail_name ?? activity.ski_area_name}
          </p>
        )}

        <ActivityStats
          className="mt-3"
          variant="compact"
          distanceM={distanceM}
          durationSec={activity.duration_sec}
          elevationGainFt={Number(activity.elevation_gain_ft)}
          estimates={routeEstimates(activity.route_geojson)}
        />

        {distanceM > 100 && (
          <p className="mt-2 text-xs text-stone-400">
            Avg {avgMph.toFixed(1)} mph · {formatDistance(distanceM)} ·{" "}
            {formatDuration(activity.duration_sec)}
          </p>
        )}
      </div>
    </Link>
  );
}
