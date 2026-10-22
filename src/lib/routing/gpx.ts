import { FEATURE_LABELS, type RouteFeature } from "./features";
import type { LngLat } from "./graph";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** GPX 1.1: the route as one track, plus a waypoint for every feature along it (with its mile). */
export function routeGpx(name: string, coordinates: LngLat[], features: RouteFeature[] = [], elevationFt?: (number | null)[]) {
  const wpts = features.map((f) =>
    `<wpt lat="${f.lat.toFixed(6)}" lon="${f.lon.toFixed(6)}"><name>${esc(f.name)}</name><desc>${esc(`${FEATURE_LABELS[f.type] ?? f.type} · mile ${f.mile.toFixed(1)}${f.offRouteFt > 60 ? ` · ${f.offRouteFt.toLocaleString("en-US")} ft off route` : ""} · ${f.source}`)}</desc><type>${esc(f.type)}</type></wpt>`,
  ).join("");
  const pts = coordinates.map(([lon, lat], i) => {
    const ft = elevationFt?.[i];
    return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${Number.isFinite(ft) ? `<ele>${(Number(ft) / 3.28084).toFixed(1)}</ele>` : ""}</trkpt>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hyked" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(name)}</name><desc>Built with the Hyked route builder on OpenStreetMap and official trail data (ODbL / public domain). Check conditions and access before you go.</desc></metadata>${wpts}<trk><name>${esc(name)}</name><trkseg>${pts}</trkseg></trk></gpx>\n`;
}

export function downloadGpx(name: string, gpx: string) {
  const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "hyked-route"}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
