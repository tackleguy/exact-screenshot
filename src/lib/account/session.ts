"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** The signed-in person's id (null for guests), following sign-in and sign-out. */
export function useSessionUserId(): { userId: string | null; loading: boolean } {
  const [state, setState] = useState<{ userId: string | null; loading: boolean }>({ userId: null, loading: true });
  useEffect(() => {
    const client = createClient();
    let active = true;
    void (client ? client.auth.getSession().then(({ data }) => data.session?.user.id ?? null) : Promise.resolve(null))
      .then(userId => { if (active) setState({ userId, loading: false }); });
    const auth = client?.auth.onAuthStateChange((_event, session) => { if (active) setState({ userId: session?.user.id ?? null, loading: false }); });
    return () => { active = false; auth?.data.subscription.unsubscribe(); };
  }, []);
  return state;
}
