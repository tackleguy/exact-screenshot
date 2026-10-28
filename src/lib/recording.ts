/**
 * The live GPS recording, kept for the whole site rather than inside the recorder page: it keeps tracking while
 * the hiker opens a trail page, the map or anything else on Hyked, and a "Recording" pill in the navigation leads
 * back. One recording at a time.
 *
 * What a website can and can't do: browsers stop GPS when the page is in the background (another app, a locked
 * screen). So the recording keeps the screen awake, saves itself to IndexedDB whenever the page is hidden (a phone
 * may close a background tab), asks for a fresh fix the moment the page is visible again, and bridges the gap
 * along the trail being followed (src/lib/gps-track.ts).
 */
import { useSyncExternalStore } from "react";
import { computeHeading, mpsToMph, smoothSpeed } from "@/lib/gps";
import { GAP_SEC, TrackRecorder, type Fix, type GpsActivity, type TrackGap, type TrailProfile } from "@/lib/gps-track";
import { clearTrack, loadTrack, saveTrack, type SavedTrack } from "@/lib/track-store";
import type { GpsPoint } from "@/lib/types";

export type RecorderState = "idle" | "acquiring" | "recording" | "paused" | "saving";

export interface RecordingView {
  state: RecorderState;
  error: string | null;
  /** What is being recorded and where its page is. */
  activity: GpsActivity;
  title: string;
  trailId: string | null;
  returnUrl: string | null;
  points: GpsPoint[];
  distanceM: number;
  gainFt: number;
  movingSec: number;
  elapsedSec: number;
  offTrail: boolean;
  offTrailM: number | null;
  current: { lat: number; lng: number; accuracy: number; altitudeFt: number | null; heading: number | null } | null;
  weakGps: boolean;
  speedMph: number;
  /** The page went to the background while recording (GPS pauses there). */
  backgrounded: boolean;
  /** The last GPS gap bridged, shown once when the page comes back. */
  gap: TrackGap | null;
  savedTrack: SavedTrack | null;
  /** The phone is giving an approximate location (accuracy of hundreds of meters): Precise Location is off. */
  approximate: boolean;
  /** Estimated error of the filtered track position, in meters. */
  filteredAccuracyM: number | null;
}

/** Fixes this vague (or worse) mean the phone shares only an approximate location. */
const APPROXIMATE_M = 500;
/** Recording waits this long for a fix within 10 m before settling for one within 30 m. */
const PRECISE_WAIT_MS = 20_000;

const WATCH: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 };
const SAVE_EVERY = 10;
type WakeLockSentinelLike = { release: () => Promise<void> };

const INITIAL: RecordingView = {
  state: "idle", error: null, activity: "hike", title: "", trailId: null, returnUrl: null, points: [], distanceM: 0, gainFt: 0, movingSec: 0,
  elapsedSec: 0, offTrail: false, offTrailM: null, current: null, weakGps: false, speedMph: 0, backgrounded: false, gap: null, savedTrack: null, approximate: false, filteredAccuracyM: null,
};

class RecordingSession {
  private view: RecordingView = INITIAL;
  private listeners = new Set<() => void>();
  private recorder = new TrackRecorder();
  private trail: TrailProfile | null = null;
  private watchId: number | null = null;
  private startedAt: number | null = null;
  private pausedMs = 0;
  private pauseStarted: number | null = null;
  private speedAvg = 0;
  private wakeLock: WakeLockSentinelLike | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private gapsSeen = 0;
  private wired = false;
  private checkedSaved = false;
  private acquireSince = 0;

