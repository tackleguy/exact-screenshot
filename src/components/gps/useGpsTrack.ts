"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeHeading, formatDistance, formatDuration, mpsToMph, pointsToGeoJSON, smoothSpeed } from "@/lib/gps";
import { TrackRecorder, type Fix, type GpsActivity, type TrailProfile } from "@/lib/gps-track";
import { clearTrack, loadTrack, saveTrack, type SavedTrack } from "@/lib/track-store";
import type { GpsPoint } from "@/lib/types";

export type RecorderState = "idle" | "acquiring" | "recording" | "paused" | "saving";
export type GpsQuality = "excellent" | "good" | "fair" | "poor" | "unknown";

/** Green under 10 m, yellow 10–30 m, red over 30 m. */
export function qualityFromAccuracy(m: number | null): GpsQuality {
  if (m === null) return "unknown";
  if (m < 10) return "excellent";
  if (m <= 30) return "fair";
  return "poor";
}

/** What the screen shows of the track, copied from the recorder after each accepted fix. */
interface Snapshot { points: GpsPoint[]; distanceM: number; gainFt: number; movingSec: number; offTrail: boolean; offTrailM: number | null; firstTime: number | null; lastTime: number | null }
const EMPTY: Snapshot = { points: [], distanceM: 0, gainFt: 0, movingSec: 0, offTrail: false, offTrailM: null, firstTime: null, lastTime: null };
function snapshot(r: TrackRecorder): Snapshot {
  const points: GpsPoint[] = r.points.map((p) => ({ lat: p.lat, lng: p.lng, altitude: p.elevationFt !== null ? p.elevationFt / 3.28084 : null, accuracy: p.accuracyM, speed: null, heading: p.heading, timestamp: p.time }));
  return { points, distanceM: r.totalDistanceM, gainFt: Math.round(r.gainFt), movingSec: r.movingSec, offTrail: r.offTrail, offTrailM: r.offTrailM, firstTime: r.points[0]?.time ?? null, lastTime: r.points[r.points.length - 1]?.time ?? null };
}

const WATCH: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 };
const SAVE_EVERY = 10;

type WakeLockSentinelLike = { release: () => Promise<void> };

/**
 * Live recording: watchPosition with high accuracy (re-requested after a timeout), fixes filtered and smoothed by
 * TrackRecorder (src/lib/gps-track.ts), the screen kept awake, a warning when the tab goes to the background (browsers
 * pause GPS there), and the track saved to IndexedDB every 10 points so a crash or refresh can resume it.
 */
