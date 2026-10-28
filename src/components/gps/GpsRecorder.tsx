"use client";

import { formatElevation, formatMeters } from "@/lib/units";
import dynamic from "next/dynamic";
import { trailProfile, type TrailProfile } from "@/lib/gps-track";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { AltimeterGauge } from "@/components/gps/AltimeterGauge";
import { ElevationChart } from "@/components/gps/ElevationChart";
import { GpsStatsPanel } from "@/components/gps/GpsStatsPanel";
import { LiveTrackMap } from "@/components/gps/LiveTrackMap";
import { SpeedometerGauge } from "@/components/gps/SpeedometerGauge";
import { LocationPermissionPrompt } from "@/components/gps/LocationPermissionPrompt";
import { useLocationPermission } from "@/components/gps/useLocationPermission";
import { useGpsTrack } from "@/components/gps/useGpsTrack";
import { formatDuration as formatClock, formatPace } from "@/lib/gps";

// The 3D view reuses the trail map (MapLibre), loaded only when asked for.
const Map3d = dynamic(() => import("@/components/trails/CatalogMapViewGl").then((m) => m.CatalogMapView), { ssr: false });
import { ACTIVITY_LABELS, type ActivityType } from "@/lib/types";

interface GpsRecorderProps {
  activityType: ActivityType;
  title: string;
  trailId?: string;
  skiAreaId?: string;
  skiAreaName?: string;
  autoStart?: boolean;
}

