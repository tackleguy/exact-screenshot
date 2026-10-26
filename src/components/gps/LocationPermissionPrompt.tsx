"use client";

import type { GeoPermissionState } from "@/lib/geolocation";

interface LocationPermissionPromptProps {
  permission: GeoPermissionState;
  loading?: boolean;
  error?: string | null;
  onRequest: () => void;
  className?: string;
  compact?: boolean;
}

export function LocationPermissionPrompt({
  permission,
  loading = false,
  error,
  onRequest,
  className = "",
  compact = false,
}: LocationPermissionPromptProps) {
  if (permission === "unsupported") {
    return (
      <div
        className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}
      >
        GPS is not supported in this browser.
      </div>
    );
  }

  if (permission === "granted") return null;

  if (permission === "denied") {
    return (
      <div
        className={`rounded-xl border border-red-200 bg-red-50 px-4 py-3 ${className}`}
      >
        <p className="text-sm font-medium text-red-900">Location access blocked</p>
        <p className="mt-1 text-xs text-red-700">
          Enable location for this site in your browser settings (lock icon in the
          address bar), then tap Try again.
        </p>
        <button
          type="button"
          onClick={onRequest}
          disabled={loading}
          className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {loading ? "Checking…" : "Try again"}
        </button>
      </div>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onRequest}
        disabled={loading}
        className={`inline-flex items-center gap-2 rounded-full bg-sky-700 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-sky-800 disabled:opacity-60 ${className}`}
      >
        <span>📍</span>
        {loading ? "Getting location…" : "Enable location"}
      </button>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 shadow-sm ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">📍</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-stone-900">Enable location for GPS</p>
          <p className="mt-1 text-sm text-stone-600">
            Allow location access to see nearby trails, ski areas, and record
            activities with live altitude and speed.
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
          <button
            type="button"
            onClick={onRequest}
            disabled={loading}
            className="mt-3 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
          >
            {loading ? "Requesting location…" : "Allow location tracking"}
          </button>
        </div>
      </div>
    </div>
  );
}
