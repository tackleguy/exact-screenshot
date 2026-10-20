import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  defaultActivityTitle,
  getTrailForRecord,
} from "@/lib/activities";
import { GpsRecorder } from "@/components/gps/GpsRecorder";
import type { ActivityType } from "@/lib/types";
import { getAuthUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Recording — Hyked" };

const VALID_TYPES: ActivityType[] = ["run", "hike", "bike", "ski"];

export default async function LiveRecordPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    trail_id?: string;
    resort_id?: string;
    resort_name?: string;
  }>;
}) {
  const params = await searchParams;
  const { user } = await getAuthUser();

  if (!user) redirect("/login?next=/record/live");

  const activityType = VALID_TYPES.includes(params.type as ActivityType)
    ? (params.type as ActivityType)
    : "hike";

  let title = defaultActivityTitle(activityType);
  let trailId: string | undefined;
  let skiAreaId: string | undefined;
  let skiAreaName: string | undefined;
  const autoStart = Boolean(params.trail_id || params.resort_id);

  if (params.trail_id) {
    const trail = await getTrailForRecord(params.trail_id);
    if (trail) {
      trailId = trail.id;
      title = defaultActivityTitle(activityType, trail.trail_name);
    }
  }

  if (params.resort_id) {
    skiAreaId = params.resort_id;
    skiAreaName = params.resort_name ?? "Ski Resort";
    title = defaultActivityTitle("ski", undefined, skiAreaName);
  }

  return (
    <GpsRecorder
      activityType={activityType}
      title={title}
      trailId={trailId}
      skiAreaId={skiAreaId}
      skiAreaName={skiAreaName}
      autoStart={autoStart}
    />
  );
}
