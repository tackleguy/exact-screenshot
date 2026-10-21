import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getAuthUser } from "@/lib/supabase/server";
import { CATALOG_ACTIVITIES, TRAIL_SECTIONS, parseTrailSection, type CatalogActivity } from "@/lib/trail-catalog/activity";
import { SECTION_COOKIE } from "@/lib/preferred-section";
import { TrailExplorer } from "@/components/explore/TrailExplorer";

export const metadata: Metadata = {
  title: "Trail map — Hyked",
  description: "Explore hiking, biking, horse and snow trails across the United States and Canada on a topo, satellite or 3D terrain map.",
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined, min: number, max: number) => {
  const n = Number(one(v));
  return one(v) !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export default async function MapPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  // URL section, else this device's pick, else the account's sign-up choice, else Hike & walk.
  const fromUrl = one(params.activity);
  let activity: CatalogActivity = "hike";
  if (fromUrl && (CATALOG_ACTIVITIES as readonly string[]).includes(fromUrl)) activity = fromUrl as CatalogActivity;
  else {
    const fromCookie = parseTrailSection((await cookies()).get(SECTION_COOKIE)?.value);
    const fromAccount = fromCookie ? null : parseTrailSection((await getAuthUser().catch(() => ({ user: null }))).user?.user_metadata?.preferred_section);
    const section = fromCookie ?? fromAccount;
    if (section) activity = TRAIL_SECTIONS.find((s) => s.key === section)!.activity;
  }
  const lat = num(params.lat, -85, 85), lng = num(params.lng, -180, 180);
  const trail = one(params.trail)?.slice(0, 200) ?? null;
  return (
    <TrailExplorer
      start={{ activity, trail, center: lat !== null && lng !== null ? [lng, lat] : null, zoom: num(params.z, 1, 20) }}
    />
  );
}
