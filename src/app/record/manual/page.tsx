"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACTIVITY_LABELS, type ActivityType } from "@/lib/types";

const types: ActivityType[] = ["run", "hike", "bike", "ski"];

export default function ManualRecordPage() {
  const router = useRouter();
  const [activityType, setActivityType] = useState<ActivityType>("hike");
  const [title, setTitle] = useState("");
  const [distanceMi, setDistanceMi] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [elevationFt, setElevationFt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const now = new Date();
    const res = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activity_type: activityType,
        title: title || `${ACTIVITY_LABELS[activityType]} (manual)`,
        distance_m: Number(distanceMi) * 1609.34,
        duration_sec: Number(durationMin) * 60,
        elevation_gain_ft: Number(elevationFt) || 0,
        route_geojson: null,
        started_at: now.toISOString(),
        ended_at: now.toISOString(),
        notes: notes || null,
      }),
    }).catch(() => null);

    setSaving(false);

    if (!res) {
      setError("Couldn’t reach Hyked. Check your connection and try again.");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        res.status === 401
          ? "Sign in to save activities to your log."
          : res.status === 503
            ? "Saving isn’t available right now. Try again later."
            : data.error ?? "Couldn’t save this activity. Try again.",
      );
      setNeedsSignIn(res.status === 401);
      return;
    }

    const { activity } = await res.json();
    router.push(`/activities/${activity.id}`);
  }

  return (
    <div className="mx-auto max-w-lg px-4 pb-24 pt-8 md:pb-8">
      <h1 className="text-2xl font-bold text-stone-900">Manual log</h1>
      <p className="mt-1 text-stone-500">No GPS? Enter your stats manually.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="log-type" className="block text-sm font-medium text-stone-700">Activity type</label>
          <select
            id="log-type"
            value={activityType}
            onChange={(e) => setActivityType(e.target.value as ActivityType)}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm"
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="log-title" className="block text-sm font-medium text-stone-700">Title</label>
          <input
            id="log-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Morning hike"
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="log-distance" className="block text-sm font-medium text-stone-700">Distance (mi)</label>
            <input
            id="log-distance"
              type="number"
              step="any"
              min="0.01"
              required
              value={distanceMi}
              onChange={(e) => setDistanceMi(e.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="log-time" className="block text-sm font-medium text-stone-700">Time (min)</label>
            <input
            id="log-time"
              type="number"
              required
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="log-elevation" className="block text-sm font-medium text-stone-700">Elev (ft)</label>
            <input
            id="log-elevation"
              type="number"
              value={elevationFt}
              onChange={(e) => setElevationFt(e.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="log-notes" className="block text-sm font-medium text-stone-700">Notes</label>
          <textarea
            id="log-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}{" "}
            {needsSignIn && (
              <Link href="/login?next=/record/manual" className="font-medium underline">
                Sign in
              </Link>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-emerald-600 py-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save activity"}
        </button>
      </form>
    </div>
  );
}
