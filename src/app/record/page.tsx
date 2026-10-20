import type { Metadata } from "next";
import Link from "next/link";
import { ACTIVITY_LABELS, type ActivityType } from "@/lib/types";
import { NavIcon } from "@/components/nav/NavIcon";

export const metadata: Metadata = { title: "Record an activity — Hyked", description: "Record a hike, run, ride or ski day with GPS, or log it manually." };

const types: { type: ActivityType; description: string }[] = [
  { type: "hike", description: "Follow your distance, elevation and time on the trail." },
  { type: "run", description: "Track your pace, distance and elevation." },
  { type: "bike", description: "Record your route, speed and distance." },
  { type: "ski", description: "Log vertical and runs on the mountain." },
];
export default function RecordPage() {
  return <div className="fieldbook-page">
    <header><h1>Record your outing.</h1><p className="fieldbook-page-intro">Choose your activity to open the GPS recorder.</p></header>
    <div className="fieldbook-log-layout fieldbook-record-layout"><section aria-label="Activity types"><div className="fieldbook-activity-types">{types.map(({ type, description }) => <Link key={type} href={`/record/live?type=${type}`}><div><h2>{ACTIVITY_LABELS[type]}</h2><p>{description}</p></div><span>Open recorder</span><NavIcon name="chevron" /></Link>)}</div><Link href="/record/manual" className="btn-ghost mt-8">Log an activity manually</Link></section>
    <aside className="fieldbook-context"><h2>Pack ready?</h2><p>Review your checklist and trip details before you head out.</p><Link className="btn-ghost" href="/plan">Back to my trips</Link><p className="fieldbook-small">The recorder will ask for location access when you start. Keep it open while recording.</p></aside></div>
  </div>;
}
