import type { Metadata } from "next";
import { Suspense } from "react";
import { SkiMapClient } from "@/components/ski/SkiMapClient";

export const metadata: Metadata = { title: "Nordic ski trails — Hyked", description: "Find cross-country ski trails and ski areas on the map." };

export default function ExploreSkiPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-96 items-center justify-center text-stone-500">
          Loading ski map…
        </div>
      }
    >
      <SkiMapClient />
    </Suspense>
  );
}
