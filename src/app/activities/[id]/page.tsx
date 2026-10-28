import { EstimatedRouteNote } from "@/components/activities/EstimatedRouteNote";
import { routeEstimates } from "@/lib/route-provenance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getActivity } from "@/lib/activities";
import { ACTIVITY_ICONS, ACTIVITY_LABELS } from "@/lib/types";
import { RouteMiniMap } from "@/components/activities/RouteMiniMap";
import { ActivityStats } from "@/components/activities/ActivityStats";
import { ElevationChart } from "@/components/gps/ElevationChart";
import type { GpsPoint } from "@/lib/types";

function geoJsonToPoints(route: {
  coordinates: [number, number, number?][];
}): GpsPoint[] {
  return route.coordinates.map((c, i) => ({
    lat: c[1],
    lng: c[0],
    altitude: c[2] ?? null,
    accuracy: 0,
    speed: null,
    heading: null,
    timestamp: Date.now() + i * 1000,
  }));
}

function formatTimeRange(started: string, ended: string | null, durationSec: number) {
  const start = new Date(started);
  const end = ended ? new Date(ended) : new Date(start.getTime() + durationSec * 1000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const activity = await getActivity(id);

  if (!activity) notFound();

  const date = new Date(activity.started_at).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const points = activity.route_geojson ? geoJsonToPoints(activity.route_geojson) : [];
  const distanceM = Number(activity.distance_m);

  return (
    <div className="pb-24 md:pb-8">
      <div className="relative">
        <RouteMiniMap route={activity.route_geojson} className="h-56 w-full md:h-80" />
        <EstimatedRouteNote route={activity.route_geojson} className="mx-auto max-w-2xl px-4 sm:px-6" />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-6">
          <div className="mx-auto max-w-2xl">
            <p className="text-sm text-stone-200">
              {ACTIVITY_ICONS[activity.activity_type]} {ACTIVITY_LABELS[activity.activity_type]} ·{" "}
              {date}
            </p>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">{activity.title}</h1>
            <p className="mt-1 text-sm text-stone-300">
              {formatTimeRange(activity.started_at, activity.ended_at, activity.duration_sec)}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Stats
          </h2>
          <ActivityStats
            distanceM={distanceM}
            durationSec={activity.duration_sec}
            elevationGainFt={Number(activity.elevation_gain_ft)}
            estimates={routeEstimates(activity.route_geojson)}
          />
        </div>

        {points.length >= 2 && (
          <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-stone-900">Elevation profile</h2>
            <p className="mb-3 text-xs text-stone-500">
              {points.length} {routeEstimates(activity.route_geojson) ? "points, some estimated while GPS was paused" : "GPS points"} · route stored as GeoJSON LineString
            </p>
            <ElevationChart points={points} height={140} />
          </div>
        )}

        {!activity.route_geojson && (
          <div className="mt-6 rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-5 text-center text-sm text-stone-500">
            Manual log — no GPS route recorded
          </div>
        )}

        {activity.trail && (
          <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">Linked trail</p>
            <Link
              href={`/explore/trails/${activity.trail.id}`}
              className="mt-1 font-semibold text-emerald-700 hover:underline"
            >
              {activity.trail.trail_name}
            </Link>
          </div>
        )}

        {activity.ski_area_name && (
          <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">Ski area</p>
            <Link
              href={`/explore/ski?area=${activity.ski_area_id}`}
              className="mt-1 font-semibold text-sky-700 hover:underline"
            >
              {activity.ski_area_name}
            </Link>
          </div>
        )}

        {activity.notes && (
          <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-500">Notes</p>
            <p className="mt-1 text-stone-700">{activity.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
