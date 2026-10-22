"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Backpack, Map, Route, Search } from "lucide-react";
import { headlineCount, type CatalogManifest, type CatalogTrail } from "@/lib/trail-catalog/types";
import { join, miles as fmtMiles } from "@/lib/display";
import discovery from "@/assets/trail-discovery.jpg";

const photo = typeof discovery === "string" ? discovery : discovery.src;
const destinations = [
  { name: "Yosemite", detail: "Granite peaks & waterfall walks", lat: 37.745, lng: -119.596 },
  { name: "Mount Rainier", detail: "Alpine meadows & mountain air", lat: 46.852, lng: -121.76 },
  { name: "Zion", detail: "Red cliffs & canyon trails", lat: 37.298, lng: -113.026 },
];

/** Trails near the visitor: asked for only if location was already allowed, or when they tap the button. */
function useNearby() {
  const [state, setState] = useState<{ trails: CatalogTrail[]; status: "idle" | "loading" | "ready" | "denied" }>({ trails: [], status: "idle" });
  const find = (prompt: boolean) => {
    if (!("geolocation" in navigator)) return;
    if (prompt) setState((s) => ({ ...s, status: "loading" }));
    navigator.geolocation.getCurrentPosition((pos) => {
      const p = new URLSearchParams({ lat: pos.coords.latitude.toFixed(3), lng: pos.coords.longitude.toFixed(3), radiusKm: "50", limit: "3" });
      fetch(`/api/trail-catalog?${p}`).then((r) => (r.ok ? r.json() : null)).then((d: { trails?: CatalogTrail[] } | null) => setState({ trails: d?.trails ?? [], status: "ready" })).catch(() => setState({ trails: [], status: "ready" }));
    }, () => setState({ trails: [], status: "denied" }), { timeout: 8000, maximumAge: 600_000 });
  };
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((p) => { if (p.state === "granted") find(false); }).catch(() => undefined);
  }, []);
  return { ...state, find };
}

/** "Hyked lists 4xx,xxx trails …" — the exact verified + mapped count from the current catalog, with its sources. */
function useCatalogCount() {
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  useEffect(() => { fetch("/api/trail-catalog?limit=1").then((r) => (r.ok ? r.json() : null)).then((d) => setManifest(d?.manifest ?? null)).catch(() => undefined); }, []);
  return manifest;
}

export function HomePromotion({ signedIn = false }: { signedIn?: boolean }) {
  const nearby = useNearby();
  const manifest = useCatalogCount();
  const [photoFailed, setPhotoFailed] = useState(false);
  return <div className="home-promotion">
    <header className={`discovery-hero${photoFailed ? " discovery-hero--no-photo" : ""}`}>
      {!photoFailed && <img src={photo} alt="Hikers on an alpine trail above a turquoise mountain lake" width={1920} height={1088} className="discovery-hero-image" fetchPriority="high" onError={() => setPhotoFailed(true)} />}
      <div className="discovery-hero-content">
        <p className="section-label">A LITTLE FURTHER. A LITTLE FREER.</p>
        <h1>Hyked</h1>
        <p className="discovery-headline">Your next great day<br />starts on a trail.</p>
        <p className="discovery-intro">Find your kind of outside. Discover real trails, plan the journey, and bring just what you need.</p>
        <form action="/explore/trails/catalog" className="discovery-search" role="search"><Search size={20} aria-hidden /><label htmlFor="discovery-query" className="sr-only">Search trails</label><input id="discovery-query" name="q" type="search" placeholder="Find a trail or your next escape" /><button type="submit" className="btn-primary" aria-label="Search trails"><ArrowUpRight size={22} aria-hidden /></button></form>
        <Link href="/explore/trails" className="discovery-map-link">Explore the map <ArrowUpRight size={17} aria-hidden /></Link>
        {manifest && <p className="discovery-proof">{headlineCount(manifest).toLocaleString("en-US")} trails across the U.S. and Canada{manifest.tiers ? `, ${manifest.tiers.verified.toLocaleString("en-US")} of them verified by` : " from"} the National Park Service, U.S. Forest Service, BLM, Parks Canada, USGS and OpenStreetMap.</p>}
      </div>
      <span className="discovery-photo-caption">More fresh air. Less guesswork.</span>
    </header>
    <section className="home-destinations">
      <div className="home-section-heading"><div><p className="section-label">{nearby.trails.length ? "NEAR YOU" : "FIND YOUR NEXT ESCAPE"}</p><h2>{nearby.trails.length ? "Trails close to home." : "Somewhere worth going."}</h2></div><Link href="/explore/trails/catalog" className="fieldbook-text-link">Browse trails <ArrowUpRight size={16} aria-hidden /></Link></div>
      {nearby.trails.length ? (
        <div className="home-destination-grid">{nearby.trails.map((t, index) => <Link key={t.id} href={`/explore/trails/${encodeURIComponent(t.id)}`} className="home-destination"><span className="home-destination-number">0{index + 1}</span><div><h3>{t.name}</h3><p>{join([t.park ?? t.forest ?? t.region, fmtMiles(t.miles)])}</p></div><ArrowUpRight size={22} aria-hidden /></Link>)}</div>
      ) : (
        <>
          <div className="home-destination-grid">{destinations.map((place, index) => <Link key={place.name} href={`/explore/trails?lat=${place.lat}&lng=${place.lng}&z=11`} className="home-destination"><span className="home-destination-number">0{index + 1}</span><div><h3>{place.name}</h3><p>{place.detail}</p></div><ArrowUpRight size={22} aria-hidden /></Link>)}</div>
          {nearby.status !== "ready" && <button type="button" className="fieldbook-text-link home-near-me" onClick={() => nearby.find(true)} disabled={nearby.status === "loading"}>{nearby.status === "loading" ? "Finding trails near you…" : nearby.status === "denied" ? "Location is off — allow it in your browser to see trails near you" : "Show trails near me"}</button>}
        </>
      )}
    </section>
    <section className="home-outdoor-tools"><div className="home-section-heading"><div><p className="section-label">FROM THE FIRST STEP TO THE LAST</p><h2>Less planning. More wandering.</h2></div></div><div className="home-tools-grid">
      <Link href="/explore/trails" className="home-tool"><Map aria-hidden /><h3>Find your trail.</h3><p>Explore mapped trails and get driving directions to the trailhead.</p><span>Explore trails <ArrowUpRight size={16} aria-hidden /></span></Link>
      <Link href="/plan" className="home-tool"><Route aria-hidden /><h3>Make it your adventure.</h3><p>Bring your route, trip plans, and packing checklist together.</p><span>Plan a trip <ArrowUpRight size={16} aria-hidden /></span></Link>
      <Link href="/gear" className="home-tool"><Backpack aria-hidden /><h3>Carry less. Go further.</h3><p>Keep your gear organized and know what you’re carrying.</p><span>Open your gear <ArrowUpRight size={16} aria-hidden /></span></Link>
    </div></section>
    <section className="home-invitation"><p className="section-label">THE OUTDOORS IS CALLING</p><h2>Make the next one yours.</h2><Link href={signedIn ? "/explore/trails" : "/signup"} className="btn-primary">{signedIn ? "Find your next trail" : "Join Hyked"}<ArrowUpRight size={18} aria-hidden /></Link>{!signedIn && <p>Already part of the adventure? <Link href="/login">Sign in</Link></p>}</section>
  </div>;
}