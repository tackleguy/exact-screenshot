import { useEffect, useState } from "react";
import Link from "./compat/link";
import { createClient } from "@/lib/supabase/client";
import { GpxRouteUpload } from "@/components/trails/GpxRouteUpload";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import type { Trail } from "@/lib/types";

export function CommunityTrails() {
  const [trails, setTrails] = useState<Trail[]>([]); const [query, setQuery] = useState("");
  const [error, setError] = useState(() => (createClient() ? "" : "Community trails are unavailable right now.")); const [loading, setLoading] = useState(() => createClient() !== null);
  useEffect(() => {
    const client = createClient(); if (!client) return;
    let live = true;
    client.from("trails").select("*, park:parks(*)").order("trail_name").limit(100).then(({ data, error }) => {
      if (!live) return; setTrails((data ?? []) as Trail[]); setError(error ? "Community trails couldn’t load. Please try again later." : ""); setLoading(false);
    }); return () => { live = false; };
  }, []);
  return <section className="fieldbook-page"><Link className="btn-ghost" href="/explore/trails/catalog">← Trail catalog</Link><h1>Community & GPX trails</h1><GpxRouteUpload /><label className="hx-community-search">Search community trails<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>{loading && <p role="status">Loading community trails…</p>}{error && <p role="alert">{error}</p>}<div className="hx-community-list">{trails.filter(t => t.trail_name.toLowerCase().includes(query.toLowerCase())).map(t => <article key={t.id}><h2>{t.trail_name}</h2><p>{t.park?.park_name} · {t.length_miles} mi · {t.difficulty}</p><div className="hx-actions"><Link className="btn-ghost" href={`/explore/trails?lat=${t.latitude}&lng=${t.longitude}&z=13`}>View area</Link><a className="btn-ghost" href={googleMapsDirectionsUrl(t.start_latitude ?? t.latitude, t.start_longitude ?? t.longitude)} target="_blank" rel="noopener noreferrer">Driving directions ↗</a><Link className="btn-ghost" href={`/record/live?trail_id=${t.id}`}>Record hike</Link></div></article>)}</div>{!loading && !error && trails.length === 0 && <p>No community trails yet.</p>}</section>;
}