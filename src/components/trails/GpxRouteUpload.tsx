"use client";

import { formatDistance, formatElevation } from "@/lib/units";
import { friendlyError } from "@/lib/errors";
import { useRef, useState } from "react";

interface GpxRouteUploadProps {
  trailId?: string;
  className?: string;
}

interface RouteStats {
  distance_miles: number;
  elevation_gain_ft: number;
  elevation_loss_ft?: number;
}

interface ImportResponse {
  routes?: Array<{ name?: string; stats: RouteStats }>;
  primary?: { stats: RouteStats };
  saved?: { kind: "activity" | "route_import"; id: string };
  error?: string;
}

export function GpxRouteUpload({ trailId, className = "" }: GpxRouteUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a GPX, KML, or GeoJSON file first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("persist", "true");
      if (trailId) form.append("trail_id", trailId);

      const response = await fetch("/api/gpx/import?persist=true", {
        method: "POST",
        body: form,
      });

      const data = (await response.json()) as ImportResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Import failed");
      }

      setResult(data);
    } catch (err) {
      setError(friendlyError(err, "That file couldn’t be imported. Check it’s a GPX file and try again."));
    } finally {
      setLoading(false);
    }
  }

  const stats = result?.primary?.stats ?? result?.routes?.[0]?.stats;

  return (
    <section
      className={`border-b border-[var(--border)] py-6 ${className}`}
    >
      <h2 className="mb-1 font-semibold text-foreground">Import route</h2>
      <p className="mb-4 text-sm text-sage">
        Upload a GPX, KML, or GeoJSON file to parse and save your route.
        {trailId ? " This route will be linked to the current trail." : ""}
      </p>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Route file</span>
          <input
            ref={inputRef}
            type="file"
            accept=".gpx,.kml,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json"
            onChange={(e) => {
              setFileName(e.target.files?.[0]?.name ?? null);
              setError(null);
              setResult(null);
            }}
            className="rounded-md border border-[var(--border)] bg-surface px-3 py-2 text-foreground file:mr-3 file:border-0 file:bg-surface-elevated file:text-foreground"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="btn-primary disabled:opacity-60"
        >
          {loading ? "Importing…" : "Upload & save"}
        </button>
      </form>

      {fileName && !result && !error && (
        <p className="mt-2 text-xs text-sage">Selected: {fileName}</p>
      )}

      {error && (
        <p className="mt-4 border border-[var(--border)] px-4 py-3 text-sm text-foreground">{error}</p>
      )}

      {result && stats && (
        <div className="mt-4 border border-[var(--border)] bg-surface-elevated px-4 py-4 text-sm text-foreground">
          <p className="font-medium">Route imported successfully</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-3">
            <div>
              <dt className="text-sage">Distance</dt>
              <dd className="font-medium">{formatDistance(stats.distance_miles)}</dd>
            </div>
            <div>
              <dt className="text-sage">Elevation gain</dt>
              <dd className="font-medium">{formatElevation(stats.elevation_gain_ft)}</dd>
            </div>
            {stats.elevation_loss_ft != null && (
              <div>
                <dt className="text-sage">Elevation loss</dt>
                <dd className="font-medium">{formatElevation(stats.elevation_loss_ft)}</dd>
              </div>
            )}
          </dl>
          {result.saved && (
            <p className="mt-3 text-xs text-sage">
              Saved as {result.saved.kind.replace("_", " ")} · ID{" "}
              <code className="rounded bg-surface px-1">{result.saved.id}</code>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
