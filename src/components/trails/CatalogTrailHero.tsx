"use client";

import { TrailStats } from "./TrailStats";
import { SaveHeart } from "./SaveHeart";
import { Stars, useTrailRating } from "./TrailReviews";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogPhoto } from "@/lib/trail-catalog/photos";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { countryName } from "@/lib/trail-catalog/types";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { DIFFICULTY_LABELS, effortClimbFt, type TrailDifficulty } from "@/lib/trail-difficulty";
import { join, miles as displayMiles } from "@/lib/display";
import { SOURCE_TYPE_LABELS } from "@/lib/trail-catalog/agencies";

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
export function CatalogTrailHero({ trail: t, difficulty, hasLines }: { trail: CatalogTrail; difficulty: string; distance?: string; hasLines: boolean }) {
  const [photos, setPhotos] = useState<{ id: string; list: CatalogPhoto[] } | null>(null);
  const { average, count, available } = useTrailRating(t.id);
  const [shared, setShared] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [gainFor, setGainFor] = useState<{ id: string; gainFt: number } | null>(null);
  useEffect(() => {
    let live = true;
    // Hero strip: the trail's own licensed photos, filled up to three with geotagged photos taken nearby.
    const base = `/api/trail-catalog/${encodeURIComponent(t.id)}/photos`;
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).then((d: { photos?: CatalogPhoto[] } | null) => d?.photos ?? []).catch(() => [] as CatalogPhoto[]);
    void get(base).then(async (own) => {
      const list = own.length >= 3 ? own : [...own, ...(await get(`${base}?nearby=1`)).filter((p) => !own.some((o) => o.id === p.id))];
      if (live) setPhotos({ id: t.id, list: list.slice(0, 3) });
    });
    // Trails the data build measured carry their climb; others measure it here (for the time estimate only — the
    // difficulty always comes from the stored measures, so it matches the list, the map and the page title).
    if (hasLines && !Number.isFinite(t.gainFt)) fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/elevation`).then((r) => (r.ok ? r.json() : null)).then((e) => { if (live && Number.isFinite(e?.gainFt)) setGainFor({ id: t.id, gainFt: effortClimbFt(e, t.routeType) ?? e.gainFt }); }).catch(() => undefined);
    return () => { live = false; };
  }, [t.id, t.gainFt, t.routeType, hasLines]);
  const strip = photos?.id === t.id ? photos.list : [];
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title: t.name, url }); return; }
      await navigator.clipboard.writeText(url);
      setShared("Link copied");
    } catch { setShared(null); }
  };
  const gainFt = Number.isFinite(t.gainFt) ? (t.gainFt as number) : gainFor?.id === t.id ? gainFor.gainFt : null;
  const head = t.trailhead ?? { latitude: t.latitude, longitude: t.longitude };
  const level = difficulty as TrailDifficulty;
  // No time estimate for summits, expeditions or through-hikes (they take days or depend on the route chosen).
  const expedition = Boolean(t.peakCategory) || t.kind === "route" || /\b(summit|expedition)\b/i.test(t.name);
  const badge = confidenceBadge(t);
  const planPrompt = join([`A trip on ${t.name}`, t.park ?? t.forest ?? t.region, displayMiles(t.miles)], ", ");
  return (
    <>
    <header className="trail-hero">
      <div className={`trail-hero-photo${strip.length ? " trail-hero-photo--strip" : " trail-hero-photo--satellite"}`} style={strip.length ? undefined : { backgroundImage: `url("${satelliteImage(t)}")` }}>
        {strip.length > 0 && (
          <div className={`trail-hero-strip trail-hero-strip--${strip.length}`}>
            {strip.map((p) => <img key={p.id} src={p.url} alt={p.title || `Near ${t.name}`} loading="eager" />)}
          </div>
        )}
        <div className="trail-hero-text">
          <span className={`trail-chip ${CHIP[level] ?? ""}`}>{DIFFICULTY_LABELS[level] ?? level}</span>
          {badge && <span className={`trail-confidence trail-confidence--${badge.tier}`} title={badge.detail}>{badge.label}</span>}
          <h1>{t.name}</h1>
          <p>{join([t.park ?? t.forest, t.region, countryName(t.country)])}</p>
          {available && <p className="trail-hero-rating"><Stars value={average} /> <span>{count ? `${average!.toFixed(1)} (${count})` : "No ratings yet"}</span></p>}
        </div>
        {strip.length ? (
          <span className="trail-hero-credit">{strip.map((p, i) => <a key={p.id} href={p.sourceUrl} target="_blank" rel="noopener noreferrer">{i ? " · " : "Photos: "}{p.artist} ({p.license})</a>)}</span>
        ) : <span className="trail-hero-credit">Imagery: Esri, Maxar, Earthstar Geographics</span>}
      </div>
      <TrailStats detail trail={{ miles: t.miles, gainFt, lossFt: t.lossFt, steepestGradePct: t.steepestGradePct, minElevFt: t.minElevFt, maxElevFt: t.maxElevFt, routeType: t.routeType, difficulty: level, multiDay: expedition }} />
    </header>
      {/* Sticky action bar, outside the header so it stays in reach all the way down the page. */}
      <div className="trail-actions trail-actions--sticky">
        {recordType(t) === "hike" ? (
          // Hiking trails ask how: a day hike, or a backpacking trip (campsites, water, towns and permits on the way).
          <div className="trail-start-wrap">
            <button type="button" className="catalog-button trail-start" aria-expanded={startOpen} aria-controls="trail-start-choice" onClick={() => setStartOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
              Start trail
            </button>
            {startOpen && (
              <div id="trail-start-choice" className="trail-start-choice" role="group" aria-label="How are you doing this trail?">
                <Link href={`/record/live?${new URLSearchParams({ trail_id: t.id, name: t.name, type: "hike" })}`}>
                  <strong>Day hike</strong>
                  <span>Record your hike with live stats</span>
                </Link>
                <Link href={`/record/live?${new URLSearchParams({ trail_id: t.id, name: t.name, type: "hike", trip: "backpack" })}`}>
                  <strong>Backpacking trip</strong>
                  <span>Campsites, water, towns and permits along the way</span>
                </Link>
              </div>
            )}
          </div>
        ) : (
          <Link className="catalog-button trail-start" href={`/record/live?${new URLSearchParams({ trail_id: t.id, name: t.name, type: recordType(t) })}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
            Start trail
          </Link>
        )}
        <a className="catalog-button secondary" href={googleMapsDirectionsUrl(head.latitude, head.longitude)} target="_blank" rel="noopener noreferrer">Directions</a>
        <SaveHeart trailId={t.id} name={t.name} label className="catalog-button secondary" />
        <button type="button" className="catalog-button secondary" onClick={share}>{shared ?? "Share"}</button>
        <details className="trail-actions-more">
          <summary className="catalog-button secondary">More</summary>
          <div>
            <Link href={`/explore/trails?trail=${encodeURIComponent(t.id)}&lat=${t.latitude}&lng=${t.longitude}&z=13`}>View on map</Link>
            {hasLines && <a href={`/api/trail-catalog/${encodeURIComponent(t.id)}/gpx`} download>Download GPX</a>}
            <Link href={`/plan?${new URLSearchParams({ prompt: planPrompt ?? t.name, ...(t.region ? { region: t.region } : {}) })}`}>Plan a trip</Link>
            {hasLines && <Link href={`/explore/trails?${new URLSearchParams({ routeFrom: `${head.latitude.toFixed(5)},${head.longitude.toFixed(5)}`, routeFromName: t.trailhead?.name ?? t.name, lat: String(head.latitude), lng: String(head.longitude), z: "13" })}`}>Build a route from here</Link>}
          </div>
        </details>
      </div>
    </>
  );
}

/** What the GPS recorder logs for this trail: bike and ski trails record as rides and ski days. */
function recordType(t: CatalogTrail) {
  const uses = (t.uses ?? []).join(" ");
  if (t.winterUse || t.osm?.route === "ski" || t.osm?.route === "piste") return "ski";
  if (t.osm?.route === "bicycle" || t.osm?.route === "mtb" || (t.trailType !== "hiking" && /bike|bicycl/i.test(uses) && !/hik|foot|walk|pedestrian/i.test(uses))) return "bike";
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
