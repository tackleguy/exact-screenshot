"use client";

import { useMemo, useState } from "react";
import { PACK_TRAILS, type PackTrail } from "@/lib/gear";
import { useUserTrails } from "@/hooks/useUserTrails";
import { Button } from "@/components/ui/button";

const DIFF_STYLES: Record<string, string> = {
  easy: "bg-accent/20 text-accent",
  moderate: "bg-pine/40 text-sage",
  hard: "bg-red-500/20 text-red-300",
  expert: "bg-purple-500/20 text-purple-300",
};

const DIFFICULTIES: PackTrail["difficulty"][] = [
  "easy",
  "moderate",
  "hard",
  "expert",
];

const emptyForm = {
  name: "",
  location: "",
  distance: "",
  elevation: "",
  days: "",
  difficulty: "moderate" as PackTrail["difficulty"],
  season: "",
  tags: "",
};

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-surface px-3 py-2.5 text-sm text-cream outline-none transition placeholder:text-mist/50 focus:border-accent/50";

export function TrailDatabase({ userId }: { userId: string }) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { trails: userTrails, message, addTrail, deleteTrail } =
    useUserTrails(userId);

  const allTrails = useMemo(() => {
    const custom = userTrails.map((t) => ({ ...t, isCustom: true as const }));
    const builtin = PACK_TRAILS.map((t) => ({
      ...t,
      id: t.name,
      isCustom: false as const,
    }));
    return [...custom, ...builtin];
  }, [userTrails]);

  const filtered = useMemo(
    () =>
      allTrails.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.location.toLowerCase().includes(search.toLowerCase()) ||
          t.tags.some((tag) =>
            tag.toLowerCase().includes(search.toLowerCase()),
          ),
      ),
    [search, allTrails],
  );

  const handleSubmit = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
    const saved = await addTrail({
      name: form.name.trim(),
      location: form.location.trim(),
      distance: Number(form.distance) || 0,
      elevation: Number(form.elevation) || 0,
      days: form.days.trim() || "1",
      difficulty: form.difficulty,
      season: form.season.trim(),
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    if (!saved) return;
    setForm(emptyForm);
    setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-cream sm:text-3xl">
            Pack Trails
          </h2>
          <p className="mt-1 text-sm text-sage">
            Popular backpacking routes and your custom trips
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${inputClass} w-64`}
            placeholder="Search trails..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="rounded-lg border border-accent/30 bg-accent/15 px-4 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/25"
          >
            + Add Trail
          </button>
        </div>
      </div>

      {message && (
        <p className="mb-4 text-sm text-sage">{message}</p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((trail) => (
          <div
            key={trail.id}
            className="surface-card group relative overflow-hidden transition hover:border-[var(--border-strong)]"
          >
            {trail.isCustom && (
              <button
                type="button"
                onClick={() => deleteTrail(trail.id)}
                className="absolute right-3 top-3 z-10 rounded-lg bg-red-500/20 p-1.5 text-red-300 opacity-0 transition hover:bg-red-500/30 group-hover:opacity-100"
                aria-label="Delete custom trail"
              >
                ⌫
              </button>
            )}
            <div className="p-5 pb-2">
              <div className="flex items-center gap-2">
                <h4 className="font-display text-lg font-bold text-cream">
                  {trail.name}
                </h4>
                {trail.isCustom && (
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[0.55rem] font-semibold text-accent">
                    Custom
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-sage">
                <span aria-hidden>📍</span>
                {trail.location}
              </div>
              <span
                className={`mt-2 inline-block rounded-md px-2 py-0.5 text-[0.65rem] font-semibold ${DIFF_STYLES[trail.difficulty]}`}
              >
                {trail.difficulty.charAt(0).toUpperCase() +
                  trail.difficulty.slice(1)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 px-5 py-3">
              <div className="text-center">
                <div className="font-mono text-[0.9rem] font-medium text-cream">
                  {trail.distance} mi
                </div>
                <div className="text-[0.6rem] uppercase tracking-[0.1em] text-sage">
                  Distance
                </div>
              </div>
              <div className="text-center">
                <div className="font-mono text-[0.9rem] font-medium text-cream">
                  {(trail.elevation / 1000).toFixed(1)}k ft
                </div>
                <div className="text-[0.6rem] uppercase tracking-[0.1em] text-sage">
                  Elevation
                </div>
              </div>
              <div className="text-center">
                <div className="font-mono text-[0.9rem] font-medium text-cream">
                  {trail.days}
                </div>
                <div className="text-[0.6rem] uppercase tracking-[0.1em] text-sage">
                  Days
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 px-5 pb-4">
              {trail.season && (
                <span className="rounded border border-[var(--border)] bg-foreground/5 px-2 py-0.5 text-[0.6rem] text-sage">
                  {trail.season}
                </span>
              )}
              {trail.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-[var(--border)] bg-foreground/5 px-2 py-0.5 text-[0.6rem] text-sage"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-[300] flex items-start justify-center bg-forest/80 px-4 py-8 backdrop-blur-md sm:items-center"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[var(--border-strong)] bg-surface-elevated p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-cream">
                Add Custom Trail
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-sage transition hover:text-cream"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              {message && <p role="status" className="text-sm text-sage">{message}</p>}
              <input
                className={inputClass}
                placeholder="Trail name *"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <input
                className={inputClass}
                placeholder="Location (e.g. Wyoming, USA)"
                value={form.location}
                onChange={(e) =>
                  setForm((f) => ({ ...f, location: e.target.value }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={inputClass}
                  type="number"
                  placeholder="Distance (mi)"
                  value={form.distance}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, distance: e.target.value }))
                  }
                />
                <input
                  className={inputClass}
                  type="number"
                  placeholder="Elevation (ft)"
                  value={form.elevation}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, elevation: e.target.value }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={inputClass}
                  placeholder="Days (e.g. 3-5)"
                  value={form.days}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, days: e.target.value }))
                  }
                />
                <select
                  className={inputClass}
                  value={form.difficulty}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      difficulty: e.target.value as PackTrail["difficulty"],
                    }))
                  }
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className={inputClass}
                placeholder="Season (e.g. Jul-Sep)"
                value={form.season}
                onChange={(e) =>
                  setForm((f) => ({ ...f, season: e.target.value }))
                }
              />
              <input
                className={inputClass}
                placeholder="Tags (comma separated)"
                value={form.tags}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tags: e.target.value }))
                }
              />
            </div>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!form.name.trim() || saving}
              className="mt-5 w-full rounded-lg border border-accent/30 bg-accent/15 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Add Trail"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
