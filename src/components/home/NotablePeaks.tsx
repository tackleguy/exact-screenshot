import Link from "next/link";
import { ArrowUpRight, Mountain } from "lucide-react";
import { PEAK_DEFINITIONS } from "@/lib/trail-catalog/peaks";

const PICKS = ["summit-everest", "summit-denali", "summit-kilimanjaro", "summit-whitney", "summit-rainier", "summit-elbert", "summit-aconcagua", "summit-mont-blanc"];

/** AllTrails-style "Notable peaks" row: famous summits with height and standard route. */
export function NotablePeaks() {
  const picked = PICKS.map((id) => PEAK_DEFINITIONS.find((p) => p.id === id)).filter(Boolean) as typeof PEAK_DEFINITIONS;
  const peaks = [...picked, ...PEAK_DEFINITIONS.filter((p) => !picked.includes(p))].slice(0, 8);
  return <section className="home-long-trails" aria-label="Notable peaks">
    <div className="home-section-heading"><div><p className="section-label">SUMMITS</p><h2>Notable peaks.</h2></div><Link href="/explore/trails/catalog?q=summit" className="fieldbook-text-link">All peaks <ArrowUpRight size={16} aria-hidden /></Link></div>
    <div className="home-long-grid">
      {peaks.map((p) => <Link key={p.id} href={`/explore/trails/${encodeURIComponent(p.id)}`} className="home-long"><strong><Mountain size={15} aria-hidden /> {p.name.split("(")[0].trim()}</strong><small>{p.summitElevationFt.toLocaleString("en-US")} ft · {p.region} · {p.roundTripMiles} mi round trip</small><ArrowUpRight size={18} aria-hidden /></Link>)}
    </div>
  </section>;
}
