/**
 * Live GPS track processing for the recorder: which fixes to trust, how to smooth them, and what they add up to.
 *
 *   - A fix is rejected when its accuracy is worse than 30 m ("weak GPS"), when reaching it from the last accepted
 *     fix would take more than 15 mph on foot / 40 mph on a bike / 60 mph on skis, or when it is under 3 m from the
 *     last accepted fix (standing-still jitter).
 *   - Accepted fixes are combined with a Kalman filter that weights each fix by its reported accuracy (a ±3 m fix
 *     counts far more than a ±25 m one) and by how far the walker could have gone since the last fix. The filtered
 *     position is usually closer to the truth than any single fix; distance is the sum of steps between them.
 *   - Following a trail, a filtered point within the GPS error of the trail line is placed on the line itself
 *     ("snap to trail"), so the track follows the real path instead of wandering a few meters either side.
 *   - Elevation comes from the trail's DEM profile when the fix is within 25 m of the trail (GPS altitude is good to
 *     about ±30 m); off the trail, GPS altitude is used. Climb is counted with a 10 ft hysteresis.
 *   - Moving time leaves out stops: stretches slower than 0.3 mph lasting more than 30 s.
 *   - Off-trail: more than 50 m from the trail line for more than 30 s.
 *   - Gaps: browsers stop GPS while the page is in the background. When fixes resume after 45 s or more, a walker
 *     who was on the followed trail at both ends is assumed to have kept to it, and the gap is filled with points
 *     along the trail's real line; otherwise the two fixes are joined directly (a lower bound on the distance).
 */
import { chainLines, Route } from "@/lib/geo/line";

export type GpsActivity = "hike" | "run" | "bike" | "ski";
export interface Fix { lat: number; lng: number; altitudeM: number | null; accuracyM: number; time: number; heading?: number | null; /** Placed along the trail to bridge a GPS gap, not measured. */ filled?: boolean }
/** A stretch with no GPS (usually the page in the background) and how it was bridged. */
export interface TrackGap { fromTime: number; toTime: number; meters: number; bridged: "trail" | "direct" }
export type FixVerdict = "accepted" | "weak" | "too-fast" | "jitter";
export interface TrackPoint { lat: number; lng: number; time: number; elevationFt: number | null; accuracyM: number; heading: number | null }
/** The trail being followed: its line and its DEM profile as [mile, feet] pairs. */
export interface TrailProfile { route: Route; profile: [number, number][] }

export const MAX_ACCURACY_M = 30;
export const MIN_STEP_M = 3;
/** How fast the true position can drift between fixes (m/s), the filter's process noise, by activity. */
export const DRIFT_MPS: Record<GpsActivity, number> = { hike: 1.5, run: 3, bike: 6, ski: 10 };
/** The accuracy the recorder aims for: under open sky, phones with precise location report ±3–5 m. */
export const TARGET_ACCURACY_M = 5;
/** Snap to the trail line when the filtered point is this close (never further than the fix's own error). */
const SNAP_TO_TRAIL_M = 15;
export const MAX_SPEED_MPH: Record<GpsActivity, number> = { hike: 15, run: 15, bike: 40, ski: 60 };
const SNAP_M = 25;
const GAIN_HYSTERESIS_FT = 10;
const STOP_MPH = 0.3;
const STOP_SEC = 30;
const OFF_TRAIL_M = 50;
const OFF_TRAIL_SEC = 30;
const MPS_PER_MPH = 0.44704;
export const GAP_SEC = 45;
const GAP_MIN_M = 60;
const FILL_STEP_M = 25;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Feet at a distance along the trail, interpolated from a [mile, feet] profile. */
export function profileFeetAt(profile: [number, number][], meters: number): number | null {
  if (!profile.length) return null;
  const mi = meters / 1609.344;
  if (mi <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    if (profile[i][0] >= mi) {
      const [m0, f0] = profile[i - 1], [m1, f1] = profile[i];
      return m1 > m0 ? f0 + ((f1 - f0) * (mi - m0)) / (m1 - m0) : f1;
    }
  }
  return profile[profile.length - 1][1];
}

export class TrackRecorder {
  readonly points: TrackPoint[] = [];
  /** Raw fixes that were accepted, in order (what a saved track is rebuilt from). */
  readonly accepted: Fix[] = [];
  distanceM = 0;
  gainFt = 0;
  offTrail = false;
  /** Distance from the followed trail at the last accepted fix, in meters (null without a trail). */
  offTrailM: number | null = null;
  readonly gaps: TrackGap[] = [];
  private movingMs = 0;
  private slowMs = 0;
  private lastRaw: Fix | null = null;
  private eleRef: number | null = null;
  private offSince: number | null = null;
  /** Kalman filter state: filtered position (unsnapped), its variance in m², and the time of the last update. */
  private kLat = 0;
  private kLng = 0;
  private kVar = -1;
  private kTime = 0;

  constructor(private activity: GpsActivity = "hike", private trail: TrailProfile | null = null, private snap = true) {}

  /** Estimated error of the filtered position, in meters (null before the first fix). */
  get filteredAccuracyM() { return this.kVar < 0 ? null : Math.sqrt(this.kVar); }

  setTrail(trail: TrailProfile | null) { this.trail = trail; }

  /**
   * Distance so far: the smoothed path plus the step from its end to the newest accepted fix (the moving average
   * trails the walker by a few meters, which would otherwise be lost at every stop and at the finish).
   */
  get totalDistanceM() {
    const p = this.points[this.points.length - 1], f = this.lastRaw;
    return this.distanceM + (p && f ? haversineM(p.lat, p.lng, f.lat, f.lng) : 0);
  }

