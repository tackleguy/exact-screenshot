"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { headlineCount, type CatalogManifest, type CatalogTrail } from "@/lib/trail-catalog/types";
import { join, miles as fmtMiles } from "@/lib/display";
import discovery from "@/assets/trail-discovery.jpg";
import { TRAIL_SECTIONS } from "@/lib/trail-catalog/activity";
import { SectionIcon } from "@/components/explore/SectionIcon";
import { locate, timezoneRegion, useKnownPosition } from "@/lib/start-location";
import { DIFFICULTY_COLORS, DIFFICULTY_LABELS, trailDifficulty } from "@/lib/trail-difficulty";
import { trailThumbnail } from "@/lib/trail-catalog/thumbnail";
import { SaveHeart } from "@/components/trails/SaveHeart";
import { metersBetween } from "@/lib/geo/line";
import { formatMeters } from "@/lib/units";

const photo = typeof discovery === "string" ? discovery : discovery.src;
/** Famous long-distance trails: Hyked guides first, then worldwide classics found by search. */
const LONG_TRAILS = [
  { name: "Appalachian Trail", detail: "Georgia to Maine · 2,190 mi", href: "/explore/trails/route-at" },
  { name: "Pacific Crest Trail", detail: "Mexico to Canada · 2,650 mi", href: "/explore/trails/route-pct" },
  { name: "John Muir Trail", detail: "Yosemite to Mount Whitney · 211 mi", href: "/explore/trails/route-jmt" },
  { name: "Colorado Trail", detail: "Denver to Durango · 486 mi", href: "/explore/trails/route-ct" },
  { name: "Tour du Mont Blanc", detail: "France, Italy, Switzerland", href: "/explore/trails/catalog?q=tour+du+mont+blanc" },
  { name: "West Highland Way", detail: "Scotland · 96 mi", href: "/explore/trails/catalog?q=west+highland+way" },
  { name: "Milford Track", detail: "New Zealand · 33 mi", href: "/explore/trails/catalog?q=milford+track" },
  { name: "Kungsleden", detail: "Swedish Lapland", href: "/explore/trails/catalog?q=kungsleden" },
];
const destinations = [
  { name: "Yosemite", detail: "Granite peaks & waterfall walks", lat: 37.745, lng: -119.596 },
  { name: "Mount Rainier", detail: "Alpine meadows & mountain air", lat: 46.852, lng: -121.76 },
  { name: "Zion", detail: "Red cliffs & canyon trails", lat: 37.298, lng: -113.026 },
];

/**
 * "Trails near me", found the same way as the map and the catalog: the visitor's location if the browser gives it
 * within 3 seconds, otherwise a hiking region guessed from their time zone.
 */
function useNearby() {
  const [state, setState] = useState<{ trails: CatalogTrail[]; place: string | null; status: "loading" | "ready" }>({ trails: [], place: null, status: "loading" });
  useEffect(() => {
    let live = true;
    void locate(3000).then((at) => {
      const region = at ? null : timezoneRegion();
      const [lng, lat] = at ?? region!.center;
      const p = new URLSearchParams({ lat: lat.toFixed(3), lng: lng.toFixed(3), radiusKm: at ? "50" : "120", limit: "4" });
      return fetch(`/api/trail-catalog?${p}`).then((r) => (r.ok ? r.json() : null)).then((d: { trails?: CatalogTrail[] } | null) => {
        if (live) setState({ trails: d?.trails ?? [], place: region?.label ?? null, status: "ready" });
      });
    }).catch(() => { if (live) setState({ trails: [], place: null, status: "ready" }); });
    return () => { live = false; };
  }, []);
  return state;
}

/** "Hyked lists 4xx,xxx trails …" — the exact verified + mapped count from the current catalog, with its sources. */
function useCatalogCount() {
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  useEffect(() => { fetch("/api/trail-catalog?limit=1").then((r) => (r.ok ? r.json() : null)).then((d) => setManifest(d?.manifest ?? null)).catch(() => undefined); }, []);
  return manifest;
}

