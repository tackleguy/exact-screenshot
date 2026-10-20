import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { TrailDatabase } from "@/components/pack-trails/TrailDatabase";

export const metadata: Metadata = { title: "My trips — Hyked" };

export default async function PackTrailsPage() {
  const { user } = await getAuthUser();
  if (!user) redirect("/login?next=/pack-trails");

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 pb-24 sm:px-6 md:pb-10 lg:px-10">
      <TrailDatabase userId={user.id} />
    </div>
  );
}
