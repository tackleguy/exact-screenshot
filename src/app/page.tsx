import Link from "next/link";
import { getActivities, getWeeklyStats } from "@/lib/activities";
import { formatDistance, formatDuration } from "@/lib/gps";
import { ActivityListRow } from "@/components/activities/ActivityListRow";
import { getAuthUser } from "@/lib/supabase/server";
import { searchCatalog } from "@/lib/trail-catalog/server";

/** Signed-out visitors get an introduction and a trail search instead of an empty activity log. */
async function Landing() {
  const { manifest } = await searchCatalog({ limit: 1 }).catch(() => ({ manifest: null }));
  const trails = manifest ? (manifest.publicTotal ?? manifest.total).toLocaleString("en-US") : "100,000+";
  const features = [
    ["Every official trail", `${trails} trails from the National Park Service, U.S. Forest Service, BLM, USGS, Parks Canada and ski resorts, each linked to its source.`],
    ["Water and town days", "Springs, taps and stream crossings at their trail mile, nearby towns with groceries and post offices, and a resupply plan for multi-day trips."],
    ["Plan and pack", "Build a trip around your own gear, see your pack weight, and get a packing checklist."],
    ["Take it with you", "Download a GPX with water and town waypoints, or a printable trip packet."],
  ];
  return <div className="fieldbook-page">
    <header className="fieldbook-page-toolbar"><div><h1>Find, plan and pack your next hike.</h1><p className="fieldbook-page-intro">Real trails from official sources, with the water, towns and gear to get you through them.</p></div></header>
    <form action="/explore/trails" className="mt-6 flex max-w-2xl gap-3" role="search"><label htmlFor="home-search" className="sr-only">Search trails or places</label><input id="home-search" name="q" placeholder="Search a trail, park or town" className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 text-base" /><button className="btn-primary" type="submit">Search</button></form>
    <div className="mt-4 flex flex-wrap gap-3"><Link href="/explore/trails" className="btn-ghost">Browse the map</Link><Link href="/plan" className="btn-ghost">Plan a trip</Link></div>
    <ul className="mt-10 grid gap-4 sm:grid-cols-2">{features.map(([title, body]) => <li key={title} className="fieldbook-empty"><h3>{title}</h3><p>{body}</p></li>)}</ul>
    <p className="mt-8 text-sm text-stone-600">Have an account? <Link href="/login" className="underline">Sign in</Link> to record hikes and keep your gear and trips in sync. New here? <Link href="/signup" className="underline">Create an account</Link>.</p>
  </div>;
}

export default async function HomePage() {
  const { user } = await getAuthUser();
  if (!user) return <Landing />;
  const [activities, stats] = await Promise.all([
    user ? getActivities(20) : Promise.resolve([]),
    user ? getWeeklyStats() : Promise.resolve(null),
  ]);
  return <div className="fieldbook-page">
    <header className="fieldbook-page-toolbar"><div><h1>Your time outside.</h1><p className="fieldbook-page-intro">Keep a record of the places you’ve been. Find the next one.</p></div><Link href="/record" className="btn-primary">Record activity</Link></header>
    {stats && stats.activityCount > 0 && <dl className="fieldbook-week"><div><dt>Outings this week</dt><dd>{stats.activityCount}</dd></div><div><dt>Distance</dt><dd>{formatDistance(stats.distanceM)}</dd></div><div><dt>Time outside</dt><dd>{formatDuration(stats.durationSec)}</dd></div><div><dt>Elevation gain</dt><dd>{stats.elevationFt.toLocaleString()} ft</dd></div></dl>}
    <div className="fieldbook-log-layout"><section><h2>Recent outings</h2><div className="mt-6 space-y-3">{!user ? <div className="fieldbook-empty"><h3>Your adventure log starts here.</h3><p>Sign in to save GPS tracks and revisit your hikes, runs, rides and ski days.</p><div className="fieldbook-actions"><Link href="/login" className="btn-primary">Sign in</Link><Link href="/signup" className="btn-ghost">Create account</Link></div></div> : !activities.length ? <div className="fieldbook-empty"><h3>No outings recorded yet.</h3><p>Start recording on your next outing, or add an activity you’ve already completed.</p><Link className="btn-ghost mt-6" href="/record/manual">Log an activity</Link></div> : activities.map(activity => <ActivityListRow key={activity.id} activity={activity} />)}</div></section>
      <aside className="fieldbook-context"><h2>Where to next?</h2><p>Choose a trail, prepare your equipment and keep your next trip together.</p><Link href="/plan" className="btn-primary">Plan a trip</Link><Link href="/explore/trails" className="fieldbook-text-link">Explore trails</Link></aside></div>
  </div>;
}
