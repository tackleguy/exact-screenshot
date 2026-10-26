"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import "./trail-social.css";

/**
 * Set when the database has no reviews table yet (its migration not applied): stop asking for the rest of the
 * visit instead of failing on every card and page.
 */
let reviewsMissing = false;
const noteMissing = (status: number) => { if (status === 404) reviewsMissing = true; };

interface Review { id: string; user_id: string; rating: number; body: string | null; hiked_on: string | null; created_at: string }

/** Average rating and count for a trail, shared by the hero's stars and the reviews section. */
export function useTrailRating(trailId: string) {
  const [state, setState] = useState<{ id: string; reviews: Review[]; available: boolean } | null>(null);
  const reload = useCallback(() => {
    const client = createClient();
    if (!client) return;
    if (reviewsMissing) { void Promise.resolve().then(() => setState({ id: trailId, reviews: [], available: false })); return; }
    void client.from("catalog_trail_reviews").select("id,user_id,rating,body,hiked_on,created_at").eq("catalog_trail_id", trailId).order("created_at", { ascending: false }).limit(50)
      .then(({ data, error, status }) => { noteMissing(status); setState({ id: trailId, reviews: (data ?? []) as Review[], available: !error }); });
  }, [trailId]);
  useEffect(() => { reload(); }, [reload]);
  const reviews = state?.id === trailId ? state.reviews : [];
  const average = reviews.length ? reviews.reduce((t, r) => t + r.rating, 0) / reviews.length : null;
  const hasClient = useMemo(() => Boolean(createClient()), []);
  return { reviews, average, count: reviews.length, loaded: !hasClient || state?.id === trailId, available: hasClient && (state?.available ?? true), reload };
}

/** Average rating and count for several trails at once (one query per list of cards). */
export function useRatings(ids: string[]) {
  const key = [...new Set(ids)].sort().join("|");
  const [state, setState] = useState<{ key: string; byId: Map<string, { average: number; count: number }> } | null>(null);
  useEffect(() => {
    const client = createClient();
    const list = key ? key.split("|") : [];
    if (!client || !list.length || reviewsMissing) return;
    let live = true;
    void client.from("catalog_trail_reviews").select("catalog_trail_id,rating").in("catalog_trail_id", list.slice(0, 200)).then(({ data, status }) => {
      noteMissing(status);
      const sums = new Map<string, { total: number; count: number }>();
      for (const r of (data ?? []) as { catalog_trail_id: string; rating: number }[]) {
        const s = sums.get(r.catalog_trail_id) ?? { total: 0, count: 0 };
        s.total += r.rating; s.count++; sums.set(r.catalog_trail_id, s);
      }
      if (live) setState({ key, byId: new Map([...sums].map(([id, s]) => [id, { average: s.total / s.count, count: s.count }])) });
    });
    return () => { live = false; };
  }, [key]);
  return state?.key === key ? state.byId : new Map<string, { average: number; count: number }>();
}

/** Stars and the review count for a card; outlined stars and "No reviews" when nobody has rated it yet. */
export function CardRating({ rating }: { rating?: { average: number; count: number } }) {
  return <span className="card-rating"><Stars value={rating ? rating.average : null} size={13} /><small>{rating ? `${rating.average.toFixed(1)} (${rating.count})` : "No reviews"}</small></span>;
}

/** Five stars filled to `value` (out of 5); outlined when there is no rating yet. */
export function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  return (
    <span className="trail-stars" role="img" aria-label={value === null ? "No ratings yet" : `${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = value === null ? 0 : Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <svg key={i} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
            <defs><linearGradient id={`star-${i}-${Math.round(fill * 100)}`}><stop offset={`${fill * 100}%`} stopColor="currentColor" /><stop offset={`${fill * 100}%`} stopColor="transparent" /></linearGradient></defs>
            <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill={`url(#star-${i}-${Math.round(fill * 100)})`} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        );
      })}
    </span>
  );
}

/** Reviews for a catalog trail: star summary, the reviews, and a form for signed-in hikers. */
export function TrailReviews({ trailId, name }: { trailId: string; name: string }) {
  const { reviews, average, count, loaded, available, reload } = useTrailRating(trailId);
  const [session, setSession] = useState<string | null | undefined>(undefined);
  const hasClient = useMemo(() => Boolean(createClient()), []);
  const userId = hasClient ? session : null;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { void createClient()?.auth.getSession().then(({ data }) => setSession(data.session?.user.id ?? null)); }, []);
  const mine = reviews.find((r) => r.user_id === userId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = createClient();
    if (!client || !userId || !rating) return;
    setStatus("Saving…");
    const { error } = await client.from("catalog_trail_reviews").upsert({ user_id: userId, catalog_trail_id: trailId, rating, body: body.trim() || null, hiked_on: new Date().toISOString().slice(0, 10) }, { onConflict: "catalog_trail_id,user_id" });
    if (error) { setStatus("Your review couldn’t be saved right now. Try again later."); return; }
    setStatus(null); setOpen(false); setBody(""); reload();
  };

  return (
    <section className="trail-reviews" aria-labelledby="trail-reviews-heading">
      <div className="trail-reviews-head">
        <h2 id="trail-reviews-heading">Reviews</h2>
        <div className="trail-reviews-summary"><Stars value={average} size={18} /><span>{count ? `${average!.toFixed(1)} · ${count} ${count === 1 ? "review" : "reviews"}` : "No reviews yet"}</span></div>
      </div>
      {loaded && count === 0 && <p className="catalog-muted">{available ? `Be the first to review ${name}.` : "Reviews aren’t available right now."}</p>}
      {reviews.length > 0 && (
        <ul className="trail-review-list">
          {reviews.map((r) => (
            <li key={r.id}><Stars value={r.rating} size={14} /><small>{new Date(r.hiked_on ?? r.created_at).toLocaleDateString()}</small>{r.body && <p>{r.body}</p>}</li>
          ))}
        </ul>
      )}
      {userId === null && <p><Link className="btn-ghost" href={`/login?next=${encodeURIComponent(`/explore/trails/${trailId}`)}`}>Sign in to write a review</Link></p>}
      {userId && !open && <button type="button" className="btn-ghost" onClick={() => { setOpen(true); setRating(mine?.rating ?? 0); setBody(mine?.body ?? ""); }}>{mine ? "Edit your review" : "Write a review"}</button>}
      {userId && open && (
        <form className="trail-review-form" onSubmit={submit}>
          <fieldset><legend>Your rating</legend>
            {[1, 2, 3, 4, 5].map((i) => <button key={i} type="button" aria-pressed={rating >= i} aria-label={`${i} star${i > 1 ? "s" : ""}`} onClick={() => setRating(i)}>★</button>)}
          </fieldset>
          <label>What was it like? <textarea value={body} maxLength={4000} rows={4} onChange={(e) => setBody(e.target.value)} placeholder="Conditions, highlights, tips for the next hiker" /></label>
          <div><button type="submit" className="btn-primary" disabled={!rating}>Post review</button><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
          {status && <p role="status" className="catalog-muted">{status}</p>}
        </form>
      )}
    </section>
  );
}
