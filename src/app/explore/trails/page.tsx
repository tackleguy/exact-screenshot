import Link from "next/link";
import { Suspense } from "react";
import { getTrails } from "@/lib/data";
import { parseTrailFilters, queryTrailsFiltered } from "@/lib/trails";
import { createClient } from "@/lib/supabase/server";
import { TrailCard } from "@/components/trails/TrailCard";
import { TrailSearchFilters } from "@/components/trails/TrailSearchFilters";
import { TrailsExploreMap } from "@/components/trails/TrailsExploreMap";
import { GpxRouteUpload } from "@/components/trails/GpxRouteUpload";
import { CatalogBrowser } from "@/components/trails/CatalogBrowser";

export const metadata = { title: "Explore trails — Hyked" };

export default async function ExploreTrailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") urlParams.set(key, value);
  }

  if (params.collection !== "community") return <CatalogBrowser params={urlParams} />;

  const filters = parseTrailFilters(urlParams);
  const hasFilters = [...urlParams.keys()].length > 0;

  let trails: Awaited<ReturnType<typeof getTrails>> = [];

  try {
    const supabase = await createClient();
    if (supabase && hasFilters) {
      trails = await queryTrailsFiltered(supabase, filters);
    } else {
      trails = await getTrails();
    }
  } catch {
    // handled below
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 pb-24 sm:px-6 md:pb-10">
      <div className="mb-6">
        <Link href="/explore/trails" className="text-accent underline">← Canada & U.S. trail catalog</Link>
        <p className="section-label">Explore · Trails</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-cream sm:text-4xl">
          Find your next hike
        </h1>
        <p className="mt-2 text-mist">
          {trails.length} trails
          {hasFilters ? " matching filters" : ""}
        </p>
      </div>

      <Suspense fallback={null}>
        <TrailSearchFilters />
      </Suspense>

      <GpxRouteUpload className="mb-8" />

      {trails.length > 0 && <TrailsExploreMap trails={trails} />}

      {trails.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trails.map((trail) => (
            <TrailCard key={trail.id} trail={trail} />
          ))}
        </div>
      ) : (
        <p className="surface-card px-6 py-12 text-center text-mist">
          No trails found.{" "}
          <Link href="/explore/trails" className="text-accent hover:underline">
            Clear filters
          </Link>{" "}
          to try another search.
        </p>
      )}
    </div>
  );
}
