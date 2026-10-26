/**
 * Live GPS track processing for the recorder: which fixes to trust, how to smooth them, and what they add up to.
 *
 *   - A fix is rejected when its accuracy is worse than 30 m ("weak GPS"), when reaching it from the last accepted
 *     fix would take more than 15 mph on foot / 40 mph on a bike / 60 mph on skis, or when it is under 3 m from the
 *     last accepted fix (standing-still jitter).
 *   - Accepted fixes are smoothed with an exponential moving average (alpha 0.3) on latitude and longitude; distance
 *     is the sum of great-circle steps between smoothed points only.
 *   - Elevation comes from the trail's DEM profile when the fix is within 25 m of the trail (GPS altitude is good to
 *     about ±30 m); off the trail, GPS altitude is used. Climb is counted with a 10 ft hysteresis.
 *   - Moving time leaves out stops: stretches slower than 0.3 mph lasting more than 30 s.
 *   - Off-trail: more than 50 m from the trail line for more than 30 s.
 */
import { Route } from "@/lib/geo/line";

export type GpsActivity = "hike" | "run" | "bike" | "ski";
export interface Fix { lat: number; lng: number; altitudeM: number | null; accuracyM: number; time: number; heading?: number | null }
export type FixVerdict = "accepted" | "weak" | "too-fast" | "jitter";
export interface TrackPoint { lat: number; lng: number; time: number; elevationFt: number | null; accuracyM: number; heading: number | null }
/** The trail being followed: its line and its DEM profile as [mile, feet] pairs. */
export interface TrailProfile { route: Route; profile: [number, number][] }

export const MAX_ACCURACY_M = 30;
export const MIN_STEP_M = 3;
export const EMA_ALPHA = 0.3;
export const MAX_SPEED_MPH: Record<GpsActivity, number> = { hike: 15, run: 15, bike: 40, ski: 60 };
const SNAP_M = 25;
const GAIN_HYSTERESIS_FT = 10;
const STOP_MPH = 0.3;
const STOP_SEC = 30;
const OFF_TRAIL_M = 50;
const OFF_TRAIL_SEC = 30;
const MPS_PER_MPH = 0.44704;

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
  private movingMs = 0;
  private slowMs = 0;
  private lastRaw: Fix | null = null;
  private eleRef: number | null = null;
  private offSince: number | null = null;

  constructor(private activity: GpsActivity = "hike", private trail: TrailProfile | null = null) {}

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
    }
    this.accept(fix);
    return "accepted";
  }

  private accept(fix: Fix) {
    const prev = this.points[this.points.length - 1];
    const lat = prev ? prev.lat + EMA_ALPHA * (fix.lat - prev.lat) : fix.lat;
    const lng = prev ? prev.lng + EMA_ALPHA * (fix.lng - prev.lng) : fix.lng;
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
  const route = new Route(lines.filter((l) => l.length > 1));
  return route.points.length > 1 && profile.length > 1 ? { route, profile } : null;
}
