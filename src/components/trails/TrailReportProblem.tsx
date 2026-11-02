"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { flushPendingReports, PROBLEM_LABELS, submitTrailReport, type ProblemKind } from "@/lib/trail-catalog/reports";

/** "Report a problem with this trail": a link that opens a short form; the report is stored (see reports.ts). */
export function TrailReportProblem({ trailId, name }: { trailId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "saved">("idle");
  const id = useId();
  // Reports kept on this device from an earlier visit are sent now.
  useEffect(() => { void flushPendingReports(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setStatus("sending");
    const result = await submitTrailReport({
      catalog_trail_id: trailId,
      trail_name: name,
      problem: (data.get("problem") as ProblemKind) || "other",
      details: String(data.get("details") ?? ""),
      contact: String(data.get("contact") ?? ""),
      page_url: window.location.href,
    });
    setStatus(result);
  }

  if (status === "sent" || status === "saved") {
    return (
      <p className="trail-report trail-report--done" role="status">
        Thanks — your report about {name} {status === "sent" ? "was sent" : "is saved and will be sent the next time Hyked can reach its server"}. We use reports to fix names, lines and stats.
      </p>
    );
  }
  return (
    <div className="trail-report">
      {!open ? (
        <button type="button" className="trail-report-link" onClick={() => setOpen(true)}>Report a problem with this trail</button>
      ) : (
        <form className="trail-report-form" onSubmit={submit} aria-labelledby={`${id}-title`}>
          <h2 id={`${id}-title`}>Report a problem with this trail</h2>
          <label>
            What’s wrong?
            <select name="problem" defaultValue="name" required>
              {Object.entries(PROBLEM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Details <small className="catalog-muted">(optional)</small>
            <textarea name="details" rows={3} maxLength={2000} placeholder="e.g. The trail is called Burton Canyon Trail on the trailhead sign." />
          </label>
          <label>
            Email, if we may follow up <small className="catalog-muted">(optional)</small>
            <input name="contact" type="email" maxLength={200} autoComplete="email" />
          </label>
          <div className="trail-report-actions">
            <button type="submit" className="catalog-button" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send report"}</button>
            <button type="button" className="catalog-button secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
