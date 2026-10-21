"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface SkiAreaRow {
  id: string;
  slug: string;
  name: string;
  country: string;
  country_name: string;
  region: string;
  locality: string;
  lifts: number;
  ski_types: string[];
  elevation_min_ft: number | null;
  elevation_max_ft: number | null;
  counts: Record<string, number | Record<string, number>> | null;
}

const PAGE_SIZE = 24;

function runTotal(counts: SkiAreaRow["counts"]): number {
  if (!counts) return 0;
  return Number(counts.skiRuns ?? 0) + Number(counts.nordicRuns ?? 0);
}

export function SkiAreasPage() {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [areas, setAreas] = useState<SkiAreaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [countries, setCountries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const client = createClient();
    if (!client) return;
    client
      .from("ski_areas")
      .select("country_name")
      .order("country_name")
      .limit(6000)
      .then(({ data }) => {
        const unique = [...new Set((data ?? []).map((r) => r.country_name).filter(Boolean))] as string[];
        setCountries(unique);
      });
  }, []);

  useEffect(() => {
    const client = createClient();
    if (!client) return;
    let active = true;
    setLoading(true);

    let request = client
      .from("ski_areas")
      .select("id,slug,name,country,country_name,region,locality,lifts,ski_types,elevation_min_ft,elevation_max_ft,counts", { count: "exact" })
      .order("lifts", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const trimmed = query.trim();
    if (trimmed) request = request.ilike("name", `%${trimmed}%`);
    if (country) request = request.eq("country_name", country);
    if (type) request = request.contains("ski_types", [type]);

    request.then(({ data, count, error: err }) => {
      if (!active) return;
      setAreas((data ?? []) as SkiAreaRow[]);
      setTotal(count ?? 0);
      setError(err?.message ?? "");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [query, country, type, page]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  return (
    <section className="fieldbook-page">
      <p className="section-label">Explore · Ski areas</p>
      <h1>Ski areas &amp; winter resorts</h1>
      <p className="text-mist">
        {total.toLocaleString()} ski areas worldwide — downhill, nordic, and backcountry — with mapped runs and nearby summer trails.
      </p>

      <div className="mt-4 flex flex-col gap-2 md:flex-row">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search ski areas (e.g. Vail, Chamonix)…"
          className="flex-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-muted px-4 py-2.5 text-sm text-cream outline-none placeholder:text-mist focus:border-accent/40"
        />
        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setPage(0);
          }}
          className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-muted px-3 py-2.5 text-sm text-cream"
        >
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(0);
          }}
          className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-muted px-3 py-2.5 text-sm text-cream"
        >
          <option value="">All types</option>
          <option value="downhill">Downhill</option>
          <option value="nordic">Nordic</option>
          <option value="backcountry">Backcountry</option>
        </select>
      </div>

      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading ski areas…</p>}

      {!loading && !error && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {areas.map((area) => {
              const runs = runTotal(area.counts);
              return (
                <Link
                  key={area.id}
                  href={`/ski-areas/${area.slug}`}
                  className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-4 transition-colors hover:border-accent/40"
                >
                  <h2 className="font-display text-base font-semibold text-cream">{area.name}</h2>
                  <p className="mt-1 text-xs text-mist">
                    {[area.locality, area.region, area.country_name].filter(Boolean).join(", ")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-mist">
                    {area.lifts > 0 && <span>{area.lifts} lifts</span>}
                    {runs > 0 && <span>{runs.toLocaleString()} runs</span>}
                    {area.elevation_max_ft != null && <span>{area.elevation_max_ft.toLocaleString()} ft peak</span>}
                    {area.ski_types.map((t) => (
                      <span key={t} className="rounded-full border border-[var(--border)] px-2 py-0.5 capitalize">
                        {t}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>

          {areas.length === 0 && <p>No ski areas match your search.</p>}

          {totalPages > 1 && (
            <div className="mt-6 flex items-center gap-3 text-sm">
              <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ← Previous
              </button>
              <span className="text-mist">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-ghost"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
