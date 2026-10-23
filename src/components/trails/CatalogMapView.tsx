"use client";

import dynamic from "next/dynamic";

// MapLibre needs the browser (WebGL), so the map only renders on the client.
export const CatalogMapView = dynamic(
  () => import("./CatalogMapViewGl").then((m) => m.CatalogMapView),
  { ssr: false, loading: () => <div className="catalog-map-canvas" aria-hidden /> },
);
