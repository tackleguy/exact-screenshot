"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import { createClient } from "@/lib/supabase/client";
import { SkiAreaMap } from "./SkiAreaMap";

interface SkiAreaRow {
  id: string;
  slug: string;
  name: string;
  country: string;
  country_name: string;
  region: string;
  locality: string;
  latitude: number;
  longitude: number;
  website: string | null;
  ski_types: string[];
  elevation_min_ft: number | null;
  elevation_max_ft: number | null;
  lifts: number;
  counts: Record<string, number> | null;
  notes: string | null;
}

interface TrailSummary {
  name: string | null;
  difficulty?: string | null;
  uses?: string[];
  lengthKm?: number | null;
}

interface SkiAreaDetail {
  skiRuns: TrailSummary[];
  hiking: TrailSummary[];
  mountainBiking: TrailSummary[];
  resortListedSummerTrails: TrailSummary[];
  geojson: FeatureCollection;
  notes?: string[];
}

function TrailList({ title, trails }: { title: string; trails: TrailSummary[] }) {
  const [expanded, setExpanded] = useState(false);
  if (trails.length === 0) return null;
  const visible = expanded ? trails : trails.slice(0, 12);
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-4">
      <h2 className="font-display text-base font-semibold text-cream">
        {title} <span className="text-mist">({trails.length.toLocaleString()})</span>
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm">
        {visible.map((trail, i) => (
          <li key={`${trail.name ?? "trail"}-${i}`} className="flex items-baseline justify-between gap-3">
            <span className="text-cream">{trail.name ?? "Unnamed trail"}</span>
            <span className="shrink-0 text-xs text-mist">
              {trail.difficulty && <span className="mr-2 capitalize">{trail.difficulty}</span>}
              {trail.lengthKm != null && `${trail.lengthKm.toFixed(1)} km`}
            </span>
          </li>
        ))}
      </ul>
      {trails.length > 12 && (
        <button type="button" className="btn-ghost mt-3 text-xs" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `Show all ${trails.length.toLocaleString()}`}
        </button>
      )}
    </div>
  );
}

export function SkiAreaDetailPage({ slug }: { slug: string }) {
  const [area, setArea] = useState<SkiAreaRow | null>(null);
  const [detail, setDetail] = useState<SkiAreaDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = createClient();
    if (!client) return;
    let active = true;
    setLoading(true);
    Promise.all([
      client.from("ski_areas").select("*").eq("slug", slug).single(),
      client.from("ski_area_details").select("data").eq("slug", slug).single(),
    ]).then(([areaRes, detailRes]) => {
      if (!active) return;
      if (areaRes.error || !areaRes.data) {
        setError(areaRes.error?.message ?? "Ski area not found.");
      } else {
        setArea(areaRes.data as SkiAreaRow);
        setDetail((detailRes.data?.data as SkiAreaDetail | undefined) ?? null);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  const directionsUrl = useMemo(
    () =>
      area
        ? `https://www.google.com/maps/dir/?api=1&destination=${area.latitude},${area.longitude}`
        : "",
    [area],
  );

  if (loading) {
    return (
      <section className="fieldbook-page">
        <h1>Loading ski area…</h1>
      </section>
    );
  }
  if (error || !area) {
    return (
      <section className="fieldbook-page">
        <h1>Ski area unavailable</h1>
        <p role="alert">{error || "Not found."}</p>
        <Link className="btn-ghost" href="/ski-areas">
          ← All ski areas
        </Link>
      </section>
    );
  }

  const counts = area.counts ?? {};
  const stats: { label: string; value: string }[] = [];
  if (area.lifts > 0) stats.push({ label: "Lifts", value: area.lifts.toLocaleString() });
  if (Number(counts.skiRuns) > 0) stats.push({ label: "Ski runs", value: Number(counts.skiRuns).toLocaleString() });
  if (Number(counts.nordicRuns) > 0) stats.push({ label: "Nordic trails", value: Number(counts.nordicRuns).toLocaleString() });
  if (area.elevation_max_ft != null)
    stats.push({
      label: "Elevation",
      value: `${area.elevation_min_ft != null ? `${area.elevation_min_ft.toLocaleString()}–` : ""}${area.elevation_max_ft.toLocaleString()} ft`,
    });
  const summerCount =
    Number(counts.hikingOnMountain ?? 0) + Number(counts.hikingNearby ?? 0) + Number(counts.mountainBikingOnMountain ?? 0) + Number(counts.mountainBikingNearby ?? 0);
  if (summerCount > 0) stats.push({ label: "Summer trails", value: summerCount.toLocaleString() });

  return (
    <section className="fieldbook-page">
      <Link className="btn-ghost" href="/ski-areas">
        ← All ski areas
      </Link>
      <p className="section-label mt-4">Ski area</p>
      <h1>{area.name}</h1>
      <p className="text-mist">{[area.locality, area.region, area.country_name].filter(Boolean).join(", ")}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {area.ski_types.map((t) => (
          <span key={t} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs capitalize text-mist">
            {t}
          </span>
        ))}
        <a className="btn-primary text-xs" href={directionsUrl} target="_blank" rel="noreferrer">
          Get directions
        </a>
        {area.website && (
          <a className="btn-ghost text-xs" href={area.website} target="_blank" rel="noreferrer">
            Official website
          </a>
        )}
      </div>

      {stats.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-3">
              <p className="text-xs text-mist">{stat.label}</p>
              <p className="mt-1 font-display text-lg font-semibold text-cream">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <SkiAreaMap geojson={detail?.geojson ?? null} center={[area.latitude, area.longitude]} className="h-96 w-full rounded-[var(--radius-lg)]" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TrailList title="Ski runs" trails={detail?.skiRuns ?? []} />
        <TrailList title="Hiking trails" trails={[...(detail?.hiking ?? []), ...(detail?.resortListedSummerTrails ?? [])]} />
        <TrailList title="Mountain biking" trails={detail?.mountainBiking ?? []} />
      </div>

      {detail?.notes && detail.notes.length > 0 && (
        <ul className="mt-6 list-disc space-y-1 pl-5 text-sm text-mist">
          {detail.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
