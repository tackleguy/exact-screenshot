import { getAuthUser } from "@/lib/supabase/server";
import { GearPageClient } from "@/components/gear/GearPageClient";
import { LocalGear } from "@/components/gear/LocalGear";

export const metadata = { title: "Gear locker — Hyked", description: "Manage the equipment you bring on your trips." };

export default async function GearPage() {
  const { user } = await getAuthUser();
  if (!user) return <LocalGear />;

  return (
    <div className="fieldbook-page">
      <GearPageClient userId={user.id} />
    </div>
  );
}
