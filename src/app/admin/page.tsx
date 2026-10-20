import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AdminImportPanel } from "@/components/admin/AdminImportPanel";

export const metadata: Metadata = { title: "Admin — Hyked", robots: { index: false, follow: false } };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ admin_secret?: string }>;
}) {
  const params = await searchParams;
  const authorized =
    process.env.ADMIN_SECRET != null &&
    params.admin_secret === process.env.ADMIN_SECRET;

  if (!authorized) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold text-stone-900">Admin</h1>
        <p className="mt-4 text-stone-600">
          Set <code className="rounded bg-stone-100 px-1">ADMIN_SECRET</code> in your
          environment and open{" "}
          <code className="rounded bg-stone-100 px-1">/admin?admin_secret=…</code>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  if (!supabase) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-stone-600">Supabase is not configured.</p>
      </div>
    );
  }

  const [sources, logs, mergeCandidates, photos, trails] = await Promise.all([
    supabase.from("data_sources").select("*").order("import_date", { ascending: false }),
    supabase.from("import_logs").select("*").order("started_at", { ascending: false }).limit(20),
    supabase
      .from("merge_candidates")
      .select("*, trail_a:trails!merge_candidates_trail_a_id_fkey(trail_name), trail_b:trails!merge_candidates_trail_b_id_fkey(trail_name)")
      .eq("status", "pending")
      .limit(20),
    supabase
      .from("trail_photos")
      .select("*, trail:trails(trail_name)")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("trails").select("id, trail_name, confidence_score, data_source_id").limit(50),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 pb-24">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-700">Trail Platform · Phase 1</p>
          <h1 className="text-3xl font-bold text-stone-900">Admin dashboard</h1>
        </div>
        <Link
          href={`/admin/trail-quality?admin_secret=${encodeURIComponent(params.admin_secret!)}`}
          className="text-sm text-emerald-700 hover:underline"
        >
          Trail data quality
        </Link>
        <Link href="/explore/trails" className="text-sm text-emerald-700 hover:underline">
          View trails →
        </Link>
      </div>

      <section className="mb-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Trigger import</h2>
        <p className="mt-2 text-sm text-stone-600">
          Runs ingestion with the service role key. Configure sources in{" "}
          <code className="rounded bg-stone-100 px-1">config/ingestion/default.json</code>.
        </p>
        <AdminImportPanel adminSecret={params.admin_secret!} />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <AdminTable
          title="Data sources"
          rows={(sources.data ?? []).map((s) => [
            s.source_name,
            s.license,
            new Date(s.import_date).toLocaleDateString(),
          ])}
          columns={["Source", "License", "Imported"]}
        />
        <AdminTable
          title="Recent import logs"
          rows={(logs.data ?? []).map((l) => [
            l.adapter_name,
            l.status,
            `${l.records_stored}/${l.records_processed}`,
            l.error_message ?? "—",
          ])}
          columns={["Adapter", "Status", "Stored", "Error"]}
        />
        <AdminTable
          title="Merge candidates (pending)"
          rows={(mergeCandidates.data ?? []).map((m) => [
            (m.trail_a as { trail_name?: string })?.trail_name ?? m.trail_a_id,
            (m.trail_b as { trail_name?: string })?.trail_name ?? m.trail_b_id,
            `${Math.round(Number(m.name_similarity) * 100)}%`,
            `${Math.round(Number(m.overlap_score) * 100)}%`,
          ])}
          columns={["Trail A", "Trail B", "Name match", "Overlap"]}
        />
        <AdminTable
          title="Trail photos"
          rows={(photos.data ?? []).map((p) => [
            (p.trail as { trail_name?: string })?.trail_name ?? p.trail_id,
            p.is_disabled ? "disabled" : "active",
            p.license,
          ])}
          columns={["Trail", "Status", "License"]}
        />
      </div>

      <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Imported trails sample</h2>
        <ul className="mt-4 divide-y divide-stone-100">
          {(trails.data ?? []).slice(0, 15).map((t) => (
            <li key={t.id} className="flex justify-between py-2 text-sm">
              <Link href={`/explore/trails/${t.id}`} className="text-emerald-700 hover:underline">
                {t.trail_name}
              </Link>
              <span className="text-stone-500">{t.confidence_score}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AdminTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">No records yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                {columns.map((col) => (
                  <th key={col} className="pb-2 pr-4 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-stone-100">
                  {row.map((cell, j) => (
                    <td key={j} className="py-2 pr-4 text-stone-800">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
