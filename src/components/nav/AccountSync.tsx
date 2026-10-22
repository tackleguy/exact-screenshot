"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { clearGuest, guest, guestHasData, takeGuestHandoff, type GuestState } from "@/lib/account/guest";
import { migrateLegacyData, mergeMemories, uploadGuestTrails, uploadToAccount } from "@/lib/account/migrate";
import { setSyncAccount, trackCloud } from "@/lib/account/sync";
import { forgetCloudPlanner, loadCloudPlanner } from "@/components/assistant/usePlannerMemory";
import { guestPhotos, uploadTrailPhoto } from "@/lib/personal-trails";

const done = new Set<string>();

/** When someone signs in: move this visit's guest work and any data older versions left on the device into the account. */
async function onSignedIn(userId: string) {
  if (done.has(userId)) return;
  done.add(userId);
  const client = createClient();
  if (!client) return;
  const handoff = takeGuestHandoff();
  const work: GuestState = handoff
    ? { planner: mergeMemories(guest.planner, handoff.planner), personalTrails: new Map([...handoff.personalTrails, ...guest.personalTrails]), savedRoutes: [...handoff.savedRoutes, ...guest.savedRoutes] }
    : guest;
  let moved = 0;
  try {
    await trackCloud(async () => {
      if (handoff || guestHasData(work)) {
        await uploadToAccount(client, userId, work.planner, work.savedRoutes);
        await uploadGuestTrails(client, userId, work, guestPhotos, (id, photo) => uploadTrailPhoto(client, userId, id, photo));
        moved++;
        guestPhotos.clear();
        clearGuest();
      }
      try { moved += await migrateLegacyData(client, userId, window.localStorage); }
      catch (error) { if (!(error instanceof DOMException)) throw error; /* storage blocked: nothing to migrate */ }
    });
  } catch {
    done.delete(userId); // retried on the next auth event or page load
  }
  if (moved) {
    await loadCloudPlanner(userId, true);
    window.dispatchEvent(new Event("hyked:personal-trails"));
  }
}

export function AccountSync() {
  useEffect(() => {
    const client = createClient();
    if (!client) { setSyncAccount(false); return; }
    let current: string | null | undefined;
    const apply = (userId: string | null) => {
      if (userId === current) return;
      current = userId;
      setSyncAccount(Boolean(userId));
      if (userId) void onSignedIn(userId);
      else forgetCloudPlanner();
    };
    void client.auth.getSession().then(({ data }) => apply(data.session?.user.id ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => apply(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return null;
}
