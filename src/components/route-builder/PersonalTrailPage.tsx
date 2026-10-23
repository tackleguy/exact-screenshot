"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { deletePersonalTrail, getPersonalTrail, getSharedPersonalTrail, setPersonalTrailSharing, type PersonalTrail } from "@/lib/personal-trails";
import { CatalogMapView } from "@/components/trails/CatalogMapView";
import { TrailWeatherForecast } from "@/components/trails/TrailWeatherForecast";
import { TrailElevationProfile } from "@/components/trails/TrailElevationProfile";
import { googleMapsDirectionsUrl, appleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { computeDifficulty, DIFFICULTY_FORMULA, DIFFICULTY_LABELS } from "@/lib/trail-difficulty";
import { elevationProfile, type ElevationProfile } from "@/lib/trip/elevation";
import { metersBetween, MILE_METERS } from "@/lib/geo/line";
import { duration, feet, join, miles as fmtMiles, text } from "@/lib/display";
import { FEATURE_LABELS, featureGroup } from "@/lib/routing/features";
import { downloadGpx, routeGpx } from "@/lib/routing/gpx";
import "@/components/trails/catalog.css";
import "./route-builder.css";

const CHIP: Record<string, string> = { easy: "easy", moderate: "moderate", hard: "hard", expert: "expert" };

type Loaded = { key: string; trail: PersonalTrail | null; error?: string };

/**
 * A saved personal trail, on the same template as catalog trails: hero, stats, confidence badge ("Personal"),
 * forecast, elevation profile, features by mile, GPX, directions and Plan a trip. `token` opens a shared link.
 */
export function PersonalTrailPage({ id, token }: { id?: string; token?: string }) {
  const key = id ? `id:${id}` : `token:${token}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [elevation, setElevation] = useState<{ key: string; value: ElevationProfile | null } | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let live = true;
    (id ? getPersonalTrail(id) : getSharedPersonalTrail(token ?? ""))
      .then((trail) => { if (live) setLoaded({ key, trail }); })
      .catch((e: unknown) => { if (live) setLoaded({ key, trail: null, error: e instanceof Error ? e.message : "This trail couldn’t load." }); });
    return () => { live = false; };
  }, [id, token, key]);

  const state = loaded?.key === key ? loaded : null;
  const trail = state?.trail ?? null;
  // One stable array per trail, so the map only redraws when the trail changes.
  const lines = useMemo(() => (trail ? [trail.geometry] : []), [trail]);

  useEffect(() => {
    if (!trail || trail.geometry.length < 2) return;
    let live = true;
    elevationProfile([trail.geometry], 300).then((value) => { if (live) setElevation({ key: trail.id, value }); }).catch(() => { if (live) setElevation({ key: trail.id, value: null }); });
    return () => { live = false; };
  }, [trail]);

  useEffect(() => {
    if (trail) document.title = `${trail.name} · ${fmtMiles(trail.stats.miles) ?? "Personal trail"} | Hyked`;
  }, [trail]);

  if (!state) return <section className="fieldbook-page"><h1>Loading trail…</h1></section>;
  if (!trail) return <section className="fieldbook-page"><h1>Trail unavailable</h1><p role="status">{state.error ?? (token ? "This share link is no longer active." : "This trail isn’t in your account. Sign in with the account that saved it.")}</p><Link className="btn-ghost" href="/explore/trails">Back to the map</Link></section>;

  const own = Boolean(id);
  const profile = elevation?.key === trail.id ? elevation.value : null;
  const gainFt = trail.stats.gainFt ?? profile?.gainFt ?? null;
  // No rating rather than a made-up one when the route has no measurable length.
  const level = computeDifficulty({ miles: trail.stats.miles, gainFt });
  const start = trail.geometry[0], finish = trail.geometry[trail.geometry.length - 1];
  const loop = metersBetween(start, finish) < 200;
  const water = trail.features.filter((f) => featureGroup(f.type) === "water").length;
  const camps = trail.features.filter((f) => featureGroup(f.type) === "camping").length;
  const shareUrl = trail.shareToken ? `${window.location.origin}/shared/trails/${encodeURIComponent(trail.shareToken)}` : null;

  async function toggleSharing() {
    try {
      const next = await setPersonalTrailSharing(trail!.id, !trail!.isPublic);
      setLoaded({ key, trail: next });
      setNotice(next.isPublic ? "Anyone with the link can view this trail." : "Sharing is off. The old link no longer works.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Sharing couldn’t be changed."); }
  }
  async function copyLink() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setNotice("Link copied."); } catch { setNotice(shareUrl); }
  }
  async function remove() {
    try { await deletePersonalTrail(trail!.id); router.push("/explore/trails"); }
    catch (e) { setNotice(e instanceof Error ? e.message : "The trail couldn’t be deleted."); }
  }

  return (
    <article className="catalog-shell catalog-detail">
      <Link className="catalog-link" href="/explore/trails">← Trail map</Link>
      <header className="trail-hero">
        <div className={`trail-hero-photo${trail.photoUrl ? "" : " trail-hero-photo--none"}`} style={trail.photoUrl ? { backgroundImage: `url("${trail.photoUrl}")` } : undefined}>
          <div className="trail-hero-text">
            {level && <span className={`trail-chip ${CHIP[level] ?? ""}`}>{DIFFICULTY_LABELS[level]}</span>}
            <span className="trail-confidence trail-confidence--personal" title="A route built in Hyked from mapped trails">{own ? "Personal · your route" : "Personal · shared route"}</span>
            <h1>{trail.name}</h1>
            <p>{join([`${trail.trails.filter((t) => t.id).length} ${trail.trails.filter((t) => t.id).length === 1 ? "trail" : "trails"}`, trail.days?.length ? `${trail.days.length} days` : null])}</p>
          </div>
        </div>
        <dl className="trail-stats">
          {fmtMiles(trail.stats.miles) && <div><dt>Length</dt><dd>{fmtMiles(trail.stats.miles)}</dd></div>}
          {duration(trail.stats.hours) && <div><dt>Est. time</dt><dd title="Naismith's rule: 3 mph plus 1 hour per 2,000 ft of climb">{duration(trail.stats.hours)}</dd></div>}
          {feet(gainFt) && <div><dt>Climb</dt><dd>{feet(gainFt)}</dd></div>}
          <div><dt>Route type</dt><dd>{loop ? "Loop" : "Point to point"}</dd></div>
          {level && <div><dt>Difficulty</dt><dd title={DIFFICULTY_FORMULA}>{DIFFICULTY_LABELS[level]}<small className="trail-stat-note">How it’s rated: distance{feet(gainFt) ? " and climb" : ""}</small></dd></div>}
        </dl>
        <div className="trail-actions">
          <a className="catalog-button" href={googleMapsDirectionsUrl(start[1], start[0])} target="_blank" rel="noopener noreferrer">Directions to start</a>
          <a className="catalog-button secondary" href={appleMapsDirectionsUrl(start[1], start[0], trail.name)} target="_blank" rel="noopener noreferrer">Apple Maps</a>
          <button type="button" className="catalog-button secondary" onClick={() => downloadGpx(trail.name, routeGpx(trail.name, trail.geometry, trail.features))}>Download GPX</button>
          <Link className="catalog-button secondary" href={`/plan?personalTrail=${encodeURIComponent(trail.id)}`}>Plan a trip</Link>
          <Link className="catalog-button secondary" href={`/explore/trails?lat=${start[1].toFixed(4)}&lng=${start[0].toFixed(4)}&z=12`}>View on map</Link>
        </div>
      </header>

      {text(trail.notes) && <section className="catalog-about" aria-label="Notes"><p>{trail.notes}</p></section>}

      {own && (
        <section className="pt-owner" aria-label="Sharing">
          <p><strong>{trail.isPublic ? "Shared by link" : "Private"}</strong> — {trail.isPublic ? "anyone with the link can view it." : "only you can see this trail."}</p>
          <div className="trail-actions">
            <button type="button" className="catalog-button secondary" onClick={() => void toggleSharing()}>{trail.isPublic ? "Stop sharing" : "Create share link"}</button>
            {trail.isPublic && shareUrl && <button type="button" className="catalog-button secondary" onClick={() => void copyLink()}>Copy link</button>}
            {confirmDelete
              ? <><button type="button" className="catalog-button" onClick={() => void remove()}>Delete for good</button><button type="button" className="catalog-button secondary" onClick={() => setConfirmDelete(false)}>Keep it</button></>
              : <button type="button" className="catalog-button secondary" onClick={() => setConfirmDelete(true)}>Delete trail</button>}
          </div>
          {notice && <p className="catalog-muted" role="status">{notice}</p>}
        </section>
      )}

      <div className="catalog-detail-map-heading"><h2>Route map</h2></div>
      <CatalogMapView lines={lines} />
      <p className="catalog-muted">Built from mapped trails (OpenStreetMap © contributors, ODbL; official agency data). This is a planning line, not a GPS track: check signs, closures and access.</p>

      <TrailWeatherForecast variant="catalog" lat={start[1]} lng={start[0]} locationLabel="route start" />

      {profile && profile.profile.length > 2 && (
        <section className="pt-section" aria-label="Elevation">
          <h2>Elevation</h2>
          <p>{join([feet(profile.gainFt) && `+${feet(profile.gainFt)} climb`, feet(profile.lossFt) && `−${feet(profile.lossFt)} descent`, `${profile.minFt.toLocaleString("en-US")}–${feet(profile.maxFt)}`])}</p>
          <TrailElevationProfile samples={profile.profile.map(([mi, ft]) => ({ distance_m: mi * MILE_METERS, elevation_ft: ft }))} />
          <p className="catalog-muted">Estimated from sampled ground elevation (AWS Terrain Tiles; USGS 3DEP, SRTM) along the route, in the direction it was built.</p>
        </section>
      )}

      {trail.trails.length > 0 && (
        <section className="pt-section" aria-label="Trails used">
          <h2>Trails, in order</h2>
          <ol className="pt-list">
            {trail.trails.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <span className="pt-mile">mi {t.fromMile.toFixed(1)}</span>
                {t.id ? <Link className="catalog-link" href={`/explore/trails/${encodeURIComponent(t.id)}`}>{t.name}</Link> : <span>{t.name}</span>}
                <small>{fmtMiles(Math.round((t.toMile - t.fromMile) * 100) / 100)}</small>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="pt-section" aria-label="Along the way">
        <h2>Along the way</h2>
        {trail.features.length ? (
          <>
            <p className="catalog-muted">{join([water ? `${water} water ${water === 1 ? "source" : "sources"}` : null, camps ? `${camps} ${camps === 1 ? "campsite or shelter" : "campsites and shelters"}` : null, `${trail.features.length} features in all`])}. From community map data; check that water is flowing and camping is allowed.</p>
            <ol className="pt-list">
              {trail.features.map((f) => (
                <li key={f.id} className={`pt-feature pt-feature--${featureGroup(f.type)}`}>
                  <span className="pt-mile">mi {f.mile.toFixed(1)}</span>
                  <span>{f.name}<small> · {FEATURE_LABELS[f.type] ?? f.type}{f.offRouteFt > 60 ? ` · ${f.offRouteFt.toLocaleString("en-US")} ft off route` : ""}</small></span>
                </li>
              ))}
            </ol>
          </>
        ) : <p className="catalog-muted">No mapped water, campsites or other features along this route.</p>}
      </section>

      {trail.days && trail.days.length > 1 && (
        <section className="pt-section" aria-label="Days">
          <h2>Days</h2>
          <ol className="pt-list">
            {trail.days.map((d) => (
              <li key={d.day}>
                <span className="pt-mile">Day {d.day}</span>
                <span>mi {d.fromMile.toFixed(1)}–{d.toMile.toFixed(1)} · {fmtMiles(d.miles)}<small>{d.stop ? ` · Night at ${d.stop.name}` : ""}</small></span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
