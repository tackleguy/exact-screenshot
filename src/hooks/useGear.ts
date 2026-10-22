"use client";

import { isGearStorageMissing } from "@/lib/assistant/gear-storage";
import { cleanStoredProductDetails } from "@/lib/assistant/product-details";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";
import type { GearCategory, GearItem, GearType } from "@/lib/gear";

function mapGear(row: Record<string, unknown>): GearItem {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category as GearCategory,
    type: (row.type as GearType) || "Base",
    qty: Number(row.qty) || 1,
    weight: Number(row.weight) || 0,
    price: Number(row.price) || 0,
    link: String(row.link ?? ""),
    productDetails: cleanStoredProductDetails(row.product_details),
  };
}

export function useGear(userId: string) {
  const [gear, setGear] = useState<GearItem[]>([]);
  const [storageMissing, setStorageMissing] = useState(false);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(() => isSupabaseConfigured() ? null : "Sign-in is unavailable right now.");

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void supabase.from("gear_items").select("*").eq("user_id", userId).order("created_at")
      .then(({ data, error: failure }) => {
        if (!active) return;
        setError(failure?.message ?? null);
        setStorageMissing(isGearStorageMissing(failure));
        if (!failure) setGear((data ?? []).map(mapGear));
        setLoading(false);
      });
    return () => { active = false; };
  }, [userId]);

  const toRow = (item: Omit<GearItem, "id">) => {
    const { productDetails, ...fields } = item;
    return { ...fields, product_details: cleanStoredProductDetails(productDetails) };
  };
  const addGear = async (item: Omit<GearItem, "id">) => {
    const supabase = createClient();
    if (!supabase) return false;
    const { data, error: err } = await supabase
      .from("gear_items")
      .insert({ user_id: userId, ...toRow(item) })
      .select()
      .single();
    if (err) {
      setError(err.message);
      return false;
    }
    if (data) setGear((prev) => [...prev, mapGear(data)]);
    setError(null);
    return Boolean(data);
  };

  const editGear = async (id: string, item: Omit<GearItem, "id">) => {
    const supabase = createClient();
    if (!supabase) return false;
    const { error: err } = await supabase
      .from("gear_items")
      .update(toRow(item))
      .eq("id", id);
    if (err) {
      setError(err.message);
      return false;
    }
    setGear((prev) => prev.map((g) => (g.id === id ? { ...item, id } : g)));
    setError(null);
    return true;
  };

  const deleteGear = async (id: string) => {
    const supabase = createClient();
    if (!supabase) return false;
    const { error: err } = await supabase
      .from("gear_items")
      .delete()
      .eq("id", id);
    if (err) {
      setError(err.message);
      return false;
    }
    setGear((prev) => prev.filter((g) => g.id !== id));
  };

  return { gear, loading, error, storageMissing, addGear, editGear, deleteGear };
}
