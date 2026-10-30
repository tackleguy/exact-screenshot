"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { countryName, headlineCount, type CatalogManifest, type CatalogTrail } from "@/lib/trail-catalog/types";
import { join, miles as fmtMiles } from "@/lib/display";
import discovery from "@/assets/trail-discovery.jpg";
import { TRAIL_SECTIONS } from "@/lib/trail-catalog/activity";
import { SectionIcon } from "@/components/explore/SectionIcon";
import { locate, timezoneRegion, useKnownPosition } from "@/lib/start-location";
import { DIFFICULTY_LABELS, trailDifficulty } from "@/lib/trail-difficulty";
import { trailSatellite, trailThumbnail } from "@/lib/trail-catalog/thumbnail";
import { useRouter } from "next/navigation";
import { TrailCard } from "@/components/ui/trail-card";
import { Reveal } from "@/components/ui/reveal";
import { estimatedTime } from "@/components/trails/TrailStats";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { SaveHeart } from "@/components/trails/SaveHeart";
import { metersBetween } from "@/lib/geo/line";
import { formatDistance, formatElevation, formatMeters } from "@/lib/units";

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
/** Places to start when we don't know where the visitor is. Photos: Unsplash; Zion uses satellite imagery. */
const unsplash = (id: string) => `https://images.unsplash.com/${id}?w=800&q=70&auto=format&fit=crop`;
const destinations = [
  { name: "Yosemite", detail: "Granite peaks & waterfall walks", region: "California", lat: 37.745, lng: -119.596, image: unsplash("photo-1426604966848-d7adac402bff"), distance: "800+ mi of trails", elevation: "2,000–13,000 ft", duration: "Day hikes to weeks" },
  { name: "Mount Rainier", detail: "Alpine meadows & mountain air", region: "Washington", lat: 46.852, lng: -121.76, image: unsplash("photo-1464822759023-fed622ff2c3b"), distance: "260+ mi of trails", elevation: "1,600–14,410 ft", duration: "Day hikes to 2 weeks" },
  { name: "Zion", detail: "Red cliffs & canyon trails", region: "Utah", lat: 37.298, lng: -113.026, image: null, distance: "90+ mi of trails", elevation: "3,700–8,700 ft", duration: "Day hikes to 3 days" },
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
  const router = useRouter();
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
        <div className="home-trail-cards">
          {nearby.trails.map((t, i) => {
            const level = trailDifficulty(t);
            const open = () => router.push(`/explore/trails/${encodeURIComponent(t.id)}`);
            return (
              <Reveal key={t.id} delay={i * 0.08}>
                <TrailCard
                  role="link"
                  tabIndex={0}
                  aria-label={`${t.name}: ${DIFFICULTY_LABELS[level]}, ${fmtMiles(t.miles) ?? "distance unknown"}`}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === "Enter") open(); }}
                  imageUrl={trailSatellite(t)}
                  mapImageUrl={trailThumbnail(t, 160, 80)}
                  title={t.name}
                  location={join([t.park ?? t.forest, t.region]) ?? countryName(t.country)}
                  difficulty={DIFFICULTY_LABELS[level]}
                  creators={join([here ? `${formatMeters(metersBetween(here, [t.longitude, t.latitude]))} away` : null, t.manager]) ?? "Mapped trail"}
                  distance={formatDistance(t.miles) ?? "—"}
                  elevation={formatElevation(t.gainFt) ?? "—"}
                  duration={estimatedTime({ miles: t.miles, gainFt: t.gainFt ?? null, lossFt: t.lossFt, steepestGradePct: t.steepestGradePct, routeType: t.routeType, difficulty: level }) ?? "—"}
                  onDirectionsClick={() => window.open(googleMapsDirectionsUrl(t.trailhead?.latitude ?? t.latitude, t.trailhead?.longitude ?? t.longitude), "_blank", "noopener")}
                  corner={<SaveHeart trailId={t.id} name={t.name} className="save-heart--card" />}
                />
              </Reveal>
            );
          })}
        </div>
      ) : (
        <div className="home-trail-cards">
          {destinations.map((place, i) => {
            const open = () => router.push(`/explore/trails?lat=${place.lat}&lng=${place.lng}&z=11`);
            const spot = { latitude: place.lat, longitude: place.lng, bounds: [place.lng - 0.12, place.lat - 0.09, place.lng + 0.12, place.lat + 0.09] as [number, number, number, number] };
            return (
              <Reveal key={place.name} delay={i * 0.08}>
                <TrailCard
                  role="link"
                  tabIndex={0}
                  aria-label={`Explore trails in ${place.name}`}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === "Enter") open(); }}
                  imageUrl={place.image ?? trailSatellite(spot)}
                  mapImageUrl={trailThumbnail(spot, 160, 80)}
                  title={place.name}
                  location={place.region}
                  difficulty="All levels"
                  creators={place.detail}
                  distance={place.distance}
                  elevation={place.elevation}
                  duration={place.duration}
                  onDirectionsClick={() => window.open(googleMapsDirectionsUrl(place.lat, place.lng), "_blank", "noopener")}
                />
              </Reveal>
            );
          })}
        </div>
      )}
    </section>
    <section className="home-activities" aria-label="Trails by activity">
      <div className="home-section-heading"><div><p className="section-label">EVERY WAY OUTSIDE</p><h2>Pick your adventure.</h2></div></div>
      <Reveal className="home-activity-grid">
        {TRAIL_SECTIONS.map((s) => <Link key={s.key} href={`/explore/trails?activity=${s.activity}`} className="home-activity"><SectionIcon section={s.key} size={26} /><span><strong>{s.label}</strong><small>{s.blurb}</small></span></Link>)}
        <Link href="/explore/ski" className="home-activity"><SectionIcon section="snow" size={26} /><span><strong>Ski areas</strong><small>Every ski area worldwide, with runs and lifts</small></span></Link>
      </Reveal>
    </section>
    <section className="home-long-trails" aria-label="Famous long-distance trails">
      <div className="home-section-heading"><div><p className="section-label">THE BIG ONES</p><h2>Legendary long trails.</h2></div><Link href="/explore/trails/catalog?collection=thru-hikes" className="fieldbook-text-link">All through-hikes <ArrowUpRight size={16} aria-hidden /></Link></div>
      <Reveal className="home-long-grid">
        {LONG_TRAILS.map((t) => <Link key={t.name} href={t.href} className="home-long"><strong>{t.name}</strong><small>{t.detail}</small><ArrowUpRight size={18} aria-hidden /></Link>)}
      </Reveal>
    </section>
    <Reveal><section className="home-invitation"><h2>Make the next one yours.</h2><Link href={signedIn ? "/explore/trails" : "/signup"} className="btn-primary">{signedIn ? "Find your next trail" : "Join Hyked"}<ArrowUpRight size={18} aria-hidden /></Link>{!signedIn && <p>Already part of the adventure? <Link href="/login">Sign in</Link></p>}</section></Reveal>
  </div>;
}