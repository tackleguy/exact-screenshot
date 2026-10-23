"use client";
import { useState, type ReactNode } from "react";
import type { CatalogMapResult, CatalogTrail } from "@/lib/trail-catalog/types";
import { CatalogExplorerMap } from "./CatalogExplorerMap";

export function CatalogMap({ trails, mapData, query, summary, tools, children }: { trails: CatalogTrail[]; mapData: CatalogMapResult | null; query: string; summary: string; tools: ReactNode; children: ReactNode }) {
  // The list leads; the map opens on request (the Explore map is the full map).
  const [open, setOpen] = useState(false);
  return <>
    <div className="catalog-results-heading"><p role="status">{summary}</p><div>{tools}{trails.length > 0 && <button type="button" className="catalog-button secondary" aria-expanded={open} aria-controls="catalog-result-map" onClick={() => setOpen(!open)}>{open ? "Hide map" : "Map view"}</button>}</div></div>
    {open && trails.length > 0 && <div id="catalog-result-map" className="catalog-result-map"><CatalogExplorerMap key={query} initialData={mapData} query={query} /></div>}
    <div className="catalog-workspace">{children}</div>
  </>;
}
