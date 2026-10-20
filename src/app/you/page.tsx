import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActivities, getWeeklyStats } from "@/lib/activities";
import { formatDistance, formatDuration } from "@/lib/gps";
import { NAV_SHORTCUTS } from "@/lib/nav-shortcuts";
import { ACTIVITY_ICONS, ACTIVITY_LABELS, type ActivityType } from "@/lib/types";
import { ActivityListRow } from "@/components/activities/ActivityListRow";
import { getAuthUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your profile — HikeSync" };

const allTypes: ActivityType[] = ["run", "hike", "bike", "ski"];

function displayName(email: string) {
  const local = email.split("@")[0] ?? "Explorer";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default async function YouPage() {
  const { user } = await getAuthUser();

  if (!user) redirect("/login?next=/you");

  const [stats, activities] = await Promise.all([getWeeklyStats(), getActivities(50)]);

  const lifetime = activities.reduce(
    (acc, a) => ({
      count: acc.count + 1,
      distanceM: acc.distanceM + Number(a.distance_m),
      elevationFt: acc.elevationFt + Number(a.elevation_gain_ft),
    }),
    { count: 0, distanceM: 0, elevationFt: 0 },
  );

  const milesThisMonth = activities
    .filter((a) => {
      const d = new Date(a.started_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, a) => s + Number(a.distance_m), 0);

  const monthlyGoalM = 160934; // ~100 miles
  const monthlyProgress = Math.min(100, (milesThisMonth / monthlyGoalM) * 100);

  return (
    <div className="pb-24 md:pb-10">
      <section className="relative overflow-hidden border-b border-[var(--border)] px-4 py-12 sm:px-6">
        <div className="absolute inset-0 bg-gradient-to-b from-pine/30 to-background" />
        <div className="relative mx-auto max-w-2xl text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-accent/40 bg-surface-elevated font-display text-3xl font-semibold text-accent shadow-xl">
            {displayName(user.email!).charAt(0)}
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold text-cream">
            {displayName(user.email!)}
          </h1>
          <p className="mt-1 text-sm text-mist">{user.email}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link href="/record" className="btn-primary">
              Start recording
            </Link>
            <Link
              href="/gear"
              className="rounded-lg border border-[var(--border-strong)] bg-surface px-5 py-2.5 text-sm font-semibold text-cream transition hover:border-accent/40"
            >
              Gear Locker
            </Link>
            <Link
              href="/pack-trails"
              className="rounded-lg border border-[var(--border-strong)] bg-surface px-5 py-2.5 text-sm font-semibold text-cream transition hover:border-accent/40"
            >
              Pack Trails
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="grid grid-cols-3 gap-3">
          <LifetimeStat label="Adventures" value={String(lifetime.count)} />
          <LifetimeStat
            label="Miles"
            value={(lifetime.distanceM / 1609.34).toFixed(1)}
          />
          <LifetimeStat
            label="Elevation"
            value={`${Math.round(lifetime.elevationFt / 1000)}k`}
            unit="ft"
          />
        </div>

        <section className="mt-8 surface-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-cream">
              100 miles this month
            </h2>
            <span className="text-xs font-semibold tabular-nums text-accent">
              {Math.round(monthlyProgress)}%
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${monthlyProgress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-mist">
            {(milesThisMonth / 1609.34).toFixed(1)} mi of 100 mi goal
          </p>
        </section>

        <section className="mt-8 surface-card p-5">
          <h2 className="font-display text-base font-semibold text-cream">Keyboard shortcuts</h2>
          <p className="mt-1 text-sm text-mist">
            Desktop only. Shortcuts are paused while typing in a field. Hover a sidebar item to see its shortcut.
          </p>
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {NAV_SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.keys}
                className="flex items-center justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0"
              >
                <span className="text-cream">{shortcut.label}</span>
                <kbd className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-muted px-2.5 py-1 font-sans text-xs font-semibold tabular-nums tracking-wide text-sage">
                  {shortcut.keys}
                </kbd>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <p className="section-label">This week</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Distance" value={formatDistance(stats.distanceM)} />
            <StatCard label="Time" value={formatDuration(stats.durationSec)} />
            <StatCard label="Activities" value={String(stats.activityCount)} />
            <StatCard label="Elev" value={`${stats.elevationFt.toLocaleString()} ft`} />
          </div>
        </section>

        {stats.byType && Object.keys(stats.byType).length > 0 && (
          <section className="mt-8">
            <p className="section-label">By type</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allTypes.map((type) => {
                const count = stats.byType?.[type] ?? 0;
                if (count === 0) return null;
                return (
                  <span
                    key={type}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-surface-elevated px-3 py-1.5 text-sm text-sage"
                  >
                    <span className="text-base">{ACTIVITY_ICONS[type]}</span>
                    {ACTIVITY_LABELS[type]} · {count}
                  </span>
                );
              })}
            </div>
          </section>
        )}

        <section className="mt-10">
          <div className="flex items-end justify-between">
            <div>
              <p className="section-label">History</p>
              <h2 className="font-display text-xl font-semibold text-cream">
                Recent adventures
              </h2>
            </div>
          </div>

          {activities.length === 0 ? (
            <div className="surface-card mt-4 px-6 py-10 text-center">
              <p className="text-mist">No activities yet.</p>
              <Link href="/record" className="btn-primary mt-4">
                Record your first
              </Link>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {activities.slice(0, 10).map((a) => (
                <ActivityListRow key={a.id} activity={a} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LifetimeStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="surface-card p-4 text-center">
      <p className="font-display text-2xl font-semibold tabular-nums text-accent">
        {value}
        {unit && <span className="ml-0.5 text-xs text-mist">{unit}</span>}
      </p>
      <p className="mt-1 text-xs text-mist">{label}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-3 text-center">
      <p className="text-sm font-bold tabular-nums text-cream">{value}</p>
      <p className="mt-0.5 text-[10px] text-mist">{label}</p>
    </div>
  );
}
