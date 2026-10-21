/**
 * Precision Geospatial Snapping, Map Matching, Projection & Dynamic LOD.
 *
 * Implements:
 * - WGS 84 (EPSG:4326) <-> Web Mercator (EPSG:3857) projection math.
 * - Point-to-segment orthogonal projection and nearest-point snapping.
 * - GPS track / waypoint snapping to valid trail vector geometry.
 * - Dynamic Douglas-Peucker LOD thresholds calibrated by zoom level.
 */

export type LngLat = [number, number]; // [longitude, latitude] in EPSG:4326

export interface SnappedPoint {
  /** The snapped point coordinates on the trail line [lng, lat] */
  snapped: LngLat;
  /** Distance from input point to snapped trail line in meters */
  distanceMeters: number;
  /** Cumulative distance along the line up to this snapped point in meters */
  alongMeters: number;
  /** 0-indexed line segment where the point snapped */
  segmentIndex: number;
  /** Original query point */
  original: LngLat;
  /** True if within acceptable snapping tolerance */
  isSnapped: boolean;
}

const R_EARTH = 6378137.0; // WGS 84 Earth equatorial radius in meters
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Convert EPSG:4326 [lng, lat] to EPSG:3857 [x, y] (Web Mercator meters) */
export function toWebMercator([lng, lat]: LngLat): [number, number] {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = R_EARTH * lng * RAD;
  const y = R_EARTH * Math.log(Math.tan(Math.PI / 4 + (clampedLat * RAD) / 2));
  return [x, y];
}

/** Convert EPSG:3857 [x, y] to EPSG:4326 [lng, lat] (WGS 84 degrees) */
export function toWgs84([x, y]: [number, number]): LngLat {
  const lng = (x / R_EARTH) * DEG;
  const lat = (2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * DEG;
  return [lng, lat];
}

/** Accurate Haversine distance in meters between two [lng, lat] points */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * Snap a point [lng, lat] to the nearest position on a line string.
 * Uses planar Web Mercator projection locally to compute exact orthogonal projections
 * without latitude distortion, then projects back to EPSG:4326.
 */
export function snapPointToLine(
  point: LngLat,
  line: LngLat[],
  toleranceMeters = 50,
): SnappedPoint {
  if (line.length === 0) {
    return {
      snapped: point,
      distanceMeters: Infinity,
      alongMeters: 0,
      segmentIndex: -1,
      original: point,
      isSnapped: false,
    };
  }

  if (line.length === 1) {
    const dist = haversineMeters(point, line[0]);
    return {
      snapped: line[0],
      distanceMeters: dist,
      alongMeters: 0,
      segmentIndex: 0,
      original: point,
      isSnapped: dist <= toleranceMeters,
    };
  }

  // Pre-project to Web Mercator for conformal orthogonal geometry
  const pMerc = toWebMercator(point);
  let minDistanceMeters = Infinity;
  let bestMerc: [number, number] = pMerc;
  let bestSegmentIndex = 0;
  let bestAlongMeters = 0;

  let cumulativeDistance = 0;
  let runningAlongAtBest = 0;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segMeters = haversineMeters(a, b);

    const aMerc = toWebMercator(a);
    const bMerc = toWebMercator(b);

    const dx = bMerc[0] - aMerc[0];
    const dy = bMerc[1] - aMerc[1];
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((pMerc[0] - aMerc[0]) * dx + (pMerc[1] - aMerc[1]) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projMerc: [number, number] = [aMerc[0] + t * dx, aMerc[1] + t * dy];
    const projWgs = toWgs84(projMerc);
    const distMeters = haversineMeters(point, projWgs);

    if (distMeters < minDistanceMeters) {
      minDistanceMeters = distMeters;
      bestMerc = projMerc;
      bestSegmentIndex = i;
      runningAlongAtBest = cumulativeDistance + t * segMeters;
    }

    cumulativeDistance += segMeters;
  }

  const snapped = toWgs84(bestMerc);
  return {
    snapped,
    distanceMeters: Math.round(minDistanceMeters * 10) / 10,
    alongMeters: Math.round(runningAlongAtBest * 10) / 10,
    segmentIndex: bestSegmentIndex,
    original: point,
    isSnapped: minDistanceMeters <= toleranceMeters,
  };
}

/**
 * Snap a point to the nearest line among multiple candidates (MultiLineString or multiple trails).
 */
export function snapPointToNearestLine(
  point: LngLat,
  lines: LngLat[][],
  toleranceMeters = 60,
): (SnappedPoint & { lineIndex: number }) | null {
  let best: (SnappedPoint & { lineIndex: number }) | null = null;

  for (let i = 0; i < lines.length; i++) {
    const candidate = snapPointToLine(point, lines[i], toleranceMeters);
    if (!best || candidate.distanceMeters < best.distanceMeters) {
      best = { ...candidate, lineIndex: i };
    }
  }

  return best;
}

/**
 * Snap an entire sequence of GPS trace waypoints to the nearest continuous trail path.
 * Eliminates GPS jitter and off-trail drift.
 */
export function snapGpsTraceToTrail(
  trace: LngLat[],
  trailLines: LngLat[][],
  maxDeviationMeters = 40,
): LngLat[] {
  if (trace.length === 0) return [];
  const snappedTrace: LngLat[] = [];

  for (const pt of trace) {
    const match = snapPointToNearestLine(pt, trailLines, maxDeviationMeters);
    if (match && match.isSnapped) {
      snappedTrace.push(match.snapped);
    } else {
      snappedTrace.push(pt);
    }
  }

  return snappedTrace;
}

/**
 * Dynamic Douglas-Peucker simplification tolerance by zoom level (z).
 * At close zooms (z >= 14), keeps high vertex density (< 1.5 meters).
 * At regional zooms (z < 11), reduces vertices for optimal tile throughput.
 */
export function dynamicZoomTolerance(zoom: number): number {
  if (zoom >= 16) return 0.000008; // ~0.8m
  if (zoom >= 14) return 0.000018; // ~2m (preserves all switchbacks)
  if (zoom >= 12) return 0.00006;  // ~6m
  if (zoom >= 10) return 0.00018;  // ~20m
  return 0.0006;                   // ~65m
}

/**
 * Level-Of-Detail Douglas-Peucker line simplification adhering to the dynamic zoom threshold.
 */
export function simplifyForZoom(line: LngLat[], zoom: number): LngLat[] {
  if (line.length <= 2) return line;
  const tolerance = dynamicZoomTolerance(zoom);
  const tolSq = tolerance * tolerance;

  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;

  const stack: [number, number][] = [[0, line.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = line[start];
    const [bx, by] = line[end];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let maxDistSq = -1;
    let maxIdx = -1;

    for (let i = start + 1; i < end; i++) {
      const [px, py] = line[i];
      let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const distSq = ex * ex + ey * ey;

      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxIdx = i;
      }
    }

    if (maxDistSq > tolSq && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  return line.filter((_, i) => keep[i] === 1);
}
