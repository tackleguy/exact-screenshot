import Link from "next/link";
import { ArrowUpRight, Backpack, Map, Route, Search } from "lucide-react";
import discovery from "@/assets/trail-discovery.jpg";

const photo = typeof discovery === "string" ? discovery : discovery.src;
const destinations = [
  { name: "Yosemite", detail: "Granite peaks & waterfall walks", lat: 37.745, lng: -119.596 },
  { name: "Mount Rainier", detail: "Alpine meadows & mountain air", lat: 46.852, lng: -121.76 },
  { name: "Zion", detail: "Red cliffs & canyon trails", lat: 37.298, lng: -113.026 },
];

export function HomePromotion({ signedIn = false }: { signedIn?: boolean }) {
  return <div className="home-promotion">
    <header className="discovery-hero">
      <img src={photo} alt="Hikers on an alpine trail above a turquoise mountain lake" width={1920} height={1088} className="discovery-hero-image" fetchPriority="high" />
      <div className="discovery-hero-content">
        <p className="section-label">A LITTLE FURTHER. A LITTLE FREER.</p>
        <h1>Hyked</h1>
        <p className="discovery-headline">Your next great day<br />starts on a trail.</p>
        <p className="discovery-intro">Find your kind of outside. Discover real trails, plan the journey, and bring just what you need.</p>
        <form action="/explore/trails/catalog" className="discovery-search" role="search"><Search size={20} aria-hidden /><label htmlFor="discovery-query" className="sr-only">Search trails</label><input id="discovery-query" name="q" type="search" placeholder="Find a trail or your next escape" /><button type="submit" className="btn-primary" aria-label="Search trails"><ArrowUpRight size={22} aria-hidden /></button></form>
        <Link href="/explore/trails" className="discovery-map-link">Explore the map <ArrowUpRight size={17} aria-hidden /></Link>
      </div>
      <span className="discovery-photo-caption">More fresh air. Less guesswork.</span>
    </header>
    <section className="home-destinations">
      <div className="home-section-heading"><div><p className="section-label">FIND YOUR NEXT ESCAPE</p><h2>Somewhere worth going.</h2></div><Link href="/explore/trails/catalog" className="fieldbook-text-link">Browse trails <ArrowUpRight size={16} aria-hidden /></Link></div>
      <div className="home-destination-grid">{destinations.map((place, index) => <Link key={place.name} href={`/explore/trails?lat=${place.lat}&lng=${place.lng}&z=11`} className="home-destination"><span className="home-destination-number">0{index + 1}</span><div><h3>{place.name}</h3><p>{place.detail}</p></div><ArrowUpRight size={22} aria-hidden /></Link>)}</div>
    </section>
    <section className="home-outdoor-tools"><div className="home-section-heading"><div><p className="section-label">FROM THE FIRST STEP TO THE LAST</p><h2>Less planning. More wandering.</h2></div></div><div className="home-tools-grid">
      <Link href="/explore/trails" className="home-tool"><Map aria-hidden /><h3>Find your trail.</h3><p>Explore mapped trails and get driving directions to the trailhead.</p><span>Explore trails <ArrowUpRight size={16} aria-hidden /></span></Link>
      <Link href="/plan" className="home-tool"><Route aria-hidden /><h3>Make it your adventure.</h3><p>Bring your route, trip plans, and packing checklist together.</p><span>Plan a trip <ArrowUpRight size={16} aria-hidden /></span></Link>
      <Link href="/gear" className="home-tool"><Backpack aria-hidden /><h3>Carry less. Go further.</h3><p>Keep your gear organized and know what you’re carrying.</p><span>Open your gear <ArrowUpRight size={16} aria-hidden /></span></Link>
    </div></section>
    <section className="home-invitation"><p className="section-label">THE OUTDOORS IS CALLING</p><h2>Make the next one yours.</h2><Link href={signedIn ? "/explore/trails" : "/signup"} className="btn-primary">{signedIn ? "Find your next trail" : "Join Hyked"}<ArrowUpRight size={18} aria-hidden /></Link>{!signedIn && <p>Already part of the adventure? <Link href="/login">Sign in</Link></p>}</section>
  </div>;
}