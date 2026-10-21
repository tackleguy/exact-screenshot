import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
export function useAccount() {
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({ user: null, loading: true });
  useEffect(() => {
    const client = createClient();
    if (!client) { setState({ user: null, loading: false }); return; }
    let active = true;
    client.auth.getUser().then(({ data }) => { if (active) setState({ user: data.user, loading: false }); }).catch(() => { if (active) setState({ user: null, loading: false }); });
    const { data } = client.auth.onAuthStateChange((_event, session) => { if (active) setState({ user: session?.user ?? null, loading: false }); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return state;
}