export function useGpsTrack({ activity = "hike", title = "", trailId = null, trail = null }: { activity?: GpsActivity; title?: string; trailId?: string | null; trail?: TrailProfile | null } = {}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [current, setCurrent] = useState<{ lat: number; lng: number; accuracy: number; altitudeFt: number | null; heading: number | null } | null>(null);
  const [weakGps, setWeakGps] = useState(false);
  const [speedMph, setSpeedMph] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [backgrounded, setBackgrounded] = useState(false);
  const [saved, setSaved] = useState<SavedTrack | null>(null);
  const recorder = useRef(new TrackRecorder(activity, trail));
  const watchId = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const pausedMs = useRef(0);
  const pauseStarted = useRef<number | null>(null);
  const stateRef = useRef(state);
  const speedAvg = useRef(0);
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);
  const meta = useRef({ activity, title, trailId });
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { meta.current = { activity, title, trailId }; }, [activity, title, trailId]);
  useEffect(() => { recorder.current.setTrail(trail); }, [trail]);

  // A recording left unfinished (crash, refresh, closed tab) is offered for resuming.
  useEffect(() => { void loadTrack().then((t) => { if (t?.fixes.length) setSaved(t); }); }, []);

  // Elapsed time, ticking while recording.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => { if (startedAt.current) setElapsedSec(Math.floor((Date.now() - startedAt.current - pausedMs.current) / 1000)); }, 1000);
    return () => clearInterval(id);
  }, [state]);

  const persist = useCallback(() => {
    const r = recorder.current;
    if (!startedAt.current || !r.accepted.length) return;
    void saveTrack({ ...meta.current, startedAt: startedAt.current, pausedMs: pausedMs.current, fixes: r.accepted, savedAt: Date.now() });
  }, []);

  const keepAwake = useCallback(async (on: boolean) => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
    if (!on) { await wakeLock.current?.release().catch(() => undefined); wakeLock.current = null; return; }
    if (!nav.wakeLock || wakeLock.current) return;
    wakeLock.current = await nav.wakeLock.request("screen").catch(() => null);
  }, []);

  const onFix = useCallback((position: GeolocationPosition) => {
    const c = position.coords;
    const fix: Fix = { lat: c.latitude, lng: c.longitude, altitudeM: c.altitude, accuracyM: c.accuracy, time: position.timestamp || Date.now(), heading: c.heading };
    setWeakGps(c.accuracy > 30);
    if (c.speed !== null && c.speed >= 0) { speedAvg.current = smoothSpeed(speedAvg.current, mpsToMph(c.speed)); setSpeedMph(speedAvg.current); }
    const r = recorder.current;
    if (stateRef.current === "acquiring") {
      // Recording starts at the first fix good enough to keep.
      if (c.accuracy > 30) { setCurrent({ lat: fix.lat, lng: fix.lng, accuracy: c.accuracy, altitudeFt: null, heading: null }); return; }
      startedAt.current ??= Date.now();
      setState("recording");
      stateRef.current = "recording";
    }
    if (stateRef.current !== "recording") return;
    const verdict = r.push(fix);
    const last = r.points[r.points.length - 1];
    const prev = r.points[r.points.length - 2];
    setCurrent({
      lat: fix.lat, lng: fix.lng, accuracy: c.accuracy,
      altitudeFt: last?.elevationFt ?? (c.altitude !== null ? c.altitude * 3.28084 : null),
      heading: c.heading ?? (prev && last ? computeHeading(prev.lat, prev.lng, last.lat, last.lng) : null),
    });
    if (verdict === "accepted") {
      setSnap(snapshot(r));
      if (r.accepted.length % SAVE_EVERY === 0) persist();
    }
  }, [persist]);

  const rewatch = useRef<() => void>(() => undefined);
  const watch = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(onFix, (err) => {
      // A timeout only means no fix arrived in 10 s (tree cover, a canyon): ask again.
      if (err.code === err.TIMEOUT) { if (stateRef.current === "recording" || stateRef.current === "acquiring") rewatch.current(); return; }
      setError(err.message || "Location is unavailable.");
      if (stateRef.current === "acquiring") setState("idle");
    }, WATCH);
  }, [onFix]);
  useEffect(() => { rewatch.current = watch; }, [watch]);

  // Browsers pause GPS in background tabs: warn, and take the wake lock back when the tab returns.
  useEffect(() => {
    const onVisibility = () => {
      const active = stateRef.current === "recording" || stateRef.current === "acquiring";
      if (document.visibilityState === "hidden" && active) setBackgrounded(true);
      if (document.visibilityState === "visible" && active) void keepAwake(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [keepAwake]);

  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); void keepAwake(false); }, [keepAwake]);

  const begin = useCallback((restore?: SavedTrack) => {
    setError(null);
    recorder.current = new TrackRecorder(restore?.activity ?? activity, trail);
    pausedMs.current = restore?.pausedMs ?? 0;
    pauseStarted.current = null;
    startedAt.current = restore?.startedAt ?? null;
    for (const f of restore?.fixes ?? []) recorder.current.push(f);
    speedAvg.current = 0;
    setSpeedMph(0);
    setSnap(snapshot(recorder.current));
    setSaved(null);
    setState(restore ? "recording" : "acquiring");
    stateRef.current = restore ? "recording" : "acquiring";
    void keepAwake(true);
    watch();
  }, [activity, trail, keepAwake, watch]);

  const start = useCallback(() => { void clearTrack(); begin(); }, [begin]);
  const resumeSaved = useCallback(() => { if (saved) begin(saved); }, [begin, saved]);
  const discardSaved = useCallback(() => { setSaved(null); void clearTrack(); }, []);

  const pause = useCallback(() => {
    pauseStarted.current = Date.now();
    setState("paused");
    persist();
  }, [persist]);

  const resume = useCallback(() => {
    if (pauseStarted.current) { pausedMs.current += Date.now() - pauseStarted.current; pauseStarted.current = null; }
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void keepAwake(false);
    setState("saving");
  }, [keepAwake]);

  /** After a successful save, the in-progress copy is no longer needed. */
  const forget = useCallback(() => { void clearTrack(); }, []);

  const { points, distanceM } = snap;
  const durationSec = elapsedSec || (snap.firstTime !== null && snap.lastTime !== null ? Math.round((snap.lastTime - snap.firstTime) / 1000) : 0);

  return {
    state, setState, error,
    points, pointCount: points.length,
    currentSpeedMph: speedMph,
    currentAltitudeFt: current?.altitudeFt ?? null,
    currentLat: current?.lat ?? null,
    currentLng: current?.lng ?? null,
    currentHeading: current?.heading ?? null,
    currentAccuracy: current?.accuracy ?? null,
    gpsQuality: qualityFromAccuracy(current?.accuracy ?? null),
    acquiringProgress: state === "acquiring" ? current?.accuracy ?? null : null,
    weakGps,
    distanceM,
    elevationGainFt: snap.gainFt,
    durationSec,
    movingSec: snap.movingSec,
    offTrail: snap.offTrail,
    offTrailM: snap.offTrailM,
    backgrounded, dismissBackgrounded: () => setBackgrounded(false),
    savedTrack: saved, resumeSaved, discardSaved, forget,
    routeGeoJSON: points.length >= 2 ? pointsToGeoJSON(points) : null,
    formattedDistance: formatDistance(distanceM),
    formattedDuration: formatDuration(durationSec),
    start, pause, resume, stop,
  };
}
