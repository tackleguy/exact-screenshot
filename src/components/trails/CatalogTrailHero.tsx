"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogPhoto } from "@/lib/trail-catalog/photos";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { countryName } from "@/lib/trail-catalog/types";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { ROUTE_TYPE_LABELS } from "@/lib/trail-catalog/quality";
import { DIFFICULTY_LABELS, naismithHours, resolveDifficulty, type TrailDifficulty } from "@/lib/trail-difficulty";

const CHIP: Record<string, string> = { easy: "easy", moderate: "moderate", hard: "hard", expert: "expert" };

/** AllTrails-style header: photo, name, difficulty chip, key stats and primary actions. */
export function CatalogTrailHero({ trail: t, difficulty, distance, hasLines }: { trail: CatalogTrail; difficulty: string; distance: string; hasLines: boolean }) {
  const [photo, setPhoto] = useState<CatalogPhoto | null>(null);
  const [gainFor, setGainFor] = useState<{ id: string; gainFt: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/photos`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d?.photos?.[0]) setPhoto(d.photos[0]); }).catch(() => undefined);
    // Measured climb (DEM) for difficulty and Naismith time; the profile itself is drawn further down.
    if (hasLines) fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/elevation`).then((r) => (r.ok ? r.json() : null)).then((e) => { if (live && Number.isFinite(e?.gainFt)) setGainFor({ id: t.id, gainFt: e.gainFt }); }).catch(() => undefined);
    return () => { live = false; };
  }, [t.id, hasLines]);
  const gainFt = gainFor?.id === t.id ? gainFor.gainFt : null;
  const head = t.trailhead ?? { latitude: t.latitude, longitude: t.longitude };
  const level = (gainFt !== null ? resolveDifficulty({ reported: t.difficulty, miles: t.miles, gainFt, sacScale: t.osm?.sacScale }).difficulty : difficulty) as TrailDifficulty;
  // Naismith's rule, only for day-length trails that aren't expeditions.
  const expedition = t.peakCategory === "8000m" || t.peakCategory === "seven-summits";
  const hours = expedition ? null : naismithHours(t.miles, gainFt);
  const time = hours ? (hours < 1 ? `${Math.max(10, Math.round(hours * 60 / 5) * 5)} min` : `${Math.floor(hours)} h ${Math.round((hours % 1) * 60 / 5) * 5} min`) : null;
  return (
    <header className="trail-hero">
      <div className={`trail-hero-photo${photo ? "" : " trail-hero-photo--none"}`} style={photo ? { backgroundImage: `url("${photo.url}")` } : undefined}>
        <div className="trail-hero-text">
          <span className={`trail-chip ${CHIP[level] ?? ""}`}>{DIFFICULTY_LABELS[level] ?? level}</span>
          <h1>{t.name}</h1>
          <p>{[t.park ?? t.forest, t.region, countryName(t.country)].filter(Boolean).join(" · ")}</p>
        </div>
        {photo && <a className="trail-hero-credit" href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">Photo: {photo.artist} · {photo.license}</a>}
      </div>
      <dl className="trail-stats">
        <div><dt>Length</dt><dd>{distance}</dd></div>
        {time && <div><dt>Est. time</dt><dd title="Naismith's rule: 3 mph plus 1 hour per 2,000 ft of climb">{time}</dd></div>}
        {gainFt !== null && <div><dt>Elevation gain</dt><dd>{gainFt.toLocaleString("en-US")} ft</dd></div>}
        <div><dt>Route type</dt><dd>{t.routeType ? ROUTE_TYPE_LABELS[t.routeType] : t.kind === "route" ? "Long-distance" : "—"}</dd></div>
        <div><dt>Difficulty</dt><dd>{DIFFICULTY_LABELS[level] ?? level}</dd></div>
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
