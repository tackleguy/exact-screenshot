"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogPhoto } from "@/lib/trail-catalog/photos";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { countryName } from "@/lib/trail-catalog/types";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { ROUTE_TYPE_LABELS } from "@/lib/trail-catalog/quality";
import { DIFFICULTY_FORMULA, DIFFICULTY_LABELS, effortClimbFt, naismithHours, type TrailDifficulty } from "@/lib/trail-difficulty";
import { duration as displayDuration, feet, join, miles as displayMiles, text } from "@/lib/display";
import { SOURCE_TYPE_LABELS } from "@/lib/trail-catalog/agencies";
import { trailSacScale } from "@/lib/trail-catalog/types";

const CHIP: Record<string, string> = { easy: "easy", moderate: "moderate", hard: "hard", expert: "expert" };

/**
 * Satellite picture of the trail's area (Esri World Imagery) for trails without a photo: the trail's extent when
 * known, otherwise about 5 km around its start, in the banner's 1200 × 420 shape.
 */
function satelliteImage(t: CatalogTrail) {
  const [w, s, e, n] = t.bounds ?? [t.longitude - 0.03, t.latitude - 0.012, t.longitude + 0.03, t.latitude + 0.012];
  const cx = (w + e) / 2, cy = (s + n) / 2;
  const cos = Math.max(0.2, Math.cos((cy * Math.PI) / 180));
  const half = Math.min(25, Math.max(0.02, (e - w) / 2, ((n - s) / 2 / cos) * (1200 / 420)) * 1.15);
  const halfY = Math.min(80, (half * cos * 420) / 1200);
  const box = [cx - half, Math.max(-85, cy - halfY), cx + half, Math.min(85, cy + halfY)].map((v) => v.toFixed(5)).join(",");
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${new URLSearchParams({ bbox: box, bboxSR: "4326", imageSR: "3857", size: "1200,420", format: "jpg", f: "image" })}`;
}

/** AllTrails-style header: photo, name, difficulty chip, key stats and primary actions. */
export function CatalogTrailHero({ trail: t, difficulty, distance, hasLines }: { trail: CatalogTrail; difficulty: string; distance: string; hasLines: boolean }) {
  const [photo, setPhoto] = useState<CatalogPhoto | null>(null);
  const [gainFor, setGainFor] = useState<{ id: string; gainFt: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/photos`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d?.photos?.[0]) setPhoto(d.photos[0]); }).catch(() => undefined);
    // Trails the data build measured carry their climb; others measure it here (for the time estimate only — the
    // difficulty always comes from the stored measures, so it matches the list, the map and the page title).
    if (hasLines && !Number.isFinite(t.gainFt)) fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/elevation`).then((r) => (r.ok ? r.json() : null)).then((e) => { if (live && Number.isFinite(e?.gainFt)) setGainFor({ id: t.id, gainFt: effortClimbFt(e, t.routeType) ?? e.gainFt }); }).catch(() => undefined);
    return () => { live = false; };
  }, [t.id, t.gainFt, hasLines]);
  const gainFt = Number.isFinite(t.gainFt) ? (t.gainFt as number) : gainFor?.id === t.id ? gainFor.gainFt : null;
  const head = t.trailhead ?? { latitude: t.latitude, longitude: t.longitude };
  const level = difficulty as TrailDifficulty;
  // Naismith's rule, only for trails under 50 mi that aren't summits, expeditions or through-hikes.
  const expedition = Boolean(t.peakCategory) || t.kind === "route" || Boolean(t.partOfRoute) || /\b(summit|expedition)\b/i.test(t.name);
  const hours = expedition ? null : naismithHours(t.miles, gainFt);
  const time = displayDuration(hours);
  const badge = confidenceBadge(t);
  const planPrompt = join([`A trip on ${t.name}`, t.park ?? t.forest ?? t.region, displayMiles(t.miles)], ", ");
  return (
    <header className="trail-hero">
      <div className={`trail-hero-photo${photo ? "" : " trail-hero-photo--satellite"}`} style={{ backgroundImage: `url("${photo ? photo.url : satelliteImage(t)}")` }}>
        <div className="trail-hero-text">
          <span className={`trail-chip ${CHIP[level] ?? ""}`}>{DIFFICULTY_LABELS[level] ?? level}</span>
          {badge && <span className={`trail-confidence trail-confidence--${badge.tier}`} title={badge.detail}>{badge.label}</span>}
          <h1>{t.name}</h1>
          <p>{join([t.park ?? t.forest, t.region, countryName(t.country)])}</p>
        </div>
        {photo ? <a className="trail-hero-credit" href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">Photo: {photo.artist} · {photo.license}</a> : <span className="trail-hero-credit">Imagery: Esri, Maxar, Earthstar Geographics</span>}
      </div>
      <dl className="trail-stats">
        {text(distance) && <div><dt>Length</dt><dd>{distance}</dd></div>}
        {time && <div><dt>Est. time</dt><dd title="Naismith's rule: 3 mph plus 1 hour per 2,000 ft of climb">{time}</dd></div>}
        {feet(gainFt) && <div><dt>{t.routeType === "loop" ? "Elevation gain" : "Climb"}</dt><dd title={t.routeType === "loop" ? undefined : "The larger of the climb in either direction along the trail"}>{feet(gainFt)}</dd></div>}
        {(t.routeType || t.kind === "route") && <div><dt>Route type</dt><dd>{t.routeType ? ROUTE_TYPE_LABELS[t.routeType] : "Long-distance"}</dd></div>}
        <div><dt>Difficulty</dt><dd title={DIFFICULTY_FORMULA}>{DIFFICULTY_LABELS[level] ?? level}<small className="trail-stat-note">How it’s rated: distance{Number.isFinite(t.gainFt) ? " and climb" : ""}</small></dd></div>
        {(t.sectionCount ?? 0) > 1 && <div><dt>Sections</dt><dd>{t.sectionCount!.toLocaleString("en-US")} joined</dd></div>}
      </dl>
      <div className="trail-actions">
        <Link className="catalog-button trail-start" href={`/record/live?${new URLSearchParams({ trail_id: t.id, name: t.name, type: recordType(t) })}`}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          Start trail
        </Link>
        <a className="catalog-button secondary" href={googleMapsDirectionsUrl(head.latitude, head.longitude)} target="_blank" rel="noopener noreferrer">Directions</a>
        <Link className="catalog-button secondary" href={`/explore/trails?trail=${encodeURIComponent(t.id)}&lat=${t.latitude}&lng=${t.longitude}&z=13`}>View on map</Link>
        <details className="trail-actions-more">
          <summary className="catalog-button secondary">More</summary>
          <div>
            {hasLines && <a href={`/api/trail-catalog/${encodeURIComponent(t.id)}/gpx`} download>Download GPX</a>}
            <Link href={`/plan?${new URLSearchParams({ prompt: planPrompt ?? t.name, ...(t.region ? { region: t.region } : {}) })}`}>Plan a trip</Link>
            {hasLines && <Link href={`/explore/trails?${new URLSearchParams({ routeFrom: `${head.latitude.toFixed(5)},${head.longitude.toFixed(5)}`, routeFromName: t.trailhead?.name ?? t.name, lat: String(head.latitude), lng: String(head.longitude), z: "13" })}`}>Build a route from here</Link>}
          </div>
        </details>
      </div>
    </header>
  );
}

/** What the GPS recorder logs for this trail: bike and ski trails record as rides and ski days. */
function recordType(t: CatalogTrail) {
  const uses = (t.uses ?? []).join(" ");
  if (t.winterUse || t.osm?.route === "ski" || t.osm?.route === "piste") return "ski";
  if (t.osm?.route === "bicycle" || t.osm?.route === "mtb" || (/bike/i.test(uses) && !/hiking/i.test(uses))) return "bike";
  if (t.osm?.route === "running") return "run";
  return "hike";
}

const AGENCY: Partial<Record<string, string>> = { NPS_OFFICIAL: "National Park Service", USFS_OFFICIAL: "U.S. Forest Service", BLM_OFFICIAL: "Bureau of Land Management", PARKS_CANADA_OFFICIAL: "Parks Canada", STATE_AGENCY: "State agency", LOCAL_AGENCY: "Local agency", USGS_NTD: "USGS National Digital Trails" };

/** Where the trail comes from: "Verified · National Park Service", "Verified route", "Mapped trail", or a curated guide. */
function confidenceBadge(t: CatalogTrail): { tier: "verified" | "mapped" | "guide"; label: string; detail: string } | null {
  if (t.peakCategory || t.source === "guide" || t.source === "route-aggregate" || t.source === "peak") return { tier: "guide", label: "Guide · Hyked curated", detail: "A curated guide; facts come from its linked trail and official sources." };
  if (t.tier === "mapped") return { tier: "mapped", label: "Mapped trail", detail: "A named, community-mapped trail that passed every verification check." };
  if (t.tier === "verified" || t.sourceType) {
    const official = [t.sourceType, ...(t.sources ?? []).map((s) => s.type)].find((k) => k && AGENCY[k]);
    const label = official ? `Verified · ${AGENCY[official]!}` : t.osm ? "Verified route" : `Verified · ${t.sourceType ? SOURCE_TYPE_LABELS[t.sourceType] : "Official source"}`;
    return { tier: "verified", label, detail: "Listed by an official agency or a signposted, mapped route." };
  }
  return null;
}