  subscribe = (listener: () => void) => {
    this.wire();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getView = () => this.view;

  private set(patch: Partial<RecordingView>) {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }
  private get active() { return this.view.state === "recording" || this.view.state === "acquiring" || this.view.state === "paused"; }

  /** Page-lifecycle listeners, added once for the whole site. */
  private wire() {
    if (this.wired || typeof window === "undefined") return;
    this.wired = true;
    document.addEventListener("visibilitychange", () => {
      if (!this.active) return;
      if (document.visibilityState === "hidden") { this.persist(); this.set({ backgrounded: true }); return; }
      // Back in front: keep the screen awake again, restart the watch (some browsers drop it in the background)
      // and ask for a fix right away so the gap closes without waiting for the next watch update.
      void this.keepAwake(true);
      if (this.view.state !== "paused") {
        this.watch();
        navigator.geolocation.getCurrentPosition((p) => this.onFix(p), () => undefined, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
      }
    });
    // A phone may discard a background tab without warning; pagehide is the last reliable moment to save.
    window.addEventListener("pagehide", () => { if (this.active) this.persist(); });
    // Closing or leaving the site mid-recording asks first (the recording is saved and can be resumed either way).
    window.addEventListener("beforeunload", (e) => { if (this.active) { this.persist(); e.preventDefault(); } });
  }

  /** Looks once for a recording left unfinished (crash, refresh, closed tab) to offer resuming. */
  checkSaved() {
    if (this.checkedSaved) return;
    this.checkedSaved = true;
    void loadTrack().then((t) => { if (t?.fixes.length && this.view.state === "idle") this.set({ savedTrack: t }); });
  }

  /** The trail being followed: its line and DEM profile (set by the recorder page once loaded). */
  setTrail(trail: TrailProfile | null) {
    this.trail = trail;
    this.recorder.setTrail(trail);
  }

  private publishTrack() {
    const r = this.recorder;
    const points: GpsPoint[] = r.points.map((p) => ({ lat: p.lat, lng: p.lng, altitude: p.elevationFt !== null ? p.elevationFt / 3.28084 : null, accuracy: p.accuracyM, speed: null, heading: p.heading, timestamp: p.time }));
    const gap = r.gaps.length > this.gapsSeen ? r.gaps[r.gaps.length - 1] : this.view.gap;
    this.gapsSeen = r.gaps.length;
    this.set({ points, distanceM: r.totalDistanceM, gainFt: Math.round(r.gainFt), movingSec: r.movingSec, offTrail: r.offTrail, offTrailM: r.offTrailM, gap });
  }

  private persist() {
    const r = this.recorder;
    if (!this.startedAt || !r.accepted.length) return;
    const paused = this.pausedMs + (this.pauseStarted ? Date.now() - this.pauseStarted : 0);
    void saveTrack({ activity: this.view.activity, title: this.view.title, trailId: this.view.trailId, startedAt: this.startedAt, pausedMs: paused, fixes: r.accepted, savedAt: Date.now() });
  }

  private async keepAwake(on: boolean) {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
    if (!on) { await this.wakeLock?.release().catch(() => undefined); this.wakeLock = null; return; }
    if (!nav.wakeLock || document.visibilityState !== "visible") return;
    // The browser releases the lock whenever the page is hidden, so it is requested again each time.
    await this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = await nav.wakeLock.request("screen").catch(() => null);
  }

  private tick(on: boolean) {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    if (on) this.ticker = setInterval(() => { if (this.startedAt && this.view.state === "recording") this.set({ elapsedSec: Math.floor((Date.now() - this.startedAt - this.pausedMs) / 1000) }); }, 1000);
  }

  private onFix(position: GeolocationPosition) {
    const c = position.coords;
    const fix: Fix = { lat: c.latitude, lng: c.longitude, altitudeM: c.altitude, accuracyM: c.accuracy, time: position.timestamp || Date.now(), heading: c.heading };
    const patch: Partial<RecordingView> = { weakGps: c.accuracy > 30, approximate: c.accuracy >= APPROXIMATE_M };
    if (c.speed !== null && c.speed >= 0) { this.speedAvg = smoothSpeed(this.speedAvg, mpsToMph(c.speed)); patch.speedMph = this.speedAvg; }
    if (this.view.state === "acquiring") {
      // Recording starts at the first fix within 10 m, or within 30 m once 20 s have passed without one.
      const enough = c.accuracy <= 10 || (c.accuracy <= 30 && Date.now() - this.acquireSince > PRECISE_WAIT_MS);
      if (!enough) { this.set({ ...patch, current: { lat: fix.lat, lng: fix.lng, accuracy: c.accuracy, altitudeFt: null, heading: null } }); return; }
      this.startedAt ??= Date.now();
      patch.state = "recording";
      this.set(patch);
    }
    if (this.view.state !== "recording") { this.set(patch); return; }
    const r = this.recorder;
    const verdict = r.push(fix);
    const last = r.points[r.points.length - 1];
    const prev = r.points[r.points.length - 2];
    this.set({
      ...patch,
      current: {
        lat: fix.lat, lng: fix.lng, accuracy: c.accuracy,
        altitudeFt: last?.elevationFt ?? (c.altitude !== null ? c.altitude * 3.28084 : null),
        heading: c.heading ?? (prev && last ? computeHeading(prev.lat, prev.lng, last.lat, last.lng) : null),
      },
    });
    if (verdict === "accepted") {
      this.publishTrack();
      this.set({ filteredAccuracyM: r.filteredAccuracyM });
      if (r.accepted.length % SAVE_EVERY === 0) this.persist();
    }
  }

  private watch() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = navigator.geolocation.watchPosition((p) => this.onFix(p), (err) => {
      // A timeout only means no fix arrived in 10 s (tree cover, a canyon): ask again.
      if (err.code === err.TIMEOUT) { if (this.view.state === "recording" || this.view.state === "acquiring") this.watch(); return; }
      this.set({ error: err.message || "Location is unavailable." });
      if (this.view.state === "acquiring") { this.set({ state: "idle" }); this.stopWatching(); }
    }, WATCH);
  }

  private stopWatching() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.tick(false);
    void this.keepAwake(false);
  }

