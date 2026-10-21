"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogPhoto } from "@/lib/trail-catalog/photos";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { countryName } from "@/lib/trail-catalog/types";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { ROUTE_TYPE_LABELS } from "@/lib/trail-catalog/quality";
import fallback from "@/assets/trail-discovery.jpg";

const CHIP: Record<string, string> = { easy: "easy", moderate: "moderate", hard: "hard", expert: "expert" };

/** AllTrails-style header: photo, name, difficulty chip, key stats and primary actions. */
export function CatalogTrailHero({ trail: t, difficulty, distance, hasLines }: { trail: CatalogTrail; difficulty: string; distance: string; hasLines: boolean }) {
  const [photo, setPhoto] = useState<CatalogPhoto | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/photos`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d?.photos?.[0]) setPhoto(d.photos[0]); }).catch(() => undefined);
    return () => { live = false; };
  }, [t.id]);
  const head = t.trailhead ?? { latitude: t.latitude, longitude: t.longitude };
  const img = photo?.url ?? (typeof fallback === "string" ? fallback : (fallback as { src: string }).src);
  const hours = t.miles ? t.miles / 2 : null;
  const time = hours ? (hours < 1 ? `${Math.max(10, Math.round(hours * 60 / 5) * 5)} min` : `${Math.floor(hours)} h ${Math.round((hours % 1) * 60 / 5) * 5} min`) : "—";
  return (
    <header className="trail-hero">
      <div className="trail-hero-photo" style={{ backgroundImage: `url("${img}")` }}>
        <div className="trail-hero-text">
          <span className={`trail-chip ${CHIP[difficulty] ?? ""}`}>{difficulty}</span>
          <h1>{t.name}</h1>
          <p>{[t.park ?? t.forest, t.region, countryName(t.country)].filter(Boolean).join(" · ")}</p>
        </div>
        {photo && <a className="trail-hero-credit" href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">Photo: {photo.artist} · {photo.license}</a>}
      </div>
      <dl className="trail-stats">
        <div><dt>Length</dt><dd>{distance}</dd></div>
        <div><dt>Est. time</dt><dd>{time}</dd></div>
        <div><dt>Route type</dt><dd>{t.routeType ? ROUTE_TYPE_LABELS[t.routeType] : t.kind === "route" ? "Long-distance" : "—"}</dd></div>
        <div><dt>Difficulty</dt><dd className="capitalize">{difficulty}</dd></div>
      </dl>
      <div className="trail-actions">
        <a className="catalog-button" href={googleMapsDirectionsUrl(head.latitude, head.longitude)} target="_blank" rel="noopener noreferrer">Directions to trailhead</a>
        {hasLines && <a className="catalog-button secondary" href={`/api/trail-catalog/${encodeURIComponent(t.id)}/gpx`} download>Download GPX</a>}
        <Link className="catalog-button secondary" href={`/explore/trails?trail=${encodeURIComponent(t.id)}&lat=${t.latitude}&lng=${t.longitude}&z=13`}>View on map</Link>
        <Link className="catalog-button secondary" href={`/plan?prompt=${encodeURIComponent(t.name)}`}>Plan a trip</Link>
      </div>
    </header>
  );
}
