"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import { createClient } from "@/lib/supabase/client";
import { SkiAreaMap, useOpenSkiFeature } from "./SkiAreaMap";

interface SkiAreaRow {
  id: string; slug: string; name: string; country_name: string; region: string; locality: string;
  latitude: number; longitude: number; website: string | null; ski_types: string[];
  elevation_min_ft: number | null; elevation_max_ft: number | null; lifts: number;
  counts: Record<string, unknown> | null; notes: string | null;
}
interface TrailItem {
  id?: string; name: string | null; difficulty?: string | null; miles?: number | null; lengthKm?: number | null;
  onMountain?: boolean; kmFromSkiArea?: number | null; dataSource?: string; source?: string; use?: string; uses?: string[];
}
interface SkiAreaDetail {
  skiRuns: TrailItem[]; hiking: TrailItem[]; mountainBiking: TrailItem[]; resortListedSummerTrails: TrailItem[];
  geojson: FeatureCollection; notes?: string[];
}
type Tab = "ski" | "hike" | "bike";
const KIND: Record<Tab, string> = { ski: "ski-run", hike: "hiking", bike: "mountain-biking" };

function lengthLabel(t: TrailItem) {
  if (t.miles != null) return `${t.miles.toFixed(1)} mi`;
  if (t.lengthKm != null) return `${t.lengthKm.toFixed(1)} km`;
  return "";
}

