"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";
import type { PackTrail } from "@/lib/gear";

export type UserPackTrail = PackTrail & { id: string };

export function useUserTrails(userId: string) {
  const [trails, setTrails] = useState<UserPackTrail[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [message, setMessage] = useState<string | null>(() => isSupabaseConfigured() ? null : "Sign-in is unavailable right now.");

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("user_trails")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) setMessage(error.message);
      else
        setTrails(
          (data ?? []).map((r) => ({
            id: String(r.id),
            name: String(r.name),
            location: String(r.location ?? ""),
            distance: Number(r.distance) || 0,
            elevation: Number(r.elevation) || 0,
            days: String(r.days ?? "1"),
            difficulty: r.difficulty as PackTrail["difficulty"],
            tags: (r.tags as string[]) ?? [],
            season: String(r.season ?? ""),
          })),
        );
      setLoading(false);
    })();
  }, [userId]);

  const addTrail = async (trail: PackTrail) => {
    const supabase = createClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from("user_trails")
      .insert({
        user_id: userId,
        name: trail.name,
        location: trail.location,
        distance: trail.distance,
        elevation: trail.elevation,
        days: trail.days,
        difficulty: trail.difficulty,
        tags: trail.tags,
        season: trail.season,
      })
      .select()
      .single();
    if (error) {
      setMessage(error.message);
      return;
    }
    setTrails((prev) => [{ ...trail, id: String(data.id) }, ...prev]);
    setMessage("Trail added");
  };

  const deleteTrail = async (id: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.from("user_trails").delete().eq("id", id);
    if (error) {
      setMessage(error.message);
      return;
    }
    setTrails((prev) => prev.filter((t) => t.id !== id));
    setMessage("Trail removed");
  };

  return { trails, loading, message, addTrail, deleteTrail };
}
