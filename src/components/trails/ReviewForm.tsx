"use client";

import { useState } from "react";
import { friendlyError } from "@/lib/errors";
import type { Difficulty, Review } from "@/lib/types";
import { DIFFICULTY_OPTIONS } from "@/lib/trail-difficulty";

interface ReviewFormProps {
  trailId: string;
  existingReview?: Review;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ReviewForm({
  trailId,
  existingReview,
  onSuccess,
  onCancel,
}: ReviewFormProps) {
  const [rating, setRating] = useState(existingReview?.rating ?? 5);
  const [difficulty, setDifficulty] = useState<Difficulty>(
    existingReview?.difficulty ?? "moderate",
  );
  const [body, setBody] = useState(existingReview?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const method = existingReview ? "PATCH" : "POST";
    const payload = existingReview
      ? { id: existingReview.id, rating, difficulty, body }
      : { trail_id: trailId, rating, difficulty, body };

    const res = await fetch("/api/reviews", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(friendlyError(data.error, "Your review couldn’t be saved right now."));
      setLoading(false);
      return;
    }

    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="font-semibold text-cream">
        {existingReview ? "Edit your review" : "Write a review"}
      </h3>

      <div>
        <label className="mb-2 block text-sm font-medium text-mist">Rating</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              className={`text-2xl transition ${star <= rating ? "text-amber-400" : "text-mist/40"}`}
              aria-label={`${star} star${star === 1 ? "" : "s"}`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="review-difficulty" className="mb-2 block text-sm font-medium text-mist">
          Difficulty you experienced
        </label>
        <select
          id="review-difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as Difficulty)}
          required
          className="w-full rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2.5 text-sm text-cream"
        >
          {DIFFICULTY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-mist">
          After five difficulty ratings, the trail shows their community average.
        </p>
      </div>

      <div>
        <label htmlFor="review-body" className="mb-2 block text-sm font-medium text-mist">
          Your experience
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Share details about conditions, difficulty, and highlights..."
          className="w-full rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2 text-sm text-cream outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={loading} className="btn-primary !py-2 !text-sm">
          {loading ? "Saving..." : existingReview ? "Update review" : "Post review"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost !py-2 !text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
