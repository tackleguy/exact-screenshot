"use client";

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
import { formatPace } from "@/lib/gps";
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
  const gps = useGpsTrack();
  const location = useLocationPermission();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [locationConfirmed, setLocationReady] = useState(false);
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
          title,
          distance_m: gps.distanceM,
          duration_sec: gps.durationSec,
          elevation_gain_ft: gps.elevationGainFt,
          route_geojson: gps.routeGeoJSON,
          trail_id: trailId ?? null,
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
        <h1 className="mt-1 truncate font-display text-2xl font-semibold text-cream">{title}</h1>
        {(trailId || skiAreaName) && (
          <p className="mt-1 truncate text-xs text-accent">
            {skiAreaName ? `⛷ ${skiAreaName}` : "Linked to trail"}
          </p>
        )}
        <div className="mt-3 flex justify-center">
          <StatusBadge state={gps.state} acquiringAccuracy={gps.acquiringProgress} />
        </div>
      </div>

      {isActive && (
        <p className="mb-6 text-center font-display text-5xl font-semibold tabular-nums tracking-tight text-cream sm:text-6xl">
          {gps.formattedDuration}
        </p>
      )}

      {/* Live map */}
      <LiveTrackMap
        points={gps.points}
        heading={gps.currentHeading}
        className={clsx(
          "w-full overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--border)]",
          isActive ? "h-40" : "h-52 sm:h-60",
        )}
      />

      {/* Gauges */}
      <div className="mt-4 grid grid-cols-2 gap-3 surface-card p-4">
        <AltimeterGauge altitudeFt={gps.currentAltitudeFt} />
        <SpeedometerGauge speedMph={gps.currentSpeedMph} />
      </div>

      {/* Stats */}
      <div className="mt-4 surface-card p-4">
        <div className="grid grid-cols-4 gap-2 text-center">
          <PrimaryStat label="Distance" value={gps.formattedDistance} active={isActive} />
          <PrimaryStat label="Time" value={gps.formattedDuration} active={isActive} />
          <PrimaryStat
            label="Elev gain"
            value={`${gps.elevationGainFt.toLocaleString()} ft`}
            active={isActive}
          />
          <PrimaryStat
            label="Pace"
            value={formatPace(gps.distanceM, gps.durationSec)}
            active={isActive}
          />
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
        GPS {acquiringAccuracy !== null ? `±${Math.round(acquiringAccuracy)}m` : "…"}
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
