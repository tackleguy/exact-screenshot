/**
 * "Report a problem with this trail". Reports go to the trail_problem_reports table
 * (supabase/migrations/20261102000001_trail_problem_reports.sql). When the table can't be reached (offline, or the
 * migration isn't applied yet) the report is kept on this device and sent with the next report or page visit, so
 * nothing a visitor writes is lost.
 */
import { createClient } from "@/lib/supabase/client";

export const PROBLEM_LABELS = {
  name: "The name is wrong or incomplete",
  location: "The map line or location is wrong",
  stats: "Distance, elevation or difficulty is wrong",
  description: "The description is wrong",
  access: "It’s closed, private or not a trail",
  duplicate: "It’s a duplicate of another trail",
  other: "Something else",
} as const;
export type ProblemKind = keyof typeof PROBLEM_LABELS;

export interface TrailReport {
  catalog_trail_id: string;
  trail_name: string | null;
  problem: ProblemKind;
  details: string | null;
  contact: string | null;
  page_url: string | null;
}

const PENDING = "hyked:trail-reports";

function readPending(): TrailReport[] {
  try { return JSON.parse(localStorage.getItem(PENDING) ?? "[]") as TrailReport[]; } catch { return []; }
}
function writePending(reports: TrailReport[]) {
  try {
    if (reports.length) localStorage.setItem(PENDING, JSON.stringify(reports.slice(-50)));
    else localStorage.removeItem(PENDING);
  } catch { /* storage unavailable */ }
}

async function send(reports: TrailReport[]): Promise<boolean> {
  const client = createClient();
  if (!client || !reports.length) return false;
  const user = (await client.auth.getSession().catch(() => null))?.data.session?.user.id ?? null;
  const { error } = await client.from("trail_problem_reports").insert(reports.map((r) => ({ ...r, user_id: user })));
  return !error;
}

/** Sends reports kept on this device from earlier attempts. */
export async function flushPendingReports() {
  const pending = readPending();
  if (pending.length && (await send(pending).catch(() => false))) writePending([]);
}

/** Files a report: "sent" when it reached the server, "saved" when it is kept on this device for later. */
export async function submitTrailReport(report: TrailReport): Promise<"sent" | "saved"> {
  const clean: TrailReport = {
    ...report,
    trail_name: report.trail_name?.slice(0, 300) ?? null,
    details: report.details?.trim().slice(0, 2000) || null,
    contact: report.contact?.trim().slice(0, 200) || null,
    page_url: report.page_url?.slice(0, 500) ?? null,
  };
  const pending = readPending();
  if (await send([...pending, clean]).catch(() => false)) { writePending([]); return "sent"; }
  writePending([...pending, clean]);
  return "saved";
}
