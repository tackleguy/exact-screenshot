import PathFinder from "geojson-path-finder";
import { measureLines, metersBetween, type Lines, type Point } from "./quality";

export interface RouteTrail { id: string; name: string; lines: Lines }
export function connectedRoute(trails: RouteTrail[], start: Point, finish: Point) {
  if (metersBetween(start, finish) < 0.1) throw new Error("Choose different start and finish points.");
  const network: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
    type: "FeatureCollection",
    features: trails.flatMap(t => t.lines.filter(line => line.length > 1).map(coordinates => ({
      type: "Feature" as const, properties: { id: t.id }, geometry: { type: "LineString" as const, coordinates },
    }))),
  };
  const point = (coordinates: Point): GeoJSON.Feature<GeoJSON.Point> => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates } });
  // Only shared mapped vertices connect: do not bridge nearby but disconnected trails.
  const finder = new PathFinder(network, { tolerance: 1e-7, weight: (a, b) => metersBetween(a as Point, b as Point) });
  const path = finder.findPath(point(start), point(finish));
  if (!path || path.path.length < 2) throw new Error("No mapped connection between these points. Add a connecting trail or choose another endpoint.");
  const coordinates = path.path.map(p => [p[0], p[1]] as Point);
  return { coordinates, meters: measureLines([coordinates]).meters };
}
export function connectedGpx(points: Point[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Hyked" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Connected trail route</name><trkseg>${points.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`).join("")}</trkseg></trk></gpx>`;
}