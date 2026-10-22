"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogPhoto } from "@/lib/trail-catalog/photos";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { countryName } from "@/lib/trail-catalog/types";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { ROUTE_TYPE_LABELS } from "@/lib/trail-catalog/quality";
import { DIFFICULTY_FORMULA, DIFFICULTY_LABELS, effortClimbFt, naismithHours, resolveDifficulty, type TrailDifficulty } from "@/lib/trail-difficulty";
import { duration as displayDuration, feet, join, miles as displayMiles, text } from "@/lib/display";
import { SOURCE_TYPE_LABELS } from "@/lib/trail-catalog/agencies";
import { trailSacScale } from "@/lib/trail-catalog/types";

const CHIP: Record<string, string> = { easy: "easy", moderate: "moderate", hard: "hard", expert: "expert" };

/** AllTrails-style header: photo, name, difficulty chip, key stats and primary actions. */
export function CatalogTrailHero({ trail: t, difficulty, distance, hasLines }: { trail: CatalogTrail; difficulty: string; distance: string; hasLines: boolean }) {
  const [photo, setPhoto] = useState<CatalogPhoto | null>(null);
  const [gainFor, setGainFor] = useState<{ id: string; gainFt: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/photos`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d?.photos?.[0]) setPhoto(d.photos[0]); }).catch(() => undefined);
    // Measured climb (DEM) for difficulty and Naismith time; the profile itself is drawn further down.
    if (hasLines) fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/elevation`).then((r) => (r.ok ? r.json() : null)).then((e) => { if (live && Number.isFinite(e?.gainFt)) setGainFor({ id: t.id, gainFt: effortClimbFt(e, t.routeType) ?? e.gainFt }); }).catch(() => undefined);
    return () => { live = false; };
  }, [t.id, hasLines]);
  const gainFt = gainFor?.id === t.id ? gainFor.gainFt : null;
  const head = t.trailhead ?? { latitude: t.latitude, longitude: t.longitude };
  const level = (gainFt !== null ? resolveDifficulty({ reported: t.difficulty, miles: t.miles, gainFt, sacScale: trailSacScale(t) }).difficulty : difficulty) as TrailDifficulty;
  // Naismith's rule, only for trails under 50 mi that aren't summits, expeditions or through-hikes.
  const expedition = Boolean(t.peakCategory) || t.kind === "route" || Boolean(t.partOfRoute) || /\b(summit|expedition)\b/i.test(t.name);
  const hours = expedition ? null : naismithHours(t.miles, gainFt);
  const time = displayDuration(hours);
  const badge = confidenceBadge(t);
  const planPrompt = join([`A trip on ${t.name}`, t.park ?? t.forest ?? t.region, displayMiles(t.miles)], ", ");
  return (
    <header className="trail-hero">
      <div className={`trail-hero-photo${photo ? "" : " trail-hero-photo--none"}`} style={photo ? { backgroundImage: `url("${photo.url}")` } : undefined}>
        <div className="trail-hero-text">
          <span className={`trail-chip ${CHIP[level] ?? ""}`}>{DIFFICULTY_LABELS[level] ?? level}</span>
          {badge && <span className={`trail-confidence trail-confidence--${badge.tier}`} title={badge.detail}>{badge.label}</span>}
          <h1>{t.name}</h1>
          <p>{join([t.park ?? t.forest, t.region, countryName(t.country)])}</p>
        </div>
        {photo && <a className="trail-hero-credit" href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">Photo: {photo.artist} · {photo.license}</a>}
      </div>
      <dl className="trail-stats">
        {text(distance) && <div><dt>Length</dt><dd>{distance}</dd></div>}
        {time && <div><dt>Est. time</dt><dd title="Naismith's rule: 3 mph plus 1 hour per 2,000 ft of climb">{time}</dd></div>}
        {feet(gainFt) && <div><dt>{t.routeType === "loop" ? "Elevation gain" : "Climb"}</dt><dd title={t.routeType === "loop" ? undefined : "The larger of the climb in either direction along the trail"}>{feet(gainFt)}</dd></div>}
        {(t.routeType || t.kind === "route") && <div><dt>Route type</dt><dd>{t.routeType ? ROUTE_TYPE_LABELS[t.routeType] : "Long-distance"}</dd></div>}
        <div><dt>Difficulty</dt><dd title={DIFFICULTY_FORMULA}>{DIFFICULTY_LABELS[level] ?? level}<small className="trail-stat-note">How it’s rated: distance{gainFt !== null ? ", climb" : ""}{trailSacScale(t) ? " and terrain" : ""}</small></dd></div>
        {(t.sectionCount ?? 0) > 1 && <div><dt>Sections</dt><dd>{t.sectionCount!.toLocaleString("en-US")} joined</dd></div>}
      </dl>
      <div className="trail-actions">
        <a className="catalog-button" href={googleMapsDirectionsUrl(head.latitude, head.longitude)} target="_blank" rel="noopener noreferrer">Directions to trailhead</a>
        {hasLines && <a className="catalog-button secondary" href={`/api/trail-catalog/${encodeURIComponent(t.id)}/gpx`} download>Download GPX</a>}
        <Link className="catalog-button secondary" href={`/explore/trails?trail=${encodeURIComponent(t.id)}&lat=${t.latitude}&lng=${t.longitude}&z=13`}>View on map</Link>
        <Link className="catalog-button secondary" href={`/plan?${new URLSearchParams({ prompt: planPrompt ?? t.name, ...(t.region ? { region: t.region } : {}) })}`}>Plan a trip</Link>
        {hasLines && <Link className="catalog-button secondary" href={`/explore/trails?${new URLSearchParams({ routeFrom: `${head.latitude.toFixed(5)},${head.longitude.toFixed(5)}`, routeFromName: t.trailhead?.name ?? t.name, lat: String(head.latitude), lng: String(head.longitude), z: "13" })}`}>Build a route from here</Link>}
      </div>
    </header>
  );
}

const AGENCY: Partial<Record<string, string>> = { NPS_OFFICIAL: "National Park Service", USFS_OFFICIAL: "U.S. Forest Service", BLM_OFFICIAL: "Bureau of Land Management", PARKS_CANADA_OFFICIAL: "Parks Canada", STATE_AGENCY: "State agency", LOCAL_AGENCY: "Local agency", USGS_NTD: "USGS National Digital Trails" };

/** Where the trail comes from: "Verified · National Park Service", "Mapped · OpenStreetMap", or a curated guide. */
function confidenceBadge(t: CatalogTrail): { tier: "verified" | "mapped" | "guide"; label: string; detail: string } | null {
  if (t.peakCategory || t.partOfRoute || t.source === "guide" || t.source === "route-aggregate" || t.source === "peak") return { tier: "guide", label: "Guide · Hyked curated", detail: "A curated guide; facts come from its linked trail and official sources." };
  if (t.tier === "mapped") return { tier: "mapped", label: "Mapped · OpenStreetMap", detail: "Named OpenStreetMap ways that passed every verification rule." };
  if (t.tier === "verified" || t.sourceType) {
    const official = [t.sourceType, ...(t.sources ?? []).map((s) => s.type)].find((k) => k && AGENCY[k]);
    const label = official ? AGENCY[official]! : t.osm ? "OpenStreetMap route" : t.sourceType ? SOURCE_TYPE_LABELS[t.sourceType] : "Official source";
    return { tier: "verified", label: `Verified · ${label}`, detail: "Listed by an official agency dataset or an OpenStreetMap route relation." };
  }
  return null;
}
