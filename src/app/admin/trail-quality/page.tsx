import Link from "next/link";
import { catalogAudit } from "@/lib/trail-catalog/server";
import { reviewDecisions } from "@/lib/trail-catalog/reviews";
import { TrailReviewControls } from "@/components/admin/TrailReviewControls";
import { CatalogMapView } from "@/components/trails/CatalogMapView";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { recommendedAction } from "@/lib/trail-catalog/audit";
import { QUALITY_FLAGS, QUALITY_STATUS_LABELS, formatDistance, type QualityFlag, type QualityStatus } from "@/lib/trail-catalog/quality";

const PAGE_SIZE = 100;
const STATUSES: QualityStatus[] = ["review", "fragment", "short"];

export const metadata = { title: "Trail data quality — Hyked admin", robots: { index: false, follow: false } };

export default async function TrailQualityPage({
  searchParams,
}: {
  searchParams: Promise<{ admin_secret?: string; status?: string; flag?: string; page?: string }>;
}) {
  const params = await searchParams;
  if (process.env.ADMIN_SECRET == null || params.admin_secret !== process.env.ADMIN_SECRET) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold text-stone-900">Admin</h1>
        <p className="mt-4 text-stone-600">
          Set <code className="rounded bg-stone-100 px-1">ADMIN_SECRET</code> and open{" "}
          <code className="rounded bg-stone-100 px-1">/admin/trail-quality?admin_secret=…</code>
        </p>
      </div>
    );
  }

  const report = await catalogAudit();
  if (!report) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-stone-600">
        This catalog snapshot has no audit report. Run <code>npm run source:trails</code> to rebuild it with quality checks.
      </div>
    );
  }

  const status = STATUSES.includes(params.status as QualityStatus) ? (params.status as QualityStatus) : "review";
  const flag = params.flag && params.flag in QUALITY_FLAGS ? (params.flag as QualityFlag) : null;
  const rows = report.entries.filter((e) => e[6] === status && (!flag || e[7].includes(flag)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const reviews = await reviewDecisions();
  // Audit entries carry a point on each trail ([9] latitude, [10] longitude) in snapshots built since then.
  const pins = shown
    .filter((e) => Number.isFinite(e[9]) && Number.isFinite(e[10]))
    .map((e) => ({ id: e[0], name: e[1], latitude: e[9], longitude: e[10] }) as unknown as CatalogTrail);
  const link = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams({ admin_secret: params.admin_secret!, status, ...(flag ? { flag } : {}) });
    for (const [k, v] of Object.entries(patch)) if (v === null) next.delete(k); else next.set(k, v);
    return `/admin/trail-quality?${next}`;
  };
  const stat = (label: string, value: number) => (
    <div className="rounded-lg border border-stone-200 p-4">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{value.toLocaleString("en-US")}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 pb-24">
      <Link href={`/admin?admin_secret=${encodeURIComponent(params.admin_secret!)}`} className="text-sm text-emerald-700 hover:underline">
        ← Admin
      </Link>
      <h1 className="mt-2 text-3xl font-bold text-stone-900">Trail data quality</h1>
      <p className="mt-2 text-stone-600">
        Audit of the published catalog snapshot, run {report.generatedAt.slice(0, 10)}. Rules: <code>config/trail-quality.json</code>.
        Rerun with <code>npm run audit:trails</code>; rebuild with <code>npm run source:trails</code>.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat("Trails audited", report.total)}
        {stat("Passed all checks", report.byStatus.ok)}
        {stat("Short trails (kept)", report.byStatus.short)}
        {stat("Awaiting review", report.byStatus.review)}
        {stat("Partial / unnamed segments", report.byStatus.fragment)}
        {stat("Pieces of a longer trail", report.byFlag["fragment-of-longer-trail"] ?? 0)}
        {stat("Incomplete geometry", report.byFlag["incomplete-geometry"] ?? 0)}
        {stat("Source distance disagrees", report.byFlag["distance-mismatch"] ?? 0)}
        {stat("Duplicates removed at import", report.duplicatesRemoved ?? 0)}
        {stat("Missing elevation", report.missingElevation)}
        {stat("Missing region", report.missingRegion)}
        {stat("Dropped under minimum length", report.excludedTooShort ?? 0)}
      </dl>

      <h2 className="mt-10 text-xl font-semibold text-stone-900">Flags</h2>
      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        <li>
          <Link href={link({ flag: null, page: null })} className={`rounded-full border px-3 py-1 ${!flag ? "border-emerald-700 text-emerald-800" : "border-stone-300"}`}>
            All
          </Link>
        </li>
        {(Object.keys(QUALITY_FLAGS) as QualityFlag[]).filter((f) => report.byFlag[f]).map((f) => (
          <li key={f}>
            <Link href={link({ flag: f, page: null })} title={QUALITY_FLAGS[f]} className={`rounded-full border px-3 py-1 ${flag === f ? "border-emerald-700 text-emerald-800" : "border-stone-300"}`}>
              {f} · {report.byFlag[f]!.toLocaleString("en-US")}
            </Link>
          </li>
        ))}
      </ul>

      <nav className="mt-8 flex gap-4 border-b border-stone-200 text-sm" aria-label="Status">
        {STATUSES.map((s) => (
          <Link key={s} href={link({ status: s, page: null })} className={`-mb-px border-b-2 pb-2 ${s === status ? "border-emerald-700 font-medium text-stone-900" : "border-transparent text-stone-500"}`}>
            {QUALITY_STATUS_LABELS[s]} ({report.byStatus[s].toLocaleString("en-US")})
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm text-stone-500">
        {rows.length.toLocaleString("en-US")} records{flag ? ` flagged ${flag}` : ""}. Page {page} of {pages}.
      </p>

      {pins.length > 0 && (
        <div className="mt-4">
          <CatalogMapView trails={pins} />
          <p className="mt-1 text-xs text-stone-500">Pins mark the trails on this page. Select one to open it.</p>
        </div>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-stone-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Trail</th>
              <th className="py-2 pr-3 font-medium">Stored</th>
              <th className="py-2 pr-3 font-medium">Recalculated</th>
              <th className="py-2 pr-3 font-medium">Flags</th>
              <th className="py-2 pr-3 font-medium">Source</th>
              <th className="py-2 pr-3 font-medium">Recommended action</th>
              <th className="py-2 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(([id, name, region, source, miles, mapped, s, flags, parentId]) => (
              <tr key={id} className="border-t border-stone-100 align-top">
                <td className="py-2 pr-3">
                  <Link href={`/explore/trails/${encodeURIComponent(id)}`} className="text-emerald-800 hover:underline">{name}</Link>
                  <div className="text-xs text-stone-500">{region ?? "No region"} · {id}</div>
                  {parentId && (
                    <Link href={`/explore/trails/${encodeURIComponent(parentId)}`} className="text-xs text-emerald-700 hover:underline">
                      Longer trail →
                    </Link>
                  )}
                </td>
                <td className="py-2 pr-3 tabular-nums">{formatDistance(miles).primary}</td>
                <td className="py-2 pr-3 tabular-nums">{formatDistance(mapped).primary}</td>
                <td className="py-2 pr-3">{flags.join(", ")}</td>
                <td className="py-2 pr-3">{source}</td>
                <td className="py-2 pr-3">{recommendedAction(s, flags)}</td>
                <td className="py-2">{s === "short" && !reviews.has(id) ? "Kept" : <TrailReviewControls trailId={id} secret={params.admin_secret!} initial={reviews.get(id) ?? null} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex gap-4 text-sm">
        {page > 1 && <Link href={link({ page: String(page - 1) })} className="text-emerald-700 hover:underline">← Previous</Link>}
        {page < pages && <Link href={link({ page: String(page + 1) })} className="text-emerald-700 hover:underline">Next →</Link>}
      </div>
    </div>
  );
}