  /** Moving time in seconds: stops (under 0.3 mph for more than 30 s) are left out. */
  get movingSec() { return Math.round((this.movingMs + (this.slowMs <= STOP_SEC * 1000 ? this.slowMs : 0)) / 1000); }

  /** Judges one fix; accepted fixes update the track. */
  push(fix: Fix): FixVerdict {
    if (!(fix.accuracyM <= MAX_ACCURACY_M)) return "weak";
    const last = this.lastRaw;
    if (last) {
      const step = haversineM(last.lat, last.lng, fix.lat, fix.lng);
      const dt = (fix.time - last.time) / 1000;
      if (step < MIN_STEP_M) return "jitter";
      if (dt > 0 && step / dt > MAX_SPEED_MPH[this.activity] * MPS_PER_MPH) return "too-fast";
      if (dt >= GAP_SEC && step >= GAP_MIN_M && !fix.filled) this.bridge(last, fix, step, dt);
    }
    this.accept(fix);
    return "accepted";
  }

  /** Fills a GPS gap along the followed trail when both ends are on it; otherwise records a direct join. */
  private bridge(from: Fix, to: Fix, step: number, dt: number) {
    const route = this.trail?.route;
    const a = route?.locate([from.lng, from.lat]), b = route?.locate([to.lng, to.lat]);
    const along = a && b ? b.alongMeters - a.alongMeters : 0;
    // On the trail at both ends, at a believable pace, and not a shortcut the trail itself goes far around.
    const onTrail = route && a && b && a.offMeters <= OFF_TRAIL_M && b.offMeters <= OFF_TRAIL_M && Math.abs(along) / dt <= MAX_SPEED_MPH[this.activity] * MPS_PER_MPH && Math.abs(along) <= step * 3 + 200;
    if (!onTrail) { this.gaps.push({ fromTime: from.time, toTime: to.time, meters: step, bridged: "direct" }); return; }
    const n = Math.max(1, Math.round(Math.abs(along) / FILL_STEP_M));
    for (let i = 1; i < n; i++) {
      const at = route.pointAt(a.alongMeters + (along * i) / n);
      if (at) this.accept({ lat: at[1], lng: at[0], altitudeM: null, accuracyM: Math.max(from.accuracyM, to.accuracyM), time: from.time + ((to.time - from.time) * i) / n, filled: true });
    }
    this.gaps.push({ fromTime: from.time, toTime: to.time, meters: Math.abs(along), bridged: "trail" });
  }

  private accept(fix: Fix) {
    const prev = this.points[this.points.length - 1];
    const acc2 = Math.max(1, fix.accuracyM) ** 2;
    if (this.kVar < 0) { this.kLat = fix.lat; this.kLng = fix.lng; this.kVar = acc2; }
    else {
      const dt = Math.max(0, (fix.time - this.kTime) / 1000);
      this.kVar += dt * DRIFT_MPS[this.activity] ** 2;
      const k = this.kVar / (this.kVar + acc2);
      this.kLat += k * (fix.lat - this.kLat);
      this.kLng += k * (fix.lng - this.kLng);
      this.kVar *= 1 - k;
    }
    this.kTime = fix.time;
    let lat = this.kLat, lng = this.kLng;
    if (this.snap && this.trail) {
      const on = this.trail.route.locate([lng, lat]);
      if (on.offMeters <= Math.min(SNAP_TO_TRAIL_M, Math.max(5, fix.accuracyM))) [lng, lat] = on.at;
    }
    // Elevation: the trail's DEM profile when on (or near) the trail, GPS altitude otherwise.
    let elevationFt = fix.altitudeM !== null && Number.isFinite(fix.altitudeM) ? fix.altitudeM * 3.28084 : null;
    if (this.trail) {
      const at = this.trail.route.locate([lng, lat]);
      this.offTrailM = at.offMeters;
      if (at.offMeters <= SNAP_M) elevationFt = profileFeetAt(this.trail.profile, at.alongMeters) ?? elevationFt;
      if (at.offMeters > OFF_TRAIL_M) { this.offSince ??= fix.time; this.offTrail = fix.time - this.offSince > OFF_TRAIL_SEC * 1000; }
      else { this.offSince = null; this.offTrail = false; }
    }
    if (elevationFt !== null) {
      if (this.eleRef === null) this.eleRef = elevationFt;
      else if (elevationFt - this.eleRef >= GAIN_HYSTERESIS_FT) { this.gainFt += elevationFt - this.eleRef; this.eleRef = elevationFt; }
      else if (this.eleRef - elevationFt >= GAIN_HYSTERESIS_FT) this.eleRef = elevationFt;
    }
    if (prev) {
      const step = haversineM(prev.lat, prev.lng, lat, lng);
      this.distanceM += step;
      const dt = fix.time - prev.time;
      if (dt > 0) {
        const mph = step / (dt / 1000) / MPS_PER_MPH;
        if (mph < STOP_MPH) this.slowMs += dt;
        else {
          // A slow stretch of 30 s or less was still moving (a pause to look around); longer ones were stops.
          if (this.slowMs <= STOP_SEC * 1000) this.movingMs += this.slowMs;
          this.slowMs = 0;
          this.movingMs += dt;
        }
      }
    }
    this.lastRaw = fix;
    this.accepted.push(fix);
    this.points.push({ lat, lng, time: fix.time, elevationFt, accuracyM: fix.accuracyM, heading: fix.heading ?? null });
  }
}

/** The trail profile for a followed trail, from its lines and its [mile, feet] elevation profile. */
export function trailProfile(lines: [number, number][][], profile: [number, number][]): TrailProfile | null {
  // Chained end to end like the elevation profile (src/web/trail-service.ts), so "mile X" means the same on both.
  const route = new Route(chainLines(lines.filter((l) => l.length > 1)));
  return route.points.length > 1 && profile.length > 1 ? { route, profile } : null;
}