export function SkiAreaDetailPage({ slug }: { slug: string }) {
  const [area, setArea] = useState<SkiAreaRow | null>(null);
  const [detail, setDetail] = useState<SkiAreaDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("ski");
  const [expanded, setExpanded] = useState(false);
  const openFeature = useOpenSkiFeature();

  useEffect(() => {
    const client = createClient();
    if (!client) return;
    let active = true;
    setLoading(true);
    Promise.all([
      client.from("ski_areas").select("*").eq("slug", slug).maybeSingle(),
      client.from("ski_area_details").select("data").eq("slug", slug).maybeSingle(),
    ]).then(([a, d]) => {
      if (!active) return;
      if (a.error || !a.data) setError(a.error?.message ?? "Ski area not found. You may need to sign in.");
      else { setArea(a.data as SkiAreaRow); setDetail((d.data?.data as SkiAreaDetail | undefined) ?? null); }
      setLoading(false);
    });
    return () => { active = false; };
  }, [slug]);

  const lists = useMemo(() => {
    const listed = detail?.resortListedSummerTrails ?? [];
    return {
      ski: detail?.skiRuns ?? [],
      hike: [...(detail?.hiking ?? []), ...listed.filter((t) => !/^bike$/.test(t.use ?? ""))],
      bike: [...(detail?.mountainBiking ?? []), ...listed.filter((t) => /bike/.test(t.use ?? ""))],
    } as Record<Tab, TrailItem[]>;
  }, [detail]);

  const tabGeo = useMemo<FeatureCollection | null>(() => detail ? { type: "FeatureCollection", features: detail.geojson.features.filter((f) => f.properties?.kind === KIND[tab]) } : null, [detail, tab]);
  const center = useMemo<[number, number]>(() => [area?.latitude ?? 0, area?.longitude ?? 0], [area?.latitude, area?.longitude]);

  if (loading) return <section className="fieldbook-page"><h1>Loading ski area…</h1></section>;
  if (error || !area) return (
    <section className="fieldbook-page"><h1>Ski area unavailable</h1><p role="alert">{error || "Not found."}</p>
      <Link className="btn-ghost" href="/ski-areas">← All ski areas</Link></section>
  );

  const c = area.counts ?? {};
  const n = (k: string) => Number(c[k] ?? 0);
  const stats: { label: string; value: string }[] = [];
  if (area.lifts > 0) stats.push({ label: "Lifts", value: area.lifts.toLocaleString() });
  if (n("skiRuns")) stats.push({ label: "Ski runs", value: n("skiRuns").toLocaleString() });
  if (n("nordicRuns")) stats.push({ label: "Nordic trails", value: n("nordicRuns").toLocaleString() });
  if (area.elevation_max_ft != null) stats.push({ label: "Elevation", value: `${area.elevation_min_ft != null ? `${area.elevation_min_ft.toLocaleString()}–` : ""}${area.elevation_max_ft.toLocaleString()} ft` });

  const items = lists[tab];
  const visible = expanded ? items : items.slice(0, 25);
  const emptyNotes = [area.notes, ...(detail?.notes ?? [])].filter(Boolean) as string[];

  const openItem = (t: TrailItem) => {
    if (!t.id) return;
    const f = detail?.geojson.features.find((x) => x.properties?.id === t.id) as Feature | undefined;
    if (t.dataSource === "official") openFeature({ properties: { ...t, source: "official" }, geometry: f?.geometry ?? { type: "LineString", coordinates: [] } });
    else if (f) openFeature(f);
  };

  return (
    <section className="fieldbook-page">
      <Link className="btn-ghost" href="/ski-areas">← All ski areas</Link>
      <p className="section-label mt-4">Ski area</p>
      <h1>{area.name}</h1>
      <p className="text-mist">{[area.locality, area.region, area.country_name].filter(Boolean).join(", ")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {area.ski_types.map((t) => <span key={t} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs capitalize text-mist">{t}</span>)}
        <a className="btn-primary text-xs" href={`https://www.google.com/maps/dir/?api=1&destination=${area.latitude},${area.longitude}`} target="_blank" rel="noreferrer">Get directions</a>
        {area.website && <a className="btn-ghost text-xs" href={area.website} target="_blank" rel="noreferrer">Official website</a>}
      </div>
      {stats.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-3">
              <p className="text-xs text-mist">{s.label}</p><p className="mt-1 font-display text-lg font-semibold text-cream">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex gap-2" role="tablist">
        {([["ski", "Skiing"], ["hike", "Hiking"], ["bike", "Mountain biking"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" className={tab === k ? "btn-primary text-xs" : "btn-ghost text-xs"} onClick={() => { setTab(k); setExpanded(false); }}>
            {label} ({lists[k].length.toLocaleString()})
          </button>
        ))}
      </div>

      <div className="mt-4"><SkiAreaMap geojson={tabGeo} center={center} className="h-96 w-full rounded-[var(--radius-lg)]" /></div>
      {tab === "ski" && <p className="mt-2 flex gap-4 text-xs text-mist"><span style={{ color: "#2f9e5b" }}>● Easy</span><span style={{ color: "#2f7fd8" }}>● Intermediate</span><span>● Advanced / expert</span></p>}

      <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-4">
        {items.length === 0 ? (
          emptyNotes.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-mist">{emptyNotes.map((x, i) => <li key={i}>{x}</li>)}</ul>
            : <p className="text-sm text-mist">No mapped trails in this category.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {visible.map((t, i) => (
              <li key={`${t.id ?? t.name}-${i}`} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  {t.id ? <button type="button" className="text-left text-cream underline-offset-2 hover:underline" onClick={() => openItem(t)}>{t.name ?? "Unnamed trail"}</button>
                    : <span className="text-cream">{t.name ?? "Unnamed trail"}</span>}
                  {tab !== "ski" && (
                    <span className="ml-2 text-xs text-mist">
                      {t.use ? "Resort-listed" : t.onMountain ? "On the mountain" : t.kmFromSkiArea != null ? `Nearby · ${t.kmFromSkiArea.toFixed(1)} km` : ""}
                      {t.source && /^https?:/.test(t.source) && <> · <a href={t.source} target="_blank" rel="noreferrer" className="underline">source</a></>}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-mist">{t.difficulty && <span className="mr-2 capitalize">{t.difficulty}</span>}{lengthLabel(t)}</span>
              </li>
            ))}
          </ul>
        )}
        {items.length > 25 && <button type="button" className="btn-ghost mt-3 text-xs" onClick={() => setExpanded((v) => !v)}>{expanded ? "Show less" : `Show all ${items.length.toLocaleString()}`}</button>}
      </div>
    </section>
  );
}