export function GpsRecorder({
  activityType,
  title,
  trailId,
  skiAreaId,
  skiAreaName,
  autoStart = false,
}: GpsRecorderProps) {
  const router = useRouter();
  const location = useLocationPermission();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [locationConfirmed, setLocationReady] = useState(false);
  // The trail being followed ("Start trail" on a trail page): its line on the live map, and its DEM profile so
  // climb is measured from elevation data rather than GPS altitude while on the trail.
  const [trail, setTrail] = useState<{ name: string; lines: [number, number][][]; profile: TrailProfile | null } | null>(null);
  useEffect(() => {
    if (!trailId) return;
    const controller = new AbortController();
    const id = encodeURIComponent(trailId);
    Promise.all([
      fetch(`/api/trail-catalog/${id}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/trail-catalog/${id}/elevation`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([d, e]: [{ trail?: { name: string }; lines?: [number, number][][] } | null, { profile?: [number, number][] } | null]) => {
      if (d?.trail) setTrail({ name: d.trail.name, lines: d.lines ?? [], profile: d.lines && e?.profile ? trailProfile(d.lines, e.profile) : null });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [trailId]);
  const gps = useGpsTrack({ activity: activityType, title, trailId: trailId ?? null, trail: trail?.profile ?? null });
  const [view3d, setView3d] = useState(false);
  const locationReady = locationConfirmed || location.granted;

  useEffect(() => {
    if (autoStart && gps.state === "idle" && locationReady) {
      gps.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, locationReady]);

  useEffect(() => {
    if (gps.state !== "saving") return;

    async function save() {
      const startedAt = gps.points[0]?.timestamp ?? Date.now();
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_type: activityType,
          title: gps.recordingTitle || title,
          distance_m: gps.distanceM,
          duration_sec: gps.durationSec,
          elevation_gain_ft: gps.elevationGainFt,
          route_geojson: gps.routeGeoJSON,
          trail_id: gps.recordingTrailId ?? trailId ?? null,
          ski_area_id: skiAreaId ?? null,
          ski_area_name: skiAreaName ?? null,
          started_at: new Date(startedAt).toISOString(),
          ended_at: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error ?? "Failed to save activity");
        gps.setState("idle");
        return;
      }

      const { activity } = await res.json();
      gps.forget();
      router.push(`/activities/${activity.id}`);
    }

    save();
    // Runs once per state change: saving must not repeat when other values re-render the recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.state]);

  function handleFinish() {
    if (gps.points.length < 2) {
      if (!window.confirm("Track is very short. Save anyway?")) return;
    }
    gps.stop();
  }

  if (gps.error && gps.state === "idle") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-4xl">📍</p>
        <h1 className="mt-4 text-xl font-bold text-stone-900">Location access needed</h1>
        <p className="mt-2 text-stone-600">{gps.error}</p>
        <p className="mt-2 text-sm text-stone-500">
          Enable location in browser settings, then try again. GPS requires HTTPS or localhost.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => location.requestLocation().then(() => gps.start())}
            className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Allow location & try again
          </button>
          <button
            onClick={() => router.push("/record/manual")}
            className="rounded-xl border border-stone-200 px-6 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            Log manually
          </button>
        </div>
      </div>
    );
  }

  const isActive =
    gps.state === "recording" || gps.state === "paused" || gps.state === "acquiring";

  return (
    <div
      className={clsx(
        "mx-auto max-w-2xl px-4 pb-28 pt-4 md:pb-8",
        isActive && "min-h-screen bg-forest",
      )}
    >
      {/* Header */}
      <div className="mb-6 text-center">
        <p className="section-label">{ACTIVITY_LABELS[activityType]}</p>
        <h1 className="mt-1 truncate font-display text-2xl font-semibold text-cream">{(isActive && gps.recordingTitle) || title}</h1>
        {(trailId || skiAreaName) && (
          <p className="mt-1 truncate text-xs text-accent">
            {skiAreaName ? `⛷ ${skiAreaName}` : trail ? `Following ${trail.name}` : "Linked to trail"}
          </p>
        )}
        <div className="mt-3 flex justify-center">
          <StatusBadge state={gps.state} acquiringAccuracy={gps.acquiringProgress} />
        </div>
      </div>

      {gps.savedTrack && gps.state === "idle" && (
        <div className="recorder-banner" role="alert">
          <p><strong>Resume recording?</strong> A recording from {new Date(gps.savedTrack.startedAt).toLocaleString()} wasn’t finished ({gps.savedTrack.fixes.length} points).</p>
          <div><button type="button" className="btn-primary" onClick={gps.resumeSaved}>Resume</button><button type="button" className="btn-ghost" onClick={gps.discardSaved}>Discard</button></div>
        </div>
      )}
      {gps.backgrounded && isActive && (
        <div className="recorder-banner recorder-banner--warn" role="alert">
          <p>Phones pause GPS for websites while another app is open or the screen is locked. Looking at other Hyked pages is fine — recording carries on. When you come back, any gap is filled along the trail you’re following.</p>
          <div><button type="button" className="btn-ghost" onClick={gps.dismissBackgrounded}>OK</button></div>
        </div>
      )}
      {gps.gap && isActive && (
        <div className="recorder-banner" role="status">
          <p>
            GPS was paused for {Math.max(1, Math.round((gps.gap.toTime - gps.gap.fromTime) / 60_000))} min while Hyked wasn’t open.{" "}
            {gps.gap.bridged === "trail" ? `Filled in ${formatMeters(gps.gap.meters)} along the trail.` : `Joined the two points directly (${formatMeters(gps.gap.meters)}), so the distance may be a little short.`}
          </p>
          <div><button type="button" className="btn-ghost" onClick={gps.dismissGap}>OK</button></div>
        </div>
      )}
      {gps.approximate && isActive && (
        <div className="recorder-banner recorder-banner--warn" role="alert">
          <p><strong>Turn on Precise Location.</strong> Your phone is only sharing an approximate location (±{formatMeters(gps.currentAccuracy ?? 0)}), so the track can’t be recorded.</p>
          <ul className="recorder-steps">
            <li><strong>iPhone:</strong> Settings → Privacy &amp; Security → Location Services → Safari Websites (or your browser) → turn on <em>Precise Location</em> and choose <em>While Using</em>.</li>
            <li><strong>Android:</strong> Settings → Location → App location permissions → Chrome (or your browser) → turn on <em>Use precise location</em>. Also turn on <em>Google Location Accuracy</em>.</li>
            <li>Then reload this page. For the best accuracy (±3–5 m), stand under open sky for a few seconds before starting.</li>
          </ul>
        </div>
      )}
      {gps.offTrail && gps.state === "recording" && (
        <div className="recorder-banner recorder-banner--warn" role="status">
          <p>You’re about {formatMeters(gps.offTrailM)} off {trail?.name ?? "the trail"}.</p>
        </div>
      )}

      {isActive && (
        <p className="mb-6 text-center font-display text-5xl font-semibold tabular-nums tracking-tight text-cream sm:text-6xl">
          {gps.formattedDuration}
        </p>
      )}

      {/* Live map: flat, or 3D with your position */}
      <div className="recorder-map-tools">
        {gps.weakGps && isActive && <span className="recorder-pill recorder-pill--weak">Weak GPS — waiting for a better fix</span>}
        <button type="button" className="recorder-pill" aria-pressed={view3d} onClick={() => setView3d((v) => !v)}>{view3d ? "Flat map" : "3D view"}</button>
      </div>
      {view3d ? (
        <div className={clsx("w-full overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)]", isActive ? "h-72" : "h-60")}>
          <Map3d lines={trail?.lines ?? []} route={gps.points.map((p) => [p.lng, p.lat] as [number, number])} live={gps.currentLat !== null && gps.currentLng !== null ? [gps.currentLng, gps.currentLat] : null} name={trail?.name} start3d />
        </div>
      ) : (
        <LiveTrackMap
          points={gps.points}
          trail={trail?.lines}
          heading={gps.currentHeading}
          className={clsx(
            "w-full overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)]",
            isActive ? "h-40" : "h-52 sm:h-60",
          )}
        />
      )}

      {/* Gauges */}
      <div className="mt-4 grid grid-cols-2 gap-3 surface-card p-4">
        <AltimeterGauge altitudeFt={gps.currentAltitudeFt} />
        <SpeedometerGauge speedMph={gps.currentSpeedMph} />
      </div>

      {/* Stats */}
      <div className="mt-4 surface-card p-4">
        <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-4">
          <PrimaryStat label="Distance" value={gps.formattedDistance} active={isActive} />
          <PrimaryStat label="Moving time" value={formatClock(gps.movingSec)} active={isActive} />
          <PrimaryStat label="Elapsed" value={gps.formattedDuration} active={isActive} />
          <PrimaryStat label="Pace" value={formatPace(gps.distanceM, gps.movingSec || gps.durationSec)} active={isActive} />
          <PrimaryStat label="Elev gain" value={formatElevation(gps.elevationGainFt) ?? "—"} active={isActive} />
          <PrimaryStat label="Elevation" value={formatElevation(gps.currentAltitudeFt) ?? "—"} active={isActive} />
          <div title="What the phone reports for its latest fix; the filtered track is usually closer than this.">
            <p className="text-[10px] font-medium uppercase tracking-wide text-mist">GPS accuracy</p>
            <p className="flex items-center justify-center gap-1.5 font-bold tabular-nums text-cream">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: gps.currentAccuracy === null ? "#6b7280" : gps.currentAccuracy <= 5 ? "#22c55e" : gps.currentAccuracy < 10 ? "#84cc16" : gps.currentAccuracy <= 30 ? "#eab308" : "#ef4444" }} />
              {gps.currentAccuracy !== null ? `±${Math.round(gps.currentAccuracy)} m` : "—"}
            </p>
            {gps.currentAccuracy !== null && <p className="text-[10px] text-mist">{gps.currentAccuracy <= 5 ? "Within 5 m" : "Aiming for 5 m"}</p>}
          </div>
        </div>
        <ElevationChart points={gps.points} className="mt-4" height={isActive ? 64 : 112} />
      </div>

      {/* AgOpenGPS instrumentation panel */}
      {isActive && (
        <GpsStatsPanel
          className="mt-4"
          lat={gps.currentLat}
          lng={gps.currentLng}
          speedMph={gps.currentSpeedMph}
          altitudeFt={gps.currentAltitudeFt}
          heading={gps.currentHeading}
          accuracy={gps.currentAccuracy}
          quality={gps.gpsQuality}
          pointCount={gps.pointCount}
        />
      )}

      {saveError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>
      )}

      {gps.state === "idle" && !locationReady && (
        <div className="mt-6">
          <LocationPermissionPrompt
            permission={location.permission}
            loading={location.loading}
            error={location.error}
            onRequest={async () => {
              const coords = await location.requestLocation();
              if (coords) setLocationReady(true);
            }}
          />
        </div>
      )}

      {/* Controls — fixed on mobile while recording */}
      <div
        className={`mt-6 flex gap-3 ${
          isActive
            ? "fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-forest/95 px-4 py-4 backdrop-blur-xl md:static md:border-0 md:bg-transparent md:p-0"
            : ""
        }`}
      >
        {gps.state === "idle" && locationReady && (
          <button
            onClick={() => gps.start()}
            className="btn-primary flex-1 !py-4"
          >
            Start {ACTIVITY_LABELS[activityType]}
          </button>
        )}

        {gps.state === "acquiring" && (
          <div className="flex flex-1 items-center justify-center py-4 text-sm text-amber-700">
            Waiting for accurate GPS fix…
          </div>
        )}

        {gps.state === "recording" && (
          <>
            <button
              onClick={() => gps.pause()}
              className="btn-ghost flex-1 !py-4"
            >
              Pause
            </button>
            <button onClick={handleFinish} className="btn-primary flex-1 !py-4">
              Finish
            </button>
          </>
        )}

        {gps.state === "paused" && (
          <>
            <button
              onClick={() => gps.resume()}
              className="btn-primary flex-1 !py-4"
            >
              Resume
            </button>
            <button onClick={handleFinish} className="btn-ghost flex-1 !py-4">
              Finish
            </button>
          </>
        )}

        {gps.state === "saving" && (
          <div className="flex flex-1 items-center justify-center gap-2 py-4 text-sm text-stone-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
            Saving {gps.pointCount} GPS points…
          </div>
        )}
      </div>
    </div>
  );
}

function PrimaryStat({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-mist">{label}</p>
      <p
        className={clsx(
          "font-bold tabular-nums",
          active ? "text-xl text-cream sm:text-2xl" : "text-sm text-cream sm:text-base",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({
  state,
  acquiringAccuracy,
}: {
  state: string;
  acquiringAccuracy: number | null;
}) {
  if (state === "acquiring") {
    return (
      <span className="shrink-0 animate-pulse rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
        {acquiringAccuracy !== null ? `Sharpening GPS: ±${Math.round(acquiringAccuracy)} m (starts at 10 m or better)` : "Finding GPS…"}
      </span>
    );
  }
  if (state === "recording") {
    return (
      <span className="shrink-0 rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-400">
        ● REC
      </span>
    );
  }
  if (state === "paused") {
    return (
      <span className="shrink-0 rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-mist">
        Paused
      </span>
    );
  }
  return null;
}
