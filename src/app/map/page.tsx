import type { Metadata } from "next";
import { getParks } from "@/lib/data";
import { searchCatalogMap } from "@/lib/trail-catalog/server";
import { MapPageClient } from "@/components/map/MapPageClient";
import type { MapMarker } from "@/lib/types";
import type { CatalogMapResult } from "@/lib/trail-catalog/types";

export const metadata: Metadata = { title: "Adventure map — Hyked", description: "Map of hiking trails across Canada and the United States." };

export default async function MapPage() {
  let markers: MapMarker[] = [];
  let catalogMap: CatalogMapResult | null = null;

  try {
    const [parks, catalog] = await Promise.all([
      getParks().catch(() => []),
      searchCatalogMap().catch(() => null),
    ]);
    catalogMap = catalog;
    markers = parks.map((park) => ({
      id: park.id,
      type: "park" as const,
      name: park.park_name,
      latitude: park.latitude,
      longitude: park.longitude,
      subtitle: `${park.state}, ${park.country}`,
      href: `/parks/${park.id}`,
    }));
  } catch {
    // empty markers
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <MapPageClient markers={markers} catalogMap={catalogMap} />
    </div>
  );
}
