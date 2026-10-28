import { formatElevation } from "@/lib/units";
import { formatDistance } from "@/lib/gps";
import { routeEstimates } from "@/lib/route-provenance";
import type { GeoLineString } from "@/lib/types";

/** Under an activity's map: what the dashed stretches are, and how much of the totals they make up. */
export function EstimatedRouteNote({ route, className = "" }: { route: GeoLineString | null; className?: string }) {
  const e = routeEstimates(route);
  if (!e) return null;
  const kinds = new Set(e.ranges.map((r) => r[2]));
  const amounts = [e.meters > 0 ? formatDistance(e.meters) : null, e.gainFt > 0 ? `${formatElevation(e.gainFt)} of climb` : null].filter(Boolean).join(" and ");
  return (
    <p className={`activity-estimated-note ${className}`} role="note">
      <strong>Dashed parts weren’t measured by GPS</strong> — the phone paused location while Hyked was in the background.{" "}
      {kinds.has("trail") && "Where both ends were on the trail, the route follows the mapped trail between them. "}
      {kinds.has("direct") && "Straight dashed lines join the last and next GPS fixes; the real path there is unknown. "}
      {amounts && <>The totals include {amounts} estimated this way.</>}
    </p>
  );
}