export function HomePromotion({ signedIn = false }: { signedIn?: boolean }) {
  const nearby = useNearby();
  const here = useKnownPosition();
  const manifest = useCatalogCount();
  const [photoFailed, setPhotoFailed] = useState(false);
  return <div className="home-promotion">
    <header className={`discovery-hero${photoFailed ? " discovery-hero--no-photo" : ""}`}>
      {!photoFailed && <img src={photo} alt="Hikers on an alpine trail above a turquoise mountain lake" width={1920} height={1088} className="discovery-hero-image" fetchPriority="high" onError={() => setPhotoFailed(true)} />}
      <div className="discovery-hero-content">
        <h1 className="sr-only">Hyked</h1>
        <p className="discovery-headline">Your next great day<br />starts on a trail.</p>
        <form action="/explore/trails/catalog" className="discovery-search" role="search"><Search size={20} aria-hidden /><label htmlFor="discovery-query" className="sr-only">Search trails</label><input id="discovery-query" name="q" type="search" placeholder="Find a trail or your next escape" /><button type="submit" className="btn-primary" aria-label="Search trails"><ArrowUpRight size={22} aria-hidden /></button></form>
        <Link href="/explore/trails" className="discovery-map-link">Explore the map <ArrowUpRight size={17} aria-hidden /></Link>
        {manifest && <p className="discovery-proof">{headlineCount(manifest).toLocaleString("en-US")} trails in {Object.keys(manifest.countries ?? {}).length || 2} countries.</p>}
      </div>
    </header>
    <section className="home-destinations">
      <div className="home-section-heading"><div><p className="section-label">{nearby.trails.length ? (nearby.place ? `IN ${nearby.place.toUpperCase()}` : "NEAR YOU") : "FIND YOUR NEXT ESCAPE"}</p><h2>{nearby.trails.length ? "Trails near me" : "Somewhere worth going."}</h2></div><Link href="/explore/trails/catalog" className="fieldbook-text-link">Browse trails <ArrowUpRight size={16} aria-hidden /></Link></div>
      {nearby.trails.length ? (
        <div className="home-near-grid">
          {nearby.trails.map((t) => {
            const level = trailDifficulty(t);
            return (
              <div key={t.id} className="home-near-card">
                <Link href={`/explore/trails/${encodeURIComponent(t.id)}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote static map picture */}
                  <img src={trailThumbnail(t, 320, 180)} alt="" loading="lazy" width={320} height={180} />
                  <h3>{t.name}</h3>
                  <p><i style={{ background: DIFFICULTY_COLORS[level] }} aria-hidden="true" />{join([DIFFICULTY_LABELS[level], fmtMiles(t.miles), here ? `${formatMeters(metersBetween(here, [t.longitude, t.latitude]))} away` : t.park ?? t.forest ?? t.region])}</p>
                </Link>
                <SaveHeart trailId={t.id} name={t.name} className="save-heart--card" />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="home-destination-grid">{destinations.map((place, index) => <Link key={place.name} href={`/explore/trails?lat=${place.lat}&lng=${place.lng}&z=11`} className="home-destination"><span className="home-destination-number">0{index + 1}</span><div><h3>{place.name}</h3><p>{place.detail}</p></div><ArrowUpRight size={22} aria-hidden /></Link>)}</div>
      )}
    </section>
    <section className="home-activities" aria-label="Trails by activity">
      <div className="home-section-heading"><div><p className="section-label">EVERY WAY OUTSIDE</p><h2>Pick your adventure.</h2></div></div>
      <div className="home-activity-grid">
        {TRAIL_SECTIONS.map((s) => <Link key={s.key} href={`/explore/trails?activity=${s.activity}`} className="home-activity"><SectionIcon section={s.key} size={26} /><span><strong>{s.label}</strong><small>{s.blurb}</small></span></Link>)}
        <Link href="/explore/ski" className="home-activity"><SectionIcon section="snow" size={26} /><span><strong>Ski areas</strong><small>Every ski area worldwide, with runs and lifts</small></span></Link>
      </div>
    </section>
    <section className="home-long-trails" aria-label="Famous long-distance trails">
      <div className="home-section-heading"><div><p className="section-label">THE BIG ONES</p><h2>Legendary long trails.</h2></div><Link href="/explore/trails/catalog?collection=thru-hikes" className="fieldbook-text-link">All through-hikes <ArrowUpRight size={16} aria-hidden /></Link></div>
      <div className="home-long-grid">
        {LONG_TRAILS.map((t) => <Link key={t.name} href={t.href} className="home-long"><strong>{t.name}</strong><small>{t.detail}</small><ArrowUpRight size={18} aria-hidden /></Link>)}
      </div>
    </section>
    <section className="home-invitation"><h2>Make the next one yours.</h2><Link href={signedIn ? "/explore/trails" : "/signup"} className="btn-primary">{signedIn ? "Find your next trail" : "Join Hyked"}<ArrowUpRight size={18} aria-hidden /></Link>{!signedIn && <p>Already part of the adventure? <Link href="/login">Sign in</Link></p>}</section>
  </div>;
}