  private begin(meta: { activity: GpsActivity; title: string; trailId: string | null; returnUrl: string | null }, restore?: SavedTrack) {
    this.recorder = new TrackRecorder(restore?.activity ?? meta.activity, this.trail);
    this.pausedMs = restore?.pausedMs ?? 0;
    this.pauseStarted = null;
    this.startedAt = restore?.startedAt ?? null;
    this.speedAvg = 0;
    for (const f of restore?.fixes ?? []) this.recorder.push(f);
    this.gapsSeen = this.recorder.gaps.length;
    this.set({ ...INITIAL, ...meta, ...(restore ? { activity: restore.activity, title: restore.title || meta.title, trailId: restore.trailId } : {}), state: restore ? "recording" : "acquiring", gap: null });
    this.publishTrack();
    this.acquireSince = Date.now();
    this.tick(true);
    void this.keepAwake(true);
    this.watch();
  }

  start(meta: { activity: GpsActivity; title: string; trailId: string | null; returnUrl: string | null }) {
    void clearTrack();
    this.begin(meta);
  }
  resumeSaved(returnUrl: string | null) {
    const saved = this.view.savedTrack;
    if (saved) this.begin({ activity: saved.activity, title: saved.title, trailId: saved.trailId, returnUrl }, saved);
  }
  discardSaved() { this.set({ savedTrack: null }); void clearTrack(); }
  pause() {
    this.pauseStarted = Date.now();
    this.set({ state: "paused" });
    this.persist();
  }
  resume() {
    if (this.pauseStarted) { this.pausedMs += Date.now() - this.pauseStarted; this.pauseStarted = null; }
    this.set({ state: "recording" });
  }
  stop() {
    this.stopWatching();
    this.set({ state: "saving" });
  }
  /** Back to idle (after saving, or when saving failed and the track should stay on screen). */
  setState(state: RecorderState) { this.set({ state }); }
  /** After a successful save, the in-progress copy is no longer needed. */
  forget() { void clearTrack(); this.recorder = new TrackRecorder(); this.set({ ...INITIAL, savedTrack: null }); }
  dismissBackgrounded() { this.set({ backgrounded: false }); }
  dismissGap() { this.set({ gap: null }); }
}

export const recording = new RecordingSession();

/** The site-wide recording as React state. */
export function useRecording(): RecordingView {
  return useSyncExternalStore(recording.subscribe, recording.getView, recording.getView);
}

/** Gaps under this long aren't worth telling the hiker about. */
export const NOTICE_GAP_SEC = GAP_SEC;
